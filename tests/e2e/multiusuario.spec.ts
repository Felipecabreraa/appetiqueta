import { devices, expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

/**
 * Operación real: varias personas, cada una con su celular (contexto de navegador y localStorage propios),
 * escaneando el QR y completando el formulario de la lectura que corresponde.
 */
const API = () => process.env.E2E_API_BASE!
const PHONE = devices['Pixel 7']

// Escenario de celulares: se ejecuta una vez, en el proyecto móvil (cada "celular" es un contexto propio).
test.skip(({ isMobile }) => !isMobile, 'escenario de celulares')

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API()}/api/auth/login`, {
    data: { username: process.env.E2E_USER, password: process.env.E2E_PASS },
  })
  return (await res.json()).token
}

async function crearEtiquetas(request: APIRequestContext, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, (_, i) =>
    `MU${Date.now().toString(36).toUpperCase()}${i.toString(36).toUpperCase()}`.slice(0, 12),
  )
  const res = await request.post(`${API()}/api/labels/batch`, {
    headers: { Authorization: `Bearer ${await token(request)}` },
    data: {
      labels: ids.map((id) => ({
        id,
        fecha: '2026-01-15T08:00',
        empresa: 'Agrícola Esmeralda',
        csg: 'CSG001',
        especie: 'Cereza',
        variedad: 'Lapins',
        centroCosto: 'CC01',
        sector: 'S-MU',
      })),
    },
  })
  expect((await res.json()).ok).toBe(true)
  return ids
}

async function servidor(request: APIRequestContext, id: string) {
  const body = await (await request.get(`${API()}/api/labels/${id}`)).json()
  return body as {
    label: { cantidad_totes: number | null; jefe_cuadrilla: string }
    movements: Array<{ type: string; cantidad: number; precio_clp: number | null; jh: number | null }>
  }
}

async function celular(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ ...PHONE })
  return ctx.newPage()
}

async function abrirJc(page: Page, id: string) {
  await page.goto(`/?e=${id}`)
  await expect(page.getByRole('heading', { name: 'Registro JC' })).toBeVisible({ timeout: 20_000 })
}

async function llenarJc(page: Page, d: { totes: number; jefe: string; precio: number; jh: number }) {
  await page.getByLabel('Totes en salida').fill(String(d.totes))
  await page.getByLabel('Jefe de cuadrilla').selectOption(d.jefe)
  await page.getByLabel('Precio (CLP)').fill(String(d.precio))
  await page.getByLabel('JH (personas en cuadrilla)').fill(String(d.jh))
}

async function hacerAcopio(page: Page, id: string, totes: number) {
  await page.goto(`/?e=${id}`)
  await expect(page.getByRole('heading', { name: 'Registro en acopio' })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Totes recibidos en acopio').fill(String(totes))
  await page.getByRole('button', { name: 'Guardar llegada' }).click()
  await expect(page.getByRole('heading', { name: 'Registro completo' })).toBeVisible()
}

test('8 celulares registran JC y luego acopio de 8 etiquetas en paralelo, con datos exactos', async ({ browser, request }) => {
  test.setTimeout(120_000)
  const ids = await crearEtiquetas(request, 8)
  const jefes = ['Juan Pérez', 'María Soto']
  const datos = ids.map((_, i) => ({ totes: 10 + i, jefe: jefes[i % 2]!, precio: 1000 + i * 50, jh: 5 + i }))

  const fase1 = await Promise.all(ids.map(() => celular(browser)))
  await Promise.all(
    fase1.map(async (page, i) => {
      await abrirJc(page, ids[i]!)
      await llenarJc(page, datos[i]!)
      await page.getByRole('button', { name: 'Guardar salida' }).click()
      await expect(page.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()
    }),
  )

  // Otras 8 personas (otros celulares, sin caché previo) registran la llegada al acopio.
  const fase2 = await Promise.all(ids.map(() => celular(browser)))
  await Promise.all(fase2.map((page, i) => hacerAcopio(page, ids[i]!, datos[i]!.totes - 1)))

  for (const [i, id] of ids.entries()) {
    const s = await servidor(request, id)
    const d = datos[i]!
    expect(s.label.cantidad_totes).toBe(d.totes)
    expect(s.label.jefe_cuadrilla).toBe(d.jefe)
    const jc = s.movements.filter((m) => m.type === 'jc')
    const ac = s.movements.filter((m) => m.type === 'acopio')
    expect(jc).toHaveLength(1)
    expect(ac).toHaveLength(1)
    expect(jc[0]).toMatchObject({ cantidad: d.totes, precio_clp: d.precio, jh: d.jh })
    expect(ac[0]!.cantidad).toBe(d.totes - 1)
  }
})

test('dos celulares guardan el JC de la misma etiqueta a la vez: gana uno y el otro pasa a acopio', async ({ browser, request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const a = await celular(browser)
  const b = await celular(browser)
  await Promise.all([abrirJc(a, id!), abrirJc(b, id!)])
  await llenarJc(a, { totes: 20, jefe: 'Juan Pérez', precio: 1500, jh: 8 })
  await llenarJc(b, { totes: 99, jefe: 'María Soto', precio: 9999, jh: 9 })
  await Promise.all([
    a.getByRole('button', { name: 'Guardar salida' }).click(),
    b.getByRole('button', { name: 'Guardar salida' }).click(),
  ])

  const ganoA = await a
    .getByRole('heading', { name: 'Registro guardado' })
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  const [ganador, perdedor, datosGanador] = ganoA ? [a, b, { totes: 20, jefe: 'Juan Pérez' }] : [b, a, { totes: 99, jefe: 'María Soto' }]
  await expect(ganador.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()

  // El perdedor recibe un aviso claro y su pantalla se actualiza con el estado real (sin re-escanear).
  await expect(perdedor.getByText(/ya (tiene|existe) (una )?salida JC/i)).toBeVisible()
  await expect(perdedor.getByRole('heading', { name: 'Registro en acopio' })).toBeVisible({ timeout: 15_000 })

  const s = await servidor(request, id!)
  expect(s.movements.filter((m) => m.type === 'jc')).toHaveLength(1)
  expect(s.label.cantidad_totes).toBe(datosGanador.totes)
  expect(s.label.jefe_cuadrilla).toBe(datosGanador.jefe)
})

test('un celular con caché viejo ve el estado real del servidor al re-escanear', async ({ browser, request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const a = await celular(browser)
  await abrirJc(a, id!) // A guarda la etiqueta en su caché en fase JC

  const b = await celular(browser)
  await abrirJc(b, id!)
  await llenarJc(b, { totes: 15, jefe: 'Juan Pérez', precio: 1200, jh: 6 })
  await b.getByRole('button', { name: 'Guardar salida' }).click()
  await expect(b.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()
  await hacerAcopio(b, id!, 15)

  await a.goto(`/?e=${id}`)
  await expect(a.getByRole('heading', { name: 'Registro completo' })).toBeVisible({ timeout: 20_000 })
})

test('un formulario JC abierto con estado viejo no puede registrar un segundo JC', async ({ browser, request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const a = await celular(browser)
  await abrirJc(a, id!)

  const b = await celular(browser)
  await abrirJc(b, id!)
  await llenarJc(b, { totes: 11, jefe: 'María Soto', precio: 1100, jh: 4 })
  await b.getByRole('button', { name: 'Guardar salida' }).click()
  await expect(b.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()

  // A tenía el formulario abierto desde antes y guarda tarde.
  await llenarJc(a, { totes: 50, jefe: 'Juan Pérez', precio: 5000, jh: 9 })
  await a.getByRole('button', { name: 'Guardar salida' }).click()
  await expect(a.getByRole('heading', { name: 'Registro en acopio' })).toBeVisible({ timeout: 15_000 })

  const s = await servidor(request, id!)
  expect(s.movements.filter((m) => m.type === 'jc')).toHaveLength(1)
  expect(s.label.cantidad_totes).toBe(11)
})

test('validaciones de los formularios: no se guardan datos inválidos', async ({ browser, request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const p = await celular(browser)
  await abrirJc(p, id!)
  const guardar = p.getByRole('button', { name: 'Guardar salida' })

  await llenarJc(p, { totes: 0, jefe: 'Juan Pérez', precio: 1000, jh: 5 })
  await guardar.click()
  await expect(p.getByRole('alert')).toContainText('al menos 1 tote')

  await p.getByLabel('Totes en salida').fill('2.5')
  await guardar.click()
  await expect(p.getByRole('alert')).toBeVisible()
  expect((await servidor(request, id!)).movements).toHaveLength(0)

  await llenarJc(p, { totes: 12, jefe: 'Juan Pérez', precio: 1000, jh: 5 })
  await guardar.click()
  await expect(p.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()

  await p.goto(`/?e=${id}`)
  await expect(p.getByRole('heading', { name: 'Registro en acopio' })).toBeVisible({ timeout: 20_000 })
  await p.getByLabel('Totes recibidos en acopio').fill('3.7')
  await p.getByRole('button', { name: 'Guardar llegada' }).click()
  await expect(p.getByRole('alert')).toBeVisible()
  expect((await servidor(request, id!)).movements.filter((m) => m.type === 'acopio')).toHaveLength(0)
})

test('API: el servidor rechaza cantidades inválidas aunque el cliente las envíe', async ({ request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const post = (data: Record<string, unknown>) => request.post(`${API()}/api/movements`, { data })
  const base = { labelId: id, type: 'jc', at: new Date().toISOString(), jcFirstRead: { jefeCuadrilla: 'Juan Pérez' } }
  for (const cantidad of [0, -1, 2.5, 'abc', 10_000_000]) {
    const r = await post({ ...base, cantidad, precioClp: 1000, jh: 5 })
    expect(r.status(), `cantidad=${cantidad}`).toBe(400)
  }
  expect((await post({ ...base, cantidad: 10, precioClp: 10.5, jh: 5 })).status()).toBe(400)
  expect((await post({ ...base, cantidad: 10, precioClp: 1000, jh: 2.5 })).status()).toBe(400)
  expect((await servidor(request, id!)).movements).toHaveLength(0)
})

test('la hora de la lectura la fija el servidor, no el reloj del celular', async ({ request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const antes = Date.now()
  const r = await request.post(`${API()}/api/movements`, {
    data: {
      labelId: id,
      type: 'jc',
      cantidad: 10,
      precioClp: 1000,
      jh: 5,
      at: '2020-01-01T00:00:00.000Z', // reloj del celular mal configurado
      jcFirstRead: { jefeCuadrilla: 'Juan Pérez' },
    },
  })
  expect((await r.json()).ok).toBe(true)
  const body = await (await request.get(`${API()}/api/labels/${id}`)).json()
  const at = new Date(body.movements[0].at).getTime()
  expect(Math.abs(at - antes)).toBeLessThan(5 * 60_000)
})

test('sin conexión con el servidor, el celular avisa que no pudo verificar el estado', async ({ browser, request }) => {
  const [id] = await crearEtiquetas(request, 1)
  const p = await celular(browser)
  await abrirJc(p, id!) // queda en caché del teléfono
  await p.route(`**/api/labels/${id}`, (route) => route.abort('internetdisconnected'))
  await p.goto(`/?e=${id}`)
  await expect(p.getByText('No se pudo verificar con el servidor', { exact: false })).toBeVisible({ timeout: 30_000 })
  await expect(p.getByRole('heading', { name: 'Registro JC' })).toBeVisible()
})

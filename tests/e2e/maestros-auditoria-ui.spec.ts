import { expect, test, type Page } from '@playwright/test'
import { API, loginUsuario, sufijo } from './helpers/api'
import { loginAs } from './helpers/auth'
import { conectarBd } from './helpers/db'
import { abrirMantenimiento, irACatalogo, type Catalogo } from './helpers/maestros-ui'
import {
  auth,
  crearLos7,
  fechaChile,
  leerBundle,
  payloadEditado,
  postMaestro,
  RUTA,
  TABLAS,
  type Tabla,
} from './helpers/maestros'

const CATALOGO: Record<Tabla, Catalogo> = {
  relations: 'Relaciones',
  seasons: 'Temporadas',
  companies: 'Empresas',
  species: 'Especies',
  varieties: 'Variedades',
  csg: 'CSG',
  jcForemen: 'Jefes de cuadrilla',
}

/** Código por el que se filtra cada catálogo (en relaciones, el CC). */
const filtroDe = (t: Tabla, claves: Record<Tabla, string>) => claves[t]

async function filaFiltrada(page: Page, texto: string) {
  await page.getByPlaceholder('Buscar código, nombre o dato…').fill(texto)
  const fila = page.getByRole('row').filter({ hasText: texto })
  await expect(fila).toHaveCount(1)
  return fila
}

test('CA-21/CA-22/CA-23: la fila muestra "Modificado por <N> el <dd-mm-aaaa>" en los 7 catálogos (admin y superadmin)', async ({ page, request }, testInfo) => {
  const movil = testInfo.project.name === 'movil'
  const nombre = `Admin Aud UI ${sufijo()}`
  const A = await loginUsuario(request, 'admin', nombre)
  const ctx = await crearLos7(request, A.token)
  // El admin edita un registro de cada catálogo (por API) para que updatedBy = A
  const b0 = await leerBundle(request, A.token)
  for (const t of TABLAS) {
    const r = b0[t].find((x) => x.id === ctx.ids[t])!
    expect((await postMaestro(request, A.token, RUTA[t], payloadEditado(t, r, ctx.sfx))).status).toBe(200)
  }
  const b1 = await leerBundle(request, A.token)

  for (const quien of ['admin', 'superadmin'] as const) {
    if (quien === 'admin') await loginAs(page, A.username, A.password)
    else await loginAs(page)
    await abrirMantenimiento(page)
    for (const t of TABLAS) {
      const reg = b1[t].find((x) => x.id === ctx.ids[t])!
      await irACatalogo(page, CATALOGO[t])
      const fila = await filaFiltrada(page, filtroDe(t, ctx.claves))
      const esperado = `Modificado por ${nombre} el ${fechaChile(reg.updatedAt as string)}`
      const texto = fila.getByText(esperado)
      if (movil) await texto.scrollIntoViewIfNeeded()
      await expect(texto, `${quien} / ${t}`).toBeVisible()
      if (movil && t === 'csg') {
        // CA-22: los botones de acción siguen visibles y operables
        const editar = fila.getByRole('button', { name: 'Editar' })
        await editar.scrollIntoViewIfNeeded()
        await expect(editar).toBeVisible()
        await editar.click()
        await expect(page.getByRole('button', { name: 'Guardar CSG' })).toBeVisible()
        await page.getByRole('button', { name: 'Cancelar edición' }).click()
        await expect(page.getByRole('row').filter({ hasText: ctx.claves.csg })).toHaveCount(1)
      }
    }
  }
})

test('CA-24: un registro histórico (sin autor) se muestra como "Modificado el <fecha> · sin autor registrado"', async ({ page, request }) => {
  const A = await loginUsuario(request, 'admin')
  const code = `CSGHIST${sufijo()}`
  const conn = await conectarBd()
  try {
    // Registro "anterior a la migración": autores NULL y fechas históricas
    await conn.execute(
      `INSERT INTO csg_catalog (code, name, is_active, created_at, updated_at)
       VALUES (?, ?, 1, '2025-03-10 15:00:00.000', '2025-03-10 15:00:00.000')`,
      [code, `CSG histórico ${code}`],
    )
  } finally {
    await conn.end()
  }
  const reg = (await leerBundle(request, A.token)).csg.find((r) => r.code === code)!
  expect(reg.createdBy).toBeNull()
  expect(reg.updatedBy).toBeNull()
  await loginAs(page, A.username, A.password)
  await abrirMantenimiento(page)
  await irACatalogo(page, 'CSG')
  const fila = await filaFiltrada(page, code)
  const texto = (await fila.innerText()).replace(/\s+/g, ' ')
  expect(texto).toContain(`Modificado el ${fechaChile(reg.updatedAt as string)} · sin autor registrado`)
  for (const malo of ['Modificado por', 'null', 'undefined']) expect(texto).not.toContain(malo)
})

test('CA-25 (UI): un CSG importado se muestra como "Modificado el <fecha> · sin autor registrado"', async ({ page, request }) => {
  const A = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const csg = `CSGIU_${sfx}`
  const imp = await request.post(`${API()}/api/master-data/import`, {
    headers: auth(A.token),
    data: {
      season: { code: `E2E-UI25-${sfx}`, name: `Temp ${sfx}`, isCurrent: false },
      rows: [{ empresa: `EMPIU_${sfx}`, cc: `CCIU_${sfx}`, especie: `ESPIU_${sfx}`, variedad: `VARIU_${sfx}`, csg }],
    },
  })
  expect(imp.status()).toBe(200)
  const reg = (await leerBundle(request, A.token)).csg.find((r) => r.code === csg)!
  await loginAs(page, A.username, A.password)
  await abrirMantenimiento(page)
  await irACatalogo(page, 'CSG')
  const fila = await filaFiltrada(page, csg)
  const texto = (await fila.innerText()).replace(/\s+/g, ' ')
  expect(texto).toContain(`Modificado el ${fechaChile(reg.updatedAt as string)} · sin autor registrado`)
  expect(texto).not.toContain('Modificado por')
})

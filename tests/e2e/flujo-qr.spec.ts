import { expect, test, type APIRequestContext } from '@playwright/test'

const API = () => process.env.E2E_API_BASE!

async function token(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API()}/api/auth/login`, {
    data: { username: process.env.E2E_USER, password: process.env.E2E_PASS },
  })
  return (await res.json()).token
}

async function crearEtiqueta(request: APIRequestContext): Promise<string> {
  const id = `E2E${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`.slice(0, 12)
  const res = await request.post(`${API()}/api/labels/batch`, {
    headers: { Authorization: `Bearer ${await token(request)}` },
    data: {
      labels: [
        {
          id,
          fecha: '2026-01-15T08:00',
          empresa: 'Agrícola Esmeralda',
          csg: 'CSG001',
          especie: 'Cereza',
          variedad: 'Lapins',
          centroCosto: 'CC01',
          sector: 'S-E2E',
          cantidadTotes: null,
        },
      ],
    },
  })
  expect((await res.json()).ok).toBe(true)
  return id
}

test('ciclo completo por QR: JC → acopio → completo', async ({ page, request }) => {
  const id = await crearEtiqueta(request)

  // Primera lectura: JC
  await page.goto(`/?e=${id}`)
  await expect(page.getByRole('heading', { name: 'Registro JC' })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Totes en salida').fill('12')
  await page.getByLabel('Jefe de cuadrilla').selectOption('Juan Pérez')
  await page.getByLabel('Precio (CLP)').fill('1500')
  await page.getByLabel('JH (personas en cuadrilla)').fill('8')
  await page.getByRole('button', { name: 'Guardar salida' }).click()
  await expect(page.getByRole('heading', { name: 'Registro guardado' })).toBeVisible()

  // Segunda lectura (nuevo escaneo): acopio
  await page.goto(`/?e=${id}`)
  await expect(page.getByRole('heading', { name: 'Registro en acopio' })).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Totes recibidos en acopio').fill('11')
  await page.getByRole('button', { name: 'Guardar llegada' }).click()
  await expect(page.getByRole('heading', { name: 'Registro completo' })).toBeVisible()

  // El servidor rechaza una tercera lectura
  const again = await request.post(`${API()}/api/movements`, {
    data: { labelId: id, type: 'acopio', cantidad: 1, at: new Date().toISOString() },
  })
  expect(again.status()).toBe(409)
})

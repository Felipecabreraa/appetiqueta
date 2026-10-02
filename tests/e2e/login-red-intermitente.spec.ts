import { expect, test } from '@playwright/test'
import { crearUsuario } from './helpers/api'

const RED = 'Sin conexión con el servidor.'
const C5XX = 'El servidor tuvo un problema. Intente más tarde.'

/** CA-13 (borde §6): la conexión se corta con la petición ya en vuelo, no antes de enviarla. */
test('CA-13 borde: el servidor cae a mitad del login (conexión reiniciada con la petición en vuelo)', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  let cortes = 0
  await page.route('**/api/auth/login', async (route) => {
    cortes++
    await new Promise((r) => setTimeout(r, 300))
    await route.abort('connectionreset')
  })
  await page.goto('/')
  await page.getByLabel('Usuario').fill(u.username)
  await page.getByLabel('Contraseña').fill(u.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  const alerta = page.getByRole('alert')
  await expect(alerta).toHaveText(RED)
  await expect(page.getByText(/failed to fetch|load failed|networkerror/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  expect(cortes).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('appetiquetado:auth:token'))).toBeNull()

  // Recuperación: vuelve la red y el mismo formulario entra sin recargar.
  await page.unroute('**/api/auth/login')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('button', { name: 'Entrar' })).toHaveCount(0)
})

test('CA-12 borde: 503 y luego recuperación; el mensaje de error se retira al entrar', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'db_unavailable' }) }),
  )
  await page.goto('/')
  await page.getByLabel('Usuario').fill(u.username)
  await page.getByLabel('Contraseña').fill(u.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toHaveText(C5XX)
  await page.unroute('**/api/auth/login')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('button', { name: 'Entrar' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

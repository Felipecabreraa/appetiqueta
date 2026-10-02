import { expect, test, type Page } from '@playwright/test'
import { crearUsuario } from './helpers/api'

const TXT = {
  c401: 'Usuario o contraseña incorrectos.',
  c5xx: 'El servidor tuvo un problema. Intente más tarde.',
  red: 'Sin conexión con el servidor.',
  c429: 'Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar.',
  otro4xx: 'No fue posible iniciar sesión.',
}

async function intentar(page: Page, usuario = 'alguien', clave = 'cualquiera-1') {
  await page.goto('/')
  await page.getByLabel('Usuario').fill(usuario)
  await page.getByLabel('Contraseña').fill(clave)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function sinSesion(page: Page) {
  expect(await page.evaluate(() => localStorage.getItem('appetiquetado:auth:token'))).toBeNull()
}

test('CA-11: usuario existente con clave errónea (401 real) muestra el texto exacto, sin sesión y con "Entrar" habilitado', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  await intentar(page, u.username, 'clave-equivocada-9')
  const alerta = page.getByRole('alert')
  await expect(alerta).toHaveText(TXT.c401)
  await sinSesion(page)
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  await expect(alerta).toBeInViewport()
})

for (const [status, cuerpo] of [
  [500, { ok: false, error: 'db' }],
  [502, { ok: false, error: 'bad_gateway' }],
  [503, { ok: false, error: 'db_not_configured' }],
  [503, { ok: false, error: 'db_unavailable' }],
] as const) {
  test(`CA-12: ${status} ${cuerpo.error} muestra el texto de problema del servidor`, async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(cuerpo) }),
    )
    await intentar(page)
    const alerta = page.getByRole('alert')
    await expect(alerta).toHaveText(TXT.c5xx)
    await expect(alerta).not.toContainText('Credenciales')
    await expect(alerta).not.toContainText('contraseña')
    await sinSesion(page)
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
    await expect(alerta).toBeInViewport()
  })
}

test('CA-13: error de red muestra "Sin conexión con el servidor." sin el mensaje técnico del navegador', async ({ page }) => {
  await page.route('**/api/auth/login', (route) => route.abort('failed'))
  await intentar(page)
  const alerta = page.getByRole('alert')
  await expect(alerta).toHaveText(TXT.red)
  await expect(page.getByText(/failed to fetch/i)).toHaveCount(0)
  await expect(page.getByText(/load failed|networkerror/i)).toHaveCount(0)
  await expect(alerta).toBeInViewport()
  await sinSesion(page)
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
})

test('CA-14: 429 mantiene el texto de demasiados intentos', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'rate_limited' }) }),
  )
  await intentar(page)
  const alerta = page.getByRole('alert')
  await expect(alerta).toHaveText(TXT.c429)
  await expect(alerta).toBeInViewport()
})

for (const status of [400, 403, 404]) {
  test(`P4: otro 4xx (${status}) muestra "No fue posible iniciar sesión." y no el texto de 5xx ni de credenciales`, async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'otro' }) }),
    )
    await intentar(page)
    const alerta = page.getByRole('alert')
    await expect(alerta).toHaveText(TXT.otro4xx)
    await expect(alerta).not.toContainText('servidor')
  })
}

test('Regresión: un login válido sigue funcionando tras cambiar los mensajes', async ({ page, request }) => {
  const u = await crearUsuario(request, 'admin')
  await page.goto('/')
  await page.getByLabel('Usuario').fill(u.username)
  await page.getByLabel('Contraseña').fill(u.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: /^Hola,/ })).toBeVisible()
})

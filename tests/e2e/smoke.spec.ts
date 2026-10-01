import { expect, test } from '@playwright/test'

/** @smoke = solo lectura: corre también contra entornos desplegados (E2E_REMOTE_URL). */
test('API responde health @smoke', async ({ request }) => {
  const res = await request.get(`${process.env.E2E_API_BASE}/api/health`)
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(body).toHaveProperty('env')
  // CA-06 guardián: al publicar, E2E_EXPECTED_ENV=staging|production confirma que el servicio corre en su ambiente.
  if (process.env.E2E_EXPECTED_ENV) expect(body.env).toBe(process.env.E2E_EXPECTED_ENV)
})

test('sin sesión se muestra el login @smoke', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible()
})

test('QR con código inexistente muestra la vista operativa de no encontrado @smoke', async ({ page }) => {
  await page.goto('/?e=ZZZZ2222ZZZZ')
  await expect(page.getByText('ZZZZ2222ZZZZ')).toBeVisible({ timeout: 15_000 })
})

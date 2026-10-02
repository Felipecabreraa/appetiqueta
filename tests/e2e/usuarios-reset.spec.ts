import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginAs } from './helpers/auth'
import { API, adminToken, crearUsuario, irAModulo } from './helpers/api'

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post(`${API()}/api/auth/login`, { data: { username, password } })
  return { status: res.status(), body: await res.json() }
}

async function idDe(request: APIRequestContext, username: string): Promise<number> {
  const res = await request.get(`${API()}/api/admin/users`, { headers: { Authorization: `Bearer ${await adminToken(request)}` } })
  return (await res.json()).users.find((u: { username: string }) => u.username === username).id
}

test('CA-01/CA-02: SuperAdmin restablece la contraseña desde Usuarios y cierra las sesiones del usuario', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  const antes = await login(request, u.username, u.password)
  expect(antes.status).toBe(200)

  await loginAs(page)
  await page.goto('/')
  await irAModulo(page, 'Usuarios')
  const fila = page.getByRole('row', { name: new RegExp(u.username) })
  await fila.getByRole('button', { name: 'Restablecer contraseña' }).click()

  await page.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaClave-2026')
  await page.getByLabel('Repetir nueva contraseña').fill('OtraClave-2026')
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page.getByText('Las contraseñas no coinciden', { exact: false })).toBeVisible()

  await page.getByLabel('Repetir nueva contraseña').fill('NuevaClave-2026')
  await page.getByRole('button', { name: 'Guardar contraseña' }).click()
  await expect(page.getByText(`Contraseña actualizada para ${u.username}`, { exact: false })).toBeVisible()

  expect((await login(request, u.username, u.password)).status).toBe(401)
  expect((await login(request, u.username, 'NuevaClave-2026')).status).toBe(200)
  const me = await request.get(`${API()}/api/auth/me`, { headers: { Authorization: `Bearer ${antes.body.token}` } })
  expect(me.status()).toBe(401)
})

test('CA-03/CA-04: validaciones y solo SuperAdmin puede restablecer', async ({ request }) => {
  const victima = await crearUsuario(request, 'operador')
  const id = await idDe(request, victima.username)
  const superToken = await adminToken(request)
  const reset = (token: string | null, userId: number, password: string) =>
    request.post(`${API()}/api/admin/users/${userId}/password`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      data: { password },
    })

  const corta = await reset(superToken, id, 'corta')
  expect(corta.status()).toBe(400)
  expect((await corta.json()).error).toBe('password_too_short')
  expect((await reset(superToken, 99999999, 'ClaveLarga-1')).status()).toBe(404)
  expect((await reset(null, id, 'ClaveLarga-1')).status()).toBe(401)

  for (const role of ['admin', 'operador'] as const) {
    const u = await crearUsuario(request, role)
    const t = (await login(request, u.username, u.password)).body.token
    expect((await reset(t, id, 'ClaveLarga-1')).status(), role).toBe(403)
  }
  // La contraseña original sigue vigente
  expect((await login(request, victima.username, victima.password)).status).toBe(200)
})

test('CA-02: al restablecer la propia contraseña, la sesión actual se mantiene', async ({ request }) => {
  const token = await adminToken(request)
  const me = await (await request.get(`${API()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()
  const res = await request.post(`${API()}/api/admin/users/${me.user.id}/password`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { password: process.env.E2E_PASS },
  })
  expect(res.status()).toBe(200)
  expect((await request.get(`${API()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200)
})

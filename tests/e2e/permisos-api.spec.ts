import { expect, test } from '@playwright/test'
import { adminToken, API, crearUsuario } from './helpers/api'

async function tokenDe(request: Parameters<typeof crearUsuario>[0], role: 'admin' | 'operador') {
  const u = await crearUsuario(request, role)
  const res = await request.post(`${API()}/api/auth/login`, { data: u })
  const body = await res.json()
  expect(body.ok).toBe(true)
  return body.token as string
}

test('CA-06: operador recibe 403 en maestros, usuarios y export', async ({ request }) => {
  const h = { Authorization: `Bearer ${await tokenDe(request, 'operador')}` }
  const prohibidos: Array<['get' | 'post', string, object?]> = [
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users', { username: 'x', fullName: 'x', password: 'x', role: 'operador' }],
    ['get', '/api/admin/masters'],
    ['post', '/api/master-data/import', { rows: [{ empresa: 'a', cc: 'b', especie: 'c', variedad: 'd', csg: 'e' }] }],
    ['get', '/api/reports/tracking-export'],
  ]
  for (const [metodo, ruta, data] of prohibidos) {
    const res = await request[metodo](`${API()}${ruta}`, { headers: h, ...(data ? { data } : {}) })
    expect(res.status(), `${metodo.toUpperCase()} ${ruta}`).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  }
})

test('CA-06: admin recibe 403 en maestros y usuarios pero puede exportar', async ({ request }) => {
  const h = { Authorization: `Bearer ${await tokenDe(request, 'admin')}` }
  expect((await request.get(`${API()}/api/admin/users`, { headers: h })).status()).toBe(403)
  expect((await request.get(`${API()}/api/admin/masters`, { headers: h })).status()).toBe(403)
  expect(
    (await request.post(`${API()}/api/master-data/import`, { headers: h, data: { rows: [{}] } })).status(),
  ).toBe(403)
  expect((await request.get(`${API()}/api/reports/tracking-export`, { headers: h })).status()).toBe(200)
})

test('CA-06: sin token las rutas protegidas responden 401 y el superadmin accede', async ({ request }) => {
  expect((await request.get(`${API()}/api/reports/tracking-export`)).status()).toBe(401)
  expect((await request.get(`${API()}/api/admin/users`)).status()).toBe(401)
  const h = { Authorization: `Bearer ${await adminToken(request)}` }
  expect((await request.get(`${API()}/api/admin/users`, { headers: h })).status()).toBe(200)
  expect((await request.get(`${API()}/api/admin/masters`, { headers: h })).status()).toBe(200)
})

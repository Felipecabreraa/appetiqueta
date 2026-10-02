import { expect, test, type APIRequestContext } from '@playwright/test'
import { adminToken, API, crearUsuario, loginSuper, loginUsuario, sufijo } from './helpers/api'
import { crearLos7, leerBundle, postMaestro, RUTA, TABLAS } from './helpers/maestros'

type Llamada = ['get' | 'post', string, object?]

/** Las 9 rutas de maestros (CA-07). Payloads solo-formato: el 403/401 se resuelve antes de validar. */
const RUTAS_MAESTROS: Llamada[] = [
  ['get', '/api/admin/masters'],
  ['post', '/api/admin/seasons', { code: 'X', name: 'X' }],
  ['post', '/api/admin/companies', { code: 'X', name: 'X' }],
  ['post', '/api/admin/species', { code: 'X', name: 'X' }],
  ['post', '/api/admin/csg', { code: 'X', name: 'X' }],
  ['post', '/api/admin/jc-foremen', { code: 'X', name: 'X' }],
  ['post', '/api/admin/varieties', { code: 'X', name: 'X', speciesId: 1 }],
  ['post', '/api/admin/relations', { seasonId: 1, companyId: 1, centerCode: 'X', speciesId: 1, varietyId: 1, csgId: 1 }],
  ['post', '/api/master-data/import', { rows: [{ empresa: 'a', cc: 'b', especie: 'c', variedad: 'd', csg: 'e' }] }],
]

/** Las 3 rutas de Usuarios (CA-09). */
const RUTAS_USUARIOS: Llamada[] = [
  ['get', '/api/admin/users'],
  ['post', '/api/admin/users', { username: 'x_no_debe_existir', fullName: 'x', password: 'ClaveLarga-1', role: 'operador' }],
  ['post', '/api/admin/users/1/password', { password: 'ClaveLarga-1' }],
]

async function llamar(request: APIRequestContext, [metodo, ruta, data]: Llamada, token?: string) {
  return request[metodo](`${API()}${ruta}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(data ? { data } : {}),
  })
}

test('CA-12: operador recibe 403 forbidden en las 9 rutas de maestros, en las 3 de usuarios y en el export', async ({ request }) => {
  const { token } = await loginUsuario(request, 'operador')
  for (const llamada of [...RUTAS_MAESTROS, ...RUTAS_USUARIOS, ['get', '/api/reports/tracking-export'] as Llamada]) {
    const res = await llamar(request, llamada, token)
    expect(res.status(), `${llamada[0].toUpperCase()} ${llamada[1]}`).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  }
})

test('CA-07/CA-09: admin accede a maestros (200) y recibe 403 en Usuarios, y sí exporta', async ({ request }) => {
  const admin = await loginUsuario(request, 'admin')
  const h = { Authorization: `Bearer ${admin.token}` }

  // CA-07: lectura y las 9 rutas con payload válido (alta, edición e inactivar), todo 200 { ok: true }
  const masters = await request.get(`${API()}/api/admin/masters`, { headers: h })
  expect(masters.status()).toBe(200)
  const cuerpo = await masters.json()
  expect(cuerpo.ok).toBe(true)
  for (const t of TABLAS) expect(Array.isArray(cuerpo[t]), `GET devuelve ${t}`).toBe(true)

  const ctx = await crearLos7(request, admin.token) // 7 altas: todas 200 ok
  const b = await leerBundle(request, admin.token)
  const jc = b.jcForemen.find((r) => r.code === ctx.claves.jcForemen)!
  const inactivar = await postMaestro(request, admin.token, RUTA.jcForemen, { id: jc.id, code: jc.code, name: jc.name, isActive: 0 })
  expect(inactivar.status).toBe(200)
  expect(inactivar.body.ok).toBe(true)

  const sfx = sufijo()
  const imp = await request.post(`${API()}/api/master-data/import`, {
    headers: h,
    data: {
      season: { code: `E2E-PERM-${sfx}`, name: `Temporada perm ${sfx}`, isCurrent: false },
      rows: [{ empresa: `EMPP_${sfx}`, cc: `CCP_${sfx}`, especie: `ESPP_${sfx}`, variedad: `VARP_${sfx}`, csg: `CSGP_${sfx}` }],
    },
  })
  expect(imp.status()).toBe(200)
  expect((await imp.json()).ok).toBe(true)

  // CA-09: Usuarios sigue cerrado
  const objetivo = await crearUsuario(request, 'operador')
  const superToken = await adminToken(request)
  const lista = await (await request.get(`${API()}/api/admin/users`, { headers: { Authorization: `Bearer ${superToken}` } })).json()
  const idObjetivo = lista.users.find((u: { username: string }) => u.username === objetivo.username).id
  const prohibidas: Llamada[] = [
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users', { username: `x_${sfx.toLowerCase()}`, fullName: 'x', password: 'ClaveLarga-1', role: 'superadmin' }],
    ['post', `/api/admin/users/${idObjetivo}/password`, { password: 'ClaveHackeada-1' }],
  ]
  for (const llamada of prohibidas) {
    const res = await llamar(request, llamada, admin.token)
    expect(res.status(), `${llamada[0].toUpperCase()} ${llamada[1]}`).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  }
  const despues = await (await request.get(`${API()}/api/admin/users`, { headers: { Authorization: `Bearer ${superToken}` } })).json()
  expect(despues.users.some((u: { username: string }) => u.username === `x_${sfx.toLowerCase()}`)).toBe(false)
  const relogin = await request.post(`${API()}/api/auth/login`, { data: { username: objetivo.username, password: objetivo.password } })
  expect(relogin.status()).toBe(200)

  expect((await request.get(`${API()}/api/reports/tracking-export`, { headers: h })).status()).toBe(200)
})

test('CA-13: sin token las rutas protegidas responden 401', async ({ request }) => {
  const sinToken: Llamada[] = [
    ['get', '/api/admin/masters'],
    ['post', '/api/admin/csg', { code: 'X', name: 'X' }],
    ['post', '/api/master-data/import', { rows: [{ empresa: 'a', cc: 'b', especie: 'c', variedad: 'd', csg: 'e' }] }],
    ['get', '/api/reports/tracking-export'],
    ['get', '/api/admin/users'],
  ]
  for (const llamada of sinToken) {
    expect((await llamar(request, llamada)).status(), `${llamada[0].toUpperCase()} ${llamada[1]}`).toBe(401)
  }
})

test('CA-14: el superadmin accede a las rutas de maestros y de usuarios (200)', async ({ request }) => {
  const s = await loginSuper(request)
  const h = { Authorization: `Bearer ${s.token}` }
  expect((await request.get(`${API()}/api/admin/users`, { headers: h })).status()).toBe(200)
  const masters = await request.get(`${API()}/api/admin/masters`, { headers: h })
  expect(masters.status()).toBe(200)
  expect((await masters.json()).ok).toBe(true)
  await crearLos7(request, s.token)
  const sfx = sufijo()
  const imp = await request.post(`${API()}/api/master-data/import`, {
    headers: h,
    data: {
      season: { code: `E2E-SUP-${sfx}`, name: `Temporada sup ${sfx}`, isCurrent: false },
      rows: [{ empresa: `EMPS_${sfx}`, cc: `CCS_${sfx}`, especie: `ESPS_${sfx}`, variedad: `VARS_${sfx}`, csg: `CSGS_${sfx}` }],
    },
  })
  expect(imp.status()).toBe(200)
  // Usuarios: alta y restablecimiento de contraseña (200)
  const nuevo = await crearUsuario(request, 'operador')
  const lista = await (await request.get(`${API()}/api/admin/users`, { headers: h })).json()
  const id = lista.users.find((u: { username: string }) => u.username === nuevo.username).id
  const reset = await request.post(`${API()}/api/admin/users/${id}/password`, { headers: h, data: { password: 'ClaveLarga-2026' } })
  expect(reset.status()).toBe(200)
})

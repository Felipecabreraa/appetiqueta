import { expect, test, type APIRequestContext } from '@playwright/test'
import { API, loginSuper, loginUsuario, sufijo, type SesionE2E } from './helpers/api'
import { conectarBd } from './helpers/db'
import {
  auth,
  buscar,
  crearLos7,
  leerBundle,
  payloadEditado,
  payloadIdentico,
  pausa,
  postMaestro,
  RUTA,
  TABLAS,
  type Registro,
} from './helpers/maestros'

const ms = (iso?: string) => new Date(iso as string).getTime()

async function actores(request: APIRequestContext): Promise<{ A: SesionE2E; S: SesionE2E }> {
  return { A: await loginUsuario(request, 'admin', `Admin Aud ${sufijo()}`), S: await loginSuper(request) }
}

async function importar(request: APIRequestContext, token: string, season: { code: string; name: string }, rows: object[]) {
  const res = await request.post(`${API()}/api/master-data/import`, {
    headers: auth(token),
    data: { season: { ...season, isCurrent: false }, rows },
  })
  return { status: res.status(), body: await res.json() }
}

test('CA-07: admin recibe 200 { ok: true } en las 9 rutas (alta, edición e inactivar) y el GET trae los 7 arreglos', async ({ request }) => {
  const { A } = await actores(request)
  const ctx = await crearLos7(request, A.token) // 7 altas con 200 y ok
  const b = await leerBundle(request, A.token)
  for (const t of TABLAS) {
    const reg = b[t].find((r) => (t === 'relations' ? r.center_code : r.code) === ctx.claves[t])!
    // edición con id; la de jefes de cuadrilla además inactiva
    const payload = { ...(payloadEditado(t, reg, ctx.sfx) as object), ...(t === 'jcForemen' ? { isActive: 0 } : {}) }
    const r = await postMaestro(request, A.token, RUTA[t], payload)
    expect(r.status, `edición ${t}`).toBe(200)
    expect(r.body.ok, `edición ${t}`).toBe(true)
  }
  const get = await request.get(`${API()}/api/admin/masters`, { headers: auth(A.token) })
  expect(get.status()).toBe(200)
  const cuerpo = await get.json()
  expect(cuerpo.ok).toBe(true)
  for (const t of TABLAS) expect(Array.isArray(cuerpo[t])).toBe(true)

  const imp = await importar(request, A.token, { code: `E2E-C07-${ctx.sfx}`, name: `Temp ${ctx.sfx}` }, [
    { empresa: `EMPI_${ctx.sfx}`, cc: `CCI_${ctx.sfx}`, especie: `ESPI_${ctx.sfx}`, variedad: `VARI_${ctx.sfx}`, csg: `CSGI_${ctx.sfx}` },
  ])
  expect(imp.status).toBe(200)
  expect(imp.body.ok).toBe(true)
})

test('CA-08: validaciones iguales para admin (invalid_payload y rows_required)', async ({ request }) => {
  const { A } = await actores(request)
  const vacio = await postMaestro(request, A.token, RUTA.companies, {})
  expect(vacio.status).toBe(400)
  expect(vacio.body.error).toBe('invalid_payload')
  const sinFilas = await importar(request, A.token, { code: 'X', name: 'X' }, [])
  expect(sinFilas.status).toBe(400)
  expect(sinFilas.body.error).toBe('rows_required')
})

test('CA-17: el alta manual registra creador = actualizador = admin, con fechas del servidor, en las 7 tablas', async ({ request }) => {
  const { A } = await actores(request)
  const antes = Date.now()
  const ctx = await crearLos7(request, A.token)
  const b = await leerBundle(request, A.token)
  for (const t of TABLAS) {
    const r = b[t].find((x) => (t === 'relations' ? x.center_code : x.code) === ctx.claves[t])!
    expect(r.createdBy?.id, `${t}.createdBy`).toBe(A.user.id)
    expect(r.updatedBy?.id, `${t}.updatedBy`).toBe(A.user.id)
    expect(r.createdBy?.name, `${t}.createdBy.name`).toBe(A.fullName)
    expect(r.createdAt, `${t}.createdAt`).toBeTruthy()
    expect(r.createdAt, `${t}: created_at = updated_at`).toBe(r.updatedAt)
    expect(Math.abs(ms(r.createdAt) - antes), `${t}: fecha cercana a la hora del servidor`).toBeLessThan(60_000)
  }
})

test('CA-18: la edición registra al editor y no toca la creación, en las 7 tablas', async ({ request }) => {
  const { A, S } = await actores(request)
  const ctx = await crearLos7(request, S.token)
  const antes = await leerBundle(request, S.token)
  await pausa(80)
  const t1 = Date.now()
  for (const t of TABLAS) {
    const r0 = antes[t].find((x) => (t === 'relations' ? x.center_code : x.code) === ctx.claves[t])!
    const res = await postMaestro(request, A.token, RUTA[t], payloadEditado(t, r0, ctx.sfx))
    expect(res.status, `edición ${t}`).toBe(200)
  }
  const despues = await leerBundle(request, S.token)
  for (const t of TABLAS) {
    const r0 = antes[t].find((x) => (t === 'relations' ? x.center_code : x.code) === ctx.claves[t])!
    const r1 = despues[t].find((x) => x.id === r0.id)!
    expect(r1.updatedBy?.id, `${t}.updatedBy`).toBe(A.user.id)
    expect(ms(r1.updatedAt), `${t}.updatedAt`).toBeGreaterThanOrEqual(t1 - 1000)
    expect(r1.createdBy?.id, `${t}.createdBy intacto`).toBe(S.user.id)
    expect(r1.createdAt, `${t}.createdAt intacto`).toBe(r0.createdAt)
  }
})

test('CA-19: activar o desactivar cuenta como edición', async ({ request }) => {
  const { A, S } = await actores(request)
  const sfx = sufijo()
  const code = `JCA${sfx}`
  await postMaestro(request, S.token, RUTA.jcForemen, { code, name: `Jefe ${sfx}` })
  const r0 = await buscar(request, S.token, 'jcForemen', code)
  await pausa(80)
  const off = await postMaestro(request, A.token, RUTA.jcForemen, { id: r0.id, code, name: r0.name, isActive: 0 })
  expect(off.status).toBe(200)
  const r1 = await buscar(request, S.token, 'jcForemen', code)
  expect(r1.is_active).toBe(0)
  expect(r1.updatedBy?.id).toBe(A.user.id)
  expect(ms(r1.updatedAt)).toBeGreaterThan(ms(r0.updatedAt))
  expect(r1.createdBy?.id).toBe(S.user.id)
  await pausa(80)
  await postMaestro(request, S.token, RUTA.jcForemen, { id: r0.id, code, name: r0.name, isActive: 1 })
  const r2 = await buscar(request, S.token, 'jcForemen', code)
  expect(r2.updatedBy?.id).toBe(S.user.id)
  expect(r2.createdBy?.id).toBe(S.user.id)
})

test('CA-20: el autor sale del token; autores y fechas del cuerpo se ignoran', async ({ request }) => {
  const { A, S } = await actores(request)
  const code = `EMPX${sufijo()}`
  const res = await postMaestro(request, A.token, RUTA.companies, {
    code,
    name: `Empresa ${code}`,
    createdBy: S.user.id,
    updatedBy: S.user.id,
    created_by: S.user.id,
    updated_by: S.user.id,
    createdAt: '2000-01-01',
    updatedAt: '2000-01-01',
    created_at: '2000-01-01',
    updated_at: '2000-01-01',
  })
  expect(res.status).toBe(200)
  const r = await buscar(request, A.token, 'companies', code)
  expect(r.createdBy?.id).toBe(A.user.id)
  expect(r.updatedBy?.id).toBe(A.user.id)
  expect(new Date(r.createdAt as string).getUTCFullYear()).toBe(new Date().getUTCFullYear())
  expect(new Date(r.updatedAt as string).getUTCFullYear()).toBe(new Date().getUTCFullYear())
})

test('CA-25: la importación no marca autor en las filas (todo NULL) y deja la corrida con imported_by = admin', async ({ request }) => {
  const { A } = await actores(request)
  const sfx = sufijo()
  const cc = `CCX_${sfx}`
  const temporada = `E2E-C25-${sfx}`
  const imp = await importar(request, A.token, { code: temporada, name: `Temp ${sfx}` }, [
    { empresa: `EMPX_${sfx}`, cc, especie: `ESPX_${sfx}`, variedad: `VARX_${sfx}`, csg: `CSGX_${sfx}` },
  ])
  expect(imp.status).toBe(200)
  const b = await leerBundle(request, A.token)
  const nuevos: Array<[string, Registro | undefined]> = [
    ['companies', b.companies.find((r) => r.name === `EMPX_${sfx}`)],
    ['species', b.species.find((r) => r.name === `ESPX_${sfx}`)],
    ['varieties', b.varieties.find((r) => r.name === `VARX_${sfx}`)],
    ['csg', b.csg.find((r) => r.name === `CSGX_${sfx}`)],
    ['relations', b.relations.find((r) => r.center_code === cc)],
  ]
  for (const [t, r] of nuevos) {
    expect(r, `${t} creado por la importación`).toBeTruthy()
    expect(r!.createdBy, `${t}.createdBy`).toBeNull()
    expect(r!.updatedBy, `${t}.updatedBy`).toBeNull()
    expect(r!.createdAt, `${t}.createdAt presente`).toBeTruthy()
  }
  const conn = await conectarBd()
  try {
    const [rows] = await conn.execute('SELECT imported_by FROM master_import_runs WHERE season_id = ?', [imp.body.seasonId])
    expect((rows as Array<{ imported_by: number }>).map((r) => r.imported_by)).toEqual([A.user.id])
  } finally {
    await conn.end()
  }
})

test('CA-26: importación sobre una fila editada a mano (a: idéntica no cambia nada; b: cambia y limpia updated_by)', async ({ request }) => {
  const { A, S } = await actores(request)
  const sfx = sufijo()
  const code = `CSGIMP_${sfx}` // code = name, mayúsculas y sin espacios: coincide con toCode()
  const filas = [{ empresa: `EMPI_${sfx}`, cc: `CCI_${sfx}`, especie: `ESPI_${sfx}`, variedad: `VARI_${sfx}`, csg: code }]
  const temporada = { code: `E2E-C26-${sfx}`, name: `Temp C26 ${sfx}` }

  // (a) IMP-1: S lo crea inactivo; A lo deja exactamente como lo dejará la importación (activo, mismo code y name)
  expect((await postMaestro(request, S.token, RUTA.csg, { code, name: code, isActive: 0 })).status).toBe(200)
  const r0 = await buscar(request, S.token, 'csg', code)
  await pausa(80)
  expect((await postMaestro(request, A.token, RUTA.csg, { id: r0.id, code, name: code, isActive: 1 })).status).toBe(200)
  const r1 = await buscar(request, S.token, 'csg', code)
  expect(r1.updatedBy?.id).toBe(A.user.id)
  await pausa(80)
  expect((await importar(request, S.token, temporada, filas)).status).toBe(200)
  const r2 = await buscar(request, S.token, 'csg', code)
  expect(r2.updatedBy?.id, 'importación idéntica: updatedBy sigue siendo A').toBe(A.user.id)
  expect(r2.updatedAt, 'importación idéntica: updatedAt no cambia').toBe(r1.updatedAt)

  // (b) A lo desactiva; la importación lo reactiva (cambia un dato) -> updated_by NULL
  await pausa(80)
  expect((await postMaestro(request, A.token, RUTA.csg, { id: r0.id, code, name: code, isActive: 0 })).status).toBe(200)
  const r3 = await buscar(request, S.token, 'csg', code)
  expect(r3.updatedBy?.id).toBe(A.user.id)
  await pausa(80)
  expect((await importar(request, S.token, temporada, filas)).status).toBe(200)
  const r4 = await buscar(request, S.token, 'csg', code)
  expect(r4.is_active).toBe(1)
  expect(r4.updatedBy, 'reactivada por la importación: sin autor').toBeNull()
  expect(ms(r4.updatedAt)).toBeGreaterThan(ms(r3.updatedAt))
  expect(r4.createdBy?.id).toBe(S.user.id)
})

test('CA-28: guardar sin cambios no audita; cambiar solo mayúsculas sí', async ({ request }) => {
  const { A, S } = await actores(request)
  const ctx = await crearLos7(request, S.token) // la temporada se crea con fechas, isCurrent = 0
  const antes = await leerBundle(request, S.token)
  await pausa(80)
  for (const t of ['csg', 'seasons', 'relations'] as const) {
    const r0 = antes[t].find((x) => (t === 'relations' ? x.center_code : x.code) === ctx.claves[t])!
    // Se reenvía tal como lo devuelve el GET (la temporada con startsOn/endsOn en YYYY-MM-DD)
    const res = await postMaestro(request, A.token, RUTA[t], payloadIdentico(t, r0))
    expect(res.status, `reenvío ${t}`).toBe(200)
    const r1 = (await leerBundle(request, S.token))[t].find((x) => x.id === r0.id)!
    expect(r1.updatedBy?.id, `${t}: updatedBy sigue siendo S`).toBe(S.user.id)
    expect(r1.updatedAt, `${t}: updatedAt igual`).toBe(r0.updatedAt)
    expect(r1.createdBy?.id).toBe(S.user.id)
    expect(r1.createdAt).toBe(r0.createdAt)
  }
  expect(String(antes.seasons.find((s) => s.code === ctx.claves.seasons)!.starts_on)).toBe('2030-01-01')

  // Solo mayúsculas/minúsculas: cuenta como modificación
  const code = `CSGCAS${ctx.sfx}`
  await postMaestro(request, S.token, RUTA.csg, { code, name: `csg norte ${ctx.sfx}` })
  const c0 = await buscar(request, S.token, 'csg', code)
  await pausa(80)
  const res = await postMaestro(request, A.token, RUTA.csg, { id: c0.id, code, name: `CSG NORTE ${ctx.sfx}` })
  expect(res.status).toBe(200)
  const c1 = await buscar(request, S.token, 'csg', code)
  expect(c1.updatedBy?.id).toBe(A.user.id)
  expect(ms(c1.updatedAt)).toBeGreaterThan(ms(c0.updatedAt))
})

test('CA-29 (P3): marcar X como actual atribuye a Y (la actual anterior) al admin; las demás no cambian', async ({ request }) => {
  const { A, S } = await actores(request)
  const inicial = await leerBundle(request, S.token)
  const Y = inicial.seasons.find((s) => s.is_current)!
  expect(Y, 'debe haber una temporada actual').toBeTruthy()
  try {
    const sfx = sufijo()
    const xCode = `TX${sfx}`
    const dx = { code: xCode, name: `Temporada X ${sfx}`, startsOn: '2031-01-01', endsOn: '2031-12-31', isCurrent: false }
    expect((await postMaestro(request, S.token, RUTA.seasons, dx)).status).toBe(200)
    const snap = await leerBundle(request, S.token)
    const X = snap.seasons.find((s) => s.code === xCode)!
    const otras = snap.seasons.filter((s) => s.id !== X.id && s.id !== Y.id)
    const Y0 = snap.seasons.find((s) => s.id === Y.id)!
    await pausa(80)

    const res = await postMaestro(request, A.token, RUTA.seasons, { ...dx, id: X.id, isCurrent: true })
    expect(res.status).toBe(200)
    const tras = await leerBundle(request, S.token)
    const Y1 = tras.seasons.find((s) => s.id === Y.id)!
    expect(Y1.is_current).toBeFalsy()
    expect(Y1.updatedBy?.id, 'Y atribuida a A').toBe(A.user.id)
    expect(ms(Y1.updatedAt)).toBeGreaterThan(ms(Y0.updatedAt))
    expect(Y1.createdBy?.id ?? null).toBe(Y0.createdBy?.id ?? null)
    expect(Y1.createdAt).toBe(Y0.createdAt)
    for (const o of otras) {
      const o1 = tras.seasons.find((s) => s.id === o.id)!
      expect(o1.updatedBy?.id ?? null, `${o.code}: updatedBy`).toBe(o.updatedBy?.id ?? null)
      expect(o1.updatedAt, `${o.code}: updatedAt`).toBe(o.updatedAt)
    }

    // Guardar de nuevo X como actual, sin otros cambios: ninguna temporada cambia
    const X1 = tras.seasons.find((s) => s.id === X.id)!
    await pausa(80)
    expect((await postMaestro(request, A.token, RUTA.seasons, { ...dx, id: X.id, isCurrent: true })).status).toBe(200)
    const final = await leerBundle(request, S.token)
    for (const s of tras.seasons) {
      const s2 = final.seasons.find((q) => q.id === s.id)!
      expect(s2.updatedBy?.id ?? null, `${s.code}: updatedBy sin cambio`).toBe(s.updatedBy?.id ?? null)
      expect(s2.updatedAt, `${s.code}: updatedAt sin cambio`).toBe(s.updatedAt)
    }
    expect(final.seasons.find((s) => s.id === X1.id)!.is_current).toBeTruthy()
  } finally {
    // MEN-8: restaurar Y con el payload completo leído al inicio (mismas fechas y nombre)
    const iso = (v?: string | null) => (v ? String(v).slice(0, 10) : '')
    await postMaestro(request, S.token, RUTA.seasons, {
      id: Y.id,
      code: Y.code,
      name: Y.name,
      startsOn: iso(Y.starts_on),
      endsOn: iso(Y.ends_on),
      isCurrent: true,
      isActive: Boolean(Y.is_active),
    })
  }
})

test('D5: una fecha de temporada inválida responde 400 invalid_payload y no crea nada', async ({ request }) => {
  const { A } = await actores(request)
  const code = `TD5${sufijo()}`
  for (const startsOn of ['01-11-2025', 'mañana', '2025/11/01']) {
    const res = await postMaestro(request, A.token, RUTA.seasons, { code, name: 'Fecha mala', startsOn })
    expect(res.status, `startsOn=${startsOn}`).toBe(400)
    expect(res.body.error).toBe('invalid_payload')
  }
  const res = await postMaestro(request, A.token, RUTA.seasons, { code, name: 'Fecha mala', endsOn: '31-12-2025' })
  expect(res.status).toBe(400)
  expect((await leerBundle(request, A.token)).seasons.some((s) => s.code === code)).toBe(false)
})

import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginSuper, loginUsuario, sufijo, type SesionE2E } from './helpers/api'
import { buscar, crearLos7, leerBundle, postMaestro, pausa, RUTA, type Tabla } from './helpers/maestros'

const ms = (iso?: string) => new Date(iso as string).getTime()

async function actores(request: APIRequestContext): Promise<{ A: SesionE2E; S: SesionE2E }> {
  return { A: await loginUsuario(request, 'admin', `Admin Bor ${sufijo()}`), S: await loginSuper(request) }
}

// Decisión del usuario (fase 2): textos más largos que la columna se recortan y se guardan (sin 500).
const LIMITES: Array<{ t: Tabla; ruta: string; code: number; name: number }> = [
  { t: 'seasons', ruta: RUTA.seasons, code: 30, name: 120 },
  { t: 'companies', ruta: RUTA.companies, code: 60, name: 180 },
  { t: 'species', ruta: RUTA.species, code: 60, name: 180 },
  { t: 'csg', ruta: RUTA.csg, code: 60, name: 180 },
  { t: 'jcForemen', ruta: RUTA.jcForemen, code: 60, name: 180 },
]

for (const { t, ruta, code, name } of LIMITES) {
  test(`Recorte: ${t} guarda code/name largos recortados al largo exacto (${code}/${name}), sin 500`, async ({ request }) => {
    const { A, S } = await actores(request)
    const sfx = sufijo()
    const codeLargo = `L${sfx}`.padEnd(code + 40, 'Z')
    const nameLargo = `N${sfx}`.padEnd(name + 70, 'y')
    const extra = t === 'seasons' ? { startsOn: '2032-01-01', endsOn: '2032-12-31', isCurrent: false } : {}
    const res = await postMaestro(request, A.token, ruta, { code: codeLargo, name: nameLargo, ...extra })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.ok).toBe(true)
    const reg = await buscar(request, S.token, t, codeLargo.slice(0, code))
    expect(reg.code).toHaveLength(code)
    expect(reg.name).toHaveLength(name)
    expect(reg.name).toBe(nameLargo.slice(0, name))
    expect(reg.createdBy?.id).toBe(A.user.id)

    // Reenviar el mismo texto largo = sin cambios (P4 compara el valor recortado): no audita.
    await pausa(80)
    const igual = await postMaestro(request, S.token, ruta, { id: reg.id, code: codeLargo, name: nameLargo, ...extra })
    expect(igual.status).toBe(200)
    const tras = await buscar(request, S.token, t, codeLargo.slice(0, code))
    expect(tras.updatedBy?.id).toBe(A.user.id)
    expect(tras.updatedAt).toBe(reg.updatedAt)
  })
}

test('Recorte: variedades y relaciones (centerCode 80 / centerName 180) recortan sin 500', async ({ request }) => {
  const { A, S } = await actores(request)
  const ctx = await crearLos7(request, S.token)
  const sfx = sufijo()
  const vCode = `V${sfx}`.padEnd(100, 'Z')
  const vName = `N${sfx}`.padEnd(250, 'y')
  const v = await postMaestro(request, A.token, RUTA.varieties, { code: vCode, name: vName, speciesId: ctx.ids.species })
  expect(v.status, JSON.stringify(v.body)).toBe(200)
  const vReg = await buscar(request, S.token, 'varieties', vCode.slice(0, 60))
  expect(vReg.code).toHaveLength(60)
  expect(vReg.name).toHaveLength(180)

  const cc = `C${sfx}`.padEnd(130, 'Q')
  const r = await postMaestro(request, A.token, RUTA.relations, {
    seasonId: ctx.ids.seasons,
    companyId: ctx.ids.companies,
    centerCode: cc,
    centerName: `M${sfx}`.padEnd(260, 'm'),
    speciesId: ctx.ids.species,
    varietyId: ctx.ids.varieties,
    csgId: ctx.ids.csg,
  })
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  const rReg = await buscar(request, S.token, 'relations', cc.slice(0, 80))
  expect(rReg.center_code).toHaveLength(80)
  expect(rReg.center_name).toHaveLength(180)
})

test('D5: fechas de temporada inválidas dan 400 invalid_payload; ISO con hora se normaliza a YYYY-MM-DD', async ({ request }) => {
  const { A, S } = await actores(request)
  const sfx = sufijo()
  for (const startsOn of ['2030-13-45', '2030-02-30', '30/01/2030', 'mañana', 20300101]) {
    const res = await postMaestro(request, A.token, RUTA.seasons, { code: `D5${sfx}`, name: 'Fecha mala', startsOn })
    expect(res.status, `startsOn=${String(startsOn)}`).toBe(400)
    expect(res.body.error).toBe('invalid_payload')
  }
  const fin = await postMaestro(request, A.token, RUTA.seasons, { code: `D5${sfx}`, name: 'Fin malo', endsOn: '2030-00-10' })
  expect(fin.status).toBe(400)
  expect(fin.body.error).toBe('invalid_payload')
  expect((await leerBundle(request, S.token)).seasons.find((s) => s.code === `D5${sfx}`)).toBeUndefined()

  const ok = await postMaestro(request, A.token, RUTA.seasons, {
    code: `D5${sfx}`,
    name: 'Fecha buena',
    startsOn: '2033-03-04T00:00:00.000Z',
    endsOn: '',
  })
  expect(ok.status).toBe(200)
  const reg = await buscar(request, S.token, 'seasons', `D5${sfx}`)
  expect(String(reg.starts_on).slice(0, 10)).toBe('2033-03-04')
  expect(reg.ends_on ?? null).toBeNull()
})

test('Concurrencia: admin y superadmin editan el mismo registro a la vez; gana el último y updated_by coincide con sus datos', async ({ request }) => {
  const { A, S } = await actores(request)
  const code = `CONC${sufijo()}`
  await postMaestro(request, S.token, RUTA.csg, { code, name: 'base' })
  const base = await buscar(request, S.token, 'csg', code)
  const nombres = { A: 'edita-admin', S: 'edita-super' }
  for (let ronda = 0; ronda < 8; ronda++) {
    await pausa(30)
    const [ra, rs] = await Promise.all([
      postMaestro(request, A.token, RUTA.csg, { id: base.id, code, name: `${nombres.A}-${ronda}` }),
      postMaestro(request, S.token, RUTA.csg, { id: base.id, code, name: `${nombres.S}-${ronda}` }),
    ])
    expect([ra.status, rs.status], `ronda ${ronda}: sin 500`).toEqual([200, 200])
    const fin = await buscar(request, S.token, 'csg', code)
    const esDeA = fin.name === `${nombres.A}-${ronda}`
    const esDeS = fin.name === `${nombres.S}-${ronda}`
    expect(esDeA || esDeS, `ronda ${ronda}: el nombre final es de uno de los dos`).toBe(true)
    expect(fin.updatedBy?.id, `ronda ${ronda}: updated_by del que dejó los datos`).toBe(esDeA ? A.user.id : S.user.id)
    expect(fin.createdBy?.id).toBe(S.user.id)
    expect(fin.createdAt).toBe(base.createdAt)
  }
})

test('Concurrencia: guardar sin cambios en paralelo (admin y superadmin) no audita ni da error', async ({ request }) => {
  const { A, S } = await actores(request)
  const code = `PAR${sufijo()}`
  await postMaestro(request, S.token, RUTA.csg, { code, name: 'estable' })
  const r0 = await buscar(request, S.token, 'csg', code)
  await pausa(80)
  const resultados = await Promise.all(
    [A, S, A, S, A, S].map((u) => postMaestro(request, u.token, RUTA.csg, { id: r0.id, code, name: 'estable', isActive: true })),
  )
  for (const r of resultados) expect(r.status).toBe(200)
  const r1 = await buscar(request, S.token, 'csg', code)
  expect(r1.updatedBy?.id).toBe(S.user.id)
  expect(r1.updatedAt).toBe(r0.updatedAt)
})

test('Concurrencia: dos ediciones idénticas en paralelo dan 200 y un único autor coherente', async ({ request }) => {
  const { A, S } = await actores(request)
  const code = `IDE${sufijo()}`
  await postMaestro(request, S.token, RUTA.csg, { code, name: 'antes' })
  const r0 = await buscar(request, S.token, 'csg', code)
  await pausa(80)
  const [ra, rs] = await Promise.all([
    postMaestro(request, A.token, RUTA.csg, { id: r0.id, code, name: 'despues' }),
    postMaestro(request, S.token, RUTA.csg, { id: r0.id, code, name: 'despues' }),
  ])
  expect([ra.status, rs.status]).toEqual([200, 200])
  const r1 = await buscar(request, S.token, 'csg', code)
  expect(r1.name).toBe('despues')
  expect([A.user.id, S.user.id]).toContain(r1.updatedBy?.id)
  expect(ms(r1.updatedAt)).toBeGreaterThan(ms(r0.updatedAt))
})

test('CA-16 (API): token de admin emitido antes sirve de inmediato en maestros (alta atribuida al admin)', async ({ request }) => {
  const { A, S } = await actores(request)
  const viejo = A.token
  const res1 = await request.get(`${process.env.E2E_API_BASE}/api/admin/masters`, { headers: { Authorization: `Bearer ${viejo}` } })
  expect(res1.status()).toBe(200)
  const code = `S16${sufijo()}`
  expect((await postMaestro(request, viejo, RUTA.csg, { code, name: 'con token previo' })).status).toBe(200)
  expect((await buscar(request, S.token, 'csg', code)).createdBy?.id).toBe(A.user.id)
})

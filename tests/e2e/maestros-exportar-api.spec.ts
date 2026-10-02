import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { API, loginUsuario, sufijo } from './helpers/api'
import { loginAs } from './helpers/auth'
import { auth, leerBundle, payloadIdentico, postMaestro, RUTA } from './helpers/maestros'
import { filaPorId } from './helpers/fotoMaestros'
import {
  conHojaPrincipal,
  crearTemporadaPropia,
  crearVariedad,
  esperarIdentica,
  exportablesDe,
  exportarTemporada,
  fijarRelacionActiva,
  filasDeHoja,
  foto,
  idsSemilla,
  importar,
  parsearConImportador,
  pausaEscritura,
  SEED_EMPRESA,
  temporadaDeLibro,
} from './helpers/maestros-exportar'

/** Admin nuevo con sesión de UI (para exportar) y token (para la API). */
async function admin(page: Page, request: APIRequestContext) {
  const s = await loginUsuario(request, 'admin')
  await loginAs(page, s.username, s.password)
  return s
}

/** Temporada propia con CC01 (Cereza/Lapins/CSG001, "Cuartel 1") y CC02 (Arándano/Duke/CSG002, "Cuartel 2"). */
async function temporadaConDos(request: APIRequestContext, token: string) {
  const ids = idsSemilla(await leerBundle(request, token))
  return crearTemporadaPropia(request, token, [
    { cc: 'CC01', nombre: 'Cuartel 1', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
    { cc: 'CC02', nombre: 'Cuartel 2', speciesId: ids.arandano, varietyId: ids.duke, csgId: ids.csg2 },
  ])
}

const relId = async (request: APIRequestContext, token: string, season: string, cc: string) =>
  (await leerBundle(request, token)).relations.find((r) => r.season_code === season && r.center_code === cc)!.id

const temporadaImport = (wbTemp: ReturnType<typeof temporadaDeLibro>) => ({ code: wbTemp.code, name: wbTemp.name, isCurrent: wbTemp.actual })

test('CA-07 (API): ida y vuelta en 2025-2026 (con relación source admin y nombre de CC) deja las 7 tablas idénticas y suma 1 corrida', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const ids = idsSemilla(await leerBundle(request, s.token))
  const b = await leerBundle(request, s.token)
  const temp = b.seasons.find((x) => x.code === '2025-2026')!
  const sfx = sufijo()
  const alta = await postMaestro(request, s.token, RUTA.relations, {
    seasonId: temp.id,
    companyId: ids.empresa,
    centerCode: `CC-RT-${sfx}`,
    centerName: `Cuartel RT ${sfx}`,
    speciesId: ids.cereza,
    varietyId: ids.lapins,
    csgId: ids.csg1,
  })
  expect(alta.body.ok).toBe(true)

  const antes = await foto()
  const { wb } = await exportarTemporada(page, '2025-2026')
  const filas = await parsearConImportador(wb)
  expect(filas.length).toBeGreaterThanOrEqual(3)
  await pausaEscritura()
  const r = await importar(request, s.token, { code: '2025-2026', name: 'Temporada 2025-2026', isCurrent: true }, filas)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(r.body).toMatchObject({ ok: true, received: filas.length, applied: filas.length })
  esperarIdentica(await foto(), antes, 1)
})

test('P5 (CA-07/CA-09): importar "Agrícola Esmeralda" y "Arándano" (código ≠ nombre en mayúsculas) ya no da 500 ni toca los códigos', async ({
  request,
}) => {
  const s = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const antes = await foto()
  const r = await importar(request, s.token, { code: `E2E-P5-${sfx}`, name: `P5 ${sfx}`, isCurrent: false }, [
    { empresa: SEED_EMPRESA, cc: `CCP5-${sfx}`, especie: 'Arándano', variedad: 'Duke', csg: 'CSG002' },
    { empresa: SEED_EMPRESA, cc: `CCP5B-${sfx}`, especie: 'Cereza', variedad: 'Lapins', csg: 'CSG001' },
  ])
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(r.body).toMatchObject({ ok: true, received: 2, applied: 2 })
  const despues = await foto()
  // Los catálogos existentes se reutilizan: mismas filas (código, nombre, auditoría) y sin catálogos nuevos.
  for (const t of ['companies', 'species', 'varieties', 'csg_catalog'] as const) {
    expect(despues.tablas[t], `tabla ${t} sin cambios`).toEqual(antes.tablas[t])
  }
  expect(despues.importRuns).toBe(antes.importRuns + 1)
})

test('P3: importar sin ccNombre no borra center_name; con ccNombre lo aplica; con ccNombre vacío lo conserva', async ({ request }) => {
  const s = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const season = { code: `E2E-P3-${sfx}`, name: `P3 ${sfx}`, isCurrent: false }
  const fila = { empresa: `EMPP3${sfx}`, cc: 'CC-P3', especie: `ESPP3${sfx}`, variedad: `VARP3${sfx}`, csg: `CSGP3${sfx}` }
  const alta = await importar(request, s.token, season, [fila])
  expect(alta.body.ok).toBe(true)
  const b = await leerBundle(request, s.token)
  const rel = b.relations.find((r) => r.season_code === season.code)!
  const nombreEditado = await postMaestro(request, s.token, RUTA.relations, { ...(payloadIdentico('relations', rel) as object), centerName: `Cuartel P3 ${sfx}` })
  expect(nombreEditado.body.ok).toBe(true)
  const centerName = async () => (await leerBundle(request, s.token)).relations.find((r) => r.id === rel.id)!.center_name

  // Sin ccNombre (cliente viejo): se conserva.
  expect((await importar(request, s.token, season, [fila])).body.ok).toBe(true)
  expect(await centerName()).toBe(`Cuartel P3 ${sfx}`)
  // ccNombre vacío (P13): se conserva.
  expect((await importar(request, s.token, season, [{ ...fila, ccNombre: '' }])).body.ok).toBe(true)
  expect(await centerName()).toBe(`Cuartel P3 ${sfx}`)
  // ccNombre con valor: se aplica.
  expect((await importar(request, s.token, season, [{ ...fila, ccNombre: `Nuevo ${sfx}` }])).body.ok).toBe(true)
  expect(await centerName()).toBe(`Nuevo ${sfx}`)
})

test('P4: reimportar sin cambios de negocio deja source "admin" y updated_by intactos; con cambio pasan a "excel" y NULL', async ({
  request,
}) => {
  const s = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  // Catálogos con código = nombre en mayúsculas, para aislar P4 de P5.
  const nombres = { emp: `EMPP4${sfx}`, esp: `ESPP4${sfx}`, vari: `VARP4${sfx}`, csg: `CSGP4${sfx}`, csg2: `CSGP4B${sfx}` }
  for (const [ruta, nombre] of [[RUTA.companies, nombres.emp], [RUTA.species, nombres.esp], [RUTA.csg, nombres.csg], [RUTA.csg, nombres.csg2]] as const) {
    expect((await postMaestro(request, s.token, ruta, { code: nombre, name: nombre })).body.ok).toBe(true)
  }
  const b0 = await leerBundle(request, s.token)
  const spId = b0.species.find((x) => x.name === nombres.esp)!.id
  expect((await postMaestro(request, s.token, RUTA.varieties, { code: nombres.vari, name: nombres.vari, speciesId: spId })).body.ok).toBe(true)
  const season = { code: `E2E-P4-${sfx}`, name: `P4 ${sfx}`, isCurrent: false }
  expect((await postMaestro(request, s.token, RUTA.seasons, { ...season, isCurrent: false })).body.ok).toBe(true)
  const b1 = await leerBundle(request, s.token)
  expect(
    (
      await postMaestro(request, s.token, RUTA.relations, {
        seasonId: b1.seasons.find((x) => x.code === season.code)!.id,
        companyId: b1.companies.find((x) => x.name === nombres.emp)!.id,
        centerCode: 'CC-P4',
        centerName: '',
        speciesId: spId,
        varietyId: b1.varieties.find((x) => x.name === nombres.vari)!.id,
        csgId: b1.csg.find((x) => x.name === nombres.csg)!.id,
      })
    ).body.ok,
  ).toBe(true)
  const fila = { empresa: nombres.emp, cc: 'CC-P4', especie: nombres.esp, variedad: nombres.vari, csg: nombres.csg }
  const id = await relId(request, s.token, season.code, 'CC-P4')

  const antes = await foto()
  const previa = filaPorId(antes, 'season_cost_centers', id)!
  expect(previa.source).toBe('admin')
  expect(previa.updated_by).not.toBeNull()
  await pausaEscritura()
  expect((await importar(request, s.token, season, [fila])).body).toMatchObject({ ok: true, applied: 1 })
  esperarIdentica(await foto(), antes, 1)

  // Con un cambio de negocio (otro CSG) sí cambia: source "excel" y updated_by NULL.
  expect((await importar(request, s.token, season, [{ ...fila, csg: nombres.csg2 }])).body.ok).toBe(true)
  const tras = filaPorId(await foto(), 'season_cost_centers', id)!
  expect(tras.source).toBe('excel')
  expect(tras.updated_by).toBeNull()
})

test('CA-08: editar el CSG de CC01 y reimportar cambia solo esa fila y conserva center_name; CC02 queda idéntica', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const id1 = await relId(request, s.token, t.code, 'CC01')
  const id2 = await relId(request, s.token, t.code, 'CC02')
  const { wb } = await exportarTemporada(page, t.code)
  const editado = conHojaPrincipal(wb, (aoa) => aoa.map((f) => (f[3] === 'CC01' ? [f[0], f[1], f[2], f[3], 'CSG002', f[5]] : f)))
  const filas = await parsearConImportador(editado)
  expect(filas).toHaveLength(2)

  const antes = await foto()
  expect(filaPorId(antes, 'season_cost_centers', id1)!.updated_by).not.toBeNull()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body).toMatchObject({ ok: true, received: 2, applied: 2 })
  const despues = await foto()

  const cc1 = filaPorId(despues, 'season_cost_centers', id1)!
  expect(cc1.csg_id).toBe(t.ids.csg2)
  expect(cc1.updated_by).toBeNull()
  expect(cc1.source).toBe('excel')
  expect(cc1.center_name).toBe('Cuartel 1')
  expect(filaPorId(despues, 'season_cost_centers', id2)).toEqual(filaPorId(antes, 'season_cost_centers', id2))
  for (const tabla of ['seasons', 'companies', 'species', 'varieties', 'csg_catalog', 'jc_foremen'] as const) {
    expect(despues.tablas[tabla], `tabla ${tabla}`).toEqual(antes.tablas[tabla])
  }
  expect(despues.importRuns).toBe(antes.importRuns + 1)
})

test('CA-08 (P3/P13 a): sin la columna NOMBRE CC, reimportar conserva todos los center_name', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const { wb } = await exportarTemporada(page, t.code)
  const sinColumna = conHojaPrincipal(wb, (aoa) => aoa.map((f) => f.slice(0, 5)))
  const filas = await parsearConImportador(sinColumna)
  expect(filas.every((f) => f.ccNombre === undefined)).toBe(true)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 2 })
  esperarIdentica(await foto(), antes, 1)
})

test('CA-08 (P3/P13 b): con celdas vacías en NOMBRE CC, reimportar conserva todos los center_name', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const { wb } = await exportarTemporada(page, t.code)
  const vacias = conHojaPrincipal(wb, (aoa) => aoa.map((f, i) => (i === 0 ? f : [...f.slice(0, 5), ''])))
  const filas = await parsearConImportador(vacias)
  expect(filas.every((f) => f.ccNombre === undefined)).toBe(true)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 2 })
  esperarIdentica(await foto(), antes, 1)
})

test('CA-09: agregar la fila CC09 con "Agrícola Esmeralda" crea la relación sobre la empresa existente (sin empresa nueva)', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const { wb } = await exportarTemporada(page, t.code)
  const ampliado = conHojaPrincipal(wb, (aoa) => [...aoa, [SEED_EMPRESA, 'Cereza', 'Lapins', 'CC09', 'CSG001', '']])
  const filas = await parsearConImportador(ampliado)
  expect(filas).toHaveLength(3)
  const antes = await foto()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  expect(r.body).toMatchObject({ ok: true, received: 3, applied: 3 })

  const b = await leerBundle(request, s.token)
  const cc09 = b.relations.find((x) => x.season_code === t.code && x.center_code === 'CC09')
  expect(cc09, 'CC09 debe existir').toBeTruthy()
  expect(cc09!.is_active).toBe(1)
  expect(cc09!.company_id).toBe(t.ids.empresa)
  expect((await foto()).tablas.companies).toHaveLength(antes.tablas.companies.length)
})

test('CA-10: quitar la fila CC02 del archivo y reimportar no borra ni toca CC02 (estado, updated_by, updated_at)', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const id2 = await relId(request, s.token, t.code, 'CC02')
  const { wb } = await exportarTemporada(page, t.code)
  const sinCc02 = conHojaPrincipal(wb, (aoa) => aoa.filter((f) => f[3] !== 'CC02'))
  const filas = await parsearConImportador(sinCc02)
  expect(filas).toHaveLength(1)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, received: 1, applied: 1 })
  const despues = await foto()
  expect(filaPorId(despues, 'season_cost_centers', id2)).toEqual(filaPorId(antes, 'season_cost_centers', id2))
  esperarIdentica(despues, antes, 1)
})

test('CA-06: relación inactiva y variedad inactiva van a "No importables" con su MOTIVO y reimportar no reactiva nada', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const sfx = sufijo()
  const ids = idsSemilla(await leerBundle(request, s.token))
  const varInactiva = await crearVariedad(request, s.token, ids.cereza, `VI-${sfx}`)
  const t = await crearTemporadaPropia(
    request,
    s.token,
    [
      { cc: 'CC-OK', nombre: 'Buena', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
      { cc: 'CC-RI', nombre: 'Rel inactiva', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
      { cc: 'CC-VI', nombre: 'Var inactiva', speciesId: ids.cereza, varietyId: varInactiva, csgId: ids.csg1 },
    ],
    sfx,
  )
  await fijarRelacionActiva(request, s.token, t.code, 'CC-RI', 0)
  const v = (await leerBundle(request, s.token)).varieties.find((x) => x.id === varInactiva)!
  expect((await postMaestro(request, s.token, RUTA.varieties, { ...(payloadIdentico('varieties', v) as object), isActive: 0 })).body.ok).toBe(true)

  const { wb } = await exportarTemporada(page, t.code)
  const principal = filasDeHoja(wb, wb.SheetNames[0])
  expect(principal.slice(1).map((f) => f[3])).toEqual(['CC-OK'])
  const noImp = filasDeHoja(wb, 'No importables')
  expect(noImp[0]).toEqual(['EMPRESA', 'ESPECIE', 'VARIEDAD', 'CC', 'CSG', 'NOMBRE CC', 'MOTIVO'])
  expect(noImp.find((f) => f[3] === 'CC-RI')?.[6]).toBe('Relación inactiva')
  expect(noImp.find((f) => f[3] === 'CC-VI')?.[6]).toBe('Variedad inactiva')

  const filas = await parsearConImportador(wb)
  expect(filas).toHaveLength(1)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 1 })
  esperarIdentica(await foto(), antes, 1)
  const b = await leerBundle(request, s.token)
  expect(b.relations.find((x) => x.season_code === t.code && x.center_code === 'CC-RI')!.is_active).toBe(0)
  expect(b.varieties.find((x) => x.id === varInactiva)!.is_active).toBe(0)
})

test('CA-22: variedad movida a otra especie va a "No importables" y reimportar no la mueve de especie', async ({ page, request }) => {
  const s = await admin(page, request)
  const sfx = sufijo()
  const ids = idsSemilla(await leerBundle(request, s.token))
  const vx = await crearVariedad(request, s.token, ids.cereza, `VX-${sfx}`)
  const t = await crearTemporadaPropia(
    request,
    s.token,
    [
      { cc: 'CC-BUENA', nombre: 'Buena', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
      { cc: 'CC-VX', nombre: 'Con VX', speciesId: ids.cereza, varietyId: vx, csgId: ids.csg1 },
    ],
    sfx,
  )
  const v = (await leerBundle(request, s.token)).varieties.find((x) => x.id === vx)!
  expect((await postMaestro(request, s.token, RUTA.varieties, { ...(payloadIdentico('varieties', v) as object), speciesId: ids.arandano })).body.ok).toBe(true)

  const { wb } = await exportarTemporada(page, t.code)
  expect(filasDeHoja(wb, wb.SheetNames[0]).slice(1).map((f) => f[3])).toEqual(['CC-BUENA'])
  expect(filasDeHoja(wb, 'No importables').find((f) => f[3] === 'CC-VX')?.[6]).toBe('Variedad de otra especie')

  const filas = await parsearConImportador(wb)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 1 })
  esperarIdentica(await foto(), antes, 1)
  expect((await leerBundle(request, s.token)).varieties.find((x) => x.id === vx)!.species_id).toBe(ids.arandano)
})

test('CA-21: exportar no escribe en la BD (7 tablas y master_import_runs idénticos)', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const antes = await foto()
  await pausaEscritura()
  await exportarTemporada(page, '2025-2026')
  await exportarTemporada(page, t.code)
  esperarIdentica(await foto(), antes, 0)
  // La exportación usa solo datos que ya existen: la API sigue devolviendo lo mismo.
  expect(exportablesDe(await leerBundle(request, s.token), t.code)).toHaveLength(2)
})

test('CA-16: GET /api/admin/masters responde 403 forbidden al operador y 401 missing_token sin token', async ({ request }) => {
  const op = await loginUsuario(request, 'operador')
  const conOperador = await request.get(`${API()}/api/admin/masters`, { headers: auth(op.token) })
  expect(conOperador.status()).toBe(403)
  expect(await conOperador.json()).toEqual({ ok: false, error: 'forbidden' })
  const sinToken = await request.get(`${API()}/api/admin/masters`)
  expect(sinToken.status()).toBe(401)
  expect(await sinToken.json()).toEqual({ ok: false, error: 'missing_token' })
})

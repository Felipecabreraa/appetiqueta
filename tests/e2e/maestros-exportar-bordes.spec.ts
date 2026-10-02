import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { loginUsuario, sufijo } from './helpers/api'
import { loginAs } from './helpers/auth'
import { leerBundle, payloadIdentico, postMaestro, RUTA } from './helpers/maestros'
import { filaPorId } from './helpers/fotoMaestros'
import { conectarBd } from './helpers/db'
import {
  botonExportar,
  abrirCargaExcel,
  conHojaPrincipal,
  crearTemporadaPropia,
  elegirTemporada,
  esperarIdentica,
  exportar,
  exportarTemporada,
  filasDeHoja,
  filasPrincipal,
  foto,
  idsSemilla,
  importar,
  leerLibro,
  parsearConImportador,
  pausaEscritura,
  SEED_EMPRESA,
  temporadaDeLibro,
} from './helpers/maestros-exportar'

// Casos borde y concurrencia del §6 del requerimiento (fase 6). Todo corre contra la BD *_test.

async function admin(page: Page, request: APIRequestContext) {
  const s = await loginUsuario(request, 'admin')
  await loginAs(page, s.username, s.password)
  return s
}

async function temporadaConDos(request: APIRequestContext, token: string) {
  const ids = idsSemilla(await leerBundle(request, token))
  return crearTemporadaPropia(request, token, [
    { cc: 'CC01', nombre: 'Cuartel 1', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
    { cc: 'CC02', nombre: 'Cuartel 2', speciesId: ids.arandano, varietyId: ids.duke, csgId: ids.csg2 },
  ])
}

const temporadaImport = (t: ReturnType<typeof temporadaDeLibro>) => ({ code: t.code, name: t.name, isCurrent: t.actual })
const relId = async (request: APIRequestContext, token: string, season: string, cc: string) =>
  (await leerBundle(request, token)).relations.find((r) => r.season_code === season && r.center_code === cc)!.id

async function corridas(seasonId: number) {
  const c = await conectarBd()
  try {
    const [rows] = await c.query('SELECT imported_by, rows_received, rows_applied FROM master_import_runs WHERE season_id = ? ORDER BY id', [seasonId])
    return rows as Array<{ imported_by: number; rows_received: number; rows_applied: number }>
  } finally {
    await c.end()
  }
}

test('Concurrencia: 4 importaciones simultáneas (2 admins) del mismo archivo exportado no dan 500, no duplican y dejan 4 corridas coherentes', async ({
  page,
  request,
}) => {
  const a = await admin(page, request)
  const b = await loginUsuario(request, 'admin')
  const t = await temporadaConDos(request, a.token)
  const { wb } = await exportarTemporada(page, t.code)
  const filas = await parsearConImportador(wb)
  const temp = temporadaImport(temporadaDeLibro(wb))
  const antes = await foto()
  await pausaEscritura()

  const resp = await Promise.all([a.token, b.token, a.token, b.token].map((tk) => importar(request, tk, temp, filas)))
  for (const r of resp) {
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ ok: true, received: 2, applied: 2 })
  }
  // Sin cambios de negocio: las 7 tablas idénticas (sin duplicados ni auditoría espuria) y 4 corridas nuevas.
  esperarIdentica(await foto(), antes, 4)
  const runs = await corridas(t.seasonId)
  expect(runs).toHaveLength(4)
  expect(runs.every((r) => r.rows_received === 2 && r.rows_applied === 2)).toBe(true)
  expect(new Set(runs.map((r) => r.imported_by)).size).toBe(2)
})

test('Concurrencia: 4 importaciones simultáneas del mismo archivo con una fila nueva (CC09) crean UNA sola relación y no dan 500', async ({
  page,
  request,
}) => {
  const a = await admin(page, request)
  const b = await loginUsuario(request, 'admin')
  const t = await temporadaConDos(request, a.token)
  const { wb } = await exportarTemporada(page, t.code)
  const ampliado = conHojaPrincipal(wb, (aoa) => [...aoa, [SEED_EMPRESA, 'Cereza', 'Lapins', 'CC09', 'CSG001', 'Nueva']])
  const filas = await parsearConImportador(ampliado)
  const temp = temporadaImport(temporadaDeLibro(wb))

  const resp = await Promise.all([a.token, b.token, a.token, b.token].map((tk) => importar(request, tk, temp, filas)))
  for (const r of resp) {
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body).toMatchObject({ ok: true, received: 3, applied: 3 })
  }
  const rel = (await leerBundle(request, a.token)).relations.filter((r) => r.season_code === t.code)
  expect(rel.map((r) => r.center_code).sort()).toEqual(['CC01', 'CC02', 'CC09'])
  expect((await corridas(t.seasonId)).length).toBe(4)
  const emp = (await leerBundle(request, a.token)).companies.filter((c) => c.name === SEED_EMPRESA)
  expect(emp).toHaveLength(1)
})

test('Concurrencia: exportar mientras otro usuario edita da un archivo coherente (1 descarga, sin errores) y la edición queda en la BD', async ({
  page,
  request,
}) => {
  const a = await admin(page, request)
  const b = await loginUsuario(request, 'admin')
  const t = await temporadaConDos(request, a.token)
  await abrirCargaExcel(page)
  await elegirTemporada(page, t.code)

  // La exportación queda retenida en la red mientras el otro usuario edita CC01 (CSG001 -> CSG002).
  let liberar!: () => void
  const retenida = new Promise<void>((res) => (liberar = res))
  let tomada = false
  await page.route('**/api/admin/masters', async (route) => {
    tomada = true
    await retenida
    await route.continue()
  })
  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await botonExportar(page).click()
      await expect.poll(() => tomada).toBe(true)
      const rel = (await leerBundle(request, b.token)).relations.find((r) => r.season_code === t.code && r.center_code === 'CC01')!
      const ed = await postMaestro(request, b.token, RUTA.relations, { ...(payloadIdentico('relations', rel) as object), csgId: t.ids.csg2 })
      expect(ed.body.ok).toBe(true)
      liberar()
    })(),
  ])
  const wb = leerLibro(await descarga.path())
  const principal = filasPrincipal(wb)
  expect(principal.slice(1).map((f) => f[3]).sort()).toEqual(['CC01', 'CC02'])
  expect(['CSG001', 'CSG002']).toContain(principal.find((f) => f[3] === 'CC01')![4])
  await expect(page.getByText('No se pudieron obtener los maestros. Intente nuevamente.')).toHaveCount(0)
  // La edición del otro usuario sigue en la BD (la exportación no la pisa).
  const final = (await leerBundle(request, a.token)).relations.find((r) => r.season_code === t.code && r.center_code === 'CC01')!
  expect(final.csg_id).toBe(t.ids.csg2)
})

test('Edición combinada: cambiar NOMBRE CC de CC01, agregar CC09 y borrar CC02 y reimportar cambia solo CC01 y CC09; CC02 queda intacta', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const id1 = await relId(request, s.token, t.code, 'CC01')
  const id2 = await relId(request, s.token, t.code, 'CC02')
  const { wb } = await exportarTemporada(page, t.code)
  const editado = conHojaPrincipal(wb, (aoa) => [
    ...aoa.filter((f) => f[3] !== 'CC02').map((f) => (f[3] === 'CC01' ? [f[0], f[1], f[2], f[3], f[4], 'Cuartel Uno'] : f)),
    [SEED_EMPRESA, 'Cereza', 'Lapins', 'CC09', 'CSG001', 'Cuartel Nueve'],
  ])
  const filas = await parsearConImportador(editado)
  expect(filas).toHaveLength(2)

  const antes = await foto()
  expect(filaPorId(antes, 'season_cost_centers', id1)!.updated_by).not.toBeNull()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, received: 2, applied: 2 })
  const despues = await foto()

  const cc1 = filaPorId(despues, 'season_cost_centers', id1)!
  expect(cc1.center_name).toBe('Cuartel Uno')
  expect(cc1.updated_by).toBeNull()
  expect(cc1.source).toBe('excel')
  expect(cc1.csg_id).toBe(filaPorId(antes, 'season_cost_centers', id1)!.csg_id)
  // CC02 (borrada del archivo): idéntica, con su auditoría.
  expect(filaPorId(despues, 'season_cost_centers', id2)).toEqual(filaPorId(antes, 'season_cost_centers', id2))
  // CC09: nueva, activa, de la empresa existente y sin autor (importación).
  const nuevas = (despues.tablas.season_cost_centers as Array<Record<string, unknown>>).filter((x) => !(antes.tablas.season_cost_centers as Array<Record<string, unknown>>).some((y) => y.id === x.id))
  expect(nuevas).toHaveLength(1)
  expect(nuevas[0]).toMatchObject({ center_code: 'CC09', center_name: 'Cuartel Nueve', is_active: 1, company_id: t.ids.empresa, updated_by: null })
  // Ningún otro maestro cambia.
  for (const tabla of ['seasons', 'companies', 'species', 'varieties', 'csg_catalog', 'jc_foremen'] as const) {
    expect(despues.tablas[tabla], `tabla ${tabla}`).toEqual(antes.tablas[tabla])
  }
  expect(despues.importRuns).toBe(antes.importRuns + 1)
})

test('Espacios: celdas con espacios al inicio o al final se recortan en el parser y reimportar no cambia nada', async ({ page, request }) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const { wb } = await exportarTemporada(page, t.code)
  const conEspacios = conHojaPrincipal(wb, (aoa) => aoa.map((f, i) => (i === 0 ? f : f.map((c) => `  ${c}  `))))
  expect(filasPrincipal(conEspacios)[1][0]).toBe(`  ${SEED_EMPRESA}  `)
  const filas = await parsearConImportador(conEspacios)
  expect(filas[0]).toMatchObject({ empresa: SEED_EMPRESA, cc: 'CC01', especie: 'Cereza', variedad: 'Lapins', csg: 'CSG001', ccNombre: 'Cuartel 1' })
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 2 })
  esperarIdentica(await foto(), antes, 1)
})

test('Espacios (API directa, sin parser): el servidor recorta empresa/CC/especie/variedad/CSG y no duplica ni cambia nada', async ({ request }) => {
  const s = await loginUsuario(request, 'admin')
  const t = await temporadaConDos(request, s.token)
  const sp = (x: string) => ` ${x} `
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(
    request,
    s.token,
    { code: t.code, name: t.name, isCurrent: false },
    [
      { empresa: sp(SEED_EMPRESA), cc: sp('CC01'), especie: sp('Cereza'), variedad: sp('Lapins'), csg: sp('CSG001'), ccNombre: sp('Cuartel 1') },
      { empresa: sp(SEED_EMPRESA), cc: sp('CC02'), especie: sp('Arándano'), variedad: sp('Duke'), csg: sp('CSG002'), ccNombre: sp('Cuartel 2') },
    ],
  )
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  esperarIdentica(await foto(), antes, 1)
})

test('Espacios: un catálogo guardado con espacios en Mantenimiento se exporta sin espacios de borde (RN-08) y reimporta sin cambios', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const sfx = sufijo()
  const nombreEmp = `Emp Esp ${sfx}`
  const ids = idsSemilla(await leerBundle(request, s.token))
  const alta = await postMaestro(request, s.token, RUTA.companies, { code: `EMPESP${sfx}`, name: `  ${nombreEmp}  ` })
  expect(alta.body.ok, JSON.stringify(alta.body)).toBe(true)
  const b = await leerBundle(request, s.token)
  const emp = b.companies.find((c) => c.code === `EMPESP${sfx}`)!
  const t = await crearTemporadaPropia(request, s.token, [
    { cc: 'CC-ESP', nombre: '  con espacios  ', companyId: emp.id, speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 },
  ])
  const { wb } = await exportarTemporada(page, t.code)
  const fila = filasPrincipal(wb)[1]
  expect(fila[0], 'EMPRESA sin espacios de borde').toBe(fila[0].trim())
  expect(fila[0].trim()).toBe(nombreEmp)
  expect(fila[5], 'NOMBRE CC sin espacios de borde').toBe(fila[5].trim())
  const filas = await parsearConImportador(wb)
  const antes = await foto()
  await pausaEscritura()
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  // Si la BD guardó espacios y se exporta recortado, la reimportación puede ver "cambios": se exige que no.
  esperarIdentica(await foto(), antes, 1)
})

test('Temporada inactiva: se exporta con aviso, el archivo marca ACTIVA=No y reimportarla la reactiva (comportamiento avisado)', async ({
  page,
  request,
}) => {
  const s = await admin(page, request)
  const t = await temporadaConDos(request, s.token)
  const temp = (await leerBundle(request, s.token)).seasons.find((x) => x.code === t.code)!
  expect((await postMaestro(request, s.token, RUTA.seasons, { ...(payloadIdentico('seasons', temp) as object), isActive: 0 })).body.ok).toBe(true)

  await abrirCargaExcel(page)
  await elegirTemporada(page, t.code)
  await expect(page.locator('#panel-maestros-excel').getByText('Esta temporada está inactiva: reimportarla la reactivará.')).toBeVisible()
  const { wb, download } = await exportar(page)
  expect(download.suggestedFilename()).toMatch(new RegExp(`^maestros-${t.code}-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`))
  expect(filasDeHoja(wb, 'Temporada')[0].map((x) => x.toUpperCase())).toContain('ACTIVA')
  expect(filasDeHoja(wb, 'Temporada')[1][3]).toBe('No')
  expect(filasPrincipal(wb).slice(1)).toHaveLength(2)

  const filas = await parsearConImportador(wb)
  const r = await importar(request, s.token, temporadaImport(temporadaDeLibro(wb)), filas)
  expect(r.body, JSON.stringify(r.body)).toMatchObject({ ok: true, applied: 2 })
  const tras = (await leerBundle(request, s.token)).seasons.find((x) => x.code === t.code)!
  expect(tras.is_active).toBe(1)
})

test('Concurrencia: 6 importaciones simultáneas que crean los mismos catálogos nuevos (empresa/especie/variedad/CSG) no dan 500 ni duplican catálogos', async ({
  request,
}) => {
  const s = await loginUsuario(request, 'admin')
  const sfx = sufijo()
  const season = { code: `E2E-CONC-${sfx}`, name: `Conc ${sfx}`, isCurrent: false }
  const fila = (n: number) => ({ empresa: `EMPCONC ${sfx}`, cc: `CC-C${n}`, especie: `ESPCONC ${sfx}`, variedad: `VARCONC ${sfx}`, csg: `CSGCONC ${sfx}`, ccNombre: `N${n}` })
  const resp = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => importar(request, s.token, season, [fila(n), fila(n + 10)])))
  for (const r of resp) expect(r.status, JSON.stringify(r.body)).toBe(200)
  const b = await leerBundle(request, s.token)
  const cuenta = (l: Array<{ name?: string }>, nombre: string) => l.filter((x) => x.name === nombre).length
  expect(cuenta(b.companies, `EMPCONC ${sfx}`)).toBe(1)
  expect(cuenta(b.species, `ESPCONC ${sfx}`)).toBe(1)
  expect(cuenta(b.varieties, `VARCONC ${sfx}`)).toBe(1)
  expect(cuenta(b.csg, `CSGCONC ${sfx}`)).toBe(1)
  expect(b.relations.filter((r) => r.season_code === season.code)).toHaveLength(12)
})

import { expect, test, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { loginAs } from './helpers/auth'
import { abrirMenuSiHaceFalta, adminToken, crearUsuario, sufijo } from './helpers/api'
import { leerBundle, postMaestro, RUTA, payloadIdentico } from './helpers/maestros'
import {
  abrirCargaExcel,
  botonExportar,
  BOTON_EXPORTAR,
  crearTemporadaPropia,
  ENCABEZADOS,
  elegirTemporada,
  esperarIdentica,
  exportablesDe,
  exportar,
  exportarTemporada,
  filasDeHoja,
  filasPrincipal,
  foto,
  idsSemilla,
  leerLibro,
  panelExcel,
  parsearConImportador,
  pausaEscritura,
  selectorTemporada,
  temporadaDeLibro,
} from './helpers/maestros-exportar'

const SIN_ROL_ALERTA = 'La exportación no debe usar role="alert" (lo usa MastersAdminPanel)'

async function loginAdmin(page: Page, request: Parameters<typeof crearUsuario>[0]) {
  const u = await crearUsuario(request, 'admin')
  await loginAs(page, u.username, u.password)
  return u
}

const aoaDe = (wb: XLSX.WorkBook) => filasPrincipal(wb)
const hoy = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('CA-01 y CA-03: admin exporta 2025-2026 (preseleccionada): 6 encabezados, filas exportables, CC01 y nombre de archivo', async ({
  page,
  request,
}) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  // La temporada actual viene preseleccionada.
  await expect(selectorTemporada(page).locator('option:checked')).toHaveText(/^2025-2026 - /)
  const { download, wb } = await exportar(page)

  // CA-03: nombre con la fecha local
  expect(download.suggestedFilename()).toMatch(/^maestros-2025-2026-\d{4}-\d{2}-\d{2}\.xlsx$/)
  expect(download.suggestedFilename()).toBe(`maestros-2025-2026-${hoy()}.xlsx`)

  // CA-01: hoja principal
  const filas = aoaDe(wb)
  expect(filas[0]).toEqual([...ENCABEZADOS])
  const esperadas = exportablesDe(await leerBundle(request, await adminToken(request)), '2025-2026')
  expect(esperadas.length).toBeGreaterThanOrEqual(2)
  expect(filas.length - 1).toBe(esperadas.length)
  expect(filas).toContainEqual(['Agrícola Esmeralda', 'Cereza', 'Lapins', 'CC01', 'CSG001', 'Cuartel 1'])
  expect(filas).toContainEqual(['Agrícola Esmeralda', 'Arándano', 'Duke', 'CC02', 'CSG002', 'Cuartel 2'])
  // Solo de esa temporada: cada CC del archivo existe en 2025-2026 y no hay más CC que los de la API.
  expect(filas.slice(1).map((f) => f[3]).sort()).toEqual(esperadas.map((r) => r.center_code).sort())
  expect(wb.SheetNames[0]).toBe('Maestros')
})

test('CA-02: la plantilla y la exportación tienen los mismos encabezados y la exportación no trae la fila de ejemplo', async ({
  page,
  request,
}) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  const [plantilla] = await Promise.all([
    page.waitForEvent('download'),
    panelExcel(page).getByRole('button', { name: 'Descargar plantilla Excel' }).click(),
  ])
  const wbPlantilla = leerLibro(await plantilla.path())
  const { wb } = await exportar(page)

  expect(aoaDe(wbPlantilla)[0]).toEqual([...ENCABEZADOS])
  expect(aoaDe(wb)[0]).toEqual(aoaDe(wbPlantilla)[0])
  for (const hoja of wb.SheetNames) {
    expect(JSON.stringify(filasDeHoja(wb, hoja))).not.toContain('EMPRESA EJEMPLO SPA')
  }
})

test('CA-04: CC "001" y CSG "00123" salen como texto y el parser de importación los lee igual', async ({ page, request }) => {
  const token = await adminToken(request)
  const b0 = await leerBundle(request, token)
  const ids = idsSemilla(b0)
  // CSG "00123": nombre único en la BD compartida; se reutiliza si ya lo creó el otro proyecto.
  if (!b0.csg.some((c) => c.name === '00123')) {
    const r = await postMaestro(request, token, RUTA.csg, { code: 'CSG_00123', name: '00123' })
    expect(r.body.ok).toBe(true)
  }
  const csgId = (await leerBundle(request, token)).csg.find((c) => c.name === '00123')!.id
  const t = await crearTemporadaPropia(request, token, [
    { cc: '001', nombre: 'Cuartel cero', speciesId: ids.cereza, varietyId: ids.lapins, csgId },
  ])
  await loginAdmin(page, request)
  const { wb } = await exportarTemporada(page, t.code)

  const ws = wb.Sheets[wb.SheetNames[0]]
  const celdas = Object.entries(ws).filter(([k]) => !k.startsWith('!'))
  const cc = celdas.find(([k, c]) => /^D\d+$/.test(k) && (c as XLSX.CellObject).v === '001')?.[1] as XLSX.CellObject
  const csg = celdas.find(([k, c]) => /^E\d+$/.test(k) && (c as XLSX.CellObject).v === '00123')?.[1] as XLSX.CellObject
  expect(cc, 'celda CC con "001" (texto)').toBeTruthy()
  expect(csg, 'celda CSG con "00123" (texto)').toBeTruthy()
  expect(cc.t).toBe('s')
  expect(csg.t).toBe('s')
  const filas = await parsearConImportador(wb)
  expect(filas).toEqual([expect.objectContaining({ cc: '001', csg: '00123' })])
})

test('CA-07 (UI): exportar 2025-2026 y reimportar el archivo sin cambios deja las 7 tablas idénticas y suma 1 corrida', async ({
  page,
}, testInfo) => {
  await loginAs(page) // superadmin
  const antes = await foto()
  const { download, wb } = await exportarTemporada(page, '2025-2026')
  const archivo = testInfo.outputPath(download.suggestedFilename())
  await download.saveAs(archivo)
  const filas = aoaDe(wb).length - 1
  expect(filas).toBeGreaterThanOrEqual(2)
  const temporada = temporadaDeLibro(wb)
  expect(temporada.code).toBe('2025-2026')

  await panelExcel(page).getByLabel('Archivo Excel').setInputFiles(archivo)
  await expect(page.getByText('Filas válidas detectadas:')).toBeVisible()
  await panelExcel(page).getByLabel('Código temporada').fill(temporada.code)
  await panelExcel(page).getByLabel('Nombre temporada').fill(temporada.name)
  await panelExcel(page).getByLabel('Marcar como temporada actual').selectOption(temporada.actual ? '1' : '0')
  await pausaEscritura()
  await panelExcel(page).getByRole('button', { name: 'Importar maestros' }).click()
  await expect(page.getByText(`Carga completada: ${filas} filas aplicadas de ${filas}.`)).toBeVisible()

  esperarIdentica(await foto(), antes, 1)
})

test('CA-11: temporada sin relaciones exportables no descarga y avisa en role="status"', async ({ page, request }) => {
  const token = await adminToken(request)
  const t = await crearTemporadaPropia(request, token, [])
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await elegirTemporada(page, t.code)

  let descargas = 0
  page.on('download', () => descargas++)
  const hayDescarga = page.waitForEvent('download', { timeout: 2000 }).then(
    () => true,
    () => false,
  )
  await botonExportar(page).click()
  await expect(
    panelExcel(page).getByRole('status').filter({ hasText: `La temporada ${t.code} no tiene relaciones activas para exportar.` }),
  ).toBeVisible()
  expect(await hayDescarga).toBe(false)
  expect(descargas).toBe(0)
  await expect(botonExportar(page)).toBeEnabled()
  await expect(panelExcel(page).getByRole('alert'), SIN_ROL_ALERTA).toHaveCount(0)
})

test('CA-12: sin temporadas el botón queda deshabilitado, se informa y no hay "Reintentar"', async ({ page, request }) => {
  await loginAdmin(page, request)
  await page.route('**/api/admin/masters', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, seasons: [], companies: [], species: [], csg: [], jcForemen: [], varieties: [], relations: [] }),
    }),
  )
  await abrirCargaExcel(page)
  await expect(panelExcel(page).getByText('No hay temporadas para exportar.')).toBeVisible()
  await expect(botonExportar(page)).toBeDisabled()
  await expect(panelExcel(page).getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA-13 (a): si falla el GET al exportar (500) no hay descarga, aparece el mensaje en role="status" y el botón se rehabilita', async ({
  page,
  request,
}) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await expect(botonExportar(page)).toBeEnabled()
  let descargas = 0
  page.on('download', () => descargas++)
  await page.route('**/api/admin/masters', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"db"}' }))

  await botonExportar(page).click()
  await expect(
    panelExcel(page).getByRole('status').filter({ hasText: 'No se pudieron obtener los maestros. Intente nuevamente.' }),
  ).toBeVisible()
  await expect(botonExportar(page)).toBeEnabled()
  await expect(panelExcel(page).getByRole('alert'), SIN_ROL_ALERTA).toHaveCount(0)
  expect(descargas).toBe(0)
})

test('CA-13 (a, sin conexión): route.abort() muestra el mismo mensaje y no descarga', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await expect(botonExportar(page)).toBeEnabled()
  let descargas = 0
  page.on('download', () => descargas++)
  await page.route('**/api/admin/masters', (route) => route.abort('connectionfailed'))

  await botonExportar(page).click()
  await expect(
    panelExcel(page).getByRole('status').filter({ hasText: 'No se pudieron obtener los maestros. Intente nuevamente.' }),
  ).toBeVisible()
  await expect(botonExportar(page)).toBeEnabled()
  expect(descargas).toBe(0)
})

test('CA-13 (b): si falla la carga inicial, Exportar queda deshabilitado, aparece "Reintentar" y al reintentar se llena el selector', async ({
  page,
  request,
}) => {
  await loginAdmin(page, request)
  await page.route('**/api/admin/masters', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"db"}' }))
  await abrirCargaExcel(page)
  await expect(
    panelExcel(page).getByRole('status').filter({ hasText: 'No se pudieron obtener los maestros. Intente nuevamente.' }),
  ).toBeVisible()
  await expect(botonExportar(page)).toBeDisabled()
  await expect(selectorTemporada(page)).toBeDisabled()
  await expect(panelExcel(page).getByRole('alert'), SIN_ROL_ALERTA).toHaveCount(0)

  await page.unroute('**/api/admin/masters')
  await panelExcel(page).getByRole('button', { name: 'Reintentar' }).click()
  await expect(selectorTemporada(page)).toBeEnabled()
  expect(await selectorTemporada(page).locator('option').count()).toBeGreaterThan(0)
  await expect(botonExportar(page)).toBeEnabled()
  await expect(panelExcel(page).getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA-14: durante la exportación el botón dice "Exportando..." y deshabilitado; un doble clic genera 1 descarga', async ({
  page,
  request,
}) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await expect(botonExportar(page)).toBeEnabled()
  let descargas = 0
  page.on('download', () => descargas++)
  await page.route('**/api/admin/masters', async (route) => {
    await new Promise((r) => setTimeout(r, 1000))
    await route.continue()
  })

  const primera = page.waitForEvent('download')
  await botonExportar(page).dblclick()
  const ocupado = panelExcel(page).getByRole('button', { name: 'Exportando...' })
  await expect(ocupado).toBeVisible()
  await expect(ocupado).toBeDisabled()
  await primera
  await expect(botonExportar(page)).toBeEnabled()
  expect(descargas).toBe(1)
})

test('CA-15: operador no ve Maestros ni el botón Exportar, ni forzando #maestros/excel', async ({ page, request }) => {
  const u = await crearUsuario(request, 'operador')
  await loginAs(page, u.username, u.password)
  await page.goto('/#maestros/excel')
  await expect(page.getByRole('heading', { name: 'Nueva generación' })).toBeVisible()
  await abrirMenuSiHaceFalta(page)
  await expect(page.getByRole('navigation', { name: 'Módulos' }).getByRole('button', { name: 'Maestros', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: BOTON_EXPORTAR })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Carga maestra desde Excel' })).toHaveCount(0)
  await expect(page.locator('#panel-maestros-excel')).toHaveCount(0)
})

test('CA-17: superadmin obtiene el mismo archivo (hoja principal) que el admin', async ({ page, context, request }) => {
  await loginAs(page) // superadmin
  const { wb: wbSuper } = await exportarTemporada(page, '2025-2026')

  const admin = await context.newPage()
  const u = await crearUsuario(request, 'admin')
  await loginAs(admin, u.username, u.password)
  const { wb: wbAdmin } = await exportarTemporada(admin, '2025-2026')

  expect(wbSuper.SheetNames[0]).toBe(wbAdmin.SheetNames[0])
  expect(aoaDe(wbSuper)).toEqual(aoaDe(wbAdmin))
  expect(aoaDe(wbSuper)[0]).toEqual([...ENCABEZADOS])
  expect(aoaDe(wbSuper)).toContainEqual(['Agrícola Esmeralda', 'Cereza', 'Lapins', 'CC01', 'CSG001', 'Cuartel 1'])
})

test('CA-18: selector y botón visibles sin scroll horizontal y la descarga funciona (desktop y móvil)', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  const select = selectorTemporada(page)
  const boton = botonExportar(page)
  await select.scrollIntoViewIfNeeded()
  await expect(select).toBeInViewport()
  await boton.scrollIntoViewIfNeeded()
  await expect(boton).toBeInViewport()
  const sinScrollHorizontal = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  expect(sinScrollHorizontal, 'sin scroll horizontal').toBe(true)
  const { download } = await exportar(page)
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/)
})

test('CA-20: con más de 10000 relaciones se descarga completo y se avisa del límite de importación', async ({ page, request }) => {
  const token = await adminToken(request)
  const real = await leerBundle(request, token)
  const ids = idsSemilla(real)
  const temp = real.seasons.find((s) => s.code === '2025-2026')!
  const relations = Array.from({ length: 10001 }, (_, i) => ({
    id: 900000 + i,
    season_id: temp.id,
    season_code: '2025-2026',
    company_id: ids.empresa,
    company_name: 'Agrícola Esmeralda',
    center_code: `GRD-${String(i + 1).padStart(5, '0')}`,
    center_name: '',
    species_id: ids.cereza,
    species_name: 'Cereza',
    variety_id: ids.lapins,
    variety_name: 'Lapins',
    csg_id: ids.csg1,
    csg_name: 'CSG001',
    is_active: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: null,
    updatedAt: null,
  }))
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await elegirTemporada(page, '2025-2026')
  // Solo el GET del clic usa el bundle grande (el panel de Mantenimiento ya cargó el real).
  await page.route('**/api/admin/masters', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...real, relations }) }))

  const { wb } = await exportar(page)
  expect(aoaDe(wb).length - 1).toBe(10001)
  await expect(
    panelExcel(page).getByRole('status').filter({ hasText: 'El archivo tiene 10001 filas; la importación acepta hasta 10000 por carga.' }),
  ).toBeVisible()
})

test('P1/P10/P14: avisos de reimportación según la temporada elegida (actual, no actual, inactiva, código no normalizado)', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const ids = idsSemilla(await leerBundle(request, token))
  const rel = { cc: 'CC-AV', speciesId: ids.cereza, varietyId: ids.lapins, csgId: ids.csg1 }
  const propia = await crearTemporadaPropia(request, token, [rel])
  const inactiva = await crearTemporadaPropia(request, token, [rel])
  const sfx = sufijo()
  const rara = `e2e av ${sfx.toLowerCase()}`
  expect((await postMaestro(request, token, RUTA.seasons, { code: rara, name: `Rara ${sfx}`, isCurrent: false })).body.ok).toBe(true)
  const b = await leerBundle(request, token)
  const s = b.seasons.find((x) => x.code === inactiva.code)!
  expect((await postMaestro(request, token, RUTA.seasons, { ...(payloadIdentico('seasons', s) as object), isActive: 0 })).body.ok).toBe(true)

  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  const panel = panelExcel(page)

  await elegirTemporada(page, '2025-2026')
  await expect(panel.getByText('Para reimportar, use el mismo código y nombre de temporada: «2025-2026» / «Temporada 2025-2026».')).toBeVisible()
  await expect(panel.getByText('Es la temporada actual: al reimportar, deje «Marcar como temporada actual» en Sí.')).toBeVisible()

  await elegirTemporada(page, propia.code)
  await expect(panel.getByText(`Para reimportar, use el mismo código y nombre de temporada: «${propia.code}» / «${propia.name}».`)).toBeVisible()
  await expect(
    panel.getByText('No es la temporada actual: al reimportar, elija «Marcar como temporada actual» = No, o pasará a ser la actual.'),
  ).toBeVisible()

  await elegirTemporada(page, inactiva.code)
  expect((await selectorTemporada(page).locator('option:checked').textContent()) ?? '').toMatch(/ \(inactiva\)$/)
  await expect(panel.getByText('Esta temporada está inactiva: reimportarla la reactivará.')).toBeVisible()

  await elegirTemporada(page, rara)
  await expect(
    panel.getByText(
      `La importación convierte este código en «${rara.trim().toUpperCase().replace(/\s+/g, '_')}» y crearía otra temporada; corrija el código en Mantenimiento antes de reimportar.`,
    ),
  ).toBeVisible()
})

test('Texto de columnas (P11): la pantalla lista las columnas en el orden de la plantilla', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await expect(panelExcel(page).getByText('Columnas esperadas: EMPRESA, ESPECIE, VARIEDAD, CC, CSG y NOMBRE CC (opcional).')).toBeVisible()
})

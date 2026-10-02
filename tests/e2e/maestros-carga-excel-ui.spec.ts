import { expect, test, type Locator, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { loginAs } from './helpers/auth'
import { adminToken, crearUsuario, sufijo } from './helpers/api'
import { abrirCargaExcel, BOTON_EXPORTAR, crearTemporadaPropia, elegirTemporada, panelExcel } from './helpers/maestros-exportar'
import { leerBundle, payloadIdentico, postMaestro, RUTA } from './helpers/maestros'

/**
 * UI de Maestros > Carga desde Excel: dos tarjetas (Exportar / Importar). CA-01..CA-04 de
 * docs/specs/20261002-ui-carga-excel/requerimiento.md. CA-05 lo cubren las suites maestros-* existentes.
 */
const TITULO_EXPORTAR = 'Exportar maestros'
const TITULO_IMPORTAR = 'Importar maestros desde Excel'

const seccionExportar = (page: Page): Locator => panelExcel(page).getByRole('region', { name: TITULO_EXPORTAR, exact: true })
const seccionImportar = (page: Page): Locator => panelExcel(page).getByRole('region', { name: TITULO_IMPORTAR, exact: true })

async function loginAdmin(page: Page, request: Parameters<typeof crearUsuario>[0]) {
  const u = await crearUsuario(request, 'admin')
  await loginAs(page, u.username, u.password)
}

/** Control exportación: [nombre, localizador dentro de un ámbito]. */
const CONTROLES_EXPORTAR: Array<[string, (s: Locator) => Locator]> = [
  ['Temporada a exportar', (s) => s.getByLabel('Temporada a exportar')],
  [BOTON_EXPORTAR, (s) => s.getByRole('button', { name: BOTON_EXPORTAR })],
]
const CONTROLES_IMPORTAR: Array<[string, (s: Locator) => Locator]> = [
  ['Código temporada', (s) => s.getByLabel('Código temporada')],
  ['Nombre temporada', (s) => s.getByLabel('Nombre temporada')],
  ['Marcar como temporada actual', (s) => s.getByLabel('Marcar como temporada actual')],
  ['Archivo Excel', (s) => s.getByLabel('Archivo Excel')],
  ['Columnas esperadas', (s) => s.getByText(/Columnas esperadas/)],
  ['Importar maestros (botón)', (s) => s.getByRole('button', { name: 'Importar maestros', exact: true })],
  ['Descargar plantilla Excel', (s) => s.getByRole('button', { name: 'Descargar plantilla Excel' })],
]

test('CA-01: dos secciones con heading y línea descriptiva, exportar antes que importar', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)

  const exportar = seccionExportar(page)
  const importar = seccionImportar(page)
  await expect(exportar).toBeVisible()
  await expect(importar).toBeVisible()
  await expect(exportar.getByRole('heading', { name: TITULO_EXPORTAR, exact: true })).toBeVisible()
  await expect(importar.getByRole('heading', { name: TITULO_IMPORTAR, exact: true })).toBeVisible()
  await expect(exportar.getByText(/Descarga los maestros de una temporada/)).toBeVisible()
  await expect(importar.getByText(/Carga o actualiza empresas, especies, variedades, CC y CSG de una temporada/)).toBeVisible()

  const exportarAntes = await exportar.evaluate(
    (el, otro) => Boolean(el.compareDocumentPosition(otro) & Node.DOCUMENT_POSITION_FOLLOWING),
    await importar.elementHandle(),
  )
  expect(exportarAntes, 'la sección de exportar debe preceder a la de importar en el DOM').toBe(true)
})

for (const [nombre, loc] of CONTROLES_EXPORTAR) {
  test(`CA-02: "${nombre}" está solo dentro de la sección de exportar`, async ({ page, request }) => {
    await loginAdmin(page, request)
    await abrirCargaExcel(page)
    await expect(seccionExportar(page)).toBeVisible()
    await expect(loc(seccionExportar(page))).toHaveCount(1)
    await expect(loc(seccionImportar(page))).toHaveCount(0)
  })
}

for (const [nombre, loc] of CONTROLES_IMPORTAR) {
  test(`CA-02: "${nombre}" está solo dentro de la sección de importar`, async ({ page, request }) => {
    await loginAdmin(page, request)
    await abrirCargaExcel(page)
    await expect(seccionImportar(page)).toBeVisible()
    await expect(loc(seccionImportar(page))).toHaveCount(1)
    await expect(loc(seccionExportar(page))).toHaveCount(0)
  })
}

test('CA-03: avisos de reimportación (temporada actual) dentro de exportar con role="status", sin alert', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await elegirTemporada(page, '2025-2026')
  const exportar = seccionExportar(page)
  const aviso = (t: string | RegExp) => exportar.getByRole('status').filter({ hasText: t })
  await expect(aviso('Para reimportar, use el mismo código y nombre de temporada: «2025-2026» / «Temporada 2025-2026».')).toBeVisible()
  await expect(aviso('Es la temporada actual: al reimportar, deje «Marcar como temporada actual» en Sí.')).toBeVisible()
  await expect(seccionImportar(page).getByText(/Para reimportar|Es la temporada actual/)).toHaveCount(0)
  await expect(panelExcel(page).getByRole('alert')).toHaveCount(0)
})

test('CA-03: aviso de temporada inactiva y de temporada no actual dentro de exportar con role="status"', async ({ page, request }) => {
  const token = await adminToken(request)
  const t = await crearTemporadaPropia(request, token, [])
  const temp = (await leerBundle(request, token)).seasons.find((x) => x.code === t.code)!
  const r = await postMaestro(request, token, RUTA.seasons, { ...(payloadIdentico('seasons', temp) as object), isActive: 0 })
  expect(r.body.ok, 'inactivar temporada propia').toBe(true)

  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await elegirTemporada(page, t.code)
  const exportar = seccionExportar(page)
  await expect(exportar.getByRole('status').filter({ hasText: 'No es la temporada actual: al reimportar, elija «Marcar como temporada actual» = No, o pasará a ser la actual.' })).toBeVisible()
  await expect(exportar.getByRole('status').filter({ hasText: 'Esta temporada está inactiva: reimportarla la reactivará.' })).toBeVisible()
  await expect(seccionImportar(page).getByText(/inactiva|No es la temporada actual/)).toHaveCount(0)
  await expect(panelExcel(page).getByRole('alert')).toHaveCount(0)
})

test('CA-03: error de carga inicial y "Reintentar" dentro de exportar (status, no alert)', async ({ page, request }) => {
  await loginAdmin(page, request)
  await page.route('**/api/admin/masters', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"db"}' }))
  await abrirCargaExcel(page)
  const exportar = seccionExportar(page)
  await expect(exportar.getByRole('status').filter({ hasText: 'No se pudieron obtener los maestros. Intente nuevamente.' })).toBeVisible()
  await expect(exportar.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(seccionImportar(page).getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expect(seccionImportar(page).getByText('No se pudieron obtener los maestros. Intente nuevamente.')).toHaveCount(0)
  await expect(panelExcel(page).getByRole('alert')).toHaveCount(0)
})

test('CA-03: aviso de error al exportar (500) queda en exportar con role="status"', async ({ page, request }) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await expect(seccionExportar(page).getByRole('button', { name: BOTON_EXPORTAR })).toBeEnabled()
  await page.route('**/api/admin/masters', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"db"}' }))
  await seccionExportar(page).getByRole('button', { name: BOTON_EXPORTAR }).click()
  await expect(seccionExportar(page).getByRole('status').filter({ hasText: 'No se pudieron obtener los maestros. Intente nuevamente.' })).toBeVisible()
  await expect(seccionImportar(page).getByText('No se pudieron obtener los maestros. Intente nuevamente.')).toHaveCount(0)
  await expect(panelExcel(page).getByRole('alert')).toHaveCount(0)
})

test('CA-03: resultado y errores de la importación aparecen dentro de la sección de importar', async ({ page, request }, testInfo) => {
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  const importar = seccionImportar(page)
  const exportar = seccionExportar(page)
  await expect(importar).toBeVisible()

  // Error: sin archivo
  await importar.getByRole('button', { name: 'Importar maestros', exact: true }).click()
  await expect(importar.getByText('Debe seleccionar un Excel con datos válidos.')).toBeVisible()
  await expect(exportar.getByText('Debe seleccionar un Excel con datos válidos.')).toHaveCount(0)

  // Resultado: importación correcta de una temporada propia (no actual)
  const sfx = sufijo()
  const temporada = `E2E-UI-${sfx}`
  const ws = XLSX.utils.json_to_sheet([{ empresa: 'Agrícola Esmeralda', cc: `CCUI-${sfx}`, especie: 'Ciruela', variedad: 'Angeleno', csg: `CSGUI-${sfx}` }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Maestros')
  const archivo = testInfo.outputPath(`ui-${sfx}.xlsx`)
  XLSX.writeFile(wb, archivo)
  await importar.getByLabel('Código temporada').fill(temporada)
  await importar.getByLabel('Nombre temporada').fill(`Temporada ${temporada}`)
  await importar.getByLabel('Marcar como temporada actual').selectOption('0')
  await importar.getByLabel('Archivo Excel').setInputFiles(archivo)
  await expect(importar.getByText('Filas válidas detectadas:')).toBeVisible()
  await importar.getByRole('button', { name: 'Importar maestros', exact: true }).click()
  await expect(importar.getByText('Carga completada: 1 filas aplicadas de 1.')).toBeVisible()
  await expect(exportar.getByText(/Carga completada/)).toHaveCount(0)
})

test('CA-04: sin desborde horizontal en móvil dentro de #panel-maestros-excel', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'movil', 'el desborde se verifica solo en el proyecto móvil (Pixel 7)')
  await loginAdmin(page, request)
  await abrirCargaExcel(page)
  await elegirTemporada(page, '2025-2026')
  await expect(panelExcel(page).getByLabel('Archivo Excel')).toBeVisible()

  const ancho = page.viewportSize()!.width
  const panel = panelExcel(page)
  const controles = panel.locator('input, select, button, label, p, h2, h3, section')
  const total = await controles.count()
  expect(total).toBeGreaterThan(8)
  const excedidos: string[] = []
  for (let i = 0; i < total; i++) {
    const c = controles.nth(i)
    if (!(await c.isVisible())) continue
    const box = await c.boundingBox()
    if (box && box.x + box.width > ancho + 0.5) {
      const etiqueta = ((await c.innerText().catch(() => '')) || (await c.getAttribute('type')) || '').slice(0, 40)
      excedidos.push(`${await c.evaluate((e) => e.tagName)} "${etiqueta}" termina en ${Math.round(box.x + box.width)}px > ${ancho}px`)
    }
  }
  expect(excedidos, `controles que exceden el ancho de la ventana:\n${excedidos.join('\n')}`).toEqual([])

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, 'sin scroll horizontal de la página').toBeLessThanOrEqual(clientWidth)
})

test('CA-03: la región role="status" de exportar existe y no está oculta aunque esté vacía (lectores de pantalla)', async ({ page, request }) => {
  // Se demora la carga de temporadas: mientras tanto la región está vacía y debe seguir en el árbol de
  // accesibilidad, para que un error posterior se anuncie.
  let liberar: () => void = () => {}
  const espera = new Promise<void>((r) => (liberar = r))
  await page.route('**/api/admin/masters', async (route) => {
    await espera
    await route.continue()
  })
  await loginAdmin(page, request)
  await page.goto('/#maestros/excel')
  const estado = seccionExportar(page).getByRole('status')
  await expect(estado).toHaveCount(1)
  expect(await estado.evaluate((el) => getComputedStyle(el).display)).not.toBe('none')
  liberar()
})

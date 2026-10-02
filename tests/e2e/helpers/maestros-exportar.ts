import { expect, type APIRequestContext, type Download, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { API, sufijo } from './api'
import { auth, leerBundle, payloadIdentico, postMaestro, RUTA, type Bundle } from './maestros'
import { conectarBd } from './db'
import { fotoMaestros, type FotoMaestros } from './fotoMaestros'

export const ENCABEZADOS = ['EMPRESA', 'ESPECIE', 'VARIEDAD', 'CC', 'CSG', 'NOMBRE CC'] as const
export const BOTON_EXPORTAR = 'Exportar maestros a Excel'
export const SEED_EMPRESA = 'Agrícola Esmeralda'

export type FilaImportacion = {
  empresa: string
  cc: string
  especie: string
  variedad: string
  csg: string
  ccNombre?: string
}

export const panelExcel = (page: Page): Locator => page.locator('#panel-maestros-excel')

/** Abre Maestros > Carga desde Excel por hash y espera a que el selector de temporada esté listo. */
export async function abrirCargaExcel(page: Page): Promise<void> {
  await page.goto('/#maestros/excel')
  await expect(page.getByRole('heading', { name: 'Carga maestra desde Excel' })).toBeVisible()
}

export const selectorTemporada = (page: Page): Locator => panelExcel(page).getByLabel('Temporada a exportar')
export const botonExportar = (page: Page): Locator => panelExcel(page).getByRole('button', { name: BOTON_EXPORTAR })

/** Elige en el selector la opción "<código> - <nombre>" (con o sin sufijo " (inactiva)"). */
export async function elegirTemporada(page: Page, codigo: string): Promise<void> {
  const select = selectorTemporada(page)
  await expect(select).toBeEnabled()
  await expect.poll(async () => (await select.locator('option').allTextContents()).some((t) => t.startsWith(`${codigo} - `))).toBe(true)
  const textos = await select.locator('option').allTextContents()
  const label = textos.find((t) => t.startsWith(`${codigo} - `))!
  await select.selectOption({ label })
}

/** Lee un .xlsx del disco (en ESM, XLSX.readFile no tiene acceso a fs). */
export const leerLibro = (ruta: string): XLSX.WorkBook => XLSX.read(fs.readFileSync(ruta), { type: 'buffer', cellNF: true })

/** Pulsa "Exportar maestros a Excel" y devuelve la descarga ya leída con xlsx. */
export async function exportar(page: Page): Promise<{ download: Download; wb: XLSX.WorkBook; ruta: string }> {
  const boton = botonExportar(page)
  await expect(boton).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), boton.click()])
  const ruta = await download.path()
  const wb = leerLibro(ruta)
  return { download, wb, ruta }
}

/** Abre la pantalla, elige la temporada y exporta. */
export async function exportarTemporada(page: Page, codigo: string) {
  await abrirCargaExcel(page)
  await elegirTemporada(page, codigo)
  return exportar(page)
}

/** Filas de una hoja como arreglo de arreglos de texto (fila 1 = encabezados). */
export function filasDeHoja(wb: XLSX.WorkBook, nombre: string): string[][] {
  const ws = wb.Sheets[nombre]
  expect(ws, `el libro debe tener la hoja "${nombre}"`).toBeTruthy()
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
}

/** Primera hoja del libro (la única que lee la importación). */
export function filasPrincipal(wb: XLSX.WorkBook): string[][] {
  return filasDeHoja(wb, wb.SheetNames[0])
}

/** Reemplaza la hoja principal por una derivada de sus filas (valores de texto); el resto del libro se descarta. */
export function conHojaPrincipal(wb: XLSX.WorkBook, editar: (aoa: string[][]) => string[][]): XLSX.WorkBook {
  const aoa = editar(filasPrincipal(wb).map((f) => [...f]))
  const nuevo = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(nuevo, XLSX.utils.aoa_to_sheet(aoa), wb.SheetNames[0])
  return nuevo
}

/** Lee el libro con el parser de importación real (src/lib/masterExcel.ts). */
export async function parsearConImportador(wb: XLSX.WorkBook): Promise<FilaImportacion[]> {
  const mod = await import('../../../src/lib/masterExcel')
  return mod.parseMasterWorkbook(wb) as FilaImportacion[]
}

/** Código y nombre de la hoja "Temporada" del archivo exportado (CÓDIGO, NOMBRE, ACTUAL, ACTIVA). */
export function temporadaDeLibro(wb: XLSX.WorkBook): { code: string; name: string; actual: boolean } {
  const f = filasDeHoja(wb, 'Temporada')
  return { code: f[1][0], name: f[1][1], actual: f[1][2] === 'Sí' }
}

export async function importar(
  request: APIRequestContext,
  token: string,
  season: { code: string; name: string; isCurrent: boolean },
  rows: object[],
) {
  const res = await request.post(`${API()}/api/master-data/import`, { headers: auth(token), data: { season, rows } })
  return { status: res.status(), body: await res.json() }
}

/** Relaciones exportables de una temporada según el bundle (todo activo y variedad de la especie de la relación). */
export function exportablesDe(b: Bundle, codigo: string) {
  const act = (lista: Array<{ id: number; is_active: number }>, id?: number) => lista.find((r) => r.id === id)?.is_active === 1
  return b.relations.filter(
    (r) =>
      r.season_code === codigo &&
      r.is_active === 1 &&
      act(b.companies, r.company_id) &&
      act(b.species, r.species_id) &&
      act(b.csg, r.csg_id) &&
      act(b.varieties, r.variety_id) &&
      b.varieties.find((v) => v.id === r.variety_id)?.species_id === r.species_id,
  )
}

export type Ids = { empresa: number; cereza: number; arandano: number; lapins: number; duke: number; csg1: number; csg2: number }

/** Ids de los catálogos de la semilla, por nombre. */
export function idsSemilla(b: Bundle): Ids {
  const id = (lista: Array<{ id: number; name?: string }>, name: string) => {
    const r = lista.find((x) => x.name === name)
    expect(r, `la semilla debe tener "${name}"`).toBeTruthy()
    return r!.id
  }
  return {
    empresa: id(b.companies, SEED_EMPRESA),
    cereza: id(b.species, 'Cereza'),
    arandano: id(b.species, 'Arándano'),
    lapins: id(b.varieties, 'Lapins'),
    duke: id(b.varieties, 'Duke'),
    csg1: id(b.csg, 'CSG001'),
    csg2: id(b.csg, 'CSG002'),
  }
}

export type RelacionSpec = {
  cc: string
  nombre?: string
  speciesId: number
  varietyId: number
  csgId: number
  companyId?: number
}

/**
 * Crea por API (como `token`) una temporada propia `E2E-EXP-<sfx>` (no actual) con las relaciones dadas
 * (source 'admin', con created_by/updated_by del actor). Devuelve código, nombre e ids.
 */
export async function crearTemporadaPropia(
  request: APIRequestContext,
  token: string,
  relaciones: RelacionSpec[],
  sfx = sufijo(),
) {
  const code = `E2E-EXP-${sfx}`
  const name = `Temporada ${code}`
  const t = await postMaestro(request, token, RUTA.seasons, { code, name, startsOn: '2031-01-01', endsOn: '2031-12-31', isCurrent: false })
  expect(t.body.ok, 'alta de temporada propia').toBe(true)
  const b = await leerBundle(request, token)
  const ids = idsSemilla(b)
  const seasonId = b.seasons.find((s) => s.code === code)!.id
  for (const r of relaciones) {
    const rel = await postMaestro(request, token, RUTA.relations, {
      seasonId,
      companyId: r.companyId ?? ids.empresa,
      centerCode: r.cc,
      centerName: r.nombre ?? '',
      speciesId: r.speciesId,
      varietyId: r.varietyId,
      csgId: r.csgId,
    })
    expect(rel.body.ok, `alta de relación ${r.cc}`).toBe(true)
  }
  return { code, name, seasonId, sfx, ids }
}

/** Crea una variedad nueva (nombre único por sufijo) en la especie dada y devuelve su id. */
export async function crearVariedad(request: APIRequestContext, token: string, speciesId: number, nombre: string, activa = 1) {
  const r = await postMaestro(request, token, RUTA.varieties, { code: nombre.toUpperCase().replace(/\s+/g, '_'), name: nombre, speciesId, isActive: activa })
  expect(r.body.ok, `alta de variedad ${nombre}`).toBe(true)
  const b = await leerBundle(request, token)
  return b.varieties.find((v) => v.name === nombre)!.id
}

/** Inactiva (o reactiva) una relación por API conservando el resto de sus datos. */
export async function fijarRelacionActiva(request: APIRequestContext, token: string, seasonCode: string, cc: string, activa: 0 | 1) {
  const b = await leerBundle(request, token)
  const rel = b.relations.find((r) => r.season_code === seasonCode && r.center_code === cc)!
  const r = await postMaestro(request, token, RUTA.relations, { ...(payloadIdentico('relations', rel) as object), isActive: activa })
  expect(r.body.ok).toBe(true)
}

/** Instantánea directa de la BD (abre y cierra su propia conexión). */
export async function foto(): Promise<FotoMaestros> {
  const conn = await conectarBd()
  try {
    return await fotoMaestros(conn)
  } finally {
    await conn.end()
  }
}

/** Espera >=100 ms para que una escritura espuria se note en updated_at (DATETIME(3)). */
export const pausaEscritura = () => new Promise((r) => setTimeout(r, 120))

/** Compara dos instantáneas tabla por tabla (mensaje legible) y, opcionalmente, el conteo de master_import_runs. */
export function esperarIdentica(despues: FotoMaestros, antes: FotoMaestros, corridasNuevas = 0) {
  for (const t of Object.keys(antes.tablas) as Array<keyof FotoMaestros['tablas']>) {
    expect(despues.tablas[t], `tabla ${t} idéntica`).toEqual(antes.tablas[t])
  }
  expect(despues.importRuns, 'master_import_runs').toBe(antes.importRuns + corridasNuevas)
}

import * as XLSX from 'xlsx'
import type {
  MasterCompany,
  MasterCsg,
  MasterRelation,
  MasterSeason,
  MasterSpecies,
  MasterVariety,
} from '../types'

/** Columnas de la plantilla, de la hoja principal exportada y de la importación (mismo orden). */
export const MASTER_HEADERS = ['EMPRESA', 'ESPECIE', 'VARIEDAD', 'CC', 'CSG', 'NOMBRE CC'] as const

/** Máximo de filas que acepta POST /api/master-data/import. */
export const IMPORT_ROW_LIMIT = 10000

export interface MasterImportRow {
  empresa: string
  cc: string
  especie: string
  variedad: string
  csg: string
  ccNombre?: string
}

/** Datos mínimos de GET /api/admin/masters que usa la exportación. */
export interface MasterBundle {
  seasons: MasterSeason[]
  companies: MasterCompany[]
  species: MasterSpecies[]
  csg: MasterCsg[]
  varieties: MasterVariety[]
  relations: MasterRelation[]
}

export type MastersExportResult =
  | { kind: 'empty'; seasonCode: string }
  | {
      kind: 'ok'
      workbook: XLSX.WorkBook
      fileName: string
      rowCount: number
      nonImportableCount: number
      overImportLimit: boolean
    }

const SHEET_MAIN = 'Maestros'
const SHEET_NON_IMPORTABLE = 'No importables'
const SHEET_SEASON = 'Temporada'
const WRONG_SHEET_MESSAGE =
  'Este archivo tiene la hoja «No importables» o la columna MOTIVO como primera hoja. Copie las filas que quiera reactivar a la hoja «Maestros», sin la columna MOTIVO, y vuelva a importar.'

/** Columnas (índice 0) con formato texto: CC, CSG y NOMBRE CC. */
const TEXT_FORMAT_COLUMNS = [3, 4, 5]

function cleanText(value: unknown): string {
  return String(value ?? '').trim()
}

export function parseMasterRow(row: Record<string, unknown>): MasterImportRow | null {
  const get = (...keys: string[]): string => {
    for (const key of keys) {
      const value = row[key]
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim()
      }
    }
    return ''
  }
  const parsed: MasterImportRow = {
    empresa: get('empresa', 'Empresa', 'EMPRESA'),
    cc: get('cc', 'CC', 'centro_costo', 'CentroCosto', 'centroCosto'),
    especie: get('especie', 'Especie', 'ESPECIE'),
    variedad: get('variedad', 'Variedad', 'VARIEDAD'),
    csg: get('csg', 'CSG'),
  }
  if (!parsed.empresa || !parsed.cc || !parsed.especie || !parsed.variedad || !parsed.csg) {
    return null
  }
  const ccNombre = get('NOMBRE CC', 'Nombre CC', 'nombre cc', 'NOMBRE_CC', 'nombre_cc')
  if (ccNombre) parsed.ccNombre = ccNombre
  return parsed
}

/** Lee la primera hoja. Lanza solo si es la hoja "No importables" o trae la columna MOTIVO. */
export function parseMasterWorkbook(wb: XLSX.WorkBook): MasterImportRow[] {
  const name = wb.SheetNames[0] || ''
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  if (name.trim().toLowerCase() === SHEET_NON_IMPORTABLE.toLowerCase()) {
    throw new Error(WRONG_SHEET_MESSAGE)
  }
  const header = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })[0] ?? []
  if (header.some((cell) => cleanText(cell).toUpperCase() === 'MOTIVO')) {
    throw new Error(WRONG_SHEET_MESSAGE)
  }
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return json.map(parseMasterRow).filter((row): row is MasterImportRow => row !== null)
}

function markTextColumns(sheet: XLSX.WorkSheet, rowCount: number): void {
  for (let r = 1; r <= rowCount; r++) {
    for (const c of TEXT_FORMAT_COLUMNS) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      if (cell) cell.z = '@'
    }
  }
}

function textSheet(rows: string[][]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  markTextColumns(sheet, rows.length - 1)
  return sheet
}

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const sheet = textSheet([
    [...MASTER_HEADERS],
    ['EMPRESA EJEMPLO SPA', 'CEREZA', 'LAPINS', 'CC-001', '12345', 'Cuartel ejemplo'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Plantilla')
  return wb
}

/** Fecha local (no UTC) en el nombre: en Chile, de noche, la fecha UTC ya es la del día siguiente. */
export function exportFileName(code: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  return `maestros-${code.replace(/[/\\:*?"<>|]/g, '_')}-${date}.xlsx`
}

/** Espejo de toCode del servidor: el código con que la importación guardaría la temporada. */
export function importedSeasonCode(code: string): string {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '_') || 'N/A'
}

function isActive(list: Array<{ id: number; is_active: number }>, id: number): boolean {
  return list.find((item) => item.id === id)?.is_active === 1
}

export function nonImportableReasons(bundle: MasterBundle, relation: MasterRelation): string[] {
  const reasons: string[] = []
  if (relation.is_active !== 1) reasons.push('Relación inactiva')
  if (!isActive(bundle.companies, relation.company_id)) reasons.push('Empresa inactiva')
  if (!isActive(bundle.species, relation.species_id)) reasons.push('Especie inactiva')
  const variety = bundle.varieties.find((v) => v.id === relation.variety_id)
  if (variety?.is_active !== 1) reasons.push('Variedad inactiva')
  if (variety && variety.species_id !== relation.species_id) reasons.push('Variedad de otra especie')
  if (!isActive(bundle.csg, relation.csg_id)) reasons.push('CSG inactivo')
  return reasons
}

function relationCells(relation: MasterRelation): string[] {
  return [
    cleanText(relation.company_name),
    cleanText(relation.species_name),
    cleanText(relation.variety_name),
    cleanText(relation.center_code),
    cleanText(relation.csg_name),
    cleanText(relation.center_name),
  ]
}

export function buildMastersExport(bundle: MasterBundle, seasonId: number, now: Date): MastersExportResult {
  const season = bundle.seasons.find((s) => s.id === seasonId)
  const seasonCode = season?.code ?? ''
  const relations = bundle.relations.filter((r) => r.season_id === seasonId)
  const exportable: MasterRelation[] = []
  const rejected: Array<{ relation: MasterRelation; reasons: string[] }> = []
  for (const relation of relations) {
    const reasons = nonImportableReasons(bundle, relation)
    if (reasons.length === 0) exportable.push(relation)
    else rejected.push({ relation, reasons })
  }
  if (!season || exportable.length === 0) return { kind: 'empty', seasonCode }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    textSheet([[...MASTER_HEADERS], ...exportable.map(relationCells)]),
    SHEET_MAIN,
  )
  XLSX.utils.book_append_sheet(
    wb,
    textSheet([
      [...MASTER_HEADERS, 'MOTIVO'],
      ...rejected.map(({ relation, reasons }) => [...relationCells(relation), reasons.join(', ')]),
    ]),
    SHEET_NON_IMPORTABLE,
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['CÓDIGO', 'NOMBRE', 'ACTUAL', 'ACTIVA'],
      [
        cleanText(season.code),
        cleanText(season.name),
        season.is_current === 1 ? 'Sí' : 'No',
        season.is_active === 1 ? 'Sí' : 'No',
      ],
      [],
      ['Para reimportar, use el mismo código y nombre de temporada.'],
    ]),
    SHEET_SEASON,
  )
  return {
    kind: 'ok',
    workbook: wb,
    fileName: exportFileName(season.code, now),
    rowCount: exportable.length,
    nonImportableCount: rejected.length,
    overImportLimit: exportable.length > IMPORT_ROW_LIMIT,
  }
}

import * as XLSX from 'xlsx'
import type { LabelRecord, Movement } from '../types'
import { getLabels, getMovements } from './storage'

export type TrackingsExportData = {
  labels: LabelRecord[]
  movements: Movement[]
}

/** Nombres de hoja (max 31) sin caracteres prohibidos de Excel */
const SHEET_JC = 'JC - Primera lectura QR'
const SHEET_ACOPIO = 'Acopio - Segunda lectura QR'

/** Orden fijo de columnas (evita que SheetJS omita columnas con json_to_sheet). */
const JC_HEADERS = [
  '#',
  'Codigo etiqueta (QR)',
  'Cantidad totes (salida JC)',
  'Fecha y hora',
  'Empresa',
  'CSG',
  'Especie',
  'Variedad',
  'Fecha cosecha',
  'Sector',
  'Centro costo',
  'Totes grabados en etiqueta',
  'Jefe cuadrilla (etiqueta)',
  'Precio (CLP)',
  'JH (personas en cuadrilla)',
  'Fecha ISO (evento)',
] as const

const ACOPIO_HEADERS = [
  '#',
  'Codigo etiqueta (QR)',
  'Cantidad totes (llegada al acopio)',
  'Fecha y hora',
  'Empresa',
  'CSG',
  'Especie',
  'Variedad',
  'Fecha cosecha',
  'Sector',
  'Centro costo',
  'Totes grabados en etiqueta',
  'Jefe cuadrilla (etiqueta)',
  'Precio (CLP)',
  'JH (personas en cuadrilla)',
  'Fecha ISO (evento)',
] as const

function labelSnapshot(label: LabelRecord | undefined): {
  totesEtiqueta: string
  empresa: string
  csg: string
  especie: string
  variedad: string
  fechaCosecha: string
  sector: string
  centroCosto: string
  jefe: string
} {
  const totesEtiqueta =
    label?.cantidadTotes === null || label?.cantidadTotes === undefined
      ? 'Pendiente primer JC'
      : String(label.cantidadTotes)
  return {
    totesEtiqueta,
    empresa: label?.empresa ?? '',
    csg: label?.csg ?? '',
    especie: label?.especie ?? '',
    variedad: label?.variedad ?? '',
    fechaCosecha: label?.fecha ?? '',
    sector: label?.sector ?? '',
    centroCosto: label?.centroCosto ?? '',
    jefe: label?.jefeCuadrilla?.trim() ?? '',
  }
}

function movementToJcRow(
  m: Movement,
  idx: number,
  label: LabelRecord | undefined,
): Record<string, string | number> {
  const s = labelSnapshot(label)
  return {
    '#': idx + 1,
    'Codigo etiqueta (QR)': m.labelId,
    'Cantidad totes (salida JC)': m.cantidad,
    'Fecha y hora': new Date(m.at).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }),
    Empresa: s.empresa,
    CSG: s.csg,
    Especie: s.especie,
    Variedad: s.variedad,
    'Fecha cosecha': s.fechaCosecha,
    Sector: s.sector,
    'Centro costo': s.centroCosto,
    'Totes grabados en etiqueta': s.totesEtiqueta,
    'Jefe cuadrilla (etiqueta)': s.jefe,
    'Precio (CLP)': m.precioClp ?? '',
    'JH (personas en cuadrilla)': m.jh ?? '',
    'Fecha ISO (evento)': m.at,
  }
}

function movementToAcopioRow(
  m: Movement,
  idx: number,
  label: LabelRecord | undefined,
): Record<string, string | number> {
  const s = labelSnapshot(label)
  return {
    '#': idx + 1,
    'Codigo etiqueta (QR)': m.labelId,
    'Cantidad totes (llegada al acopio)': m.cantidad,
    'Fecha y hora': new Date(m.at).toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }),
    Empresa: s.empresa,
    CSG: s.csg,
    Especie: s.especie,
    Variedad: s.variedad,
    'Fecha cosecha': s.fechaCosecha,
    Sector: s.sector,
    'Centro costo': s.centroCosto,
    'Totes grabados en etiqueta': s.totesEtiqueta,
    'Jefe cuadrilla (etiqueta)': s.jefe,
    'Precio (CLP)': m.precioClp ?? '',
    'JH (personas en cuadrilla)': '',
    'Fecha ISO (evento)': m.at,
  }
}

function sheetFromKeyedRows(
  rows: Record<string, string | number>[],
  headers: readonly string[],
  emptyHint: string,
): XLSX.WorkSheet {
  if (rows.length === 0) {
    return XLSX.utils.json_to_sheet([{ Mensaje: emptyHint }])
  }
  const head = [...headers]
  const aoa = [head, ...rows.map((row) => head.map((h) => row[h] ?? ''))]
  return XLSX.utils.aoa_to_sheet(aoa)
}

/**
 * Libro .xlsx con dos hojas: JC (primera lectura QR) y Acopio (segunda lectura QR).
 * Reporte global: pasar `source` desde GET /api/reports/tracking-export (solo datos persistidos en MySQL).
 * Sin `source`, usa solo lo que haya en localStorage (no sustituye al flujo operativo con servidor).
 */
export function exportTrackingsExcel(fileName?: string, source?: TrackingsExportData): void {
  const movements = source?.movements ?? getMovements()
  const labels = source?.labels ?? getLabels()
  const byId = new Map(
    labels.map((l) => [
      l.id
        .trim()
        .toUpperCase(),
      l,
    ]),
  )

  const jcSorted = movements
    .filter((m) => m.type === 'jc')
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const acopioSorted = movements
    .filter((m) => m.type === 'acopio')
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const rowsJc = jcSorted.map((m, i) => {
    const label = byId.get(m.labelId.trim().toUpperCase())
    return movementToJcRow(m, i, label)
  })
  const rowsAcopio = acopioSorted.map((m, i) => {
    const label = byId.get(m.labelId.trim().toUpperCase())
    return movementToAcopioRow(m, i, label)
  })

  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromKeyedRows(
      rowsJc,
      JC_HEADERS,
      'No hay registros de trackeo JC en la base de datos (ningún escaneo sincronizado aún).',
    ),
    SHEET_JC,
  )

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromKeyedRows(
      rowsAcopio,
      ACOPIO_HEADERS,
      'No hay registros de trackeo Acopio en la base de datos (ningún escaneo sincronizado aún).',
    ),
    SHEET_ACOPIO,
  )

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, fileName ?? `trackeos-jc-acopio-${stamp}.xlsx`)
}

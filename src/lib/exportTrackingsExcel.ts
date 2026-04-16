import * as XLSX from 'xlsx'
import type { LabelRecord, Movement } from '../types'
import { getLabels, getMovements } from './storage'

/** Nombres de hoja (max 31) sin caracteres prohibidos de Excel */
const SHEET_JC = 'JC - Primera lectura QR'
const SHEET_ACOPIO = 'Acopio - Segunda lectura QR'

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
    Operador: m.registeredBy?.trim() || '',
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
    Operador: m.registeredBy?.trim() || '',
    'Fecha ISO (evento)': m.at,
  }
}

function sheetFromRows(
  rows: Record<string, string | number>[],
  emptyHint: string,
): XLSX.WorkSheet {
  if (rows.length === 0) {
    return XLSX.utils.json_to_sheet([{ Mensaje: emptyHint }])
  }
  return XLSX.utils.json_to_sheet(rows)
}

/**
 * Libro .xlsx con dos hojas:
 * - Trackeo JC = primera lectura / validacion del QR (salida de totes).
 * - Trackeo Acopio = segunda lectura / validacion del QR (llegada al acopio).
 */
export function exportTrackingsExcel(fileName?: string): void {
  const movements = getMovements()
  const byId = new Map(getLabels().map((l) => [l.id, l]))

  const jcSorted = movements
    .filter((m) => m.type === 'jc')
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  const acopioSorted = movements
    .filter((m) => m.type === 'acopio')
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const rowsJc = jcSorted.map((m, i) =>
    movementToJcRow(m, i, byId.get(m.labelId)),
  )
  const rowsAcopio = acopioSorted.map((m, i) =>
    movementToAcopioRow(m, i, byId.get(m.labelId)),
  )

  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      rowsJc,
      'No hay registros de trackeo JC (primera lectura del QR) en este dispositivo.',
    ),
    SHEET_JC,
  )

  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(
      rowsAcopio,
      'No hay registros de trackeo Acopio (segunda lectura del QR) en este dispositivo.',
    ),
    SHEET_ACOPIO,
  )

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, fileName ?? `trackeos-jc-acopio-${stamp}.xlsx`)
}

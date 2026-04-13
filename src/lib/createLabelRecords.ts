import type { LabelFormValues } from '../components/labelFormValues'
import type { LabelRecord } from '../types'
import { createTrackingId } from './id'
import { getLabels } from './storage'

/** Límite práctico para no saturar el navegador con muchos QR en impresión. */
export const MAX_ETIQUETAS_LOTE = 250

export function createLabelRecords(values: LabelFormValues, count: number): LabelRecord[] {
  const n = Math.min(Math.max(1, Math.floor(Number(count))), MAX_ETIQUETAS_LOTE)
  const used = new Set(getLabels().map((l) => l.id))
  const createdAt = new Date().toISOString()
  const records: LabelRecord[] = []

  for (let i = 0; i < n; i++) {
    let id = createTrackingId()
    let attempts = 0
    while (used.has(id) && attempts < 256) {
      id = createTrackingId()
      attempts++
    }
    if (used.has(id)) {
      throw new Error(
        'No se pudo generar un identificador de etiqueta único. Intente de nuevo.',
      )
    }
    used.add(id)
    records.push({
      id,
      createdAt,
      ...values,
      cantidadTotes: null,
      jefeCuadrilla: '',
    })
  }
  return records
}

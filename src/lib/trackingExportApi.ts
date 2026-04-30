import type { LabelRecord, Movement } from '../types'
import { apiFetch } from './apiClient'

export type TrackingExportPayload = {
  labels: LabelRecord[]
  movements: Movement[]
}

function normalizeLabel(raw: unknown): LabelRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id || '')
    .trim()
    .toUpperCase()
  if (!id) return null
  return {
    id,
    createdAt: String(o.createdAt || o.created_at || new Date().toISOString()),
    fecha: String(o.fecha || ''),
    exportacion: String(o.exportacion || ''),
    empresa: String(o.empresa || ''),
    csg: String(o.csg || ''),
    especie: String(o.especie || ''),
    variedad: String(o.variedad || ''),
    centroCosto: String(o.centroCosto || o.centro_costo || ''),
    sector: String(o.sector || ''),
    cantidadTotes:
      o.cantidadTotes === null || o.cantidadTotes === undefined
        ? null
        : Number(o.cantidadTotes),
    jefeCuadrilla: String(o.jefeCuadrilla || o.jefe_cuadrilla || ''),
    seasonId: o.seasonId ? Number(o.seasonId) : null,
    companyId: o.companyId ? Number(o.companyId) : null,
    seasonCostCenterId: o.seasonCostCenterId ? Number(o.seasonCostCenterId) : null,
  }
}

/** Normaliza una fila de movimiento (API camelCase o snake_case de MySQL). */
export function normalizeMovementRow(raw: unknown): Movement | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const labelId = String(o.labelId || o.label_id || '')
    .trim()
    .toUpperCase()
  const type = String(o.type || '') as Movement['type']
  const cantidad = Number(o.cantidad)
  const at =
    o.at instanceof Date && !Number.isNaN(o.at.getTime())
      ? o.at.toISOString()
      : String(o.at ?? '')
  if (!labelId || (type !== 'jc' && type !== 'acopio') || !Number.isFinite(cantidad) || !at) {
    return null
  }
  const rawPrecio = o.precioClp ?? o.precio_clp
  const precio =
    rawPrecio === null || rawPrecio === undefined || rawPrecio === ''
      ? undefined
      : Number(rawPrecio)
  return {
    labelId,
    type,
    cantidad,
    at,
    registeredBy: String(o.registeredBy || o.registered_by || ''),
    precioClp: typeof precio === 'number' && Number.isFinite(precio) ? Math.floor(precio) : undefined,
  }
}

export async function fetchTrackingExportPayload(): Promise<TrackingExportPayload> {
  const res = await apiFetch('/api/reports/tracking-export')
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: string }).error)
        : `HTTP ${res.status}`
    throw new Error(`No se pudo obtener el reporte global: ${err}`)
  }
  const root = data as { labels?: unknown[]; movements?: unknown[] }
  const labels = Array.isArray(root.labels)
    ? root.labels.map(normalizeLabel).filter((x): x is LabelRecord => Boolean(x))
    : []
  const movements = Array.isArray(root.movements)
    ? root.movements.map(normalizeMovementRow).filter((x): x is Movement => Boolean(x))
    : []
  return { labels, movements }
}

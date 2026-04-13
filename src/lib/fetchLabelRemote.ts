import type { LabelRecord } from '../types'

/**
 * Plantilla de URL con marcador {{id}} (ej. https://tudominio.cl/api/label.php?id={{id}}).
 */
export function buildLabelLookupUrl(urlTemplate: string, labelId: string): string {
  const id = labelId.trim().toUpperCase()
  return urlTemplate.replace(/\{\{\s*id\s*\}\}/gi, encodeURIComponent(id))
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k]
    if (v !== undefined && v !== null) return String(v)
  }
  return ''
}

function pickNumOrNull(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k]
    if (v === undefined || v === null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Convierte JSON del API (camelCase o snake_case como en schema MySQL) a LabelRecord. */
export function normalizeRemoteLabelPayload(
  raw: unknown,
  expectedId: string,
): LabelRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const inner =
    o.label && typeof o.label === 'object'
      ? (o.label as Record<string, unknown>)
      : o

  const id = pickStr(inner, 'id', 'label_id').trim().toUpperCase() || expectedId
  if (id !== expectedId) return null

  return {
    id: expectedId,
    createdAt:
      pickStr(inner, 'createdAt', 'created_at') || new Date().toISOString(),
    fecha: pickStr(inner, 'fecha'),
    exportacion: pickStr(inner, 'exportacion', 'exportación'),
    empresa: pickStr(inner, 'empresa'),
    csg: pickStr(inner, 'csg'),
    especie: pickStr(inner, 'especie'),
    variedad: pickStr(inner, 'variedad'),
    centroCosto: pickStr(inner, 'centroCosto', 'centro_costo'),
    sector: pickStr(inner, 'sector'),
    cantidadTotes: pickNumOrNull(inner, 'cantidadTotes', 'cantidad_totes'),
    jefeCuadrilla: pickStr(inner, 'jefeCuadrilla', 'jefe_cuadrilla'),
  }
}

/**
 * GET JSON al endpoint configurado. 404 → null; otros errores → lanza.
 */
export async function fetchLabelRemote(
  labelId: string,
  urlTemplate: string,
): Promise<LabelRecord | null> {
  const id = labelId.trim().toUpperCase()
  const url = buildLabelLookupUrl(urlTemplate, id)
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const data: unknown = await res.json()
  if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
    return null
  }
  return normalizeRemoteLabelPayload(data, id)
}

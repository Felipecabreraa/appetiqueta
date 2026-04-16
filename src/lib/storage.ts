import type { LabelRecord, Movement, MovementType } from '../types'

export const LABELS_STORAGE_KEY = 'appetiquetado:labels'
export const MOVEMENTS_STORAGE_KEY = 'appetiquetado:movements'

const LABELS_KEY = LABELS_STORAGE_KEY
const MOVEMENTS_KEY = MOVEMENTS_STORAGE_KEY

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

/** Migra registros antiguos salida/llegada → jc/acopio y persiste una vez. */
function normalizeMovements(list: Movement[]): Movement[] {
  let changed = false
  const next = list.map((m) => {
    const normalizedLabelId = String(m.labelId || '')
      .trim()
      .toUpperCase()
    const t = m.type as string
    if (t === 'salida') {
      changed = true
      return { ...m, labelId: normalizedLabelId, type: 'jc' as MovementType }
    }
    if (t === 'llegada') {
      changed = true
      return { ...m, labelId: normalizedLabelId, type: 'acopio' as MovementType }
    }
    if (m.labelId !== normalizedLabelId) {
      changed = true
      return { ...m, labelId: normalizedLabelId }
    }
    return m
  })
  if (changed) {
    writeJson(MOVEMENTS_KEY, next)
  }
  return next
}

export function getLabels(): LabelRecord[] {
  const raw = readJson<LabelRecord[]>(LABELS_KEY, [])
  let changed = false
  const normalized = raw.map((l) => {
    const normalizedId = String(l.id || '')
      .trim()
      .toUpperCase()
    if (normalizedId !== l.id) changed = true
    return {
      ...l,
      id: normalizedId,
      cantidadTotes:
        l.cantidadTotes === undefined
          ? null
          : l.cantidadTotes,
      jefeCuadrilla: l.jefeCuadrilla ?? '',
    }
  })
  if (changed) {
    writeJson(LABELS_KEY, normalized)
  }
  return normalized.map((l) => ({
    ...l,
    cantidadTotes:
      l.cantidadTotes === undefined
        ? null
        : l.cantidadTotes,
    jefeCuadrilla: l.jefeCuadrilla ?? '',
  }))
}

/**
 * Guarda una etiqueta nueva. El código (id) es el identificador del QR y no puede repetirse.
 */
export function saveLabel(record: LabelRecord): void {
  saveLabelsBatch([record])
}

/**
 * Guarda varias etiquetas nuevas en una sola operación (sin duplicar ids entre sí ni con las ya guardadas).
 */
export function saveLabelsBatch(records: LabelRecord[]): void {
  if (records.length === 0) return
  const list = getLabels()
  const seen = new Set<string>()
  const normalized = records.map((r) => ({ ...r, id: r.id.trim().toUpperCase() }))
  for (const r of normalized) {
    if (seen.has(r.id)) {
      throw new Error(
        `Identificador duplicado en el lote (${r.id}). Cada etiqueta debe tener un código único.`,
      )
    }
    seen.add(r.id)
    if (list.some((l) => l.id === r.id)) {
      throw new Error(
        `El código ${r.id} ya existe: cada etiqueta debe tener un identificador único.`,
      )
    }
  }
  for (let i = normalized.length - 1; i >= 0; i--) {
    list.unshift(normalized[i]!)
  }
  writeJson(LABELS_KEY, list)
}

export function updateLabelRecord(labelId: string, patch: Partial<LabelRecord>): void {
  const id = labelId.trim().toUpperCase()
  const list = getLabels()
  const i = list.findIndex((l) => l.id === id)
  if (i < 0) return
  list[i] = { ...list[i]!, ...patch }
  writeJson(LABELS_KEY, list)
}

/** Sube la etiqueta al inicio del listado local (acceso rápido alineado con lo que se está cargando). */
export function bumpLabelAccessOrder(labelId: string): void {
  const id = labelId.trim().toUpperCase()
  const list = getLabels()
  const i = list.findIndex((l) => l.id === id)
  if (i < 0) return
  const [row] = list.splice(i, 1)
  list.unshift(row!)
  writeJson(LABELS_KEY, list)
}

export function getLabelById(id: string): LabelRecord | undefined {
  const normalized = id.trim().toUpperCase()
  return getLabels().find((l) => l.id === normalized)
}

/**
 * Inserta o actualiza una etiqueta (p. ej. tras traerla del servidor en el móvil).
 * No lanza por duplicado: fusiona con el registro existente si hay.
 */
export function upsertLabel(record: LabelRecord): void {
  const normalized: LabelRecord = {
    ...record,
    id: record.id.trim().toUpperCase(),
    jefeCuadrilla: record.jefeCuadrilla ?? '',
    cantidadTotes:
      record.cantidadTotes === undefined ? null : record.cantidadTotes,
  }
  const list = getLabels()
  const i = list.findIndex((l) => l.id === normalized.id)
  if (i >= 0) {
    list[i] = { ...list[i]!, ...normalized }
  } else {
    list.unshift(normalized)
  }
  writeJson(LABELS_KEY, list)
}

export function getMovements(): Movement[] {
  const raw = readJson<Movement[]>(MOVEMENTS_KEY, [])
  return normalizeMovements(raw)
}

export function addMovement(m: Movement): void {
  const list = getMovements()
  list.push({
    ...m,
    labelId: m.labelId.trim().toUpperCase(),
  })
  writeJson(MOVEMENTS_KEY, list)
}

export function movementsForLabel(labelId: string): Movement[] {
  const id = labelId.trim().toUpperCase()
  return getMovements().filter((m) => m.labelId === id)
}

export function totalsForLabel(labelId: string): {
  jc: number
  acopio: number
} {
  const m = movementsForLabel(labelId)
  return {
    jc: m.filter((x) => x.type === 'jc').reduce((a, x) => a + x.cantidad, 0),
    acopio: m.filter((x) => x.type === 'acopio').reduce((a, x) => a + x.cantidad, 0),
  }
}

export type OperationalPhase = 'jc' | 'acopio' | 'complete'

/** Orden cronológico por `at`. */
export function firstMovementOfType(
  labelId: string,
  type: MovementType,
): Movement | undefined {
  const id = labelId.trim().toUpperCase()
  return movementsForLabel(id)
    .filter((m) => m.type === type)
    .sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    )[0]
}

/**
 * Primer JC conocido: movimiento local o, si la etiqueta ya trae datos del servidor
 * (otro celular guardó el JC), un registro sintético para el flujo operativo.
 */
export function firstJcForLabel(label: LabelRecord): Movement | undefined {
  const id = label.id.trim().toUpperCase()
  const local = firstMovementOfType(id, 'jc')
  if (local) return local
  if (label.cantidadTotes !== null && label.cantidadTotes !== undefined) {
    return {
      labelId: id,
      type: 'jc',
      cantidad: label.cantidadTotes,
      at: label.createdAt,
      registeredBy: label.jefeCuadrilla?.trim() || undefined,
    }
  }
  return undefined
}

/**
 * Fase del flujo de dos escaneos (mismo QR): JC → acopio → completado.
 * Requiere que la etiqueta exista en este dispositivo.
 */
export function getOperationalPhase(
  labelId: string,
): OperationalPhase | 'not_found' {
  const id = labelId.trim().toUpperCase()
  const label = getLabelById(id)
  if (!label) return 'not_found'
  const hasJc =
    movementsForLabel(id).some((m) => m.type === 'jc') ||
    (label.cantidadTotes !== null && label.cantidadTotes !== undefined)
  const hasAcopio = movementsForLabel(id).some((m) => m.type === 'acopio')
  if (!hasJc) return 'jc'
  if (!hasAcopio) return 'acopio'
  return 'complete'
}

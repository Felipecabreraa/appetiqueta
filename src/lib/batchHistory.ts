import type { LabelRecord } from '../types'
import { getLabelById } from './storage'

const BATCH_KEY = 'appetiquetado:batches'
const MAX_ENTRIES = 40

export interface BatchLogEntry {
  id: string
  createdAt: string
  count: number
  labelIds: string[]
  empresa: string
  especie: string
}

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

export function appendBatchLog(records: LabelRecord[]): void {
  if (records.length === 0) return
  const r0 = records[0]!
  const entry: BatchLogEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    count: records.length,
    labelIds: records.map((r) => r.id),
    empresa: r0.empresa,
    especie: r0.especie,
  }
  const list = readJson<BatchLogEntry[]>(BATCH_KEY, [])
  list.unshift(entry)
  writeJson(BATCH_KEY, list.slice(0, MAX_ENTRIES))
}

export function getBatchHistory(): BatchLogEntry[] {
  return readJson<BatchLogEntry[]>(BATCH_KEY, [])
}

/** Recupera las etiquetas actuales por IDs (si borró datos, puede faltar alguna). */
export function resolveRecordsForBatch(entry: BatchLogEntry): LabelRecord[] {
  return entry.labelIds
    .map((id) => getLabelById(id))
    .filter((r): r is LabelRecord => r != null)
}

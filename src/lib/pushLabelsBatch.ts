import type { LabelRecord } from '../types'

export type PushResult = { ok: true } | { ok: false; message: string }

/**
 * Envía un lote recién generado al API de sincronización (MySQL vía server/index.cjs).
 */
export async function pushLabelsBatchToServer(
  records: LabelRecord[],
): Promise<PushResult> {
  if (records.length === 0) return { ok: true }
  const raw = import.meta.env.VITE_SYNC_API_BASE?.trim()
  const base = raw ? raw.replace(/\/$/, '') : ''

  const key = import.meta.env.VITE_SYNC_API_KEY?.trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (key) headers['X-Sync-Key'] = key

  try {
    const res = await fetch(`${base}/api/labels/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ labels: records }),
    })
    if (res.status === 401) {
      return { ok: false, message: 'API rechazó la clave (X-Sync-Key / VITE_SYNC_API_KEY).' }
    }
    const data: unknown = await res.json().catch(() => ({}))
    const ok = typeof data === 'object' && data !== null && (data as { ok?: boolean }).ok === true
    if (!res.ok || !ok) {
      const err =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: string }).error)
          : `HTTP ${res.status}`
      return { ok: false, message: `No se guardó en el servidor: ${err}` }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error de red'
    return {
      ok: false,
      message: `No se pudo contactar el API de etiquetas (${base}). ${msg}`,
    }
  }
}

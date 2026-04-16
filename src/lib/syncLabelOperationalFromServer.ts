import type { Movement } from '../types'
import { buildLabelLookupUrl, normalizeRemoteLabelPayload } from './fetchLabelRemote'
import { getLabelLookupUrlTemplate } from './labelApiUrl'
import { getSessionToken } from './session'
import { replaceMovementsForLabel, upsertLabel } from './storage'
import { normalizeMovementRow } from './trackingExportApi'

export type SyncLabelOperationalResult =
  | { ok: true }
  | {
      ok: false
      error: 'not_configured' | 'not_found' | 'invalid_payload' | 'http' | 'network'
    }

/**
 * Trae la etiqueta (y movimientos JC/acopio si el API los incluye) y actualiza localStorage.
 * Así la fase operativa y el acceso rápido reflejan lo guardado en el servidor desde otro dispositivo.
 */
export async function syncLabelOperationalFromServer(
  labelId: string,
): Promise<SyncLabelOperationalResult> {
  const id = labelId.trim().toUpperCase()
  const tpl = getLabelLookupUrlTemplate()?.trim()
  if (!tpl) return { ok: false, error: 'not_configured' }

  const url = buildLabelLookupUrl(tpl, id)
  const headers = new Headers({ Accept: 'application/json' })
  const token = getSessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  try {
    const res = await fetch(url, { method: 'GET', headers })
    if (res.status === 404) {
      return { ok: false, error: 'not_found' }
    }
    if (!res.ok) {
      return { ok: false, error: 'http' }
    }
    const data: unknown = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'invalid_payload' }
    }
    const root = data as {
      ok?: boolean
      error?: string
      label?: unknown
      movements?: unknown
    }
    if (root.ok === false || root.error === 'not_found') {
      return { ok: false, error: 'not_found' }
    }
    const label = normalizeRemoteLabelPayload(data, id)
    if (!label) {
      return { ok: false, error: 'invalid_payload' }
    }
    upsertLabel(label)
    if (Array.isArray(root.movements)) {
      const movements: Movement[] = root.movements
        .map(normalizeMovementRow)
        .filter((x): x is Movement => Boolean(x))
      replaceMovementsForLabel(id, movements)
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'network' }
  }
}

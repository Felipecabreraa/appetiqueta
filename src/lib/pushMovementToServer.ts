import type { Movement } from '../types'
import { apiFetch } from './apiClient'

/**
 * Sincroniza un movimiento individual al backend (MySQL).
 * Se ejecuta en segundo plano; errores se reportan por consola.
 */
export async function pushMovementToServer(movement: Movement): Promise<void> {
  try {
    const res = await apiFetch('/api/movements', {
      method: 'POST',
      body: JSON.stringify({ movement }),
    })
    if (!res.ok) {
      const data: unknown = await res.json().catch(() => ({}))
      const err =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error?: string }).error)
          : `HTTP ${res.status}`
      console.error(`[sync] movement push rejected: ${err}`)
    }
  } catch (error) {
    console.error('[sync] movement push failed', error)
  }
}

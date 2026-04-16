import type { Movement } from '../types'
import { apiFetch } from './apiClient'

export type PushMovementOptions = {
  /** Obligatorio en el servidor cuando el JC es el primero para esa etiqueta (cantidad_totes aún NULL en BD). */
  jcFirstRead?: { jefeCuadrilla: string }
}

export type PushMovementResult = { ok: true } | { ok: false; error: string }

function mapMovementError(code: string, http: number): string {
  switch (code) {
    case 'invalid_movement':
      return 'Datos de movimiento inválidos.'
    case 'label_not_found':
      return 'La etiqueta no existe en el servidor. Debe cargarse desde oficina antes de registrar lecturas.'
    case 'jc_first_read_required':
      return 'En el primer JC debe indicar el jefe de cuadrilla para guardar en el servidor.'
    case 'movements_table_missing':
      return 'El servidor no tiene la tabla de movimientos configurada.'
    case 'db':
      return 'Error de base de datos en el servidor.'
    default:
      return http === 401 || http === 403
        ? 'Sesión inválida o sin permiso para guardar lecturas.'
        : code || `Error HTTP ${http}`
  }
}

/**
 * Persiste el movimiento en MySQL (y en el primer JC actualiza cantidad_totes / jefe en la misma transacción).
 */
export async function pushMovementToServer(
  movement: Movement,
  options?: PushMovementOptions,
): Promise<PushMovementResult> {
  try {
    const body: Record<string, unknown> = { movement }
    const jefe = options?.jcFirstRead?.jefeCuadrilla?.trim()
    if (jefe) {
      body.jcFirstRead = { jefeCuadrilla: jefe }
    }
    const res = await apiFetch('/api/movements', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (res.ok) {
      return { ok: true }
    }
    const data: unknown = await res.json().catch(() => ({}))
    const code =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: string }).error)
        : ''
    const message = mapMovementError(code, res.status)
    console.error(`[sync] movement push rejected: ${code || res.status}`)
    return { ok: false, error: message }
  } catch (error) {
    console.error('[sync] movement push failed', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo conectar con el servidor.',
    }
  }
}

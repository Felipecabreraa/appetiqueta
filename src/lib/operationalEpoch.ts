import { apiFetch } from './apiClient'
import { clearLocalOperationalData } from './storage'
import { FIELD_TIMEOUT_MS, timeoutSignal } from './timeout'

const EPOCH_KEY = 'appetiquetado:operationalEpoch'

/**
 * Compara la "época operativa" del servidor con la guardada en este navegador. Si cambió (se vaciaron
 * los datos operativos con scripts/db-limpiar-operacion.mjs), borra el historial local de lotes,
 * etiquetas y lecturas. Devuelve true si limpió algo.
 */
export async function syncOperationalEpoch(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/health', { signal: timeoutSignal(FIELD_TIMEOUT_MS) })
    if (!res.ok) return false
    const data = (await res.json()) as { operationalEpoch?: string | null }
    const epoch = data.operationalEpoch
    if (!epoch) return false
    if (localStorage.getItem(EPOCH_KEY) === epoch) return false
    clearLocalOperationalData()
    localStorage.setItem(EPOCH_KEY, epoch)
    return true
  } catch {
    // Sin conexión: se conserva el historial local hasta poder verificar.
    return false
  }
}

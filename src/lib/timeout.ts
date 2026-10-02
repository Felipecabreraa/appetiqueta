/**
 * Tiempo máximo de las llamadas de terreno (lectura de etiqueta, jefes de cuadrilla, guardado de lecturas).
 * 60 s cubre el arranque en frío de Render Free; con señal mala evita que el botón quede "Guardando…" para siempre.
 */
export const FIELD_TIMEOUT_MS = 60_000

/** AbortSignal con tiempo límite; respaldo para navegadores sin AbortSignal.timeout (iOS < 16, Chrome < 103). */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

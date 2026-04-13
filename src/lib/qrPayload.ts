/**
 * URL que abre la app en Trazabilidad con el código cargado (?e=).
 * Por defecto usa el origen actual (mismo navegador / mismo equipo).
 * Para escanear desde otro dispositivo, defina VITE_APP_ORIGIN en .env (ej. http://IP:5173).
 */
export function buildTrackingUrl(labelId: string): string {
  const id = labelId.trim().toUpperCase()
  const fromEnv = import.meta.env.VITE_APP_ORIGIN?.replace(/\/$/, '')
  let base = fromEnv
  if (!base && typeof window !== 'undefined') {
    base = window.location.origin
  }
  if (!base) {
    return `/?e=${encodeURIComponent(id)}`
  }
  const u = new URL(`${base}/`)
  u.searchParams.set('e', id)
  return u.toString()
}

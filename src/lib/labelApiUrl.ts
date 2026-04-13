/**
 * URL para GET de una etiqueta (marcador {{id}}).
 * Si define VITE_LABEL_LOOKUP_URL, tiene prioridad.
 * Si solo VITE_SYNC_API_BASE, usa el endpoint del servidor Node incluido.
 */
export function getLabelLookupUrlTemplate(): string | undefined {
  const custom = import.meta.env.VITE_LABEL_LOOKUP_URL?.trim()
  if (custom) return custom
  const base = import.meta.env.VITE_SYNC_API_BASE?.trim().replace(/\/$/, '')
  if (base) return `${base}/api/labels/{{id}}`
  return '/api/labels/{{id}}'
}

export function getSyncApiBase(): string | undefined {
  const b = import.meta.env.VITE_SYNC_API_BASE?.trim().replace(/\/$/, '')
  return b || undefined
}

import type { MasterAuditUser } from '../types'

const TIME_ZONE = 'America/Santiago'

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** Fecha dd-mm-aaaa en hora de Chile; cadena vacía si el valor no es una fecha válida. */
export function formatAuditDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = dateFormatter.formatToParts(date)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('day')}-${pick('month')}-${pick('year')}`
}

/** Texto de la segunda línea de cada fila de maestros; vacío si no hay fecha válida. */
export function formatLastModified(input: {
  updatedBy?: MasterAuditUser | null
  updatedAt?: string | null
}): string {
  const fecha = formatAuditDate(input.updatedAt ?? '')
  if (!fecha) return ''
  const nombre = input.updatedBy?.name?.trim()
  return nombre ? `Modificado por ${nombre} el ${fecha}` : `Modificado el ${fecha} · sin autor registrado`
}

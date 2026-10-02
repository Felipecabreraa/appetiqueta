/** Evaluación pura (sin red) del cuerpo de GET /api/health para el smoke (CA-09, CA-10). */
export type HealthBody = {
  dbReady?: boolean
  schemaComplete?: boolean | null
  missingTables?: string[] | null
  mastersAuditReady?: boolean | null
  movementsSchemaReady?: boolean | null
  [k: string]: unknown
}

export type HealthVerdict = { ok: true } | { ok: false; motivo: string }

export function evaluateHealth(body: HealthBody | null | undefined): HealthVerdict {
  if (!body || typeof body !== 'object') return { ok: false, motivo: 'health no devolvió un cuerpo JSON válido' }
  if (body.dbReady !== true) return { ok: false, motivo: 'la BD no está lista (dbReady distinto de true)' }
  if (!('schemaComplete' in body) || body.schemaComplete === undefined) {
    return { ok: false, motivo: 'el servidor no informa el estado del esquema (versión anterior: falta schemaComplete)' }
  }
  if (body.schemaComplete === null) return { ok: false, motivo: 'el estado del esquema es desconocido (schemaComplete=null)' }
  if (body.schemaComplete !== true) {
    const faltan = Array.isArray(body.missingTables) ? body.missingTables : []
    const partes: string[] = []
    if (faltan.length) partes.push(`faltan tablas: ${faltan.join(', ')}`)
    if (body.mastersAuditReady === false) partes.push('auditoría de maestros no disponible (mastersAuditReady=false)')
    if (body.movementsSchemaReady === false) partes.push('esquema de movimientos incompleto (movementsSchemaReady=false)')
    return { ok: false, motivo: `esquema incompleto: ${partes.join('; ') || 'schemaComplete=false'}` }
  }
  return { ok: true }
}

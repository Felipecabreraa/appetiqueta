'use strict'

/**
 * Estado del esquema de la BD (solo lectura: nunca ejecuta DDL ni DML).
 * - detectSchemaState: una consulta a information_schema.COLUMNS.
 * - createSchemaMonitor: refresco con límite de frecuencia y una sola consulta en vuelo.
 */

// Las 16 tablas base, en el orden de database/schema.sql (que ya respeta las FK).
const BASE_TABLES = Object.freeze([
  'roles',
  'users',
  'auth_sessions',
  'seasons',
  'companies',
  'species',
  'varieties',
  'csg_catalog',
  'jc_foremen',
  'season_cost_centers',
  'master_import_runs',
  'labels',
  'movements',
  'batch_logs',
  'batch_log_labels',
  'app_meta',
])

const AUDIT_TABLES = [
  'seasons',
  'companies',
  'species',
  'varieties',
  'csg_catalog',
  'jc_foremen',
  'season_cost_centers',
]
const AUDIT_COLUMNS = ['created_by', 'updated_by']
const MOVEMENT_COLUMNS = ['registered_by', 'created_by', 'precio_clp', 'jh', 'client_ip', 'user_agent']
const DETECT_TIMEOUT_MS = 1500
const ROUTE_RECHECK_MS = 10_000

function buildLabelSchemaState(existingColumns) {
  const set = new Set(existingColumns)
  return {
    seasonId: set.has('season_id'),
    companyId: set.has('company_id'),
    seasonCostCenterId: set.has('season_cost_center_id'),
  }
}

function isSchemaError(err) {
  const code = err && typeof err === 'object' ? err.code : undefined
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR'
}

async function detectSchemaState(pool) {
  const [rows] = await pool.query({
    sql: `SELECT TABLE_NAME AS TABLE_NAME, COLUMN_NAME AS COLUMN_NAME
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    values: [[...BASE_TABLES]],
    timeout: DETECT_TIMEOUT_MS,
  })
  const byTable = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const table = String(row.TABLE_NAME || '').toLowerCase()
    if (!byTable.has(table)) byTable.set(table, new Set())
    byTable.get(table).add(String(row.COLUMN_NAME || '').toLowerCase())
  }
  const missingTables = BASE_TABLES.filter((t) => !byTable.has(t))
  const missingAuditColumns = []
  for (const t of AUDIT_TABLES) {
    for (const c of AUDIT_COLUMNS) {
      if (!byTable.get(t)?.has(c)) missingAuditColumns.push(`${t}.${c}`)
    }
  }
  const mastersAuditReady = missingAuditColumns.length === 0
  const movementsSchemaReady = MOVEMENT_COLUMNS.every((c) => byTable.get('movements')?.has(c))
  const labelSchema = buildLabelSchemaState([...(byTable.get('labels') || [])])
  return {
    missingTables,
    missingAuditColumns,
    mastersAuditReady,
    movementsSchemaReady,
    labelSchema,
    schemaComplete: missingTables.length === 0 && mastersAuditReady && movementsSchemaReady,
  }
}

const UNKNOWN_STATUS = Object.freeze({
  schemaComplete: null,
  missingTables: null,
  mastersAuditReady: null,
  movementsSchemaReady: null,
})

function toStatus(d) {
  return {
    schemaComplete: d.schemaComplete,
    missingTables: d.missingTables,
    mastersAuditReady: d.mastersAuditReady,
    movementsSchemaReady: d.movementsSchemaReady,
  }
}

function createSchemaMonitor({ pool, locals, now = Date.now, log = console.log }) {
  let last = null // { at, status }
  let inflight = null

  function describeChange(prev, d) {
    const parts = []
    if (!prev || JSON.stringify(prev.missingTables) !== JSON.stringify(d.missingTables)) {
      if (d.missingTables.length || (prev && prev.missingTables && prev.missingTables.length)) {
        parts.push(`faltan tablas [${d.missingTables.join(', ')}]`)
      }
    }
    if (prev && prev.mastersAuditReady !== d.mastersAuditReady) {
      const was = prev.mastersAuditReady ? 'disponible' : 'NO disponible'
      const is = d.mastersAuditReady ? 'disponible' : `NO disponible (faltan ${d.missingAuditColumns.join(', ')})`
      parts.push(`auditoría de maestros: ${was} → ${is}`)
    }
    if (prev && prev.movementsSchemaReady !== d.movementsSchemaReady) {
      parts.push(`columnas de movements: ${d.movementsSchemaReady ? 'completas' : 'incompletas'}`)
    }
    return parts
  }

  async function detect() {
    let d
    try {
      d = await detectSchemaState(pool)
    } catch (err) {
      log(`[schema] No se pudo detectar el estado del esquema: ${err?.code || ''} ${err?.message || err}`.trim())
      const status = { ...UNKNOWN_STATUS }
      if (locals) locals.schemaStatus = status
      last = { at: now(), status, detected: null }
      return last
    }
    const prev = last?.detected || null
    const parts = prev ? describeChange(prev, d) : []
    if (parts.length) {
      log(
        `[schema] Cambio de esquema detectado en caliente: ${parts.join('; ')}. Reinicie el servicio para reaplicar las migraciones.`,
      )
    }
    const status = toStatus(d)
    if (locals) {
      locals.labelSchema = d.labelSchema
      locals.mastersAuditReady = d.mastersAuditReady
      locals.schemaStatus = status
    }
    last = { at: now(), status, detected: d }
    return last
  }

  async function refresh({ maxAgeMs = 0 } = {}) {
    if (!pool) {
      const status = { ...UNKNOWN_STATUS }
      if (locals) locals.schemaStatus = status
      return status
    }
    if (inflight) return (await inflight).status
    if (last && now() - last.at < maxAgeMs) return last.status
    inflight = detect().finally(() => {
      inflight = null
    })
    return (await inflight).status
  }

  async function onRouteError(err, routeName) {
    if (!isSchemaError(err)) return false
    log(`[schema] ${routeName}: ${err.code} ${err.sqlMessage || err.message || ''}`.trim())
    const before = {
      audit: locals ? locals.mastersAuditReady : undefined,
      labels: locals ? JSON.stringify(locals.labelSchema) : undefined,
    }
    const t0 = last?.at
    await refresh({ maxAgeMs: ROUTE_RECHECK_MS })
    if (last?.at === t0 || !locals) return false
    return before.audit !== locals.mastersAuditReady || before.labels !== JSON.stringify(locals.labelSchema)
  }

  return { refresh, onRouteError }
}

module.exports = {
  BASE_TABLES,
  buildLabelSchemaState,
  detectSchemaState,
  isSchemaError,
  createSchemaMonitor,
}

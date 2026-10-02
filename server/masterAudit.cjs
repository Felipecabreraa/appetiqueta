'use strict'

/**
 * Auditoría por registro de los maestros (created_by / updated_by).
 * Lógica pura y migración idempotente; sin efectos al importarse.
 * Los nombres de tabla/columna salen siempre de constantes del código, nunca del usuario.
 */

const MASTER_AUDIT_TABLES = [
  { table: 'seasons', prefix: 'seasons' },
  { table: 'companies', prefix: 'companies' },
  { table: 'species', prefix: 'species' },
  { table: 'varieties', prefix: 'varieties' },
  { table: 'csg_catalog', prefix: 'csg' },
  { table: 'jc_foremen', prefix: 'jc_foremen' },
  { table: 'season_cost_centers', prefix: 'scc' },
]

const AUDIT_COLUMNS = ['created_by', 'updated_by']
const ALREADY_EXISTS = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_DUP_KEY'])

function isAlreadyExists(err) {
  // MariaDB informa una FK duplicada como errno 121.
  return ALREADY_EXISTS.has(err?.code) || /errno:?\s*121/i.test(String(err?.message || ''))
}

async function ensureMastersAuditSchema(pool) {
  let ready = true
  for (const { table, prefix } of MASTER_AUDIT_TABLES) {
    try {
      const readColumns = async () => {
        const [rows] = await pool.query(
          'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
          [table],
        )
        return new Set(rows.map((r) => r.COLUMN_NAME))
      }
      const tolerant = async (sql, label, fatal) => {
        try {
          await pool.query(sql)
        } catch (err) {
          if (isAlreadyExists(err)) return
          if (fatal) throw err
          console.warn(`[sync-api] ensureMastersAuditSchema ${table} ${label}:`, err.message || err)
        }
      }

      const columns = await readColumns()
      if (columns.size === 0) {
        ready = false
        continue
      }
      for (const col of AUDIT_COLUMNS) {
        if (!columns.has(col)) {
          await tolerant(`ALTER TABLE ${table} ADD COLUMN ${col} BIGINT UNSIGNED NULL`, col, true)
        }
      }

      const [idxRows] = await pool.query(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table],
      )
      const indexes = new Set(idxRows.map((r) => r.INDEX_NAME))
      for (const col of AUDIT_COLUMNS) {
        const name = `idx_${prefix}_${col}`
        if (!indexes.has(name)) {
          await tolerant(`ALTER TABLE ${table} ADD KEY ${name} (${col})`, name, false)
        }
      }

      const [fkRows] = await pool.query(
        'SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table],
      )
      const fks = new Set(fkRows.map((r) => r.CONSTRAINT_NAME))
      for (const col of AUDIT_COLUMNS) {
        const name = `fk_${prefix}_${col}`
        if (!fks.has(name)) {
          // La FK no es requisito del flag: si falla (p. ej. falta REFERENCES) se avisa y se sigue.
          await tolerant(
            `ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE`,
            name,
            false,
          )
        }
      }

      const finalColumns = await readColumns()
      if (!AUDIT_COLUMNS.every((c) => finalColumns.has(c))) ready = false
    } catch (err) {
      console.error(`[sync-api] ensureMastersAuditSchema ${table}:`, err.message || err)
      ready = false
    }
  }
  console.log(
    ready
      ? '[sync-api] Auditoría de maestros lista (7 tablas).'
      : '[sync-api] AVISO: auditoría de maestros NO disponible; Maestros funciona sin autor (mastersAuditReady=false).',
  )
  return ready
}

const cmp = (col, expr, text) =>
  text ? `CAST(${col} AS BINARY) <=> CAST(${expr} AS BINARY)` : `${col} <=> ${expr}`

function buildAuditedUpdate(table, cols, { audit }) {
  const assigns = cols.map((c) => `${c.name} = ?`).join(', ')
  if (!audit) {
    return {
      sql: `UPDATE ${table} SET ${assigns} WHERE id = ?`,
      params: (values, _userId, id) => [...values, id],
    }
  }
  // updated_by va primero: el SET se evalúa de izquierda a derecha y así compara contra la fila vigente.
  const cond = cols.map((c) => cmp(c.name, '?', c.text)).join(' AND ')
  return {
    sql: `UPDATE ${table} SET updated_by = IF(${cond}, updated_by, ?), ${assigns} WHERE id = ?`,
    params: (values, userId, id) => [...values, userId, ...values, id],
  }
}

function buildAuditedInsert(table, cols, { audit }) {
  const names = cols.map((c) => c.name)
  const marks = cols.map(() => '?')
  if (!audit) {
    return {
      sql: `INSERT INTO ${table} (${names.join(', ')}) VALUES (${marks.join(', ')})`,
      params: (values) => [...values],
    }
  }
  return {
    sql: `INSERT INTO ${table} (${[...names, 'created_by', 'updated_by'].join(', ')}) VALUES (${[...marks, '?', '?'].join(', ')})`,
    params: (values, userId) => [...values, userId, userId],
  }
}

function buildImportChangeCondition(cols) {
  return cols.map((c) => cmp(c.col, c.expr, c.text)).join(' AND ')
}

function buildImportAuditClause(cols, { audit }) {
  if (!audit) return ''
  const cond = buildImportChangeCondition(cols)
  return `updated_by = IF(${cond}, updated_by, NULL)`
}

function buildUnsetCurrentSeason({ audit, actor }) {
  // El filtro is_current = 1 es obligatorio: no se debe tocar filas que no cambian (P4).
  if (!audit) {
    return {
      sql: 'UPDATE seasons SET is_current = 0 WHERE code <> ? AND is_current = 1',
      params: (code) => [code],
    }
  }
  if (actor === 'import') {
    return {
      sql: 'UPDATE seasons SET updated_by = NULL, is_current = 0 WHERE code <> ? AND is_current = 1',
      params: (code) => [code],
    }
  }
  return {
    sql: 'UPDATE seasons SET updated_by = ?, is_current = 0 WHERE code <> ? AND is_current = 1',
    params: (code, userId) => [userId, code],
  }
}

function auditSelect(alias, ready) {
  const ms = `ROUND(UNIX_TIMESTAMP(${alias}.created_at) * 1000) AS created_at_ms, ROUND(UNIX_TIMESTAMP(${alias}.updated_at) * 1000) AS updated_at_ms`
  if (!ready) return ms
  return (
    `${alias}.created_by, ${alias}.updated_by, ` +
    "COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.username) AS created_by_name, " +
    "COALESCE(NULLIF(TRIM(uu.full_name), ''), uu.username) AS updated_by_name, " +
    ms
  )
}

function auditJoins(alias, ready) {
  if (!ready) return ''
  return `LEFT JOIN users cu ON cu.id = ${alias}.created_by LEFT JOIN users uu ON uu.id = ${alias}.updated_by`
}

function authorOf(id, name) {
  if (id == null || name == null) return null
  const n = Number(id)
  if (!Number.isFinite(n)) return null
  return { id: n, name: String(name) }
}

function isoFromMs(v) {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return null
  return new Date(n).toISOString()
}

function mapAuditRow(row) {
  const {
    created_by: createdById,
    updated_by: updatedById,
    created_by_name: createdByName,
    updated_by_name: updatedByName,
    created_at_ms: createdAtMs,
    updated_at_ms: updatedAtMs,
    ...rest
  } = row
  return {
    ...rest,
    createdBy: authorOf(createdById, createdByName),
    updatedBy: authorOf(updatedById, updatedByName),
    createdAt: isoFromMs(createdAtMs),
    updatedAt: isoFromMs(updatedAtMs),
  }
}

function normalizeSeasonDate(v) {
  if (v === undefined || v === null) return { valid: true, value: null }
  if (typeof v !== 'string') return { valid: false }
  const text = v.trim()
  if (text === '') return { valid: true, value: null }
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)
  if (!m) return { valid: false }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return { valid: false }
  }
  return { valid: true, value: `${m[1]}-${m[2]}-${m[3]}` }
}

module.exports = {
  MASTER_AUDIT_TABLES,
  ensureMastersAuditSchema,
  buildAuditedUpdate,
  buildAuditedInsert,
  buildImportAuditClause,
  buildImportChangeCondition,
  buildUnsetCurrentSeason,
  auditSelect,
  auditJoins,
  mapAuditRow,
  normalizeSeasonDate,
}

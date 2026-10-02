'use strict'

/**
 * Arranque del esquema: crea las tablas base que falten (solo CREATE TABLE IF NOT EXISTS,
 * tomadas de database/schema.sql), siembra datos base y aplica las migraciones aditivas.
 * Nunca lanza: un error se registra y el servidor sigue (el pool no se anula por errores de esquema).
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { ensureMastersAuditSchema } = require('./masterAudit.cjs')

const DEFAULT_SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql')
const DESTRUCTIVE = /\b(DROP|TRUNCATE|DELETE|RENAME|ALTER)\b/i
const CREATE_RE = /^CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(/i

function defaultPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hashed = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hashed}`
}

/**
 * Extrae de schema.sql solo las sentencias CREATE TABLE IF NOT EXISTS, en el orden del archivo.
 * Regla de formato: cada sentencia termina en `;` al final de línea y no hay `;` dentro de un COMMENT.
 */
function parseBaseTables(sqlText) {
  const text = String(sqlText || '')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
  const out = []
  for (const raw of text.split(/;\s*$/m)) {
    const sql = raw.trim()
    const match = CREATE_RE.exec(sql)
    if (!match) continue
    // Red de seguridad (CA-04): se ignoran los literales ('...') y las acciones ON DELETE / ON UPDATE.
    const scan = sql
      .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
      .replace(/\bON\s+(DELETE|UPDATE)\b/gi, 'ON _')
    if (DESTRUCTIVE.test(scan)) {
      throw new Error(`Sentencia no permitida en la definición de la tabla ${match[1]}`)
    }
    out.push({ name: match[1], sql })
  }
  return out
}

async function ensureBaseTables(pool, { log = console.log, schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
  const result = { created: [], failed: [] }
  let text
  try {
    text = fs.readFileSync(schemaPath, 'utf8')
  } catch (err) {
    log(`[schema] ERROR: no se pudo leer database/schema.sql (${err?.message || err})`)
    return result
  }
  let tables
  try {
    tables = parseBaseTables(text)
  } catch (err) {
    log(`[schema] ERROR: el parser rechazó database/schema.sql, no se crea ninguna tabla (${err?.message || err})`)
    return result
  }
  let existing
  try {
    const [rows] = await pool.query(
      'SELECT TABLE_NAME AS TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    )
    existing = new Set((Array.isArray(rows) ? rows : []).map((r) => String(r.TABLE_NAME || '').toLowerCase()))
  } catch (err) {
    log(`[schema] ERROR al listar las tablas existentes (${err?.code || ''}): ${err?.message || err}`)
    return result
  }
  for (const { name, sql } of tables) {
    if (existing.has(name.toLowerCase())) continue
    try {
      await pool.query(sql)
      result.created.push(name)
      log(`[schema] Tabla creada: ${name}`)
    } catch (err) {
      const code = err?.code || ''
      result.failed.push({ table: name, code })
      log(`[schema] ERROR al crear la tabla ${name} (${code}): ${err?.message || err}`)
    }
  }
  return result
}

/**
 * Bases existentes pueden tener `movements` sin columnas nuevas del esquema actual.
 * Alinea columnas usadas por POST /api/movements y GET tracking-export.
 */
async function ensureMovementsSchema(pool) {
  try {
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movements'`,
    )
    if (!Array.isArray(rows) || rows.length === 0) return
    const set = new Set(rows.map((r) => r.COLUMN_NAME))
    if (!set.has('registered_by')) {
      await pool.execute(
        `ALTER TABLE movements ADD COLUMN registered_by VARCHAR(120) NOT NULL DEFAULT ''`,
      )
      set.add('registered_by')
    }
    if (!set.has('created_by')) {
      await pool.execute(`ALTER TABLE movements ADD COLUMN created_by BIGINT UNSIGNED NULL`)
      set.add('created_by')
    }
    if (!set.has('precio_clp')) {
      await pool.execute(`ALTER TABLE movements ADD COLUMN precio_clp INT UNSIGNED NULL`)
      set.add('precio_clp')
    }
    if (!set.has('jh')) {
      await pool.execute(`ALTER TABLE movements ADD COLUMN jh INT UNSIGNED NULL`)
      set.add('jh')
    }
    if (!set.has('client_ip')) {
      await pool.execute(`ALTER TABLE movements ADD COLUMN client_ip VARCHAR(45) NULL`)
      set.add('client_ip')
    }
    if (!set.has('user_agent')) {
      await pool.execute(`ALTER TABLE movements ADD COLUMN user_agent VARCHAR(255) NULL`)
      set.add('user_agent')
    }
    const [idxRows] = await pool.execute(
      `SELECT 1 AS ok FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'movements' AND INDEX_NAME = 'idx_movements_created_by'
       LIMIT 1`,
    )
    if ((!Array.isArray(idxRows) || idxRows.length === 0) && set.has('created_by')) {
      try {
        await pool.execute(`ALTER TABLE movements ADD KEY idx_movements_created_by (created_by)`)
      } catch (err) {
        if (!(err && typeof err === 'object' && err.code === 'ER_DUP_KEYNAME')) {
          console.warn('[sync-api] ensureMovementsSchema índice created_by:', err.message || err)
        }
      }
    }
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : ''
    if (code === 'ER_NO_SUCH_TABLE') return
    console.warn('[sync-api] ensureMovementsSchema:', error.message || error)
  }
}

async function step(label, log, fn) {
  try {
    await fn()
  } catch (err) {
    log(`[schema] ERROR en ${label} (${err?.code || ''}): ${err?.message || err}`)
  }
}

/** Datos base. Cada paso está aislado: si uno falla, los demás igual se intentan. */
async function ensureBaseData(pool, { log = console.log, createPasswordHash = defaultPasswordHash } = {}) {
  // Época operativa: cambia cuando se vacían los datos operativos (scripts/db-limpiar-operacion.mjs).
  // Los navegadores la comparan con la suya y, si difiere, borran su historial local de lotes/etiquetas.
  await step('la época operativa', log, async () => {
    await pool.execute(
      `INSERT IGNORE INTO app_meta (meta_key, meta_value) VALUES ('operational_epoch', ?)`,
      [new Date().toISOString()],
    )
  })

  await step('el upsert de roles', log, async () => {
    await pool.execute(
      `INSERT INTO roles (code, name, description)
       VALUES
         ('superadmin', 'SuperAdmin', 'Control total del sistema'),
         ('admin', 'Admin', 'Gestión operativa y administrativa'),
         ('operador', 'Operador', 'Captura operativa restringida')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description)`,
    )
  })

  await step('el usuario superadmin', log, async () => {
    const username = (process.env.SUPERADMIN_USERNAME || 'superadmin').trim()
    const password = (process.env.SUPERADMIN_PASSWORD || '').trim()
    const fullName = (process.env.SUPERADMIN_NAME || 'Super Administrador').trim()

    const [roleRows] = await pool.execute('SELECT id FROM roles WHERE code = ? LIMIT 1', ['superadmin'])
    const roleId = roleRows[0]?.id
    if (!roleId) return

    const [userRows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username])
    if (userRows.length === 0 && !password) {
      console.warn(
        `[sync-api] SUPERADMIN_PASSWORD no definido: no se crea el usuario ${username} (no se usa una clave por defecto).`,
      )
      return
    }
    if (userRows.length === 0) {
      await pool.execute(
        `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [username, fullName, createPasswordHash(password), roleId],
      )
      console.log(`[sync-api] Usuario SuperAdmin inicial creado: ${username}`)
    }
  })
}

/**
 * Orquesta el arranque. Nunca lanza.
 * Devuelve { created, failed, mastersAuditReady }.
 */
async function bootstrapSchema(pool, { log = console.log, createPasswordHash, schemaPath } = {}) {
  let tables = { created: [], failed: [] }
  let mastersAuditReady = false
  try {
    tables = await ensureBaseTables(pool, { log, schemaPath })
  } catch (err) {
    log(`[schema] ERROR inesperado al crear las tablas base: ${err?.message || err}`)
  }
  await ensureBaseData(pool, { log, createPasswordHash })
  await step('ensureMovementsSchema', log, () => ensureMovementsSchema(pool))
  try {
    mastersAuditReady = Boolean(await ensureMastersAuditSchema(pool))
  } catch (err) {
    log(`[schema] ERROR en la auditoría de maestros: ${err?.message || err}`)
  }
  return { created: tables.created, failed: tables.failed, mastersAuditReady }
}

module.exports = {
  parseBaseTables,
  ensureBaseTables,
  ensureBaseData,
  ensureMovementsSchema,
  bootstrapSchema,
}

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')
const { checkEnvironment } = require('./envGuard.cjs')
const {
  buildAuditedUpdate,
  buildAuditedInsert,
  buildImportAuditClause,
  buildUnsetCurrentSeason,
  auditSelect,
  auditJoins,
  mapAuditRow,
  normalizeSeasonDate,
} = require('./masterAudit.cjs')
const { bootstrapSchema } = require('./schemaBootstrap.cjs')
const { buildLabelSchemaState, createSchemaMonitor } = require('./schemaState.cjs')
const { createRateLimiter, limitFromEnv, clientIpOf } = require('./rateLimit.cjs')

const PORT = Number(process.env.PORT || process.env.SYNC_API_PORT || 3001)
const distPath = path.join(__dirname, '..', 'dist')
const SYNC_API_KEY = (process.env.SYNC_API_KEY || '').trim()
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12)

const ROLE = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  OPERADOR: 'operador',
}

const ACCESS = {
  CATALOG: [ROLE.SUPERADMIN, ROLE.ADMIN, ROLE.OPERADOR],
  LABEL_BATCH: [ROLE.SUPERADMIN, ROLE.ADMIN, ROLE.OPERADOR],
  TRACKING_EXPORT: [ROLE.SUPERADMIN, ROLE.ADMIN],
  MASTER_ADMIN: [ROLE.SUPERADMIN, ROLE.ADMIN],
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hashed = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hashed}`
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':')
  if (!salt || !expected) return false
  const actual = crypto.scryptSync(password, salt, 64).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

function normalizeMasterName(value) {
  return String(value || '').trim()
}

function normalizeLimitedText(value, maxLength) {
  return normalizeMasterName(value).slice(0, maxLength)
}

function toCode(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase()
  return text.replace(/\s+/g, '_') || 'N/A'
}

function toBit(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === '1' || value === 1 || String(value).toLowerCase() === 'true') return 1
  return 0
}

function requireSyncKey(req, res, next) {
  if (!SYNC_API_KEY) return next()
  const sent = (req.get('x-sync-key') || '').trim()
  if (sent !== SYNC_API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }
  next()
}

async function createPool() {
  const host = process.env.MYSQL_HOST || 'localhost'
  const user = process.env.MYSQL_USER
  const password = process.env.MYSQL_PASSWORD ?? ''
  const database = process.env.MYSQL_DATABASE
  if (!user || !database) {
    console.warn('[sync-api] Configure MYSQL_USER y MYSQL_DATABASE para habilitar la API.')
    return null
  }
  const pool = mysql.createPool({
    host,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: false,
  })
  try {
    const conn = await pool.getConnection()
    await conn.ping()
    conn.release()
    return pool
  } catch (error) {
    console.error('[sync-api] No fue posible conectar a MySQL en el arranque:', error)
    try {
      await pool.end()
    } catch {
      // Ignorado: el pool puede no estar completamente inicializado.
    }
    return null
  }
}

/** Si la BD rechaza la conexión se responde 503 en vez de dejar una promesa rechazada que tumba el proceso. */
async function getConnectionOr503(pool, res) {
  try {
    return await pool.getConnection()
  } catch (error) {
    console.error('[sync-api] No se obtuvo conexión a la BD:', error.code || error.message || error)
    res.status(503).json({ ok: false, error: 'db_unavailable' })
    return null
  }
}

function requireDb(pool, res) {
  if (pool) return true
  res.status(503).json({ ok: false, error: 'db_not_configured' })
  return false
}

/**
 * Resuelve sesión Bearer si el token es válido; si no hay token o es inválido devuelve null.
 */
async function resolveBearerAuth(pool, req) {
  const header = req.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return null
  const tokenHash = hashToken(token)
  const [rows] = await pool.execute(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, u.username, u.full_name, u.is_active, r.code AS role
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     INNER JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ? AND s.expires_at > NOW(3)
     LIMIT 1`,
    [tokenHash],
  )
  const row = rows[0]
  if (!row || Number(row.is_active) !== 1) return null
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
  }
}

async function authMiddleware(req, res, next) {
  const pool = req.app.locals.pool
  if (!pool) return res.status(503).json({ ok: false, error: 'db_not_configured' })
  try {
    const auth = await resolveBearerAuth(pool, req)
    if (!auth) {
      const header = req.get('authorization') || ''
      const hasBearer = /^Bearer\s+\S+/i.test(header)
      return res.status(401).json({ ok: false, error: hasBearer ? 'invalid_session' : 'missing_token' })
    }
    req.auth = auth
    next()
  } catch (error) {
    console.error('[sync-api] auth middleware', error)
    res.status(500).json({ ok: false, error: 'db' })
  }
}

/** Para rutas usadas desde el flujo QR (?e=) sin login: no exige token. */
async function optionalAuthMiddleware(req, res, next) {
  const pool = req.app.locals.pool
  if (!pool) return res.status(503).json({ ok: false, error: 'db_not_configured' })
  try {
    req.auth = await resolveBearerAuth(pool, req)
    next()
  } catch (error) {
    console.error('[sync-api] optionalAuth middleware', error)
    res.status(500).json({ ok: false, error: 'db' })
  }
}

function requireRoles(...allowed) {
  return (req, res, next) => {
    const role = req.auth?.role
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' })
    }
    next()
  }
}

function normalizeLabelInput(item) {
  const id = String(item?.id || '')
    .trim()
    .toUpperCase()
  if (!id || id.length > 64) return null
  const createdAt = item?.createdAt ? new Date(item.createdAt) : new Date()
  if (Number.isNaN(createdAt.getTime())) return null
  const cantidad = item?.cantidadTotes
  const cantidadTotes =
    cantidad === null || cantidad === undefined || cantidad === '' ? null : Number(cantidad)
  if (cantidadTotes !== null && !Number.isFinite(cantidadTotes)) return null
  return {
    id,
    createdAt,
    fecha: normalizeLimitedText(item?.fecha, 64),
    exportacion: normalizeLimitedText(item?.exportacion, 255),
    empresa: normalizeLimitedText(item?.empresa, 255),
    csg: normalizeLimitedText(item?.csg, 255),
    especie: normalizeLimitedText(item?.especie, 255),
    variedad: normalizeLimitedText(item?.variedad, 255),
    centroCosto: normalizeLimitedText(item?.centroCosto ?? item?.centro_costo, 255),
    sector: normalizeLimitedText(item?.sector, 255),
    cantidadTotes,
    jefeCuadrilla: normalizeLimitedText(item?.jefeCuadrilla ?? item?.jefe_cuadrilla, 255),
    seasonId: item?.seasonId ? Number(item.seasonId) : null,
    companyId: item?.companyId ? Number(item.companyId) : null,
    seasonCostCenterId: item?.seasonCostCenterId ? Number(item.seasonCostCenterId) : null,
  }
}

const MIN_PASSWORD_LENGTH = 8
const MAX_TOTES = 100_000
const MAX_PRECIO_CLP = 100_000_000
const MAX_JH = 10_000

function normalizeMovementInput(item) {
  const labelId = String(item?.labelId || item?.label_id || '')
    .trim()
    .toUpperCase()
  if (!labelId || labelId.length > 64) return null

  const type = String(item?.type || '')
    .trim()
    .toLowerCase()
  if (type !== 'jc' && type !== 'acopio') return null

  // Enteros exactos: nunca se redondea en silencio lo que ingresó el operario.
  const cantidad = Number(item?.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > MAX_TOTES) return null
  if (type === 'jc' && cantidad < 1) return null

  // La hora la fija el servidor: el reloj del celular puede estar mal configurado.
  const at = new Date()

  const registeredBy = normalizeLimitedText(item?.registeredBy ?? item?.registered_by, 120)
  const rawPrecio = item?.precioClp ?? item?.precio_clp
  const precioClp =
    rawPrecio === null || rawPrecio === undefined || rawPrecio === ''
      ? null
      : Number(rawPrecio)
  if (precioClp !== null && (!Number.isInteger(precioClp) || precioClp < 0 || precioClp > MAX_PRECIO_CLP)) return null

  const rawJh = item?.jh
  const jh =
    rawJh === null || rawJh === undefined || rawJh === ''
      ? null
      : Number(rawJh)
  if (jh !== null && (!Number.isInteger(jh) || jh < 0 || jh > MAX_JH)) return null

  return {
    labelId,
    type,
    cantidad,
    at,
    registeredBy,
    precioClp,
    jh,
  }
}

async function insertLabelRecord(conn, payload, resolved, createdBy, labelSchema) {
  const values = [payload.id, payload.createdAt, payload.fecha, payload.exportacion]
  if (labelSchema.seasonId) values.push(resolved.seasonId)
  if (labelSchema.companyId) values.push(resolved.companyId)
  if (labelSchema.seasonCostCenterId) values.push(resolved.seasonCostCenterId)
  values.push(
    resolved.empresa,
    resolved.csg,
    resolved.especie,
    resolved.variedad,
    resolved.centroCosto,
    payload.sector,
    payload.cantidadTotes,
    payload.jefeCuadrilla,
    createdBy,
  )
  await conn.execute(getLabelInsertSql(labelSchema), values)
}

async function insertLabelRecordWithFallback(conn, payload, resolved, createdBy, labelSchema) {
  try {
    await insertLabelRecord(conn, payload, resolved, createdBy, labelSchema)
  } catch (error) {
    const fkViolation =
      error &&
      typeof error === 'object' &&
      (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_ROW_IS_REFERENCED_2')
    if (!fkViolation) throw error
    await insertLabelRecord(
      conn,
      payload,
      {
        ...resolved,
        seasonId: null,
        companyId: null,
        seasonCostCenterId: null,
      },
      createdBy,
      labelSchema,
    )
  }
}

async function resolveLabelCatalog(conn, payload) {
  if (!payload.seasonCostCenterId) {
    return {
      seasonId: payload.seasonId,
      companyId: payload.companyId,
      empresa: payload.empresa,
      csg: payload.csg,
      especie: payload.especie,
      variedad: payload.variedad,
      centroCosto: payload.centroCosto,
      seasonCostCenterId: null,
    }
  }
  const [rows] = await conn.execute(
    `SELECT
       scc.id,
       scc.season_id,
       scc.company_id,
       c.name AS empresa,
       cs.name AS csg,
       sp.name AS especie,
       v.name AS variedad,
       scc.center_code AS centro_costo
     FROM season_cost_centers scc
     INNER JOIN companies c ON c.id = scc.company_id
     INNER JOIN csg_catalog cs ON cs.id = scc.csg_id
     INNER JOIN species sp ON sp.id = scc.species_id
     INNER JOIN varieties v ON v.id = scc.variety_id
     WHERE scc.id = ? AND scc.is_active = 1
     LIMIT 1`,
    [payload.seasonCostCenterId],
  )
  if (!rows.length) throw new Error('invalid_master_relation')
  const row = rows[0]
  return {
    seasonId: row.season_id,
    companyId: row.company_id,
    empresa: row.empresa,
    csg: row.csg,
    especie: row.especie,
    variedad: row.variedad,
    centroCosto: row.centro_costo,
    seasonCostCenterId: row.id,
  }
}

const withAuditClause = (clause) => (clause ? `${clause},` : '')

async function upsertByCodeAndName(conn, table, code, name, audit) {
  const safeCode = toCode(code || name)
  const safeName = normalizeMasterName(name || code)
  const clause = buildImportAuditClause(
    [
      { col: 'name', expr: 'VALUES(name)', text: true },
      { col: 'is_active', expr: '1' },
    ],
    { audit },
  )
  await conn.execute(
    `INSERT INTO ${table} (code, name, is_active)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE
       ${withAuditClause(clause)}
       name = VALUES(name),
       is_active = 1`,
    [safeCode, safeName],
  )
  const [rows] = await conn.execute(`SELECT id FROM ${table} WHERE code = ? LIMIT 1`, [safeCode])
  return rows[0]?.id
}

async function resolveVariety(conn, speciesId, varietyName, audit) {
  const code = toCode(varietyName)
  const name = normalizeMasterName(varietyName)
  const clause = buildImportAuditClause(
    [
      { col: 'name', expr: 'VALUES(name)', text: true },
      { col: 'species_id', expr: 'VALUES(species_id)' },
      { col: 'is_active', expr: '1' },
    ],
    { audit },
  )
  await conn.execute(
    `INSERT INTO varieties (code, name, species_id, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       ${withAuditClause(clause)}
       name = VALUES(name),
       species_id = VALUES(species_id),
       is_active = 1`,
    [code, name, speciesId],
  )
  const [rows] = await conn.execute('SELECT id FROM varieties WHERE code = ? LIMIT 1', [code])
  return rows[0]?.id
}

async function resolveSeason(conn, seasonInput, audit) {
  const code = toCode(seasonInput?.code || seasonInput?.name || 'TEMPORADA_GENERAL')
  const name = normalizeMasterName(seasonInput?.name || seasonInput?.code || 'Temporada general')
  const isCurrent = seasonInput?.isCurrent ? 1 : 0
  const clause = buildImportAuditClause(
    [
      { col: 'name', expr: 'VALUES(name)', text: true },
      { col: 'is_current', expr: 'VALUES(is_current)' },
      { col: 'is_active', expr: '1' },
    ],
    { audit },
  )
  await conn.execute(
    `INSERT INTO seasons (code, name, is_current, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       ${withAuditClause(clause)}
       name = VALUES(name),
       is_current = VALUES(is_current),
       is_active = 1`,
    [code, name, isCurrent],
  )
  if (isCurrent === 1) {
    const unset = buildUnsetCurrentSeason({ audit, actor: 'import' })
    await conn.execute(unset.sql, unset.params(code))
    await conn.execute('UPDATE seasons SET is_current = 1 WHERE code = ?', [code])
  }
  const [rows] = await conn.execute('SELECT id FROM seasons WHERE code = ? LIMIT 1', [code])
  return rows[0]?.id
}

// Alta o edición manual de un maestro, con autor tomado solo de la sesión (nunca del cuerpo).
// `executor` es el pool o una conexión de transacción. insertCols/insertValues solo difieren
// de cols/values cuando el alta fija columnas que la edición no toca (p. ej. source).
async function saveMaster(executor, audit, userId, table, cols, values, id, insertCols = cols, insertValues = values) {
  if (id) {
    const upd = buildAuditedUpdate(table, cols, { audit })
    await executor.execute(upd.sql, upd.params(values, userId, id))
  } else {
    const ins = buildAuditedInsert(table, insertCols, { audit })
    await executor.execute(ins.sql, ins.params(insertValues, userId))
  }
}

const CODE_NAME_COLS = [{ name: 'code', text: true }, { name: 'name', text: true }, { name: 'is_active' }]

async function fetchMastersBundle(pool, audit) {
  const ready = Boolean(audit)
  const sel = (alias) => auditSelect(alias, ready)
  const joins = (alias) => auditJoins(alias, ready)
  const map = (rows) => rows.map(mapAuditRow)
  const [seasons] = await pool.execute(
    `SELECT t.id, t.code, t.name,
            DATE_FORMAT(t.starts_on, '%Y-%m-%d') AS starts_on,
            DATE_FORMAT(t.ends_on, '%Y-%m-%d') AS ends_on,
            t.is_current, t.is_active, ${sel('t')}
     FROM seasons t ${joins('t')}
     ORDER BY t.is_current DESC, t.code DESC`,
  )
  const simple = async (table) => {
    const [rows] = await pool.execute(
      `SELECT t.id, t.code, t.name, t.is_active, ${sel('t')}
       FROM ${table} t ${joins('t')}
       ORDER BY t.name`,
    )
    return rows
  }
  const companies = await simple('companies')
  const species = await simple('species')
  const csg = await simple('csg_catalog')
  const jcForemen = await simple('jc_foremen')
  const [varieties] = await pool.execute(
    `SELECT v.id, v.code, v.name, v.species_id, s.name AS species_name, v.is_active, ${sel('v')}
     FROM varieties v
     INNER JOIN species s ON s.id = v.species_id
     ${joins('v')}
     ORDER BY s.name, v.name`,
  )
  const [relations] = await pool.execute(
    `SELECT
       scc.id, scc.season_id, se.code AS season_code,
       scc.company_id, c.name AS company_name,
       scc.center_code, scc.center_name,
       scc.species_id, sp.name AS species_name,
       scc.variety_id, v.name AS variety_name,
       scc.csg_id, cs.name AS csg_name,
       scc.is_active, ${sel('scc')}
     FROM season_cost_centers scc
     INNER JOIN seasons se ON se.id = scc.season_id
     INNER JOIN companies c ON c.id = scc.company_id
     INNER JOIN species sp ON sp.id = scc.species_id
     INNER JOIN varieties v ON v.id = scc.variety_id
     INNER JOIN csg_catalog cs ON cs.id = scc.csg_id
     ${joins('scc')}
     ORDER BY se.code DESC, c.name, scc.center_code`,
  )
  return {
    seasons: map(seasons),
    companies: map(companies),
    species: map(species),
    csg: map(csg),
    jcForemen: map(jcForemen),
    varieties: map(varieties),
    relations: map(relations),
  }
}

function getLabelInsertSql(labelSchema) {
  const optionalColumns = []
  if (labelSchema.seasonId) optionalColumns.push('season_id')
  if (labelSchema.companyId) optionalColumns.push('company_id')
  if (labelSchema.seasonCostCenterId) optionalColumns.push('season_cost_center_id')
  const columns = [
    'id',
    'created_at',
    'fecha',
    'exportacion',
    ...optionalColumns,
    'empresa',
    'csg',
    'especie',
    'variedad',
    'centro_costo',
    'sector',
    'cantidad_totes',
    'jefe_cuadrilla',
    'created_by',
  ]
  const placeholders = columns.map(() => '?').join(', ')
  const updateCols = columns.filter((column) => column !== 'id')
  return `
INSERT INTO labels (
  ${columns.join(', ')}
) VALUES (${placeholders})
ON DUPLICATE KEY UPDATE
  ${updateCols.map((column) => `${column} = VALUES(${column})`).join(',\n  ')}
`
}

function getLabelSelectFields(labelSchema) {
  const fields = [
    'id',
    'created_at',
    'fecha',
    'exportacion',
    'empresa',
    'csg',
    'especie',
    'variedad',
    'centro_costo',
    'sector',
    'cantidad_totes',
    'jefe_cuadrilla',
  ]
  if (labelSchema.seasonId) fields.push('season_id')
  if (labelSchema.companyId) fields.push('company_id')
  if (labelSchema.seasonCostCenterId) fields.push('season_cost_center_id')
  return fields.join(', ')
}

async function main() {
  const envCheck = checkEnvironment(process.env)
  if (!envCheck.ok) {
    console.error(`[guardian] ${envCheck.error} El servidor no arranca.`)
    process.exit(1)
  }
  if (envCheck.warning) console.warn(`[guardian] ${envCheck.warning}`)

  const pool = await createPool()
  const app = express()
  app.locals.pool = pool
  app.locals.labelSchema = buildLabelSchemaState([])
  app.locals.mastersAuditReady = false
  // Estado del esquema (solo lectura). Las rutas lo avisan ante ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR.
  const monitor = createSchemaMonitor({ pool, locals: app.locals, log: (line) => console.log(line) })
  if (pool) {
    // bootstrapSchema nunca lanza: un error de esquema no anula el pool (el servicio sigue y health informa).
    await bootstrapSchema(pool, { log: (line) => console.log(line), createPasswordHash })
    await monitor.refresh({ maxAgeMs: 0 })
  }
  const dbReady = Boolean(pool)

  // Render antepone un proxy: con TRUST_PROXY=1 req.ip es la IP real del cliente.
  app.set('trust proxy', limitFromEnv('TRUST_PROXY', 1))
  // La app se sirve desde el mismo origen; solo se habilita CORS para orígenes declarados.
  const corsOrigins = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : false }))

  const MINUTE = 60_000
  // Límites holgados: una cuadrilla grande puede compartir IP (wifi del acopio, CGNAT móvil).
  const limitMovements = createRateLimiter({ windowMs: MINUTE, max: limitFromEnv('RATE_LIMIT_MOVEMENTS_PER_MIN', 600) })
  const limitLabels = createRateLimiter({ windowMs: MINUTE, max: limitFromEnv('RATE_LIMIT_LABELS_PER_MIN', 1200) })
  // En login solo cuentan los intentos fallidos: muchos usuarios entrando al inicio del turno no se bloquean.
  const limitLogin = createRateLimiter({
    windowMs: MINUTE,
    max: limitFromEnv('RATE_LIMIT_LOGIN_PER_MIN', 10),
    countIf: (res) => res.statusCode === 401,
  })
  app.use(express.json({ limit: '8mb' }))

  app.get('/api/health', async (_req, res) => {
    let operationalEpoch = null
    if (pool) {
      try {
        const [rows] = await pool.execute(`SELECT meta_value FROM app_meta WHERE meta_key = 'operational_epoch'`)
        operationalEpoch = rows[0]?.meta_value ?? null
      } catch {
        operationalEpoch = null
      }
    }
    const schema = await monitor.refresh({ maxAgeMs: 2_000 })
    res.json({
      operationalEpoch,
      ok: true,
      service: 'appetiquetado-sync',
      env: envCheck.env,
      dbReady,
      // Permite verificar en Render que la IP real del cliente se detecta tras el proxy (límites por IP).
      clientIp: clientIpOf(_req),
      // null = desconocido (sin pool o detección fallida).
      schemaComplete: schema.schemaComplete,
      missingTables: schema.missingTables,
      mastersAuditReady: schema.mastersAuditReady,
      movementsSchemaReady: schema.movementsSchemaReady,
    })
  })

  app.post('/api/auth/login', limitLogin, async (req, res) => {
    if (!requireDb(pool, res)) return
    const username = String(req.body?.username || '')
      .trim()
      .toLowerCase()
    const password = String(req.body?.password || '')
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'credentials_required' })
    }
    try {
      const [rows] = await pool.execute(
        `SELECT u.id, u.username, u.full_name, u.password_hash, u.is_active, r.code AS role
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE u.username = ?
         LIMIT 1`,
        [username],
      )
      const row = rows[0]
      if (!row || Number(row.is_active) !== 1 || !verifyPassword(password, row.password_hash)) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials' })
      }
      const token = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(token)
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000)
      await pool.execute(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES (?, ?, ?)`,
        [row.id, tokenHash, expiresAt],
      )
      return res.json({
        ok: true,
        token,
        user: {
          id: row.id,
          username: row.username,
          fullName: row.full_name,
          role: row.role,
        },
      })
    } catch (error) {
      await monitor.onRouteError(error, 'POST /api/auth/login')
      console.error('[sync-api] POST /api/auth/login', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    if (!requireDb(pool, res)) return
    try {
      await pool.execute('DELETE FROM auth_sessions WHERE id = ?', [req.auth.sessionId])
      return res.json({ ok: true })
    } catch (error) {
      await monitor.onRouteError(error, 'POST /api/auth/logout')
      console.error('[sync-api] POST /api/auth/logout', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    return res.json({
      ok: true,
      user: {
        id: req.auth.userId,
        username: req.auth.username,
        fullName: req.auth.fullName,
        role: req.auth.role,
      },
    })
  })

  app.get('/api/admin/users', authMiddleware, requireRoles(ROLE.SUPERADMIN), async (_req, res) => {
    if (!requireDb(pool, res)) return
    try {
      const [rows] = await pool.execute(
        `SELECT u.id, u.username, u.full_name, u.is_active, r.code AS role, u.created_at
         FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         ORDER BY u.created_at DESC`,
      )
      return res.json({ ok: true, users: rows })
    } catch (error) {
      await monitor.onRouteError(error, 'GET /api/admin/users')
      console.error('[sync-api] GET /api/admin/users', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post('/api/admin/users', authMiddleware, requireRoles(ROLE.SUPERADMIN), async (req, res) => {
    if (!requireDb(pool, res)) return
    const username = String(req.body?.username || '')
      .trim()
      .toLowerCase()
    const fullName = String(req.body?.fullName || '').trim()
    const password = String(req.body?.password || '')
    const role = String(req.body?.role || '').trim().toLowerCase()
    if (!username || !fullName || !password || ![ROLE.ADMIN, ROLE.OPERADOR, ROLE.SUPERADMIN].includes(role)) {
      return res.status(400).json({ ok: false, error: 'invalid_payload' })
    }
    try {
      const [roleRows] = await pool.execute('SELECT id FROM roles WHERE code = ? LIMIT 1', [role])
      const roleId = roleRows[0]?.id
      if (!roleId) return res.status(400).json({ ok: false, error: 'invalid_role' })
      await pool.execute(
        `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [username, fullName, createPasswordHash(password), roleId],
      )
      return res.json({ ok: true })
    } catch (error) {
      await monitor.onRouteError(error, 'POST /api/admin/users')
      console.error('[sync-api] POST /api/admin/users', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post('/api/admin/users/:id/password', authMiddleware, requireRoles(ROLE.SUPERADMIN), async (req, res) => {
    if (!requireDb(pool, res)) return
    const userId = Number(req.params.id)
    const password = String(req.body?.password || '')
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_user' })
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ ok: false, error: 'password_too_short' })
    }
    if (password.length > 200) {
      return res.status(400).json({ ok: false, error: 'password_too_long' })
    }
    try {
      const [result] = await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [
        createPasswordHash(password),
        userId,
      ])
      if (!result.affectedRows) return res.status(404).json({ ok: false, error: 'user_not_found' })
      // Cierra las sesiones abiertas del usuario; si es la propia, conserva la sesión actual.
      if (userId === Number(req.auth.userId)) {
        await pool.execute('DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?', [userId, req.auth.sessionId])
      } else {
        await pool.execute('DELETE FROM auth_sessions WHERE user_id = ?', [userId])
      }
      return res.json({ ok: true })
    } catch (error) {
      await monitor.onRouteError(error, 'POST /api/admin/users/:id/password')
      console.error('[sync-api] POST /api/admin/users/:id/password', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.get('/api/master-data/catalog', authMiddleware, requireRoles(...ACCESS.CATALOG), async (req, res) => {
    if (!requireDb(pool, res)) return
    const seasonId = Number(req.query.seasonId || 0) || null
    const companyId = Number(req.query.companyId || 0) || null
    try {
      const [seasonRows] = await pool.execute(
        `SELECT id, code, name, is_current
         FROM seasons
         WHERE is_active = 1
         ORDER BY is_current DESC, code DESC`,
      )
      const resolvedSeasonId = seasonId || seasonRows[0]?.id || null
      const [companyRows] = await pool.execute(
        `SELECT DISTINCT c.id, c.name
         FROM season_cost_centers scc
         INNER JOIN companies c ON c.id = scc.company_id
         WHERE scc.is_active = 1
           AND (? IS NULL OR scc.season_id = ?)
         ORDER BY c.name`,
        [resolvedSeasonId, resolvedSeasonId],
      )
      let costCenters = []
      if (companyId) {
        const [ccRows] = await pool.execute(
          `SELECT
             scc.id,
             scc.center_code,
             COALESCE(NULLIF(scc.center_name, ''), scc.center_code) AS center_name,
             sp.name AS especie,
             v.name AS variedad,
             cs.name AS csg
           FROM season_cost_centers scc
           INNER JOIN species sp ON sp.id = scc.species_id
           INNER JOIN varieties v ON v.id = scc.variety_id
           INNER JOIN csg_catalog cs ON cs.id = scc.csg_id
           WHERE scc.is_active = 1
             AND scc.company_id = ?
             AND (? IS NULL OR scc.season_id = ?)
           ORDER BY scc.center_code`,
          [companyId, resolvedSeasonId, resolvedSeasonId],
        )
        costCenters = ccRows
      }
      return res.json({
        ok: true,
        seasonId: resolvedSeasonId,
        seasons: seasonRows,
        companies: companyRows,
        costCenters,
      })
    } catch (error) {
      await monitor.onRouteError(error, 'GET /api/master-data/catalog')
      console.error('[sync-api] GET /api/master-data/catalog', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  // Lectura pública: el flujo operativo (?e=) no exige login; sin token la lista quedaba vacía.
  // Solo expone id + nombre de jefes activos (mismo SELECT que antes con sesión).
  app.get('/api/master-data/jc-foremen', async (_req, res) => {
    if (!requireDb(pool, res)) return
    try {
      const [rows] = await pool.execute(
        `SELECT id, name
         FROM jc_foremen
         WHERE is_active = 1
         ORDER BY name`,
      )
      return res.json({ ok: true, foremen: rows })
    } catch (error) {
      await monitor.onRouteError(error, 'GET /api/master-data/jc-foremen')
      console.error('[sync-api] GET /api/master-data/jc-foremen', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post(
    '/api/master-data/import',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
      if (rows.length === 0) return res.status(400).json({ ok: false, error: 'rows_required' })
      if (rows.length > 10000) return res.status(400).json({ ok: false, error: 'rows_too_large' })

      const conn = await getConnectionOr503(pool, res)
      if (!conn) return
      try {
        await conn.beginTransaction()
        const audit = Boolean(req.app.locals.mastersAuditReady)
        const seasonId = await resolveSeason(conn, req.body?.season || {}, audit)
        if (!seasonId) throw new Error('season_error')

        const sccAuditClause = withAuditClause(
          buildImportAuditClause(
            [
              { col: 'center_name', expr: 'VALUES(center_name)', text: true },
              { col: 'species_id', expr: 'VALUES(species_id)' },
              { col: 'variety_id', expr: 'VALUES(variety_id)' },
              { col: 'csg_id', expr: 'VALUES(csg_id)' },
              { col: 'is_active', expr: '1' },
              { col: 'source', expr: "'excel'", text: true },
            ],
            { audit },
          ),
        )
        let applied = 0
        for (const raw of rows) {
          const empresa = normalizeMasterName(raw?.empresa)
          const centroCosto = normalizeMasterName(raw?.cc || raw?.centroCosto || raw?.centro_costo)
          const especie = normalizeMasterName(raw?.especie)
          const variedad = normalizeMasterName(raw?.variedad)
          const csg = normalizeMasterName(raw?.csg)
          if (!empresa || !centroCosto || !especie || !variedad || !csg) continue

          const companyId = await upsertByCodeAndName(conn, 'companies', empresa, empresa, audit)
          const speciesId = await upsertByCodeAndName(conn, 'species', especie, especie, audit)
          const varietyId = await resolveVariety(conn, speciesId, variedad, audit)
          const csgId = await upsertByCodeAndName(conn, 'csg_catalog', csg, csg, audit)

          await conn.execute(
            `INSERT INTO season_cost_centers
               (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'excel')
             ON DUPLICATE KEY UPDATE
               ${sccAuditClause}
               center_name = VALUES(center_name),
               species_id = VALUES(species_id),
               variety_id = VALUES(variety_id),
               csg_id = VALUES(csg_id),
               is_active = 1,
               source = 'excel'`,
            [
              seasonId,
              companyId,
              centroCosto,
              normalizeMasterName(raw?.ccNombre || ''),
              speciesId,
              varietyId,
              csgId,
            ],
          )
          applied++
        }

        await conn.execute(
          `INSERT INTO master_import_runs
             (season_id, imported_by, source, rows_received, rows_applied)
           VALUES (?, ?, 'excel', ?, ?)`,
          [seasonId, req.auth.userId, rows.length, applied],
        )
        await conn.commit()
        return res.json({ ok: true, seasonId, received: rows.length, applied })
      } catch (error) {
        await conn.rollback()
        await monitor.onRouteError(error, 'POST /api/master-data/import')
        console.error('[sync-api] POST /api/master-data/import', error)
        return res.status(500).json({ ok: false, error: 'db' })
      } finally {
        conn.release()
      }
    },
  )

  app.get(
    '/api/admin/masters',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await fetchMastersBundle(pool, req.app.locals.mastersAuditReady)
          return res.json({ ok: true, ...data })
        } catch (error) {
          const changed = await monitor.onRouteError(error, 'GET /api/admin/masters')
          if (attempt === 0 && changed) continue
          console.error('[sync-api] GET /api/admin/masters', error)
          return res.status(500).json({ ok: false, error: 'db' })
        }
      }
    },
  )

  app.post(
    '/api/admin/seasons',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 30)
      const name = normalizeLimitedText(req.body?.name, 120)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const starts = normalizeSeasonDate(req.body?.startsOn)
      const ends = normalizeSeasonDate(req.body?.endsOn)
      if (!starts.valid || !ends.valid) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isCurrent = toBit(req.body?.isCurrent, 0)
      const isActive = toBit(req.body?.isActive, 1)
      const audit = Boolean(req.app.locals.mastersAuditReady)
      const conn = await getConnectionOr503(pool, res)
      if (!conn) return
      try {
        await conn.beginTransaction()
        await saveMaster(
          conn,
          audit,
          req.auth.userId,
          'seasons',
          [
            { name: 'code', text: true },
            { name: 'name', text: true },
            { name: 'starts_on' },
            { name: 'ends_on' },
            { name: 'is_current' },
            { name: 'is_active' },
          ],
          [code, name, starts.value, ends.value, isCurrent, isActive],
          id,
        )
        if (isCurrent === 1) {
          const unset = buildUnsetCurrentSeason({ audit, actor: 'user' })
          await conn.execute(unset.sql, unset.params(code, req.auth.userId))
          await conn.execute('UPDATE seasons SET is_current = 1 WHERE code = ?', [code])
        }
        await conn.commit()
        return res.json({ ok: true })
      } catch (error) {
        await conn.rollback()
        await monitor.onRouteError(error, 'POST /api/admin/seasons')
        console.error('[sync-api] POST /api/admin/seasons', error)
        return res.status(500).json({ ok: false, error: 'db' })
      } finally {
        conn.release()
      }
    },
  )

  app.post(
    '/api/admin/companies',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 60)
      const name = normalizeLimitedText(req.body?.name, 180)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        await saveMaster(pool, Boolean(req.app.locals.mastersAuditReady), req.auth.userId, 'companies', CODE_NAME_COLS, [code, name, isActive], id)
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/companies')
        console.error('[sync-api] POST /api/admin/companies', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/species',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 60)
      const name = normalizeLimitedText(req.body?.name, 180)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        await saveMaster(pool, Boolean(req.app.locals.mastersAuditReady), req.auth.userId, 'species', CODE_NAME_COLS, [code, name, isActive], id)
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/species')
        console.error('[sync-api] POST /api/admin/species', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/csg',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 60)
      const name = normalizeLimitedText(req.body?.name, 180)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        await saveMaster(pool, Boolean(req.app.locals.mastersAuditReady), req.auth.userId, 'csg_catalog', CODE_NAME_COLS, [code, name, isActive], id)
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/csg')
        console.error('[sync-api] POST /api/admin/csg', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/jc-foremen',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 60)
      const name = normalizeLimitedText(req.body?.name, 180)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        await saveMaster(pool, Boolean(req.app.locals.mastersAuditReady), req.auth.userId, 'jc_foremen', CODE_NAME_COLS, [code, name, isActive], id)
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/jc-foremen')
        console.error('[sync-api] POST /api/admin/jc-foremen', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/varieties',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeLimitedText(req.body?.code, 60)
      const name = normalizeLimitedText(req.body?.name, 180)
      const speciesId = Number(req.body?.speciesId || 0)
      if (!code || !name || !speciesId) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' })
      }
      const isActive = toBit(req.body?.isActive, 1)
      try {
        await saveMaster(
          pool,
          Boolean(req.app.locals.mastersAuditReady),
          req.auth.userId,
          'varieties',
          [{ name: 'code', text: true }, { name: 'name', text: true }, { name: 'species_id' }, { name: 'is_active' }],
          [code, name, speciesId, isActive],
          id,
        )
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/varieties')
        console.error('[sync-api] POST /api/admin/varieties', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/relations',
    authMiddleware,
    requireRoles(...ACCESS.MASTER_ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const seasonId = Number(req.body?.seasonId || 0)
      const companyId = Number(req.body?.companyId || 0)
      const centerCode = normalizeLimitedText(req.body?.centerCode, 80)
      const centerName = normalizeLimitedText(req.body?.centerName, 180)
      const speciesId = Number(req.body?.speciesId || 0)
      const varietyId = Number(req.body?.varietyId || 0)
      const csgId = Number(req.body?.csgId || 0)
      const isActive = toBit(req.body?.isActive, 1)
      if (!seasonId || !companyId || !centerCode || !speciesId || !varietyId || !csgId) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' })
      }
      try {
        const cols = [
          { name: 'season_id' },
          { name: 'company_id' },
          { name: 'center_code', text: true },
          { name: 'center_name', text: true },
          { name: 'species_id' },
          { name: 'variety_id' },
          { name: 'csg_id' },
          { name: 'is_active' },
        ]
        const values = [seasonId, companyId, centerCode, centerName, speciesId, varietyId, csgId, isActive]
        await saveMaster(
          pool,
          Boolean(req.app.locals.mastersAuditReady),
          req.auth.userId,
          'season_cost_centers',
          cols,
          values,
          id,
          [...cols, { name: 'source' }],
          [...values, 'admin'],
        )
        return res.json({ ok: true })
      } catch (error) {
        await monitor.onRouteError(error, 'POST /api/admin/relations')
        console.error('[sync-api] POST /api/admin/relations', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.get('/api/labels/:id', limitLabels, async (req, res) => {
    if (!requireDb(pool, res)) return
    const id = String(req.params.id || '')
      .trim()
      .toUpperCase()
    if (!id || !/^[A-Z0-9_-]{4,64}$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'id_invalido' })
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const labelFields = getLabelSelectFields(app.locals.labelSchema || buildLabelSchemaState([]))
        const [rows] = await pool.execute(
          `SELECT ${labelFields}
           FROM labels WHERE id = ? LIMIT 1`,
          [id],
        )
        if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' })
        let movementRows = []
        try {
          const [mRows] = await pool.execute(
            `SELECT label_id, type, cantidad, at, registered_by, precio_clp, jh
             FROM movements WHERE label_id = ? ORDER BY at ASC`,
            [id],
          )
          movementRows = mRows
        } catch (mErr) {
          if (!(mErr && typeof mErr === 'object' && mErr.code === 'ER_NO_SUCH_TABLE')) {
            throw mErr
          }
        }
        return res.json({ ok: true, label: rows[0], movements: movementRows })
      } catch (error) {
        const changed = await monitor.onRouteError(error, 'GET /api/labels/:id')
        if (attempt === 0 && changed) continue
        console.error('[sync-api] GET /api/labels/:id', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    }
  })

  app.post('/api/labels/batch', requireSyncKey, authMiddleware, requireRoles(...ACCESS.LABEL_BATCH), async (req, res) => {
    if (!requireDb(pool, res)) return
    const raw = req.body?.labels
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ ok: false, error: 'labels_required' })
    }
    if (raw.length > 500) {
      return res.status(400).json({ ok: false, error: 'batch_too_large' })
    }
    const payloads = []
    for (const item of raw) {
      const payload = normalizeLabelInput(item)
      if (!payload) return res.status(400).json({ ok: false, error: 'invalid_label' })
      payloads.push(payload)
    }

    const conn = await getConnectionOr503(pool, res)
    if (!conn) return
    try {
      await conn.beginTransaction()
      const labelSchema = app.locals.labelSchema || buildLabelSchemaState([])
      for (const payload of payloads) {
        const resolved = await resolveLabelCatalog(conn, payload)
        await insertLabelRecordWithFallback(conn, payload, resolved, req.auth.userId, labelSchema)
      }
      await conn.commit()
      return res.json({ ok: true, count: payloads.length })
    } catch (error) {
      await conn.rollback()
      if (error instanceof Error && error.message === 'invalid_master_relation') {
        return res.status(400).json({ ok: false, error: 'invalid_master_relation' })
      }
      await monitor.onRouteError(error, 'POST /api/labels/batch')
      console.error('[sync-api] POST /api/labels/batch', error)
      return res.status(500).json({ ok: false, error: 'db' })
    } finally {
      conn.release()
    }
  })

  // Escaneo en terreno (?e=): sin sesión; si hay Bearer válido se guarda created_by.
  // Fuente del Excel global (GET /api/reports/tracking-export): solo filas insertadas aquí.
  app.post('/api/movements', limitMovements, optionalAuthMiddleware, async (req, res) => {
    if (!requireDb(pool, res)) return
    const payload = normalizeMovementInput(req.body?.movement || req.body)
    if (!payload) {
      return res.status(400).json({ ok: false, error: 'invalid_movement' })
    }
    const conn = await getConnectionOr503(pool, res)
    if (!conn) return
    try {
      await conn.beginTransaction()
      const [labelRows] = await conn.execute(
        'SELECT id, cantidad_totes FROM labels WHERE id = ? FOR UPDATE',
        [payload.labelId],
      )
      if (!labelRows.length) {
        await conn.rollback()
        return res.status(404).json({ ok: false, error: 'label_not_found' })
      }
      const labelRow = labelRows[0]
      let movementRows = []
      try {
        // Lectura sin FOR UPDATE: el lock de la fila en `labels` ya serializa los movimientos de la
        // misma etiqueta. Un FOR UPDATE aquí toma gap locks y genera deadlocks entre etiquetas distintas.
        const [mRows] = await conn.execute(
          `SELECT type FROM movements WHERE label_id = ?`,
          [payload.labelId],
        )
        movementRows = mRows
      } catch (mErr) {
        if (mErr && typeof mErr === 'object' && mErr.code === 'ER_NO_SUCH_TABLE') {
          await conn.rollback()
          return res.status(503).json({ ok: false, error: 'movements_table_missing' })
        }
        throw mErr
      }
      const hasJc =
        (labelRow.cantidad_totes !== null && labelRow.cantidad_totes !== undefined) ||
        movementRows.some((row) => row.type === 'jc')
      const hasAcopio = movementRows.some((row) => row.type === 'acopio')

      if (hasJc && hasAcopio) {
        await conn.rollback()
        return res.status(409).json({ ok: false, error: 'already_complete' })
      }
      if (!hasJc && payload.type !== 'jc') {
        await conn.rollback()
        return res.status(409).json({ ok: false, error: 'jc_required' })
      }
      if (hasJc && payload.type === 'jc') {
        await conn.rollback()
        return res.status(409).json({ ok: false, error: 'jc_already_registered' })
      }
      if (hasJc && !hasAcopio && payload.type !== 'acopio') {
        await conn.rollback()
        return res.status(409).json({ ok: false, error: 'acopio_required' })
      }

      if (!hasJc) {
        const jefe = normalizeLimitedText(
          req.body?.jcFirstRead?.jefeCuadrilla ?? req.body?.jefeCuadrilla,
          255,
        )
        if (!jefe) {
          await conn.rollback()
          return res.status(400).json({ ok: false, error: 'jc_first_read_required' })
        }
        if (payload.precioClp === null || payload.jh === null) {
          await conn.rollback()
          return res.status(400).json({ ok: false, error: 'jc_data_required' })
        }
        await conn.execute(
          `UPDATE labels SET cantidad_totes = ?, jefe_cuadrilla = ? WHERE id = ?`,
          [payload.cantidad, jefe, payload.labelId],
        )
      }
      await conn.execute(
        `INSERT INTO movements
           (label_id, type, cantidad, at, registered_by, precio_clp, jh, created_by, client_ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.labelId,
          payload.type,
          payload.cantidad,
          payload.at,
          payload.registeredBy,
          payload.precioClp,
          payload.jh,
          req.auth?.userId ?? null,
          clientIpOf(req).slice(0, 45),
          String(req.get('user-agent') || '').slice(0, 255) || null,
        ],
      )
      await conn.commit()
      return res.json({ ok: true })
    } catch (error) {
      try {
        await conn.rollback()
      } catch {
        /* ignore */
      }
      if (error && typeof error === 'object' && error.code === 'ER_NO_SUCH_TABLE') {
        await monitor.onRouteError(error, 'POST /api/movements')
        return res.status(503).json({ ok: false, error: 'movements_table_missing' })
      }
      await monitor.onRouteError(error, 'POST /api/movements')
      console.error('[sync-api] POST /api/movements', error)
      return res.status(500).json({ ok: false, error: 'db' })
    } finally {
      conn.release()
    }
  })

  app.get(
    '/api/reports/tracking-export',
    authMiddleware,
    requireRoles(...ACCESS.TRACKING_EXPORT),
    async (_req, res) => {
      if (!requireDb(pool, res)) return
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const labelFields = getLabelSelectFields(app.locals.labelSchema || buildLabelSchemaState([]))
          const [labelRows] = await pool.execute(
            `SELECT ${labelFields}
             FROM labels
             ORDER BY created_at ASC`,
          )
          let movementRows = []
          try {
            const [rows] = await pool.execute(
              `SELECT label_id, type, cantidad, at, registered_by, precio_clp, jh
               FROM movements
               ORDER BY at ASC`,
            )
            movementRows = rows
          } catch (error) {
            if (!(error && typeof error === 'object' && error.code === 'ER_NO_SUCH_TABLE')) {
              throw error
            }
            movementRows = []
          }
          const labels = labelRows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            fecha: row.fecha || '',
            exportacion: row.exportacion || '',
            empresa: row.empresa || '',
            csg: row.csg || '',
            especie: row.especie || '',
            variedad: row.variedad || '',
            centroCosto: row.centro_costo || '',
            sector: row.sector || '',
            cantidadTotes: row.cantidad_totes === null ? null : Number(row.cantidad_totes),
            jefeCuadrilla: row.jefe_cuadrilla || '',
            seasonId: row.season_id ? Number(row.season_id) : null,
            companyId: row.company_id ? Number(row.company_id) : null,
            seasonCostCenterId: row.season_cost_center_id ? Number(row.season_cost_center_id) : null,
          }))
          const movements = movementRows.map((row) => ({
            labelId: row.label_id,
            type: row.type,
            cantidad: Number(row.cantidad),
            at: row.at,
            registeredBy: row.registered_by || '',
            precioClp: row.precio_clp === null ? undefined : Number(row.precio_clp),
            jh: row.jh === null || row.jh === undefined ? undefined : Number(row.jh),
          }))
          return res.json({ ok: true, labels, movements })
        } catch (error) {
          const changed = await monitor.onRouteError(error, 'GET /api/reports/tracking-export')
          if (attempt === 0 && changed) continue
          console.error('[sync-api] GET /api/reports/tracking-export', error)
          return res.status(500).json({ ok: false, error: 'db' })
        }
      }
    },
  )

  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) next(err)
      })
    })
  }

  app.listen(PORT, '0.0.0.0', () => {
    const mode = fs.existsSync(distPath) ? 'api+static' : 'api'
    console.log(`[sync-api] ${mode} http://0.0.0.0:${PORT} (MySQL: ${process.env.MYSQL_DATABASE})`)
  })
}

// Red de seguridad: un error asíncrono no capturado se registra, pero no detiene el servicio para todos los usuarios.
process.on('unhandledRejection', (reason) => {
  console.error('[sync-api] unhandledRejection:', reason)
})

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

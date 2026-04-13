const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')

const PORT = Number(process.env.PORT || process.env.SYNC_API_PORT || 3001)
const distPath = path.join(__dirname, '..', 'dist')
const SYNC_API_KEY = (process.env.SYNC_API_KEY || '').trim()
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12)

const ROLE = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  OPERADOR: 'operador',
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
  return mysql.createPool({
    host,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: false,
  })
}

async function ensureBaseData(pool) {
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

  const username = (process.env.SUPERADMIN_USERNAME || 'superadmin').trim()
  const password = (process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!').trim()
  const fullName = (process.env.SUPERADMIN_NAME || 'Super Administrador').trim()

  const [roleRows] = await pool.execute('SELECT id FROM roles WHERE code = ? LIMIT 1', [ROLE.SUPERADMIN])
  const roleId = roleRows[0]?.id
  if (!roleId) return

  const [userRows] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username])
  if (userRows.length === 0) {
    await pool.execute(
      `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [username, fullName, createPasswordHash(password), roleId],
    )
    console.log(`[sync-api] Usuario SuperAdmin inicial creado: ${username}`)
  }
}

function requireDb(pool, res) {
  if (pool) return true
  res.status(503).json({ ok: false, error: 'db_not_configured' })
  return false
}

async function authMiddleware(req, res, next) {
  const pool = req.app.locals.pool
  if (!pool) return res.status(503).json({ ok: false, error: 'db_not_configured' })
  const header = req.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim()
  if (!token) return res.status(401).json({ ok: false, error: 'missing_token' })
  try {
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
    if (!row || Number(row.is_active) !== 1) {
      return res.status(401).json({ ok: false, error: 'invalid_session' })
    }
    req.auth = {
      sessionId: row.session_id,
      userId: row.user_id,
      username: row.username,
      fullName: row.full_name,
      role: row.role,
    }
    next()
  } catch (error) {
    console.error('[sync-api] auth middleware', error)
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
    fecha: String(item?.fecha ?? ''),
    exportacion: String(item?.exportacion ?? ''),
    empresa: String(item?.empresa ?? ''),
    csg: String(item?.csg ?? ''),
    especie: String(item?.especie ?? ''),
    variedad: String(item?.variedad ?? ''),
    centroCosto: String(item?.centroCosto ?? item?.centro_costo ?? ''),
    sector: String(item?.sector ?? ''),
    cantidadTotes,
    jefeCuadrilla: String(item?.jefeCuadrilla ?? item?.jefe_cuadrilla ?? '').trim(),
    seasonId: item?.seasonId ? Number(item.seasonId) : null,
    companyId: item?.companyId ? Number(item.companyId) : null,
    seasonCostCenterId: item?.seasonCostCenterId ? Number(item.seasonCostCenterId) : null,
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

async function upsertByCodeAndName(conn, table, code, name) {
  const safeCode = toCode(code || name)
  const safeName = normalizeMasterName(name || code)
  await conn.execute(
    `INSERT INTO ${table} (code, name, is_active)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       is_active = 1`,
    [safeCode, safeName],
  )
  const [rows] = await conn.execute(`SELECT id FROM ${table} WHERE code = ? LIMIT 1`, [safeCode])
  return rows[0]?.id
}

async function resolveVariety(conn, speciesId, varietyName) {
  const code = toCode(varietyName)
  const name = normalizeMasterName(varietyName)
  await conn.execute(
    `INSERT INTO varieties (code, name, species_id, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       species_id = VALUES(species_id),
       is_active = 1`,
    [code, name, speciesId],
  )
  const [rows] = await conn.execute('SELECT id FROM varieties WHERE code = ? LIMIT 1', [code])
  return rows[0]?.id
}

async function resolveSeason(conn, seasonInput) {
  const code = toCode(seasonInput?.code || seasonInput?.name || 'TEMPORADA_GENERAL')
  const name = normalizeMasterName(seasonInput?.name || seasonInput?.code || 'Temporada general')
  const isCurrent = seasonInput?.isCurrent ? 1 : 0
  await conn.execute(
    `INSERT INTO seasons (code, name, is_current, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       is_current = VALUES(is_current),
       is_active = 1`,
    [code, name, isCurrent],
  )
  if (isCurrent === 1) {
    await conn.execute('UPDATE seasons SET is_current = 0 WHERE code <> ?', [code])
    await conn.execute('UPDATE seasons SET is_current = 1 WHERE code = ?', [code])
  }
  const [rows] = await conn.execute('SELECT id FROM seasons WHERE code = ? LIMIT 1', [code])
  return rows[0]?.id
}

async function fetchMastersBundle(pool) {
  const [seasons] = await pool.execute(
    `SELECT id, code, name, starts_on, ends_on, is_current, is_active
     FROM seasons
     ORDER BY is_current DESC, code DESC`,
  )
  const [companies] = await pool.execute(
    `SELECT id, code, name, is_active
     FROM companies
     ORDER BY name`,
  )
  const [species] = await pool.execute(
    `SELECT id, code, name, is_active
     FROM species
     ORDER BY name`,
  )
  const [csg] = await pool.execute(
    `SELECT id, code, name, is_active
     FROM csg_catalog
     ORDER BY name`,
  )
  const [varieties] = await pool.execute(
    `SELECT v.id, v.code, v.name, v.species_id, s.name AS species_name, v.is_active
     FROM varieties v
     INNER JOIN species s ON s.id = v.species_id
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
       scc.is_active
     FROM season_cost_centers scc
     INNER JOIN seasons se ON se.id = scc.season_id
     INNER JOIN companies c ON c.id = scc.company_id
     INNER JOIN species sp ON sp.id = scc.species_id
     INNER JOIN varieties v ON v.id = scc.variety_id
     INNER JOIN csg_catalog cs ON cs.id = scc.csg_id
     ORDER BY se.code DESC, c.name, scc.center_code`,
  )
  return { seasons, companies, species, csg, varieties, relations }
}

const INSERT_SQL = `
INSERT INTO labels (
  id, created_at, fecha, exportacion, season_id, company_id, season_cost_center_id,
  empresa, csg, especie, variedad, centro_costo, sector, cantidad_totes, jefe_cuadrilla, created_by
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  created_at = VALUES(created_at),
  fecha = VALUES(fecha),
  exportacion = VALUES(exportacion),
  season_id = VALUES(season_id),
  company_id = VALUES(company_id),
  season_cost_center_id = VALUES(season_cost_center_id),
  empresa = VALUES(empresa),
  csg = VALUES(csg),
  especie = VALUES(especie),
  variedad = VALUES(variedad),
  centro_costo = VALUES(centro_costo),
  sector = VALUES(sector),
  cantidad_totes = VALUES(cantidad_totes),
  jefe_cuadrilla = VALUES(jefe_cuadrilla),
  created_by = VALUES(created_by)
`

async function main() {
  const pool = await createPool()
  if (pool) {
    await ensureBaseData(pool)
  }
  const dbReady = Boolean(pool)
  const app = express()
  app.locals.pool = pool

  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '8mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'appetiquetado-sync',
      dbReady,
    })
  })

  app.post('/api/auth/login', async (req, res) => {
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
      console.error('[sync-api] POST /api/admin/users', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.get('/api/master-data/catalog', authMiddleware, async (req, res) => {
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
      console.error('[sync-api] GET /api/master-data/catalog', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post(
    '/api/master-data/import',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
      if (rows.length === 0) return res.status(400).json({ ok: false, error: 'rows_required' })
      if (rows.length > 10000) return res.status(400).json({ ok: false, error: 'rows_too_large' })

      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const seasonId = await resolveSeason(conn, req.body?.season || {})
        if (!seasonId) throw new Error('season_error')

        let applied = 0
        for (const raw of rows) {
          const empresa = normalizeMasterName(raw?.empresa)
          const centroCosto = normalizeMasterName(raw?.cc || raw?.centroCosto || raw?.centro_costo)
          const especie = normalizeMasterName(raw?.especie)
          const variedad = normalizeMasterName(raw?.variedad)
          const csg = normalizeMasterName(raw?.csg)
          if (!empresa || !centroCosto || !especie || !variedad || !csg) continue

          const companyId = await upsertByCodeAndName(conn, 'companies', empresa, empresa)
          const speciesId = await upsertByCodeAndName(conn, 'species', especie, especie)
          const varietyId = await resolveVariety(conn, speciesId, variedad)
          const csgId = await upsertByCodeAndName(conn, 'csg_catalog', csg, csg)

          await conn.execute(
            `INSERT INTO season_cost_centers
               (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'excel')
             ON DUPLICATE KEY UPDATE
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
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (_req, res) => {
      if (!requireDb(pool, res)) return
      try {
        const data = await fetchMastersBundle(pool)
        return res.json(data)
      } catch (error) {
        console.error('[sync-api] GET /api/admin/masters', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/seasons',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeMasterName(req.body?.code)
      const name = normalizeMasterName(req.body?.name)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const startsOn = normalizeMasterName(req.body?.startsOn) || null
      const endsOn = normalizeMasterName(req.body?.endsOn) || null
      const isCurrent = toBit(req.body?.isCurrent, 0)
      const isActive = toBit(req.body?.isActive, 1)
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        if (id) {
          await conn.execute(
            `UPDATE seasons
             SET code = ?, name = ?, starts_on = ?, ends_on = ?, is_current = ?, is_active = ?
             WHERE id = ?`,
            [code, name, startsOn, endsOn, isCurrent, isActive, id],
          )
        } else {
          await conn.execute(
            `INSERT INTO seasons (code, name, starts_on, ends_on, is_current, is_active)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [code, name, startsOn, endsOn, isCurrent, isActive],
          )
        }
        if (isCurrent === 1) {
          await conn.execute('UPDATE seasons SET is_current = 0 WHERE code <> ?', [code])
          await conn.execute('UPDATE seasons SET is_current = 1 WHERE code = ?', [code])
        }
        await conn.commit()
        return res.json({ ok: true })
      } catch (error) {
        await conn.rollback()
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
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeMasterName(req.body?.code)
      const name = normalizeMasterName(req.body?.name)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        if (id) {
          await pool.execute(`UPDATE companies SET code = ?, name = ?, is_active = ? WHERE id = ?`, [
            code,
            name,
            isActive,
            id,
          ])
        } else {
          await pool.execute(`INSERT INTO companies (code, name, is_active) VALUES (?, ?, ?)`, [
            code,
            name,
            isActive,
          ])
        }
        return res.json({ ok: true })
      } catch (error) {
        console.error('[sync-api] POST /api/admin/companies', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/species',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeMasterName(req.body?.code)
      const name = normalizeMasterName(req.body?.name)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        if (id) {
          await pool.execute(`UPDATE species SET code = ?, name = ?, is_active = ? WHERE id = ?`, [
            code,
            name,
            isActive,
            id,
          ])
        } else {
          await pool.execute(`INSERT INTO species (code, name, is_active) VALUES (?, ?, ?)`, [
            code,
            name,
            isActive,
          ])
        }
        return res.json({ ok: true })
      } catch (error) {
        console.error('[sync-api] POST /api/admin/species', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/csg',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeMasterName(req.body?.code)
      const name = normalizeMasterName(req.body?.name)
      if (!code || !name) return res.status(400).json({ ok: false, error: 'invalid_payload' })
      const isActive = toBit(req.body?.isActive, 1)
      try {
        if (id) {
          await pool.execute(`UPDATE csg_catalog SET code = ?, name = ?, is_active = ? WHERE id = ?`, [
            code,
            name,
            isActive,
            id,
          ])
        } else {
          await pool.execute(`INSERT INTO csg_catalog (code, name, is_active) VALUES (?, ?, ?)`, [
            code,
            name,
            isActive,
          ])
        }
        return res.json({ ok: true })
      } catch (error) {
        console.error('[sync-api] POST /api/admin/csg', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/varieties',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const code = normalizeMasterName(req.body?.code)
      const name = normalizeMasterName(req.body?.name)
      const speciesId = Number(req.body?.speciesId || 0)
      if (!code || !name || !speciesId) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' })
      }
      const isActive = toBit(req.body?.isActive, 1)
      try {
        if (id) {
          await pool.execute(
            `UPDATE varieties
             SET code = ?, name = ?, species_id = ?, is_active = ?
             WHERE id = ?`,
            [code, name, speciesId, isActive, id],
          )
        } else {
          await pool.execute(
            `INSERT INTO varieties (code, name, species_id, is_active)
             VALUES (?, ?, ?, ?)`,
            [code, name, speciesId, isActive],
          )
        }
        return res.json({ ok: true })
      } catch (error) {
        console.error('[sync-api] POST /api/admin/varieties', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.post(
    '/api/admin/relations',
    authMiddleware,
    requireRoles(ROLE.SUPERADMIN, ROLE.ADMIN),
    async (req, res) => {
      if (!requireDb(pool, res)) return
      const id = Number(req.body?.id || 0) || null
      const seasonId = Number(req.body?.seasonId || 0)
      const companyId = Number(req.body?.companyId || 0)
      const centerCode = normalizeMasterName(req.body?.centerCode)
      const centerName = normalizeMasterName(req.body?.centerName)
      const speciesId = Number(req.body?.speciesId || 0)
      const varietyId = Number(req.body?.varietyId || 0)
      const csgId = Number(req.body?.csgId || 0)
      const isActive = toBit(req.body?.isActive, 1)
      if (!seasonId || !companyId || !centerCode || !speciesId || !varietyId || !csgId) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' })
      }
      try {
        if (id) {
          await pool.execute(
            `UPDATE season_cost_centers
             SET season_id = ?, company_id = ?, center_code = ?, center_name = ?,
                 species_id = ?, variety_id = ?, csg_id = ?, is_active = ?
             WHERE id = ?`,
            [seasonId, companyId, centerCode, centerName, speciesId, varietyId, csgId, isActive, id],
          )
        } else {
          await pool.execute(
            `INSERT INTO season_cost_centers
               (season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admin')`,
            [seasonId, companyId, centerCode, centerName, speciesId, varietyId, csgId, isActive],
          )
        }
        return res.json({ ok: true })
      } catch (error) {
        console.error('[sync-api] POST /api/admin/relations', error)
        return res.status(500).json({ ok: false, error: 'db' })
      }
    },
  )

  app.get('/api/labels/:id', async (req, res) => {
    if (!requireDb(pool, res)) return
    const id = String(req.params.id || '')
      .trim()
      .toUpperCase()
    if (!id || !/^[A-Z0-9_-]{4,64}$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'id_invalido' })
    }
    try {
      const [rows] = await pool.execute(
        `SELECT id, created_at, fecha, exportacion, empresa, csg, especie, variedad,
                centro_costo, sector, cantidad_totes, jefe_cuadrilla,
                season_id, company_id, season_cost_center_id
         FROM labels WHERE id = ? LIMIT 1`,
        [id],
      )
      if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' })
      return res.json({ ok: true, label: rows[0] })
    } catch (error) {
      console.error('[sync-api] GET /api/labels/:id', error)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post('/api/labels/batch', requireSyncKey, authMiddleware, async (req, res) => {
    if (!requireDb(pool, res)) return
    if (![ROLE.SUPERADMIN, ROLE.ADMIN].includes(req.auth.role)) {
      return res.status(403).json({ ok: false, error: 'forbidden' })
    }
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

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const payload of payloads) {
        const resolved = await resolveLabelCatalog(conn, payload)
        await conn.execute(INSERT_SQL, [
          payload.id,
          payload.createdAt,
          payload.fecha,
          payload.exportacion,
          resolved.seasonId,
          resolved.companyId,
          resolved.seasonCostCenterId,
          resolved.empresa,
          resolved.csg,
          resolved.especie,
          resolved.variedad,
          resolved.centroCosto,
          payload.sector,
          payload.cantidadTotes,
          payload.jefeCuadrilla,
          req.auth.userId,
        ])
      }
      await conn.commit()
      return res.json({ ok: true, count: payloads.length })
    } catch (error) {
      await conn.rollback()
      if (error instanceof Error && error.message === 'invalid_master_relation') {
        return res.status(400).json({ ok: false, error: 'invalid_master_relation' })
      }
      console.error('[sync-api] POST /api/labels/batch', error)
      return res.status(500).json({ ok: false, error: 'db' })
    } finally {
      conn.release()
    }
  })

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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

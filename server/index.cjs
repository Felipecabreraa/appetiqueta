/**
 * API mínima para sincronizar etiquetas con MySQL (mismo esquema que database/schema.sql).
 * En producción (Render, etc.) sirve también el front estático desde dist/.
 *
 * Variables en .env (raíz del proyecto, no expuestas al front):
 *   MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *   PORT o SYNC_API_PORT  (Render inyecta PORT)
 *   SYNC_API_KEY=...    (opcional; si existe, POST /api/labels/batch exige cabecera X-Sync-Key)
 *
 * Arranque local API: npm run server
 * Producción: npm run build && npm start
 * Front mismo origen: no hace falta VITE_SYNC_API_BASE; en dev Vite hace proxy de /api → :3001
 */

const fs = require('fs')
const path = require('path')

require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const express = require('express')
const cors = require('cors')
const mysql = require('mysql2/promise')

const PORT = Number(process.env.PORT || process.env.SYNC_API_PORT || 3001)
const distPath = path.join(__dirname, '..', 'dist')
const SYNC_API_KEY = (process.env.SYNC_API_KEY || '').trim()

async function createPool() {
  const host = process.env.MYSQL_HOST || 'localhost'
  const user = process.env.MYSQL_USER
  const password = process.env.MYSQL_PASSWORD ?? ''
  const database = process.env.MYSQL_DATABASE
  if (!user || !database) {
    console.error(
      '[sync-api] Faltan MYSQL_USER o MYSQL_DATABASE en .env. Revise la configuración.',
    )
    process.exit(1)
  }
  return mysql.createPool({
    host,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 8,
    dateStrings: false,
  })
}

function requireSyncKey(req, res, next) {
  if (!SYNC_API_KEY) return next()
  const sent = (req.get('x-sync-key') || '').trim()
  if (sent !== SYNC_API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }
  next()
}

function mapBodyToRow(r) {
  const id = String(r.id || '').trim().toUpperCase()
  if (!id || id.length > 64) return null
  const createdAt = r.createdAt ? new Date(r.createdAt) : new Date()
  if (Number.isNaN(createdAt.getTime())) return null
  const cantidad = r.cantidadTotes
  const cantidadTotes =
    cantidad === null || cantidad === undefined || cantidad === ''
      ? null
      : Number(cantidad)
  if (cantidadTotes !== null && !Number.isFinite(cantidadTotes)) return null
  return [
    id,
    createdAt,
    String(r.fecha ?? ''),
    String(r.exportacion ?? ''),
    String(r.empresa ?? ''),
    String(r.csg ?? ''),
    String(r.especie ?? ''),
    String(r.variedad ?? ''),
    String(r.centroCosto ?? r.centro_costo ?? ''),
    String(r.sector ?? ''),
    cantidadTotes,
    String(r.jefeCuadrilla ?? r.jefe_cuadrilla ?? '').trim(),
  ]
}

const INSERT_SQL = `
INSERT INTO labels (
  id, created_at, fecha, exportacion, empresa, csg, especie, variedad,
  centro_costo, sector, cantidad_totes, jefe_cuadrilla
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  created_at = VALUES(created_at),
  fecha = VALUES(fecha),
  exportacion = VALUES(exportacion),
  empresa = VALUES(empresa),
  csg = VALUES(csg),
  especie = VALUES(especie),
  variedad = VALUES(variedad),
  centro_costo = VALUES(centro_costo),
  sector = VALUES(sector),
  cantidad_totes = VALUES(cantidad_totes),
  jefe_cuadrilla = VALUES(jefe_cuadrilla)
`

async function main() {
  const pool = await createPool()
  const app = express()
  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'appetiquetado-sync' })
  })

  app.get('/api/labels/:id', async (req, res) => {
    const id = String(req.params.id || '')
      .trim()
      .toUpperCase()
    if (!id || !/^[A-Z0-9_-]{4,64}$/.test(id)) {
      return res.status(400).json({ ok: false, error: 'id_invalido' })
    }
    try {
      const [rows] = await pool.execute(
        `SELECT id, created_at, fecha, exportacion, empresa, csg, especie, variedad,
                centro_costo, sector, cantidad_totes, jefe_cuadrilla
         FROM labels WHERE id = ? LIMIT 1`,
        [id],
      )
      if (!rows.length) {
        return res.status(404).json({ ok: false, error: 'not_found' })
      }
      return res.json({ ok: true, label: rows[0] })
    } catch (e) {
      console.error('[sync-api] GET /api/labels', e)
      return res.status(500).json({ ok: false, error: 'db' })
    }
  })

  app.post('/api/labels/batch', requireSyncKey, async (req, res) => {
    const raw = req.body?.labels
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ ok: false, error: 'labels_required' })
    }
    if (raw.length > 500) {
      return res.status(400).json({ ok: false, error: 'batch_too_large' })
    }
    const rows = []
    for (const item of raw) {
      const row = mapBodyToRow(item)
      if (!row) {
        return res.status(400).json({ ok: false, error: 'invalid_label' })
      }
      rows.push(row)
    }
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const row of rows) {
        await conn.execute(INSERT_SQL, row)
      }
      await conn.commit()
      return res.json({ ok: true, count: rows.length })
    } catch (e) {
      await conn.rollback()
      console.error('[sync-api] POST /api/labels/batch', e)
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
    console.log(
      `[sync-api] ${mode} http://0.0.0.0:${PORT}  (MySQL: ${process.env.MYSQL_DATABASE})`,
    )
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

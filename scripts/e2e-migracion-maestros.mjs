/**
 * CA-27 — Migración de auditoría de maestros (created_by / updated_by).
 * Guardián (loadTestEnv) → reset BD → simula el esquema ANTERIOR (sin las columnas ni FK) →
 * arranca server/index.cjs DOS veces seguidas → comprueba columnas, índices, FK, datos y autores NULL →
 * aplica database/schema.sql dos veces → vuelve a resetear la BD.
 * Uso: node scripts/e2e-migracion-maestros.mjs   (lo invoca scripts/e2e-api.mjs)
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { loadTestEnv, resetTestDb } from './test-env.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TABLAS = [
  { table: 'seasons', prefix: 'seasons' },
  { table: 'companies', prefix: 'companies' },
  { table: 'species', prefix: 'species' },
  { table: 'varieties', prefix: 'varieties' },
  { table: 'csg_catalog', prefix: 'csg' },
  { table: 'jc_foremen', prefix: 'jc_foremen' },
  { table: 'season_cost_centers', prefix: 'scc' },
]
const COLS = ['created_by', 'updated_by']

const env = loadTestEnv()
// E2E_MIGRACION_PORT permite probar con otro puerto si 3101 está ocupado (por defecto: el PORT de .env.test).
const PORT = Number(process.env.E2E_MIGRACION_PORT || env.PORT)
const api = `http://127.0.0.1:${PORT}`
const fallos = []
const check = (cond, msg) => {
  if (!cond) {
    fallos.push(msg)
    console.error(`  FALLO: ${msg}`)
  }
}

function puertoAbierto() {
  return new Promise((resolve) => {
    const s = net.connect({ port: PORT, host: '127.0.0.1' })
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', (e) => resolve(e.code === 'ECONNREFUSED' ? false : true))
  })
}

async function esperarPuertoLibre(topeMs = 10_000) {
  const limite = Date.now() + topeMs
  while (await puertoAbierto()) {
    if (Date.now() > limite) throw new Error(`El puerto ${PORT} no se liberó en ${topeMs / 1000} s`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

async function esperarHealth() {
  const limite = Date.now() + 30_000
  for (;;) {
    try {
      if ((await fetch(`${api}/api/health`)).ok) return
    } catch {
      /* arrancando */
    }
    if (Date.now() > limite) throw new Error('La API no arrancó en 30 s')
    await new Promise((r) => setTimeout(r, 300))
  }
}

/** Un arranque completo: espera health, captura stdout, mata, espera el exit y la liberación del puerto. */
async function arrancarUnaVez(n) {
  let salida = ''
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: { ...process.env, ...loadTestEnv(), PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => (salida += d))
  server.stderr.on('data', (d) => (salida += d))
  const salio = new Promise((resolve) => server.once('exit', resolve))
  try {
    await esperarHealth()
    check(salida.includes('Auditoría de maestros lista'), `arranque ${n}: falta la línea "Auditoría de maestros lista" en el stdout`)
    check(!salida.includes('ensureMastersAuditSchema'), `arranque ${n}: el stdout contiene errores de ensureMastersAuditSchema`)
  } finally {
    server.kill()
    await salio
    await esperarPuertoLibre()
  }
}

async function conectar(multi = false) {
  return mysql.createConnection({
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    multipleStatements: multi,
  })
}

async function simularEsquemaAnterior(conn) {
  for (const { table, prefix } of TABLAS) {
    for (const col of COLS) {
      const [fk] = await conn.execute(
        `SELECT CONSTRAINT_NAME AS n FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, `fk_${prefix}_${col}`],
      )
      if (fk.length) await conn.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`fk_${prefix}_${col}\``)
    }
    for (const col of COLS) {
      const [c] = await conn.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, col],
      )
      if (c.length) await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``)
    }
  }
}

async function instantanea(conn) {
  const snap = {}
  for (const { table } of TABLAS) {
    const [rows] = await conn.query(
      `SELECT id, CAST(created_at AS CHAR) AS created_at, CAST(updated_at AS CHAR) AS updated_at FROM \`${table}\` ORDER BY id`,
    )
    snap[table] = rows
  }
  return snap
}

let exitCode = 1
let tocoBd = false
try {
  if (await puertoAbierto()) {
    throw new Error(`El puerto ${PORT} ya está en uso (¿servidor de desarrollo corriendo?). No se mata ningún proceso: libérelo y reintente.`)
  }
  console.log('[migracion-maestros] reset de la BD de pruebas…')
  tocoBd = true
  await resetTestDb(env)

  const conn = await conectar()
  await simularEsquemaAnterior(conn)
  const antes = await instantanea(conn)
  for (const { table } of TABLAS) check(antes[table].length > 0, `la semilla debe dejar filas en ${table}`)
  console.log('[migracion-maestros] esquema anterior simulado; arrancando el servidor 2 veces seguidas…')

  await arrancarUnaVez(1)
  await arrancarUnaVez(2)

  for (const { table, prefix } of TABLAS) {
    for (const col of COLS) {
      const [c] = await conn.execute(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, col],
      )
      check(c[0].n === 1, `${table}.${col}: se esperaba 1 columna y hay ${c[0].n}`)
      const [i] = await conn.execute(
        `SELECT COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, `idx_${prefix}_${col}`],
      )
      check(i[0].n === 1, `${table}: falta el índice idx_${prefix}_${col}`)
      const [f] = await conn.execute(
        `SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, `fk_${prefix}_${col}`],
      )
      check(f[0].n === 1, `${table}: falta la FK fk_${prefix}_${col}`)
    }
    // Autores NULL (RN-11: no se rellena a nadie)
    const [nn] = await conn.query(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE created_by IS NOT NULL OR updated_by IS NOT NULL`,
    ).catch(() => [[{ n: -1 }]])
    check(nn[0].n === 0, `${table}: los registros existentes deben quedar con created_by/updated_by NULL (n=${nn[0].n})`)
  }
  const despues = await instantanea(conn)
  for (const { table } of TABLAS) {
    check(JSON.stringify(despues[table]) === JSON.stringify(antes[table]), `${table}: id/created_at/updated_at cambiaron con la migración`)
  }
  await conn.end()

  // schema.sql dos veces seguidas sin error
  const sql = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8')
  const c2 = await conectar(true)
  try {
    for (const vez of [1, 2]) {
      try {
        await c2.query(sql)
      } catch (e) {
        check(false, `schema.sql, aplicación ${vez}: ${e.message}`)
      }
    }
  } finally {
    await c2.end()
  }

  exitCode = fallos.length ? 1 : 0
  console.log(fallos.length ? `[migracion-maestros] ${fallos.length} fallo(s).` : '[migracion-maestros] OK (CA-27).')
} catch (error) {
  console.error('[migracion-maestros]', error.message || error)
} finally {
  try {
    if (tocoBd) await resetTestDb(env)
  } catch (e) {
    console.error('[migracion-maestros] no se pudo resetear la BD al terminar:', e.message || e)
  }
}
process.exit(exitCode)

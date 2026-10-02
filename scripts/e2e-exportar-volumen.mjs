/**
 * CA-19 — Exportar y reimportar una temporada con 5000 relaciones (volumen).
 * Guardián (loadTestEnv) → reset BD → API propia → admin importa 5000 filas → GET /api/admin/masters →
 * buildMastersExport (src/lib/masterExcel.ts) → XLSX.write → 5001 filas → reimportar sin cambios → 7 tablas
 * idénticas y master_import_runs +1 → apaga la API → reset BD (antes y después, para no ensuciar otras pruebas).
 * Uso: node --experimental-strip-types scripts/e2e-exportar-volumen.mjs   (lo invoca scripts/e2e-api.mjs)
 * Puerto: E2E_VOLUMEN_PORT (por defecto, el PORT de .env.test).
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import * as XLSX from 'xlsx'
import { loadTestEnv, resetTestDb } from './test-env.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TABLAS = ['seasons', 'companies', 'species', 'varieties', 'csg_catalog', 'jc_foremen', 'season_cost_centers']
const FILAS = 5000
const SEASON = { code: 'E2E-VOL', name: 'Temporada E2E-VOL', isCurrent: false }

const env = loadTestEnv()
const PORT = Number(process.env.E2E_VOLUMEN_PORT || env.PORT)
const api = `http://127.0.0.1:${PORT}`
const fallos = []
const check = (cond, msg) => {
  if (!cond) {
    fallos.push(msg)
    console.error(`  FALLO: ${msg}`)
  }
}

const puertoAbierto = () =>
  new Promise((resolve) => {
    const s = net.connect({ port: PORT, host: '127.0.0.1' })
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', (e) => resolve(e.code === 'ECONNREFUSED' ? false : true))
  })

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

async function post(ruta, token, body) {
  const res = await fetch(`${api}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

async function instantanea(conn) {
  const tablas = {}
  for (const t of TABLAS) {
    const [rows] = await conn.query(`SELECT * FROM \`${t}\` ORDER BY id`)
    tablas[t] = JSON.stringify(rows)
  }
  const [[runs]] = await conn.query('SELECT COUNT(*) AS n FROM master_import_runs')
  return { tablas, importRuns: Number(runs.n) }
}

let exitCode = 1
let server = null
let tocoBd = false
try {
  if (await puertoAbierto()) {
    throw new Error(`El puerto ${PORT} ya está en uso. No se mata ningún proceso: libérelo o use E2E_VOLUMEN_PORT.`)
  }
  tocoBd = true
  await resetTestDb(env)
  server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  server.stdout.on('data', () => {})
  await esperarHealth()

  const login = await post('/api/auth/login', null, { username: env.E2E_USER, password: env.E2E_PASS })
  check(login.body.ok === true, 'login del superadmin')
  const adminUser = `vol_admin_${Date.now().toString(36)}`
  const adminPass = `Pw-${Date.now().toString(36)}-Vol`
  const alta = await post('/api/admin/users', login.body.token, { username: adminUser, fullName: 'Admin Volumen', password: adminPass, role: 'admin' })
  check(alta.body.ok === true, 'alta del admin')
  const adminLogin = await post('/api/auth/login', null, { username: adminUser, password: adminPass })
  const token = adminLogin.body.token
  check(Boolean(token), 'login del admin')

  // 1) 5000 relaciones sobre catálogos de la semilla (incluye "Agrícola Esmeralda", código ≠ nombre: P5).
  const rows = Array.from({ length: FILAS }, (_, i) => ({
    empresa: 'Agrícola Esmeralda',
    cc: `VOL-${String(i + 1).padStart(4, '0')}`,
    especie: 'Cereza',
    variedad: 'Lapins',
    csg: i % 2 ? 'CSG002' : 'CSG001',
    ...(i % 2 === 0 ? { ccNombre: `Cuartel volumen ${i + 1}` } : {}),
  }))
  const inicial = await post('/api/master-data/import', token, { season: SEASON, rows })
  check(inicial.status === 200 && inicial.body.ok === true && inicial.body.applied === FILAS, `importación inicial de ${FILAS} filas: ${inicial.status} ${JSON.stringify(inicial.body)}`)
  if (!inicial.body.ok) throw new Error('sin la importación inicial no se puede continuar')

  // 2) Exportar con la lógica real del cliente.
  const mod = await import('../src/lib/masterExcel.ts')
  const resp = await fetch(`${api}/api/admin/masters`, { headers: { Authorization: `Bearer ${token}` } })
  const bundle = await resp.json()
  const season = bundle.seasons.find((s) => s.code === SEASON.code)
  check(Boolean(season), 'la temporada E2E-VOL existe')
  const exp = mod.buildMastersExport(bundle, season.id, new Date())
  check(exp.kind === 'ok', `la exportación debe ser kind "ok" (fue "${exp.kind}")`)
  if (exp.kind !== 'ok') throw new Error('exportación vacía')
  check(exp.rowCount === FILAS, `rowCount=${exp.rowCount}, esperado ${FILAS}`)
  check(exp.overImportLimit === false, 'overImportLimit debe ser false con 5000 filas')
  const buffer = XLSX.write(exp.workbook, { type: 'buffer', bookType: 'xlsx' })
  const leido = XLSX.read(buffer, { type: 'buffer', cellNF: true })
  const principal = XLSX.utils.sheet_to_json(leido.Sheets[leido.SheetNames[0]], { header: 1, defval: '', raw: false })
  check(principal.length === FILAS + 1, `la hoja principal debe tener ${FILAS + 1} filas (tiene ${principal.length})`)
  check(JSON.stringify(principal[0]) === JSON.stringify(mod.MASTER_HEADERS), 'encabezados de la hoja principal')

  // 3) Reimportar sin cambios: 7 tablas idénticas y master_import_runs +1.
  const reimport = mod.parseMasterWorkbook(leido)
  check(reimport.length === FILAS, `parseMasterWorkbook debe devolver ${FILAS} filas (devolvió ${reimport.length})`)
  const conn = await mysql.createConnection({ host: env.MYSQL_HOST, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE })
  try {
    const antes = await instantanea(conn)
    await new Promise((r) => setTimeout(r, 150))
    const vuelta = await post('/api/master-data/import', token, { season: SEASON, rows: reimport })
    check(
      vuelta.status === 200 && vuelta.body.ok === true && vuelta.body.received === FILAS && vuelta.body.applied === FILAS,
      `reimportación: ${vuelta.status} ${JSON.stringify(vuelta.body)}`,
    )
    const despues = await instantanea(conn)
    for (const t of TABLAS) check(despues.tablas[t] === antes.tablas[t], `${t}: cambió con la reimportación sin cambios`)
    check(despues.importRuns === antes.importRuns + 1, `master_import_runs: ${antes.importRuns} -> ${despues.importRuns} (esperado +1)`)
  } finally {
    await conn.end()
  }

  exitCode = fallos.length ? 1 : 0
  console.log(fallos.length ? `[exportar-volumen] ${fallos.length} fallo(s).` : '[exportar-volumen] OK (CA-19).')
} catch (error) {
  fallos.push(error.message || String(error))
  console.error('[exportar-volumen]', error.message || error)
} finally {
  if (server) {
    if (server.exitCode === null) {
      const salio = new Promise((resolve) => server.once('exit', resolve))
      server.kill()
      await salio
    }
    await esperarPuertoLibre().catch(() => {})
  }
  try {
    if (tocoBd) await resetTestDb(env)
  } catch (e) {
    console.error('[exportar-volumen] no se pudo resetear la BD al terminar:', e.message || e)
  }
}
process.exit(exitCode)

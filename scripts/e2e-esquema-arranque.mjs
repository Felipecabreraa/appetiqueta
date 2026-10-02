/**
 * Escenarios de arranque del esquema (spec 20261002-esquema-y-errores-login, CA-01..CA-05, CA-07, CA-08, CA-15, CA-16).
 * Guardián (loadTestEnv: solo BD local *_test) → reset → manipula la BD → arranca server/index.cjs → verifica → apaga.
 * Toda manipulación de BD ocurre únicamente contra la BD local de pruebas. Deja la BD reseteada al terminar.
 * Uso: node scripts/e2e-esquema-arranque.mjs   (lo invoca scripts/e2e-api.mjs)
 * CA-05 requiere MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD (en .env.test o en el entorno): sin ellas se omite con aviso
 * en local y FALLA en CI (process.env.CI).
 */
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { loadTestEnv, resetTestDb } from './test-env.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadTestEnv()
const PORT = Number(process.env.E2E_ESQUEMA_PORT || process.env.E2E_MIGRACION_PORT || env.PORT)
const api = `http://127.0.0.1:${PORT}`
const SCHEMA_SQL = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8')
// Las 16 tablas base, en el orden de schema.sql (RN-08).
const TABLAS = [...SCHEMA_SQL.matchAll(/^CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(/gim)].map((m) => m[1])
const MAESTROS = [
  ['seasons', 'seasons'], ['companies', 'companies'], ['species', 'species'], ['varieties', 'varieties'],
  ['csg_catalog', 'csg'], ['jc_foremen', 'jc_foremen'], ['season_cost_centers', 'scc'],
]
const ADMIN_USER = env.MYSQL_ADMIN_USER || process.env.MYSQL_ADMIN_USER
const ADMIN_PASS = env.MYSQL_ADMIN_PASSWORD ?? process.env.MYSQL_ADMIN_PASSWORD ?? ''
const SIN_DDL = 'appetiq_sin_ddl'
const SIN_DDL_PASS = 'sin_ddl_pw_test'

const fallos = []
const check = (cond, msg) => {
  if (!cond) {
    fallos.push(msg)
    console.error(`  FALLO: ${msg}`)
  }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function puertoAbierto() {
  return new Promise((resolve) => {
    const s = net.connect({ port: PORT, host: '127.0.0.1' })
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', (e) => resolve(e.code === 'ECONNREFUSED' ? false : true))
  })
}
async function esperarPuertoLibre(topeMs = 10_000) {
  const limite = Date.now() + topeMs
  while (await puertoAbierto()) {
    if (Date.now() > limite) throw new Error(`El puerto ${PORT} no se liberó en ${topeMs / 1000} s`)
    await dormir(150)
  }
}

/** Arranca server/index.cjs con overrides de entorno; devuelve { salida(), stop(), vivo() }. */
async function arrancar(overrides = {}) {
  let salida = ''
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(PORT), ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (d) => (salida += d))
  server.stderr.on('data', (d) => (salida += d))
  let salio = false
  const exit = new Promise((resolve) => server.once('exit', () => { salio = true; resolve() }))
  const limite = Date.now() + 30_000
  for (;;) {
    try {
      if ((await fetch(`${api}/api/health`)).ok) break
    } catch { /* arrancando */ }
    if (salio) throw new Error(`El servidor terminó durante el arranque:\n${salida}`)
    if (Date.now() > limite) { server.kill(); throw new Error('La API no arrancó en 30 s') }
    await dormir(250)
  }
  return {
    salida: () => salida,
    vivo: () => !salio,
    async stop() {
      server.kill()
      await exit
      await esperarPuertoLibre()
    },
  }
}

const conectar = (extra = {}) =>
  mysql.createConnection({
    host: env.MYSQL_HOST, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE, ...extra,
  })

async function createDe(conn, tabla) {
  const [r] = await conn.query(`SHOW CREATE TABLE \`${tabla}\``)
  return String(r[0]['Create Table']).replace(/ AUTO_INCREMENT=\d+/g, '')
}
async function referencias(conn) {
  const ref = {}
  for (const t of TABLAS) ref[t] = await createDe(conn, t)
  return ref
}
async function existe(conn, tabla) {
  const [r] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabla])
  return r.length > 0
}

async function resetear() {
  await resetTestDb(env)
}
async function crearOperador(conn, username = 'operador1', clave = 'Operador-1-clave') {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(clave, salt, 64).toString('hex')
  await conn.query(
    `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
     SELECT ?, 'Operador Uno', ?, id, 1 FROM roles WHERE code = 'operador'`,
    [username, `${salt}:${hash}`],
  )
  return { username, password: clave }
}
async function http(metodo, ruta, { token, body } = {}) {
  const t0 = Date.now()
  const res = await fetch(`${api}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json, ms: Date.now() - t0 }
}
const login = (username, password) => http('POST', '/api/auth/login', { body: { username, password } })

async function escenario(nombre, fn) {
  console.log(`[esquema-arranque] ${nombre}`)
  await resetear()
  const conn = await conectar()
  try {
    await fn(conn)
  } catch (e) {
    check(false, `${nombre}: excepción ${e.message || e}`)
  } finally {
    await conn.end().catch(() => {})
  }
}

let exitCode = 1
let tocoBd = false
try {
  if (TABLAS.length !== 16) throw new Error(`Se esperaban 16 tablas en schema.sql y hay ${TABLAS.length}`)
  if (await puertoAbierto()) {
    throw new Error(`El puerto ${PORT} ya está en uso (¿servidor de desarrollo corriendo?). No se mata ningún proceso: libérelo y reintente (o use E2E_ESQUEMA_PORT).`)
  }
  tocoBd = true

  // CA-01
  await escenario('CA-01: falta auth_sessions → el arranque la crea y el login funciona', async (conn) => {
    const ref = await referencias(conn)
    const op = await crearOperador(conn)
    await conn.query('DROP TABLE auth_sessions')
    const s = await arrancar()
    try {
      check(await existe(conn, 'auth_sessions'), 'CA-01: auth_sessions no existe tras el arranque')
      if (await existe(conn, 'auth_sessions')) check((await createDe(conn, 'auth_sessions')) === ref.auth_sessions, 'CA-01: SHOW CREATE TABLE auth_sessions difiere de schema.sql')
      check(/Tabla creada: auth_sessions/.test(s.salida()), 'CA-01: el stdout no contiene "Tabla creada: auth_sessions"')
      const l = await login(op.username, op.password)
      check(l.status === 200 && l.body.ok === true && !!l.body.token && !!l.body.user, `CA-01: login esperado 200 {ok,token,user}, fue ${l.status} ${JSON.stringify(l.body)}`)
      const me = await http('GET', '/api/auth/me', { token: l.body.token })
      check(me.status === 200, `CA-01: /api/auth/me esperado 200, fue ${me.status}`)
    } finally {
      await s.stop()
    }
  })

  // CA-02
  await escenario('CA-02: faltan auth_sessions, movements y batch_log_labels', async (conn) => {
    const ref = await referencias(conn)
    for (const t of ['auth_sessions', 'movements', 'batch_log_labels']) await conn.query(`DROP TABLE \`${t}\``)
    const s = await arrancar()
    try {
      for (const t of ['auth_sessions', 'movements', 'batch_log_labels']) {
        const hay = await existe(conn, t)
        check(hay, `CA-02: ${t} no existe tras el arranque`)
        if (hay) check((await createDe(conn, t)) === ref[t], `CA-02: SHOW CREATE TABLE ${t} difiere de schema.sql`)
      }
      check(!s.salida().includes('[schema] ERROR'), `CA-02: el stdout contiene "[schema] ERROR":\n${s.salida()}`)
    } finally {
      await s.stop()
    }
  })

  await escenario('CA-02 (borde): se eliminó users (padre) con FK colgantes → se recrea', async (conn) => {
    const ref = await referencias(conn)
    await conn.query('SET FOREIGN_KEY_CHECKS=0')
    await conn.query('DROP TABLE users')
    await conn.query('SET FOREIGN_KEY_CHECKS=1')
    const s = await arrancar()
    try {
      const hay = await existe(conn, 'users')
      check(hay, 'CA-02 borde: users no existe tras el arranque')
      if (hay) check((await createDe(conn, 'users')) === ref.users, 'CA-02 borde: SHOW CREATE TABLE users difiere de schema.sql')
      if (env.SUPERADMIN_PASSWORD) {
        const l = await login(env.SUPERADMIN_USERNAME || 'superadmin', env.SUPERADMIN_PASSWORD)
        check(l.status === 200 && l.body.ok === true, `CA-02 borde: el superadmin no pudo iniciar sesión (${l.status} ${JSON.stringify(l.body)})`)
      }
    } finally {
      await s.stop()
    }
  })

  // CA-03
  await escenario('CA-03: esquema completo → arranque idempotente y sin pérdida de datos', async (conn) => {
    const s0 = await arrancar() // calentamiento: normaliza roles y superadmin
    let tokenAdmin
    try {
      const l = await login(env.E2E_USER, env.E2E_PASS)
      tokenAdmin = l.body.token
      const id = `E2E${Date.now().toString(36).toUpperCase()}`.padEnd(12, 'X').slice(0, 12)
      const lote = await http('POST', '/api/labels/batch', {
        token: tokenAdmin,
        body: { labels: [{ id, fecha: '2026-01-15T08:00', empresa: 'Agrícola Esmeralda', csg: 'CSG001', especie: 'Cereza', variedad: 'Lapins', centroCosto: 'CC01', sector: 'S-E2E', cantidadTotes: null }] },
      })
      check(lote.body.ok === true, `CA-03: no se pudo crear la etiqueta (${JSON.stringify(lote.body)})`)
      const jc = await http('POST', '/api/movements', { body: { labelId: id, type: 'jc', cantidad: 3, at: new Date().toISOString(), jefeCuadrilla: 'Juan Pérez', precioClp: 1500, jh: 8 } })
      check(jc.body.ok === true, `CA-03: no se pudo registrar el JC (${JSON.stringify(jc.body)})`)
      const t = Date.now().toString(36).toUpperCase()
      const temp = await http('POST', '/api/admin/seasons', { token: tokenAdmin, body: { code: `T${t}`, name: `Temporada ${t}` } })
      check(temp.body.ok === true, `CA-03: no se pudo crear la temporada (${JSON.stringify(temp.body)})`)
    } finally {
      await s0.stop()
    }
    for (const t of ['users', 'labels', 'movements', 'seasons', 'season_cost_centers']) {
      const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``)
      check(c.n > 0, `CA-03: la tabla ${t} debe tener datos antes de medir (n=${c.n})`)
    }
    const medir = async () => {
      const m = {}
      for (const t of TABLAS) {
        const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``)
        const [[k]] = await conn.query(`CHECKSUM TABLE \`${t}\``)
        m[t] = { n: c.n, checksum: String(k.Checksum) }
      }
      return m
    }
    const listarTablas = async () => (await conn.query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1'))[0].map((r) => r.t)
    const antes = await medir()
    const tablasAntes = await listarTablas()
    for (const n of [1, 2]) {
      const s = await arrancar()
      try {
        check(!/Tabla creada/.test(s.salida()), `CA-03: el arranque ${n} informa "Tabla creada":\n${s.salida()}`)
      } finally {
        await s.stop()
      }
    }
    const despues = await medir()
    const tablasDespues = await listarTablas()
    check(JSON.stringify(tablasAntes) === JSON.stringify(tablasDespues), 'CA-03: cambió el conjunto de tablas')
    check(TABLAS.every((t) => tablasDespues.includes(t)), 'CA-03: faltan tablas base tras los arranques')
    for (const t of TABLAS) {
      check(antes[t].n === despues[t].n, `CA-03: ${t} cambió el conteo de filas (${antes[t].n} → ${despues[t].n})`)
      if (t !== 'roles' && t !== 'app_meta') check(antes[t].checksum === despues[t].checksum, `CA-03: ${t} cambió su CHECKSUM TABLE`)
    }
  })

  // CA-04
  await escenario('CA-04: una tabla existente con otra definición no se recrea ni se altera', async (conn) => {
    await conn.query('ALTER TABLE labels DROP FOREIGN KEY fk_labels_created_by')
    const antes = await createDe(conn, 'labels')
    const [[k0]] = await conn.query('CHECKSUM TABLE labels')
    const s = await arrancar()
    try {
      const despues = await createDe(conn, 'labels')
      const [[k1]] = await conn.query('CHECKSUM TABLE labels')
      check(despues === antes, 'CA-04: SHOW CREATE TABLE labels cambió (se recreó o re-agregó la FK)')
      check(String(k0.Checksum) === String(k1.Checksum), 'CA-04: cambió el checksum de labels')
      check(!/DROP\s+TABLE|TRUNCATE|RENAME\s+TABLE/i.test(s.salida()), 'CA-04: el log menciona DDL destructivo')
    } finally {
      await s.stop()
    }
  })

  // CA-05
  console.log('[esquema-arranque] CA-05: sin privilegio CREATE')
  if (!ADMIN_USER) {
    const msg = 'CA-05: faltan MYSQL_ADMIN_USER / MYSQL_ADMIN_PASSWORD (credenciales de administrador solo para la BD de pruebas)'
    if (process.env.CI) check(false, msg)
    else console.warn(`  AVISO (omitido en local): ${msg}`)
  } else {
    await resetear()
    const conn = await conectar()
    const admin = await mysql.createConnection({ host: env.MYSQL_HOST, user: ADMIN_USER, password: ADMIN_PASS })
    const db = env.MYSQL_DATABASE.replace(/`/g, '')
    let s
    try {
      for (const h of ['%', 'localhost']) {
        await admin.query(`DROP USER IF EXISTS '${SIN_DDL}'@'${h}'`)
        await admin.query(`CREATE USER '${SIN_DDL}'@'${h}' IDENTIFIED BY '${SIN_DDL_PASS}'`)
        await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${db}\`.* TO '${SIN_DDL}'@'${h}'`)
      }
      await conn.query('DROP TABLE auth_sessions')
      s = await arrancar({ MYSQL_USER: SIN_DDL, MYSQL_PASSWORD: SIN_DDL_PASS })
      check(s.vivo(), 'CA-05: el proceso no sigue vivo')
      const h = await http('GET', '/api/health')
      check(h.status === 200, `CA-05: health esperado 200, fue ${h.status}`)
      check(h.body.schemaComplete === false, `CA-05: schemaComplete esperado false, fue ${JSON.stringify(h.body.schemaComplete)}`)
      check(JSON.stringify(h.body.missingTables) === JSON.stringify(['auth_sessions']), `CA-05: missingTables esperado ["auth_sessions"], fue ${JSON.stringify(h.body.missingTables)}`)
      check(s.salida().includes('auth_sessions') && s.salida().includes('ER_TABLEACCESS_DENIED_ERROR'), 'CA-05: el stdout no nombra auth_sessions con ER_TABLEACCESS_DENIED_ERROR')
      const et = await http('GET', '/api/labels/ZZZZ2222ZZZZ')
      check(et.status === 404, `CA-05: GET /api/labels/ZZZZ2222ZZZZ esperado 404 (no 503), fue ${et.status}`)
    } catch (e) {
      check(false, `CA-05: excepción ${e.message || e}`)
    } finally {
      if (s) await s.stop().catch(() => {})
      for (const h of ['%', 'localhost']) await admin.query(`DROP USER IF EXISTS '${SIN_DDL}'@'${h}'`).catch(() => {})
      await admin.end().catch(() => {})
      await conn.end().catch(() => {})
    }
  }

  // CA-07
  await escenario('CA-07: auth_sessions desaparece en caliente → health lo refleja en < 5 s', async (conn) => {
    const s = await arrancar()
    try {
      const h0 = await http('GET', '/api/health')
      check(h0.status === 200 && h0.body.schemaComplete === true, `CA-07: con el esquema completo health debe informar schemaComplete=true (fue ${JSON.stringify(h0.body.schemaComplete)})`)
      await conn.query('DROP TABLE auth_sessions')
      const limite = Date.now() + 5_000
      let ultimo
      let visto = false
      while (Date.now() < limite) {
        ultimo = await http('GET', '/api/health')
        check(ultimo.status === 200, `CA-07: health esperado 200, fue ${ultimo.status}`)
        check(ultimo.ms < 2_000, `CA-07: health tardó ${ultimo.ms} ms (≥ 2 s)`)
        if (Array.isArray(ultimo.body.missingTables) && ultimo.body.missingTables.includes('auth_sessions')) { visto = true; break }
        await dormir(300)
      }
      check(visto, `CA-07: en 5 s health no listó auth_sessions (último: ${JSON.stringify(ultimo?.body)})`)
      check(ultimo?.body.schemaComplete === false, `CA-07: schemaComplete esperado false, fue ${JSON.stringify(ultimo?.body.schemaComplete)}`)
    } finally {
      await s.stop()
    }
  })

  // CA-08
  await escenario('CA-08: sin conexión a MySQL (clave incorrecta) → esquema desconocido', async () => {
    const s = await arrancar({ MYSQL_PASSWORD: `${env.MYSQL_PASSWORD}_incorrecta` })
    try {
      const h = await http('GET', '/api/health')
      check(h.status === 200, `CA-08: health esperado 200, fue ${h.status}`)
      check(h.body.dbReady === false, `CA-08: dbReady esperado false, fue ${JSON.stringify(h.body.dbReady)}`)
      check(h.body.schemaComplete === null, `CA-08: schemaComplete esperado null, fue ${JSON.stringify(h.body.schemaComplete)}`)
      check(h.body.missingTables === null, `CA-08: missingTables esperado null, fue ${JSON.stringify(h.body.missingTables)}`)
    } finally {
      await s.stop()
    }
  })

  // CA-15
  await escenario('CA-15: 11 respuestas 500 de login no consumen el cupo de intentos', async (conn) => {
    const ref = await createDe(conn, 'auth_sessions')
    const op = await crearOperador(conn)
    const s = await arrancar({ RATE_LIMIT_LOGIN_PER_MIN: '10' })
    try {
      await conn.query('DROP TABLE auth_sessions')
      const estados = []
      for (let i = 0; i < 11; i++) estados.push((await login(op.username, op.password)).status)
      check(estados.every((e) => e === 500), `CA-15: se esperaban 11 × 500, fue ${estados.join(',')}`)
      await conn.query(ref)
      const ok = await login(op.username, op.password)
      check(ok.status === 200, `CA-15: tras reparar, el login esperado 200 (no 429), fue ${ok.status}`)
    } finally {
      await s.stop()
    }
  })

  // CA-16
  await escenario('CA-16: se quitan las columnas de auditoría en caliente → Maestros carga sin autor', async (conn) => {
    const s = await arrancar()
    try {
      const l = await login(env.E2E_USER, env.E2E_PASS)
      const token = l.body.token
      const u = `e2e_admin_${Date.now().toString(36)}`
      const alta = await http('POST', '/api/admin/users', { token, body: { username: u, fullName: 'Admin E2E', password: 'Admin-E2E-clave1', role: 'admin' } })
      check(alta.body.ok === true, `CA-16: no se pudo crear el admin (${JSON.stringify(alta.body)})`)
      const la = await login(u, 'Admin-E2E-clave1')
      const tk = la.body.token
      const antes = await http('GET', '/api/admin/masters', { token: tk })
      check(antes.status === 200 && antes.body.ok === true, `CA-16: masters previo esperado 200, fue ${antes.status}`)
      check(antes.body.seasons?.length > 0, 'CA-16: masters previo debe traer temporadas')

      for (const [tabla, prefijo] of MAESTROS) {
        for (const col of ['created_by', 'updated_by']) {
          const [fk] = await conn.execute(
            'SELECT CONSTRAINT_NAME AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?',
            [tabla, `fk_${prefijo}_${col}`],
          )
          if (fk.length) await conn.query(`ALTER TABLE \`${tabla}\` DROP FOREIGN KEY \`fk_${prefijo}_${col}\``)
        }
        for (const col of ['created_by', 'updated_by']) {
          const [c] = await conn.execute('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [tabla, col])
          if (c.length) await conn.query(`ALTER TABLE \`${tabla}\` DROP COLUMN \`${col}\``)
        }
      }

      const limite = Date.now() + 15_000
      let recuperado
      const intermedios = []
      while (Date.now() < limite) {
        const r = await http('GET', '/api/admin/masters', { token: tk })
        if (r.status === 200) { recuperado = r; break }
        intermedios.push(r)
        await dormir(500)
      }
      check(!!recuperado, `CA-16: en 15 s Maestros no volvió a 200 (intermedios: ${intermedios.length}, último: ${JSON.stringify(intermedios.at(-1))})`)
      for (const r of intermedios) check(r.status === 500 && r.body.error === 'db', `CA-16: un 500 intermedio debe ser {ok:false,error:'db'}, fue ${r.status} ${JSON.stringify(r.body)}`)
      if (recuperado) {
        check(recuperado.body.seasons?.length > 0 && recuperado.body.companies?.length > 0, 'CA-16: tras recuperar, las listas deben venir con datos')
        const sinAutor = ['seasons', 'companies', 'species', 'varieties', 'csg', 'jcForemen', 'relations'].every((k) => (recuperado.body[k] || []).every((r) => r.createdBy == null))
        check(sinAutor, 'CA-16: tras recuperar, createdBy debe ser null en todos los registros')
      }
      const out = s.salida()
      check(out.includes('ER_BAD_FIELD_ERROR') || out.includes('created_by'), 'CA-16: el stdout no nombra ER_BAD_FIELD_ERROR ni created_by')
      const h = await http('GET', '/api/health')
      check(h.status === 200 && h.body.mastersAuditReady === false, `CA-16: health.mastersAuditReady esperado false, fue ${JSON.stringify(h.body.mastersAuditReady)}`)
      check(h.body.schemaComplete === false, `CA-16: health.schemaComplete esperado false, fue ${JSON.stringify(h.body.schemaComplete)}`)
    } finally {
      await s.stop()
    }
  })

  exitCode = fallos.length ? 1 : 0
  console.log(fallos.length ? `[esquema-arranque] ${fallos.length} fallo(s).` : '[esquema-arranque] OK.')
} catch (error) {
  console.error('[esquema-arranque]', error.message || error)
} finally {
  try {
    if (tocoBd) await resetTestDb(env)
  } catch (e) {
    console.error('[esquema-arranque] no se pudo resetear la BD al terminar:', e.message || e)
  }
}
process.exit(exitCode)

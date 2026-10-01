/**
 * Entorno de PRUEBAS aislado.
 * - Carga .env.test (nunca .env).
 * - Guardián: aborta si la BD no es local o no termina en "_test".
 * - `node scripts/test-env.mjs reset` recrea el esquema y aplica la semilla.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function loadTestEnv() {
  const file = path.join(root, '.env.test')
  if (!fs.existsSync(file)) {
    throw new Error('Falta .env.test (copie .env.test.example). Las pruebas no usan .env.')
  }
  const env = dotenv.parse(fs.readFileSync(file))
  assertSafeTestEnv(env)
  return env
}

export function assertSafeTestEnv(env) {
  const host = String(env.MYSQL_HOST || '').trim()
  const db = String(env.MYSQL_DATABASE || '').trim()
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`[guardian] MYSQL_HOST="${host}" no es local. Pruebas bloqueadas.`)
  }
  if (!/_test$/.test(db)) {
    throw new Error(`[guardian] MYSQL_DATABASE="${db}" no termina en _test. Pruebas bloqueadas.`)
  }
}

export async function resetTestDb(env = loadTestEnv()) {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    multipleStatements: true,
  })
  try {
    const [tables] = await conn.query(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
      [env.MYSQL_DATABASE],
    )
    const drops = tables.map((r) => `DROP TABLE IF EXISTS \`${r.t}\`;`).join('\n')
    await conn.query(`SET FOREIGN_KEY_CHECKS = 0;\n${drops}\nSET FOREIGN_KEY_CHECKS = 1;`)
    await conn.query(fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8'))
    await conn.query(fs.readFileSync(path.join(root, 'database/seed.test.sql'), 'utf8'))
    // Usuario de prueba (mismo formato scrypt "salt:hash" que server/index.cjs).
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(String(env.E2E_PASS), salt, 64).toString('hex')
    await conn.query(
      `INSERT INTO users (username, full_name, password_hash, role_id, is_active)
       SELECT ?, 'Super Admin E2E', ?, id, 1 FROM roles WHERE code = 'superadmin'`,
      [env.E2E_USER, `${salt}:${hash}`],
    )
  } finally {
    await conn.end()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2]
  try {
    const env = loadTestEnv()
    if (cmd === 'reset') {
      await resetTestDb(env)
      console.log(`[test-env] BD ${env.MYSQL_DATABASE} recreada con esquema + semilla.`)
    } else {
      console.log(`[test-env] OK: ${env.MYSQL_DATABASE}@${env.MYSQL_HOST}`)
    }
  } catch (error) {
    console.error(error.message || error)
    process.exit(1)
  }
}

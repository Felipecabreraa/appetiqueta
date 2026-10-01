/**
 * Aplica database/schema.sql a la BD de PRUEBAS (staging) definida en .env.staging.
 * Guardián: MYSQL_DATABASE debe ser exactamente STAGING_DB. No borra datos (schema.sql es idempotente).
 * Uso: npm run db:staging:init
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const STAGING_DB = 'trn_etiquetatest'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, '.env.staging')
if (!fs.existsSync(file)) {
  console.error('Falta .env.staging (copie .env.staging.example).')
  process.exit(1)
}
const env = dotenv.parse(fs.readFileSync(file))
if (String(env.MYSQL_DATABASE || '').trim() !== STAGING_DB) {
  console.error(`[guardian] MYSQL_DATABASE="${env.MYSQL_DATABASE}" no es la BD de pruebas (${STAGING_DB}). Abortado.`)
  process.exit(1)
}
const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  multipleStatements: true,
})
try {
  await conn.query(fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8'))
  console.log(`[staging] Esquema aplicado en ${env.MYSQL_DATABASE}@${env.MYSQL_HOST}.`)
} finally {
  await conn.end()
}

/**
 * Vacía los datos OPERATIVOS de una BD (etiquetas, lecturas JC/acopio y lotes) y conserva los maestros,
 * usuarios y roles. Antes de borrar guarda un respaldo completo de esas tablas en backups/.
 *
 * Uso (lo ejecuta una persona, nunca un agente):
 *   node scripts/db-limpiar-operacion.mjs --env .env                      → solo muestra conteos (simulación)
 *   node scripts/db-limpiar-operacion.mjs --env .env --confirmar <nombre_bd>  → respalda y borra
 *
 * --confirmar debe repetir exactamente el MYSQL_DATABASE del archivo indicado.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Orden de borrado respetando claves foráneas (hijos primero).
const TABLAS_OPERATIVAS = ['movements', 'batch_log_labels', 'batch_logs', 'labels']

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const envFile = arg('--env')
if (!envFile) {
  console.error('Indique el archivo de entorno: --env .env (producción) | .env.staging | .env.test')
  process.exit(1)
}
const envPath = path.resolve(root, envFile)
if (!fs.existsSync(envPath)) {
  console.error(`No existe ${envPath}`)
  process.exit(1)
}
const env = dotenv.parse(fs.readFileSync(envPath))
const database = String(env.MYSQL_DATABASE || '').trim()
const confirmar = arg('--confirmar')

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database,
})

try {
  const conteos = {}
  for (const t of TABLAS_OPERATIVAS) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``)
    conteos[t] = Number(row.n)
  }
  console.log(`BD: ${database} @ ${env.MYSQL_HOST}`)
  console.table(conteos)

  if (!confirmar) {
    console.log('\nSIMULACIÓN: no se borró nada. Para borrar agregue: --confirmar ' + database)
    process.exit(0)
  }
  if (confirmar !== database) {
    console.error(`\n--confirmar "${confirmar}" no coincide con MYSQL_DATABASE "${database}". Abortado.`)
    process.exit(1)
  }

  // 1) Respaldo completo de las tablas operativas.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(root, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const respaldo = { database, host: env.MYSQL_HOST, createdAt: new Date().toISOString(), tablas: {} }
  for (const t of TABLAS_OPERATIVAS) {
    const [rows] = await conn.query(`SELECT * FROM \`${t}\``)
    respaldo.tablas[t] = rows
  }
  const file = path.join(dir, `operacion-${database}-${stamp}.json`)
  fs.writeFileSync(file, JSON.stringify(respaldo, null, 2))
  const guardadas = Object.values(respaldo.tablas).reduce((a, r) => a + r.length, 0)
  console.log(`\nRespaldo: ${file} (${guardadas} filas)`)

  // 2) Borrado en una sola transacción: o se borra todo, o nada.
  await conn.beginTransaction()
  for (const t of TABLAS_OPERATIVAS) {
    const [r] = await conn.query(`DELETE FROM \`${t}\``)
    console.log(`  ${t}: ${r.affectedRows} filas eliminadas`)
  }
  await conn.commit()

  const [[m]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM season_cost_centers) AS cc, (SELECT COUNT(*) FROM companies) AS empresas,
            (SELECT COUNT(*) FROM jc_foremen) AS jefes, (SELECT COUNT(*) FROM users) AS usuarios`,
  )
  console.log('\nListo. Maestros y usuarios intactos:', m)
} catch (error) {
  try {
    await conn.rollback()
  } catch {
    /* sin transacción abierta */
  }
  console.error('Error: no se borró nada.', error.message || error)
  process.exit(1)
} finally {
  await conn.end()
}

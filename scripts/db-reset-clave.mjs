/**
 * Fija una contraseña nueva para un usuario directamente en la BD (recuperación de acceso del SuperAdmin).
 * La contraseña se pide de forma oculta (no queda en el historial de la terminal) y se guarda con el mismo
 * formato scrypt "salt:hash" que usa server/index.cjs. Cierra las sesiones abiertas de ese usuario.
 *
 * Uso (lo ejecuta una persona, nunca un agente):
 *   node scripts/db-reset-clave.mjs --env .env.staging --usuario superadmin --confirmar trn_etiquetatest
 *
 * --confirmar debe repetir exactamente el MYSQL_DATABASE del archivo indicado.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

// Sin terminal interactiva (p. ej. pruebas) se leen todas las líneas de stdin una sola vez.
let lineasStdin = null
async function siguienteLineaStdin() {
  if (!lineasStdin) {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    lineasStdin = data.split(/\r?\n/)
  }
  return lineasStdin.shift() ?? ''
}

function preguntarOculto(texto) {
  if (!process.stdin.isTTY) return siguienteLineaStdin()
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(texto)) rl.output.write(s)
    }
    rl.question(texto, (value) => {
      rl.close()
      process.stdout.write('\n')
      resolve(value)
    })
  })
}

const envFile = arg('--env')
const usuario = String(arg('--usuario') || '').trim().toLowerCase()
const confirmar = arg('--confirmar')
if (!envFile || !usuario || !confirmar) {
  console.error('Uso: node scripts/db-reset-clave.mjs --env <archivo> --usuario <usuario> --confirmar <nombre_bd>')
  process.exit(1)
}
const envPath = path.resolve(root, envFile)
if (!fs.existsSync(envPath)) {
  console.error(`No existe ${envPath}`)
  process.exit(1)
}
const env = dotenv.parse(fs.readFileSync(envPath))
const database = String(env.MYSQL_DATABASE || '').trim()
if (confirmar !== database) {
  console.error(`--confirmar "${confirmar}" no coincide con MYSQL_DATABASE "${database}". Abortado.`)
  process.exit(1)
}

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST,
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database,
})
try {
  const [rows] = await conn.execute(
    `SELECT u.id, u.username, u.is_active, r.code AS role FROM users u INNER JOIN roles r ON r.id = u.role_id`,
  )
  const user = rows.find((r) => r.username === usuario)
  if (!user) {
    console.error(`No existe el usuario "${usuario}" en ${database}. Usuarios: ${rows.map((r) => `${r.username} (${r.role})`).join(', ')}`)
    process.exit(1)
  }

  const clave = await preguntarOculto(`Nueva contraseña para ${usuario} (mín. 8 caracteres): `)
  const repetir = await preguntarOculto('Repita la contraseña: ')
  if (clave.length < 8) {
    console.error('La contraseña debe tener al menos 8 caracteres. No se cambió nada.')
    process.exit(1)
  }
  if (clave !== repetir) {
    console.error('Las contraseñas no coinciden. No se cambió nada.')
    process.exit(1)
  }

  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(clave, salt, 64).toString('hex')
  await conn.beginTransaction()
  await conn.execute('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?', [`${salt}:${hash}`, user.id])
  await conn.execute('DELETE FROM auth_sessions WHERE user_id = ?', [user.id])
  await conn.commit()
  console.log(`Listo: contraseña actualizada para ${usuario} (${user.role}) en ${database}. Sesiones anteriores cerradas.`)
} catch (error) {
  try {
    await conn.rollback()
  } catch {
    /* sin transacción abierta */
  }
  console.error('Error: no se cambió nada.', error.message || error)
  process.exit(1)
} finally {
  await conn.end()
}

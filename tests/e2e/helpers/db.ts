import mysql, { type Connection } from 'mysql2/promise'
import { loadTestEnv } from '../../../scripts/test-env.mjs'

/** Conexión directa a la BD de pruebas (loadTestEnv aplica el guardián: solo local y *_test). */
export async function conectarBd(): Promise<Connection> {
  const env = loadTestEnv()
  return mysql.createConnection({
    host: env.MYSQL_HOST,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
  })
}

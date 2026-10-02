/**
 * E2E de API contra la BD de PRUEBAS: guardián → reset BD → levanta API (.env.test) → e2e-carga-trackeo → apaga.
 * Uso: npm run test:e2e:api
 */
import { spawn } from 'node:child_process'
import { loadTestEnv, resetTestDb } from './test-env.mjs'

const env = loadTestEnv()

// CA-27: la migración de auditoría de maestros se prueba antes de levantar la API del E2E
// (arranca y apaga la API dos veces, y deja la BD reseteada al terminar).
const migracion = await new Promise((resolve) => {
  const run = spawn(process.execPath, ['scripts/e2e-migracion-maestros.mjs'], { env: { ...process.env, ...env }, stdio: 'inherit' })
  run.on('exit', (code) => resolve(code ?? 1))
})
if (migracion !== 0) {
  console.error('La prueba de migración de maestros (CA-27) falló.')
  process.exit(migracion)
}

// Esquema autorreparable y estado del esquema (spec 20261002-esquema-y-errores-login): arranca/apaga la API
// varias veces y deja la BD reseteada al terminar. CA-05 usa MYSQL_ADMIN_USER/MYSQL_ADMIN_PASSWORD si existen.
const esquema = await new Promise((resolve) => {
  const run = spawn(process.execPath, ['scripts/e2e-esquema-arranque.mjs'], { env: { ...process.env, ...env }, stdio: 'inherit' })
  run.on('exit', (code) => resolve(code ?? 1))
})
if (esquema !== 0) {
  console.error('La prueba de esquema al arrancar (CA-01..CA-05, CA-07, CA-08, CA-15, CA-16) falló.')
  process.exit(esquema)
}

await resetTestDb(env)
const api = `http://127.0.0.1:${env.PORT}`
const childEnv = { ...process.env, ...env }

const web = 'http://127.0.0.1:5174'
const server = spawn(process.execPath, ['server/index.cjs'], { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] })
server.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`))
const vite = spawn('npx', ['vite', '--port', '5174', '--strictPort'], {
  env: { ...childEnv, API_PROXY_TARGET: api },
  stdio: 'ignore',
})

async function waitFor(url, label) {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* aún arrancando */
    }
    if (Date.now() > deadline) throw new Error(`${label} no arrancó en 30 s`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

let exitCode = 1
try {
  await waitFor(`${api}/api/health`, 'La API de pruebas')
  await waitFor(web, 'El frontend de pruebas')
  exitCode = await new Promise((resolve) => {
    const run = spawn(process.execPath, ['scripts/e2e-carga-trackeo.mjs'], {
      env: { ...childEnv, E2E_API_BASE: api, E2E_WEB_BASE: web },
      stdio: 'inherit',
    })
    run.on('exit', (code) => resolve(code ?? 1))
  })
} catch (error) {
  console.error(error.message || error)
} finally {
  server.kill()
  vite.kill()
}
process.exit(exitCode)

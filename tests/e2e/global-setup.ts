import { resetTestDb } from '../../scripts/test-env.mjs'

/** Recrea la BD de pruebas antes de cada corrida E2E local (estado conocido y repetible). */
export default async function globalSetup() {
  await resetTestDb()
}

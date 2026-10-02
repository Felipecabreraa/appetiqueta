import { expect, test } from '@playwright/test'
import { API } from './helpers/api'

const CLAVES = [
  'clientIp', 'dbReady', 'env', 'mastersAuditReady', 'missingTables', 'movementsSchemaReady',
  'ok', 'operationalEpoch', 'schemaComplete', 'service',
]

test('CA-06: health público con 200, claves exactas y esquema completo', async ({ request }) => {
  const res = await request.get(`${API()}/api/health`)
  expect(res.status()).toBe(200)
  const b = await res.json()
  expect(Object.keys(b).sort()).toEqual(CLAVES)
  expect(b.ok).toBe(true)
  expect(b.service).toBe('appetiquetado-sync')
  expect(typeof b.dbReady).toBe('boolean')
  expect(typeof b.clientIp).toBe('string')
  expect(b.dbReady).toBe(true)
  expect(b.schemaComplete).toBe(true)
  expect(b.missingTables).toEqual([])
  expect(b.mastersAuditReady).toBe(true)
  expect(b.movementsSchemaReady).toBe(true)
})

test('CA-06/CA-17: health no expone credenciales, nombre de BD, errores de MySQL, stack, usuarios ni conteos', async ({ request }) => {
  const res = await request.get(`${API()}/api/health`)
  const b = await res.json()
  const { clientIp: _ip, ...resto } = b
  void _ip
  const texto = JSON.stringify(resto)
  for (const prohibido of [
    process.env.MYSQL_DATABASE, process.env.MYSQL_USER, process.env.MYSQL_PASSWORD,
    'appetiquetado_test', 'ER_', 'Error', 'at ', 'username', 'full_name', 'password',
  ]) {
    if (prohibido) expect(texto, `no debe contener "${prohibido}"`).not.toContain(prohibido)
  }
  // Los únicos números permitidos son los de campos conocidos: no hay conteos de filas.
  for (const [k, v] of Object.entries(resto)) {
    if (typeof v === 'number') expect(['operationalEpoch'], `número inesperado en ${k}`).toContain(k)
  }
  expect(Array.isArray(b.missingTables)).toBe(true)
  expect(b.missingTables.every((t: unknown) => typeof t === 'string')).toBe(true)
})

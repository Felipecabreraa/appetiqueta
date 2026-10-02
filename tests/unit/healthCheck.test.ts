import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateHealth } from '../e2e/helpers/healthCheck'

const completo = {
  ok: true,
  service: 'appetiquetado-sync',
  env: 'staging',
  dbReady: true,
  clientIp: '1.2.3.4',
  operationalEpoch: '2026-01-01T00:00:00.000Z',
  schemaComplete: true,
  missingTables: [] as string[],
  mastersAuditReady: true,
  movementsSchemaReady: true,
}

describe('evaluateHealth (smoke)', () => {
  it('CA-10: un cuerpo completo -> ok', () => {
    expect(evaluateHealth(completo).ok).toBe(true)
  })

  it('CA-09: schemaComplete=false -> falla y el motivo nombra las tablas faltantes', () => {
    const r = evaluateHealth({ ...completo, schemaComplete: false, missingTables: ['auth_sessions', 'movements'] })
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('auth_sessions')
    expect(r.motivo).toContain('movements')
  })

  it('CA-09: dbReady=false -> falla indicando que la BD no está lista', () => {
    const r = evaluateHealth({ ...completo, dbReady: false, schemaComplete: null, missingTables: null })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/BD no está lista/i)
  })

  it('CA-09: mastersAuditReady=false -> falla mencionando la auditoría', () => {
    const r = evaluateHealth({ ...completo, mastersAuditReady: false, schemaComplete: false })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/auditor/i)
  })

  it('CA-09: movementsSchemaReady=false -> falla', () => {
    const r = evaluateHealth({ ...completo, movementsSchemaReady: false, schemaComplete: false })
    expect(r.ok).toBe(false)
  })

  it('CA-09: esquema desconocido (null) con dbReady=true -> falla', () => {
    const r = evaluateHealth({ ...completo, schemaComplete: null, missingTables: null })
    expect(r.ok).toBe(false)
  })

  it('CA-09: un cuerpo de la versión anterior (sin campos de esquema) -> falla explicando que no informa el esquema', () => {
    const { schemaComplete, missingTables, mastersAuditReady, movementsSchemaReady, ...viejo } = completo
    void schemaComplete; void missingTables; void mastersAuditReady; void movementsSchemaReady
    const r = evaluateHealth(viejo)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/esquema/i)
  })

  it.each([[null], [undefined], ['texto'], [42]])('CA-09: cuerpo inválido %j -> falla', (body) => {
    expect(evaluateHealth(body).ok).toBe(false)
  })
})

describe('smoke.spec.ts', () => {
  it('CA-09: es de solo lectura (no usa request.post/put/delete/patch)', () => {
    const txt = readFileSync(resolve(__dirname, '../e2e/smoke.spec.ts'), 'utf8')
    expect(txt).not.toMatch(/request\.(post|put|delete|patch)\b/)
  })
})

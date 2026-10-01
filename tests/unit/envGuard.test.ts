import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { checkEnvironment, STAGING_DB } = require('../../server/envGuard.cjs') as {
  checkEnvironment: (env: Record<string, string | undefined>) => { ok: boolean; env: string | null; error?: string; warning?: string }
  STAGING_DB: string
}

describe('guardián de ambiente', () => {
  it('CA-01: staging rechaza cualquier BD distinta de la de pruebas', () => {
    expect(STAGING_DB).toBe('trn_etiquetatest')
    expect(checkEnvironment({ APP_ENV: 'staging', MYSQL_DATABASE: 'trn_etiqueta' }).ok).toBe(false)
    expect(checkEnvironment({ APP_ENV: 'staging', MYSQL_DATABASE: '' }).ok).toBe(false)
  })

  it.each(['trn_etiquetatest', 'appetiquetado_test', 'trn_extraccion_TEST'])(
    'CA-02: producción rechaza la BD de pruebas %s',
    (db) => {
      expect(checkEnvironment({ APP_ENV: 'production', MYSQL_DATABASE: db }).ok).toBe(false)
    },
  )

  it('CA-03: combinaciones válidas', () => {
    expect(checkEnvironment({ APP_ENV: 'staging', MYSQL_DATABASE: 'trn_etiquetatest' })).toMatchObject({ ok: true, env: 'staging' })
    expect(checkEnvironment({ APP_ENV: 'production', MYSQL_DATABASE: 'trn_etiqueta' })).toMatchObject({ ok: true, env: 'production' })
    expect(checkEnvironment({ APP_ENV: ' Production ', MYSQL_DATABASE: ' trn_etiqueta ' }).ok).toBe(true)
  })

  it('CA-04: un APP_ENV desconocido no arranca', () => {
    expect(checkEnvironment({ APP_ENV: 'produccion', MYSQL_DATABASE: 'trn_etiqueta' }).ok).toBe(false)
  })

  it('CA-05: sin APP_ENV se permite con advertencia', () => {
    const r = checkEnvironment({ MYSQL_DATABASE: 'trn_etiqueta' })
    expect(r.ok).toBe(true)
    expect(r.env).toBeNull()
    expect(r.warning).toMatch(/APP_ENV/)
  })

  it('CA-01/02: el servidor real termina con código 1 antes de tocar la BD', () => {
    // Host inválido: si el guardián fallara, la conexión no llegaría a ninguna BD real.
    const base = { ...process.env, MYSQL_HOST: 'guardian.invalid', MYSQL_USER: 'x', MYSQL_PASSWORD: 'x', PORT: '0' }
    for (const env of [
      { APP_ENV: 'staging', MYSQL_DATABASE: 'trn_etiqueta' },
      { APP_ENV: 'production', MYSQL_DATABASE: 'trn_etiquetatest' },
    ]) {
      const r = spawnSync(process.execPath, ['server/index.cjs'], { env: { ...base, ...env }, encoding: 'utf8', timeout: 15_000 })
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/\[guardian\]/)
    }
  })
})

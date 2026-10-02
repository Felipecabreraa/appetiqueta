import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type LabelSchema = { seasonId: boolean; companyId: boolean; seasonCostCenterId: boolean }
type Status = {
  schemaComplete: boolean | null
  missingTables: string[] | null
  mastersAuditReady: boolean | null
  movementsSchemaReady: boolean | null
}
type Detected = {
  missingTables: string[]
  mastersAuditReady: boolean
  movementsSchemaReady: boolean
  labelSchema: LabelSchema
  schemaComplete: boolean
}
type Locals = { labelSchema?: LabelSchema; mastersAuditReady?: boolean; schemaStatus?: Status }
type Monitor = {
  refresh: (o?: { maxAgeMs?: number }) => Promise<Status>
  onRouteError: (
    err: unknown,
    routeName: string,
    used?: { mastersAuditReady?: boolean; labelSchema?: LabelSchema },
  ) => Promise<boolean>
}
type Mod = {
  BASE_TABLES: readonly string[]
  buildLabelSchemaState: (cols: string[]) => LabelSchema
  detectSchemaState: (pool: unknown) => Promise<Detected>
  isSchemaError: (err: unknown) => boolean
  primeSchema: (o: {
    monitor: Monitor
    locals: Locals
    mastersAuditReady: boolean
    retries?: number
    log?: (line: string) => void
  }) => Promise<void>
  createSchemaMonitor: (o: {
    pool: unknown
    locals: Locals
    now?: () => number
    log?: (line: string) => void
  }) => Monitor
}
const m = require('../../server/schemaState.cjs') as Mod

const BASE = [
  'roles', 'users', 'auth_sessions', 'seasons', 'companies', 'species', 'varieties',
  'csg_catalog', 'jc_foremen', 'season_cost_centers', 'master_import_runs', 'labels',
  'movements', 'batch_logs', 'batch_log_labels', 'app_meta',
]
const AUDIT_TABLES = ['seasons', 'companies', 'species', 'varieties', 'csg_catalog', 'jc_foremen', 'season_cost_centers']
const MOVEMENT_COLS = ['registered_by', 'created_by', 'precio_clp', 'jh', 'client_ip', 'user_agent']

type Cfg = { missing?: string[]; noAudit?: boolean; noMovementCols?: boolean; noLabelCols?: boolean; extra?: boolean }
function rowsFor(cfg: Cfg = {}) {
  const rows: Array<{ TABLE_NAME: string; COLUMN_NAME: string }> = []
  for (const t of BASE) {
    if (cfg.missing?.includes(t)) continue
    const cols = ['id']
    if (AUDIT_TABLES.includes(t) && !cfg.noAudit) cols.push('created_by', 'updated_by')
    if (t === 'movements' && !cfg.noMovementCols) cols.push(...MOVEMENT_COLS)
    if (t === 'labels' && !cfg.noLabelCols) cols.push('season_id', 'company_id', 'season_cost_center_id')
    cols.forEach((c) => rows.push({ TABLE_NAME: t, COLUMN_NAME: c }))
  }
  if (cfg.extra) rows.push({ TABLE_NAME: 'tabla_ajena', COLUMN_NAME: 'id' })
  return rows
}

function fakePool(initial: Cfg = {}) {
  let cfg = initial
  let failWith: Error | null = null
  let gate: Promise<void> | null = null
  const sqls: string[] = []
  const run = async (arg: unknown) => {
    sqls.push(typeof arg === 'string' ? arg : (arg as { sql: string }).sql)
    if (gate) await gate
    if (failWith) throw failWith
    return [rowsFor(cfg), []]
  }
  return {
    pool: { query: vi.fn(run), execute: vi.fn(run) },
    sqls,
    calls: () => sqls.length,
    set: (c: Cfg) => { cfg = c },
    fail: (e: Error | null) => { failWith = e },
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((r) => { release = r })
      return () => { gate = null; release() }
    },
  }
}

const dbErr = (code: string, sqlMessage = code) => Object.assign(new Error(sqlMessage), { code, sqlMessage })
const logText = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map((c) => c.join(' ')).join('\n')

describe('BASE_TABLES', () => {
  it('CA-06: son las 16 tablas base en el orden de schema.sql', () => {
    expect([...m.BASE_TABLES]).toEqual(BASE)
  })
})

describe('buildLabelSchemaState', () => {
  it.each([
    [['id', 'season_id', 'company_id', 'season_cost_center_id'], { seasonId: true, companyId: true, seasonCostCenterId: true }],
    [['id'], { seasonId: false, companyId: false, seasonCostCenterId: false }],
    [['season_id'], { seasonId: true, companyId: false, seasonCostCenterId: false }],
  ])('CA-16: columnas %j -> flags', (cols, expected) => {
    expect(m.buildLabelSchemaState(cols)).toEqual(expected)
  })
})

describe('isSchemaError', () => {
  it.each(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'])('CA-16: %s es error de esquema', (code) => {
    expect(m.isSchemaError(dbErr(code))).toBe(true)
  })
  it.each([[dbErr('ER_DUP_ENTRY')], [dbErr('ER_LOCK_DEADLOCK')], [new Error('x')], [null], [undefined], [{}]])(
    'CA-16: %j no es error de esquema',
    (e) => {
      expect(m.isSchemaError(e)).toBe(false)
    },
  )
})

describe('detectSchemaState', () => {
  it('CA-06: esquema completo -> sin faltantes y todos los flags en true', async () => {
    const p = fakePool()
    const s = await m.detectSchemaState(p.pool)
    expect(s).toMatchObject({
      missingTables: [],
      mastersAuditReady: true,
      movementsSchemaReady: true,
      schemaComplete: true,
      labelSchema: { seasonId: true, companyId: true, seasonCostCenterId: true },
    })
  })

  it('CA-06: usa una sola consulta de solo lectura a information_schema', async () => {
    const p = fakePool()
    await m.detectSchemaState(p.pool)
    expect(p.calls()).toBe(1)
    expect(p.sqls[0]).toMatch(/^\s*SELECT/i)
    expect(p.sqls[0]).toMatch(/information_schema\.COLUMNS/i)
  })

  it('CA-06: missingTables sale solo de BASE_TABLES, en su orden, aunque la BD tenga tablas ajenas', async () => {
    const p = fakePool({ missing: ['movements', 'auth_sessions'], extra: true })
    const s = await m.detectSchemaState(p.pool)
    expect(s.missingTables).toEqual(['auth_sessions', 'movements'])
    expect(s.schemaComplete).toBe(false)
    expect(JSON.stringify(s)).not.toContain('tabla_ajena')
  })

  it('CA-06: mastersAuditReady exige las 14 columnas de auditoría', async () => {
    const s = await m.detectSchemaState(fakePool({ noAudit: true }).pool)
    expect(s.mastersAuditReady).toBe(false)
    expect(s.missingTables).toEqual([])
    expect(s.schemaComplete).toBe(false)
  })

  it('CA-06: falta una sola columna de auditoría -> mastersAuditReady=false', async () => {
    const rows = rowsFor().filter((r) => !(r.TABLE_NAME === 'species' && r.COLUMN_NAME === 'updated_by'))
    const pool = { query: vi.fn(async () => [rows, []]), execute: vi.fn(async () => [rows, []]) }
    expect((await m.detectSchemaState(pool)).mastersAuditReady).toBe(false)
  })

  it('CA-06: movementsSchemaReady exige las 6 columnas de movements', async () => {
    const s = await m.detectSchemaState(fakePool({ noMovementCols: true }).pool)
    expect(s.movementsSchemaReady).toBe(false)
    expect(s.schemaComplete).toBe(false)
  })

  it('CA-16: labelSchema refleja las columnas de labels', async () => {
    const s = await m.detectSchemaState(fakePool({ noLabelCols: true }).pool)
    expect(s.labelSchema).toEqual({ seasonId: false, companyId: false, seasonCostCenterId: false })
  })

  it('CA-08: si la consulta falla, rechaza (el monitor lo convierte en desconocido)', async () => {
    const p = fakePool()
    p.fail(dbErr('PROTOCOL_SEQUENCE_TIMEOUT'))
    await expect(m.detectSchemaState(p.pool)).rejects.toThrow()
  })
})

describe('createSchemaMonitor', () => {
  let t = 0
  const now = () => t
  beforeEach(() => {
    t = 0
  })

  const UNKNOWN: Status = { schemaComplete: null, missingTables: null, mastersAuditReady: null, movementsSchemaReady: null }

  it('CA-06: refresh devuelve el estado y actualiza locals', async () => {
    const p = fakePool({ missing: ['auth_sessions'] })
    const locals: Locals = {}
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    const s = await mon.refresh({ maxAgeMs: 0 })
    expect(s).toEqual({
      schemaComplete: false,
      missingTables: ['auth_sessions'],
      mastersAuditReady: true,
      movementsSchemaReady: true,
    })
    expect(locals.schemaStatus).toEqual(s)
    expect(locals.mastersAuditReady).toBe(true)
    expect(locals.labelSchema).toEqual({ seasonId: true, companyId: true, seasonCostCenterId: true })
  })

  it('CA-07: con maxAgeMs=2000 no vuelve a consultar antes de 2 s y sí después', async () => {
    const p = fakePool()
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    await mon.refresh({ maxAgeMs: 2000 })
    t = 1000
    await mon.refresh({ maxAgeMs: 2000 })
    expect(p.calls()).toBe(1)
    t = 2500
    await mon.refresh({ maxAgeMs: 2000 })
    expect(p.calls()).toBe(2)
  })

  it('CA-07: refleja la tabla que desaparece después del tiempo de antigüedad', async () => {
    const p = fakePool()
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    await mon.refresh({ maxAgeMs: 2000 })
    p.set({ missing: ['auth_sessions'] })
    t = 2500
    const s = await mon.refresh({ maxAgeMs: 2000 })
    expect(s.missingTables).toEqual(['auth_sessions'])
    expect(s.schemaComplete).toBe(false)
  })

  it('CA-07: las llamadas simultáneas comparten una sola consulta en vuelo', async () => {
    const p = fakePool()
    const release = p.hold()
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    const all = [mon.refresh({ maxAgeMs: 0 }), mon.refresh({ maxAgeMs: 0 }), mon.refresh({ maxAgeMs: 0 })]
    release()
    const res = await Promise.all(all)
    expect(p.calls()).toBe(1)
    expect(res[1]).toEqual(res[0])
    expect(res[2]).toEqual(res[0])
  })

  it('CA-07: un timeout de la consulta deja el estado en desconocido y no lanza', async () => {
    const p = fakePool()
    p.fail(dbErr('PROTOCOL_SEQUENCE_TIMEOUT', 'Query inactivity timeout'))
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    await expect(mon.refresh({ maxAgeMs: 0 })).resolves.toEqual(UNKNOWN)
  })

  it('CA-08: sin pool, los 4 campos son null y no consulta', async () => {
    const mon = m.createSchemaMonitor({ pool: null, locals: {}, now, log: vi.fn() })
    await expect(mon.refresh({ maxAgeMs: 0 })).resolves.toEqual(UNKNOWN)
  })

  it('CA-08: si la detección lanza un error, los 4 campos son null (desconocido, no completo)', async () => {
    const p = fakePool()
    p.fail(new Error('boom'))
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    const s = await mon.refresh({ maxAgeMs: 0 })
    expect(s.schemaComplete).toBeNull()
    expect(s.missingTables).toBeNull()
    expect(s.mastersAuditReady).toBeNull()
    expect(s.movementsSchemaReady).toBeNull()
  })

  it('CA-16: recalcula en ambas direcciones (degrada y recupera mastersAuditReady)', async () => {
    const p = fakePool()
    const locals: Locals = {}
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    await mon.refresh({ maxAgeMs: 0 })
    expect(locals.mastersAuditReady).toBe(true)
    p.set({ noAudit: true })
    t = 1
    await mon.refresh({ maxAgeMs: 0 })
    expect(locals.mastersAuditReady).toBe(false)
    p.set({})
    t = 2
    await mon.refresh({ maxAgeMs: 0 })
    expect(locals.mastersAuditReady).toBe(true)
  })

  it('CA-16: registra el cambio detectado en caliente con prefijo [schema]', async () => {
    const p = fakePool()
    const log = vi.fn()
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log })
    await mon.refresh({ maxAgeMs: 0 })
    p.set({ noAudit: true, missing: ['auth_sessions'] })
    t = 20_000
    await mon.refresh({ maxAgeMs: 0 })
    const out = logText(log)
    expect(out).toContain('[schema]')
    expect(out).toContain('auth_sessions')
    expect(out).toContain('seasons.created_by')
  })

  describe('onRouteError (re-detección máx. 1 cada 10 s)', () => {
    async function armed() {
      const p = fakePool()
      const locals: Locals = {}
      const log = vi.fn()
      const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log })
      await mon.refresh({ maxAgeMs: 0 }) // t=0, auditoría lista
      p.set({ noAudit: true })
      return { p, locals, log, mon }
    }

    it('CA-16: ER_BAD_FIELD_ERROR re-detecta, devuelve true si cambió el flag y registra la línea [schema]', async () => {
      const { p, locals, log, mon } = await armed()
      t = 11_000
      const changed = await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR', "Unknown column 'x.created_by' in 'field list'"), 'GET /api/admin/masters')
      expect(changed).toBe(true)
      expect(p.calls()).toBe(2)
      expect(locals.mastersAuditReady).toBe(false)
      const out = logText(log)
      expect(out).toContain('[schema]')
      expect(out).toContain('GET /api/admin/masters')
      expect(out).toContain('ER_BAD_FIELD_ERROR')
      expect(out).toContain("Unknown column 'x.created_by'")
    })

    it('CA-16: ER_NO_SUCH_TABLE también dispara la re-detección', async () => {
      const { p, mon } = await armed()
      t = 11_000
      await mon.onRouteError(dbErr('ER_NO_SUCH_TABLE', "Table 'db.auth_sessions' doesn't exist"), 'POST /api/auth/login')
      expect(p.calls()).toBe(2)
    })

    it('CA-16: dentro de los 10 s no vuelve a consultar y devuelve false', async () => {
      const { p, mon } = await armed()
      t = 5_000
      expect(await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')).toBe(false)
      expect(p.calls()).toBe(1)
    })

    it('CA-16: como máximo 1 re-detección por ventana de 10 s ante una ráfaga de errores', async () => {
      const { p, mon } = await armed()
      t = 11_000
      await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')
      t = 12_000
      expect(await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')).toBe(false)
      t = 15_000
      await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')
      expect(p.calls()).toBe(2)
      t = 22_000
      await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')
      expect(p.calls()).toBe(3)
    })

    it('CA-16: un error que no es de esquema (ER_DUP_ENTRY) no re-detecta', async () => {
      const { p, mon } = await armed()
      t = 60_000
      expect(await mon.onRouteError(dbErr('ER_DUP_ENTRY'), 'r')).toBe(false)
      expect(p.calls()).toBe(1)
    })

    it('CA-16: si nada cambió devuelve false', async () => {
      const p = fakePool()
      const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
      await mon.refresh({ maxAgeMs: 0 })
      t = 11_000
      expect(await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')).toBe(false)
      expect(p.calls()).toBe(2)
    })
  })

  it('CA-04: el monitor solo emite SELECT (sin DDL en caliente)', async () => {
    const p = fakePool({ missing: ['auth_sessions'], noAudit: true })
    const mon = m.createSchemaMonitor({ pool: p.pool, locals: {}, now, log: vi.fn() })
    await mon.refresh({ maxAgeMs: 0 })
    t = 20_000
    await mon.onRouteError(dbErr('ER_NO_SUCH_TABLE'), 'r')
    t = 40_000
    await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r')
    expect(p.sqls.length).toBeGreaterThan(0)
    for (const s of p.sqls) expect(s).toMatch(/^\s*SELECT/i)
  })
})

describe('vuelta 2: detección que falla o tablas ausentes no degradan los flags', () => {
  let t = 0
  const now = () => t
  const ALL: LabelSchema = { seasonId: true, companyId: true, seasonCostCenterId: true }
  beforeEach(() => {
    t = 0
  })

  it('detección con labels faltante no degrada labelSchema (el INSERT fallará con ER_NO_SUCH_TABLE)', async () => {
    const p = fakePool({ missing: ['labels'] })
    const locals: Locals = { labelSchema: { ...ALL }, mastersAuditReady: true }
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    const s = await mon.refresh({ maxAgeMs: 0 })
    expect(s.missingTables).toEqual(['labels'])
    expect(locals.labelSchema).toEqual(ALL)
  })

  it('detección con una tabla de maestros faltante no degrada mastersAuditReady', async () => {
    const p = fakePool({ missing: ['seasons'] })
    const locals: Locals = { labelSchema: { ...ALL }, mastersAuditReady: true }
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    const s = await mon.refresh({ maxAgeMs: 0 })
    expect(s.mastersAuditReady).toBe(false)
    expect(locals.mastersAuditReady).toBe(true)
  })

  it('primeSchema: si la detección inicial falla, locals conserva los flags de bootstrapSchema y reintenta', async () => {
    const p = fakePool()
    p.fail(dbErr('PROTOCOL_SEQUENCE_TIMEOUT'))
    const locals: Locals = {}
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    await m.primeSchema({ monitor: mon, locals, mastersAuditReady: true, retries: 2, log: vi.fn() })
    expect(p.calls()).toBe(3)
    expect(locals.mastersAuditReady).toBe(true)
    expect(locals.labelSchema).toEqual(ALL)
  })

  it('primeSchema: si el reintento tiene éxito usa lo detectado', async () => {
    const p = fakePool({ noLabelCols: true })
    const locals: Locals = {}
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    await m.primeSchema({ monitor: mon, locals, mastersAuditReady: true, log: vi.fn() })
    expect(p.calls()).toBe(1)
    expect(locals.labelSchema).toEqual({ seasonId: false, companyId: false, seasonCostCenterId: false })
  })

  it('onRouteError compara contra los flags que usó el intento, aunque otra ruta ya refrescó', async () => {
    const p = fakePool()
    const locals: Locals = {}
    const mon = m.createSchemaMonitor({ pool: p.pool, locals, now, log: vi.fn() })
    await mon.refresh({ maxAgeMs: 0 }) // auditoría lista
    p.set({ noAudit: true })
    t = 11_000
    await mon.refresh({ maxAgeMs: 0 }) // otra ruta ya re-detectó: auditoría NO lista
    t = 12_000
    // el intento fallido había usado mastersAuditReady=true: hay que reintentar
    const changed = await mon.onRouteError(dbErr('ER_BAD_FIELD_ERROR'), 'r', {
      mastersAuditReady: true,
      labelSchema: ALL,
    })
    expect(changed).toBe(true)
    expect(p.calls()).toBe(2)
  })
})

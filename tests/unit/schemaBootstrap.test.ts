import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type Parsed = { name: string; sql: string }
type Failed = { table: string; code: string }
type Bootstrap = {
  parseBaseTables: (sqlText: string) => Parsed[]
  ensureBaseTables: (
    pool: unknown,
    o?: { log?: (line: string) => void; schemaPath?: string },
  ) => Promise<{ created: string[]; failed: Failed[] }>
  bootstrapSchema: (
    pool: unknown,
    deps?: { log?: (line: string) => void },
  ) => Promise<{ created: string[]; failed: Failed[] }>
}
const boot = require('../../server/schemaBootstrap.cjs') as Bootstrap
const state = require('../../server/schemaState.cjs') as { BASE_TABLES: readonly string[] }

const SCHEMA_SQL = readFileSync(resolve(__dirname, '../../database/schema.sql'), 'utf8')

const BASE = [
  'roles', 'users', 'auth_sessions', 'seasons', 'companies', 'species', 'varieties',
  'csg_catalog', 'jc_foremen', 'season_cost_centers', 'master_import_runs', 'labels',
  'movements', 'batch_logs', 'batch_log_labels', 'app_meta',
]
const AUDIT_TABLES = ['seasons', 'companies', 'species', 'varieties', 'csg_catalog', 'jc_foremen', 'season_cost_centers']
const AUDIT_PREFIX: Record<string, string> = { csg_catalog: 'csg', season_cost_centers: 'scc' }
const MOVEMENT_COLS = ['registered_by', 'created_by', 'precio_clp', 'jh', 'client_ip', 'user_agent']
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const dbErr = (code: string, message = code) => Object.assign(new Error(message), { code })

// ---------- pool falso con estado ----------
type Opts = {
  missing?: string[]
  noMovementsCols?: boolean
  noAuditCols?: boolean
  failCreate?: Record<string, string>
  failMatch?: Array<{ match: RegExp; code: string }>
  upperCaseNames?: boolean
}

function fakePool(o: Opts = {}) {
  const tables = new Map<string, Set<string>>()
  const idx = new Map<string, Set<string>>()
  const fks = new Map<string, Set<string>>()
  const fullCols = (name: string, opts: Opts) => {
    const cols = new Set(['id'])
    if (AUDIT_TABLES.includes(name) && !opts.noAuditCols) {
      cols.add('created_by')
      cols.add('updated_by')
    }
    if (name === 'movements' && !opts.noMovementsCols) MOVEMENT_COLS.forEach((c) => cols.add(c))
    if (name === 'labels') ['season_id', 'company_id', 'season_cost_center_id'].forEach((c) => cols.add(c))
    return cols
  }
  const seedIdx = (name: string, withAudit: boolean) => {
    const p = AUDIT_PREFIX[name] ?? name
    idx.set(name, new Set(withAudit ? [`idx_${p}_created_by`, `idx_${p}_updated_by`] : []))
    fks.set(name, new Set(withAudit ? [`fk_${p}_created_by`, `fk_${p}_updated_by`] : []))
  }
  for (const t of BASE) {
    if (o.missing?.includes(t)) continue
    tables.set(t, fullCols(t, o))
    seedIdx(t, AUDIT_TABLES.includes(t) && !o.noAuditCols)
  }
  const sqls: string[] = []
  const rowsFor = (name: string) =>
    [...(tables.get(name) ?? [])].map((c) => ({ TABLE_NAME: name, COLUMN_NAME: c }))

  const run = async (arg: unknown, params?: unknown[]) => {
    const raw = typeof arg === 'string' ? arg : (arg as { sql: string }).sql
    const sql = norm(raw)
    sqls.push(sql)
    for (const f of o.failMatch ?? []) if (f.match.test(sql)) throw dbErr(f.code)

    const create = /^CREATE TABLE IF NOT EXISTS `?(\w+)`?/i.exec(sql)
    if (create) {
      const name = create[1]
      if (o.failCreate?.[name]) throw dbErr(o.failCreate[name], `denegado para ${name}`)
      if (tables.has(name)) return [{}, undefined]
      for (const m of sql.matchAll(/REFERENCES\s+`?(\w+)`?/gi)) {
        if (m[1] !== name && !tables.has(m[1])) {
          throw dbErr('ER_CANT_CREATE_TABLE', `errno: 150 padre ${m[1]} no existe`)
        }
      }
      tables.set(name, fullCols(name, { ...o, noAuditCols: false, noMovementsCols: false }))
      seedIdx(name, AUDIT_TABLES.includes(name))
      return [{}, undefined]
    }
    const alter = /^ALTER TABLE (\w+) ADD (COLUMN|KEY|CONSTRAINT) (\w+)/i.exec(sql)
    if (alter) {
      const [, t, kind, n] = alter
      if (!tables.has(t)) throw dbErr('ER_NO_SUCH_TABLE')
      if (kind.toUpperCase() === 'COLUMN') tables.get(t)!.add(n)
      if (kind.toUpperCase() === 'KEY') idx.get(t)!.add(n)
      if (kind.toUpperCase() === 'CONSTRAINT') fks.get(t)!.add(n)
      return [{}, undefined]
    }
    if (/information_schema\.TABLES/i.test(sql)) {
      return [[...tables.keys()].map((t) => ({ TABLE_NAME: o.upperCaseNames ? t.toUpperCase() : t })), []]
    }
    if (/information_schema\.STATISTICS/i.test(sql)) {
      if (/AS ok/i.test(sql)) return [[{ ok: 1 }], []]
      const t = String(params?.[0] ?? '')
      return [[...(idx.get(t) ?? [])].map((n) => ({ INDEX_NAME: n })), []]
    }
    if (/information_schema\.REFERENTIAL_CONSTRAINTS/i.test(sql)) {
      const t = String(params?.[0] ?? '')
      return [[...(fks.get(t) ?? [])].map((n) => ({ CONSTRAINT_NAME: n })), []]
    }
    if (/information_schema\.COLUMNS/i.test(sql)) {
      const literal = /TABLE_NAME\s*=\s*'(\w+)'/i.exec(sql)?.[1]
      const param = typeof params?.[0] === 'string' && !/IN\s*\(/i.test(sql) ? (params[0] as string) : undefined
      const only = literal ?? param
      if (only) return [rowsFor(only), []]
      return [BASE.flatMap(rowsFor), []]
    }
    if (/^SELECT .* FROM (roles|users)/i.test(sql)) return [[{ id: 1 }], []]
    return [[], []]
  }
  return { query: vi.fn(run), execute: vi.fn(run), sqls, tables }
}

const creates = (sqls: string[]) => sqls.filter((s) => /^CREATE TABLE/i.test(s))
const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

beforeEach(quiet)

describe('parseBaseTables (schema.sql real)', () => {
  it('CA-02: devuelve exactamente las 16 tablas base, en el orden del archivo', () => {
    const names = boot.parseBaseTables(SCHEMA_SQL).map((t) => t.name)
    expect(names).toEqual(BASE)
    expect(names).toEqual([...state.BASE_TABLES])
  })

  it('CA-02: cada sentencia es un CREATE TABLE IF NOT EXISTS sin SET, INSERT ni FOREIGN_KEY_CHECKS', () => {
    const parsed = boot.parseBaseTables(SCHEMA_SQL)
    for (const t of parsed) {
      expect(norm(t.sql)).toMatch(new RegExp(`^CREATE TABLE IF NOT EXISTS \`?${t.name}\`?\\s*\\(`, 'i'))
      expect(t.sql).not.toMatch(/FOREIGN_KEY_CHECKS/i)
      expect(t.sql).not.toMatch(/^\s*(SET|INSERT)\b/im)
      expect(t.sql).not.toMatch(/^\s*--/m)
    }
  })

  it('CA-02: orden topológico, cada REFERENCES apunta a una tabla anterior', () => {
    const parsed = boot.parseBaseTables(SCHEMA_SQL)
    parsed.forEach((t, i) => {
      for (const m of t.sql.matchAll(/REFERENCES\s+`?(\w+)`?/gi)) {
        const parent = parsed.findIndex((p) => p.name === m[1])
        expect(parent, `${t.name} -> ${m[1]}`).toBeGreaterThanOrEqual(0)
        expect(parent, `${t.name} -> ${m[1]}`).toBeLessThan(i)
      }
    })
  })

  it('CA-04: ignora sentencias que no son CREATE TABLE IF NOT EXISTS', () => {
    const sql = [
      '-- comentario',
      'SET FOREIGN_KEY_CHECKS = 0;',
      'DROP TABLE IF EXISTS roles;',
      'CREATE TABLE sin_if (id INT);',
      'CREATE TABLE IF NOT EXISTS uno (',
      '  id INT NOT NULL',
      ') ENGINE=InnoDB;',
      "INSERT INTO uno (id) VALUES (1);",
      '',
    ].join('\n')
    const parsed = boot.parseBaseTables(sql)
    expect(parsed.map((t) => t.name)).toEqual(['uno'])
  })

  it('CA-04: rechaza una sentencia aceptada que contenga DROP', () => {
    const sql = 'CREATE TABLE IF NOT EXISTS uno (\n  id INT,\n  DROP COLUMN x\n);\n'
    expect(() => boot.parseBaseTables(sql)).toThrow()
  })

  it('CA-04: un DROP dentro de un literal (COMMENT) no se considera destructivo', () => {
    const sql = "CREATE TABLE IF NOT EXISTS uno (\n  id INT COMMENT 'no hace DROP'\n);\n"
    expect(boot.parseBaseTables(sql).map((t) => t.name)).toEqual(['uno'])
  })
})

describe('ensureBaseTables', () => {
  it('CA-01: con auth_sessions ausente ejecuta solo su CREATE y lo registra', async () => {
    const pool = fakePool({ missing: ['auth_sessions'] })
    const log = vi.fn()
    const r = await boot.ensureBaseTables(pool, { log })
    expect(r.created).toEqual(['auth_sessions'])
    expect(r.failed).toEqual([])
    const cs = creates(pool.sqls)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatch(/^CREATE TABLE IF NOT EXISTS `?auth_sessions`?/)
    expect(pool.tables.has('auth_sessions')).toBe(true)
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('Tabla creada: auth_sessions')
  })

  it('CA-03: con el esquema completo no ejecuta ningún CREATE', async () => {
    const pool = fakePool()
    const r = await boot.ensureBaseTables(pool, { log: vi.fn() })
    expect(r.created).toEqual([])
    expect(r.failed).toEqual([])
    expect(creates(pool.sqls)).toHaveLength(0)
  })

  it('CA-03: los nombres de tabla se comparan sin distinguir mayúsculas', async () => {
    const pool = fakePool({ upperCaseNames: true })
    const r = await boot.ensureBaseTables(pool, { log: vi.fn() })
    expect(r.created).toEqual([])
    expect(creates(pool.sqls)).toHaveLength(0)
  })

  it('CA-02: crea varias tablas con FK activas, en orden y una sentencia por llamada', async () => {
    const pool = fakePool({ missing: ['batch_log_labels', 'auth_sessions', 'movements'] })
    const r = await boot.ensureBaseTables(pool, { log: vi.fn() })
    expect(r.created).toEqual(['auth_sessions', 'movements', 'batch_log_labels'])
    expect(r.failed).toEqual([])
    const cs = creates(pool.sqls)
    expect(cs).toHaveLength(3)
    cs.forEach((s) => expect(s.match(/CREATE TABLE/gi)).toHaveLength(1))
    expect(pool.sqls.some((s) => /FOREIGN_KEY_CHECKS/i.test(s))).toBe(false)
  })

  it('CA-02: sin ninguna tabla crea las 16 en orden topológico sin errores', async () => {
    const pool = fakePool({ missing: BASE })
    const r = await boot.ensureBaseTables(pool, { log: vi.fn() })
    expect(r.created).toEqual(BASE)
    expect(r.failed).toEqual([])
  })

  it('CA-05: un error en una tabla no corta las demás ni lanza, y se registra con nombre y código', async () => {
    const pool = fakePool({
      missing: ['auth_sessions', 'batch_logs', 'batch_log_labels'],
      failCreate: { auth_sessions: 'ER_TABLEACCESS_DENIED_ERROR' },
    })
    const log = vi.fn()
    const r = await boot.ensureBaseTables(pool, { log })
    expect(r.created).toEqual(['batch_logs', 'batch_log_labels'])
    expect(r.failed).toEqual([{ table: 'auth_sessions', code: 'ER_TABLEACCESS_DENIED_ERROR' }])
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toMatch(/\[schema\].*ERROR.*auth_sessions.*ER_TABLEACCESS_DENIED_ERROR/)
  })

  it('un schema.sql que el parser rechaza se registra distinto de "no se pudo leer" y no crea nada', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const file = join(mkdtempSync(join(tmpdir(), 'schema-')), 'schema.sql')
    writeFileSync(file, 'CREATE TABLE IF NOT EXISTS uno (\n  id INT,\n  DROP COLUMN x\n);\n')
    const pool = fakePool({ missing: ['auth_sessions'] })
    const log = vi.fn()
    const r = await boot.ensureBaseTables(pool, { log, schemaPath: file })
    expect(r.created).toEqual([])
    expect(creates(pool.sqls)).toHaveLength(0)
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(out).toMatch(/\[schema\].*ERROR.*rechaz/i)
    expect(out).not.toMatch(/no se pudo leer/)
  })

  it('CA-05: si schema.sql no se puede leer no crea nada, no lanza y lo registra', async () => {
    const pool = fakePool({ missing: ['auth_sessions'] })
    const log = vi.fn()
    const r = await boot.ensureBaseTables(pool, { log, schemaPath: '/no/existe/schema.sql' })
    expect(r.created).toEqual([])
    expect(creates(pool.sqls)).toHaveLength(0)
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/\[schema\].*ERROR.*schema\.sql/)
  })
})

describe('bootstrapSchema', () => {
  const ALLOWED = [
    /^SELECT .*information_schema/i,
    /^CREATE TABLE IF NOT EXISTS /i,
    /^ALTER TABLE \w+ ADD (COLUMN|KEY|CONSTRAINT) /i,
    /^INSERT IGNORE INTO app_meta/i,
    /^INSERT INTO roles .*ON DUPLICATE KEY UPDATE/i,
    /^SELECT .* FROM (roles|users)/i,
    /^INSERT INTO users/i,
  ]
  const FORBIDDEN = /\b(DROP|TRUNCATE|DELETE|RENAME)\b|ALTER TABLE \w+ (DROP|MODIFY|CHANGE)\b|FOREIGN_KEY_CHECKS/i

  it.each<[string, Opts]>([
    ['esquema completo', {}],
    ['sin tablas', { missing: BASE }],
    ['sin columnas de movements ni de auditoría', { noMovementsCols: true, noAuditCols: true }],
  ])('CA-04: %s, solo emite sentencias permitidas y nunca DDL destructivo', async (_n, opts) => {
    const pool = fakePool(opts)
    await boot.bootstrapSchema(pool, { log: vi.fn() })
    expect(pool.sqls.length).toBeGreaterThan(0)
    for (const s of pool.sqls) {
      expect(ALLOWED.some((re) => re.test(s)), `no permitida: ${s}`).toBe(true)
      expect(s.replace(/ON (DELETE|UPDATE) \w+( \w+)?/gi, ''), `destructiva: ${s}`).not.toMatch(FORBIDDEN)
    }
  })

  it('CA-04: con columnas faltantes solo agrega (ALTER ... ADD), no recrea tablas', async () => {
    const pool = fakePool({ noMovementsCols: true, noAuditCols: true })
    await boot.bootstrapSchema(pool, { log: vi.fn() })
    expect(creates(pool.sqls)).toHaveLength(0)
    expect(pool.sqls.some((s) => /^ALTER TABLE movements ADD COLUMN/i.test(s))).toBe(true)
    expect(pool.sqls.some((s) => /^ALTER TABLE seasons ADD COLUMN created_by/i.test(s))).toBe(true)
  })

  it('CA-03: con el esquema completo no crea tablas ni altera nada', async () => {
    const pool = fakePool()
    const r = await boot.bootstrapSchema(pool, { log: vi.fn() })
    expect(r.created).toEqual([])
    expect(pool.sqls.some((s) => /^(CREATE|ALTER)/i.test(s))).toBe(false)
  })

  it('CA-01: con auth_sessions ausente la crea y lo informa', async () => {
    const pool = fakePool({ missing: ['auth_sessions'] })
    const r = await boot.bootstrapSchema(pool, { log: vi.fn() })
    expect(r.created).toEqual(['auth_sessions'])
  })

  it('CA-05: sin privilegio CREATE no lanza, intenta las demás tablas y devuelve failed', async () => {
    const pool = fakePool({
      missing: ['auth_sessions', 'batch_logs'],
      failCreate: { auth_sessions: 'ER_TABLEACCESS_DENIED_ERROR' },
    })
    const log = vi.fn()
    const r = await boot.bootstrapSchema(pool, { log })
    expect(r.failed).toEqual([{ table: 'auth_sessions', code: 'ER_TABLEACCESS_DENIED_ERROR' }])
    expect(r.created).toEqual(['batch_logs'])
    expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('auth_sessions')
  })

  it('CA-05: si falla el upsert de roles igual se ejecuta el INSERT IGNORE de la época', async () => {
    const pool = fakePool({ failMatch: [{ match: /^INSERT INTO roles/i, code: 'ER_ACCESS_DENIED_ERROR' }] })
    await expect(boot.bootstrapSchema(pool, { log: vi.fn() })).resolves.toBeDefined()
    expect(pool.sqls.some((s) => /^INSERT IGNORE INTO app_meta/i.test(s))).toBe(true)
  })

  it('CA-05: si falla el INSERT IGNORE de la época igual se ejecuta el upsert de roles', async () => {
    const pool = fakePool({ failMatch: [{ match: /^INSERT IGNORE INTO app_meta/i, code: 'ER_NO_SUCH_TABLE' }] })
    await expect(boot.bootstrapSchema(pool, { log: vi.fn() })).resolves.toBeDefined()
    expect(pool.sqls.some((s) => /^INSERT INTO roles/i.test(s))).toBe(true)
  })

  it('CA-05: ensureBaseData ya no crea app_meta ni jc_foremen (única definición en schema.sql)', async () => {
    const pool = fakePool()
    await boot.bootstrapSchema(pool, { log: vi.fn() })
    expect(creates(pool.sqls)).toHaveLength(0)
  })
})

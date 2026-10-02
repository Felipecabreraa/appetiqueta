import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

type Col = { name: string; text?: boolean }
type ImportCol = { col: string; expr: string; text?: boolean }
type Mod = {
  MASTER_AUDIT_TABLES: Array<{ table: string; prefix: string }>
  ensureMastersAuditSchema: (pool: unknown) => Promise<boolean>
  buildAuditedUpdate: (
    table: string,
    cols: Col[],
    o: { audit: boolean },
  ) => { sql: string; params: (values: unknown[], userId: number, id: number) => unknown[] }
  buildAuditedInsert: (
    table: string,
    cols: Col[],
    o: { audit: boolean },
  ) => { sql: string; params: (values: unknown[], userId: number) => unknown[] }
  buildImportAuditClause: (cols: ImportCol[], o: { audit: boolean }) => string
  buildUnsetCurrentSeason: (o: { audit: boolean; actor: 'user' | 'import' }) => {
    sql: string
    params: (code: string, userId?: number) => unknown[]
  }
  auditSelect: (alias: string, ready: boolean) => string
  auditJoins: (alias: string, ready: boolean) => string
  mapAuditRow: (row: Record<string, unknown>) => Record<string, unknown>
  normalizeSeasonDate: (v: unknown) => { valid: boolean; value?: string | null }
}
const m = require('../../server/masterAudit.cjs') as Mod

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// ---------- pool falso (information_schema + ALTER) ----------
type Fail = { match: RegExp; error: Error & { code?: string }; applyAnyway?: boolean }
const err = (code: string, message = code) => Object.assign(new Error(message), { code })

function fakePool(opts: { withAuditCols?: boolean; tables?: 'all' | 'none'; fails?: Fail[] } = {}) {
  const { withAuditCols = false, tables = 'all', fails = [] } = opts
  const state = new Map<string, { cols: Set<string>; idx: Set<string>; fks: Set<string> }>()
  for (const t of m.MASTER_AUDIT_TABLES) {
    const cols = new Set(['id', 'code', 'name', 'created_at', 'updated_at'])
    const idx = new Set<string>()
    const fks = new Set<string>()
    if (withAuditCols) {
      for (const c of ['created_by', 'updated_by']) {
        cols.add(c)
        idx.add(`idx_${t.prefix}_${c}`)
        fks.add(`fk_${t.prefix}_${c}`)
      }
    }
    if (tables === 'all') state.set(t.table, { cols, idx, fks })
  }
  const alters: string[] = []
  const run = async (sql: string, params: unknown[] = []) => {
    const q = norm(sql)
    const table = String(params[0] ?? '')
    if (/^ALTER TABLE/i.test(q)) {
      alters.push(q)
      const t = q.match(/^ALTER TABLE `?(\w+)`?/i)![1]
      const st = state.get(t)
      const apply = () => {
        if (!st) return
        let r: RegExpMatchArray | null
        if ((r = q.match(/ADD COLUMN `?(\w+)`?/i))) st.cols.add(r[1])
        else if ((r = q.match(/ADD KEY `?(\w+)`?/i))) st.idx.add(r[1])
        else if ((r = q.match(/ADD CONSTRAINT `?(\w+)`?/i))) st.fks.add(r[1])
      }
      const f = fails.find((x) => x.match.test(q))
      if (f) {
        if (f.applyAnyway) apply()
        throw f.error
      }
      apply()
      return [{ affectedRows: 0 }]
    }
    const st = state.get(table)
    if (/information_schema\.COLUMNS/i.test(q)) return [[...(st?.cols ?? [])].map((COLUMN_NAME) => ({ COLUMN_NAME }))]
    if (/information_schema\.STATISTICS/i.test(q)) return [[...(st?.idx ?? [])].map((INDEX_NAME) => ({ INDEX_NAME }))]
    if (/information_schema\.REFERENTIAL_CONSTRAINTS/i.test(q))
      return [[...(st?.fks ?? [])].map((CONSTRAINT_NAME) => ({ CONSTRAINT_NAME }))]
    throw new Error(`consulta inesperada en el pool falso: ${q}`)
  }
  return { query: run, execute: run, alters }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MASTER_AUDIT_TABLES', () => {
  it('CA-27: las 7 tablas con su prefijo de índices y FK', () => {
    expect(m.MASTER_AUDIT_TABLES).toEqual([
      { table: 'seasons', prefix: 'seasons' },
      { table: 'companies', prefix: 'companies' },
      { table: 'species', prefix: 'species' },
      { table: 'varieties', prefix: 'varieties' },
      { table: 'csg_catalog', prefix: 'csg' },
      { table: 'jc_foremen', prefix: 'jc_foremen' },
      { table: 'season_cost_centers', prefix: 'scc' },
    ])
  })
})

describe('ensureMastersAuditSchema', () => {
  it('CA-27: esquema anterior -> 42 ALTER (2 columnas + 2 índices + 2 FK por tabla) y true', async () => {
    const pool = fakePool()
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(true)
    expect(pool.alters).toHaveLength(42)
    expect(pool.alters.filter((a) => /ADD COLUMN/i.test(a))).toHaveLength(14)
    expect(pool.alters.filter((a) => /ADD KEY/i.test(a))).toHaveLength(14)
    expect(pool.alters.filter((a) => /ADD CONSTRAINT/i.test(a))).toHaveLength(14)
    expect(pool.alters.some((a) => /fk_scc_updated_by/.test(a) && /ON DELETE SET NULL/i.test(a))).toBe(true)
    expect(pool.alters.some((a) => /idx_csg_created_by/.test(a))).toBe(true)
  })

  it('CA-27: idempotente, una segunda ejecución no hace ningún ALTER', async () => {
    const pool = fakePool()
    await m.ensureMastersAuditSchema(pool)
    const antes = pool.alters.length
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(true)
    expect(pool.alters.length).toBe(antes)
  })

  it('CA-27: todo existente -> 0 ALTER y true', async () => {
    const pool = fakePool({ withAuditCols: true })
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(true)
    expect(pool.alters).toHaveLength(0)
  })

  it('CA-27: ninguna tabla existe (0 filas) -> 0 ALTER y false', async () => {
    const pool = fakePool({ tables: 'none' })
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(false)
    expect(pool.alters).toHaveLength(0)
  })

  it('CA-27: no ejecuta ningún UPDATE/INSERT/DELETE de datos (sin backfill)', async () => {
    const pool = fakePool()
    await m.ensureMastersAuditSchema(pool)
    expect(pool.alters.every((a) => /^ALTER TABLE/i.test(a))).toBe(true)
  })

  it('D4: ADD COLUMN falla con ER_TABLEACCESS_DENIED_ERROR -> no lanza y devuelve false', async () => {
    const pool = fakePool({
      fails: [{ match: /ADD COLUMN/i, error: err('ER_TABLEACCESS_DENIED_ERROR', 'ALTER command denied') }],
    })
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(false)
  })

  it('D4: solo ADD CONSTRAINT falla por permisos -> true (la FK no es requisito del flag)', async () => {
    const pool = fakePool({
      fails: [{ match: /ADD CONSTRAINT/i, error: err('ER_TABLEACCESS_DENIED_ERROR', 'REFERENCES command denied') }],
    })
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(true)
    expect(pool.alters.filter((a) => /ADD COLUMN/i.test(a))).toHaveLength(14)
  })

  it.each([
    ['ER_DUP_FIELDNAME en ADD COLUMN', { match: /ADD COLUMN/i, error: err('ER_DUP_FIELDNAME') }],
    ['ER_DUP_KEYNAME en ADD KEY', { match: /ADD KEY/i, error: err('ER_DUP_KEYNAME') }],
    ['ER_FK_DUP_NAME en ADD CONSTRAINT', { match: /ADD CONSTRAINT/i, error: err('ER_FK_DUP_NAME') }],
    ['ER_DUP_KEY en ADD CONSTRAINT', { match: /ADD CONSTRAINT/i, error: err('ER_DUP_KEY') }],
    [
      'errno 121 (MariaDB) en ADD CONSTRAINT',
      {
        match: /ADD CONSTRAINT/i,
        error: err('ER_CANT_CREATE_TABLE', "Can't create table (errno: 121 \"Duplicate key on write or update\")"),
      },
    ],
  ] as Array<[string, Fail]>)('MEN-6: tolera "ya existe": %s', async (_n, fail) => {
    const pool = fakePool({ fails: [{ ...fail, applyAnyway: true }] })
    await expect(m.ensureMastersAuditSchema(pool)).resolves.toBe(true)
    // sigue con las demás tablas: la 7.ª también recibió sus ALTER
    expect(pool.alters.some((a) => /season_cost_centers/.test(a))).toBe(true)
  })
})

describe('buildAuditedUpdate', () => {
  const csgCols: Col[] = [{ name: 'code', text: true }, { name: 'name', text: true }, { name: 'is_active' }]

  it('CA-28: updated_by es la PRIMERA asignación del SET', () => {
    const { sql } = m.buildAuditedUpdate('csg_catalog', csgCols, { audit: true })
    expect(norm(sql).startsWith('UPDATE csg_catalog SET updated_by = IF(')).toBe(true)
  })

  it('CA-28: texto con CAST AS BINARY y <=>; no texto con <=>', () => {
    const sql = norm(m.buildAuditedUpdate('csg_catalog', csgCols, { audit: true }).sql)
    expect(sql).toContain('CAST(code AS BINARY) <=> CAST(? AS BINARY)')
    expect(sql).toContain('CAST(name AS BINARY) <=> CAST(? AS BINARY)')
    expect(sql).toContain('is_active <=> ?')
    expect(sql).toContain(', updated_by, ?)')
    expect(sql).toMatch(/WHERE id = \?$/)
  })

  it('CA-28: params(values, userId, id) -> [valores, userId, valores, id]', () => {
    const { params } = m.buildAuditedUpdate('csg_catalog', csgCols, { audit: true })
    expect(params(['A', 'B', 1], 7, 12)).toEqual(['A', 'B', 1, 7, 'A', 'B', 1, 12])
  })

  it('CA-28: la cantidad de placeholders coincide con los params', () => {
    const { sql, params } = m.buildAuditedUpdate('csg_catalog', csgCols, { audit: true })
    expect((sql.match(/\?/g) || []).length).toBe(params(['A', 'B', 1], 7, 12).length)
  })

  it.each([
    ['seasons', [
      { name: 'code', text: true }, { name: 'name', text: true }, { name: 'starts_on' },
      { name: 'ends_on' }, { name: 'is_current' }, { name: 'is_active' },
    ]],
    ['varieties', [{ name: 'code', text: true }, { name: 'name', text: true }, { name: 'species_id' }, { name: 'is_active' }]],
    ['season_cost_centers', [
      { name: 'season_id' }, { name: 'company_id' }, { name: 'center_code', text: true },
      { name: 'center_name', text: true }, { name: 'species_id' }, { name: 'variety_id' },
      { name: 'csg_id' }, { name: 'is_active' },
    ]],
  ] as Array<[string, Col[]]>)('CA-28: columnas comparadas == columnas asignadas (%s)', (table, cols) => {
    const sql = norm(m.buildAuditedUpdate(table, cols, { audit: true }).sql)
    const iniSet = sql.indexOf('SET ') + 4
    const finIf = sql.indexOf(', updated_by, ?)')
    const cond = sql.slice(iniSet, finIf)
    const tail = sql.slice(finIf + ', updated_by, ?)'.length, sql.indexOf(' WHERE'))
    const comparadas = [...cond.matchAll(/(?:CAST\()?(\w+)(?: AS BINARY\))? <=> /g)].map((x) => x[1]).filter((c) => c !== 'IF')
    const asignadas = [...tail.matchAll(/(\w+) = \?/g)].map((x) => x[1])
    expect(comparadas).toEqual(cols.map((c) => c.name))
    expect(asignadas).toEqual(cols.map((c) => c.name))
  })

  it('D4: sin auditoría, el UPDATE no menciona updated_by ni created_by', () => {
    const { sql, params } = m.buildAuditedUpdate('csg_catalog', csgCols, { audit: false })
    expect(sql).not.toMatch(/updated_by|created_by|BINARY|<=>/)
    expect(norm(sql)).toBe('UPDATE csg_catalog SET code = ?, name = ?, is_active = ? WHERE id = ?')
    expect(params(['A', 'B', 1], 7, 12)).toEqual(['A', 'B', 1, 12])
  })
})

describe('buildAuditedInsert', () => {
  const cols: Col[] = [{ name: 'code', text: true }, { name: 'name', text: true }, { name: 'is_active' }]

  it('CA-17: el INSERT auditado incluye created_by y updated_by con dos placeholders', () => {
    const { sql, params } = m.buildAuditedInsert('csg_catalog', cols, { audit: true })
    expect(norm(sql)).toBe(
      'INSERT INTO csg_catalog (code, name, is_active, created_by, updated_by) VALUES (?, ?, ?, ?, ?)',
    )
    expect(params(['A', 'B', 1], 7)).toEqual(['A', 'B', 1, 7, 7])
  })

  it('CA-20: el autor viene solo del parámetro userId, no de los valores del cuerpo', () => {
    const { params } = m.buildAuditedInsert('csg_catalog', cols, { audit: true })
    expect(params(['A', 'B', 1], 5).slice(-2)).toEqual([5, 5])
  })

  it('D4: sin auditoría el INSERT no contiene created_by ni updated_by', () => {
    const { sql, params } = m.buildAuditedInsert('csg_catalog', cols, { audit: false })
    expect(sql).not.toMatch(/created_by|updated_by/)
    expect(norm(sql)).toBe('INSERT INTO csg_catalog (code, name, is_active) VALUES (?, ?, ?)')
    expect(params(['A', 'B', 1], 7)).toEqual(['A', 'B', 1])
  })
})

describe('buildImportAuditClause (P2)', () => {
  const cols: ImportCol[] = [
    { col: 'name', expr: 'VALUES(name)', text: true },
    { col: 'is_active', expr: '1' },
  ]

  it('CA-26: updated_by = IF(todo igual, updated_by, NULL), con CAST binario en el texto', () => {
    const c = norm(m.buildImportAuditClause(cols, { audit: true }))
    expect(c.startsWith('updated_by = IF(')).toBe(true)
    expect(c).toContain('CAST(name AS BINARY) <=> CAST(VALUES(name) AS BINARY)')
    expect(c).toContain('is_active <=> 1')
    expect(c.endsWith(', updated_by, NULL)')).toBe(true)
  })

  it('CA-26: columna de texto con literal fijo (source = excel)', () => {
    const c = norm(m.buildImportAuditClause([{ col: 'source', expr: "'excel'", text: true }], { audit: true }))
    expect(c).toContain("CAST(source AS BINARY) <=> CAST('excel' AS BINARY)")
  })

  it('CA-25: no usa placeholders ni valores del usuario', () => {
    expect(m.buildImportAuditClause(cols, { audit: true })).not.toContain('?')
  })

  it('D4: sin auditoría no referencia updated_by', () => {
    expect(m.buildImportAuditClause(cols, { audit: false })).not.toMatch(/updated_by|created_by/)
  })
})

describe('buildUnsetCurrentSeason (P3, CA-29)', () => {
  it('CA-29: manual con auditoría atribuye al usuario y filtra is_current = 1', () => {
    const { sql, params } = m.buildUnsetCurrentSeason({ audit: true, actor: 'user' })
    expect(norm(sql)).toBe('UPDATE seasons SET updated_by = ?, is_current = 0 WHERE code <> ? AND is_current = 1')
    expect(params('2026', 7)).toEqual([7, '2026'])
  })

  it('CA-29: importación con auditoría deja updated_by = NULL (P2) y filtra is_current = 1', () => {
    const { sql, params } = m.buildUnsetCurrentSeason({ audit: true, actor: 'import' })
    expect(norm(sql)).toBe('UPDATE seasons SET updated_by = NULL, is_current = 0 WHERE code <> ? AND is_current = 1')
    expect(params('2026')).toEqual(['2026'])
  })

  it.each(['user', 'import'] as const)('D4: sin auditoría (%s) no toca updated_by pero conserva AND is_current = 1', (actor) => {
    const { sql, params } = m.buildUnsetCurrentSeason({ audit: false, actor })
    expect(sql).not.toMatch(/updated_by/)
    expect(norm(sql)).toBe('UPDATE seasons SET is_current = 0 WHERE code <> ? AND is_current = 1')
    expect(params('2026', 7)).toEqual(['2026'])
  })
})

describe('auditSelect / auditJoins', () => {
  it('CA-21: con auditoría incluye autores, nombres vigentes y epoch en ms', () => {
    const s = norm(m.auditSelect('t', true))
    expect(s).toContain('t.created_by')
    expect(s).toContain('t.updated_by')
    expect(s).toContain("COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.username) AS created_by_name")
    expect(s).toContain("COALESCE(NULLIF(TRIM(uu.full_name), ''), uu.username) AS updated_by_name")
    expect(s).toContain('ROUND(UNIX_TIMESTAMP(t.created_at) * 1000) AS created_at_ms')
    expect(s).toContain('ROUND(UNIX_TIMESTAMP(t.updated_at) * 1000) AS updated_at_ms')
    const j = norm(m.auditJoins('t', true))
    expect(j).toContain('LEFT JOIN users cu ON cu.id = t.created_by')
    expect(j).toContain('LEFT JOIN users uu ON uu.id = t.updated_by')
  })

  it('D4: sin auditoría solo trae las fechas y no referencia autores ni users', () => {
    const s = m.auditSelect('t', false)
    expect(s).toContain('created_at_ms')
    expect(s).toContain('updated_at_ms')
    expect(s).not.toMatch(/created_by|updated_by|users|cu\.|uu\./)
    expect(m.auditJoins('t', false)).not.toMatch(/created_by|updated_by|users|JOIN/)
  })
})

describe('mapAuditRow', () => {
  const t0 = Date.UTC(2026, 9, 2, 13, 5, 11, 120)
  const t1 = Date.UTC(2026, 9, 3, 2, 30, 0, 0)

  it('CA-21: arma createdBy/updatedBy {id,name}, fechas ISO y quita las columnas crudas', () => {
    const out = m.mapAuditRow({
      id: 12, code: 'CSG-N', name: 'CSG Norte', is_active: 1,
      created_by: 1, updated_by: '7', created_by_name: 'Super Administrador', updated_by_name: 'María Admin',
      created_at_ms: t0, updated_at_ms: String(t1),
    })
    expect(out).toMatchObject({
      id: 12, code: 'CSG-N', name: 'CSG Norte', is_active: 1,
      createdBy: { id: 1, name: 'Super Administrador' },
      updatedBy: { id: 7, name: 'María Admin' },
      createdAt: '2026-10-02T13:05:11.120Z',
      updatedAt: '2026-10-03T02:30:00.000Z',
    })
    for (const k of ['created_by', 'updated_by', 'created_by_name', 'updated_by_name', 'created_at_ms', 'updated_at_ms'])
      expect(out).not.toHaveProperty(k)
  })

  it('CA-24: registro histórico (autores NULL) -> createdBy = updatedBy = null', () => {
    const out = m.mapAuditRow({
      id: 1, created_by: null, updated_by: null, created_by_name: null, updated_by_name: null,
      created_at_ms: t0, updated_at_ms: t1,
    })
    expect(out.createdBy).toBeNull()
    expect(out.updatedBy).toBeNull()
    expect(out.updatedAt).toBe('2026-10-03T02:30:00.000Z')
  })

  it('D4: usuario borrado sin FK (id presente, nombre null) -> null y no rompe', () => {
    const out = m.mapAuditRow({
      id: 1, created_by: 99, updated_by: 98, created_by_name: null, updated_by_name: null,
      created_at_ms: t0, updated_at_ms: t1,
    })
    expect(out.createdBy).toBeNull()
    expect(out.updatedBy).toBeNull()
  })

  it('D4: modo degradado, fila sin columnas de autor -> null y fechas ISO válidas', () => {
    const out = m.mapAuditRow({ id: 1, code: 'X', created_at_ms: t0, updated_at_ms: t1 })
    expect(out.createdBy).toBeNull()
    expect(out.updatedBy).toBeNull()
    expect(new Date(out.createdAt as string).getTime()).toBe(t0)
    expect(new Date(out.updatedAt as string).getTime()).toBe(t1)
  })
})

describe('normalizeSeasonDate (D5)', () => {
  it.each([
    ['2025-11-01', '2025-11-01'],
    ['2025-11-01T03:00:00.000Z', '2025-11-01'],
  ])('fecha válida %j -> %j', (entrada, esperado) => {
    expect(m.normalizeSeasonDate(entrada)).toEqual({ valid: true, value: esperado })
  })

  it.each([[''], ['  '], [null], [undefined]])('vacío %j -> { valid: true, value: null }', (v) => {
    expect(m.normalizeSeasonDate(v)).toEqual({ valid: true, value: null })
  })

  it.each([['01-11-2025'], ['mañana'], ['2025/11/01'], [20251101], [{}]])(
    'inválido %j -> { valid: false } (la ruta responde 400 invalid_payload)',
    (v) => {
      expect(m.normalizeSeasonDate(v).valid).toBe(false)
    },
  )
})

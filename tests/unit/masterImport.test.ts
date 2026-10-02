import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

type Call = { sql: string; params: unknown[] }
type Conn = { execute: (sql: string, params?: unknown[]) => Promise<[unknown[], unknown]> }
type Resolver = {
  company: (name: string) => Promise<number>
  species: (name: string) => Promise<number>
  csg: (name: string) => Promise<number>
  variety: (speciesId: number, name: string) => Promise<number>
}
type ImportCol = { col: string; expr: string; text?: boolean }
type UpsertValues = {
  seasonId: number
  companyId: number
  centerCode: string
  centerName: string
  speciesId: number
  varietyId: number
  csgId: number
}
const { createCatalogResolver, buildRelationImportUpsert } = require('../../server/masterImport.cjs') as {
  createCatalogResolver: (conn: Conn, o: { audit: boolean; toCode: (v: string) => string }) => Resolver
  buildRelationImportUpsert: (o: { audit: boolean; withCenterName: boolean }) => {
    sql: string
    params: (v: UpsertValues) => unknown[]
  }
}
const { buildImportChangeCondition, buildImportAuditClause } = require('../../server/masterAudit.cjs') as {
  buildImportChangeCondition: (cols: ImportCol[]) => string
  buildImportAuditClause: (cols: ImportCol[], o: { audit: boolean }) => string
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const toCode = (v: string) => String(v).trim().toUpperCase().replace(/\s+/g, '_') || 'N/A'

/**
 * Conexión falsa: `rules` responde por patrón sobre el SQL normalizado. Cada regla puede
 * devolver filas distintas en cada llamada (cola) para simular "no existe" y luego "existe".
 */
function fakeConn(rules: Array<{ match: RegExp; rows: Array<Array<{ id: number }>> }>) {
  const calls: Call[] = []
  const queues = rules.map((r) => ({ ...r, rows: [...r.rows] }))
  const conn: Conn = {
    async execute(sql, params = []) {
      const n = norm(sql)
      calls.push({ sql: n, params })
      for (const q of queues) {
        if (q.match.test(n)) {
          const rows = q.rows.length > 1 ? q.rows.shift()! : (q.rows[0] ?? [])
          return [rows, undefined]
        }
      }
      return [[], undefined]
    },
  }
  return { conn, calls }
}

const kinds = (calls: Call[]) => calls.map((c) => c.sql.split(' ')[0])

describe('createCatalogResolver: nombre existente (P5)', () => {
  it.each([
    ['company', 'companies', 'Agrícola Esmeralda'],
    ['species', 'species', 'Arándano'],
    ['csg', 'csg_catalog', 'CSG001'],
  ] as const)('CA-07: %s con código distinto de toCode(nombre) busca por name y actualiza por id, sin INSERT', async (method, table, name) => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    const r = createCatalogResolver(conn, { audit: true, toCode })
    const id = await r[method](name)
    expect(id).toBe(5)
    expect(kinds(calls)).toEqual(['SELECT', 'UPDATE'])
    expect(calls[0].sql).toMatch(new RegExp(`FROM ${table} WHERE name = \\?`))
    expect(calls[0].sql).not.toMatch(/WHERE code/)
    expect(calls[0].params).toEqual([name])
    expect(calls[1].sql).toMatch(new RegExp(`^UPDATE ${table} SET`))
    expect(calls[1].sql).toMatch(/WHERE id = \?$/)
    expect(calls[1].params.at(-1)).toBe(5)
    expect(calls.some((c) => /INSERT/.test(c.sql))).toBe(false)
  })

  it('CA-07: el UPDATE nunca asigna code y atribuye updated_by = NULL (userId null)', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    await createCatalogResolver(conn, { audit: true, toCode }).company('Agrícola Esmeralda')
    const set = calls[1].sql.slice(calls[1].sql.indexOf(' SET ') + 5, calls[1].sql.lastIndexOf(' WHERE '))
    expect(set).not.toMatch(/\bcode\b/)
    expect(set).toMatch(/^updated_by = IF\(/)
    expect(set).toMatch(/, updated_by, \?\), name = \?, is_active = \?$/)
    expect(calls[1].params).toContain('Agrícola Esmeralda')
    expect(calls[1].params).toContain(null)
  })

  it('D4: sin auditoría el UPDATE no menciona updated_by', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    await createCatalogResolver(conn, { audit: false, toCode }).company('X')
    expect(calls[1].sql).not.toMatch(/updated_by/)
  })

  it('CA-25: el nombre solo viaja como parámetro, nunca interpolado en el SQL', async () => {
    const nombre = "x'; DROP TABLE companies; --"
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 1 }]] }])
    await createCatalogResolver(conn, { audit: true, toCode }).company(nombre)
    for (const c of calls) expect(c.sql).not.toContain('DROP TABLE')
  })
})

describe('createCatalogResolver: nombre nuevo (respaldo, MEN-5)', () => {
  function nuevo() {
    return fakeConn([
      // 1ª búsqueda (sin LOCK): no existe. 2ª (con LOCK): ya insertado.
      { match: /LOCK IN SHARE MODE$/, rows: [[{ id: 9 }]] },
      { match: /^SELECT id FROM (?!.*LOCK)/, rows: [[]] },
    ])
  }

  it.each([
    ['company', 'companies', 'Empresa Nueva', 'EMPRESA_NUEVA'],
    ['species', 'species', 'Especie Nueva', 'ESPECIE_NUEVA'],
    ['csg', 'csg_catalog', 'CSG Nuevo', 'CSG_NUEVO'],
  ] as const)('CA-07: %s nuevo hace SELECT, INSERT ... ON DUPLICATE KEY UPDATE y SELECT por name con LOCK IN SHARE MODE', async (method, table, name, code) => {
    const { conn, calls } = nuevo()
    const id = await createCatalogResolver(conn, { audit: true, toCode })[method](name)
    expect(id).toBe(9)
    expect(kinds(calls)).toEqual(['SELECT', 'INSERT', 'SELECT'])
    expect(calls[1].sql).toMatch(new RegExp(`^INSERT INTO ${table} \\(code, name, is_active\\)`))
    expect(calls[1].sql).toContain('ON DUPLICATE KEY UPDATE')
    expect(calls[1].params).toEqual([code, name])
    expect(calls[2].sql).toBe(`SELECT id FROM ${table} WHERE name = ? LIMIT 1 LOCK IN SHARE MODE`)
    expect(calls[2].params).toEqual([name])
    expect(calls[2].sql).not.toMatch(/WHERE code/)
  })

  it('CA-07: el ON DUPLICATE KEY UPDATE del respaldo conserva la auditoría (updated_by antes de name)', async () => {
    const { conn, calls } = nuevo()
    await createCatalogResolver(conn, { audit: true, toCode }).company('Empresa Nueva')
    const odku = calls[1].sql.slice(calls[1].sql.indexOf('ON DUPLICATE KEY UPDATE'))
    expect(odku.indexOf('updated_by = IF(')).toBeGreaterThan(-1)
    expect(odku.indexOf('updated_by = IF(')).toBeLessThan(odku.indexOf('name = VALUES(name)'))
  })

  it('CA-07: id inexistente tras el respaldo lanza catalog_unresolved', async () => {
    const { conn } = fakeConn([{ match: /^SELECT id FROM/, rows: [[]] }])
    await expect(createCatalogResolver(conn, { audit: true, toCode }).company('Nada')).rejects.toThrow(
      'catalog_unresolved',
    )
  })

  it('CA-07: nunca usa undefined como parámetro', async () => {
    const { conn, calls } = nuevo()
    const r = createCatalogResolver(conn, { audit: true, toCode })
    await r.company('Empresa Nueva')
    for (const c of calls) expect(c.params.includes(undefined)).toBe(false)
  })
})

describe('createCatalogResolver: variedad por especie + nombre', () => {
  it('CA-07: existente en su especie -> SELECT por species_id y name, UPDATE por id, sin INSERT', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM varieties/, rows: [[{ id: 4 }]] }])
    const id = await createCatalogResolver(conn, { audit: true, toCode }).variety(2, 'Lapins')
    expect(id).toBe(4)
    expect(kinds(calls)).toEqual(['SELECT', 'UPDATE'])
    expect(calls[0].sql).toBe('SELECT id FROM varieties WHERE species_id = ? AND name = ? LIMIT 1')
    expect(calls[0].params).toEqual([2, 'Lapins'])
    expect(calls[1].sql).toMatch(/^UPDATE varieties SET/)
    expect(calls[1].sql).not.toMatch(/species_id = \?/)
    expect(calls[1].params.at(-1)).toBe(4)
  })

  it('CA-22: el UPDATE de una variedad existente no mueve la variedad de especie', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM varieties/, rows: [[{ id: 4 }]] }])
    await createCatalogResolver(conn, { audit: true, toCode }).variety(2, 'Lapins')
    const set = calls[1].sql.slice(calls[1].sql.indexOf(' SET ') + 5, calls[1].sql.lastIndexOf(' WHERE '))
    expect(set).not.toMatch(/species_id\s*=/)
    expect(set).not.toMatch(/\bcode\b/)
  })

  it('CA-07: nueva -> INSERT por código con species_id y SELECT con LOCK IN SHARE MODE por species_id y name', async () => {
    const { conn, calls } = fakeConn([
      { match: /LOCK IN SHARE MODE$/, rows: [[{ id: 11 }]] },
      { match: /^SELECT id FROM varieties WHERE species_id = \? AND name = \? LIMIT 1$/, rows: [[]] },
    ])
    const id = await createCatalogResolver(conn, { audit: true, toCode }).variety(2, 'Sweet Heart')
    expect(id).toBe(11)
    expect(kinds(calls)).toEqual(['SELECT', 'INSERT', 'SELECT'])
    expect(calls[1].sql).toMatch(/^INSERT INTO varieties \(code, name, species_id, is_active\)/)
    expect(calls[1].params).toEqual(['SWEET_HEART', 'Sweet Heart', 2])
    expect(calls[2].sql).toBe('SELECT id FROM varieties WHERE species_id = ? AND name = ? LIMIT 1 LOCK IN SHARE MODE')
    expect(calls[2].params).toEqual([2, 'Sweet Heart'])
  })

  it('CA-07: variedad inexistente tras el respaldo lanza catalog_unresolved', async () => {
    const { conn } = fakeConn([{ match: /^SELECT id FROM/, rows: [[]] }])
    await expect(createCatalogResolver(conn, { audit: true, toCode }).variety(1, 'Z')).rejects.toThrow(
      'catalog_unresolved',
    )
  })
})

describe('createCatalogResolver: caché por solicitud', () => {
  it('CA-19: repetir el mismo nombre no consulta de nuevo (0 consultas)', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    const r = createCatalogResolver(conn, { audit: true, toCode })
    await r.company('Agrícola Esmeralda')
    const antes = calls.length
    expect(await r.company('Agrícola Esmeralda')).toBe(5)
    expect(await r.company('Agrícola Esmeralda')).toBe(5)
    expect(calls.length).toBe(antes)
  })

  it('CA-19: la clave incluye la tabla: el mismo nombre en company y species consulta cada una', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    const r = createCatalogResolver(conn, { audit: true, toCode })
    await r.company('Mismo')
    await r.species('Mismo')
    expect(calls.filter((c) => c.sql.startsWith('SELECT'))).toHaveLength(2)
  })

  it('CA-19: la clave de variedad incluye la especie', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    const r = createCatalogResolver(conn, { audit: true, toCode })
    await r.variety(1, 'X')
    await r.variety(1, 'X')
    expect(calls.filter((c) => c.sql.startsWith('SELECT'))).toHaveLength(1)
    await r.variety(2, 'X')
    expect(calls.filter((c) => c.sql.startsWith('SELECT'))).toHaveLength(2)
  })

  it('CA-19: la caché es por resolver (por solicitud): otro resolver vuelve a consultar', async () => {
    const { conn, calls } = fakeConn([{ match: /^SELECT id FROM/, rows: [[{ id: 5 }]] }])
    await createCatalogResolver(conn, { audit: true, toCode }).company('A')
    await createCatalogResolver(conn, { audit: true, toCode }).company('A')
    expect(calls.filter((c) => c.sql.startsWith('SELECT'))).toHaveLength(2)
  })

  it('CA-19: un fallo no deja un id en la caché', async () => {
    const { conn } = fakeConn([{ match: /^SELECT id FROM/, rows: [[]] }])
    const r = createCatalogResolver(conn, { audit: true, toCode })
    await expect(r.company('Nada')).rejects.toThrow('catalog_unresolved')
    await expect(r.company('Nada')).rejects.toThrow('catalog_unresolved')
  })
})

describe('buildRelationImportUpsert (P3 + P4)', () => {
  const values: UpsertValues = {
    seasonId: 1,
    companyId: 2,
    centerCode: 'CC01',
    centerName: 'Cuartel 1',
    speciesId: 3,
    varietyId: 4,
    csgId: 5,
  }
  const odkuOf = (sql: string) => norm(sql).slice(norm(sql).indexOf('ON DUPLICATE KEY UPDATE'))
  const condOf = (odku: string) => {
    const start = odku.indexOf('updated_by = IF(') + 'updated_by = IF('.length
    return odku.slice(start, odku.indexOf(', updated_by, NULL)'))
  }
  const sourceCondOf = (odku: string) => {
    const start = odku.indexOf('source = IF(') + 'source = IF('.length
    return odku.slice(start, odku.indexOf(", source, 'excel')"))
  }

  it.each([true, false])('CA-07: updated_by antes que source y ambos antes que las columnas de negocio (withCenterName=%s)', (withCenterName) => {
    const odku = odkuOf(buildRelationImportUpsert({ audit: true, withCenterName }).sql)
    const pos = (t: string) => odku.indexOf(t)
    expect(pos('updated_by = IF(')).toBeGreaterThan(-1)
    expect(pos('updated_by = IF(')).toBeLessThan(pos('source = IF('))
    expect(pos('source = IF(')).toBeLessThan(pos('species_id = VALUES(species_id)'))
    expect(pos('species_id = VALUES(species_id)')).toBeLessThan(pos('variety_id = VALUES(variety_id)'))
    expect(pos('variety_id = VALUES(variety_id)')).toBeLessThan(pos('csg_id = VALUES(csg_id)'))
    expect(pos('csg_id = VALUES(csg_id)')).toBeLessThan(pos('is_active = 1'))
    if (withCenterName) {
      expect(pos('source = IF(')).toBeLessThan(pos('center_name = VALUES(center_name)'))
    }
  })

  it('P4: la condición de cambio no menciona source y compara especie, variedad, CSG y estado', () => {
    const odku = odkuOf(buildRelationImportUpsert({ audit: true, withCenterName: true }).sql)
    const cond = condOf(odku)
    expect(cond).not.toMatch(/source/)
    expect(cond).toContain('species_id <=> VALUES(species_id)')
    expect(cond).toContain('variety_id <=> VALUES(variety_id)')
    expect(cond).toContain('csg_id <=> VALUES(csg_id)')
    expect(cond).toContain('is_active <=> 1')
    expect(cond).toContain('CAST(center_name AS BINARY) <=> CAST(VALUES(center_name) AS BINARY)')
  })

  it('P4: source = IF(<misma condición>, source, \'excel\'), nunca el literal fijo', () => {
    const odku = odkuOf(buildRelationImportUpsert({ audit: true, withCenterName: true }).sql)
    expect(sourceCondOf(odku)).toBe(condOf(odku))
    expect(odku).not.toMatch(/source = 'excel'/)
  })

  it('P3: withCenterName=false no asigna center_name en el UPDATE ni lo compara', () => {
    const odku = odkuOf(buildRelationImportUpsert({ audit: true, withCenterName: false }).sql)
    expect(odku).not.toMatch(/center_name/)
  })

  it('P3: withCenterName=true asigna center_name = VALUES(center_name)', () => {
    const odku = odkuOf(buildRelationImportUpsert({ audit: true, withCenterName: true }).sql)
    expect(odku).toContain('center_name = VALUES(center_name)')
  })

  it('P3/P4: audit=false no tiene updated_by pero sí source = IF(...)', () => {
    const { sql } = buildRelationImportUpsert({ audit: false, withCenterName: true })
    expect(sql).not.toMatch(/updated_by/)
    expect(odkuOf(sql)).toMatch(/source = IF\(/)
    expect(sourceCondOf(odkuOf(sql))).not.toMatch(/source/)
  })

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('CA-25: audit=%s withCenterName=%s -> los placeholders coinciden con params y no hay undefined', (audit, withCenterName) => {
    const { sql, params } = buildRelationImportUpsert({ audit, withCenterName })
    const p = params(values)
    expect(sql.match(/\?/g)?.length ?? 0).toBe(p.length)
    expect(p.includes(undefined)).toBe(false)
    expect(p).toEqual([1, 2, 'CC01', 'Cuartel 1', 3, 4, 5])
  })

  it('P13: relación nueva sin nombre se inserta con center_name vacío (parámetro "")', () => {
    const { params } = buildRelationImportUpsert({ audit: true, withCenterName: false })
    expect(params({ ...values, centerName: '' })[3]).toBe('')
  })

  it('el INSERT lleva source=\'excel\' e is_active=1 para filas nuevas', () => {
    const { sql } = buildRelationImportUpsert({ audit: true, withCenterName: true })
    expect(norm(sql)).toMatch(/^INSERT INTO season_cost_centers \(season_id, company_id, center_code, center_name, species_id, variety_id, csg_id, is_active, source\) VALUES \(\?, \?, \?, \?, \?, \?, \?, 1, 'excel'\)/)
  })
})

describe('buildImportChangeCondition y buildImportAuditClause', () => {
  const cols: ImportCol[] = [
    { col: 'name', expr: 'VALUES(name)', text: true },
    { col: 'species_id', expr: 'VALUES(species_id)' },
    { col: 'is_active', expr: '1' },
  ]

  it('CA-26: une las comparaciones con AND (CAST binario solo para texto)', () => {
    expect(norm(buildImportChangeCondition(cols))).toBe(
      'CAST(name AS BINARY) <=> CAST(VALUES(name) AS BINARY) AND species_id <=> VALUES(species_id) AND is_active <=> 1',
    )
  })

  it('CA-25: no usa placeholders', () => {
    expect(buildImportChangeCondition(cols)).not.toContain('?')
  })

  it('CA-26: buildImportAuditClause mantiene su salida (usa la condición exportada)', () => {
    expect(norm(buildImportAuditClause(cols, { audit: true }))).toBe(
      `updated_by = IF(${norm(buildImportChangeCondition(cols))}, updated_by, NULL)`,
    )
  })

  it('D4: sin auditoría la cláusula sigue vacía', () => {
    expect(buildImportAuditClause(cols, { audit: false })).toBe('')
  })
})

import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  buildMastersExport,
  buildTemplateWorkbook,
  exportFileName,
  importedSeasonCode,
  IMPORT_ROW_LIMIT,
  MASTER_HEADERS,
  nonImportableReasons,
  parseMasterRow,
  parseMasterWorkbook,
} from '../../src/lib/masterExcel'
import type {
  MasterCompany,
  MasterCsg,
  MasterRelation,
  MasterSeason,
  MasterSpecies,
  MasterVariety,
} from '../../src/types'

type Bundle = {
  seasons: MasterSeason[]
  companies: MasterCompany[]
  species: MasterSpecies[]
  csg: MasterCsg[]
  jcForemen: never[]
  varieties: MasterVariety[]
  relations: MasterRelation[]
}

const HEADERS = ['EMPRESA', 'ESPECIE', 'VARIEDAD', 'CC', 'CSG', 'NOMBRE CC']
const NOW = new Date(2026, 9, 2, 23, 30)

function baseBundle(): Bundle {
  const season = (id: number, code: string, cur: number): MasterSeason => ({
    id,
    code,
    name: `Temporada ${code}`,
    starts_on: null,
    ends_on: null,
    is_current: cur,
    is_active: 1,
  })
  return {
    seasons: [season(1, '2025-2026', 1), season(2, '2024-2025', 0)],
    companies: [{ id: 1, code: 'ESMERALDA', name: 'Agrícola Esmeralda', is_active: 1 }],
    species: [
      { id: 1, code: 'CEREZA', name: 'Cereza', is_active: 1 },
      { id: 2, code: 'ARANDANO', name: 'Arándano', is_active: 1 },
    ],
    csg: [
      { id: 1, code: 'CSG001', name: 'CSG001', is_active: 1 },
      { id: 2, code: 'CSG002', name: 'CSG002', is_active: 1 },
    ],
    jcForemen: [],
    varieties: [{ id: 1, code: 'LAPINS', name: 'Lapins', species_id: 1, is_active: 1 }],
    relations: [
      rel({ id: 1, season_id: 1, center_code: 'CC01', center_name: 'Cuartel 1' }),
      rel({ id: 2, season_id: 1, center_code: 'CC02', center_name: 'Cuartel 2' }),
      rel({ id: 3, season_id: 2, center_code: 'CC77', center_name: 'Otro' }),
    ],
  }
}

function rel(over: Partial<MasterRelation>): MasterRelation {
  return {
    id: 1,
    season_id: 1,
    company_id: 1,
    company_name: 'Agrícola Esmeralda',
    center_code: 'CC01',
    center_name: '',
    species_id: 1,
    species_name: 'Cereza',
    variety_id: 1,
    variety_name: 'Lapins',
    csg_id: 1,
    csg_name: 'CSG001',
    is_active: 1,
    ...over,
  }
}

function okExport(bundle: Bundle, seasonId = 1) {
  const r = buildMastersExport(bundle, seasonId, NOW)
  if (r.kind !== 'ok') throw new Error('se esperaba kind ok, vino ' + r.kind)
  return r
}

function aoa(wb: XLSX.WorkBook, sheet: string): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1, defval: '', raw: false })
}

function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return XLSX.read(buf, { type: 'array', cellNF: true })
}

function wbFrom(sheets: Array<[string, unknown[][]]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  return wb
}

describe('constantes', () => {
  it('CA-01: MASTER_HEADERS tiene las 6 columnas en el orden de la plantilla', () => {
    expect([...MASTER_HEADERS]).toEqual(HEADERS)
  })
  it('CA-20: IMPORT_ROW_LIMIT es 10000', () => {
    expect(IMPORT_ROW_LIMIT).toBe(10000)
  })
})

describe('buildMastersExport: hoja Maestros', () => {
  it('CA-01: hoja 1 "Maestros" con fila 1 = encabezados y solo las relaciones de la temporada elegida', () => {
    const r = okExport(baseBundle(), 1)
    expect(r.workbook.SheetNames).toEqual(['Maestros', 'No importables', 'Temporada'])
    const rows = aoa(r.workbook, 'Maestros')
    expect(rows[0]).toEqual(HEADERS)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['Agrícola Esmeralda', 'Cereza', 'Lapins', 'CC01', 'CSG001', 'Cuartel 1'])
    expect(rows.flat()).not.toContain('CC77')
    expect(r.rowCount).toBe(2)
  })

  it('CA-01: conserva el orden de las relaciones que entrega la API', () => {
    const b = baseBundle()
    b.relations = [
      rel({ id: 9, center_code: 'ZZ' }),
      rel({ id: 8, center_code: 'AA' }),
    ]
    const rows = aoa(okExport(b).workbook, 'Maestros')
    expect(rows.slice(1).map((x) => x[3])).toEqual(['ZZ', 'AA'])
  })

  it('CA-17: otra temporada devuelve solo sus filas', () => {
    const rows = aoa(okExport(baseBundle(), 2).workbook, 'Maestros')
    expect(rows.slice(1).map((x) => x[3])).toEqual(['CC77'])
  })

  it('RN-08: aplica trim y trata null/undefined como vacío', () => {
    const b = baseBundle()
    b.relations = [
      rel({
        company_name: '  Agrícola Esmeralda  ',
        center_code: ' CC01 ',
        center_name: undefined as unknown as string,
      }),
    ]
    const rows = aoa(okExport(b).workbook, 'Maestros')
    expect(rows[1]).toEqual(['Agrícola Esmeralda', 'Cereza', 'Lapins', 'CC01', 'CSG001', ''])
  })

  it('CA-01: devuelve nombre de archivo, rowCount y nonImportableCount', () => {
    const b = baseBundle()
    b.relations[1] = rel({ id: 2, center_code: 'CC02', is_active: 0 })
    const r = okExport(b)
    expect(r.fileName).toBe('maestros-2025-2026-2026-10-02.xlsx')
    expect(r.rowCount).toBe(1)
    expect(r.nonImportableCount).toBe(1)
    expect(r.overImportLimit).toBe(false)
  })
})

describe('plantilla vs exportación', () => {
  it('CA-02: la fila 1 de la plantilla es idéntica a la de la exportación', () => {
    const tpl = buildTemplateWorkbook()
    expect(tpl.SheetNames[0]).toBe('Plantilla')
    const tplRows = aoa(tpl, 'Plantilla')
    const exp = aoa(okExport(baseBundle()).workbook, 'Maestros')
    expect(tplRows[0]).toEqual(HEADERS)
    expect(tplRows[0]).toEqual(exp[0])
  })

  it('CA-02: la plantilla trae una fila de ejemplo con NOMBRE CC; la exportación no', () => {
    const tplRows = aoa(buildTemplateWorkbook(), 'Plantilla')
    expect(tplRows[1][0]).toBe('EMPRESA EJEMPLO SPA')
    expect(tplRows[1][5]).toBe('Cuartel ejemplo')
    const all = okExport(baseBundle()).workbook.SheetNames.flatMap((n) =>
      aoa(okExport(baseBundle()).workbook, n).flat(),
    )
    expect(all).not.toContain('EMPRESA EJEMPLO SPA')
  })

  it('CA-02: la plantilla se puede leer con el parser de importación', () => {
    const rows = parseMasterWorkbook(roundTrip(buildTemplateWorkbook()))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ empresa: 'EMPRESA EJEMPLO SPA', cc: 'CC-001', csg: '12345', ccNombre: 'Cuartel ejemplo' })
  })
})

describe('exportFileName', () => {
  it('CA-03: usa la fecha LOCAL (23:30) en maestros-<código>-AAAA-MM-DD.xlsx', () => {
    expect(exportFileName('2025-2026', new Date(2026, 9, 2, 23, 30))).toBe('maestros-2025-2026-2026-10-02.xlsx')
  })

  it('CA-03: rellena con ceros mes y día', () => {
    expect(exportFileName('T', new Date(2026, 0, 5, 0, 5))).toBe('maestros-T-2026-01-05.xlsx')
  })

  it('CA-03: reemplaza por "_" los caracteres no válidos / \\ : * ? " < > |', () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j', NOW)).toBe('maestros-a_b_c_d_e_f_g_h_i_j-2026-10-02.xlsx')
  })
})

describe('importedSeasonCode', () => {
  it.each([
    ['2025-2026', '2025-2026'],
    ['2026 sur', '2026_SUR'],
    ['  abc  def ', 'ABC_DEF'],
    ['', 'N/A'],
  ])('espejo de toCode del servidor: %j -> %j', (input, expected) => {
    expect(importedSeasonCode(input)).toBe(expected)
  })
})

describe('celdas de texto', () => {
  it('CA-04: CC y CSG con ceros son tipo texto, con z="@" en CC, CSG y NOMBRE CC', () => {
    const b = baseBundle()
    b.csg.push({ id: 3, code: 'X', name: '00123', is_active: 1 })
    b.relations = [rel({ center_code: '001', center_name: '007', csg_id: 3, csg_name: '00123' })]
    const wb = roundTrip(okExport(b).workbook)
    const s = wb.Sheets['Maestros']
    expect(s['D2']).toMatchObject({ t: 's', v: '001' })
    expect(s['E2']).toMatchObject({ t: 's', v: '00123' })
    expect(s['F2']).toMatchObject({ t: 's', v: '007' })
    for (const addr of ['D2', 'E2', 'F2']) expect(s[addr].z).toBe('@')
    const parsed = parseMasterWorkbook(wb)
    expect(parsed[0]).toMatchObject({ cc: '001', csg: '00123', ccNombre: '007' })
  })

  it('CA-04 (MEN-7): "No importables" también lleva z="@" en CC, CSG y NOMBRE CC', () => {
    const b = baseBundle()
    b.relations = [rel({ center_code: '001', center_name: '9', is_active: 0 })]
    const s = roundTrip(okExport({ ...b, relations: [rel({ id: 1 }), ...b.relations] }).workbook).Sheets[
      'No importables'
    ]
    for (const addr of ['D2', 'E2', 'F2']) expect(s[addr].z).toBe('@')
  })

  it('CA-05: tildes, ñ, & y comillas se conservan exactamente', () => {
    const name = "Agrícola Ñuble & Cía. 'Sur'"
    const b = baseBundle()
    b.companies[0].name = name
    b.relations = [rel({ company_name: name })]
    const rows = parseMasterWorkbook(roundTrip(okExport(b).workbook))
    expect(rows[0].empresa).toBe(name)
  })

  it.each(['=SUMA(1)', '+56912345', '-5', '@cmd', '=1+1'])(
    'CA-05: el valor %j se guarda como texto literal, sin fórmula',
    (value) => {
      const b = baseBundle()
      b.relations = [rel({ center_code: value, center_name: value })]
      const s = roundTrip(okExport(b).workbook).Sheets['Maestros']
      for (const addr of ['D2', 'F2']) {
        expect(s[addr].t).toBe('s')
        expect(s[addr].v).toBe(value)
        expect(s[addr].f).toBeUndefined()
      }
    },
  )
})

describe('registros no importables', () => {
  /** CC01 exportable (catálogos id 1) y CC09 con catálogos propios (id 9), que cada prueba puede desactivar. */
  function withBad(mutate: (b: Bundle) => void = () => {}): Bundle {
    const b = baseBundle()
    b.companies.push({ id: 9, code: 'MALA', name: 'Empresa mala', is_active: 1 })
    b.species.push({ id: 9, code: 'ESP9', name: 'Especie mala', is_active: 1 })
    b.csg.push({ id: 9, code: 'G9', name: 'CSG9', is_active: 1 })
    b.varieties.push({ id: 9, code: 'V9', name: 'Variedad mala', species_id: 9, is_active: 1 })
    b.relations = [
      rel({ id: 1, center_code: 'CC01', center_name: 'Cuartel 1' }),
      rel({
        id: 9,
        center_code: 'CC09',
        center_name: 'Cuartel 9',
        company_id: 9,
        company_name: 'Empresa mala',
        species_id: 9,
        species_name: 'Especie mala',
        variety_id: 9,
        variety_name: 'Variedad mala',
        csg_id: 9,
        csg_name: 'CSG9',
      }),
    ]
    mutate(b)
    return b
  }

  it('CA-06: CC01 (variedad inactiva) y CC02 (relación inactiva) salen de Maestros y van a "No importables"', () => {
    const b = baseBundle()
    b.varieties.push({ id: 2, code: 'SWEET', name: 'Sweet', species_id: 1, is_active: 1 })
    b.varieties[0].is_active = 0
    b.relations = [
      rel({ id: 1, center_code: 'CC01', center_name: 'Cuartel 1' }),
      rel({ id: 2, center_code: 'CC02', center_name: 'Cuartel 2', is_active: 0, variety_id: 2, variety_name: 'Sweet' }),
    ]
    const r = buildMastersExport(b, 1, NOW)
    expect(r).toEqual({ kind: 'empty', seasonCode: '2025-2026' })
    // con una relación sana el libro existe y trae a las dos en No importables
    b.relations.push(rel({ id: 3, center_code: 'CC03', variety_id: 2, variety_name: 'Sweet' }))
    const ok = okExport(b)
    expect(aoa(ok.workbook, 'Maestros').slice(1).map((x) => x[3])).toEqual(['CC03'])
    const rows = aoa(ok.workbook, 'No importables')
    expect(rows[0]).toEqual([...HEADERS, 'MOTIVO'])
    expect(rows[1]).toEqual(['Agrícola Esmeralda', 'Cereza', 'Lapins', 'CC01', 'CSG001', 'Cuartel 1', 'Variedad inactiva'])
    expect(rows[2]).toEqual(['Agrícola Esmeralda', 'Cereza', 'Sweet', 'CC02', 'CSG001', 'Cuartel 2', 'Relación inactiva'])
    expect(ok.nonImportableCount).toBe(2)
  })

  it('CA-06: sin relaciones no importables la hoja trae solo los encabezados', () => {
    expect(aoa(okExport(baseBundle()).workbook, 'No importables')).toEqual([[...HEADERS, 'MOTIVO']])
  })

  it.each([
    ['Relación inactiva', (b: Bundle) => void (b.relations[1].is_active = 0)],
    ['Empresa inactiva', (b: Bundle) => void (b.companies[1].is_active = 0)],
    ['Especie inactiva', (b: Bundle) => void (b.species[2].is_active = 0)],
    ['Variedad inactiva', (b: Bundle) => void (b.varieties[1].is_active = 0)],
    ['CSG inactivo', (b: Bundle) => void (b.csg[2].is_active = 0)],
  ])('CA-06: MOTIVO "%s"', (motivo, mutate) => {
    const rows = aoa(okExport(withBad(mutate)).workbook, 'No importables')
    expect(rows).toHaveLength(2)
    expect(rows[1][3]).toBe('CC09')
    expect(rows[1][6]).toBe(motivo)
  })

  it('CA-06: varios motivos se unen con ", " en el orden fijo', () => {
    const b = withBad((x) => {
      x.csg[2].is_active = 0
      x.varieties[1].is_active = 0
      x.companies[1].is_active = 0
      x.relations[1].is_active = 0
      x.species[2].is_active = 0
    })
    const rows = aoa(okExport(b).workbook, 'No importables')
    expect(rows[1][6]).toBe(
      'Relación inactiva, Empresa inactiva, Especie inactiva, Variedad inactiva, CSG inactivo',
    )
  })
})

describe('CA-22 variedad de otra especie', () => {
  function incoherent(): Bundle {
    const b = baseBundle()
    b.varieties = [
      { id: 1, code: 'X', name: 'X', species_id: 2, is_active: 1 }, // movida a Arándano
      { id: 2, code: 'LAPINS', name: 'Lapins', species_id: 1, is_active: 1 },
    ]
    b.relations = [
      rel({ id: 1, center_code: 'CC01', variety_id: 1, variety_name: 'X' }), // Cereza + X
      rel({ id: 2, center_code: 'CC02', variety_id: 2, variety_name: 'Lapins' }), // coherente
    ]
    return b
  }

  it('CA-22: no aparece en Maestros y sí en No importables con MOTIVO "Variedad de otra especie"', () => {
    const r = okExport(incoherent())
    expect(aoa(r.workbook, 'Maestros').slice(1).map((x) => x[3])).toEqual(['CC02'])
    const rows = aoa(r.workbook, 'No importables')
    expect(rows).toHaveLength(2)
    expect(rows[1].slice(2, 4)).toEqual(['X', 'CC01'])
    expect(rows[1][6]).toBe('Variedad de otra especie')
  })

  it('CA-22: con la variedad además inactiva el MOTIVO es "Variedad inactiva, Variedad de otra especie"', () => {
    const b = incoherent()
    b.varieties[0].is_active = 0
    const rows = aoa(okExport(b).workbook, 'No importables')
    expect(rows[1][6]).toBe('Variedad inactiva, Variedad de otra especie')
  })

  it('CA-22: nonImportableReasons(bundle, relation) entrega los motivos en orden', () => {
    const b = incoherent()
    expect(nonImportableReasons(b, b.relations[0])).toEqual(['Variedad de otra especie'])
    expect(nonImportableReasons(b, b.relations[1])).toEqual([])
  })
})

describe('hoja Temporada', () => {
  it('P1: CÓDIGO, NOMBRE, ACTUAL, ACTIVA, línea en blanco y nota de reimportación', () => {
    const rows = aoa(okExport(baseBundle(), 1).workbook, 'Temporada')
    expect(rows[0]).toEqual(['CÓDIGO', 'NOMBRE', 'ACTUAL', 'ACTIVA'])
    expect(rows[1]).toEqual(['2025-2026', 'Temporada 2025-2026', 'Sí', 'Sí'])
    expect(rows[2].every((c) => c === '')).toBe(true)
    expect(rows[3][0]).toBe('Para reimportar, use el mismo código y nombre de temporada.')
  })

  it('P1: temporada no actual e inactiva muestra "No"', () => {
    const b = baseBundle()
    b.seasons[1].is_active = 0
    const rows = aoa(okExport(b, 2).workbook, 'Temporada')
    expect(rows[1]).toEqual(['2024-2025', 'Temporada 2024-2025', 'No', 'No'])
  })
})

describe('CA-11 temporada sin relaciones exportables', () => {
  it('CA-11: sin relaciones devuelve { kind: "empty", seasonCode }', () => {
    const b = baseBundle()
    b.relations = []
    expect(buildMastersExport(b, 1, NOW)).toEqual({ kind: 'empty', seasonCode: '2025-2026' })
  })

  it('CA-11: con todas las relaciones no exportables devuelve empty', () => {
    const b = baseBundle()
    b.relations = [rel({ is_active: 0 }), rel({ id: 2, variety_id: 1 })]
    b.varieties[0].is_active = 0
    expect(buildMastersExport(b, 1, NOW)).toEqual({ kind: 'empty', seasonCode: '2025-2026' })
  })

  it('CA-11: una temporada con relaciones solo en otra temporada es empty', () => {
    const b = baseBundle()
    b.relations = [rel({ season_id: 2 })]
    expect(buildMastersExport(b, 1, NOW).kind).toBe('empty')
  })
})

describe('volumen y límite de importación', () => {
  function many(n: number): Bundle {
    const b = baseBundle()
    b.relations = Array.from({ length: n }, (_, i) =>
      rel({ id: i + 1, center_code: `VOL-${String(i + 1).padStart(5, '0')}`, center_name: `Cuartel ${i + 1}` }),
    )
    return b
  }

  it('CA-19: 5000 relaciones activas -> 5001 filas y overImportLimit=false', () => {
    const r = okExport(many(5000))
    expect(r.rowCount).toBe(5000)
    expect(aoa(r.workbook, 'Maestros')).toHaveLength(5001)
    expect(r.overImportLimit).toBe(false)
  })

  it.each([
    [10000, false],
    [10001, true],
  ])('CA-20: %i relaciones -> overImportLimit=%s', (n, over) => {
    const r = okExport(many(n))
    expect(r.rowCount).toBe(n)
    expect(r.overImportLimit).toBe(over)
  })
})

describe('parseMasterRow y parseMasterWorkbook', () => {
  it('CA-04: aplica trim y devuelve las 5 claves en minúscula', () => {
    expect(
      parseMasterRow({ EMPRESA: ' E ', ESPECIE: ' S ', VARIEDAD: ' V ', CC: ' 001 ', CSG: ' 00123 ' }),
    ).toEqual({ empresa: 'E', especie: 'S', variedad: 'V', cc: '001', csg: '00123' })
  })

  it.each([
    ['EMPRESA'],
    ['ESPECIE'],
    ['VARIEDAD'],
    ['CC'],
    ['CSG'],
  ])('descarta la fila si falta %s', (missing) => {
    const row: Record<string, string> = { EMPRESA: 'E', ESPECIE: 'S', VARIEDAD: 'V', CC: 'C', CSG: 'G' }
    row[missing] = '  '
    expect(parseMasterRow(row)).toBeNull()
  })

  it.each([
    ['empresa'], ['Empresa'], ['EMPRESA'],
  ])('acepta el alias de empresa %s', (k) => {
    expect(parseMasterRow({ [k]: 'E', ESPECIE: 'S', VARIEDAD: 'V', CC: 'C', CSG: 'G' })?.empresa).toBe('E')
  })

  it.each([['cc'], ['CC'], ['centro_costo'], ['CentroCosto'], ['centroCosto']])('acepta el alias de CC %s', (k) => {
    expect(parseMasterRow({ EMPRESA: 'E', ESPECIE: 'S', VARIEDAD: 'V', [k]: 'C1', CSG: 'G' })?.cc).toBe('C1')
  })

  it.each([['NOMBRE CC'], ['Nombre CC'], ['nombre cc'], ['NOMBRE_CC'], ['nombre_cc']])(
    'CA-07: acepta el alias de NOMBRE CC %s como ccNombre',
    (k) => {
      const r = parseMasterRow({ EMPRESA: 'E', ESPECIE: 'S', VARIEDAD: 'V', CC: 'C', CSG: 'G', [k]: ' Cuartel 1 ' })
      expect(r?.ccNombre).toBe('Cuartel 1')
    },
  )

  it('P13: sin NOMBRE CC o con celda vacía, la fila no lleva la clave ccNombre', () => {
    const base = { EMPRESA: 'E', ESPECIE: 'S', VARIEDAD: 'V', CC: 'C', CSG: 'G' }
    expect(parseMasterRow(base)).not.toHaveProperty('ccNombre')
    expect(parseMasterRow({ ...base, 'NOMBRE CC': '   ' })).not.toHaveProperty('ccNombre')
  })

  it('CA-07: exportar y parsear devuelve las filas con ccNombre', () => {
    const rows = parseMasterWorkbook(roundTrip(okExport(baseBundle()).workbook))
    expect(rows).toEqual([
      { empresa: 'Agrícola Esmeralda', especie: 'Cereza', variedad: 'Lapins', cc: 'CC01', csg: 'CSG001', ccNombre: 'Cuartel 1' },
      { empresa: 'Agrícola Esmeralda', especie: 'Cereza', variedad: 'Lapins', cc: 'CC02', csg: 'CSG001', ccNombre: 'Cuartel 2' },
    ])
  })

  it('CA-06: un libro exportado (No importables como hoja 2) se lee solo con las filas de Maestros', () => {
    const b = baseBundle()
    b.relations = [rel({ id: 1, center_code: 'OK' }), rel({ id: 2, center_code: 'INACT', is_active: 0 })]
    const rows = parseMasterWorkbook(roundTrip(okExport(b).workbook))
    expect(rows.map((r) => r.cc)).toEqual(['OK'])
  })

  it('compatibilidad: archivo sin NOMBRE CC (5 columnas) se lee sin ccNombre', () => {
    const wb = wbFrom([['Hoja', [['EMPRESA', 'ESPECIE', 'VARIEDAD', 'CC', 'CSG'], ['E', 'S', 'V', '001', '00123']]]])
    const rows = parseMasterWorkbook(wb)
    expect(rows).toEqual([{ empresa: 'E', especie: 'S', variedad: 'V', cc: '001', csg: '00123' }])
  })

  it('descarta en silencio las filas incompletas', () => {
    const wb = wbFrom([['H', [HEADERS, ['E', 'S', 'V', 'C', 'G', ''], ['E', '', 'V', 'C', 'G', '']]]])
    expect(parseMasterWorkbook(wb)).toHaveLength(1)
  })

  const MENSAJE =
    'Este archivo tiene la hoja «No importables» o la columna MOTIVO como primera hoja. Copie las filas que quiera reactivar a la hoja «Maestros», sin la columna MOTIVO, y vuelva a importar.'

  it('MEN-6: rechaza si la primera hoja se llama "No importables"', () => {
    const wb = wbFrom([['No importables', [HEADERS, ['E', 'S', 'V', 'C', 'G', 'N']]]])
    expect(() => parseMasterWorkbook(wb)).toThrow(MENSAJE)
  })

  it('MEN-6: rechaza sin distinguir mayúsculas', () => {
    const wb = wbFrom([['NO IMPORTABLES', [HEADERS, ['E', 'S', 'V', 'C', 'G', 'N']]]])
    expect(() => parseMasterWorkbook(wb)).toThrow(MENSAJE)
  })

  it('MEN-6: rechaza si la fila 1 de la primera hoja trae la columna MOTIVO', () => {
    const wb = wbFrom([['Maestros', [[...HEADERS, 'MOTIVO'], ['E', 'S', 'V', 'C', 'G', 'N', 'Relación inactiva']]]])
    expect(() => parseMasterWorkbook(wb)).toThrow(MENSAJE)
  })

  it('MEN-6: "No importables" como hoja 2 no se rechaza', () => {
    const wb = wbFrom([
      ['Maestros', [HEADERS, ['E', 'S', 'V', 'C', 'G', 'N']]],
      ['No importables', [[...HEADERS, 'MOTIVO']]],
    ])
    expect(parseMasterWorkbook(wb)).toHaveLength(1)
  })
})

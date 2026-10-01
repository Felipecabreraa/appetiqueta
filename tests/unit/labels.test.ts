import { beforeEach, describe, expect, it } from 'vitest'
import { defaultFormValues, isLabelFormComplete } from '../../src/components/labelFormValues'
import { createLabelRecords, MAX_ETIQUETAS_LOTE } from '../../src/lib/createLabelRecords'
import {
  addMovement,
  getLabelById,
  getOperationalPhase,
  saveLabelsBatch,
  totalsForLabel,
  upsertLabel,
} from '../../src/lib/storage'

const completo = () => ({
  ...defaultFormValues(),
  empresa: 'EMP',
  csg: 'CSG1',
  especie: 'Cereza',
  variedad: 'Lapins',
  centroCosto: 'CC01',
  sector: 'S1',
})

beforeEach(() => localStorage.clear())

describe('formulario de etiqueta', () => {
  it('exige todos los campos salvo exportación', () => {
    expect(isLabelFormComplete(defaultFormValues())).toBe(false)
    expect(isLabelFormComplete(completo())).toBe(true)
    expect(isLabelFormComplete({ ...completo(), sector: '  ' })).toBe(false)
  })
})

describe('createLabelRecords', () => {
  it('limita el lote entre 1 y MAX_ETIQUETAS_LOTE', () => {
    expect(createLabelRecords(completo(), 0)).toHaveLength(1)
    expect(createLabelRecords(completo(), 9999)).toHaveLength(MAX_ETIQUETAS_LOTE)
  })

  it('crea etiquetas sin totes ni jefe (se completan en el primer JC)', () => {
    const [r] = createLabelRecords(completo(), 1)
    expect(r!.cantidadTotes).toBeNull()
    expect(r!.jefeCuadrilla).toBe('')
  })
})

describe('storage: unicidad y flujo JC → acopio', () => {
  it('rechaza ids duplicados', () => {
    const [r] = createLabelRecords(completo(), 1)
    saveLabelsBatch([r!])
    expect(() => saveLabelsBatch([r!])).toThrow(/ya existe/)
    expect(() => saveLabelsBatch([{ ...r!, id: 'DUP' }, { ...r!, id: 'dup' }])).toThrow(/duplicado/)
  })

  it('avanza de fase jc → acopio → complete', () => {
    const [r] = createLabelRecords(completo(), 1)
    saveLabelsBatch([r!])
    expect(getOperationalPhase(r!.id)).toBe('jc')
    addMovement({ labelId: r!.id.toLowerCase(), type: 'jc', cantidad: 10, at: new Date().toISOString() })
    expect(getOperationalPhase(r!.id)).toBe('acopio')
    addMovement({ labelId: r!.id, type: 'acopio', cantidad: 9, at: new Date().toISOString() })
    expect(getOperationalPhase(r!.id)).toBe('complete')
    expect(totalsForLabel(r!.id)).toEqual({ jc: 10, acopio: 9 })
  })

  it('una etiqueta con totes desde el servidor ya pasó JC', () => {
    const [r] = createLabelRecords(completo(), 1)
    upsertLabel({ ...r!, cantidadTotes: 5, jefeCuadrilla: 'Juan' })
    expect(getLabelById(r!.id.toLowerCase())?.jefeCuadrilla).toBe('Juan')
    expect(getOperationalPhase(r!.id)).toBe('acopio')
  })

  it('código inexistente → not_found', () => {
    expect(getOperationalPhase('NOEXISTE')).toBe('not_found')
  })
})

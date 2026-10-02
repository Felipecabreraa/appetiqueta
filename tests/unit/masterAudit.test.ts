import { describe, expect, it } from 'vitest'
import { formatAuditDate, formatLastModified } from '../../src/lib/masterAudit'

describe('formatAuditDate (America/Santiago, dd-mm-aaaa)', () => {
  it.each([
    ['CA-21: octubre (UTC-3), 23:30 locales del día anterior', '2026-10-03T02:30:00.000Z', '02-10-2026'],
    ['CA-21: julio (UTC-4), 23:30 locales del día anterior', '2026-07-15T03:30:00.000Z', '14-07-2026'],
    ['CA-21: mediodía UTC no cambia de día', '2026-10-02T15:00:00.000Z', '02-10-2026'],
    ['CA-24: fecha histórica', '2025-03-10T15:00:00.000Z', '10-03-2025'],
  ])('%s', (_n, iso, esperado) => {
    expect(formatAuditDate(iso)).toBe(esperado)
  })

  it.each(['basura', '', 'null'])('CA-24: fecha inválida (%j) devuelve cadena vacía', (v) => {
    expect(formatAuditDate(v)).toBe('')
  })
})

describe('formatLastModified', () => {
  const updatedAt = '2026-10-03T02:30:00.000Z'

  it('CA-21: con autor', () => {
    expect(formatLastModified({ updatedBy: { id: 1, name: 'Ana' }, updatedAt })).toBe(
      'Modificado por Ana el 02-10-2026',
    )
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['nombre solo espacios', { id: 3, name: '  ' }],
    ['nombre vacío', { id: 3, name: '' }],
  ])('CA-24: sin autor (%s)', (_n, updatedBy) => {
    const t = formatLastModified({ updatedBy, updatedAt })
    expect(t).toBe('Modificado el 02-10-2026 · sin autor registrado')
    expect(t).not.toMatch(/null|undefined|Modificado por/)
  })

  it('CA-24: fecha inválida devuelve cadena vacía (no se pinta)', () => {
    expect(formatLastModified({ updatedBy: { id: 1, name: 'Ana' }, updatedAt: 'basura' })).toBe('')
    expect(formatLastModified({ updatedBy: null, updatedAt: '' })).toBe('')
  })
})

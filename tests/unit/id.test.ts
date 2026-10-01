import { describe, expect, it } from 'vitest'
import { createTrackingId, TRACKING_ID_LENGTH } from '../../src/lib/id'

describe('createTrackingId', () => {
  it('genera códigos de 12 caracteres sin O/0/I/1', () => {
    for (let i = 0; i < 500; i++) {
      const id = createTrackingId()
      expect(id).toHaveLength(TRACKING_ID_LENGTH)
      expect(id).toMatch(/^[A-HJ-NP-Z2-9]+$/)
    }
  })

  it('no repite códigos en una muestra grande', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => createTrackingId()))
    expect(ids.size).toBe(5000)
  })
})

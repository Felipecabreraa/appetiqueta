import { describe, expect, it } from 'vitest'
import { buildTrackingUrl } from '../../src/lib/qrPayload'
import { normalizeTrackingCodeFromQrPayload } from '../../src/lib/navigateFromQrScan'

describe('QR: URL y lectura', () => {
  it('buildTrackingUrl incluye ?e= con el código en mayúsculas', () => {
    const url = new URL(buildTrackingUrl(' abc234 '))
    expect(url.searchParams.get('e')).toBe('ABC234')
  })

  it.each([
    ['https://app.cl/?e=abc234', 'ABC234'],
    ['/?e=xyz789', 'XYZ789'],
    ['  qwe234  ', 'QWE234'],
    ['', ''],
  ])('normaliza %j → %j', (input, expected) => {
    expect(normalizeTrackingCodeFromQrPayload(input)).toBe(expected)
  })

  it('ida y vuelta: el código generado se recupera del QR', () => {
    expect(normalizeTrackingCodeFromQrPayload(buildTrackingUrl('HJK789MNP234'))).toBe('HJK789MNP234')
  })
})

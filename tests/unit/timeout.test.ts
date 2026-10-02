import { afterEach, describe, expect, it, vi } from 'vitest'
import { timeoutSignal } from '../../src/lib/timeout'

describe('timeoutSignal', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('R3: funciona en navegadores sin AbortSignal.timeout (iOS < 16)', () => {
    vi.useFakeTimers()
    const original = AbortSignal
    // Simula un navegador antiguo: AbortSignal sin el método estático timeout
    vi.stubGlobal('AbortSignal', Object.assign(function () {}, { prototype: original.prototype }))
    const signal = timeoutSignal(60_000)
    expect(signal.aborted).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(signal.aborted).toBe(true)
  })

  it('usa AbortSignal.timeout cuando existe', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    timeoutSignal(1000)
    expect(spy).toHaveBeenCalledWith(1000)
  })
})

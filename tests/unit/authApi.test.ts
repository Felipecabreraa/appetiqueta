import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login, loginErrorMessage } from '../../src/lib/authApi'
import { getSessionToken } from '../../src/lib/session'

const T401 = 'Usuario o contraseña incorrectos.'
const T5XX = 'El servidor tuvo un problema. Intente más tarde.'
const TNET = 'Sin conexión con el servidor.'
const T429 = 'Demasiados intentos de ingreso. Espere un minuto y vuelva a intentar.'
const T4XX = 'No fue posible iniciar sesión.'

function mockFetch(status: number, body: unknown = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => localStorage.clear())

describe('loginErrorMessage', () => {
  it.each<[number | 'network', string]>([
    [401, T401],
    [429, T429],
    [500, T5XX],
    [502, T5XX],
    [503, T5XX],
    [599, T5XX],
    ['network', TNET],
    [400, T4XX],
    [403, T4XX],
    [404, T4XX],
    [418, T4XX],
  ])('CA-11..14: %s -> texto fijo', (kind, text) => {
    expect(loginErrorMessage(kind)).toBe(text)
  })
})

describe('login()', () => {
  it('CA-11: 401 -> "Usuario o contraseña incorrectos." y no guarda sesión', async () => {
    mockFetch(401, { ok: false, error: 'invalid_credentials' })
    const r = await login('operador1', 'mala')
    expect(r).toEqual({ ok: false, message: T401 })
    expect(getSessionToken()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it.each([
    [500, { ok: false, error: 'db' }],
    [502, {}],
    [503, { ok: false, error: 'db_not_configured' }],
    [503, { ok: false, error: 'db_unavailable' }],
  ])('CA-12: %s (%j) -> texto de servidor, sin "Credenciales" ni "contraseña"', async (status, body) => {
    mockFetch(status, body)
    const r = await login('operador1', 'x')
    expect(r).toEqual({ ok: false, message: T5XX })
    expect(r.ok === false && r.message).not.toMatch(/credenciales|contraseña/i)
    expect(getSessionToken()).toBeNull()
  })

  it('CA-12: una respuesta 502 con cuerpo no JSON también es error de servidor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    expect(await login('a', 'b')).toEqual({ ok: false, message: T5XX })
  })

  it.each([400, 403, 404])('CA-12: %s -> "No fue posible iniciar sesión." (P4)', async (status) => {
    mockFetch(status, { ok: false, error: 'credentials_required' })
    expect(await login('a', 'b')).toEqual({ ok: false, message: T4XX })
  })

  it('CA-13: fetch rechazado -> "Sin conexión con el servidor." sin el mensaje técnico', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const r = await login('a', 'b')
    expect(r).toEqual({ ok: false, message: TNET })
    expect(JSON.stringify(r)).not.toContain('Failed to fetch')
    expect(getSessionToken()).toBeNull()
  })

  it('CA-13: cualquier rechazo del fetch (no solo TypeError) se muestra como falta de conexión', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NetworkError when attempting to fetch resource.'))
    expect(await login('a', 'b')).toEqual({ ok: false, message: TNET })
  })

  it('CA-11: si guardar la sesión falla tras un 200 válido (storage bloqueado) -> "No fue posible iniciar sesión." y no "Sin conexión"', async () => {
    mockFetch(200, { ok: true, token: 'tok', user: { id: 1, username: 'op', fullName: 'Op', role: 'operador' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError')
    })
    expect(await login('a', 'b')).toEqual({ ok: false, message: T4XX })
  })

  it('CA-14: 429 -> texto de demasiados intentos', async () => {
    mockFetch(429, { ok: false, error: 'rate_limited' })
    expect(await login('a', 'b')).toEqual({ ok: false, message: T429 })
  })

  it('CA-11: un 200 sin token ni usuario sigue dando "No fue posible iniciar sesión." (regresión)', async () => {
    mockFetch(200, { ok: true })
    expect(await login('a', 'b')).toEqual({ ok: false, message: T4XX })
    expect(getSessionToken()).toBeNull()
  })

  it('CA-11: un 200 válido guarda la sesión (regresión)', async () => {
    mockFetch(200, { ok: true, token: 'tok', user: { id: 1, username: 'op', fullName: 'Op', role: 'operador' } })
    const r = await login('op', 'ok')
    expect(r.ok).toBe(true)
    expect(getSessionToken()).toBe('tok')
  })
})

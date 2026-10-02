import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJcForemen, fetchMasterAdminData, upsertSeason } from '../../src/lib/masterDataApi'

const TEXTO =
  'Problema del servidor o de la base de datos al cargar o guardar Maestros. Intente de nuevo en unos segundos; si continúa, avise al administrador.'

function mockFetch(status: number, body: unknown = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  )
}

beforeEach(() => localStorage.clear())

describe('describeApiError vía las llamadas de Maestros (/api/admin/*)', () => {
  it.each([
    [500, { ok: false, error: 'db' }],
    [503, { ok: false, error: 'db_unavailable' }],
    [503, { ok: false, error: 'db_not_configured' }],
    [502, {}],
    [500, '<html>error</html>'],
  ])('CA-16: fetchMasterAdminData con %s (%j) lanza el texto en español', async (status, body) => {
    mockFetch(status, body)
    await expect(fetchMasterAdminData()).rejects.toThrow(TEXTO)
  })

  it('CA-16: el mensaje no es el código crudo "db"', async () => {
    mockFetch(500, { ok: false, error: 'db' })
    const e = await fetchMasterAdminData().catch((x: Error) => x)
    expect((e as Error).message).not.toBe('db')
  })

  it('CA-16: las escrituras también traducen el 5xx (upsertSeason)', async () => {
    mockFetch(500, { ok: false, error: 'db' })
    await expect(upsertSeason({ code: 'T1', name: 'Temporada' })).rejects.toThrow(TEXTO)
  })

  it('CA-16: forbidden sigue igual', async () => {
    mockFetch(403, { ok: false, error: 'forbidden' })
    await expect(fetchMasterAdminData()).rejects.toThrow('No tiene permisos para esta acción.')
  })

  it('CA-16: invalid_payload sigue igual', async () => {
    mockFetch(400, { ok: false, error: 'invalid_payload' })
    await expect(upsertSeason({ code: '', name: '' })).rejects.toThrow(
      'Datos inválidos: revise código, nombre y fechas (AAAA-MM-DD).',
    )
  })

  it('CA-16: un 4xx con otro código conserva el código (sin cambios)', async () => {
    mockFetch(404, { ok: false, error: 'no_encontrado' })
    await expect(fetchMasterAdminData()).rejects.toThrow('no_encontrado')
  })

  it('CA-16: un 200 devuelve los datos', async () => {
    mockFetch(200, { ok: true, seasons: [], companies: [] })
    await expect(fetchMasterAdminData()).resolves.toMatchObject({ seasons: [] })
  })
})

describe('fetchJcForemen (vista operativa, fuera de alcance)', () => {
  it('CA-16: con 500 {error:"db"} conserva su comportamiento actual (código crudo)', async () => {
    mockFetch(500, { ok: false, error: 'db' })
    await expect(fetchJcForemen()).rejects.toThrow(/^db$/)
  })

  it('CA-16: con 500 sin código conserva "HTTP 500"', async () => {
    mockFetch(500, {})
    await expect(fetchJcForemen()).rejects.toThrow('HTTP 500')
  })

  it('CA-16: con 200 devuelve la lista', async () => {
    mockFetch(200, { ok: true, foremen: [{ id: 1, code: 'A', name: 'Jefe' }] })
    await expect(fetchJcForemen()).resolves.toHaveLength(1)
  })
})

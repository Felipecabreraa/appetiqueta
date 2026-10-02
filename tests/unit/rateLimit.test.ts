import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createRateLimiter } = require('../../server/rateLimit.cjs') as {
  createRateLimiter: (o: {
    windowMs: number
    max: number
    now?: () => number
    countIf?: (res: { statusCode: number }) => boolean
  }) => (req: { ip?: string }, res: FakeRes, next: () => void) => void
}

type FakeRes = {
  statusCode: number
  status: (n: number) => { json: (b: unknown) => void }
  set: (k: string, v: string) => void
  on: (ev: string, cb: () => void) => void
}

function fakeRes(statusCode = 200) {
  const r = { code: 200, body: undefined as unknown, headers: {} as Record<string, string> }
  const listeners: Array<() => void> = []
  return {
    r,
    finish: () => listeners.forEach((cb) => cb()),
    res: {
      statusCode,
      on(ev: string, cb: () => void) {
        if (ev === 'finish') listeners.push(cb)
      },
      status(n: number) {
        r.code = n
        return { json: (b: unknown) => void (r.body = b) }
      },
      set(k: string, v: string) {
        r.headers[k] = v
      },
    },
  }
}

describe('rate limiter', () => {
  it('CA-01: bloquea con 429 al superar el máximo por IP y se libera al pasar la ventana', () => {
    let t = 0
    const mw = createRateLimiter({ windowMs: 60_000, max: 3, now: () => t })
    let passed = 0
    for (let i = 0; i < 3; i++) mw({ ip: '1.1.1.1' }, fakeRes().res, () => passed++)
    const blocked = fakeRes()
    mw({ ip: '1.1.1.1' }, blocked.res, () => passed++)
    expect(passed).toBe(3)
    expect(blocked.r.code).toBe(429)
    expect(blocked.r.body).toEqual({ ok: false, error: 'rate_limited' })
    expect(Number(blocked.r.headers['Retry-After'])).toBeGreaterThan(0)
    // Otra IP no se ve afectada
    mw({ ip: '2.2.2.2' }, fakeRes().res, () => passed++)
    expect(passed).toBe(4)
    // Nueva ventana
    t = 60_001
    mw({ ip: '1.1.1.1' }, fakeRes().res, () => passed++)
    expect(passed).toBe(5)
  })

  it('CA-02: con countIf solo cuentan los intentos fallidos (login)', () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 2, countIf: (res) => res.statusCode === 401 })
    let passed = 0
    // 20 logins exitosos desde la misma IP (inicio de turno) no bloquean
    for (let i = 0; i < 20; i++) {
      const f = fakeRes(200)
      mw({ ip: '3.3.3.3' }, f.res, () => passed++)
      f.finish()
    }
    expect(passed).toBe(20)
    // 2 fallidos se permiten; el tercer intento se bloquea
    for (let i = 0; i < 2; i++) {
      const f = fakeRes(401)
      mw({ ip: '3.3.3.3' }, f.res, () => passed++)
      f.finish()
    }
    const blocked = fakeRes(200)
    mw({ ip: '3.3.3.3' }, blocked.res, () => passed++)
    expect(passed).toBe(22)
    expect(blocked.r.code).toBe(429)
  })

  it('max <= 0 desactiva el límite', () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 0 })
    let passed = 0
    for (let i = 0; i < 1000; i++) mw({ ip: '1.1.1.1' }, fakeRes().res, () => passed++)
    expect(passed).toBe(1000)
  })
})

describe('servidor real: límites, proxy y CORS', () => {
  const PORT = 3911
  const base = `http://127.0.0.1:${PORT}`
  let srv: ChildProcess

  beforeAll(async () => {
    srv = spawn(process.execPath, ['server/index.cjs'], {
      env: {
        ...process.env,
        // Sin BD real: los límites y CORS actúan antes de tocar la base.
        MYSQL_HOST: 'guardian.invalid',
        MYSQL_USER: 'x',
        MYSQL_PASSWORD: 'x',
        MYSQL_DATABASE: 'x',
        APP_ENV: '',
        PORT: String(PORT),
        RATE_LIMIT_MOVEMENTS_PER_MIN: '3',
        RATE_LIMIT_LOGIN_PER_MIN: '2',
        RATE_LIMIT_LABELS_PER_MIN: '2',
        CORS_ORIGINS: 'https://permitido.example',
      },
      stdio: 'ignore',
    })
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return
      } catch {
        /* arrancando */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('servidor no arrancó')
  }, 30_000)

  afterAll(() => {
    srv?.kill()
  })

  const post = (path: string, ip: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: '{}',
    })

  it('CA-01/CA-05: movimientos limitados por IP real (X-Forwarded-For del proxy)', async () => {
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await post('/api/movements', '10.0.0.1')).status)
    expect(codes.slice(0, 3)).not.toContain(429)
    expect(codes[3]).toBe(429)
    // Otra IP detrás del mismo proxy no queda bloqueada
    expect((await post('/api/movements', '10.0.0.2')).status).not.toBe(429)
  })

  it('CA-02: login limitado (sin BD responde 503, que no cuenta como fallo de credenciales)', async () => {
    const codes = []
    for (let i = 0; i < 3; i++) codes.push((await post('/api/auth/login', '10.0.1.1')).status)
    expect(codes).not.toContain(429)
  })

  it('CA-03: consulta de etiqueta limitada', async () => {
    const codes = []
    for (let i = 0; i < 3; i++) {
      codes.push((await fetch(`${base}/api/labels/ABCD2345EFGH`, { headers: { 'x-forwarded-for': '10.0.2.1' } })).status)
    }
    expect(codes[2]).toBe(429)
  })

  it('CA-06: CORS solo para orígenes configurados', async () => {
    const ajeno = await fetch(`${base}/api/health`, { headers: { origin: 'https://malicioso.example' } })
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull()
    const ok = await fetch(`${base}/api/health`, { headers: { origin: 'https://permitido.example' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://permitido.example')
  })
})

/**
 * Límite de peticiones por IP en ventana fija (en memoria, por instancia).
 * Suficiente para una instancia de Render; protege endpoints públicos de terreno y el login.
 *
 * Con `countIf(res)` solo se cuentan las respuestas que cumplen la condición (p. ej. login fallido),
 * evaluadas al terminar la respuesta; el bloqueo se aplica al siguiente intento.
 */
function createRateLimiter({ windowMs, max, now = Date.now, countIf }) {
  if (!Number.isFinite(max) || max <= 0) {
    return (_req, _res, next) => next()
  }
  const hits = new Map()
  let lastSweep = now()

  function entryFor(key, t) {
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(key, entry)
    }
    return entry
  }

  return function rateLimit(req, res, next) {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key)
      lastSweep = t
    }
    const key = req.ip || 'desconocida'
    const entry = entryFor(key, t)

    const block = () => {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))))
      return res.status(429).json({ ok: false, error: 'rate_limited' })
    }

    if (countIf) {
      if (entry.count >= max) return block()
      res.on('finish', () => {
        if (countIf(res)) entryFor(key, now()).count += 1
      })
      return next()
    }

    entry.count += 1
    if (entry.count > max) return block()
    next()
  }
}

function limitFromEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

module.exports = { createRateLimiter, limitFromEnv }

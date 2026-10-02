/**
 * Límite de peticiones por IP en ventana fija (en memoria, por instancia).
 * Suficiente para una instancia de Render; protege endpoints públicos de terreno y el login.
 */
function createRateLimiter({ windowMs, max, now = Date.now }) {
  if (!Number.isFinite(max) || max <= 0) {
    return (_req, _res, next) => next()
  }
  const hits = new Map()
  let lastSweep = now()

  return function rateLimit(req, res, next) {
    const t = now()
    if (t - lastSweep > windowMs) {
      for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key)
      lastSweep = t
    }
    const key = req.ip || 'desconocida'
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))))
      return res.status(429).json({ ok: false, error: 'rate_limited' })
    }
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

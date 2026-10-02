/**
 * Límite de peticiones por IP en ventana fija (en memoria, por instancia).
 * Suficiente para una instancia de Render; protege endpoints públicos de terreno y el login.
 *
 * Con `countIf(res)` solo quedan contadas las respuestas que cumplen la condición (p. ej. login fallido);
 * mientras una petición está en curso cuenta como intento, para que una ráfaga paralela no pase.
 */
/**
 * IP real del cliente. Render recibe el tráfico a través de Cloudflare: req.ip (con trust proxy) es la IP
 * del borde de Cloudflare, compartida por muchos usuarios. Cloudflare escribe CF-Connecting-IP con la IP
 * del cliente y sobrescribe cualquier valor que este envíe, así que no se puede falsificar a través del proxy.
 */
function clientIpOf(req) {
  const cf = typeof req.get === 'function' ? String(req.get('cf-connecting-ip') || '').trim() : ''
  return cf || req.ip || 'desconocida'
}

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
    const key = clientIpOf(req)
    const entry = entryFor(key, t)

    const block = () => {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - t) / 1000))))
      return res.status(429).json({ ok: false, error: 'rate_limited' })
    }

    // Se cuenta al entrar (una ráfaga en paralelo no puede saltarse el límite) y, con countIf,
    // se descuenta al terminar si la respuesta no debía contar (p. ej. login exitoso).
    entry.count += 1
    if (entry.count > max) {
      entry.count -= 1
      return block()
    }
    if (countIf) {
      const counted = entry
      res.on('finish', () => {
        if (!countIf(res) && counted.count > 0) counted.count -= 1
      })
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

module.exports = { createRateLimiter, limitFromEnv, clientIpOf }

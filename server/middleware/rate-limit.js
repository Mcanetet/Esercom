/**
 * Rate limit en memoria (por IP + clave). Suficiente para un solo proceso Node/Passenger.
 */
function createRateLimiter({ windowMs = 60_000, max = 10, message = 'Demasiados intentos. Espera un momento.' } = {}) {
  const hits = new Map();

  function prune(now) {
    if (hits.size < 500) return;
    for (const [k, v] of hits) {
      if (now - v.start > windowMs) hits.delete(k);
    }
  }

  return function rateLimit(req, res, next) {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
      .split(',')[0]
      .trim();
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    prune(now);
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      return res.status(429).json({ success: false, message });
    }
    next();
  };
}

module.exports = { createRateLimiter };

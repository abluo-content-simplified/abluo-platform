// ── Connections — OAuth endpoint rate limit (ours, first layer) ───────────────
//
// Fixed window per key (client id and IP), in memory per server instance.
// On serverless this is best-effort (instances do not share memory); it stops
// a single client hammering one instance. The durable layer is a Vercel
// Firewall rate-limit rule on /api/oauth/* (see the responsibilities doc).

export const OAUTH_LIMIT_PER_MINUTE = 30

export function createRateLimiter(limit = OAUTH_LIMIT_PER_MINUTE, windowMs = 60_000) {
  const hits = new Map<string, { start: number; count: number }>()
  return {
    /** True when this hit is over the limit. */
    hit(key: string, now = Date.now()): boolean {
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k)
      const h = hits.get(key)
      if (!h || now - h.start >= windowMs) {
        hits.set(key, { start: now, count: 1 })
        return false
      }
      h.count++
      return h.count > limit
    },
  }
}

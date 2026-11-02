/**
 * Where Stripe may send the client back to (Checkout success/cancel, Portal
 * return). Built from the request's host, so it is checked against Abluo's own
 * hosts: https abluo.app / *.abluo.app, this Vercel deployment's own URLs, and
 * http localhost in development. Anything else → null (the action refuses).
 * Same rule as invitation links (`invitationOrigin`), without a fallback.
 */
export function trustedReturnOrigin(origin: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!origin) return null
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return null
  }
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null
  const host = u.hostname.toLowerCase()
  if (u.protocol === 'http:') return host === 'localhost' || host === '127.0.0.1' ? u.origin : null
  if (u.protocol !== 'https:' || u.port) return null
  if (host === 'abluo.app' || host.endsWith('.abluo.app')) return u.origin
  const own = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => h!.toLowerCase())
  return own.includes(host) ? u.origin : null
}

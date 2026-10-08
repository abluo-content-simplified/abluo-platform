// Server-only: reads the service-account private key from the environment.
import { createSign } from 'node:crypto'

/**
 * Google service-account auth for the analytics snapshot job (ADR-029 §3.4).
 *
 * One Abluo service account, configured in ENV VARS ONLY — never Sanity:
 *   GOOGLE_ANALYTICS_SA_EMAIL        the account's email (…@….iam.gserviceaccount.com)
 *   GOOGLE_ANALYTICS_SA_PRIVATE_KEY  its PEM private key ("-----BEGIN PRIVATE KEY-----…");
 *                                    literal "\n" sequences are accepted (Vercel UI paste)
 *
 * OAuth 2.0 JWT-bearer flow without a Google SDK: sign an RS256 JWT with Node
 * `crypto`, exchange it at oauth2.googleapis.com/token for a 1-hour access
 * token, and keep the token in memory until a minute before it expires.
 */

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ANALYTICS_SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
] as const

export type ServiceAccount = { email: string; privateKey: string }
type Env = Record<string, string | undefined>
type FetchFn = typeof fetch

/** Thrown when the service account is not configured; the job records it as an error row. */
export class AnalyticsConfigError extends Error {}

/** The service account from the environment, or null when either variable is missing. */
export function readServiceAccount(env: Env = process.env): ServiceAccount | null {
  const email = env.GOOGLE_ANALYTICS_SA_EMAIL?.trim()
  const raw = env.GOOGLE_ANALYTICS_SA_PRIVATE_KEY
  if (!email || !raw) return null
  const privateKey = raw.replace(/\\n/g, '\n').trim()
  return { email, privateKey }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** RS256-signed JWT for the token exchange. Pure (given `nowSec`). */
export function signServiceAccountJwt(sa: ServiceAccount, scopes: readonly string[], nowSec: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({ iss: sa.email, scope: scopes.join(' '), aud: GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  )
  const input = `${header}.${claims}`
  const signature = createSign('RSA-SHA256').update(input).sign(sa.privateKey)
  return `${input}.${base64url(signature)}`
}

let cached: { token: string; expiresAt: number; email: string } | null = null

/** Test seam: forget the in-memory token. */
export function resetGoogleTokenCache(): void {
  cached = null
}

/**
 * An access token for the analytics scopes. Cached in memory (per server
 * instance) until 60 s before it expires. Throws AnalyticsConfigError when the
 * service account is not configured, Error on a refused exchange.
 */
export async function getGoogleAccessToken(
  deps: { env?: Env; fetch?: FetchFn; now?: () => number } = {},
): Promise<string> {
  const sa = readServiceAccount(deps.env)
  if (!sa) throw new AnalyticsConfigError('Google service account not configured (GOOGLE_ANALYTICS_SA_EMAIL / GOOGLE_ANALYTICS_SA_PRIVATE_KEY)')
  const now = (deps.now ?? Date.now)()
  if (cached && cached.email === sa.email && cached.expiresAt - 60_000 > now) return cached.token

  let assertion: string
  try {
    assertion = signServiceAccountJwt(sa, GOOGLE_ANALYTICS_SCOPES, Math.floor(now / 1000))
  } catch (e) {
    throw new AnalyticsConfigError(`Google service account key could not sign: ${e instanceof Error ? e.message : String(e)}`)
  }
  const res = await (deps.fetch ?? fetch)(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`Google token exchange failed (${res.status}): ${json.error_description ?? json.error ?? 'no access token'}`)
  }
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000, email: sa.email }
  return json.access_token
}

/** Google API error body → one readable line. */
export async function googleErrorMessage(res: Response, api: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null
  const detail = body?.error?.message ?? res.statusText ?? 'request failed'
  return `${api} ${res.status}${body?.error?.status ? ` ${body.error.status}` : ''}: ${detail}`
}

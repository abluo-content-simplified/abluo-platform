// Server-only: carries the service account's access token.
import { AnalyticsConfigError, getGoogleAccessToken, GOOGLE_SETUP_SCOPES, readServiceAccount } from '@/lib/analytics/google-auth'
import { GoogleApiError, GoogleSetupError } from './errors'

type Env = Record<string, string | undefined>

/** Injected collaborators shared by the setup modules (all optional; tests pass fakes). */
export type GoogleDeps = {
  env?: Env
  fetch?: typeof fetch
  /** An access token with GOOGLE_SETUP_SCOPES. */
  getToken?: () => Promise<string>
}

/** The service account's email, or `not_configured`. */
export function serviceAccountEmail(env: Env = process.env): string {
  const sa = readServiceAccount(env)
  if (!sa) throw new GoogleSetupError('not_configured', 'Google service account not configured (GOOGLE_ANALYTICS_SA_EMAIL / GOOGLE_ANALYTICS_SA_PRIVATE_KEY)')
  return sa.email
}

/** A token for the setup scopes; a missing/unusable key becomes `not_configured`. */
export async function setupToken(deps: GoogleDeps): Promise<string> {
  try {
    return await (deps.getToken ?? (() => getGoogleAccessToken({ env: deps.env, fetch: deps.fetch, scopes: GOOGLE_SETUP_SCOPES })))()
  } catch (e) {
    if (e instanceof AnalyticsConfigError) throw new GoogleSetupError('not_configured', e.message)
    throw new GoogleSetupError('google_error', e instanceof Error ? e.message : String(e))
  }
}

/**
 * One authorised JSON call to a Google API. 2xx → the parsed body (or `{}`
 * for an empty one); anything else → GoogleApiError with Google's message.
 */
export async function googleRequest<T = Record<string, unknown>>(
  deps: GoogleDeps,
  token: string,
  api: string,
  url: string,
  init: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {},
): Promise<T> {
  const res = await (deps.fetch ?? fetch)(url, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
  })
  const text = await res.text().catch(() => '')
  let json: unknown = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; status?: string } }).error
    throw new GoogleApiError(api, res.status, err?.status ?? null, err?.message ?? (res.statusText || 'request failed'))
  }
  return json as T
}

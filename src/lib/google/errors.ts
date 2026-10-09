/**
 * "Connect Google" outcomes (docs/engineering/analytics-setup.md → Automatic setup).
 *
 * Every setup step either finishes, stops at `waiting_for_site` (the site is
 * not serving the verification tag yet — safe to retry later), or stops with
 * an `error`. `code` picks the admin's sentence (dictionary
 * `admin.projectPage.google.codes.*`, interpolated with `params`); `message`
 * is the technical line (Google's own wording where there is one) shown under
 * it and written to the audit log.
 */

export type GoogleSetupCode =
  /** GOOGLE_ANALYTICS_SA_EMAIL / GOOGLE_ANALYTICS_SA_PRIVATE_KEY missing or unusable. */
  | 'not_configured'
  /** GOOGLE_ANALYTICS_ACCOUNT_ID missing (needed to create or find a GA4 property). */
  | 'account_not_configured'
  /** The project has no custom domain yet. */
  | 'no_domain'
  /** The domain did not answer at all. */
  | 'site_unreachable'
  /** The live homepage does not carry the verification meta tag (yet). */
  | 'tag_not_live'
  /** Google fetched the site and did not find the tag. */
  | 'verification_failed'
  /** GA Admin API 403: the service account is not an Editor on the account. */
  | 'analytics_permission'
  /** A Google API is not enabled in the service account's Cloud project. */
  | 'api_disabled'
  /** Any other 403. */
  | 'permission_denied'
  /** The project / siteConfig document is missing in Sanity (or there are several). */
  | 'sanity_missing'
  /** Anything else Google refused. */
  | 'google_error'

export type GoogleSetupParams = Record<string, string>

export class GoogleSetupError extends Error {
  constructor(
    readonly code: GoogleSetupCode,
    message: string,
    readonly params: GoogleSetupParams = {},
  ) {
    super(message)
    this.name = 'GoogleSetupError'
  }
}

/** Raised by `googleRequest` for any non-2xx answer; mapped to a GoogleSetupError by the caller. */
export class GoogleApiError extends Error {
  constructor(
    readonly api: string,
    readonly status: number,
    readonly googleStatus: string | null,
    readonly detail: string,
  ) {
    super(`${api} ${status}${googleStatus ? ` ${googleStatus}` : ''}: ${detail}`)
    this.name = 'GoogleApiError'
  }
}

/** Pure: an API that is switched off in Google Cloud answers 403 with this wording. */
export function isApiDisabled(e: GoogleApiError): boolean {
  return e.status === 403 && (e.googleStatus === 'SERVICE_DISABLED' || /has not been used in project|is disabled|it is disabled/i.test(e.detail))
}

/**
 * Pure: a GoogleApiError → the admin-facing error. `onForbidden` lets each
 * API say what a 403 means for it (e.g. GA: "give the SA Editor access").
 */
export function setupErrorFrom(e: unknown, onForbidden?: (e: GoogleApiError) => GoogleSetupError): GoogleSetupError {
  if (e instanceof GoogleSetupError) return e
  if (e instanceof GoogleApiError) {
    if (isApiDisabled(e)) return new GoogleSetupError('api_disabled', e.message, { api: e.api })
    if (e.status === 403) return onForbidden ? onForbidden(e) : new GoogleSetupError('permission_denied', e.message, { api: e.api })
    return new GoogleSetupError('google_error', e.message, { api: e.api })
  }
  return new GoogleSetupError('google_error', e instanceof Error ? e.message : String(e))
}

export type SetupState = 'connected' | 'waiting_for_site' | 'error'

/** What one setup run reports (Search Console or Analytics). */
export type SetupOutcome<V extends Record<string, string> = Record<string, string>> =
  | { state: 'connected'; values: V; /** What this run changed; empty on a no-op re-run. */ changed: string[] }
  | { state: 'waiting_for_site' | 'error'; code: GoogleSetupCode; message: string; params: GoogleSetupParams; changed: string[] }

/** Pure: the outcome for a stopped run. `tag_not_live` / `site_unreachable` / `verification_failed` / `no_domain` wait for the site. */
export function stoppedOutcome(e: GoogleSetupError, changed: string[]): SetupOutcome<never> {
  const waiting = e.code === 'tag_not_live' || e.code === 'site_unreachable' || e.code === 'verification_failed' || e.code === 'no_domain'
  return { state: waiting ? 'waiting_for_site' : 'error', code: e.code, message: e.message, params: e.params, changed }
}

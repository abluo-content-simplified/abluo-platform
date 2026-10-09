// Server-only: calls Google with the Abluo service account and writes Sanity.
import { GoogleApiError, GoogleSetupError, isApiDisabled, setupErrorFrom, stoppedOutcome, type SetupOutcome } from './errors'
import { googleRequest, serviceAccountEmail, setupToken, type GoogleDeps } from './http'
import { loadGoogleSanityState, SanityStateError, writeIntegration, writeSiteVerification, type SanityPort } from './sanity-config'
import { resolveCanonicalSiteUrl } from './site-url'

/**
 * "Connect Search Console" for one project whose site Abluo serves on its
 * custom domain (docs/engineering/analytics-setup.md → Automatic setup):
 *
 *   1. canonical URL-prefix property (https + served host + "/")
 *   2. Site Verification API → META token
 *   3. token → siteConfig.googleSiteVerification (Sanity, published + open draft)
 *   4. poll the live homepage until the meta tag carries that token
 *      (else stop: `waiting_for_site` — retry later is safe)
 *   5. verify → the service account becomes a verified owner;
 *      add the human owners from GOOGLE_SEARCH_CONSOLE_OWNERS (SA kept)
 *   6. Search Console API: add the site
 *   7. google-search-console integration → enabled, values.siteUrl
 *
 * Idempotent: every step checks first. A re-run on a verified site re-asserts
 * the token in Sanity (Google re-checks it periodically), skips the poll and
 * the verify, and only adds what is missing.
 */

export const SITE_VERIFICATION_BASE = 'https://www.googleapis.com/siteVerification/v1'
export const WEBMASTERS_BASE = 'https://www.googleapis.com/webmasters/v3'

/** Defaults for the homepage poll: up to ~90 s, every 7.5 s. */
export const POLL_TIMEOUT_MS = 90_000
export const POLL_INTERVAL_MS = 7_500

type Env = Record<string, string | undefined>

export type SearchConsoleDeps = GoogleDeps & {
  sanity: SanityPort
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  pollTimeoutMs?: number
  pollIntervalMs?: number
}

export type SearchConsoleValues = { siteUrl: string }

/** Pure: the human owners from GOOGLE_SEARCH_CONSOLE_OWNERS (comma/space separated, lower-cased, de-duplicated). */
export function ownersFromEnv(env: Env = process.env): string[] {
  return [
    ...new Set(
      (env.GOOGLE_SEARCH_CONSOLE_OWNERS ?? '')
        .split(/[,\s;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)),
    ),
  ]
}

/** Pure: the Site Verification API returns the whole tag for META — keep only its content. */
export function metaTokenContent(token: string): string {
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(token)
  return (m ? m[1] : token).trim()
}

/** Pure: does this HTML carry <meta name="google-site-verification" content="<content>">? */
export function pageHasVerificationMeta(html: string, content: string): boolean {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    const value = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (name?.toLowerCase() === 'google-site-verification' && value === content) return true
  }
  return false
}

/** Polls the homepage until the tag is live. True when found within the timeout. */
export async function waitForVerificationMeta(siteUrl: string, content: string, deps: SearchConsoleDeps): Promise<boolean> {
  const f = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeout = deps.pollTimeoutMs ?? POLL_TIMEOUT_MS
  const interval = deps.pollIntervalMs ?? POLL_INTERVAL_MS
  const deadline = now() + timeout
  for (;;) {
    try {
      // A throwaway query string so an edge cache does not answer with the page from before the write.
      const res = await f(`${siteUrl}?abluo-verify=${now()}`, { method: 'GET', redirect: 'follow', cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
      if (res.ok && pageHasVerificationMeta(await res.text(), content)) return true
    } catch {
      // not reachable (yet) — keep polling until the deadline
    }
    if (now() + interval > deadline) return false
    await sleep(interval)
  }
}

type WebResource = { id?: string; site?: { type?: string; identifier?: string }; owners?: string[] }

/** Pure: the webResource id the API uses for a URL-prefix site. */
export function webResourceId(siteUrl: string): string {
  return encodeURIComponent(siteUrl)
}

export async function connectSearchConsole(
  project: { slug: string; customDomain: string | null },
  deps: SearchConsoleDeps,
): Promise<SetupOutcome<SearchConsoleValues>> {
  const changed: string[] = []
  try {
    const saEmail = serviceAccountEmail(deps.env)
    const siteUrl = await resolveCanonicalSiteUrl(project.customDomain, deps)
    const token = await setupToken(deps)
    const site = { type: 'SITE', identifier: siteUrl }
    const call = <T>(api: string, url: string, init?: Parameters<typeof googleRequest>[4]) => googleRequest<T>(deps, token, api, url, init)

    let state
    try {
      state = await loadGoogleSanityState(deps.sanity, project.slug)
    } catch (e) {
      if (e instanceof SanityStateError) throw new GoogleSetupError('sanity_missing', e.message)
      throw e
    }

    // 2–3. The token, kept in Sanity whether or not the site is verified already.
    const tokenRes = await call<{ token?: string }>('Site Verification', `${SITE_VERIFICATION_BASE}/token`, {
      method: 'POST',
      body: { site, verificationMethod: 'META' },
    })
    const content = metaTokenContent(tokenRes.token ?? '')
    if (!content) throw new GoogleSetupError('google_error', 'Site Verification returned no META token.')
    if (await writeSiteVerification(deps.sanity, state, content)) changed.push('sanity.googleSiteVerification')

    // Already verified? (Owners can read their resource; anyone else gets 403/404.)
    let resource: WebResource | null = null
    try {
      resource = await call<WebResource>('Site Verification', `${SITE_VERIFICATION_BASE}/webResource/${webResourceId(siteUrl)}`)
    } catch (e) {
      if (!(e instanceof GoogleApiError) || (e.status !== 403 && e.status !== 404) || isApiDisabled(e)) throw e
    }

    if (!resource) {
      // 4. Wait for the site to serve the tag.
      if (!(await waitForVerificationMeta(siteUrl, content, deps))) {
        throw new GoogleSetupError(
          'tag_not_live',
          `${siteUrl} does not show the verification tag yet. Is the site served by Abluo on this domain? Try again in a few minutes.`,
          { url: siteUrl },
        )
      }
      // 5. Verify.
      try {
        resource = await call<WebResource>('Site Verification', `${SITE_VERIFICATION_BASE}/webResource?verificationMethod=META`, {
          method: 'POST',
          body: { site },
        })
      } catch (e) {
        if (e instanceof GoogleApiError && e.status === 400) throw new GoogleSetupError('verification_failed', e.message, { url: siteUrl })
        throw e
      }
      changed.push('google.verified')
    }

    // 5b. Human owners (the service account stays an owner).
    const owners = [...new Set([...(resource.owners ?? []).map((o) => o.toLowerCase()), saEmail.toLowerCase(), ...ownersFromEnv(deps.env)])]
    const current = new Set((resource.owners ?? []).map((o) => o.toLowerCase()))
    if (owners.some((o) => !current.has(o))) {
      await call('Site Verification', `${SITE_VERIFICATION_BASE}/webResource/${webResourceId(siteUrl)}`, {
        method: 'PUT',
        body: { site, owners },
      })
      changed.push('google.owners')
    }

    // 6. Search Console property (PUT is idempotent).
    await call('Search Console', `${WEBMASTERS_BASE}/sites/${encodeURIComponent(siteUrl)}`, { method: 'PUT' })

    // 7. Reporting config.
    if (await writeIntegration(deps.sanity, state, 'google-search-console', { siteUrl })) changed.push('sanity.integration')

    return { state: 'connected', values: { siteUrl }, changed }
  } catch (e) {
    return stoppedOutcome(setupErrorFrom(e), changed)
  }
}

/**
 * Resolves an Amazon app short link (amzn.eu/d/…, amzn.to/…, a.co/d/…) to the
 * product URL it points to. SERVER ONLY (called from a server action when the
 * link is saved).
 *
 * Strict by design: only Amazon hosts are ever contacted (the short host, then
 * each redirect target that is itself an Amazon marketplace or short host); no
 * cookies, no credentials, a hard timeout, at most a few hops. The product page
 * itself is never fetched: we stop as soon as a redirect points at a
 * marketplace URL we can read.
 */

import { isAmazonShortLink, marketplaceOfHost, parseAmazonUrl } from './amazon-links'

export type ResolveFetch = (input: string, init: RequestInit) => Promise<Response>
export type ResolveResult = { ok: true; url: string } | { ok: false; error: 'not_short_link' | 'failed' | 'not_amazon' | 'timeout' }

const MAX_HOPS = 5
const TIMEOUT_MS = 4000

export async function resolveAmazonShortLink(
  url: string,
  deps: { fetch?: ResolveFetch; timeoutMs?: number } = {},
): Promise<ResolveResult> {
  if (!isAmazonShortLink(url)) return { ok: false, error: 'not_short_link' }
  const doFetch: ResolveFetch = deps.fetch ?? ((i, init) => fetch(i, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS)
  try {
    let current = new URL(url.includes('://') ? url.trim() : `https://${url.trim()}`).href
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const here = new URL(current)
      // Every hop must be an Amazon host. Anything else is refused before it is contacted.
      if (!isAmazonShortLink(current) && !marketplaceOfHost(here.hostname)) return { ok: false, error: 'not_amazon' }
      if (!isAmazonShortLink(current)) {
        // Already a marketplace URL: we only needed to get here.
        return parseAmazonUrl(current).ok ? { ok: true, url: current } : { ok: false, error: 'failed' }
      }
      const res = await doFetch(current, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { accept: 'text/html' } })
      const location = res.headers.get('location')
      if (res.status < 300 || res.status >= 400 || !location) return { ok: false, error: 'failed' }
      current = new URL(location, current).href
    }
    return { ok: false, error: 'failed' }
  } catch {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : 'failed' }
  } finally {
    clearTimeout(timer)
  }
}

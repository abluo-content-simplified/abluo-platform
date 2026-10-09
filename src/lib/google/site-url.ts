import { liveSiteUrl } from '@/lib/admin/projects-filter'
import { GoogleSetupError } from './errors'

/** Redirects followed from https://<customDomain>/ before settling on a host. */
export const MAX_REDIRECT_HOPS = 3

/**
 * The site's canonical URL-prefix for Search Console and the GA4 stream:
 * `https://` + the host the site actually serves after redirects, ending in
 * `/` (e.g. example.com → https://www.example.com/). Only the HOST is taken
 * from where the redirects end — a redirect to `/it/` or to `http://` does
 * not change the property.
 *
 *   - no usable custom domain → `no_domain`
 *   - the domain does not answer → `site_unreachable`
 *
 * Follows at most MAX_REDIRECT_HOPS redirects (`redirect: 'manual'`, so each
 * hop's Location is read, never followed blindly).
 */
export async function resolveCanonicalSiteUrl(customDomain: string | null | undefined, deps: { fetch?: typeof fetch } = {}): Promise<string> {
  const start = liveSiteUrl(customDomain)
  if (!start) throw new GoogleSetupError('no_domain', 'The project has no custom domain yet (Supabase projects.custom_domain).')
  const f = deps.fetch ?? fetch
  let current = new URL(`${start}/`)
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    let res: Response
    try {
      res = await f(current.toString(), { method: 'GET', redirect: 'manual', cache: 'no-store' })
    } catch (e) {
      throw new GoogleSetupError('site_unreachable', `${current.host} did not answer: ${e instanceof Error ? e.message : String(e)}`, { host: current.host })
    }
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) break
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      break
    }
    if (next.protocol !== 'https:' && next.protocol !== 'http:') break
    current = next
  }
  return `https://${current.host.toLowerCase()}/`
}

/** Pure: the host of a canonical site URL ("https://www.example.com/" → "www.example.com"). */
export function siteHost(siteUrl: string): string {
  return new URL(siteUrl).host
}

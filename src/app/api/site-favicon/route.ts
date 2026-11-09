/**
 * GET /favicon.ico (rewritten here in next.config.ts) — each site's own icon.
 *
 * Browsers ask `/favicon.ico` directly (Safari above all), whatever the page's
 * <link rel="icon"> says, and cache the answer for a long time. That address
 * used to be the Abluo icon for every host, so a site with its own favicon in
 * Website Settings still showed Abluo's in tabs and bookmarks.
 *
 * Host → project (generated route table) → Website Settings favicon (SVG, else
 * PNG, else made from the Sign — src/lib/site-icons.ts, as the page's own icon link), served as a PNG redirect to the Sanity CDN. A platform host, an unknown
 * host or a site without a favicon gets the platform icon via
 * `/favicon.ico?default=1`, which the rewrite lets through to the file.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { resolveScopeFromHost } from '@/lib/tenancy/host-scope'
import { asProjectSlug, unbrand } from '@/lib/tenancy/ids'
import { tenantClient } from '@/lib/sanity/client'
import { iconUrl } from '@/lib/sanity/image'
import { siteConfigFaviconQuery } from '@/lib/sanity/queries'
import { pickTabIcon, type SiteIconSources } from '@/lib/site-icons'

export const dynamic = 'force-dynamic'


/** The platform icon: the file itself, past the rewrite. */
export function defaultFaviconUrl(requestUrl: string): URL {
  const url = new URL('/favicon.ico', requestUrl)
  url.search = 'default=1'
  return url
}

export async function GET(request: NextRequest) {
  const scope = resolveScopeFromHost(request.headers.get('host'))
  let target: string | null = null
  if (scope) {
    try {
      const { fetchForTenant } = tenantClient(asProjectSlug(unbrand(scope.projectSlug)))
      // The same rule the page's <link rel="icon"> uses: favicon SVG → PNG → the Sign.
      const config = await fetchForTenant<SiteIconSources | null>(siteConfigFaviconQuery, {})
      const icon = pickTabIcon(config)
      if (icon) target = iconUrl(icon, 64) ?? null
    } catch {
      target = null // Sanity unreachable: the platform icon, never an error
    }
  }
  const response = NextResponse.redirect(target ?? defaultFaviconUrl(request.url), 307)
  // An hour: a new favicon shows up the same day, without a request per page.
  response.headers.set('Cache-Control', 'public, max-age=3600')
  return response
}

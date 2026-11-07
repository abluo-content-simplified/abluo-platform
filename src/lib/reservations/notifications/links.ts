// ── Reservations emails — where the personal links point (ADR-044 D11, ADR-034) ─
//
// ASSUMPTION (to confirm with the dashboard/public-page workstream): the public
// pages live at /<locale>/booking/<token> (management link) and
// /<locale>/my-pass/<token> (My pass). Only this file knows the paths.
import { canonicalOrigin } from '@/lib/seo/canonical'

export const MANAGE_PATH = 'booking'
export const PASS_PATH = 'my-pass'

/** Live site → https://www.<domain> (ADR-034); no domain yet → the preview host's project path. */
export function siteOrigin(site: { customDomain: string | null; slug: string }): string {
  return canonicalOrigin(site.customDomain) ?? `https://preview.abluo.app/${encodeURIComponent(site.slug)}`
}

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/

export function personalUrl(origin: string, locale: string, path: string, token: unknown): string | null {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  return `${origin}/${encodeURIComponent(locale)}/${path}/${token}`
}

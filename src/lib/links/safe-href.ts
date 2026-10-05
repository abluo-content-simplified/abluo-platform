/**
 * The ONE href gate for links rendered on the websites from Portable Text
 * (article bodies, Text / MediaContent / Team sections).
 *
 * Bodies can carry hrefs the client dashboard never validated: annotations
 * preserved byte-for-byte from Studio content (ADR-025 "preserve" rule) and
 * anything authored in Studio. Every renderer therefore re-checks with the
 * same rule the dashboard applies when saving (`normalizeHref`: http(s),
 * mailto:, tel:, site-relative "/…"), plus in-page "#fragment" links that
 * section copy uses. Anything else (javascript:, data:, vbscript:,
 * protocol-relative "//host", whitespace tricks) returns null and the caller
 * renders the text without a link.
 */
import { normalizeHref } from '@/lib/client/normalize-blocks'

const FRAGMENT = /^#[A-Za-z0-9_:.-]{0,200}$/

export function safeLinkHref(href: unknown): string | null {
  if (typeof href === 'string' && FRAGMENT.test(href.trim())) return href.trim()
  return normalizeHref(href)
}

/** External links (http(s) / mailto) open in a new tab in section copy. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.toLowerCase().startsWith('mailto:')
}

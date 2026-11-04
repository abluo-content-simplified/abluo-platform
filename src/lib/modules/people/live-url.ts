// ── People module — "View on website" (pure, browser-safe) ───────────────────
//
// The live address of a person's own profile page. Everything is read from
// the PUBLISHED person (an unpublished draft has no live page) and the
// People module config: no profile segment in this language ⇒ no pages.
// The origin is the canonical one (ADR-034, `canonicalOrigin`) computed on the
// server; with no custom domain there is no address to show.

export interface PersonLiveInfo {
  /** `https://www.<domain>` (canonicalOrigin) or null. */
  origin: string | null
  published: boolean
  archived: boolean
  anonymised: boolean
  visibility: 'off' | 'listed' | 'page'
  /** Published slugs per language (no fallback). */
  slugs: Record<string, string>
  /** Profile base path per language (module config `profileSegment`, already cleaned). */
  segments: Record<string, string>
}

/** The live profile URL in one language, or null when the page does not exist there. */
export function personLiveUrl(info: PersonLiveInfo | null | undefined, locale: string): string | null {
  if (!info || !info.origin) return null
  if (!info.published || info.archived || info.anonymised) return null
  if (info.visibility !== 'page') return null
  const segment = info.segments[locale]
  const slug = info.slugs[locale]
  if (!segment || !slug) return null
  const clean = (s: string) => s.replace(/^\/+|\/+$/g, '')
  return [info.origin.replace(/\/+$/, ''), locale, clean(segment), clean(slug)].join('/')
}

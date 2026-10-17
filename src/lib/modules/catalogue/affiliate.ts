// ── Catalogue — buy and affiliate links (ADR-033 Amendment K) ─────────────────
//
// Pure, browser-safe, no React. A link may be a plain "info" link (every link
// stored before this amendment) or a "buy" link; a buy link may be flagged as
// an affiliate link. This file is the single place that decides:
//   - which rel a link carries (affiliate → sponsored nofollow noopener noreferrer),
//   - whether a page shows the affiliate disclosure (only when it renders at
//     least one affiliate link) and which text it shows (the catalogue's own
//     sentence for this language, else the platform default for the language).

import type { CatalogueCollectionDTO, CatalogueItemLinkDTO, CatalogueSectionDTO } from './dto'

type LinkFlags = Pick<CatalogueItemLinkDTO, 'kind' | 'affiliate'>

/** A buy link flagged as affiliate. `affiliate` on an info link means nothing. */
export const isAffiliateLink = (l: LinkFlags): boolean => l.kind === 'buy' && l.affiliate === true

/** True when any of these links is an affiliate link. */
export const hasAffiliateLink = (links: readonly LinkFlags[] | null | undefined): boolean => (links ?? []).some(isAffiliateLink)

function sectionsHaveAffiliate(sections: readonly CatalogueSectionDTO[]): boolean {
  return sections.some((s) => s.items.some((i) => hasAffiliateLink(i.links)) || sectionsHaveAffiliate(s.children))
}

/** True when a collection renders at least one affiliate link anywhere in its sections. */
export const collectionHasAffiliateLink = (c: Pick<CatalogueCollectionDTO, 'sections'>): boolean => sectionsHaveAffiliate(c.sections)

/**
 * The rel of a link. Affiliate links are always sponsored + nofollow + noopener
 * + noreferrer (even when they would open in the same tab); any other link
 * keeps the platform rule: noopener noreferrer when it opens a new tab, none otherwise.
 */
export function catalogueLinkRel(link: LinkFlags, opensNewTab: boolean): string | undefined {
  if (isAffiliateLink(link)) return 'sponsored nofollow noopener noreferrer'
  return opensNewTab ? 'noopener noreferrer' : undefined
}

/**
 * The disclosure sentence to print, or null when the page must not show one.
 * `configured` is the catalogue's own sentence for the request locale (blank =
 * none); `fallback` is the platform default for that locale (messages).
 */
export function affiliateDisclosureText(
  hasAffiliate: boolean,
  configured: string | null | undefined,
  fallback: string,
): string | null {
  if (!hasAffiliate) return null
  const own = typeof configured === 'string' ? configured.trim() : ''
  return own || fallback.trim() || null
}

/** The visible label of a buy button: the link's own label, else the localized "Buy". */
export const buyLabel = (label: string | null | undefined, fallback: string): string => (label ?? '').trim() || fallback

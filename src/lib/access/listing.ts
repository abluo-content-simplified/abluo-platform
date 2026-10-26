/**
 * Site Access — keeping restricted pages out of every public listing
 * (sitemap.xml, llms.txt; ADR-040 §9). Pure.
 *
 * A page is listed in a language only when it is OPEN itself (`open === true`
 * from `pageIsOpen()` in the query — a missing flag is closed) and no closed
 * page sits at a prefix of its path in that language (a child of a members
 * page is a members page).
 */
export type ListedPage = {
  open?: boolean | null
  slug?: Record<string, { current?: string } | null | undefined> | null
}

function slugIn(page: ListedPage, locale: string): string | undefined {
  const s = page.slug?.[locale]?.current
  return typeof s === 'string' && s ? s.replace(/^\/+|\/+$/g, '') : undefined
}

/** The slugs (in `locale`) of every closed page. */
export function closedPaths(pages: readonly ListedPage[], locale: string): Set<string> {
  const out = new Set<string>()
  for (const p of pages) {
    if (p.open === true) continue
    const s = slugIn(p, locale)
    if (s) out.add(s)
  }
  return out
}

/** May `page` appear in a public listing for `locale`? */
export function isListable(page: ListedPage, locale: string, closed: ReadonlySet<string>): boolean {
  if (page.open !== true) return false
  const s = slugIn(page, locale)
  if (!s) return true // e.g. the home page, listed by its bare locale URL
  for (const c of closed) if (s.startsWith(`${c}/`)) return false
  return true
}

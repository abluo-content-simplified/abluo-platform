/**
 * Documents (ADR-040 §15, R9) — which pages can show documents, and whether a
 * document FITS a page. Server-only reads; the rules are pure.
 *
 * A page can show documents when it has a Download section. Whether a document
 * fits it:
 *   - an `everyone` document fits any such page (public or protected);
 *   - a group document fits only a PROTECTED page open to at least one of the
 *     document's groups.
 * "Protected" counts the page's own rule and every closed path ancestor (a
 * child of a members-only page is closed too, ADR-040 §9).
 *
 * The same rule is applied three times: the dashboard offers only fitting
 * pages, the server refuses a placement that does not fit, and the website
 * re-checks at every display — so a page that changes later (made public,
 * other groups, section removed) simply stops showing what no longer fits.
 */
import type { SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { parseAccessPolicy, slugAncestorPaths, type AccessPolicy } from './policy'
import type { DocumentVisibility } from './store'

export type DownloadPage = {
  id: string
  title: string
  /** The page's path in the site's default language ('' for the home page). */
  path: string
  isHome: boolean
  restricted: boolean
  /** Groups that open the page (union of every closed rule on its path). Empty when public. */
  groupIds: string[]
}

type Row = {
  _id: string
  pageType?: string | null
  title?: Record<string, unknown> | null
  slug?: Record<string, { current?: string } | null> | null
  access?: unknown
  hasDownloadSection?: boolean | null
}

/** Every published page of the project, with whether it carries a Download section. */
export const DOWNLOAD_PAGES_QUERY = /* groq */ `*[_type == "page" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{
  _id, pageType, title, slug, access,
  "hasDownloadSection": count(sections[_type == "downloadSection"]) > 0
}`

function pick(value: Record<string, unknown> | null | undefined, locale: string, fallback: string): string {
  const v = value ?? {}
  const s = (k: string) => (typeof v[k] === 'string' && (v[k] as string).trim() ? (v[k] as string).trim() : null)
  return s(locale) ?? s(fallback) ?? (Object.entries(v).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x.trim())?.[1] as string | undefined) ?? ''
}

function slugOf(row: Row, locale: string): string {
  const s = row.slug?.[locale]?.current
  return typeof s === 'string' ? s.trim().replace(/^\/+|\/+$/g, '') : ''
}

/** Pure: rows → the pages that carry a Download section, each with its effective protection. */
export function toDownloadPages(rows: Row[], opts: { locale: string; defaultLocale: string }): DownloadPage[] {
  const byPath = new Map<string, AccessPolicy>()
  for (const r of rows) {
    if (r.pageType === 'home') continue
    const path = slugOf(r, opts.defaultLocale)
    if (path) byPath.set(path, parseAccessPolicy(r.access))
  }
  const pages: DownloadPage[] = []
  for (const r of rows) {
    if (!r.hasDownloadSection) continue
    const isHome = r.pageType === 'home'
    const path = isHome ? '' : slugOf(r, opts.defaultLocale)
    // The home page is always public (ADR-040 §9); legal pages may hold public documents only.
    const chain: AccessPolicy[] = isHome ? [] : [parseAccessPolicy(r.access), ...slugAncestorPaths(path).map((p) => byPath.get(p)).filter((p): p is AccessPolicy => Boolean(p))]
    const closed = chain.filter((p) => p.visibility === 'restricted')
    pages.push({
      id: r._id,
      title: pick(r.title, opts.locale, opts.defaultLocale) || path || r._id,
      path,
      isHome,
      restricted: closed.length > 0,
      groupIds: [...new Set(closed.flatMap((p) => (p.visibility === 'restricted' ? [...p.groupIds] : [])))].map((g) => g.toLowerCase()).sort(),
    })
  }
  return pages.sort((a, b) => (a.isHome === b.isHome ? a.path.localeCompare(b.path) : a.isHome ? -1 : 1))
}

export async function listDownloadPages(fetch: SanityFetchFn, opts: { locale: string; defaultLocale: string }): Promise<DownloadPage[]> {
  return toDownloadPages((await fetch<Row[]>(DOWNLOAD_PAGES_QUERY)) ?? [], opts)
}

/** Does a document fit a page? (Dashboard offer, server refusal and website re-check all use this.) */
export function documentFitsPage(
  doc: { visibility: DocumentVisibility; groupIds: readonly string[] },
  page: { restricted: boolean; groupIds: readonly string[] }
): boolean {
  if (doc.visibility === 'everyone') return true
  if (!page.restricted) return false
  const pageGroups = new Set(page.groupIds.map((g) => g.toLowerCase()))
  return doc.groupIds.some((g) => pageGroups.has(g.toLowerCase()))
}

/** Why a page is not offered for a document — for the greyed-out reason in the form. */
export function whyNotFit(
  doc: { visibility: DocumentVisibility; groupIds: readonly string[] },
  page: { restricted: boolean; groupIds: readonly string[] }
): 'public_page' | 'other_groups' | null {
  if (documentFitsPage(doc, page)) return null
  return page.restricted ? 'other_groups' : 'public_page'
}

/**
 * What a visitor sees in a Download section: the page's documents that still
 * fit the page AND that this visitor may open (everyone, or a group they hold).
 */
export function visibleOnPage<T extends { visibility: DocumentVisibility; groupIds: readonly string[] }>(
  docs: readonly T[],
  page: { restricted: boolean; groupIds: readonly string[] },
  visitorGroupIds: ReadonlySet<string> | null
): T[] {
  return docs.filter((d) => {
    if (!documentFitsPage(d, page)) return false
    if (d.visibility === 'everyone') return true
    return Boolean(visitorGroupIds) && d.groupIds.some((g) => visitorGroupIds!.has(g.toLowerCase()) || visitorGroupIds!.has(g))
  })
}

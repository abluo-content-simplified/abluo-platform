/**
 * "A page on your site" — the link sheet's search (ADR-025 · links round 2).
 *
 * Lets the client dashboard's body editor find the site's own pages, live
 * blog posts, news items and events by title, in the post's language, so a
 * link can store a REFERENCE instead of a URL.
 *
 * Gate, in order:
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` — only someone
 *      who can write posts can search for link targets.
 *   2. Every read goes through `tenantScopedSanityClient` — `$projectSlug` is
 *      always the grant's, never the caller's.
 *   3. Published documents only (the website client's default perspective;
 *      ids are matched without `drafts.`), posts only once live.
 *   4. Bounded input: language code shape, query ≤ 80 characters, ≤ 20
 *      results, ≤ 20 ids for the title lookup.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient, type SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { BLOG_POST_WRITE_PERMISSION } from '@/lib/api/post-drafts'
import { DOC_ID } from '@/lib/client/normalize-blocks'
import { internalTargetPath, LINK_TARGET_TYPES, type BodyLinkTargetType } from '@/lib/links/link-target'
import { publicFilterFor } from '@/lib/lifecycle/public-types'

export const LINK_SEARCH_LIMITS = { query: 80, results: 20, ids: 20 } as const

export type LinkTargetResult = {
  id: string
  /** The four classic types for the post editor; also the catalogue types when the caller asked for them (FAQ answers, ADR-037 D12). */
  type: BodyLinkTargetType
  title: string
  /** Site-relative path in this language ('' = home), for display only. */
  path: string
}

export class PostLinkSearchError extends Error {
  constructor(readonly code: 'invalid_value') {
    super('Invalid link search.')
    this.name = 'PostLinkSearchError'
  }
}

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/

// Titles and slugs in the requested language only: a target with no slug in
// that language cannot be linked from a post written in it.
const QUERY = /* groq */ `
*[_type in $types && projectSlug == $projectSlug && !(_id in path("drafts.**"))
  && (_type != "post" || (defined(publishedAt) && publishedAt <= now() && (!defined(expiresAt) || expiresAt > now())))
  && (pageType == "home" || defined(slug[$locale].current))
  && (count($ids) == 0 || _id in $ids)
  && ($q == "" || coalesce(title[$locale], title.en, "") match $q)
] | order(_type asc, coalesce(title[$locale], title.en) asc) [0...$limit] {
  _id, _type, pageType, projectSlug,
  "title": coalesce(title[$locale], title.en, ""),
  "slug": slug[$locale].current
}`

// Same search with Catalogue items and collections (ADR-037 D12): only ones
// with a page of their own, public by the shared lifecycle rule, titled by
// `name`, and carrying the catalogue installation's public segment (null when
// the module is not installed or switched off → no path → not offered).
const QUERY_WITH_CATALOGUE = /* groq */ `
*[_type in $types && projectSlug == $projectSlug && !(_id in path("drafts.**"))
  && (_type != "post" || (defined(publishedAt) && publishedAt <= now() && (!defined(expiresAt) || expiresAt > now())))
  && (_type != "catalogueItem" || (hasPage == true && ${publicFilterFor('catalogueItem')}))
  && (_type != "catalogueCollection" || (hasPage == true && ${publicFilterFor('catalogueCollection')}))
  && (pageType == "home" || defined(slug[$locale].current))
  && (count($ids) == 0 || _id in $ids)
  && ($q == "" || coalesce(title[$locale], title.en, name[$locale], name.en, "") match $q)
] | order(_type asc, coalesce(title[$locale], title.en, name[$locale], name.en) asc) [0...$limit] {
  _id, _type, pageType, projectSlug, hasPage,
  "title": coalesce(title[$locale], title.en, name[$locale], name.en, ""),
  "slug": slug[$locale].current,
  "segment": select(string::startsWith(_type, "catalogue") => *[_type == "project" && projectSlug == $projectSlug][0].moduleInstallations[moduleId == "catalogue" && enabled != false][0].config.publicSegment)
}`

type Row = { _id: string; _type: string; pageType?: string | null; projectSlug?: string; title?: string; slug?: string | null }

export async function searchLinkTargets(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { locale: unknown; query?: unknown; ids?: unknown },
  /**
   * `permission` (default: write posts) and `types` (default: the four classic
   * types; pass BODY_LINK_TARGET_TYPES to include Catalogue) are for server
   * callers only — never from a client.
   */
  deps: { fetch?: SanityFetchFn; permission?: string; types?: readonly BodyLinkTargetType[] } = {}
): Promise<LinkTargetResult[]> {
  assertModuleAction(ctx, projectId, deps.permission ?? BLOG_POST_WRITE_PERMISSION)
  const types: readonly BodyLinkTargetType[] = deps.types ?? LINK_TARGET_TYPES
  const withCatalogue = types.some((t) => !(LINK_TARGET_TYPES as readonly string[]).includes(t))
  const locale = typeof input?.locale === 'string' && LOCALE.test(input.locale) ? input.locale : null
  if (!locale) throw new PostLinkSearchError('invalid_value')
  const q = input.query === undefined ? '' : typeof input.query === 'string' ? input.query.trim() : null
  if (q === null || q.length > LINK_SEARCH_LIMITS.query) throw new PostLinkSearchError('invalid_value')
  const ids = input.ids === undefined ? [] : input.ids
  if (!Array.isArray(ids) || ids.length > LINK_SEARCH_LIMITS.ids || !ids.every((id) => typeof id === 'string' && DOC_ID.test(id))) {
    throw new PostLinkSearchError('invalid_value')
  }

  const scoped = tenantScopedSanityClient(ctx, projectId, { fetch: deps.fetch })
  // Each word must match the start of a word in the title ("stud den" → "Studio dentistico").
  const pattern = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w.replace(/[*"\\]/g, '')}*`)
    .filter((w) => w !== '*')
  const rows = await scoped.fetch<Row[] | null>(withCatalogue ? QUERY_WITH_CATALOGUE : QUERY, {
    types: [...types],
    locale,
    ids,
    q: pattern.length ? pattern : '',
    limit: ids.length || LINK_SEARCH_LIMITS.results,
  })
  const out: LinkTargetResult[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const path = internalTargetPath({ ...row, live: true }, scoped.projectSlug)
    if (path === null || !(types as readonly string[]).includes(row._type)) continue
    out.push({ id: row._id, type: row._type as BodyLinkTargetType, title: row.title || path || '/', path })
  }
  return out
}

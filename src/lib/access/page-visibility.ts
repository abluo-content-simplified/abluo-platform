/**
 * Site Access — "who can see this page", from the tenant dashboard (ADR-040
 * B2.5). Server-only.
 *
 * The page rule lives on the Sanity page document (`page.access`, B2.2); this
 * is the dashboard's way to set it, so a tenant administrator never needs
 * Studio. Rules (the same as Studio's, page-schema-rules.ts):
 *   - the home page is always public — it is listed, never changeable;
 *   - a members-only page needs at least one LIVE group of this project;
 *   - a page with a "Download a file" button cannot be members-only (Sanity
 *     files are public by link) — refused with its own code so the screen can
 *     explain it;
 *   - the change is written to the published page AND its open draft in one
 *     transaction (a later publish of the draft must not undo it), guarded by
 *     the revisions the screen saw (a page changed meanwhile → `conflict`).
 *
 * Who may do it: `members.access.manage` (the caller passes the grant from
 * authorizeAccessManagement). Pages are read through the tenant-scoped client
 * and written only after the ownership of both documents is re-checked.
 */
import type { SanityFetchFn } from '@/lib/api/tenant-scoped-sanity'
import { assertSingleSanityProject } from '@/lib/api/sanity-project-guard'
import { AccessError, isUuid } from './model'
import type { AccessManagementGrant } from './management'
import { parseAccessPolicy, parseNavigationMode, slugAncestorPaths, type NavigationMode } from './policy'
import { findFileDownloadCtas, validatePageAccess } from './page-schema-rules'
import type { SiteAccessStore } from './store'

export type AccessPageItem = {
  id: string
  title: string
  /** The page's path in the site's default language ('' for the home page). */
  path: string
  isHome: boolean
  visibility: 'public' | 'restricted'
  groupIds: string[]
  navigation: NavigationMode
  /** The published page or its draft has a "Download a file" button. */
  hasFileDownload: boolean
  /** Title of the nearest members-only page above this one (it is closed too). */
  closedBy: string | null
  /** The revisions the screen saw, sent back when saving. */
  rev: string
  draftRev: string | null
}

type Row = {
  _id: string
  _rev: string
  pageType?: string | null
  title?: Record<string, unknown> | null
  slug?: Record<string, { current?: string } | null> | null
  access?: unknown
  sections?: unknown
  draft?: { _rev: string; access?: unknown; sections?: unknown } | null
}

/** Published pages of the project, each with its draft's revision and sections (for the download check). */
export const ACCESS_PAGES_QUERY = /* groq */ `*[_type == "page" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{
  _id, _rev, pageType, title, slug, access, sections,
  "draft": *[_id == "drafts." + ^._id && projectSlug == $projectSlug][0]{ _rev, access, sections }
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

/** Pure: rows → what the screen lists, home first, then by path. */
export function toAccessPages(rows: Row[], opts: { locale: string; defaultLocale: string }): AccessPageItem[] {
  const items = rows.map((r) => {
    const policy = parseAccessPolicy(r.access)
    const path = r.pageType === 'home' ? '' : slugOf(r, opts.defaultLocale)
    return {
      id: r._id,
      title: pick(r.title, opts.locale, opts.defaultLocale) || path || r._id,
      path,
      isHome: r.pageType === 'home',
      visibility: policy.visibility,
      groupIds: policy.visibility === 'restricted' ? [...policy.groupIds] : [],
      navigation: parseNavigationMode(r.access),
      hasFileDownload: findFileDownloadCtas(r.sections).length > 0 || findFileDownloadCtas(r.draft?.sections).length > 0,
      closedBy: null as string | null,
      rev: r._rev,
      draftRev: r.draft?._rev ?? null,
    }
  })
  const byPath = new Map(items.filter((i) => !i.isHome && i.path).map((i) => [i.path, i]))
  for (const item of items) {
    if (item.isHome || !item.path) continue
    const above = slugAncestorPaths(item.path).map((p) => byPath.get(p)).filter((p) => p && p.visibility === 'restricted')
    item.closedBy = above.length ? above[above.length - 1]!.title : null
  }
  return items.sort((a, b) => (a.isHome === b.isHome ? a.path.localeCompare(b.path) : a.isHome ? -1 : 1))
}

export async function listAccessPages(fetch: SanityFetchFn, opts: { locale: string; defaultLocale: string }): Promise<AccessPageItem[]> {
  const rows = await fetch<Row[]>(ACCESS_PAGES_QUERY)
  return toAccessPages(rows ?? [], opts)
}

export type PageAccessInput = {
  pageId: unknown
  visibility: unknown
  groupIds?: unknown
  navigation?: unknown
  rev: unknown
  draftRev?: unknown
}

export class PageAccessRefused extends AccessError {
  constructor(public readonly reason: 'home' | 'file_download' | 'conflict' | 'no_groups') {
    super('invalid_input', `page_${reason}`)
  }
}

type Doc = { _id: string; _rev: string; _type: string; projectSlug?: string; pageType?: string; sections?: unknown }

/** The slice of the Sanity write client this needs (sanityWriteClient satisfies it). */
type PatchTx = { patch(id: string, p: { ifRevisionID: string; set: Record<string, unknown> }): PatchTx; commit(): Promise<unknown> }
export type PageWriteClient = {
  getDocument(id: string): Promise<unknown>
  fetch(query: string, params?: Record<string, unknown>): Promise<unknown>
  transaction(): PatchTx
}

/**
 * Sets `access` on one page. Returns the value written. Throws AccessError
 * ('not_found' for a page that is not this project's), PageAccessRefused, or
 * TenantAuthorizationError (from the single-project guard).
 */
export async function setPageAccess(
  store: SiteAccessStore,
  grant: AccessManagementGrant,
  projectSlug: string,
  input: PageAccessInput,
  deps: { client: PageWriteClient }
): Promise<Record<string, unknown>> {
  if (grant?.level !== 'manage' || !isUuid(grant.projectId)) throw new AccessError('invalid_input', 'manage grant required')
  const pageId = typeof input.pageId === 'string' ? input.pageId : ''
  if (!pageId || pageId.startsWith('drafts.') || pageId.startsWith('versions.') || !/^[A-Za-z0-9._-]{1,128}$/.test(pageId)) throw new AccessError('not_found', 'page')
  if (input.visibility !== 'public' && input.visibility !== 'restricted') throw new AccessError('invalid_input', 'visibility')

  let value: Record<string, unknown>
  if (input.visibility === 'public') {
    value = { visibility: 'public' }
  } else {
    if (!Array.isArray(input.groupIds) || input.groupIds.length === 0) throw new PageAccessRefused('no_groups')
    const requested = [...new Set(input.groupIds)]
    if (!requested.every(isUuid)) throw new AccessError('invalid_input', 'groups')
    const live = new Set((await store.listGroups(grant.projectId)).filter((g) => !g.archivedAt).map((g) => g.id.toLowerCase()))
    const groups = requested.map((g) => (g as string).toLowerCase()).sort()
    if (!groups.every((g) => live.has(g))) throw new AccessError('invalid_input', 'unknown_group')
    const navigation = input.navigation === 'locked' ? 'locked' : 'hidden'
    value = { visibility: 'restricted', groups, navigation }
  }

  const client = deps.client
  const [published, draft] = (await Promise.all([client.getDocument(pageId), client.getDocument(`drafts.${pageId}`)])) as [Doc | undefined, Doc | undefined]
  const ours = (d: Doc | undefined) => Boolean(d && d._type === 'page' && d.projectSlug === projectSlug)
  if (!ours(published) || (draft && !ours(draft))) throw new AccessError('not_found', 'page')
  if (published!._rev !== input.rev || (draft?._rev ?? null) !== (typeof input.draftRev === 'string' ? input.draftRev : null)) throw new PageAccessRefused('conflict')

  if (value.visibility === 'restricted') {
    for (const d of [published, draft]) {
      if (!d) continue
      if (d.pageType === 'home') throw new PageAccessRefused('home')
      if (findFileDownloadCtas(d.sections).length > 0) throw new PageAccessRefused('file_download')
      if (validatePageAccess(value, d) !== true) throw new AccessError('invalid_input', 'page_access')
    }
  }

  await assertSingleSanityProject((q, p) => client.fetch(q, p), projectSlug)
  let tx = client.transaction().patch(pageId, { ifRevisionID: published!._rev, set: { access: value } })
  if (draft) tx = tx.patch(draft._id, { ifRevisionID: draft._rev, set: { access: value } })
  try {
    await tx.commit()
  } catch (e) {
    if ((e as { statusCode?: number })?.statusCode === 409) throw new PageAccessRefused('conflict')
    throw new AccessError('unavailable', 'page save')
  }
  return value
}

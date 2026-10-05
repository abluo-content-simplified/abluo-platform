/**
 * Client dashboard data layer — ADR-017 slice 6 / ADR-015 close-out.
 *
 * This is the FIRST real read path that wires the ADR-017 authorization
 * primitives — `assertModuleAction` (entitlement + permission guard) and
 * `tenantScopedSanityClient` (the tenant-scoped Sanity chokepoint) — into a
 * dashboard read. Until this file, both were unit-tested but called by NO
 * route. Wiring them here is what makes the ADR-015 enforcement chain bind
 * end-to-end at a real call site.
 *
 * The enforcement chain, in order, for every function here:
 *   1. `assertModuleAction(ctx, projectId, permissionId)` — throws
 *      `TenantAuthorizationError` unless (a) the caller holds a ProjectGrant
 *      for `projectId`, (b) the owning module is installed for that project,
 *      and (c) the caller's role grants the permission.
 *   2. `tenantScopedSanityClient(ctx, projectId)` — throws unless the caller
 *      holds a grant for `projectId`; the returned client forces
 *      `$projectSlug` from the grant, so a caller can never read another
 *      project's content.
 *   3. `.fetch(query, ...)` — the query MUST reference `$projectSlug`
 *      (enforced by the chokepoint) and never interpolates tenant identity.
 *
 * `ctx` is the FIRST parameter of every exported function (ADR-015 R8): the
 * authorization context is always passed explicitly, never resolved implicitly
 * inside the data layer.
 *
 * Reads-only this slice (Tom's decision) — no write helpers here yet.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import {
  tenantScopedSanityClient,
  type SanityFetchFn,
} from '@/lib/api/tenant-scoped-sanity'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { dashboardPostsContextQuery, dashboardPostsQuery } from '@/lib/sanity/queries'
import { createClient } from '@/lib/supabase/server'

/** A single post row as the client dashboard needs it. Minimal by design. */
export type DashboardPost = {
  _id: string
  /** Locale-resolved title; null if the post has no title in any locale. */
  title: string | null
  /** Locale-resolved slug; null if no slug is set yet (unpublished draft). */
  slug: string | null
  /** Derived publish state — see dashboardPostsQuery. */
  status: DashboardPostStatus
  /** Sanity `_updatedAt` — ISO timestamp. */
  updatedAt: string
  /** Locale-resolved subtitle, if any. */
  subtitle?: string | null
  /** Raw localized title object (or a legacy plain string). */
  titleLocales?: unknown
  /** Stored category keys (ADR-020 Amendment B — keys, never labels). */
  categoryKeys?: string[] | null
  /** Go-live date (ISO), if set. */
  publishedAt?: string | null
  /** Take-offline date (ISO), if set. */
  expiresAt?: string | null
  /** Sanity `_createdAt` — ISO timestamp. */
  createdAt?: string
}

export type DashboardPostStatus = 'published' | 'scheduled' | 'draft' | 'offline'

/** A post row ready for display: category labels and languages resolved. */
export type DashboardPostRow = DashboardPost & {
  categories: string[]
  /** Site languages this post has a title in; empty on single-language sites. */
  languages: string[]
  /** Lower-cased, accent-free titles + subtitle in every language (for search). */
  searchText: string
}

/** The posts list plus what its filters need. */
export type DashboardPostList = {
  posts: DashboardPostRow[]
  /** Site languages; only meaningful when there are two or more. */
  languages: string[]
  /** The blog's categories for this site, in the viewer's language. */
  categories: { value: string; label: string }[]
}

/** Permission that gates listing posts in the client dashboard. */
export const BLOG_POST_READ_PERMISSION = 'blog.post.read'

/**
 * Returns all posts (draft + published) for `projectId`, ordered
 * most-recently-touched first.
 *
 * Enforcement (see file header): `assertModuleAction` FIRST (module-installed +
 * permission), then the tenant-scoped Sanity client (forces `$projectSlug`),
 * then the fetch. Any authorization failure throws `TenantAuthorizationError`
 * — this function never silently returns an empty list to paper over a denied
 * access; the caller decides how to present the rejection.
 *
 * `params.locale` drives the content-localization coalesce chain in the query.
 * `params.defaultLocale` is the tenant's default content locale; when omitted
 * it falls back to `params.locale` (the query's coalesce chain still degrades
 * to `.en` and then the raw value, so a missing default never hard-fails).
 *
 * `deps.fetch` is a test injection point — it is threaded straight into
 * `tenantScopedSanityClient`, so tests can supply a mock fetch and assert on
 * the scoped params without touching live Sanity.
 */
export async function getDashboardPosts(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { locale: string; defaultLocale?: string } = { locale: 'en' },
  deps: { fetch?: SanityFetchFn } = {}
): Promise<DashboardPost[]> {
  // Step 1 — entitlement + permission. Throws TenantAuthorizationError on any
  // denial (no grant / module not installed / permission not granted).
  assertModuleAction(ctx, projectId, BLOG_POST_READ_PERMISSION)

  // Step 2 — tenant-scoped client. Also throws if no grant for projectId;
  // forces $projectSlug from the grant so cross-project reads are impossible.
  const scoped = tenantScopedSanityClient(ctx, projectId, deps)

  // Step 3 — scoped fetch. $projectSlug is injected by the client; only the
  // locale params are supplied here.
  const posts = await scoped.fetch<DashboardPost[] | null>(dashboardPostsQuery, {
    locale: params.locale,
    defaultLocale: params.defaultLocale ?? params.locale,
  })

  return posts ?? []
}


type LocalizedLabel = string | Record<string, unknown> | null | undefined

/** Picks a label in the viewer's language, then the site's, then any. */
export function resolveLocalized(
  value: LocalizedLabel,
  locale: string,
  defaultLocale: string
): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null
  for (const key of [locale, defaultLocale, 'en']) {
    const v = value[key]
    if (typeof v === 'string' && v.trim()) return v
  }
  for (const [key, v] of Object.entries(value)) {
    if (!key.startsWith('_') && typeof v === 'string' && v.trim()) return v
  }
  return null
}

/**
 * The posts list as the dashboard shows it. Same authorization chain as
 * getDashboardPosts (it calls it), plus one scoped read for the site's
 * languages and the blog's category labels.
 *
 * Titles fall back viewer language → site default language → English → any,
 * so an Italian-only site never shows "Untitled" to a viewer whose dashboard
 * is in English.
 */
export async function getDashboardPostRows(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { locale: string },
  deps: { fetch?: SanityFetchFn } = {}
): Promise<DashboardPostRow[]> {
  return (await getDashboardPostList(ctx, projectId, params, deps)).posts
}

function searchBlob(...values: unknown[]): string {
  const parts: string[] = []
  for (const v of values) {
    if (typeof v === 'string') parts.push(v)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && typeof x === 'string') parts.push(x)
    }
  }
  return parts.join(' \n ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export async function getDashboardPostList(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { locale: string },
  deps: { fetch?: SanityFetchFn } = {}
): Promise<DashboardPostList> {
  assertModuleAction(ctx, projectId, BLOG_POST_READ_PERMISSION)
  const scoped = tenantScopedSanityClient(ctx, projectId, deps)

  type Context = {
    site?: { defaultLocale?: string | null; supportedLocales?: string[] | null } | null
    categories?: { value?: string; label?: LocalizedLabel }[] | null
  }
  const context = (await scoped.fetch<Context | null>(dashboardPostsContextQuery, {})) ?? {}
  const defaultLocale = context.site?.defaultLocale || params.locale
  const supported = context.site?.supportedLocales ?? []

  const labels = new Map<string, string>()
  for (const c of context.categories ?? []) {
    if (!c?.value) continue
    labels.set(c.value, resolveLocalized(c.label, params.locale, defaultLocale) ?? c.value)
  }

  const posts = await getDashboardPosts(ctx, projectId, { locale: params.locale, defaultLocale }, deps)

  const rows = posts.map((post): DashboardPostRow => {
    const titleObj =
      post.titleLocales && typeof post.titleLocales === 'object'
        ? (post.titleLocales as Record<string, unknown>)
        : null
    const languages =
      supported.length > 1 && titleObj
        ? supported.filter((l) => typeof titleObj[l] === 'string' && (titleObj[l] as string).trim())
        : []
    return {
      ...post,
      title: post.title ?? resolveLocalized(titleObj, params.locale, defaultLocale),
      categories: (post.categoryKeys ?? []).map(
        (key) => labels.get(key) ?? key.replace(/-/g, ' ')
      ),
      languages,
      searchText: searchBlob(titleObj ?? post.title, post.subtitle),
    }
  })

  const usedKeys = new Set(rows.flatMap((r) => r.categoryKeys ?? []))
  const categories = [...labels.entries()].map(([value, label]) => ({ value, label }))
  for (const key of usedKeys) {
    if (!labels.has(key)) categories.push({ value: key, label: key.replace(/-/g, ' ') })
  }

  return { posts: rows, languages: supported.length > 1 ? supported : [], categories }
}

// ── Forms submissions (ADR-018 slice 6) ───────────────────────────────────────
// Unlike posts (Sanity content via the tenant-scoped Sanity chokepoint), form
// submissions live in Supabase. The enforcement chain is: assertModuleAction
// FIRST (forms installed + forms.submission.read permission), THEN a read on the
// RLS-backed, session-scoped Supabase client. RLS (project_id in
// get_my_project_ids()) is the data-layer backstop; the explicit .eq(project_id)
// narrows to the active project. Read-only this slice — status mutation is a
// follow-up.

/** Permission that gates listing submissions in the client dashboard. */
export const FORMS_SUBMISSION_READ_PERMISSION = 'forms.submission.read'
export const FORMS_SUBMISSION_UPDATE_PERMISSION = 'forms.submission.update'

export type SubmissionStatus = 'new' | 'processed' | 'archived'

/** A single submission (lead) row as the client dashboard needs it. */
export type DashboardSubmission = {
  id: string
  /** The form's stable id (e.g. "early-access", "contact"). */
  formId: string
  /** Submitter name, if the form captured one. */
  name: string | null
  /** Submitter email, if the form captured one. */
  email: string | null
  status: SubmissionStatus
  /** ISO timestamp the submission was created. */
  createdAt: string
  /** Every field the visitor submitted, keyed by internalKey (detail view + export). */
  data: Record<string, unknown>
  /** Lead-source attribution (entry point, page, referrer, UTM) — null if none. */
  source: Record<string, unknown> | null
  /** The definition version the submission was validated against. */
  formVersion: number | null
}

/** Minimal shape of a Supabase supabase-js client (the bits this file uses). */
export type SubmissionsReader = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

const VALID_STATUSES: readonly SubmissionStatus[] = ['new', 'processed', 'archived']

function normalizeStatus(v: unknown): SubmissionStatus {
  return (VALID_STATUSES as readonly string[]).includes(v as string) ? (v as SubmissionStatus) : 'new'
}

function extractStr(data: unknown, key: string): string | null {
  if (!data || typeof data !== 'object') return null
  const v = (data as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** Narrows an unknown JSONB column to a plain object (or the given fallback). */
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Pure row → DashboardSubmission mapping (exported for tests). */
export function mapSubmissionRow(row: Record<string, unknown>): DashboardSubmission {
  const data = asObject(row.submission_data)
  const source = row.source && typeof row.source === 'object' && !Array.isArray(row.source)
    ? (row.source as Record<string, unknown>)
    : null
  return {
    id: row.id as string,
    formId: (row.form_id as string) ?? '',
    name: extractStr(data, 'name'),
    email: extractStr(data, 'email'),
    status: normalizeStatus(row.status),
    createdAt: (row.created_at as string) ?? '',
    data,
    source,
    formVersion: typeof row.form_version === 'number' ? row.form_version : null,
  }
}

/**
 * Returns completed, non-spam submissions (leads) for `projectId`, newest first.
 *
 * Enforcement: `assertModuleAction` FIRST — throws `TenantAuthorizationError`
 * unless the forms module is installed for the project AND the caller's role
 * grants `forms.submission.read`. Then an RLS-backed Supabase read scoped to
 * `project_id`. `ctx` is the first parameter (ADR-015 R8). `deps.client` is a
 * test injection point.
 */
export async function getDashboardSubmissions(
  ctx: TenantAuthorizationContext,
  projectId: string,
  params: { limit?: number } = {},
  deps: { client?: SubmissionsReader } = {}
): Promise<DashboardSubmission[]> {
  // Step 1 — entitlement + permission (module-installed check precedes it).
  assertModuleAction(ctx, projectId, FORMS_SUBMISSION_READ_PERMISSION)

  // Step 2 — RLS-backed, session-scoped client (respects get_my_project_ids()).
  const supabase = deps.client ?? (await createClient())

  // Step 3 — read this project's completed, non-spam submissions.
  const { data, error } = await supabase
    .from('form_submissions')
    .select('id, form_id, submission_data, source, form_version, status, created_at')
    .eq('project_id', projectId)
    .eq('completion_state', 'complete')
    .neq('status', 'spam')
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 500)

  if (error) throw new Error(`getDashboardSubmissions: ${error.message ?? 'read failed'}`)
  return (data ?? []).map((r: Record<string, unknown>) => mapSubmissionRow(r))
}

/**
 * Updates a lead's workflow status (new / processed / archived).
 *
 * Enforcement mirrors the read path but requires the stronger
 * `forms.submission.update` permission: `assertModuleAction` FIRST (throws
 * `TenantAuthorizationError` when the module isn't installed or the role lacks
 * the permission), then an RLS-backed UPDATE scoped to BOTH `project_id` and
 * `id` — so a caller can never touch another project's row even by guessing an
 * id. `ctx` is the first parameter (ADR-015 R8). `deps.client` is a test seam.
 */
export async function updateSubmissionStatus(
  ctx: TenantAuthorizationContext,
  projectId: string,
  submissionId: string,
  status: SubmissionStatus,
  deps: { client?: SubmissionsReader } = {}
): Promise<void> {
  // Step 1 — entitlement + permission (module-installed check precedes it).
  assertModuleAction(ctx, projectId, FORMS_SUBMISSION_UPDATE_PERMISSION)

  if (!(VALID_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`updateSubmissionStatus: invalid status "${status}"`)
  }

  // Step 2 — RLS-backed, session-scoped client. Step 3 — scoped UPDATE.
  const supabase = deps.client ?? (await createClient())
  const { error } = await supabase
    .from('form_submissions')
    .update({ status })
    .eq('project_id', projectId)
    .eq('id', submissionId)
    .neq('status', 'spam')

  if (error) throw new Error(`updateSubmissionStatus: ${error.message ?? 'update failed'}`)
}

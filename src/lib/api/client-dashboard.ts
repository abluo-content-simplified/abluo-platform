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
import { dashboardPostsQuery } from '@/lib/sanity/queries'

/** A single post row as the client dashboard needs it. Minimal by design. */
export type DashboardPost = {
  _id: string
  /** Locale-resolved title; null if the post has no title in any locale. */
  title: string | null
  /** Locale-resolved slug; null if no slug is set yet (unpublished draft). */
  slug: string | null
  /** Derived publish state — see dashboardPostsQuery. */
  status: 'published' | 'draft'
  /** Sanity `_updatedAt` — ISO timestamp. */
  updatedAt: string
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

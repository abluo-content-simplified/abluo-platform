/**
 * Admin Media (ADR-030 step 4) — the pure half: how an Abluo admin reaches ONE
 * project's Media Library through the same code the client dashboard uses.
 *
 * Every Media Library function (`listMediaLibrary`, `uploadProjectImage`,
 * `updateGalleryPhoto`, `batchUpdatePhotos`, `deleteMediaAsset`) takes a
 * `TenantAuthorizationContext` and checks `media.library.manage` on the
 * caller's grant for the project, then scopes every Sanity read and write to
 * that grant's `projectSlug` (tenant-scoped client, same-project asset checks,
 * `assertSingleSanityProject`). An admin has no membership grant, so instead of
 * copying that logic the admin actions build a context holding exactly ONE
 * grant:
 *
 *   - only for an actor whose platform role is `abluo_admin` (the caller has
 *     already passed `requireAbluoAdmin()` — this is a second, local check);
 *   - only for a project read from Supabase `projects` by the service role,
 *     whose slug is used by exactly ONE row (a shared slug would make every
 *     `projectSlug`-keyed Sanity read ambiguous — same rule as
 *     `dropAmbiguousSlugGrants` for clients);
 *   - carrying ONLY `media.library.manage` — no module permissions, so the
 *     context cannot be reused for posts, galleries or anything else;
 *   - marked as synthetic (`membershipId: abluo-admin:<userId>`) so it can
 *     never be mistaken for a membership row.
 *
 * Nothing in the library code is weakened: the checks run unchanged against
 * this grant. Pure, so it is unit-tested.
 */
import type { AuthenticatedActor } from '@/lib/api/auth'
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { toProjectSlug } from '@/lib/tenancy/ids'

/** One row of Supabase `projects`, as the admin Media screen needs it. */
export type AdminMediaProject = { id: string; slug: string; name: string }

/** Prefix of the synthetic membership id of an admin grant. */
export const ADMIN_GRANT_PREFIX = 'abluo-admin:'

/**
 * The project named `slug`, when exactly one Supabase row carries it; null for
 * an unknown, empty or shared slug (fail closed).
 */
export function pickAdminProject(projects: readonly AdminMediaProject[], slug: unknown): AdminMediaProject | null {
  if (typeof slug !== 'string' || !slug.trim()) return null
  const matches = projects.filter((p) => p.slug === slug)
  return matches.length === 1 ? matches[0] : null
}

/** The projects usable by the admin Media screen: valid rows whose slug is not shared, A–Z by name. */
export function usableAdminProjects(rows: readonly unknown[]): AdminMediaProject[] {
  const valid = rows.flatMap((r) => {
    const row = r as { id?: unknown; slug?: unknown; name?: unknown } | null
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.slug !== 'string' || !row.slug.trim()) return []
    return [{ id: row.id, slug: row.slug, name: typeof row.name === 'string' && row.name.trim() ? row.name : row.slug }]
  })
  const uses = new Map<string, number>()
  for (const p of valid) uses.set(p.slug, (uses.get(p.slug) ?? 0) + 1)
  return valid
    .filter((p) => uses.get(p.slug) === 1)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug))
}

/**
 * A context with one Media-Library-only grant on `project`, or null when the
 * actor is not an Abluo admin or the project has no usable slug.
 */
export function adminMediaContext(actor: AuthenticatedActor | null | undefined, project: AdminMediaProject): TenantAuthorizationContext | null {
  if (!actor || actor.platformRole !== 'abluo_admin' || !actor.userId) return null
  const projectSlug = toProjectSlug(project.slug)
  if (!projectSlug || !project.id) return null
  const grant: ProjectGrant = {
    projectId: project.id,
    projectSlug,
    membershipId: `${ADMIN_GRANT_PREFIX}${actor.userId}`,
    role: 'admin',
    permissions: [MEDIA_MANAGE_PERMISSION],
    enabledModuleIds: [],
  }
  return { userId: actor.userId, platformRole: 'abluo_admin', projects: [grant], tenants: [] }
}

// ── "All projects" paging ────────────────────────────────────────────────────

const CURSOR_SEP = '::'
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * Cursor of the cross-project list: the project to continue in, plus that
 * project's own library cursor ('' = from its first photo).
 */
export function adminMediaCursor(slug: string, inner: string | null): string {
  return `${slug}${CURSOR_SEP}${inner ?? ''}`
}

/** Parses `adminMediaCursor`; null when malformed. */
export function parseAdminMediaCursor(cursor: unknown): { slug: string; inner: string | null } | null {
  if (typeof cursor !== 'string') return null
  const at = cursor.indexOf(CURSOR_SEP)
  if (at <= 0) return null
  const slug = cursor.slice(0, at)
  const inner = cursor.slice(at + CURSOR_SEP.length)
  if (!SLUG.test(slug) || inner.length > 300) return null
  return { slug, inner: inner || null }
}

/**
 * One page of the cross-project list: walks the projects in order from the
 * cursor's project, taking each project's own pages, until `pageSize` photos
 * are collected or every project is done. A project whose page fails is
 * skipped (`onSkip`) so one broken site never blanks the admin's library.
 * Pure over `fetchPage`, so it is unit-tested.
 */
export async function collectAcrossProjects<T>(params: {
  projects: readonly AdminMediaProject[]
  cursor: { slug: string; inner: string | null } | null
  pageSize: number
  fetchPage: (project: AdminMediaProject, inner: string | null) => Promise<{ items: T[]; nextCursor: string | null; tags: string[] }>
  onSkip?: (project: AdminMediaProject, error: unknown) => void
}): Promise<{ items: { project: AdminMediaProject; item: T }[]; nextCursor: string | null; tags: string[] } | null> {
  const { projects, cursor, pageSize, fetchPage } = params
  let index = 0
  let inner: string | null = null
  if (cursor) {
    index = projects.findIndex((p) => p.slug === cursor.slug)
    if (index < 0) return null
    inner = cursor.inner
  }
  const items: { project: AdminMediaProject; item: T }[] = []
  const tagCounts = new Map<string, number>()
  while (index < projects.length) {
    const project = projects[index]
    let page: { items: T[]; nextCursor: string | null; tags: string[] }
    try {
      page = await fetchPage(project, inner)
    } catch (error) {
      params.onSkip?.(project, error)
      page = { items: [], nextCursor: null, tags: [] }
    }
    for (const item of page.items) items.push({ project, item })
    page.tags.forEach((t, i) => tagCounts.set(t, (tagCounts.get(t) ?? 0) + (page.tags.length - i)))
    if (page.nextCursor) {
      inner = page.nextCursor
    } else {
      index += 1
      inner = null
    }
    if (items.length >= pageSize) break
  }
  const nextCursor = index < projects.length ? adminMediaCursor(projects[index].slug, inner) : null
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t)
  return { items, nextCursor, tags }
}

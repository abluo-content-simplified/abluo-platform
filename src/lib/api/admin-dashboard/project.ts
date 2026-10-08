// Server-only: service-role reads; never import from a client component.
/**
 * Admin provider — one project (ADR-030 project page). Checks
 * `requireAbluoAdmin()` first, then reads:
 *   - Supabase (service role): the project row, its client, the client's
 *     Owners, open invitations (project-level and client-level), and its
 *     contact requests (only when the forms module is installed);
 *   - Sanity, through the tenant-scope chokepoint
 *     (`tenantClient(slug).fetchForTenant`): modules, languages, and the same
 *     counts and latest lists the client's Home shows — published documents.
 * Each source is settled on its own; a failing one leaves its block out.
 * Returns null for an unknown slug (the page 404s).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { tenantClient } from '@/lib/sanity/client'
import { asProjectSlug } from '@/lib/tenancy/ids'
import { hostsForProjectId } from '@/lib/tenancy/host-scope'
import { settle } from '@/lib/api/dashboard/settle'
import { blogGlance, type BlogGlance } from '@/lib/api/dashboard/blog'
import type { RequestsGlance } from '@/lib/api/dashboard/forms'
import { REQUEST_WEEK_DAYS } from '@/lib/client/home-cards'
import { summarizeMedia, type MediaGlance } from '@/lib/api/dashboard/media'
import { siteStatusFrom, type SiteStatusData } from '@/lib/api/dashboard/site'
import { resolveLocalized, type DashboardPostStatus } from '@/lib/api/client-dashboard'
import { coverThumbUrl } from '@/lib/api/post-drafts'
import { adminProjectOverviewQuery } from '@/lib/admin/project-queries'
import { liveSiteUrl } from '@/lib/admin/projects-filter'
import { assertAbluoAdmin } from '@/lib/api/admin-dashboard/projects'
import {
  INVITATION_COLUMNS,
  mapProjectRow,
  openInvitations,
  PROJECT_COLUMNS,
  readOwnersByTenant,
  type AdminOwner,
  type AdminProject,
} from '@/lib/api/admin-dashboard/shared'

/** Start of the Nth request week back from `now` (1 = this week's start), ISO. Matches the client Home's 7-day windows. */
export function requestWindowStart(now: number, weeksBack: number): string {
  return new Date(now - weeksBack * REQUEST_WEEK_DAYS * 86400 * 1000).toISOString()
}

/** Pure: head-count results → the requests glance (a missing count reads as 0). */
export function requestsGlanceFromCounts(c: { open: number | null; week: number | null; previousWeek: number | null }): RequestsGlance {
  return { open: c.open ?? 0, week: c.week ?? 0, previousWeek: c.previousWeek ?? 0 }
}

export type AdminLatestPost = { id: string; title: string | null; thumb: string | null; status: 'published' | 'scheduled'; publishedAt: string | null }
export type AdminLatestGallery = { id: string; title: string | null; thumb: string | null; count: number }

export type AdminProjectContent = {
  enabledModuleIds: string[]
  defaultLocale: string | null
  supportedLocales: string[]
  posts: BlogGlance
  latestPosts: AdminLatestPost[]
  galleryCount: number
  latestGalleries: AdminLatestGallery[]
  media: MediaGlance
}

export type AdminProjectInvitation = {
  id: string
  email: string
  role: string
  /** 'tenant' = for the whole client (Owner / member), 'project' = this site only. */
  scope: 'tenant' | 'project'
  createdAt: string
  expiresAt: string
  expired: boolean
}

export type AdminProjectDetail = {
  project: AdminProject
  /** False when the Owners read failed (`project.owners` is then empty, not "no owner"). */
  ownersKnown: boolean
  site: SiteStatusData
  /** Sanity overview; null when it failed. */
  content: AdminProjectContent | null
  /** Contact requests at a glance; null when forms is not installed, unknown, or the read failed. */
  requests: RequestsGlance | null
  /** Open invitations; null when the read failed. */
  invitations: AdminProjectInvitation[] | null
}

type OverviewRow = {
  project?: { enabledModuleIds?: string[] | null; customDomain?: string | null } | null
  site?: { defaultLocale?: string | null; supportedLocales?: string[] | null } | null
  posts?: { _id: string; status: DashboardPostStatus }[] | null
  latestPosts?: { _id: string; title?: unknown; publishedAt?: string | null; status?: string; coverUrl?: string | null; coverHotspot?: { x?: unknown; y?: unknown } | null }[] | null
  galleryCount?: number | null
  latestGalleries?: { _id: string; title?: unknown; internalName?: unknown; count?: number | null; coverUrl?: string | null; coverHotspot?: { x?: unknown; y?: unknown } | null }[] | null
  mediaTotal?: number | null
  mediaAlts?: unknown[] | null
}

/** Pure: the Sanity overview row → what the page shows. Titles in the viewer's language, then the site's. */
export function summarizeOverview(row: OverviewRow | null, locale: string): AdminProjectContent {
  const defaultLocale = row?.site?.defaultLocale || null
  const lang = defaultLocale ?? locale
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() || null : resolveLocalized(v as Record<string, unknown> | null, locale, lang))
  return {
    enabledModuleIds: [...new Set((row?.project?.enabledModuleIds ?? []).filter((m): m is string => typeof m === 'string'))],
    defaultLocale,
    supportedLocales: (row?.site?.supportedLocales ?? []).filter((l): l is string => typeof l === 'string'),
    posts: blogGlance(row?.posts ?? [], null),
    latestPosts: (row?.latestPosts ?? []).map((p) => ({
      id: p._id,
      title: text(p.title),
      thumb: coverThumbUrl(p.coverUrl, p.coverHotspot, 96),
      status: p.status === 'scheduled' ? 'scheduled' : 'published',
      publishedAt: p.publishedAt ?? null,
    })),
    galleryCount: typeof row?.galleryCount === 'number' ? row.galleryCount : 0,
    latestGalleries: (row?.latestGalleries ?? []).map((g) => ({
      id: g._id,
      title: text(g.title) ?? text(g.internalName),
      thumb: coverThumbUrl(g.coverUrl, g.coverHotspot, 96),
      count: typeof g.count === 'number' ? g.count : 0,
    })),
    media: summarizeMedia({ defaultLocale: lang, total: row?.mediaTotal ?? null, alts: row?.mediaAlts ?? [] }, null).glance,
  }
}

/** Pure: the invitations that concern this project — its own and its client's — newest first. */
export function projectInvitations(
  rows: ReturnType<typeof openInvitations>,
  project: Pick<AdminProject, 'id' | 'tenantId'>,
  now = Date.now(),
): AdminProjectInvitation[] {
  return rows
    .filter((i) => (i.scope === 'project' ? i.projectId === project.id : i.tenantId === project.tenantId))
    .map((i) => ({ id: i.id, email: i.email, role: i.role, scope: i.scope, createdAt: i.createdAt, expiresAt: i.expiresAt, expired: Date.parse(i.expiresAt) <= now }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getAdminProject(slug: string, opts: { locale: string; now?: number }): Promise<AdminProjectDetail | null> {
  await assertAbluoAdmin()
  if (!slug || slug.length > 200) return null
  const admin = createAdminClient()
  const now = opts.now ?? Date.now()

  const { data: row, error } = await admin.from('projects').select(PROJECT_COLUMNS).eq('slug', slug).limit(2)
  if (error) throw new Error(`admin project: ${error.message}`)
  // `projects.slug` is unique per tenant (migration 023); two clients sharing a slug is ambiguous → treat as unknown.
  if (!row || row.length !== 1) return null
  const base = mapProjectRow(row[0] as Record<string, unknown>)

  const [owners, invites, content] = await Promise.all([
    settle('admin.project.owners', () => readOwnersByTenant(admin, [base.tenantId])),
    settle('admin.project.invitations', async () => {
      const { data, error: e } = await admin
        .from('invitations')
        .select(INVITATION_COLUMNS)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .or(`project_id.eq.${base.id},tenant_id.eq.${base.tenantId}`)
      if (e) throw new Error(e.message)
      return openInvitations((data ?? []) as Record<string, unknown>[])
    }),
    settle('admin.project.sanity', async () =>
      summarizeOverview(await tenantClient(asProjectSlug(base.slug)).fetchForTenant<OverviewRow | null>(adminProjectOverviewQuery, {}), opts.locale),
    ),
  ])

  const requests =
    content?.enabledModuleIds.includes('forms')
      ? await settle('admin.project.requests', async () => {
          // Exact head counts — no rows read, so no 1000-row (or 200-row) ceiling.
          const count = () =>
            admin
              .from('form_submissions')
              .select('id', { count: 'exact', head: true })
              .eq('project_id', base.id)
              .eq('completion_state', 'complete')
              .neq('status', 'spam')
          const [open, week, previousWeek] = await Promise.all([
            count().eq('status', 'new'),
            count().gte('created_at', requestWindowStart(now, 1)),
            count().gte('created_at', requestWindowStart(now, 2)).lt('created_at', requestWindowStart(now, 1)),
          ])
          const failed = open.error ?? week.error ?? previousWeek.error
          if (failed) throw new Error(failed.message)
          return requestsGlanceFromCounts({ open: open.count, week: week.count, previousWeek: previousWeek.count })
        })
      : null

  const ownerList: AdminOwner[] = owners?.get(base.tenantId) ?? []
  return {
    project: { ...base, owners: ownerList },
    ownersKnown: owners !== null,
    site: siteStatusFrom(hostsForProjectId(base.id), liveSiteUrl(base.customDomain)?.slice('https://'.length) ?? null),
    content,
    requests,
    invitations: invites ? projectInvitations(invites, base) : null,
  }
}

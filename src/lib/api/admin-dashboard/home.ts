// Server-only: service-role reads; never import from a client component.
/**
 * Admin provider — Home, the cross-project summary (ADR-030 §5.1). Supabase
 * only (projects, Owners, open invitations, unanswered contact requests), so
 * Home costs a handful of queries however many projects there are; nothing
 * per project is read from Sanity. Each source is settled on its own: one
 * failing leaves its tile out and marks the attention list incomplete.
 *
 * Not on Home (deliberately): "photos without a description" — that needs a
 * Sanity read per project; it is shown per project on the project page.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { settle } from '@/lib/api/dashboard/settle'
import { assertAbluoAdmin, readAllProjects } from '@/lib/api/admin-dashboard/projects'
import { INVITATION_COLUMNS, openInvitations, type AdminProject, type OpenInvitationRow } from '@/lib/api/admin-dashboard/shared'
import { readAllRows, readAllRowsOrThrow } from '@/lib/supabase/read-all'
import {
  buildAdminAttention,
  pendingInvitationCount,
  REQUEST_WAITING_HOURS,
  type AdminAttentionItem,
  type AttentionInvitation,
  type AttentionRequest,
} from '@/lib/admin/attention'
import { countProjectsByStatus } from '@/lib/admin/projects-filter'

/**
 * Safety net on the rows read for the "requests waiting" attention item (only
 * requests unanswered for more than REQUEST_WAITING_HOURS are read). Past it
 * the attention list is marked incomplete. The tile counts are exact head
 * counts and never capped.
 */
export const ADMIN_WAITING_REQUESTS_MAX_ROWS = 20000

const HOUR_MS = 3600 * 1000

export type AdminHomeData = {
  /** null when the projects read failed. */
  projectCounts: ReturnType<typeof countProjectsByStatus> | null
  /** Unanswered (status "new") contact requests across every project (exact counts); null when the read failed. */
  requests: { total: number; week: number } | null
  /** Open invitations that have not expired; null when the read failed. */
  pendingInvitations: number | null
  attention: AdminAttentionItem[]
  /** False when a source failed — the page must not say "All caught up". */
  attentionComplete: boolean
}

/** Pure: where an invitation leads — its project, or the first project of its client. */
export function invitationTarget(i: Pick<OpenInvitationRow, 'projectId' | 'tenantId'>, projects: readonly Pick<AdminProject, 'id' | 'slug' | 'name' | 'tenantId'>[]): AttentionInvitation['target'] {
  const p = i.projectId ? projects.find((x) => x.id === i.projectId) : projects.find((x) => x.tenantId === i.tenantId)
  return p ? { slug: p.slug, name: p.name } : null
}

export async function getAdminHome(now = Date.now()): Promise<AdminHomeData> {
  await assertAbluoAdmin()
  const admin = createAdminClient()

  const [projects, invites, requests] = await Promise.all([
    settle('admin.home.projects', async () => {
      const r = await readAllProjects()
      if (r.error) throw new Error(r.error)
      return r
    }),
    settle('admin.home.invitations', async () => {
      const rows = await readAllRowsOrThrow<Record<string, unknown>>('invitations', (from, to) =>
        admin.from('invitations').select(INVITATION_COLUMNS).is('accepted_at', null).is('revoked_at', null).order('id').range(from, to),
      )
      return openInvitations(rows)
    }),
    settle('admin.home.requests', async () => {
      // Counts are head counts (exact past PostgREST's 1000-row cap); rows are
      // read only for the attention rule, and only the ones old enough to count.
      const unanswered = () =>
        admin.from('form_submissions').select('id', { count: 'exact', head: true }).eq('status', 'new').eq('completion_state', 'complete')
      const [total, week, waiting] = await Promise.all([
        unanswered(),
        unanswered().gte('created_at', new Date(now - 7 * 24 * HOUR_MS).toISOString()),
        readAllRows<Record<string, unknown>>(
          (from, to) =>
            admin
              .from('form_submissions')
              .select('id, project_id, created_at')
              .eq('status', 'new')
              .eq('completion_state', 'complete')
              .lt('created_at', new Date(now - REQUEST_WAITING_HOURS * HOUR_MS).toISOString())
              .order('created_at')
              .order('id')
              .range(from, to),
          { maxRows: ADMIN_WAITING_REQUESTS_MAX_ROWS },
        ),
      ])
      const failed = total.error ?? week.error
      if (failed) throw new Error(failed.message)
      if (waiting.error) throw new Error(waiting.error.message)
      return {
        counts: { total: total.count ?? 0, week: week.count ?? 0 },
        waiting: waiting.rows.map((r): AttentionRequest => ({ projectId: String(r.project_id), createdAt: String(r.created_at) })),
        waitingComplete: !waiting.capped,
      }
    }),
  ])

  const list = projects?.projects ?? []
  const attentionProjects = list.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    status: p.status,
    createdAt: p.createdAt,
    // Unknown owners (read failed) must not raise a false "no owner" item.
    ownerCount: projects?.ownersKnown ? p.owners.length : Number.POSITIVE_INFINITY,
  }))
  const attentionInvites = invites?.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt, target: invitationTarget(i, list) })) ?? null

  return {
    projectCounts: projects ? countProjectsByStatus(list) : null,
    requests: requests?.counts ?? null,
    pendingInvitations: invites ? pendingInvitationCount(invites, now) : null,
    attention: buildAdminAttention({ projects: attentionProjects, invitations: attentionInvites, requests: requests?.waiting ?? null }, now),
    attentionComplete: projects !== null && projects.ownersKnown && invites !== null && requests !== null && requests.waitingComplete,
  }
}

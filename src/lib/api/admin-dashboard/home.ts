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
import {
  buildAdminAttention,
  pendingInvitationCount,
  unansweredRequestCounts,
  type AdminAttentionItem,
  type AttentionInvitation,
  type AttentionRequest,
} from '@/lib/admin/attention'
import { countProjectsByStatus } from '@/lib/admin/projects-filter'

/** Unanswered requests read for Home (newest first). Far above today's volume; the count says "N+" past it. */
export const ADMIN_REQUESTS_READ_LIMIT = 2000

export type AdminHomeData = {
  /** null when the projects read failed. */
  projectCounts: ReturnType<typeof countProjectsByStatus> | null
  /** Unanswered (status "new") contact requests across every project; null when the read failed. */
  requests: { total: number; week: number; capped: boolean } | null
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
      const { data, error } = await admin.from('invitations').select(INVITATION_COLUMNS).is('accepted_at', null).is('revoked_at', null)
      if (error) throw new Error(error.message)
      return openInvitations((data ?? []) as Record<string, unknown>[])
    }),
    settle('admin.home.requests', async () => {
      const { data, error } = await admin
        .from('form_submissions')
        .select('project_id, created_at')
        .eq('status', 'new')
        .eq('completion_state', 'complete')
        .order('created_at', { ascending: false })
        .limit(ADMIN_REQUESTS_READ_LIMIT)
      if (error) throw new Error(error.message)
      return ((data ?? []) as Record<string, unknown>[]).map((r): AttentionRequest => ({ projectId: String(r.project_id), createdAt: String(r.created_at) }))
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
    requests: requests ? { ...unansweredRequestCounts(requests, now), capped: requests.length >= ADMIN_REQUESTS_READ_LIMIT } : null,
    pendingInvitations: invites ? pendingInvitationCount(invites, now) : null,
    attention: buildAdminAttention({ projects: attentionProjects, invitations: attentionInvites, requests }, now),
    attentionComplete: projects !== null && projects.ownersKnown && invites !== null && requests !== null,
  }
}

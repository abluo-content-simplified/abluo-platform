'use server'

/**
 * Home — "Hide checklist" / "Show checklist" (the setup checklist, per person per project).
 *
 * The person is the session's user; the project is resolved from the caller's
 * own grants (a slug they hold no grant on is refused before any I/O). The
 * write goes through their own session client, where RLS (migration 039)
 * again allows only their own row on a project they belong to. Showing it
 * again deletes that row with the service role (people may not delete),
 * after the same checks, pinned to this user and this grant's project.
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import { SETUP_CHECKLIST_DISMISSAL, clearDismissal, writeDismissal } from '@/lib/api/dashboard/dismissals'

export type DismissResult = { ok: true } | { ok: false; error: 'forbidden' | 'failed' }

export async function hideSetupChecklistAction(input: { projectSlug: string }): Promise<DismissResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: 'forbidden' }
  const { ctx, grant } = access
  const saved = await writeDismissal(ctx.userId, grant.projectId, SETUP_CHECKLIST_DISMISSAL)
  return saved ? { ok: true } : { ok: false, error: 'failed' }
}

export async function showSetupChecklistAction(input: { projectSlug: string }): Promise<DismissResult> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: 'forbidden' }
  const { ctx, grant } = access
  const cleared = await clearDismissal(ctx.userId, grant.projectId, SETUP_CHECKLIST_DISMISSAL)
  return cleared ? { ok: true } : { ok: false, error: 'failed' }
}

'use server'

/**
 * Home — "Hide checklist" (the setup checklist, per person per project).
 *
 * The person is the session's user; the project is resolved from the caller's
 * own grants (a slug they hold no grant on is refused before any I/O). The
 * write goes through their own session client, where RLS (migration 039)
 * again allows only their own row on a project they belong to.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { SETUP_CHECKLIST_DISMISSAL, writeDismissal } from '@/lib/api/dashboard/dismissals'

export type DismissResult = { ok: true } | { ok: false; error: 'forbidden' | 'failed' }

export async function hideSetupChecklistAction(input: { projectSlug: string }): Promise<DismissResult> {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'forbidden' }
  const slug = typeof input?.projectSlug === 'string' ? input.projectSlug : ''
  const grant = slug ? resolveProjectGrant(ctx.projects, slug) : null
  if (!grant) return { ok: false, error: 'forbidden' }
  const saved = await writeDismissal(ctx.userId, grant.projectId, SETUP_CHECKLIST_DISMISSAL)
  return saved ? { ok: true } : { ok: false, error: 'failed' }
}

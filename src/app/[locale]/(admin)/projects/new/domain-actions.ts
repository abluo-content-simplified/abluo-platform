'use server'

/**
 * Setup page "What's next" — save the project's own domain and switch it live
 * (Tom, 2026-11-05: no more editing Supabase by hand). `requireAbluoAdmin()`
 * first, every change in the admin audit log. Routing still changes only
 * after `npm run routes:generate` + a deploy; the screen says so.
 */
import { requireAbluoAdmin } from '@/lib/api/auth'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/provisioning/model'
import { saveProjectDomain, setProjectLive, type DomainError } from '@/lib/admin/project-launch'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanityWriteClient } from '@/lib/sanity/server-clients'

export type DomainActionError = 'forbidden' | DomainError

export async function saveProjectDomainAction(input: { projectId: string; domain: string }): Promise<{ ok: true; domain: string | null } | { ok: false; error: DomainActionError }> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (!isUuid(input?.projectId)) return { ok: false, error: 'not_found' }
  const r = await saveProjectDomain(createAdminClient(), sanityWriteClient as never, input.projectId, input?.domain ?? '')
  if (r.ok) await recordAdminAudit({ actorId: actor.userId, action: 'project.domain.update', projectId: input.projectId, detail: { domain: r.domain } })
  return r
}

export async function setProjectLiveAction(input: { projectId: string; live: boolean }): Promise<{ ok: true; status: 'active' | 'preview' } | { ok: false; error: DomainActionError }> {
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (!isUuid(input?.projectId)) return { ok: false, error: 'not_found' }
  const r = await setProjectLive(createAdminClient(), sanityWriteClient as never, input.projectId, input?.live)
  if (r.ok) await recordAdminAudit({ actorId: actor.userId, action: 'project.status.update', projectId: input.projectId, detail: { status: r.status } })
  return r
}

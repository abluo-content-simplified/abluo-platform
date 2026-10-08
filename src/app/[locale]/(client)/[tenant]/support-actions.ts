'use server'

/**
 * Support mode actions inside the client dashboard (ADR-028 §8,
 * docs/engineering/support-mode.md).
 *
 *   Admin (support banner): exit · ask to make changes · show contact requests.
 *     Each runs `requireAbluoAdmin()` (abluo_admin + two-factor) first and acts
 *     only on the visit named by the admin's own httpOnly cookie AND owned by
 *     that admin — never on an id from the form.
 *
 *   Client (support notice): allow · decline · end access.
 *     The caller's context comes from getTenantAuthorizationContext() (default
 *     purpose = mutation). Refused inside a support visit (an admin can never
 *     approve their own request) and for anyone without `users.manage` on the
 *     project (Owner / Site admin). The database function re-checks all of it.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { can } from '@/lib/authz/check'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  exitSupportVisit,
  decideSupportVisit,
  readSupportCookie,
  requestSupportEdit,
  showContactRequests,
} from '@/lib/support/server'
import type { ClientDecision } from '@/lib/support/state'

const DECISIONS: readonly ClientDecision[] = ['allow', 'decline', 'revoke']

const refreshDashboard = () => revalidatePath('/[locale]/[tenant]', 'layout')

/** Admin leaves support mode → back to the project's admin page. */
export async function exitSupportAction(): Promise<void> {
  const actor = await requireAbluoAdmin()
  const locale = await getLocale()
  const sessionId = await readSupportCookie()
  if (!actor) {
    // Not an admin (any more): still drop the cookie — it grants nothing without the admin check.
    await exitSupportVisit({ userId: '' }, null)
    redirect('/login')
  }
  const r = await exitSupportVisit(actor, sessionId)
  redirect(r.ok && r.projectSlug ? `/${locale}/projects/${encodeURIComponent(r.projectSlug)}` : `/${locale}/projects`)
}

/** Admin asks the client for edit access. */
export async function requestSupportEditAction(): Promise<{ ok: boolean }> {
  const actor = await requireAbluoAdmin()
  const sessionId = await readSupportCookie()
  if (!actor || !sessionId) return { ok: false }
  const r = await requestSupportEdit(actor, sessionId)
  refreshDashboard()
  return { ok: r.ok }
}

/** Admin reveals contact requests for this visit — a separate, logged event. */
export async function showContactRequestsAction(): Promise<{ ok: boolean }> {
  const actor = await requireAbluoAdmin()
  const sessionId = await readSupportCookie()
  if (!actor || !sessionId) return { ok: false }
  const r = await showContactRequests(actor, sessionId)
  refreshDashboard()
  return { ok: r.ok }
}

/** The client's Owner / Site admin allows, declines or ends support edit access. */
export async function decideSupportAction(input: { projectSlug: string; sessionId: string; decision: string }): Promise<{ ok: boolean }> {
  const decision = input?.decision as ClientDecision
  if (!DECISIONS.includes(decision) || typeof input.projectSlug !== 'string' || typeof input.sessionId !== 'string') return { ok: false }

  const ctx = await getTenantAuthorizationContext()
  if (!ctx || ctx.support) return { ok: false }
  const grant = resolveProjectGrant(ctx.projects, input.projectSlug)
  if (!grant || !can(ctx, 'users.manage', { kind: 'project', projectId: grant.projectId })) return { ok: false }

  const r = await decideSupportVisit({ userId: ctx.userId }, grant.projectId, input.sessionId, decision)
  refreshDashboard()
  return { ok: r.ok }
}

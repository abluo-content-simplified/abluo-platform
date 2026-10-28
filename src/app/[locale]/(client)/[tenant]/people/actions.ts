'use server'

/**
 * Client dashboard — People (ADR-028). Every action re-resolves the caller's
 * grants server-side and re-validates the URL project; the services decide
 * with checkGrant before any write. Results are small codes the screen maps
 * to localized text.
 */
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { resolveProjectAction } from '@/lib/api/project-action'
import { createInvitation } from '@/lib/invitations/service'
import { mayTransferOwnership, tenantOfProject, transferOwnership } from '@/lib/people/ownership'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import {
  archiveProjectMember,
  cancelProjectInvitation,
  resendProjectInvitation,
  restoreProjectMember,
  updateProjectMember,
} from '@/lib/people/service'

export type PeopleActionResult = { ok: true; emailSent?: boolean } | { ok: false; error: string }

async function scope(projectSlug: string) {
  const access = await resolveProjectAction(projectSlug)
  return access.ok ? { ctx: access.ctx, grant: access.grant } : null
}

async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
    return host ? `${proto}://${host}` : null // validated against Abluo hosts by invitationOrigin()
  } catch {
    return null // outside a request (tests): the link falls back to https://abluo.app
  }
}

const refresh = (locale: string, projectSlug: string) => revalidatePath(`/${locale}/${projectSlug}/people`)

export async function invitePersonAction(input: {
  projectSlug: string
  locale: string
  email: string
  role: string
  extras: string[]
}): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await createInvitation(s.ctx, {
    target: { scope: 'project', projectId: s.grant.projectId },
    email: input.email,
    role: input.role,
    extras: input.extras,
    locale: input.locale,
    requestOrigin: await requestOrigin(),
  })
  if (!r.ok) return { ok: false, error: r.error }
  refresh(input.locale, input.projectSlug)
  return { ok: true, emailSent: r.emailSent }
}

export async function cancelInvitationAction(input: { projectSlug: string; locale: string; invitationId: string }): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await cancelProjectInvitation(s.ctx, s.grant.projectId, input.invitationId)
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true }
}

export async function updatePersonAction(input: {
  projectSlug: string
  locale: string
  membershipId: string
  role: string
  extras: string[]
}): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await updateProjectMember(s.ctx, s.grant.projectId, input.membershipId, { role: input.role, extras: input.extras })
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true }
}

/** Archive: access ends at once; the person stays in the list as Archived (ADR-028, migration 031). */
export async function archivePersonAction(input: { projectSlug: string; locale: string; membershipId: string }): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await archiveProjectMember(s.ctx, s.grant.projectId, input.membershipId)
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true }
}

export async function restorePersonAction(input: { projectSlug: string; locale: string; archiveId: string }): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await restoreProjectMember(s.ctx, s.grant.projectId, input.archiveId, { locale: input.locale, requestOrigin: await requestOrigin() })
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true, emailSent: r.emailSent }
}

export async function resendInvitationAction(input: { projectSlug: string; locale: string; invitationId: string }): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  const r = await resendProjectInvitation(s.ctx, s.grant.projectId, input.invitationId, { locale: input.locale, requestOrigin: await requestOrigin() })
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true, emailSent: r.emailSent }
}

/**
 * "Make owner" (PLAT-2): an Owner of this client makes a person who is already
 * in it an Owner, optionally stepping down to Site admin on every site. Only
 * an Owner passes (never a support visit); the client comes from the project
 * row, never from the browser.
 */
export async function makeOwnerAction(input: {
  projectSlug: string
  locale: string
  userId: string
  stepDown: boolean
}): Promise<PeopleActionResult> {
  const s = await scope(input.projectSlug)
  if (!s) return { ok: false, error: 'forbidden' }
  // Before any service-role read: the caller must be an Owner of SOME client.
  if (!(s.ctx.tenants ?? []).some((t) => mayTransferOwnership(s.ctx, t.tenantId))) return { ok: false, error: 'forbidden' }
  const place = await runAsTrustedSystemOperation(
    `people: client of project ${s.grant.projectId} for "Make owner" by user ${s.ctx.userId} — caller is an Owner of a client`,
    (admin) => tenantOfProject(admin, s.grant.projectId)
  )
  if (!place) return { ok: false, error: 'not_found' }
  const r = await transferOwnership(s.ctx, {
    tenantId: place.tenantId,
    newOwnerUserId: input.userId,
    stepDownUserId: input.stepDown === true ? s.ctx.userId : null,
    locale: input.locale,
    requestOrigin: await requestOrigin(),
    projectSlug: place.slug,
  })
  if (!r.ok) return r
  refresh(input.locale, input.projectSlug)
  return { ok: true, emailSent: r.emailsSent > 0 }
}

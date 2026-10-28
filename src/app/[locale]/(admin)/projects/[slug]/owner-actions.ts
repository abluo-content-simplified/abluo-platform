'use server'

/**
 * "Invite Owner" on the admin project page — invite a person to the project's
 * CLIENT (tenant) as Owner (ADR-028 §4/§6). The same decision as
 * POST /api/tenants/[tenantId]/invite: `requireAbluoAdmin()` (abluo_admin +
 * two-factor) runs FIRST and refuses anything else; the invitation record, the
 * email and the acceptance (with a fresh no-escalation check) stay in
 * src/lib/invitations. No membership is created here — only accepting the
 * emailed link does that.
 *
 * The client is derived server-side from the project id (never taken from the
 * browser). Before sending, two checks `createInvitation` does not do:
 *   - the email is already an Owner of this client → `already_owner`;
 *   - an open invitation for that email and client exists → `already_invited`
 *     (createInvitation would silently replace it and email again), unless the
 *     admin explicitly asks to send a new one (`sendAgain`).
 */
import { headers } from 'next/headers'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { readOwnersByTenant } from '@/lib/api/admin-dashboard/shared'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid, ownerInviteOrigin } from '@/lib/admin/provisioning/model'
import { createInvitation, normalizeEmail } from '@/lib/invitations/service'
import { createAdminClient } from '@/lib/supabase/admin'
import { INTERFACE_LOCALES, type InterfaceLocale } from '@/lib/i18n/locales'

export type InviteOwnerError = 'forbidden' | 'invalid_email' | 'not_found' | 'already_owner' | 'already_invited' | 'failed'

export type InviteOwnerResult =
  | { ok: true; email: string; emailSent: boolean }
  | { ok: false; error: InviteOwnerError; expiresAt?: string; role?: string }

async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host')
    const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')
    return host ? `${proto}://${host}` : null // restricted to Abluo hosts by invitationOrigin()
  } catch {
    return null
  }
}

function emailLocale(v: unknown): InterfaceLocale {
  return (INTERFACE_LOCALES as readonly string[]).includes(v as string) ? (v as InterfaceLocale) : 'en'
}

export async function inviteOwnerAction(input: {
  projectId?: unknown
  email?: unknown
  locale?: unknown
  sendAgain?: unknown
}): Promise<InviteOwnerResult> {
  // 1. Super Admin with two-factor — before anything else.
  const actor = await requireAbluoAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return { ok: false, error: 'forbidden' }

  // 2. Input.
  if (!isUuid(input?.projectId)) return { ok: false, error: 'not_found' }
  const email = normalizeEmail(input?.email)
  if (!email) return { ok: false, error: 'invalid_email' }
  const locale = emailLocale(input?.locale)
  const projectId = input.projectId

  try {
    const db = createAdminClient()
    // 3. The client, from the project row (never from the browser).
    const { data: project, error: projectError } = await db.from('projects').select('id, slug, tenant_id').eq('id', projectId).maybeSingle()
    if (projectError) return { ok: false, error: 'failed' }
    if (!project?.tenant_id) return { ok: false, error: 'not_found' }
    const tenantId = project.tenant_id as string

    // 4. Already an Owner?
    const owners = (await readOwnersByTenant(db, [tenantId])).get(tenantId) ?? []
    if (owners.some((o) => (o.email ?? '').toLowerCase() === email)) return { ok: false, error: 'already_owner' }

    // 5. An open invitation for this person and client? Say so instead of emailing again.
    if (input.sendAgain !== true) {
      const { data: open, error: openError } = await db
        .from('invitations')
        .select('id, role, expires_at')
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .limit(1)
      if (openError) return { ok: false, error: 'failed' }
      const existing = (open ?? [])[0] as { role?: string; expires_at?: string } | undefined
      if (existing) return { ok: false, error: 'already_invited', expiresAt: existing.expires_at, role: existing.role }
    }

    // 6. Send — the invitation service re-checks the grant (adminAssured only after requireAbluoAdmin above).
    const r = await createInvitation(ctx, {
      target: { scope: 'tenant', tenantId },
      email,
      role: 'owner',
      locale,
      requestOrigin: ownerInviteOrigin(await requestOrigin()),
      adminAssured: true,
    })
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'owner.invite',
      projectId: project.id as string,
      detail: r.ok ? { tenantId, locale, emailSent: r.emailSent, sendAgain: input.sendAgain === true } : { tenantId, error: r.error },
    })
    if (!r.ok) return { ok: false, error: r.error === 'forbidden' || r.error === 'not_found' || r.error === 'invalid_email' ? r.error : 'failed' }
    return { ok: true, email, emailSent: r.emailSent }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

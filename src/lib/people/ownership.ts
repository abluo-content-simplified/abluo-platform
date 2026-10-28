/**
 * Transfer ownership of a client — PLAT-2 (ADR-028). Server-only.
 *
 * "Make owner": an Owner of the client (from People), or a Super Admin with a
 * two-factor session (from the admin project page), makes a person who is
 * ALREADY in the client an Owner. Optionally one current Owner steps down: they
 * become a Member of the client and Site admin on every one of its sites —
 * what was done by hand for Hoffmann on 2026-10-21.
 *
 * Rules, all checked here BEFORE any write and again by the database:
 *   - who: `checkGrant` for a tenant-level change to 'owner' — an Owner of
 *     this client, or a Super Admin only when `adminAssured` (requireAbluoAdmin
 *     passed on this request). A support visit never (ADR-028 §8: never
 *     people). Nobody else, and no escalation.
 *   - an Owner may only step THEMSELVES down; a Super Admin may pick any
 *     current Owner;
 *   - the new Owner must already have an account and be in the client (a
 *     tenant row, or a site row on one of the client's sites) — otherwise
 *     nothing is written;
 *   - the client is never left without an Owner (`leavesTenantWithoutOwner`;
 *     the migration-029 trigger and the 056 function also refuse it).
 *
 * The role changes and the access-history rows are ONE database transaction:
 * `tenant_transfer_ownership` (migration 056). Until 056 is applied the call
 * fails closed with `not_ready` and nothing changes.
 *
 * After the change, both sides get an email (the new Owner, and the Owners
 * before the change) — production only, en/it/de.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { checkGrant, leavesTenantWithoutOwner } from '@/lib/authz/grant-rules'
import { granterForTenant } from '@/lib/authz/granter'
import { isTenantOwnerRole } from '@/lib/authz/roles'
import { getAppEnvironment, type AppEnvironment } from '@/lib/notifications/environment'
import { sendEmail } from '@/lib/notifications/resend'
import { renderOwnershipEmail } from '@/lib/invitations/email'
import { invitationLocale } from '@/lib/invitations/messages'
import { invitationOrigin, loadPerson, loadPlace, oneLine } from '@/lib/invitations/service'

export type OwnershipError =
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'not_member'
  | 'already_owner'
  | 'not_owner'
  | 'last_owner'
  | 'not_ready'
  | 'failed'

export type OwnershipResult = { ok: true; emailsSent: number } | { ok: false; error: OwnershipError }

/** The database function of migration 056. */
export const TRANSFER_RPC = 'tenant_transfer_ownership'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

type Row = Record<string, unknown>

/**
 * May this caller make someone Owner of `tenantId`? Pure. Never in support
 * mode; a Super Admin only with `adminAssured` (2FA checked on this request).
 */
export function mayTransferOwnership(
  ctx: Pick<TenantAuthorizationContext, 'platformRole' | 'tenants' | 'support'>,
  tenantId: string,
  opts: { adminAssured?: boolean } = {}
): boolean {
  if (ctx.support) return false
  const granter = granterForTenant(ctx, tenantId, opts)
  if (!granter) return false
  return checkGrant(granter, { scope: 'tenant', action: 'change', role: 'owner', currentRole: 'member', extras: [] }).ok
}

/** Map a database refusal (`ownership:<code>`) or a missing function to a result code. */
export function ownershipErrorFrom(error: { code?: string; message?: string } | null | undefined): OwnershipError {
  const message = error?.message ?? ''
  // PostgREST: function not in the schema cache; Postgres: undefined function.
  if (error?.code === 'PGRST202' || error?.code === '42883' || /Could not find the function/i.test(message)) return 'not_ready'
  const code = /ownership:([a-z_]+)/.exec(message)?.[1]
  if (code === 'not_member' || code === 'already_owner' || code === 'not_owner' || code === 'not_found' || code === 'invalid') return code
  if (code === 'no_owner' || /at least one Owner/i.test(message)) return 'last_owner'
  return 'failed'
}

/** The client a project belongs to (service role; call only after a permission check). */
export async function tenantOfProject(admin: SupabaseClient, projectId: string): Promise<{ tenantId: string; slug: string } | null> {
  const { data } = await admin.from('projects').select('tenant_id, slug').eq('id', projectId).maybeSingle()
  return data?.tenant_id ? { tenantId: data.tenant_id as string, slug: (data.slug as string) ?? '' } : null
}

export async function transferOwnership(
  ctx: TenantAuthorizationContext,
  input: {
    tenantId: string
    newOwnerUserId: unknown
    /** The current Owner who steps down to Site admin; null = nobody. */
    stepDownUserId: unknown
    /** True only after requireAbluoAdmin() (Super Admin, 2FA) on this request. */
    adminAssured?: boolean
    locale: string
    requestOrigin?: string | null
    /** A site of the client, for the email's link. */
    projectSlug?: string | null
  },
  deps: { send?: typeof sendEmail; environment?: () => AppEnvironment } = {}
): Promise<OwnershipResult> {
  const adminAssured = input.adminAssured === true
  // 1. Who — before any I/O.
  if (!isUuid(input.tenantId) || !mayTransferOwnership(ctx, input.tenantId, { adminAssured })) return { ok: false, error: 'forbidden' }
  if (!isUuid(input.newOwnerUserId)) return { ok: false, error: 'invalid' }
  const stepDown = input.stepDownUserId === null || input.stepDownUserId === undefined || input.stepDownUserId === '' ? null : input.stepDownUserId
  if (stepDown !== null && !isUuid(stepDown)) return { ok: false, error: 'invalid' }
  if (stepDown === input.newOwnerUserId) return { ok: false, error: 'invalid' }
  // An Owner steps only themselves down; only a Super Admin may pick another Owner.
  if (stepDown !== null && !adminAssured && stepDown !== ctx.userId) return { ok: false, error: 'forbidden' }
  const tenantId = input.tenantId
  const newOwner = input.newOwnerUserId

  return runAsTrustedSystemOperation(
    `ownership: make ${newOwner} Owner of tenant ${tenantId} by user ${ctx.userId} — checkGrant(tenant change → owner) above`,
    async (admin) => {
      // 2. The client as it is now.
      const [{ data: tenantRows, error: tenantError }, { data: projects, error: projectsError }] = await Promise.all([
        admin.from('tenant_members').select('user_id, role').eq('tenant_id', tenantId),
        admin.from('projects').select('id, slug').eq('tenant_id', tenantId),
      ])
      if (tenantError || projectsError) return { ok: false as const, error: 'failed' as const }
      const projectIds = ((projects ?? []) as Row[]).map((p) => p.id as string)
      if (!projectIds.length && !(tenantRows ?? []).length) return { ok: false as const, error: 'not_found' as const }
      const owners = ((tenantRows ?? []) as Row[]).filter((r) => isTenantOwnerRole(r.role)).map((r) => r.user_id as string)
      if (owners.includes(newOwner)) return { ok: false as const, error: 'already_owner' as const }
      if (stepDown !== null && !owners.includes(stepDown)) return { ok: false as const, error: 'not_owner' as const }

      // 3. Already in the client — or nothing is written.
      let member = ((tenantRows ?? []) as Row[]).some((r) => r.user_id === newOwner)
      if (!member && projectIds.length) {
        const { data: siteRows, error } = await admin.from('project_members').select('id').eq('user_id', newOwner).in('project_id', projectIds).limit(1)
        if (error) return { ok: false as const, error: 'failed' as const }
        member = (siteRows ?? []).length > 0
      }
      if (!member) return { ok: false as const, error: 'not_member' as const }

      // 4. Never without an Owner.
      if (stepDown !== null && leavesTenantWithoutOwner({ ownerUserIds: [...owners, newOwner], userId: stepDown, newRole: 'member' })) {
        return { ok: false as const, error: 'last_owner' as const }
      }

      // 5. One transaction (migration 056): roles + access history.
      const { error: rpcError } = await admin.rpc(TRANSFER_RPC, {
        p_tenant_id: tenantId,
        p_new_owner: newOwner,
        p_actor: ctx.userId,
        p_step_down: stepDown,
        p_by_admin: adminAssured,
      })
      if (rpcError) {
        const error = ownershipErrorFrom(rpcError)
        if (error === 'not_ready') console.warn('ownership: database update 056 (tenant_transfer_ownership) is not applied — nothing changed')
        return { ok: false as const, error }
      }

      // 6. Tell both sides — production only, best effort (the change stands either way).
      if ((deps.environment ?? getAppEnvironment)() !== 'production') return { ok: true as const, emailsSent: 0 }
      const slug = input.projectSlug || ((projects ?? []) as Row[])[0]?.slug
      const emailsSent = await notifyOwnershipChange(admin, {
        tenantId,
        newOwner,
        previousOwners: owners,
        stepDown,
        actorId: ctx.userId,
        locale: input.locale,
        url: `${invitationOrigin(input.requestOrigin)}/${invitationLocale(input.locale)}/${slug ?? ''}/home`,
        send: deps.send ?? sendEmail,
      })
      return { ok: true as const, emailsSent }
    }
  )
}

async function notifyOwnershipChange(
  admin: SupabaseClient,
  p: { tenantId: string; newOwner: string; previousOwners: string[]; stepDown: string | null; actorId: string; locale: string; url: string; send: typeof sendEmail }
): Promise<number> {
  try {
    const [place, by, owner, ...previous] = await Promise.all([
      loadPlace(admin, { scope: 'tenant', tenantId: p.tenantId }),
      loadPerson(admin, p.actorId),
      loadPerson(admin, p.newOwner),
      ...p.previousOwners.map((id) => loadPerson(admin, id)),
    ])
    if (!place) return 0
    const byName = oneLine(by.name || by.email || 'Abluo')
    const placeName = oneLine(place.name)
    const ownerName = oneLine(owner.name || owner.email || '')
    const mails: Array<{ to: string; kind: 'newOwner' | 'previousOwner'; steppedDown: boolean }> = []
    if (owner.email) mails.push({ to: owner.email, kind: 'newOwner', steppedDown: false })
    p.previousOwners.forEach((id, i) => {
      const email = previous[i]?.email
      if (email && email !== owner.email) mails.push({ to: email, kind: 'previousOwner', steppedDown: id === p.stepDown })
    })
    let sent = 0
    for (const m of mails) {
      const mail = renderOwnershipEmail({ locale: p.locale, kind: m.kind, byName, ownerName, placeName, steppedDown: m.steppedDown, url: p.url })
      const r = await p.send({
        to: [m.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        fromName: `${byName} via Abluo`,
        replyTo: by.email ?? undefined,
      })
      if (r.ok) sent++
    }
    return sent
  } catch (e) {
    console.warn(`ownership: notification not sent: ${e instanceof Error ? e.message : String(e)}`)
    return 0
  }
}

/** People who may be made Owner of a client (in it, not yet Owner) and its current Owners — for the admin page. */
export async function listOwnershipCandidates(
  admin: SupabaseClient,
  tenantId: string
): Promise<{ candidates: Array<{ userId: string; name: string; email: string }>; ownerIds: string[] }> {
  const [{ data: tenantRows }, { data: projects }] = await Promise.all([
    admin.from('tenant_members').select('user_id, role').eq('tenant_id', tenantId),
    admin.from('projects').select('id').eq('tenant_id', tenantId),
  ])
  const ownerIds = ((tenantRows ?? []) as Row[]).filter((r) => isTenantOwnerRole(r.role)).map((r) => r.user_id as string)
  const projectIds = ((projects ?? []) as Row[]).map((p) => p.id as string)
  const { data: siteRows } = projectIds.length
    ? await admin.from('project_members').select('user_id').in('project_id', projectIds)
    : { data: [] as Row[] }
  const ids = [
    ...new Set([...((tenantRows ?? []) as Row[]).map((r) => r.user_id as string), ...((siteRows ?? []) as Row[]).map((r) => r.user_id as string)]),
  ].filter((id) => !ownerIds.includes(id))
  const people = await Promise.all(ids.map(async (userId) => ({ userId, ...(await loadPerson(admin, userId)) })))
  return {
    candidates: people
      .map((p) => ({ userId: p.userId, name: p.name, email: p.email ?? '' }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    ownerIds,
  }
}

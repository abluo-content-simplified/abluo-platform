/**
 * Who may open the client's Billing page, and what the page tells them
 * (ADR-041 D1, D9, D12; ADR-028 — `billing.manage` is the tenant Owner's,
 * `billing.invoice.read` is grantable). PURE: no I/O, safe for the layout,
 * the page and tests alike.
 *
 * Billing permissions are TENANT-scope (`ctx.tenants`), never part of a
 * project grant, so billing locks (which strip project write permissions)
 * can never take the page away from the person who has to pay.
 */
import { can } from '@/lib/authz/check'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { BillingStatusView } from '@/lib/admin/billing/types'

export const BILLING_MANAGE = 'billing.manage'
export const BILLING_INVOICE_READ = 'billing.invoice.read'

export type BillingAccess = {
  /** May pay and open the payment portal (Owner; never in a support visit). */
  canManage: boolean
  /** May see the page (Owner, or a member granted invoice access). */
  canView: boolean
}

type AccessCtx = Pick<TenantAuthorizationContext, 'userId' | 'platformRole' | 'projects' | 'tenants' | 'support'>

/** Does the person hold any billing permission at all? (cheap pre-check before a lookup) */
export function hasAnyBillingGrant(ctx: AccessCtx | null | undefined): boolean {
  return Boolean(ctx?.tenants?.some((t) => t.permissions.includes(BILLING_MANAGE) || t.permissions.includes(BILLING_INVOICE_READ)))
}

/** The person's billing standing on one client (tenant). */
export function billingAccess(ctx: AccessCtx | null | undefined, tenantId: string): BillingAccess {
  if (!ctx) return { canManage: false, canView: false }
  const scope = { kind: 'tenant' as const, tenantId }
  const manage = can(ctx, BILLING_MANAGE, scope)
  const read = can(ctx, BILLING_INVOICE_READ, scope)
  return { canManage: manage && !ctx.support, canView: manage || read }
}

/**
 * The client a project grant belongs to, when the grant itself says so (the
 * synthetic Owner / tenant-Member grants carry `tenant-owner:{id}` /
 * `tenant-member:{id}`). null for grants that do not.
 */
export function tenantIdOfGrant(grant: { membershipId: string }): string | null {
  const m = /^tenant-(?:owner|member):(.+)$/.exec(grant.membershipId)
  return m ? m[1] : null
}

/**
 * The billing permissions to add to a project grant when building the sidebar,
 * so the registry's Billing entry (`anyPermission`) shows for the people who
 * may open the page. The project's client comes from `projectTenantId` (read
 * server-side) or the grant itself; empty when neither names it.
 */
export function billingNavPermissions(ctx: AccessCtx | null | undefined, grant: { membershipId: string }, projectTenantId?: string | null): string[] {
  const tenantId = projectTenantId ?? tenantIdOfGrant(grant)
  if (!ctx || !tenantId) return []
  const scope = { kind: 'tenant' as const, tenantId }
  return [BILLING_MANAGE, BILLING_INVOICE_READ].filter((p) => can(ctx, p, scope))
}

// ── Copy decisions (pure; the strings live in messages/*.json) ──────────────

export type BillingSiteFacts = {
  status: BillingStatusView
  /** The agreement's arrangement; null = not billed. */
  arrangement: 'stripe' | 'manual' | 'complimentary' | null
  /** ISO timestamp or YYYY-MM-DD the site is paid up to; null if unknown / not paid. */
  paidUntil: string | null
  /** First-payment due date (ISO), while the clock has not started. */
  dueAt: string | null
  /** The last confirmed payment failure of the open episode (ISO), if any. */
  paymentFailedAt: string | null
}

/** Key under `clientDashboard.billing.sentence` plus its values. */
export type BillingSentence = { key: string; values?: { date?: string; daysLeft?: number } }

/** The one plain sentence that says where a site stands. */
export function billingSentence(site: BillingSiteFacts): BillingSentence {
  const { status, arrangement } = site
  if (!arrangement) return { key: 'notBilled' }
  switch (status.reason) {
    case 'complimentary':
      return { key: 'complimentary' }
    case 'override_allow':
      return { key: 'open' }
    case 'paid':
      return site.paidUntil ? { key: 'paidUntil', values: { date: site.paidUntil } } : { key: 'paid' }
    case 'before_due':
      return site.dueAt ? { key: 'firstPaymentDue', values: { date: site.dueAt } } : { key: 'notDue' }
    case 'invalid_record':
      return { key: 'checking' }
    case 'not_billed':
      return { key: 'notBilled' }
    default:
      break
  }
  if (status.state === 'locked' || status.state === 'review') return { key: 'paused' }
  if (status.state === 'reminder') return { key: 'paymentDue', values: { daysLeft: Math.max(0, status.daysLeft ?? 0) } }
  return { key: 'notDue' }
}

/** What the buttons for one site are. The server actions re-check everything. */
export function billingActions(site: Pick<BillingSiteFacts, 'status' | 'arrangement'>, access: BillingAccess): { pay: boolean; portal: boolean } {
  const stripe = site.arrangement === 'stripe'
  return {
    pay: access.canManage && stripe && site.status.reason !== 'paid',
    portal: access.canManage && stripe,
  }
}

export type CheckoutErrorCode = 'forbidden' | 'unavailable' | 'notBilled' | 'profileIncomplete' | 'vatNotVerified' | 'alreadySubscribed' | 'noIssuer' | 'failed'
export type PortalErrorCode = 'forbidden' | 'unavailable' | 'noCustomer' | 'failed'

/** Key under `clientDashboard.billing.errors` for a failed action — always a calm, human message. */
export function billingErrorKey(error: CheckoutErrorCode | PortalErrorCode): 'forbidden' | 'unavailable' | 'notBilled' | 'detailsCheck' | 'vatPending' | 'alreadySubscribed' | 'contactAbluo' | 'noCustomer' | 'failed' {
  switch (error) {
    case 'forbidden':
      return 'forbidden'
    case 'unavailable':
      return 'unavailable'
    case 'notBilled':
      return 'notBilled'
    case 'profileIncomplete':
      return 'detailsCheck'
    case 'vatNotVerified':
      return 'vatPending'
    case 'alreadySubscribed':
      return 'alreadySubscribed'
    case 'noIssuer':
      return 'contactAbluo'
    case 'noCustomer':
      return 'noCustomer'
    default:
      return 'failed'
  }
}

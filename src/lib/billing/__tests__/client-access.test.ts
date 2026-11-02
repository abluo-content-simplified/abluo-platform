import { describe, expect, it } from 'vitest'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { BillingStatusView } from '@/lib/admin/billing/types'
import { buildClientNavItems } from '@/lib/modules/client-navigation'
import {
  billingAccess,
  billingActions,
  billingErrorKey,
  billingNavPermissions,
  billingSentence,
  tenantIdOfGrant,
  type BillingSiteFacts,
} from '../client-access'

const TENANT = 't-1'
const ctxWith = (tenantPermissions: string[], extra: Partial<TenantAuthorizationContext> = {}): TenantAuthorizationContext => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: [],
  tenants: [{ tenantId: TENANT, role: 'owner', permissions: tenantPermissions }],
  ...extra,
})
const status = (over: Partial<BillingStatusView>): BillingStatusView => ({ state: 'ok', reason: 'paid', clockStartedAt: null, day: null, daysLeft: null, ...over })
const site = (over: Partial<BillingSiteFacts>): BillingSiteFacts => ({ status: status({}), arrangement: 'stripe', paidUntil: null, dueAt: null, paymentFailedAt: null, ...over })

describe('billingAccess', () => {
  it('Owner manages and views', () => {
    expect(billingAccess(ctxWith(['billing.manage', 'billing.invoice.read']), TENANT)).toEqual({ canManage: true, canView: true })
  })
  it('invoice access views but cannot manage', () => {
    expect(billingAccess(ctxWith(['billing.invoice.read']), TENANT)).toEqual({ canManage: false, canView: true })
  })
  it('nobody else sees anything, and another client is not this one', () => {
    expect(billingAccess(ctxWith([]), TENANT)).toEqual({ canManage: false, canView: false })
    expect(billingAccess(ctxWith(['billing.manage']), 'other')).toEqual({ canManage: false, canView: false })
    expect(billingAccess(null, TENANT)).toEqual({ canManage: false, canView: false })
  })
})

describe('navigation', () => {
  const grant = { membershipId: `tenant-owner:${TENANT}`, projectSlug: 'main' as never, permissions: ['site.details.read'], enabledModuleIds: [] as string[] }
  const nav = (ctx: TenantAuthorizationContext | null) =>
    buildClientNavItems({ ...grant, permissions: [...grant.permissions, ...billingNavPermissions(ctx, grant)] }).map((i) => i.moduleId)

  it('reads the client from the synthetic grants only', () => {
    expect(tenantIdOfGrant({ membershipId: 'tenant-owner:abc' })).toBe('abc')
    expect(tenantIdOfGrant({ membershipId: 'tenant-member:abc' })).toBe('abc')
    expect(tenantIdOfGrant({ membershipId: 'uuid-of-a-project-member' })).toBeNull()
  })
  it('shows Billing to the Owner and to invoice access, hides it from others', () => {
    expect(nav(ctxWith(['billing.manage', 'billing.invoice.read']))).toContain('billing')
    expect(nav(ctxWith(['billing.invoice.read']))).toContain('billing')
    expect(nav(ctxWith([]))).not.toContain('billing')
    expect(nav(null)).not.toContain('billing')
  })
  it('the Billing item points at /{project}/billing', () => {
    const item = buildClientNavItems({ ...grant, permissions: ['billing.manage'] }).find((i) => i.moduleId === 'billing')
    expect(item?.href).toBe('/main/billing')
  })
})

describe('buttons', () => {
  const owner = { canManage: true, canView: true }
  const viewer = { canManage: false, canView: true }
  it('Pay Now: Owner, stripe arrangement, not yet paid', () => {
    expect(billingActions(site({ status: status({ state: 'reminder', reason: 'awaiting_first_payment', daysLeft: 9 }) }), owner)).toEqual({ pay: true, portal: false })
    expect(billingActions(site({ status: status({ state: 'ok', reason: 'before_due' }) }), owner).pay).toBe(true)
  })
  it('no Pay Now once paid, but the portal stays', () => {
    expect(billingActions(site({}), owner)).toEqual({ pay: false, portal: true })
  })
  it('the portal appears only once a subscription exists (nothing to show before the first payment)', () => {
    const due = status({ state: 'reminder', reason: 'awaiting_first_payment', daysLeft: 9 })
    expect(billingActions(site({ status: due }), owner).portal).toBe(false)
    expect(billingActions(site({ status: due, paymentFailedAt: '2026-11-01T10:00:00Z' }), owner).portal).toBe(true)
    expect(billingActions(site({ status: due, paidUntil: '2026-12-01' }), owner).portal).toBe(true)
  })
  it('no buttons for invoice access, manual, complimentary or not billed', () => {
    expect(billingActions(site({ status: status({ state: 'locked', reason: 'awaiting_first_payment' }) }), viewer)).toEqual({ pay: false, portal: false })
    for (const arrangement of ['manual', 'complimentary', null] as const) {
      expect(billingActions(site({ arrangement, status: status({ state: 'reminder', reason: 'manual_overdue' }) }), owner)).toEqual({ pay: false, portal: false })
    }
  })
})

describe('sentence', () => {
  it('says where a site stands', () => {
    expect(billingSentence(site({ arrangement: null, status: status({ reason: 'not_billed' }) })).key).toBe('notBilled')
    expect(billingSentence(site({ status: status({ reason: 'complimentary' }), arrangement: 'complimentary' })).key).toBe('complimentary')
    expect(billingSentence(site({ paidUntil: '2028-01-01T00:00:00Z' }))).toEqual({ key: 'paidUntil', values: { date: '2028-01-01T00:00:00Z' } })
    expect(billingSentence(site({})).key).toBe('paid')
    expect(billingSentence(site({ status: status({ reason: 'before_due' }), dueAt: '2026-12-01T00:00:00Z' })).key).toBe('firstPaymentDue')
    expect(billingSentence(site({ status: status({ state: 'reminder', reason: 'awaiting_first_payment', daysLeft: 9 }) }))).toEqual({ key: 'paymentDue', values: { daysLeft: 9 } })
    expect(billingSentence(site({ status: status({ state: 'locked', reason: 'awaiting_first_payment', day: 20 }) })).key).toBe('paused')
    expect(billingSentence(site({ status: status({ state: 'review', reason: 'payment_failed', day: 30 }) })).key).toBe('paused')
    expect(billingSentence(site({ status: status({ reason: 'override_allow' }) })).key).toBe('open')
  })
})

describe('error messages', () => {
  it('maps every checkout and portal error to a calm message', () => {
    expect(billingErrorKey('profileIncomplete')).toBe('detailsCheck')
    expect(billingErrorKey('vatNotVerified')).toBe('vatPending')
    expect(billingErrorKey('noIssuer')).toBe('contactAbluo')
    expect(billingErrorKey('noCustomer')).toBe('noCustomer')
    expect(billingErrorKey('alreadySubscribed')).toBe('alreadySubscribed')
    expect(billingErrorKey('forbidden')).toBe('forbidden')
    expect(billingErrorKey('unavailable')).toBe('unavailable')
    expect(billingErrorKey('notBilled')).toBe('notBilled')
    expect(billingErrorKey('failed')).toBe('failed')
  })
})

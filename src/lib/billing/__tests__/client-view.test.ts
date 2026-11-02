import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin/billing/queries', () => ({ billingLivemode: () => false }))

type Tables = Record<string, unknown[]>
let tables: Tables = {}
function query(rows: unknown[]) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) q[m] = () => q
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
  return q
}
vi.mock('@/lib/supabase/admin', () => ({
  runAsTrustedSystemOperation: async (_reason: string, fn: (db: unknown) => unknown) => fn({ from: (t: string) => query(tables[t] ?? []) }),
}))
vi.mock('../stripe/service', () => ({ listInvoices: async () => [] }))
vi.mock('@/lib/people/ownership', () => ({ tenantOfProject: async () => ({ tenantId: 't-1', slug: 'main' }) }))

import { loadClientBillingView } from '../client-view'

const ctx = (tenantPermissions: string[]): TenantAuthorizationContext => ({
  userId: 'u1',
  platformRole: 'tenant_user',
  projects: [{ projectId: 'p1', projectSlug: 'main' as never, membershipId: 'tenant-owner:t-1', role: 'owner', permissions: [], enabledModuleIds: [] }],
  tenants: [{ tenantId: 't-1', role: 'owner', permissions: tenantPermissions }],
})

beforeEach(() => {
  tables = {
    projects: [
      { id: 'p1', slug: 'main', name: 'Main Site' },
      { id: 'p2', slug: 'shop', name: 'Shop' },
    ],
    project_billing: [
      {
        project_id: 'p1', arrangement: 'stripe', amount_cents: 24000, currency: 'eur', billing_interval: 'year', interval_count: 1,
        starts_on: null, activation_due_at: '2099-01-01T00:00:00Z', activation_extension_reason: null, manual_paid_through: null, terms_version: 1,
        billing_subscription_id: null, override: 'none', override_until: null, override_reason: null, override_set_at: null,
        review_acknowledged_at: null, review_note: null, updated_at: '2026-11-01T00:00:00Z',
      },
    ],
    billing_profiles: [{ billing_email: 'a@b.it', customer_type: 'business', legal_name: 'Acme Srl', address_line1: null, address_line2: null, postal_code: null, city: null, region: null, country: 'IT', vat_id: 'IT123', vat_verification: 'verified', vat_verified_at: null }],
  }
})

describe('loadClientBillingView', () => {
  it('returns null without a grant on the project', async () => {
    expect(await loadClientBillingView(ctx(['billing.manage']), 'nope')).toBeNull()
  })
  it('returns null without a billing permission on the client', async () => {
    expect(await loadClientBillingView(ctx([]), 'main')).toBeNull()
  })
  it('invoice access sees the page but cannot manage', async () => {
    const view = await loadClientBillingView(ctx(['billing.invoice.read']), 'main')
    expect(view?.access).toEqual({ canManage: false, canView: true })
  })
  it('Owner gets this site, the other sites and the billing details', async () => {
    const view = await loadClientBillingView(ctx(['billing.manage', 'billing.invoice.read']), 'main')
    expect(view?.access.canManage).toBe(true)
    expect(view?.livemode).toBe(false)
    expect(view?.current).toMatchObject({ slug: 'main', arrangement: 'stripe', amountCents: 24000, interval: 'year' })
    expect(view?.current.status.reason).toBe('before_due')
    expect(view?.others.map((s) => [s.slug, s.arrangement])).toEqual([['shop', null]])
    expect(view?.profile).toMatchObject({ legalName: 'Acme Srl', country: 'IT', vatVerification: 'verified' })
  })
  it('lists this site’s invoices; a Stripe failure leaves them unavailable (null), never breaks the page', async () => {
    const invoice = { id: 'in_1', number: 'A-1', date: '2026-11-01T00:00:00.000Z', amountCents: 24000, currency: 'eur', status: 'paid' as const, hostedUrl: null, pdfUrl: null }
    const listInvoices = async (projectId: string) => (projectId === 'p1' ? [invoice] : [])
    expect((await loadClientBillingView(ctx(['billing.invoice.read']), 'main', new Date(), { listInvoices }))?.invoices).toEqual([invoice])
    const failing = async () => {
      throw new Error('stripe down')
    }
    expect((await loadClientBillingView(ctx(['billing.manage']), 'main', new Date(), { listInvoices: failing }))?.invoices).toBeNull()
  })
})

/** Authorization of the Stripe actions: refusals happen before any Stripe call or write. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'

let ctx: unknown = null
const getCtx = vi.fn(async (..._a: unknown[]) => ctx)
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: (...a: unknown[]) => getCtx(...a) }))
const dbCalls: string[] = []
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (dbCalls.push(t), { data: { tenant_id: TENANT }, error: null }) }) }),
    }),
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'www.abluo.app' }) }))
const createCheckout = vi.fn()
const createPortalSession = vi.fn()
class BillingError extends Error {
  constructor(readonly code: string) { super(code) }
}
vi.mock('../stripe/service', () => ({
  BillingError,
  createCheckout: (...a: unknown[]) => createCheckout(...a),
  createPortalSession: (...a: unknown[]) => createPortalSession(...a),
  setCancelAtPeriodEnd: vi.fn(),
}))

const grant = { projectId: PROJECT, projectSlug: 'acme', membershipId: 'm', role: 'owner', permissions: [], enabledModuleIds: [] }
const context = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', platformRole: null, projects: [grant],
  tenants: [{ tenantId: TENANT, role: 'owner', permissions: ['billing.manage', 'billing.invoice.read'] }], ...over,
})
const actions = () => import('../client-actions')

beforeEach(() => {
  ctx = context()
  getCtx.mockClear()
  createCheckout.mockReset()
  createPortalSession.mockReset()
  dbCalls.length = 0
})

describe.each(['startCheckoutAction', 'openBillingPortalAction'] as const)('%s authorization', (name) => {
  const call = async (slug = 'acme', locale = 'it') => ((await actions())[name] as (i: unknown) => Promise<unknown>)({ projectSlug: slug, locale })
  const untouched = () => {
    expect(createCheckout).not.toHaveBeenCalled()
    expect(createPortalSession).not.toHaveBeenCalled()
  }
  it('anonymous -> forbidden', async () => {
    ctx = null
    expect(await call()).toEqual({ ok: false, error: 'forbidden' })
    expect(dbCalls).toEqual([])
    untouched()
  })
  it('without billing.manage -> forbidden before any read', async () => {
    ctx = context({ tenants: [{ tenantId: TENANT, role: 'member', permissions: ['billing.invoice.read'] }] })
    expect(await call()).toEqual({ ok: false, error: 'forbidden' })
    expect(dbCalls).toEqual([])
    untouched()
  })
  it('billing.manage on ANOTHER client does not count', async () => {
    ctx = context({ tenants: [{ tenantId: '99999999-9999-4999-8999-999999999999', role: 'owner', permissions: ['billing.manage'] }] })
    expect(await call()).toEqual({ ok: false, error: 'forbidden' })
    untouched()
  })
  it('support mode -> forbidden', async () => {
    ctx = context({ support: { sessionId: 's', projectId: PROJECT, writesAllowed: true, role: 'admin' } })
    expect(await call()).toEqual({ ok: false, error: 'forbidden' })
    expect(dbCalls).toEqual([])
    untouched()
  })
  it('a project the caller cannot reach -> forbidden', async () => {
    expect(await call('other')).toEqual({ ok: false, error: 'forbidden' })
    untouched()
  })
  it('resolves with the mutation purpose scoped to the project', async () => {
    createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/x' })
    const r = (await call()) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(getCtx).toHaveBeenCalledWith({ purpose: 'mutation', project: 'acme' })
  })
})

describe('error mapping', () => {
  it.each(['notBilled', 'profileIncomplete', 'vatNotVerified', 'alreadySubscribed', 'noIssuer', 'unavailable'])('checkout %s', async (c) => {
    createCheckout.mockRejectedValue(new BillingError(c))
    expect(await (await actions()).startCheckoutAction({ projectSlug: 'acme', locale: 'it' })).toEqual({ ok: false, error: c })
  })
  it('unknown failure -> failed', async () => {
    createCheckout.mockRejectedValue(new Error('boom'))
    expect(await (await actions()).startCheckoutAction({ projectSlug: 'acme', locale: 'it' })).toEqual({ ok: false, error: 'failed' })
  })
  it('portal noCustomer', async () => {
    createPortalSession.mockRejectedValue(new BillingError('noCustomer'))
    expect(await (await actions()).openBillingPortalAction({ projectSlug: 'acme', locale: 'it' })).toEqual({ ok: false, error: 'noCustomer' })
  })
  it('passes https base URL, locale and the caller', async () => {
    createCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/x' })
    await (await actions()).startCheckoutAction({ projectSlug: 'acme', locale: 'de' })
    expect(createCheckout).toHaveBeenCalledWith(PROJECT, 'u1', 'de', 'https://www.abluo.app')
  })
  it('unknown locale -> failed without Stripe', async () => {
    expect(await (await actions()).startCheckoutAction({ projectSlug: 'acme', locale: 'xx' })).toEqual({ ok: false, error: 'failed' })
    expect(createCheckout).not.toHaveBeenCalled()
  })
})

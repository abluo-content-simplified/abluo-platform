/** Outbound Stripe service — Stripe and the database are faked; no network. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'
const ISSUER = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-11-02T10:00:00Z')

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][]; head?: boolean }
type Res = { data?: unknown; error?: { message: string } | null; count?: number | null }
const calls: Call[] = []
const rpcCalls: { fn: string; args: unknown }[] = []
let handler: (c: Call) => Res = () => ({ data: null })

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  const run = async () => {
    calls.push({ ...call, filters: [...call.filters] })
    return { data: null, error: null, count: null, ...handler(call) }
  }
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => ((call.head = Boolean(o?.head)), q),
    eq: (k: string, v: unknown) => (call.filters.push([k, v]), q),
    insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), q),
    update: (p: unknown) => ((call.op = 'update'), (call.payload = p), q),
    maybeSingle: run,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  }
  return q
}
let rpcResult: Res = {}
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from, rpc: async (fn: string, args: unknown) => (rpcCalls.push({ fn, args }), { data: null, error: null, ...rpcResult }) }),
}))
vi.mock('@/lib/admin/billing/queries', () => ({ billingLivemode: () => false }))

const stripe = {
  customers: { create: vi.fn(), update: vi.fn(), listTaxIds: vi.fn(), createTaxId: vi.fn() },
  products: { search: vi.fn(), create: vi.fn(), update: vi.fn() },
  prices: { create: vi.fn(), retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn(), expire: vi.fn(), retrieve: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  subscriptions: { update: vi.fn(), retrieve: vi.fn() },
  invoices: { list: vi.fn() },
}
let stripeAvailable = true
vi.mock('../client', () => ({ getStripe: () => (stripeAvailable ? stripe : null) }))

const svc = () => import('../service')

const profile = (t: Record<string, unknown> = {}) => ({
  billing_email: 'a@b.it', customer_type: 'business', legal_name: 'Acme Srl', contact_name: null, address_line1: 'Via 1', address_line2: null,
  postal_code: '48015', city: 'Cervia', region: null, country: 'IT', vat_id: 'IT12345678901', tax_code: null, vat_verification: 'verified', ...t,
})
const agreement = (t: Record<string, unknown> = {}) => ({
  arrangement: 'stripe', amount_cents: 24000, currency: 'eur', billing_interval: 'year', interval_count: 1, terms_version: 2,
  stripe_price_id: null, billing_subscription_id: null, ...t,
})
const project = { id: PROJECT, slug: 'acme', name: 'Acme', custom_domain: null, tenant_id: TENANT }

let tables: Record<string, Res | ((c: Call) => Res)> = {}
function setup(over: Record<string, Res | ((c: Call) => Res)> = {}) {
  tables = {
    projects: { data: project },
    project_billing: (c) => (c.op === 'select' ? { data: agreement() } : { data: null }),
    billing_profiles: { data: profile() },
    billing_issuers: { data: { id: ISSUER, key: 'tmz-de', legal_name: 'TMZ', country: 'DE' } },
    billing_customers: (c) => (c.op === 'select' ? { data: { stripe_customer_id: 'cus_ABCDEF123' } } : { data: null }),
    billing_subscriptions: { data: null },
    billing_checkout_sessions: (c) => (c.head ? { count: 0 } : { data: null }),
    ...over,
  }
  handler = (c) => {
    const t = tables[c.table]
    return typeof t === 'function' ? t(c) : (t ?? { data: null })
  }
}

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  rpcResult = {}
  stripeAvailable = true
  vi.clearAllMocks()
  process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_123'
  stripe.products.search.mockResolvedValue({ data: [{ id: 'prod_1', name: 'Abluo — Acme', active: true }] })
  stripe.prices.create.mockResolvedValue({ id: 'price_NEW12345' })
  stripe.customers.update.mockResolvedValue({})
  stripe.customers.listTaxIds.mockResolvedValue({ data: [{ type: 'eu_vat', value: 'IT12345678901' }] })
  stripe.checkout.sessions.create.mockResolvedValue({
    id: 'cs_test_ABCDEF123', url: 'https://checkout.stripe.com/c/pay/cs_test_ABCDEF123', expires_at: Math.floor(NOW.getTime() / 1000) + 86_000,
  })
  stripe.checkout.sessions.expire.mockResolvedValue({})
  setup()
})

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as { code?: string }).code ?? String(e))
const writes = () => calls.filter((c) => c.op !== 'select')

describe('createCheckout refusals', () => {
  it.each([
    ['not a stripe arrangement', { project_billing: { data: agreement({ arrangement: 'manual' }) } }, 'notBilled'],
    ['no agreement', { project_billing: { data: null } }, 'notBilled'],
    ['no profile', { billing_profiles: { data: null } }, 'profileIncomplete'],
    ['no email', { billing_profiles: { data: profile({ billing_email: null }) } }, 'profileIncomplete'],
    ['no country', { billing_profiles: { data: profile({ country: null }) } }, 'profileIncomplete'],
    ['business without VAT', { billing_profiles: { data: profile({ vat_id: null, vat_verification: 'none' }) } }, 'profileIncomplete'],
    ['business without legal name', { billing_profiles: { data: profile({ legal_name: null }) } }, 'profileIncomplete'],
    ['VAT not verified', { billing_profiles: { data: profile({ vat_verification: 'pending' }) } }, 'vatNotVerified'],
    ['VAT unavailable', { billing_profiles: { data: profile({ vat_verification: 'unavailable' }) } }, 'vatNotVerified'],
    ['no issuer', { billing_issuers: { data: null } }, 'noIssuer'],
  ])('%s -> %s, and nothing is created', async (_n, over, expected) => {
    setup(over as never)
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://www.abluo.app', NOW))).toBe(expected)
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('VAT never sent to Stripe: the customer and tax id are pushed first, and a verified result lets checkout go on', async () => {
    let stored = profile({ vat_verification: 'none' })
    setup({ billing_profiles: (c) => {
      if (c.op === 'update') { stored = { ...stored, ...(c.payload as Record<string, unknown>) }; return { data: null } }
      return { data: stored }
    } })
    stripe.customers.listTaxIds.mockResolvedValue({ data: [{ type: 'eu_vat', value: 'IT 12345678901', verification: { status: 'verified', verified_name: 'ACME SRL' } }] })
    stripe.prices.retrieve.mockResolvedValue({})
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('ok')
    expect(stored.vat_verification).toBe('verified')
    expect(stripe.customers.update).toHaveBeenCalled()
  })
  it('VAT still pending at Stripe: stored as pending, checkout refused', async () => {
    let stored = profile({ vat_verification: 'none' })
    setup({ billing_profiles: (c) => {
      if (c.op === 'update') { stored = { ...stored, ...(c.payload as Record<string, unknown>) }; return { data: null } }
      return { data: stored }
    } })
    stripe.customers.listTaxIds.mockResolvedValue({ data: [{ type: 'eu_vat', value: 'IT12345678901', verification: { status: 'pending', verified_name: null } }] })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('vatNotVerified')
    expect(stored.vat_verification).toBe('pending')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('VAT rejected by VIES (unverified): checkout refused with vatInvalid', async () => {
    let stored = profile({ vat_verification: 'none', vat_id: 'DE111111111' })
    setup({ billing_profiles: (c) => {
      if (c.op === 'update') { stored = { ...stored, ...(c.payload as Record<string, unknown>) }; return { data: null } }
      return { data: stored }
    } })
    stripe.customers.listTaxIds.mockResolvedValue({ data: [{ type: 'eu_vat', value: 'DE111111111', verification: { status: 'unverified', verified_name: null } }] })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('vatInvalid')
    expect(stored.vat_verification).toBe('unverified')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
  it('VAT check unavailable stays vatNotVerified', async () => {
    let stored = profile({ vat_verification: 'none' })
    setup({ billing_profiles: (c) => {
      if (c.op === 'update') { stored = { ...stored, ...(c.payload as Record<string, unknown>) }; return { data: null } }
      return { data: stored }
    } })
    stripe.customers.listTaxIds.mockResolvedValue({ data: [{ type: 'eu_vat', value: 'IT12345678901', verification: { status: 'unavailable', verified_name: null } }] })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('vatNotVerified')
  })

  it('a project linked to a live subscription is refused; a terminal one is not', async () => {
    setup({
      project_billing: { data: agreement({ billing_subscription_id: 'sub-row' }) },
      billing_subscriptions: { data: { status: 'past_due' } },
    })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('alreadySubscribed')
    for (const status of ['incomplete_expired', 'canceled']) {
      setup({ project_billing: { data: agreement({ billing_subscription_id: 'sub-row', stripe_price_id: 'price_OLD12345' }) }, billing_subscriptions: { data: { status } } })
      stripe.prices.retrieve.mockResolvedValue({ id: 'price_OLD12345', active: true, product: 'prod_1', unit_amount: 24000, currency: 'eur', recurring: { interval: 'year', interval_count: 1 } })
      expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('ok')
    }
  })

  it('an individual needs a full name but no VAT', async () => {
    setup({ billing_profiles: { data: profile({ customer_type: 'individual', legal_name: 'Mario Rossi', vat_id: null, vat_verification: 'none' }) } })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('ok')
  })

  it('an individual without a full name -> profileIncomplete', async () => {
    setup({ billing_profiles: { data: profile({ customer_type: 'individual', legal_name: null, vat_id: null, vat_verification: 'none' }) } })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('profileIncomplete')
  })

  it('stripe not configured -> unavailable', async () => {
    stripeAvailable = false
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('unavailable')
  })
})

describe('createCheckout session', () => {
  it('creates a subscription session with the required parameters', async () => {
    const r = await (await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://www.abluo.app/', NOW)
    expect(r.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    const [params, opts] = stripe.checkout.sessions.create.mock.calls[0]
    expect(params).not.toHaveProperty('payment_method_types')
    expect(params.mode).toBe('subscription')
    expect(params.integration_identifier).toMatch(/^abluo-checkout-[a-z]{8}$/)
    expect(params.automatic_tax).toEqual({ enabled: false })
    expect(params.client_reference_id).toBe(PROJECT)
    expect(params.metadata).toEqual({ project_id: PROJECT })
    expect(params.subscription_data).toEqual({ metadata: { project_id: PROJECT } })
    expect(params.success_url).toBe('https://www.abluo.app/it/acme/billing?checkout=success')
    expect(params.cancel_url).toBe('https://www.abluo.app/it/acme/billing?checkout=cancel')
    const left = params.expires_at * 1000 - NOW.getTime()
    expect(left).toBeGreaterThan(23 * 3_600_000)
    expect(left).toBeLessThanOrEqual(24 * 3_600_000)
    expect(opts).toEqual({ idempotencyKey: `checkout:${PROJECT}:test:2:1` })
    const insert = writes().find((c) => c.table === 'billing_checkout_sessions' && c.op === 'insert')
    expect(insert?.payload).toMatchObject({ stripe_session_id: 'cs_test_ABCDEF123', project_id: PROJECT, livemode: false, terms_version: 2, created_by: 'u1', status: 'open' })
  })

  it('attempt number follows earlier sessions of the same terms', async () => {
    setup({ billing_checkout_sessions: (c) => (c.head ? { count: 2 } : { data: null }) })
    await (await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW)
    expect(stripe.checkout.sessions.create.mock.calls[0][1]).toEqual({ idempotencyKey: `checkout:${PROJECT}:test:2:3` })
  })

  it('reuses an open session with at least 1 h left (no Stripe session call)', async () => {
    const open = { stripe_session_id: 'cs_test_OPEN12345', url: 'https://checkout.stripe.com/c/pay/open', expires_at: new Date(NOW.getTime() + 2 * 3_600_000).toISOString(), terms_version: 2 }
    setup({ billing_checkout_sessions: (c) => (c.op === 'select' && !c.head ? { data: open } : { data: null }) })
    expect(await (await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW)).toEqual({ url: open.url })
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it.each([
    ['under 1 h left', { expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(), terms_version: 2 }],
    ['agreed terms changed', { expires_at: new Date(NOW.getTime() + 5 * 3_600_000).toISOString(), terms_version: 1 }],
  ])('expires the old open session when %s, then creates a new one', async (_n, extra) => {
    const open = { stripe_session_id: 'cs_test_OPEN12345', url: 'https://checkout.stripe.com/c/pay/open', ...extra }
    setup({ billing_checkout_sessions: (c) => (c.op === 'select' && !c.head ? { data: open } : c.head ? { count: 1 } : { data: null }) })
    await (await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW)
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_test_OPEN12345')
    const marked = writes().find((c) => c.op === 'update' && c.table === 'billing_checkout_sessions')
    expect(marked?.payload).toEqual({ status: 'expired' })
    expect(stripe.checkout.sessions.create).toHaveBeenCalledOnce()
  })

  it('an old session that turns out completed -> alreadySubscribed', async () => {
    const open = { stripe_session_id: 'cs_test_OPEN12345', url: 'u', expires_at: new Date(NOW.getTime() + 60_000).toISOString(), terms_version: 2 }
    setup({ billing_checkout_sessions: (c) => (c.op === 'select' && !c.head ? { data: open } : { data: null }) })
    stripe.checkout.sessions.expire.mockRejectedValue(new Error('cannot expire'))
    stripe.checkout.sessions.retrieve.mockResolvedValue({ status: 'complete' })
    expect(await code((await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW))).toBe('alreadySubscribed')
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

describe('customer, product and price', () => {
  it('creates the customer from the profile with an idempotency key and stores it', async () => {
    setup({ billing_customers: (c) => (c.op === 'select' ? { data: null } : { data: null }) })
    stripe.customers.create.mockResolvedValue({ id: 'cus_NEW123456' })
    const id = await (await svc()).ensureCustomer(TENANT, { id: ISSUER, key: 'tmz-de', legal_name: 'TMZ', country: 'DE' }, 'de')
    expect(id).toBe('cus_NEW123456')
    const [params, opts] = stripe.customers.create.mock.calls[0]
    expect(params).toMatchObject({
      email: 'a@b.it', name: 'Acme Srl', preferred_locales: ['de'],
      address: { country: 'IT', city: 'Cervia', postal_code: '48015', line1: 'Via 1' },
      tax_id_data: [{ type: 'eu_vat', value: 'IT12345678901' }],
    })
    expect(opts).toEqual({ idempotencyKey: `customer:${TENANT}:${ISSUER}:test` })
    expect(writes().find((c) => c.table === 'billing_customers')?.payload).toMatchObject({ tenant_id: TENANT, issuer_id: ISSUER, livemode: false, stripe_customer_id: 'cus_NEW123456' })
  })

  it('a business contact person goes into the customer metadata; the name stays the company', async () => {
    setup({ billing_customers: (c) => (c.op === 'select' ? { data: null } : { data: null }), billing_profiles: { data: profile({ contact_name: 'Maria Rossi' }) } })
    stripe.customers.create.mockResolvedValue({ id: 'cus_NEW123456' })
    await (await svc()).ensureCustomer(TENANT, { id: ISSUER, key: 'tmz-de', legal_name: 'TMZ', country: 'DE' })
    const [params] = stripe.customers.create.mock.calls[0]
    expect(params.name).toBe('Acme Srl')
    expect(params.metadata).toEqual({ abluo_tenant_id: TENANT, abluo_issuer: 'tmz-de', abluo_contact_name: 'Maria Rossi' })
  })

  it('an existing customer is updated from the profile, not recreated', async () => {
    await (await svc()).ensureCustomer(TENANT, { id: ISSUER, key: 'tmz-de', legal_name: 'TMZ', country: 'DE' }, 'it')
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(stripe.customers.update).toHaveBeenCalledWith('cus_ABCDEF123', expect.objectContaining({ email: 'a@b.it', name: 'Acme Srl' }))
    // No contact person: an empty value removes a stale one from Stripe's metadata.
    expect(stripe.customers.update.mock.calls[0][1].metadata).toEqual({ abluo_tenant_id: TENANT, abluo_issuer: 'tmz-de', abluo_contact_name: '' })
    expect(stripe.customers.createTaxId).not.toHaveBeenCalled()
  })

  it('adds the VAT id to an existing customer when Stripe does not hold it', async () => {
    stripe.customers.listTaxIds.mockResolvedValue({ data: [] })
    await (await svc()).ensureCustomer(TENANT, { id: ISSUER, key: 'tmz-de', legal_name: 'TMZ', country: 'DE' })
    expect(stripe.customers.createTaxId).toHaveBeenCalledWith('cus_ABCDEF123', { type: 'eu_vat', value: 'IT12345678901' }, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  })

  it('creates the Product once per project (named, with metadata) and a Price per terms version', async () => {
    stripe.products.search.mockResolvedValue({ data: [] })
    stripe.products.create.mockResolvedValue({ id: 'prod_NEW', name: 'Abluo — Acme', active: true })
    const price = await (await svc()).ensureProductAndPrice(project, agreement() as never)
    expect(price).toBe('price_NEW12345')
    expect(stripe.products.create).toHaveBeenCalledWith({ name: 'Abluo — Acme', metadata: { abluo_project_id: PROJECT } }, { idempotencyKey: `product:${PROJECT}:test` })
    const [params, opts] = stripe.prices.create.mock.calls[0]
    expect(params).toMatchObject({ product: 'prod_NEW', currency: 'eur', unit_amount: 24000, tax_behavior: 'exclusive', recurring: { interval: 'year', interval_count: 1 } })
    expect(params).not.toHaveProperty('tax_code')
    expect(opts).toEqual({ idempotencyKey: `price:${PROJECT}:test:2` })
    expect(writes().find((c) => c.table === 'project_billing')?.payload).toEqual({ stripe_price_id: 'price_NEW12345' })
  })

  it('renames an existing Product to the current site name; no second product', async () => {
    stripe.products.search.mockResolvedValue({ data: [{ id: 'prod_1', name: 'Abluo — Old', active: true }] })
    stripe.products.update.mockResolvedValue({ id: 'prod_1', name: 'Abluo — Acme', active: true })
    await (await svc()).ensureProductAndPrice(project, agreement() as never)
    expect(stripe.products.create).not.toHaveBeenCalled()
    expect(stripe.products.update).toHaveBeenCalledWith('prod_1', { name: 'Abluo — Acme', active: true })
  })

  it('reuses the stored price while it matches the terms; a changed amount makes a new one', async () => {
    const stored = { id: 'price_OLD12345', active: true, product: 'prod_1', unit_amount: 24000, currency: 'eur', recurring: { interval: 'year', interval_count: 1 } }
    stripe.prices.retrieve.mockResolvedValue(stored)
    expect(await (await svc()).ensureProductAndPrice(project, agreement({ stripe_price_id: 'price_OLD12345' }) as never)).toBe('price_OLD12345')
    expect(stripe.prices.create).not.toHaveBeenCalled()
    stripe.prices.retrieve.mockResolvedValue({ ...stored, unit_amount: 12000 })
    expect(await (await svc()).ensureProductAndPrice(project, agreement({ stripe_price_id: 'price_OLD12345' }) as never)).toBe('price_NEW12345')
  })

  it('never passes payment_method_types anywhere', async () => {
    await (await svc()).createCheckout(PROJECT, 'u1', 'it', 'https://x.y', NOW)
    for (const fn of [stripe.checkout.sessions.create, stripe.customers.update, stripe.prices.create]) {
      for (const [params] of fn.mock.calls) expect(JSON.stringify(params)).not.toContain('payment_method_types')
    }
  })
})

describe('portal', () => {
  const run = async () => (await svc()).createPortalSession(TENANT, 'https://x.y/it/acme/billing', 'it')
  it('uses the explicit configuration id', async () => {
    stripe.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
    expect(await run()).toEqual({ url: 'https://billing.stripe.com/p/session/x' })
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: 'cus_ABCDEF123', configuration: 'bpc_123', return_url: 'https://x.y/it/acme/billing', locale: 'it' })
  })
  it('no configuration id -> unavailable (no Stripe call)', async () => {
    delete process.env.STRIPE_PORTAL_CONFIGURATION_ID
    expect(await code(run())).toBe('unavailable')
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled()
  })
  it('no customer yet -> noCustomer', async () => {
    setup({ billing_customers: { data: null } })
    expect(await code(run())).toBe('noCustomer')
  })
})

describe('setCancelAtPeriodEnd', () => {
  const sub = {
    id: 'sub_ABC123456', status: 'active', cancel_at_period_end: true, canceled_at: null, ended_at: null, latest_invoice: { id: 'in_ABC123456' },
    items: { data: [{ current_period_start: 1_780_000_000, current_period_end: 1_790_000_000 }] },
  }
  beforeEach(() => {
    setup({
      project_billing: { data: { billing_subscription_id: 'sub-row' } },
      billing_subscriptions: { data: { stripe_subscription_id: 'sub_ABC123456', tenant_id: TENANT, issuer_id: ISSUER, status: 'active' } },
    })
    stripe.subscriptions.update.mockResolvedValue({})
    stripe.subscriptions.retrieve.mockResolvedValue(sub)
  })
  it('updates Stripe, re-fetches and re-syncs with the period read from the ITEM', async () => {
    await (await svc()).setCancelAtPeriodEnd(PROJECT, true)
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_ABC123456', { cancel_at_period_end: true })
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_ABC123456')
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('billing_sync_subscription')
    expect((rpcCalls[0].args as { p: unknown }).p).toEqual({
      stripe_subscription_id: 'sub_ABC123456', livemode: false, tenant_id: TENANT, issuer_id: ISSUER, project_id: PROJECT, status: 'active',
      current_period_start: new Date(1_780_000_000_000).toISOString(), current_period_end: new Date(1_790_000_000_000).toISOString(),
      cancel_at_period_end: true, canceled_at: null, ended_at: null, latest_invoice_id: 'in_ABC123456',
    })
  })
  it('no linked subscription -> notBilled, no Stripe call', async () => {
    setup({ project_billing: { data: { billing_subscription_id: null } } })
    expect(await code((await svc()).setCancelAtPeriodEnd(PROJECT, true))).toBe('notBilled')
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
  })
  it('a terminal subscription is refused', async () => {
    setup({
      project_billing: { data: { billing_subscription_id: 'sub-row' } },
      billing_subscriptions: { data: { stripe_subscription_id: 'sub_ABC123456', tenant_id: TENANT, issuer_id: ISSUER, status: 'canceled' } },
    })
    expect(await code((await svc()).setCancelAtPeriodEnd(PROJECT, true))).toBe('failed')
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
  })
})

describe('invoices', () => {
  const inv = (t: Record<string, unknown> = {}) => ({
    id: 'in_1', number: 'ABL-0001', created: 1_793_000_000, total: 29280, currency: 'eur', status: 'paid',
    hosted_invoice_url: 'https://invoice.stripe.com/i/1', invoice_pdf: 'https://pay.stripe.com/invoice/1/pdf', status_transitions: { paid_at: 1_793_000_600 }, ...t,
  })
  it('invoiceSummary: paid date when paid, else created; drafts skipped', async () => {
    const { invoiceSummary } = await svc()
    expect(invoiceSummary(inv() as never)).toEqual({
      id: 'in_1', number: 'ABL-0001', date: new Date(1_793_000_600_000).toISOString(), amountCents: 29280, currency: 'eur', status: 'paid',
      hostedUrl: 'https://invoice.stripe.com/i/1', pdfUrl: 'https://pay.stripe.com/invoice/1/pdf',
    })
    expect(invoiceSummary(inv({ status: 'open', status_transitions: { paid_at: null } }) as never)?.date).toBe(new Date(1_793_000_000_000).toISOString())
    expect(invoiceSummary(inv({ status: 'draft' }) as never)).toBeNull()
  })
  it('listInvoices: the linked subscription, at most 24, drafts left out', async () => {
    setup({
      project_billing: { data: { billing_subscription_id: 'sub-row' } },
      billing_subscriptions: { data: { stripe_subscription_id: 'sub_STRIPE1' } },
    })
    stripe.invoices.list.mockResolvedValue({ data: [inv(), inv({ id: 'in_2', status: 'draft' }), inv({ id: 'in_3', status: 'open', number: null })] })
    const list = await (await svc()).listInvoices(PROJECT)
    expect(stripe.invoices.list).toHaveBeenCalledWith({ subscription: 'sub_STRIPE1', limit: 24 })
    expect(list.map((i) => [i.id, i.status, i.number])).toEqual([['in_1', 'paid', 'ABL-0001'], ['in_3', 'open', null]])
  })
  it('listInvoices: no linked subscription → [] without asking Stripe', async () => {
    setup({ project_billing: { data: { billing_subscription_id: null } } })
    expect(await (await svc()).listInvoices(PROJECT)).toEqual([])
    expect(stripe.invoices.list).not.toHaveBeenCalled()
  })
})

describe('syncCustomerIfExists', () => {
  it('pushes the profile to an existing customer', async () => {
    expect(await (await svc()).syncCustomerIfExists(TENANT, 'it')).toBe(true)
    expect(stripe.customers.update).toHaveBeenCalledWith('cus_ABCDEF123', expect.objectContaining({ name: 'Acme Srl' }))
    expect(stripe.customers.create).not.toHaveBeenCalled()
  })
  it('creates nothing when there is no customer yet', async () => {
    setup({ billing_customers: { data: null } })
    expect(await (await svc()).syncCustomerIfExists(TENANT)).toBe(false)
    expect(stripe.customers.create).not.toHaveBeenCalled()
    expect(stripe.customers.update).not.toHaveBeenCalled()
  })
})

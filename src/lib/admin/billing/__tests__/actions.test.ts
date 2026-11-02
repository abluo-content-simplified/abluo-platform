/**
 * Billing server actions — permission-first, validation, wiring (ADR-041 Phase 2).
 * I/O boundaries are faked: the billing gate, the service-role client, the audit log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const TENANT = '22222222-2222-4222-8222-222222222222'

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] }
let actor: { userId: string } | null = null
const calls: Call[] = []
let handler: (c: Call) => { data?: unknown; error?: { message: string } | null } = () => ({ data: null, error: null })

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  const run = async () => {
    calls.push({ ...call })
    return { data: null, error: null, ...handler(call) }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => (call.filters.push([k, v]), q),
    insert: (p: unknown) => ((call.op = 'insert'), (call.payload = p), q),
    update: (p: unknown) => ((call.op = 'update'), (call.payload = p), q),
    maybeSingle: run,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  }
  return q
}

vi.mock('../access', () => ({ requireBillingAdmin: async () => actor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => (calls.push({ table: '-', op: 'createAdminClient', filters: [] }), { from }) }))
const recordAdminAudit = vi.fn(async (...args: unknown[]) => void args)
vi.mock('@/lib/admin/audit', () => ({ recordAdminAudit: (...a: unknown[]) => recordAdminAudit(...a) }))
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/api/auth', () => ({ requireAbluoAdmin: async () => actor }))
vi.mock('@/lib/api/admin-dashboard/shared', () => ({ readAccounts: async () => new Map() }))

const actions = () => import('../actions')
const writes = () => calls.filter((c) => c.op === 'insert' || c.op === 'update')

const terms = (t: Record<string, unknown> = {}) => ({
  projectId: PROJECT, arrangement: 'stripe' as const, amount: '240', interval: 'year' as const, startsOn: null,
  activationDueOn: '2099-01-01', activationExtensionReason: null, manualPaidThrough: null, ...t,
})
const profile = (t: Record<string, unknown> = {}) => ({
  tenantId: TENANT, billingEmail: 'a@b.it', customerType: 'business' as const, legalName: 'Acme Srl', contactName: 'Maria Rossi', addressLine1: null, addressLine2: null,
  postalCode: null, city: null, region: null, country: 'it', vatId: 'it 123 456 789 01', taxCode: null, ...t,
})

beforeEach(() => {
  actor = { userId: 'user-tom' }
  calls.length = 0
  recordAdminAudit.mockClear()
  revalidatePath.mockClear()
  handler = (c) => (c.table === 'projects' ? { data: { id: PROJECT } } : c.table === 'tenants' ? { data: { id: TENANT } } : { data: null })
})

describe('every billing action is refused before any I/O without billing.admin', () => {
  it.each([
    ['saveBillingTermsAction', () => terms()],
    ['setBillingOverrideAction', () => ({ projectId: PROJECT, override: 'allow', untilOn: null, reason: 'x' })],
    ['acknowledgeBillingReviewAction', () => ({ projectId: PROJECT, note: null })],
    ['saveBillingProfileAction', () => profile()],
  ])('%s', async (name, input) => {
    actor = null
    const fn = (await actions())[name as 'saveBillingTermsAction'] as (i: unknown) => Promise<unknown>
    expect(await fn(input())).toEqual({ ok: false, error: 'forbidden' })
    expect(calls).toEqual([])
    expect(recordAdminAudit).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('saveBillingTermsAction', () => {
  it('rejects invalid input without touching the database', async () => {
    const r = await (await actions()).saveBillingTermsAction(terms({ amount: 'abc', interval: null }))
    expect(r).toEqual({ ok: false, error: 'invalid', fields: expect.arrayContaining(['amount', 'interval']) })
    expect(calls).toEqual([])
  })

  it('a due date more than 30 days ahead needs a reason (also when the database trigger says so)', async () => {
    const r = await (await actions()).saveBillingTermsAction(terms())
    expect(r).toEqual({ ok: false, error: 'invalid', fields: ['activationReasonRequired'] })
    handler = (c) => (c.table === 'projects' ? { data: { id: PROJECT } } : c.op === 'insert' ? { error: { message: 'billing:activation_window' } } : { data: null })
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    expect(await (await actions()).saveBillingTermsAction(terms({ activationDueOn: soon }))).toEqual({ ok: false, error: 'invalid', fields: ['activationReasonRequired'] })
    expect(recordAdminAudit).not.toHaveBeenCalled()
  })

  it('unknown project → notFound', async () => {
    handler = () => ({ data: null })
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    expect(await (await actions()).saveBillingTermsAction(terms({ activationDueOn: soon }))).toEqual({ ok: false, error: 'notFound' })
    expect(writes()).toEqual([])
  })

  it('creates the agreement for this mode, in cents, with created_by, and audits it', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    const r = await (await actions()).saveBillingTermsAction(terms({ amount: '1.200,50', activationDueOn: soon }))
    expect(r).toEqual({ ok: true })
    const [w] = writes()
    expect(w.op).toBe('insert')
    expect(w.payload).toMatchObject({ project_id: PROJECT, livemode: false, amount_cents: 120050, currency: 'eur', terms_version: 1, created_by: 'user-tom', billing_interval: 'year' })
    expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing.terms.set', projectId: PROJECT, actorId: 'user-tom' }))
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('bumps terms_version only when price, interval or arrangement change', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
    const existing = { arrangement: 'stripe', amount_cents: 24000, billing_interval: 'year', terms_version: 3, billing_subscription_id: null }
    handler = (c) => (c.table === 'projects' ? { data: { id: PROJECT } } : c.table === 'project_billing' && c.op === 'select' ? { data: existing } : { data: null })
    await (await actions()).saveBillingTermsAction(terms({ activationDueOn: soon }))
    expect(writes()[0].payload).toMatchObject({ terms_version: 3 })
    calls.length = 0
    await (await actions()).saveBillingTermsAction(terms({ activationDueOn: soon, amount: '300' }))
    expect(writes()[0].payload).toMatchObject({ terms_version: 4, amount_cents: 30000 })
  })

  it('complimentary stores no amount, interval or due date', async () => {
    await (await actions()).saveBillingTermsAction(terms({ arrangement: 'complimentary', amount: '99', interval: 'month', activationDueOn: '2099-01-01' }))
    expect(writes()[0].payload).toMatchObject({ amount_cents: null, billing_interval: null, activation_due_at: null })
  })
})

describe('manual agreements keep their payment due date', () => {
  const soon = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10)
  it('persists the due date and reason, and applies the 30-day rule', async () => {
    const r = await (await actions()).saveBillingTermsAction(terms({ arrangement: 'manual', activationDueOn: '2099-01-01' }))
    expect(r).toEqual({ ok: false, error: 'invalid', fields: ['activationReasonRequired'] })
    await (await actions()).saveBillingTermsAction(terms({ arrangement: 'manual', activationDueOn: soon() }))
    expect(writes()[0].payload).toMatchObject({ arrangement: 'manual', activation_due_at: expect.any(String) })
  })
  it('a price change clears the stored Stripe price id', async () => {
    const existing = { arrangement: 'stripe', amount_cents: 24000, billing_interval: 'year', terms_version: 1, billing_subscription_id: null }
    handler = (c) => (c.table === 'projects' ? { data: { id: PROJECT } } : c.table === 'project_billing' && c.op === 'select' ? { data: existing } : { data: null })
    await (await actions()).saveBillingTermsAction(terms({ activationDueOn: soon(), amount: '300' }))
    expect(writes()[0].payload).toMatchObject({ stripe_price_id: null })
  })
})

describe('setBillingOverrideAction', () => {
  it('allow/restrict need a reason', async () => {
    const r = await (await actions()).setBillingOverrideAction({ projectId: PROJECT, override: 'allow', untilOn: null, reason: ' ' })
    expect(r).toEqual({ ok: false, error: 'invalid', fields: ['reasonRequired'] })
    expect(calls).toEqual([])
  })
  it('an agreement is required', async () => {
    handler = () => ({ data: null })
    expect(await (await actions()).setBillingOverrideAction({ projectId: PROJECT, override: 'allow', untilOn: null, reason: 'friend' })).toEqual({ ok: false, error: 'notFound' })
    expect(writes()).toEqual([])
  })
  it('sets and clears', async () => {
    handler = () => ({ data: { project_id: PROJECT } })
    await (await actions()).setBillingOverrideAction({ projectId: PROJECT, override: 'restrict', untilOn: '2099-03-01', reason: 'dispute' })
    expect(writes()[0].payload).toMatchObject({ override: 'restrict', override_reason: 'dispute', override_by: 'user-tom', override_until: '2099-03-01T23:00:00.000Z' })
    calls.length = 0
    await (await actions()).setBillingOverrideAction({ projectId: PROJECT, override: 'none', untilOn: '2099-03-01', reason: 'ignored' })
    expect(writes()[0].payload).toEqual({ override: 'none', override_until: null, override_reason: null, override_by: null, override_set_at: null })
    expect(recordAdminAudit).toHaveBeenCalledTimes(2)
  })
})

describe('acknowledgeBillingReviewAction', () => {
  const inReview = { project_id: PROJECT, arrangement: 'manual', override: 'none', activation_due_at: '2020-01-01T00:00:00Z', manual_paid_through: null, billing_subscription_id: null }
  it('stamps the acknowledgement with the note when the project is in review', async () => {
    handler = () => ({ data: inReview })
    expect(await (await actions()).acknowledgeBillingReviewAction({ projectId: PROJECT, note: ' called them ' })).toEqual({ ok: true })
    expect(writes()[0].payload).toMatchObject({ review_note: 'called them', review_acknowledged_at: expect.any(String) })
    expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing.review.ack' }))
  })
  it('refuses unless the computed state is review', async () => {
    handler = () => ({ data: { ...inReview, activation_due_at: new Date(Date.now() - 3 * 86_400_000).toISOString() } })
    expect(await (await actions()).acknowledgeBillingReviewAction({ projectId: PROJECT, note: null })).toEqual({ ok: false, error: 'invalid', fields: ['state'] })
    expect(writes()).toEqual([])
  })
  it('no agreement → notFound', async () => {
    handler = () => ({ data: null })
    expect(await (await actions()).acknowledgeBillingReviewAction({ projectId: PROJECT, note: null })).toEqual({ ok: false, error: 'notFound' })
  })
})

describe('non-string inputs never throw', () => {
  it('return invalid / notFound', async () => {
    const a = await actions()
    expect(await a.saveBillingTermsAction(null as never)).toEqual({ ok: false, error: 'invalid', fields: [] })
    expect(await a.saveBillingTermsAction(terms({ amount: 240, startsOn: 5 }) as never)).toMatchObject({ ok: false, error: 'invalid', fields: ['amount', 'startsOn'] })
    expect(await a.setBillingOverrideAction({ projectId: PROJECT, override: 'allow', untilOn: 5, reason: {} } as never)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await a.acknowledgeBillingReviewAction({ projectId: PROJECT, note: 7 } as never)).toEqual({ ok: false, error: 'invalid', fields: ['note'] })
    expect(await a.saveBillingProfileAction(profile({ legalName: 5, vatId: [] }) as never)).toEqual({ ok: false, error: 'invalid', fields: ['legalName', 'vatId'] })
    expect(calls).toEqual([])
  })
})

describe('saveBillingProfileAction', () => {
  it('invalid details are refused before the database', async () => {
    const r = await (await actions()).saveBillingProfileAction(profile({ billingEmail: 'nope', country: 'Italy' }))
    expect(r).toEqual({ ok: false, error: 'invalid', fields: ['billingEmail', 'country'] })
    expect(calls).toEqual([])
  })
  it('stores normalised values and resets VAT verification when the VAT id is new', async () => {
    expect(await (await actions()).saveBillingProfileAction(profile())).toEqual({ ok: true })
    expect(writes()[0].payload).toMatchObject({ tenant_id: TENANT, livemode: false, country: 'IT', vat_id: 'IT12345678901', vat_verification: 'none', vat_verified_at: null })
    expect(recordAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'billing.profile.set', projectId: null }))
  })
  it('stores the contact person of a business', async () => {
    await (await actions()).saveBillingProfileAction(profile())
    expect(writes()[0].payload).toMatchObject({ legal_name: 'Acme Srl', contact_name: 'Maria Rossi', tax_code: null })
  })
  it('an individual keeps no VAT number or contact person; in Italy the codice fiscale is stored upper-case', async () => {
    const input = profile({ customerType: 'individual', legalName: 'Mario Rossi', taxCode: 'rssmra80a01 h501u' })
    expect(await (await actions()).saveBillingProfileAction(input)).toEqual({ ok: true })
    expect(writes()[0].payload).toMatchObject({ customer_type: 'individual', legal_name: 'Mario Rossi', vat_id: null, contact_name: null, tax_code: 'RSSMRA80A01H501U' })
  })
  it('a malformed codice fiscale is refused before the database', async () => {
    const r = await (await actions()).saveBillingProfileAction(profile({ customerType: 'individual', legalName: 'Mario Rossi', taxCode: 'ABC' }))
    expect(r).toEqual({ ok: false, error: 'invalid', fields: ['taxCode'] })
    expect(calls).toEqual([])
  })
  it('keeps the verification when the VAT id is unchanged', async () => {
    handler = (c) => (c.table === 'tenants' ? { data: { id: TENANT } } : c.table === 'billing_profiles' && c.op === 'select' ? { data: { vat_id: 'IT12345678901' } } : { data: null })
    await (await actions()).saveBillingProfileAction(profile())
    expect(writes()[0].op).toBe('update')
    expect(writes()[0].payload).not.toHaveProperty('vat_verification')
  })
  it('unknown client → notFound', async () => {
    handler = () => ({ data: null })
    expect(await (await actions()).saveBillingProfileAction(profile())).toEqual({ ok: false, error: 'notFound' })
  })
})

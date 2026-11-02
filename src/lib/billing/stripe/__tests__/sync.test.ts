/**
 * Stripe → Abluo sync (ADR-041 D11/D15) over in-memory fakes of the two seams.
 * The fake store reproduces the SQL semantics of billing_record_invoice so the
 * out-of-order tests prove the end state, not just the calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ingestEvent,
  processEvent,
  reconcileBilling,
  syncSubscription,
  HANDLED_EVENT_TYPES,
  type AlertInsert,
  type StripeApi,
  type StripeEventObj,
  type StripeInvoiceObj,
  type StripeSubscriptionObj,
  type SyncDeps,
  type SyncStore,
  type VatVerificationPatch,
} from '../sync'

const T1 = 'tenant-1'
const T2 = 'tenant-2'
const P1 = 'project-1'
const P2 = 'project-2'
const CUS = 'cus_AAAAAA1'

type SubRow = { id: string; tenantId: string; status: string; projectIds: string[]; firstPaidAt: number | null; failedAt: number | null; failedInvoice: string | null; settled: string | null; latestInvoice: string | null; syncs: number }

function makeWorld() {
  const subs = new Map<string, SubRow>()
  const sessions = new Map<string, { projectId: string; tenantId: string; livemode: boolean; status: string }>([
    ['cs_test_AAAAAA1', { projectId: P1, tenantId: T1, livemode: false, status: 'open' }],
  ])
  const customers = new Map([[CUS, { tenantId: T1, issuerId: 'iss-1', livemode: false }], ['cus_OTHER01', { tenantId: T2, issuerId: 'iss-1', livemode: false }]])
  const events = new Map<string, { status: string; error?: string; attempts: number }>()
  const alerts = new Map<string, AlertInsert>()
  const vat: { patch: VatVerificationPatch | null; calls: unknown[] } = { patch: null, calls: [] }
  const profileVat = { [T1]: 'IT12345678901' } as Record<string, string>
  let linkRefusal = false

  const store: SyncStore = {
    async claimEvent(e) {
      const cur = events.get(e.id)
      if (!cur) return events.set(e.id, { status: 'received', attempts: 1 }), true
      cur.attempts++
      return cur.status === 'received' || cur.status === 'failed'
    },
    async finishEvent(id, status, error) {
      events.set(id, { ...events.get(id)!, status, error })
    },
    async checkoutSession(id) {
      return sessions.get(id) ?? null
    },
    async markCheckoutSession(id, status) {
      const s = sessions.get(id)!
      if (status === 'expired' && s.status !== 'open') return
      s.status = status
    },
    async customerByStripeId(id) {
      return customers.get(id) ?? null
    },
    async subscriptionByStripeId(id) {
      const s = subs.get(id)
      return s ? { id: s.id, tenantId: s.tenantId, projectIds: s.projectIds } : null
    },
    async syncSubscription(p) {
      if (p.project_id && linkRefusal) throw new Error('billing:project_not_linkable')
      const id = String(p.stripe_subscription_id)
      const cur = subs.get(id) ?? { id: `row-${id}`, tenantId: String(p.tenant_id), status: '', projectIds: [], firstPaidAt: null, failedAt: null, failedInvoice: null, settled: null, latestInvoice: null, syncs: 0 }
      cur.status = String(p.status)
      cur.latestInvoice = (p.latest_invoice_id as string) ?? null
      cur.syncs++
      if (p.project_id && !cur.projectIds.includes(String(p.project_id))) cur.projectIds.push(String(p.project_id))
      subs.set(id, cur)
      lastSnapshot = p
      return cur.id
    },
    async recordInvoice(sub, _live, inv, outcome, at) {
      const s = subs.get(sub)
      if (!s) throw new Error('billing:subscription_not_found')
      const t = at.getTime()
      if (outcome !== 'failed') {
        if (outcome === 'paid') s.firstPaidAt = s.firstPaidAt === null ? t : Math.min(s.firstPaidAt, t)
        s.settled = inv
        if (s.failedInvoice === null || s.failedInvoice === inv) (s.failedAt = null), (s.failedInvoice = null)
      } else {
        if (s.settled === inv) return
        if (s.failedInvoice === inv) s.failedAt = Math.min(s.failedAt!, t)
        else if (s.failedInvoice === null) (s.failedAt = t), (s.failedInvoice = inv)
      }
    },
    async updateVatVerification(tenantId, _live, vatId, patch) {
      vat.calls.push({ tenantId, vatId, patch })
      if (profileVat[tenantId] !== vatId) return false
      vat.patch = patch
      return true
    },
    async insertAlert(a) {
      const key = `${a.kind}:${a.stripeObjectId}`
      if (alerts.has(key)) return false
      alerts.set(key, a)
      return true
    },
    async listOpenSubscriptions() {
      return [...subs.entries()].filter(([, s]) => s.status !== 'canceled').map(([id]) => ({ stripeSubscriptionId: id }))
    },
    async listRetryableEvents() {
      return [...events.entries()].filter(([, e]) => e.status === 'received' || e.status === 'failed').map(([eventId]) => ({ eventId }))
    },
  }
  let lastSnapshot: Record<string, unknown> = {}
  return { store, subs, sessions, events, alerts, vat, profileVat, snapshot: () => lastSnapshot, refuseLink: (v: boolean) => (linkRefusal = v) }
}

const subObj = (over: Partial<StripeSubscriptionObj> = {}): StripeSubscriptionObj => ({
  id: 'sub_AAAAAA1', livemode: false, status: 'active', customer: CUS, cancel_at_period_end: false, canceled_at: null, ended_at: null,
  latest_invoice: 'in_AAAAAA1', metadata: { project_id: P1 },
  items: { data: [{ current_period_start: 1_700_000_000, current_period_end: 1_702_592_000 }] }, ...over,
})
const invObj = (over: Partial<StripeInvoiceObj> = {}): StripeInvoiceObj => ({
  id: 'in_AAAAAA1', livemode: false, status: 'paid', amount_paid: 24000, attempt_count: 1, customer: CUS,
  parent: { subscription_details: { subscription: 'sub_AAAAAA1' } },
  status_transitions: { paid_at: 1_700_000_100 }, ...over,
})

function makeStripe(w: ReturnType<typeof makeWorld>) {
  const data = {
    subs: new Map<string, StripeSubscriptionObj>([['sub_AAAAAA1', subObj()]]),
    invoices: new Map<string, StripeInvoiceObj>([['in_AAAAAA1', invObj()]]),
    sessions: new Map<string, Record<string, unknown>>([['cs_test_AAAAAA1', { id: 'cs_test_AAAAAA1', livemode: false, status: 'complete', subscription: 'sub_AAAAAA1', metadata: { project_id: P1 } }]]),
    sessionsBySub: new Map<string, string[]>([['sub_AAAAAA1', ['cs_test_AAAAAA1']]]),
    charges: new Map<string, Record<string, unknown>>([['ch_AAAAAA1', { id: 'ch_AAAAAA1', livemode: false, amount: 24000, currency: 'eur', payment_intent: 'pi_AAAAAA1', customer: CUS }]]),
    taxIds: new Map<string, Record<string, unknown>>(),
    refunds: [{ id: 're_AAAAAA1', amount: 1000, currency: 'eur', status: 'succeeded' }],
    pi: new Map<string, string>([['pi_AAAAAA1', 'in_AAAAAA1']]),
    events: new Map<string, StripeEventObj>(),
  }
  const api: StripeApi = {
    retrieveSubscription: async (id) => data.subs.get(id)!,
    listSessionsForSubscription: async (id) => (data.sessionsBySub.get(id) ?? []).map((s) => ({ id: s })),
    retrieveSession: async (id) => data.sessions.get(id) as never,
    retrieveInvoice: async (id) => data.invoices.get(id)!,
    invoiceIdForPaymentIntent: async (pi) => data.pi.get(pi) ?? null,
    retrieveCharge: async (id) => data.charges.get(id) as never,
    retrieveDispute: async (id) => ({ id, livemode: false, amount: 24000, currency: 'eur', charge: 'ch_AAAAAA1' }),
    listRefunds: async () => data.refunds,
    retrieveEarlyFraudWarning: async (id) => ({ id, livemode: false, charge: 'ch_AAAAAA1' }),
    retrieveTaxId: async (id) => data.taxIds.get(id) as never,
    retrieveEvent: async (id) => data.events.get(id)!,
  }
  return { api, data }
}

let w: ReturnType<typeof makeWorld>
let stripe: ReturnType<typeof makeStripe>
let deps: SyncDeps
const ev = (type: string, id: string, over: Partial<StripeEventObj> = {}): StripeEventObj => ({
  id: `evt_${type.replace(/\W/g, '')}${Math.random().toString(36).slice(2, 8)}`, type, created: 1_700_000_500, livemode: false, data: { object: { id } }, ...over,
})
const sub = () => w.subs.get('sub_AAAAAA1')!

beforeEach(() => {
  w = makeWorld()
  stripe = makeStripe(w)
  deps = { store: w.store, stripe: stripe.api, livemode: false, now: () => new Date('2026-11-03T03:00:00Z') }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ownership through our own records', () => {
  it('checkout.session.completed: our row → project; marks the session complete; links and syncs the subscription', async () => {
    expect(await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))).toBe('processed')
    expect(w.sessions.get('cs_test_AAAAAA1')!.status).toBe('complete')
    expect(sub().projectIds).toEqual([P1])
    expect(w.snapshot()).toMatchObject({ tenant_id: T1, issuer_id: 'iss-1', status: 'active', project_id: P1, latest_invoice_id: 'in_AAAAAA1' })
  })
  it('periods come from items.data[0]', async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
    expect(w.snapshot()).toMatchObject({ current_period_start: new Date(1_700_000_000_000).toISOString(), current_period_end: new Date(1_702_592_000_000).toISOString() })
  })
  it('a session that is not ours is ignored', async () => {
    stripe.data.sessions.set('cs_test_FOREIGN', { id: 'cs_test_FOREIGN', livemode: false, status: 'complete', subscription: 'sub_AAAAAA1' })
    expect(await processEvent(deps, ev('checkout.session.completed', 'cs_test_FOREIGN'))).toBe('ignored')
    expect(w.subs.size).toBe(0)
  })
  it('metadata project_id that disagrees with our checkout row is ignored (cross-check only)', async () => {
    stripe.data.sessions.set('cs_test_AAAAAA1', { id: 'cs_test_AAAAAA1', livemode: false, status: 'complete', subscription: 'sub_AAAAAA1', metadata: { project_id: P2 } })
    expect(await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))).toBe('ignored')
    expect(w.subs.size).toBe(0)
    expect(w.sessions.get('cs_test_AAAAAA1')!.status).toBe('open')
  })
  it('subscription metadata that disagrees with the project we linked is ignored', async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
    const before = sub().syncs
    stripe.data.subs.set('sub_AAAAAA1', subObj({ metadata: { project_id: P2 }, status: 'canceled' }))
    expect(await processEvent(deps, ev('customer.subscription.updated', 'sub_AAAAAA1'))).toBe('ignored')
    expect(sub().syncs).toBe(before)
    expect(sub().status).toBe('active')
  })
  it('an unknown subscription with no checkout session of ours is ignored', async () => {
    stripe.data.sessionsBySub.clear()
    expect(await processEvent(deps, ev('customer.subscription.created', 'sub_AAAAAA1'))).toBe('ignored')
    expect(w.subs.size).toBe(0)
  })
  it('subscription.created arriving BEFORE checkout.session.completed still links through our checkout row', async () => {
    expect(await processEvent(deps, ev('customer.subscription.created', 'sub_AAAAAA1'))).toBe('processed')
    expect(sub().projectIds).toEqual([P1])
  })
  it('a customer of another client does not attach to this project', async () => {
    stripe.data.subs.set('sub_AAAAAA1', subObj({ customer: 'cus_OTHER01' }))
    expect((await syncSubscription(deps, 'sub_AAAAAA1', { projectId: P1, tenantId: T1 })).outcome).toBe('ignored')
    expect(w.subs.size).toBe(0)
  })
  it('a live subscription the project cannot take fails loudly (retried), never silently ignored', async () => {
    w.refuseLink(true)
    await expect(processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))).rejects.toThrow(/cannot be linked/)
    expect(w.subs.size).toBe(0)
  })
  it('an ended subscription the project cannot take is ignored', async () => {
    w.refuseLink(true)
    stripe.data.subs.set('sub_AAAAAA1', subObj({ status: 'canceled' }))
    expect(await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))).toBe('processed')
    expect(w.subs.size).toBe(0)
  })
  it('events of the other mode are ignored', async () => {
    expect(await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1', { livemode: true }))).toBe('ignored')
  })
  it('checkout.session.expired marks our open row expired', async () => {
    stripe.data.sessions.set('cs_test_AAAAAA1', { id: 'cs_test_AAAAAA1', livemode: false, status: 'expired', subscription: null, metadata: { project_id: P1 } })
    expect(await processEvent(deps, ev('checkout.session.expired', 'cs_test_AAAAAA1'))).toBe('processed')
    expect(w.sessions.get('cs_test_AAAAAA1')!.status).toBe('expired')
  })
  it('async_payment_failed syncs the subscription without touching activation', async () => {
    expect(await processEvent(deps, ev('checkout.session.async_payment_failed', 'cs_test_AAAAAA1'))).toBe('processed')
    expect(sub().firstPaidAt).toBeNull()
  })
})

describe('invoices', () => {
  beforeEach(async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
  })
  it('an invoice reaches its subscription through parent.subscription_details; invoice.paid activates', async () => {
    expect(await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1'))).toBe('processed')
    expect(sub().firstPaidAt).toBe(1_700_000_100_000)
  })
  it('an invoice without a subscription parent is ignored', async () => {
    stripe.data.invoices.set('in_AAAAAA1', invObj({ parent: null }))
    expect(await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1'))).toBe('ignored')
  })
  it('invoice.payment_failed starts the failure clock at the event time', async () => {
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'open', amount_paid: 0, status_transitions: {} }))
    await processEvent(deps, ev('invoice.payment_failed', 'in_AAAAAA1', { created: 1_700_000_500 }))
    expect(sub().failedAt).toBe(1_700_000_500_000)
    expect(sub().failedInvoice).toBe('in_AAAAAA1')
  })
  it('OUT OF ORDER: payment_failed delivered after paid ends settled, not failed', async () => {
    await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1'))
    // Stripe now says paid; the stale failed event still arrives later.
    await processEvent(deps, ev('invoice.payment_failed', 'in_AAAAAA1', { created: 1_700_000_050 }))
    expect(sub().failedInvoice).toBeNull()
    expect(sub().firstPaidAt).toBe(1_700_000_100_000)
  })
  it('OUT OF ORDER: failed processed first, then paid → failure cleared, activated', async () => {
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'open', amount_paid: 0, status_transitions: {} }))
    await processEvent(deps, ev('invoice.payment_failed', 'in_AAAAAA1'))
    expect(sub().failedInvoice).toBe('in_AAAAAA1')
    stripe.data.invoices.set('in_AAAAAA1', invObj())
    await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1'))
    expect(sub().failedInvoice).toBeNull()
    expect(sub().firstPaidAt).not.toBeNull()
  })
  it('voided and uncollectible invoices settle without activating', async () => {
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'open', amount_paid: 0, status_transitions: {} }))
    await processEvent(deps, ev('invoice.payment_failed', 'in_AAAAAA1'))
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'uncollectible', amount_paid: 0, status_transitions: { marked_uncollectible_at: 1_700_000_900 } }))
    await processEvent(deps, ev('invoice.marked_uncollectible', 'in_AAAAAA1'))
    expect(sub().failedInvoice).toBeNull()
    expect(sub().firstPaidAt).toBeNull()
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'void', amount_paid: 0, status_transitions: { voided_at: 1_700_001_000 } }))
    expect(await processEvent(deps, ev('invoice.voided', 'in_AAAAAA1'))).toBe('processed')
    expect(sub().firstPaidAt).toBeNull()
  })
  it('a paid invoice of 0 settles but never counts as the first payment', async () => {
    stripe.data.invoices.set('in_AAAAAA1', invObj({ amount_paid: 0 }))
    await processEvent(deps, ev('invoice.paid', 'in_AAAAAA1'))
    expect(sub().firstPaidAt).toBeNull()
    expect(sub().settled).toBe('in_AAAAAA1')
  })
  it('an invoice event for a subscription we cannot trace to a checkout is ignored', async () => {
    const lone = makeWorld()
    const d2 = { ...deps, store: lone.store }
    stripe.data.sessionsBySub.clear()
    expect(await processEvent(d2, ev('invoice.paid', 'in_AAAAAA1'))).toBe('ignored')
  })
})

describe('tax id verification', () => {
  const taxId = (status: string, value = 'IT12345678901') => ({ id: 'txi_AAAAAA1', livemode: false, type: 'eu_vat', value, customer: CUS, verification: { status, verified_name: 'ACME SRL' } })
  it('stores verified + name + timestamp', async () => {
    stripe.data.taxIds.set('txi_AAAAAA1', taxId('verified'))
    expect(await processEvent(deps, ev('customer.tax_id.updated', 'txi_AAAAAA1'))).toBe('processed')
    expect(w.vat.patch).toEqual({ status: 'verified', verifiedName: 'ACME SRL', verifiedAt: '2026-11-03T03:00:00.000Z' })
  })
  it.each(['pending', 'unverified', 'unavailable'])('stores %s without name or timestamp', async (status) => {
    stripe.data.taxIds.set('txi_AAAAAA1', taxId(status))
    await processEvent(deps, ev('customer.tax_id.updated', 'txi_AAAAAA1'))
    expect(w.vat.patch).toEqual({ status, verifiedName: null, verifiedAt: null })
  })
  it('a number that no longer matches the profile is ignored', async () => {
    stripe.data.taxIds.set('txi_AAAAAA1', taxId('verified', 'IT99999999999'))
    expect(await processEvent(deps, ev('customer.tax_id.updated', 'txi_AAAAAA1'))).toBe('ignored')
    expect(w.vat.patch).toBeNull()
  })
  it('an unknown customer or a non-EU-VAT id is ignored', async () => {
    stripe.data.taxIds.set('txi_AAAAAA1', { ...taxId('verified'), customer: 'cus_NOBODY1' })
    expect(await processEvent(deps, ev('customer.tax_id.updated', 'txi_AAAAAA1'))).toBe('ignored')
    stripe.data.taxIds.set('txi_AAAAAA1', { ...taxId('verified'), type: 'us_ein' })
    expect(await processEvent(deps, ev('customer.tax_id.updated', 'txi_AAAAAA1'))).toBe('ignored')
  })
})

describe('risk alerts (D15)', () => {
  beforeEach(async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
  })
  it('a dispute resolves charge → payment intent → invoice → subscription → project and is idempotent', async () => {
    expect(await processEvent(deps, ev('charge.dispute.created', 'du_AAAAAA1'))).toBe('processed')
    expect([...w.alerts.values()]).toEqual([
      { livemode: false, kind: 'dispute', stripeObjectId: 'du_AAAAAA1', tenantId: T1, projectId: P1, subscriptionId: 'row-sub_AAAAAA1', amountCents: 24000, currency: 'eur' },
    ])
    await processEvent(deps, ev('charge.dispute.created', 'du_AAAAAA1'))
    expect(w.alerts.size).toBe(1)
  })
  it('one alert per refund, so a second partial refund still alerts', async () => {
    await processEvent(deps, ev('charge.refunded', 'ch_AAAAAA1'))
    stripe.data.refunds.push({ id: 're_AAAAAA2', amount: 500, currency: 'eur', status: 'succeeded' }, { id: 're_FAILED01', amount: 1, currency: 'eur', status: 'failed' })
    await processEvent(deps, ev('charge.refunded', 'ch_AAAAAA1'))
    expect([...w.alerts.keys()].sort()).toEqual(['refund:re_AAAAAA1', 'refund:re_AAAAAA2'])
  })
  it('an early fraud warning is recorded with the charge amount', async () => {
    await processEvent(deps, ev('radar.early_fraud_warning.created', 'issfr_AAAAAA1'))
    expect(w.alerts.get('early_fraud_warning:issfr_AAAAAA1')).toMatchObject({ amountCents: 24000, currency: 'eur', projectId: P1 })
  })
  it('a bundle (several projects) alerts the subscription with no single project', async () => {
    sub().projectIds.push(P2)
    await processEvent(deps, ev('charge.dispute.created', 'du_AAAAAA1'))
    expect(w.alerts.get('dispute:du_AAAAAA1')).toMatchObject({ projectId: null, subscriptionId: 'row-sub_AAAAAA1' })
  })
  it('a charge with no invoice falls back to the customer\'s client; an unknown customer is ignored', async () => {
    stripe.data.pi.clear()
    await processEvent(deps, ev('charge.dispute.created', 'du_AAAAAA1'))
    expect(w.alerts.get('dispute:du_AAAAAA1')).toMatchObject({ tenantId: T1, projectId: null, subscriptionId: null })
    stripe.data.charges.set('ch_AAAAAA1', { ...stripe.data.charges.get('ch_AAAAAA1')!, customer: 'cus_NOBODY1' })
    expect(await processEvent(deps, ev('charge.dispute.created', 'du_BBBBBB1'))).toBe('ignored')
  })
  it('never touches access: only the alert store is written', async () => {
    const before = sub().status
    await processEvent(deps, ev('charge.dispute.created', 'du_AAAAAA1'))
    expect(sub().status).toBe(before)
  })
})

describe('ingest and reconcile', () => {
  it('a duplicate delivery is not processed twice', async () => {
    const e = ev('checkout.session.completed', 'cs_test_AAAAAA1')
    expect(await ingestEvent(deps, e)).toBe('processed')
    const syncs = sub().syncs
    expect(await ingestEvent(deps, e)).toBe('duplicate')
    expect(sub().syncs).toBe(syncs)
  })
  it('a processing error is recorded failed (the route answers 500) and the next delivery retries', async () => {
    const e = ev('checkout.session.completed', 'cs_test_AAAAAA1')
    const boom = vi.spyOn(stripe.api, 'retrieveSubscription').mockRejectedValueOnce(new Error('stripe 500'))
    expect(await ingestEvent(deps, e)).toBe('failed')
    expect(w.events.get(e.id)).toMatchObject({ status: 'failed', error: 'stripe 500' })
    boom.mockRestore()
    expect(await ingestEvent(deps, e)).toBe('processed')
  })
  it('reconcile re-syncs open subscriptions from Stripe (status + latest invoice) and retries stuck events', async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
    stripe.data.subs.set('sub_AAAAAA1', subObj({ status: 'past_due' }))
    stripe.data.invoices.set('in_AAAAAA1', invObj({ status: 'open', amount_paid: 0, status_transitions: {} }))
    const lost = ev('invoice.paid', 'in_AAAAAA1', { id: 'evt_LOSTAAA1' })
    w.events.set('evt_LOSTAAA1', { status: 'failed', attempts: 1 })
    stripe.data.events.set('evt_LOSTAAA1', lost)
    const r = await reconcileBilling(deps)
    expect(r.subscriptions).toEqual({ checked: 1, synced: 1, ignored: 0, failed: 0 })
    expect(r.events).toMatchObject({ retried: 1, failed: 0 })
    expect(sub().status).toBe('past_due')
    expect(sub().failedInvoice).toBe('in_AAAAAA1') // backstop: a lost payment_failed is recovered
    expect(w.events.get('evt_LOSTAAA1')!.status).toBe('processed')
  })
  it('one failing subscription does not stop the reconcile', async () => {
    await processEvent(deps, ev('checkout.session.completed', 'cs_test_AAAAAA1'))
    vi.spyOn(stripe.api, 'retrieveSubscription').mockRejectedValue(new Error('down'))
    const r = await reconcileBilling(deps)
    expect(r.subscriptions.failed).toBe(1)
  })
  it('lists the exact event types the endpoint must subscribe to', () => {
    expect([...HANDLED_EVENT_TYPES].sort()).toEqual([
      'charge.dispute.created', 'charge.refunded', 'checkout.session.async_payment_failed', 'checkout.session.async_payment_succeeded',
      'checkout.session.completed', 'checkout.session.expired', 'customer.subscription.created', 'customer.subscription.deleted',
      'customer.subscription.updated', 'customer.tax_id.updated', 'invoice.marked_uncollectible', 'invoice.paid', 'invoice.payment_failed',
      'invoice.voided', 'radar.early_fraud_warning.created',
    ])
  })
})

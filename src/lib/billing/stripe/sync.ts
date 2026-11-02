// Server-only. Never import from a client component.
/**
 * Stripe → Abluo sync — ADR-041 D11 (inbound events), D15 (risk alerts).
 *
 * Rules, all from the ADR:
 *  - Every handler RE-FETCHES the object from Stripe; the event payload only
 *    names it. Event order is never trusted (a "failed" can arrive after "paid").
 *  - Ownership is decided through OUR records: a Checkout session → our
 *    `billing_checkout_sessions` row → project; a subscription → our
 *    `billing_subscriptions` row; a customer → our `billing_customers` row.
 *    Stripe metadata is compared as a cross-check only: a mismatch is logged
 *    and the event is NOT applied.
 *  - Unknown objects are `ignored` (200), transient errors throw (500, Stripe retries).
 *  - Risk events (dispute / refund / early fraud warning) create alerts. They
 *    never change access.
 *
 * Everything here is pure orchestration over two narrow interfaces
 * (`SyncStore`, `StripeApi`); `store.ts` implements them for production.
 */

/** Stripe events this endpoint acts on — the endpoint must subscribe to exactly these. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'customer.tax_id.updated',
  'charge.dispute.created',
  'charge.refunded',
  'radar.early_fraud_warning.created',
] as const

/** Retried events older than this many minutes (received/failed) — D11 nightly retry. */
export const RETRY_AFTER_MINUTES = 10
/** Stripe keeps events retrievable for 30 days; stop retrying a little earlier. */
export const RETRY_WINDOW_DAYS = 25

// ── Minimal shapes of what we read from Stripe ───────────────────────────────
export type StripeRef = string | { id: string } | null | undefined
export const refId = (v: StripeRef): string | null => (typeof v === 'string' ? v : (v?.id ?? null))

export type StripeSubscriptionObj = {
  id: string
  livemode: boolean
  status: string
  customer: StripeRef
  cancel_at_period_end: boolean
  canceled_at: number | null
  ended_at: number | null
  latest_invoice: StripeRef
  metadata?: Record<string, string> | null
  items: { data: { current_period_start?: number; current_period_end?: number }[] }
}
export type StripeInvoiceObj = {
  id: string
  livemode: boolean
  status: string | null
  amount_paid: number
  attempt_count?: number
  customer?: StripeRef
  parent?: { subscription_details?: { subscription?: StripeRef } | null } | null
  status_transitions?: { paid_at?: number | null; voided_at?: number | null; marked_uncollectible_at?: number | null } | null
}
export type StripeSessionObj = {
  id: string
  livemode: boolean
  status: string | null
  subscription?: StripeRef
  metadata?: Record<string, string> | null
}
export type StripeChargeObj = { id: string; livemode: boolean; amount: number; currency: string; payment_intent?: StripeRef; customer?: StripeRef }
export type StripeDisputeObj = { id: string; livemode: boolean; amount: number; currency: string; charge: StripeRef }
export type StripeRefundObj = { id: string; amount: number; currency: string; status: string | null }
export type StripeEfwObj = { id: string; livemode: boolean; charge: StripeRef }
export type StripeTaxIdObj = {
  id: string
  livemode: boolean
  type: string
  value: string
  customer?: StripeRef
  verification?: { status: string; verified_name?: string | null } | null
}
export type StripeEventObj = {
  id: string
  type: string
  created: number
  livemode: boolean
  data: { object: { id?: string } & Record<string, unknown> }
}

/** Every Stripe read the sync needs. Production: `stripeApi(getStripe())` in store.ts. */
export interface StripeApi {
  retrieveSubscription(id: string): Promise<StripeSubscriptionObj>
  listSessionsForSubscription(subscriptionId: string): Promise<{ id: string }[]>
  retrieveSession(id: string): Promise<StripeSessionObj>
  retrieveInvoice(id: string): Promise<StripeInvoiceObj>
  /** The invoice a PaymentIntent paid for (InvoicePayments), or null. */
  invoiceIdForPaymentIntent(paymentIntentId: string): Promise<string | null>
  retrieveCharge(id: string): Promise<StripeChargeObj>
  retrieveDispute(id: string): Promise<StripeDisputeObj>
  listRefunds(chargeId: string): Promise<StripeRefundObj[]>
  retrieveEarlyFraudWarning(id: string): Promise<StripeEfwObj>
  retrieveTaxId(id: string): Promise<StripeTaxIdObj>
  retrieveEvent(id: string): Promise<StripeEventObj>
}

// ── Our records ──────────────────────────────────────────────────────────────
export type AlertKind = 'dispute' | 'refund' | 'early_fraud_warning'
export type AlertInsert = {
  livemode: boolean
  kind: AlertKind
  stripeObjectId: string
  tenantId: string
  projectId: string | null
  subscriptionId: string | null
  amountCents: number | null
  currency: string | null
}
export type VatVerificationPatch = { status: 'pending' | 'verified' | 'unverified' | 'unavailable'; verifiedName: string | null; verifiedAt: string | null }

export interface SyncStore {
  /** stripe_event_claim: true = process now, false = duplicate. */
  claimEvent(e: { id: string; livemode: boolean; type: string; objectId: string | null; created: Date }): Promise<boolean>
  finishEvent(id: string, status: 'processed' | 'ignored' | 'failed', error?: string): Promise<void>
  checkoutSession(stripeSessionId: string): Promise<{ projectId: string; tenantId: string; livemode: boolean; status: string } | null>
  markCheckoutSession(stripeSessionId: string, status: 'complete' | 'expired', at: Date): Promise<void>
  customerByStripeId(stripeCustomerId: string): Promise<{ tenantId: string; issuerId: string; livemode: boolean } | null>
  subscriptionByStripeId(stripeSubscriptionId: string, livemode: boolean): Promise<{ id: string; tenantId: string; projectIds: string[] } | null>
  syncSubscription(snapshot: Record<string, unknown>): Promise<string>
  recordInvoice(stripeSubscriptionId: string, livemode: boolean, invoiceId: string, outcome: 'paid' | 'voided' | 'failed', at: Date): Promise<void>
  /** Updates the tenant's profile when its VAT id equals `vatId`. Returns whether a row changed. */
  updateVatVerification(tenantId: string, livemode: boolean, vatId: string, patch: VatVerificationPatch): Promise<boolean>
  /** Idempotent on (kind, stripe object): returns true when a new alert was created. */
  insertAlert(a: AlertInsert): Promise<boolean>
  listOpenSubscriptions(livemode: boolean, limit: number): Promise<{ stripeSubscriptionId: string }[]>
  listRetryableEvents(livemode: boolean, olderThan: Date, newerThan: Date, limit: number): Promise<{ eventId: string }[]>
}

export type SyncDeps = { store: SyncStore; stripe: StripeApi; livemode: boolean; now?: () => Date }
export type EventOutcome = 'processed' | 'ignored'

const warn = (msg: string, extra?: Record<string, unknown>) => console.warn(`[billing] ${msg}`, extra ?? '')
const isoOf = (unix: number | null | undefined) => (typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null)
const dateOf = (unix: number | null | undefined, fallback: number) => new Date((typeof unix === 'number' ? unix : fallback) * 1000)
const metaProject = (m: Record<string, string> | null | undefined) => (m?.project_id ? m.project_id : null)
const nowOf = (d: SyncDeps) => (d.now ? d.now() : new Date())

// ── Subscriptions ────────────────────────────────────────────────────────────
type SubSync = { outcome: 'synced'; sub: StripeSubscriptionObj } | { outcome: 'ignored'; reason: string }

/** Which of OUR checkout sessions created this subscription? (Stripe lists sessions by subscription.) */
async function ownerViaCheckout(deps: SyncDeps, subscriptionId: string) {
  for (const s of await deps.stripe.listSessionsForSubscription(subscriptionId)) {
    const row = await deps.store.checkoutSession(s.id)
    if (row && row.livemode === deps.livemode) return row
  }
  return null
}

/**
 * Re-fetch a subscription and write the snapshot. `link` (from our checkout
 * row) also attaches it to the project. A subscription we do not know and
 * cannot trace to one of our checkout sessions is ignored.
 */
export async function syncSubscription(deps: SyncDeps, subscriptionId: string, link?: { projectId: string; tenantId: string }): Promise<SubSync> {
  const sub = await deps.stripe.retrieveSubscription(subscriptionId)
  if (sub.livemode !== deps.livemode) return { outcome: 'ignored', reason: 'mode' }
  const known = await deps.store.subscriptionByStripeId(subscriptionId, deps.livemode)
  let owner = link ?? null
  if (!known && !owner) {
    const row = await ownerViaCheckout(deps, subscriptionId)
    if (!row) return { outcome: 'ignored', reason: 'unknown_subscription' }
    owner = { projectId: row.projectId, tenantId: row.tenantId }
  }
  const expected = owner ? [owner.projectId] : (known?.projectIds ?? [])
  const claimed = metaProject(sub.metadata)
  if (claimed && expected.length > 0 && !expected.includes(claimed)) {
    warn('subscription metadata project mismatch — ignored', { subscription: subscriptionId, metadata: claimed, expected })
    return { outcome: 'ignored', reason: 'metadata_mismatch' }
  }
  const customerId = refId(sub.customer)
  const customer = customerId ? await deps.store.customerByStripeId(customerId) : null
  if (!customer || customer.livemode !== deps.livemode) return { outcome: 'ignored', reason: 'unknown_customer' }
  const tenantId = known?.tenantId ?? owner?.tenantId
  if (tenantId && tenantId !== customer.tenantId) {
    warn('subscription customer belongs to another client — ignored', { subscription: subscriptionId })
    return { outcome: 'ignored', reason: 'tenant_mismatch' }
  }
  const item = sub.items?.data?.[0]
  try {
    await deps.store.syncSubscription({
      tenant_id: customer.tenantId,
      issuer_id: customer.issuerId,
      livemode: deps.livemode,
      stripe_subscription_id: sub.id,
      status: sub.status,
      current_period_start: isoOf(item?.current_period_start),
      current_period_end: isoOf(item?.current_period_end),
      cancel_at_period_end: sub.cancel_at_period_end,
      canceled_at: isoOf(sub.canceled_at),
      ended_at: isoOf(sub.ended_at),
      latest_invoice_id: refId(sub.latest_invoice),
      project_id: owner?.projectId ?? null,
    })
  } catch (e) {
    if (e instanceof Error && /billing:project_not_linkable/.test(e.message)) {
      // An ended subscription that lost the project is harmless. A live one
      // means a client may be paying for a project it is not linked to: fail
      // loudly (event marked failed, Stripe and the nightly retry try again).
      if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        warn('project cannot take this ended subscription — ignored', { subscription: subscriptionId, project: owner?.projectId })
        return { outcome: 'ignored', reason: 'project_not_linkable' }
      }
      throw new Error(`live subscription ${subscriptionId} cannot be linked to project ${owner?.projectId ?? '?'} (already linked to another live subscription)`)
    }
    throw e
  }
  return { outcome: 'synced', sub }
}

// ── Invoices ─────────────────────────────────────────────────────────────────
const subscriptionOfInvoice = (inv: StripeInvoiceObj) => refId(inv.parent?.subscription_details?.subscription)

/**
 * Record what an invoice (just re-fetched) means for its subscription. The
 * invoice's CURRENT state decides, not the event that pointed at it. A paid
 * invoice of 0 is settled without counting as a payment (never activates).
 * `eventType` is only used to tell "open because it failed" from "open, nothing
 * happened yet"; the reconcile passes `subscriptionStatus` for the same purpose.
 */
async function recordInvoiceState(
  deps: SyncDeps,
  subscriptionId: string,
  inv: StripeInvoiceObj,
  ctx: { eventType?: string; eventTime: number; subscriptionStatus?: string },
): Promise<boolean> {
  const tr = inv.status_transitions ?? {}
  let outcome: 'paid' | 'voided' | 'failed'
  let at: Date
  if (inv.status === 'paid') {
    outcome = inv.amount_paid > 0 ? 'paid' : 'voided'
    at = dateOf(tr.paid_at, ctx.eventTime)
  } else if (inv.status === 'void' || inv.status === 'uncollectible') {
    outcome = 'voided'
    at = dateOf(inv.status === 'void' ? tr.voided_at : tr.marked_uncollectible_at, ctx.eventTime)
  } else if (
    inv.status === 'open' &&
    (ctx.eventType === 'invoice.payment_failed' || ((inv.attempt_count ?? 0) > 0 && (ctx.subscriptionStatus === 'past_due' || ctx.subscriptionStatus === 'unpaid')))
  ) {
    outcome = 'failed'
    at = dateOf(undefined, ctx.eventTime)
  } else {
    return false
  }
  await deps.store.recordInvoice(subscriptionId, deps.livemode, inv.id, outcome, at)
  return true
}

async function handleInvoice(deps: SyncDeps, event: StripeEventObj): Promise<EventOutcome> {
  const inv = await deps.stripe.retrieveInvoice(String(event.data.object.id))
  if (inv.livemode !== deps.livemode) return 'ignored'
  const subscriptionId = subscriptionOfInvoice(inv)
  if (!subscriptionId) return 'ignored' // not a subscription invoice
  const res = await syncSubscription(deps, subscriptionId)
  if (res.outcome === 'ignored') return 'ignored'
  await recordInvoiceState(deps, subscriptionId, inv, { eventType: event.type, eventTime: event.created, subscriptionStatus: res.sub.status })
  return 'processed'
}

// ── Checkout sessions ────────────────────────────────────────────────────────
async function handleCheckout(deps: SyncDeps, event: StripeEventObj): Promise<EventOutcome> {
  const sessionId = String(event.data.object.id)
  const row = await deps.store.checkoutSession(sessionId)
  if (!row) return 'ignored' // not one of ours
  const session = await deps.stripe.retrieveSession(sessionId)
  if (session.livemode !== deps.livemode || row.livemode !== deps.livemode) return 'ignored'
  const claimed = metaProject(session.metadata)
  if (claimed && claimed !== row.projectId) {
    warn('checkout metadata project mismatch — ignored', { session: sessionId, metadata: claimed, ours: row.projectId })
    return 'ignored'
  }
  if (event.type === 'checkout.session.expired') {
    if (session.status !== 'expired') return 'ignored'
    await deps.store.markCheckoutSession(sessionId, 'expired', nowOf(deps))
    return 'processed'
  }
  if (session.status !== 'complete') return 'ignored'
  await deps.store.markCheckoutSession(sessionId, 'complete', nowOf(deps))
  const subscriptionId = refId(session.subscription)
  if (!subscriptionId) return 'processed'
  await syncSubscription(deps, subscriptionId, { projectId: row.projectId, tenantId: row.tenantId })
  return 'processed'
}

// ── VAT verification (VIES result reported by Stripe) ────────────────────────
const normVat = (v: string) => v.replace(/[\s.-]/g, '').toUpperCase()

async function handleTaxId(deps: SyncDeps, event: StripeEventObj): Promise<EventOutcome> {
  const taxId = await deps.stripe.retrieveTaxId(String(event.data.object.id))
  if (taxId.livemode !== deps.livemode || taxId.type !== 'eu_vat') return 'ignored'
  const status = taxId.verification?.status
  if (status !== 'pending' && status !== 'verified' && status !== 'unverified' && status !== 'unavailable') return 'ignored'
  const customerId = refId(taxId.customer)
  const customer = customerId ? await deps.store.customerByStripeId(customerId) : null
  if (!customer || customer.livemode !== deps.livemode) return 'ignored'
  const patch: VatVerificationPatch =
    status === 'verified'
      ? { status, verifiedName: taxId.verification?.verified_name?.slice(0, 300) || null, verifiedAt: nowOf(deps).toISOString() }
      : { status, verifiedName: null, verifiedAt: null }
  // Matches only while the profile still holds this exact number: a stale tax id never overwrites a newer one.
  return (await deps.store.updateVatVerification(customer.tenantId, deps.livemode, normVat(taxId.value), patch)) ? 'processed' : 'ignored'
}

// ── Risk alerts (D15) — recorded, never changes access ───────────────────────
async function resolveCharge(deps: SyncDeps, chargeId: string) {
  const charge = await deps.stripe.retrieveCharge(chargeId)
  if (charge.livemode !== deps.livemode) return null
  let subscriptionId: string | null = null
  const paymentIntent = refId(charge.payment_intent)
  if (paymentIntent) {
    const invoiceId = await deps.stripe.invoiceIdForPaymentIntent(paymentIntent)
    if (invoiceId) subscriptionId = subscriptionOfInvoice(await deps.stripe.retrieveInvoice(invoiceId))
  }
  const sub = subscriptionId ? await deps.store.subscriptionByStripeId(subscriptionId, deps.livemode) : null
  let tenantId = sub?.tenantId ?? null
  if (!tenantId) {
    const customerId = refId(charge.customer)
    const customer = customerId ? await deps.store.customerByStripeId(customerId) : null
    if (customer && customer.livemode === deps.livemode) tenantId = customer.tenantId
  }
  if (!tenantId) return null
  return { charge, tenantId, subscriptionRowId: sub?.id ?? null, projectId: sub && sub.projectIds.length === 1 ? sub.projectIds[0] : null }
}

async function recordAlert(deps: SyncDeps, kind: AlertKind, objectId: string, chargeId: string, amount: number | null, currency: string | null) {
  const target = await resolveCharge(deps, chargeId)
  if (!target) return false
  await deps.store.insertAlert({
    livemode: deps.livemode,
    kind,
    stripeObjectId: objectId,
    tenantId: target.tenantId,
    projectId: target.projectId,
    subscriptionId: target.subscriptionRowId,
    amountCents: amount ?? target.charge.amount,
    currency: currency ?? target.charge.currency,
  })
  return true
}

async function handleRisk(deps: SyncDeps, event: StripeEventObj): Promise<EventOutcome> {
  const id = String(event.data.object.id)
  if (event.type === 'charge.dispute.created') {
    const d = await deps.stripe.retrieveDispute(id)
    const chargeId = refId(d.charge)
    return chargeId && (await recordAlert(deps, 'dispute', d.id, chargeId, d.amount, d.currency)) ? 'processed' : 'ignored'
  }
  if (event.type === 'radar.early_fraud_warning.created') {
    const w = await deps.stripe.retrieveEarlyFraudWarning(id)
    const chargeId = refId(w.charge)
    return chargeId && (await recordAlert(deps, 'early_fraud_warning', w.id, chargeId, null, null)) ? 'processed' : 'ignored'
  }
  // charge.refunded — one alert per refund, so a second partial refund is not swallowed by the first.
  let any = false
  for (const r of await deps.stripe.listRefunds(id)) {
    if (r.status === 'failed' || r.status === 'canceled') continue
    if (await recordAlert(deps, 'refund', r.id, id, r.amount, r.currency)) any = true
  }
  return any ? 'processed' : 'ignored'
}

// ── Dispatcher ───────────────────────────────────────────────────────────────
/** Apply one verified event. Throws on transient errors (the caller answers 500). */
export async function processEvent(deps: SyncDeps, event: StripeEventObj): Promise<EventOutcome> {
  if (event.livemode !== deps.livemode) return 'ignored'
  if (!event.data?.object?.id) return 'ignored'
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      return handleCheckout(deps, event)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return (await syncSubscription(deps, String(event.data.object.id))).outcome === 'synced' ? 'processed' : 'ignored'
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible':
      return handleInvoice(deps, event)
    case 'customer.tax_id.updated':
      return handleTaxId(deps, event)
    case 'charge.dispute.created':
    case 'charge.refunded':
    case 'radar.early_fraud_warning.created':
      return handleRisk(deps, event)
    default:
      return 'ignored'
  }
}

/**
 * Claim → process → finish. Returns 'duplicate' for an event already done,
 * 'failed' when processing threw (recorded; the caller answers 500 so Stripe
 * retries). A failure of the ledger itself throws.
 */
export async function ingestEvent(deps: SyncDeps, event: StripeEventObj): Promise<'duplicate' | 'processed' | 'ignored' | 'failed'> {
  const claimed = await deps.store.claimEvent({
    id: event.id,
    livemode: event.livemode,
    type: event.type,
    objectId: event.data?.object?.id ? String(event.data.object.id) : null,
    created: new Date(event.created * 1000),
  })
  if (!claimed) return 'duplicate'
  try {
    const outcome = await processEvent(deps, event)
    await deps.store.finishEvent(event.id, outcome)
    return outcome
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[billing] event ${event.id} (${event.type}) failed: ${message}`)
    await deps.store.finishEvent(event.id, 'failed', message)
    return 'failed'
  }
}

// ── Nightly reconcile (D11) ──────────────────────────────────────────────────
export type ReconcileResult = {
  subscriptions: { checked: number; synced: number; ignored: number; failed: number }
  events: { retried: number; processed: number; ignored: number; failed: number }
  /** The time budget ran out before every subscription was checked. */
  stoppedEarly: boolean
}

export const RECONCILE_MAX_SUBSCRIPTIONS = 500
export const RECONCILE_MAX_EVENTS = 100
/** Stay well inside the cron route's maxDuration (300 s). */
export const RECONCILE_BUDGET_MS = 240_000

/**
 * Re-sync every non-terminal subscription of this mode from Stripe (snapshot +
 * its latest invoice) and retry webhook events stuck in received/failed. One
 * failing item never stops the rest. Events go first; the sweep stops at the
 * time budget. No emails (D5).
 */
export async function reconcileBilling(deps: SyncDeps, opts: { budgetMs?: number; clock?: () => number } = {}): Promise<ReconcileResult> {
  const clock = opts.clock ?? Date.now
  const deadline = clock() + (opts.budgetMs ?? RECONCILE_BUDGET_MS)
  const out: ReconcileResult = {
    subscriptions: { checked: 0, synced: 0, ignored: 0, failed: 0 },
    events: { retried: 0, processed: 0, ignored: 0, failed: 0 },
    stoppedEarly: false,
  }
  const now = nowOf(deps)
  // Stuck events first (few, and each may be a paid checkout waiting to link), then the subscription sweep.
  const olderThan = new Date(now.getTime() - RETRY_AFTER_MINUTES * 60_000)
  const newerThan = new Date(now.getTime() - RETRY_WINDOW_DAYS * 86_400_000)
  for (const e of await deps.store.listRetryableEvents(deps.livemode, olderThan, newerThan, RECONCILE_MAX_EVENTS)) {
    out.events.retried++
    try {
      const result = await ingestEvent(deps, await deps.stripe.retrieveEvent(e.eventId))
      if (result === 'processed') out.events.processed++
      else if (result === 'failed') out.events.failed++
      else out.events.ignored++
    } catch (err) {
      out.events.failed++
      console.error(`[billing] retry ${e.eventId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  for (const s of await deps.store.listOpenSubscriptions(deps.livemode, RECONCILE_MAX_SUBSCRIPTIONS)) {
    if (clock() > deadline) {
      out.stoppedEarly = true // oldest synced_at first, so the next run continues where this one stopped
      break
    }
    out.subscriptions.checked++
    try {
      const res = await syncSubscription(deps, s.stripeSubscriptionId)
      if (res.outcome === 'ignored') {
        out.subscriptions.ignored++
        continue
      }
      const invoiceId = refId(res.sub.latest_invoice)
      if (invoiceId) {
        const inv = await deps.stripe.retrieveInvoice(invoiceId)
        await recordInvoiceState(deps, s.stripeSubscriptionId, inv, { eventTime: Math.floor(now.getTime() / 1000), subscriptionStatus: res.sub.status })
      }
      out.subscriptions.synced++
    } catch (e) {
      out.subscriptions.failed++
      console.error(`[billing] reconcile ${s.stripeSubscriptionId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

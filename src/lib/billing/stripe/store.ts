// Server-only. Never import from a client component.
/**
 * Production implementations of the sync's two seams (see sync.ts):
 *  - `createSupabaseStore()`  our billing tables, via the service role + the
 *    057/058 SQL functions (stripe_event_claim/finish, billing_sync_subscription,
 *    billing_record_invoice);
 *  - `stripeApi(stripe)`      the Stripe reads, pinned to the SDK's API version.
 */
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AlertInsert, StripeApi, SyncStore } from './sync'

type Db = ReturnType<typeof createAdminClient>
const fail = (what: string, error: { message: string } | null) => {
  throw new Error(`billing: ${what}: ${error?.message ?? 'unknown'}`)
}

export function createSupabaseStore(db: Db = createAdminClient()): SyncStore {
  return {
    async claimEvent(e) {
      const { data, error } = await db.rpc('stripe_event_claim', {
        p_event_id: e.id,
        p_livemode: e.livemode,
        p_type: e.type,
        p_object_id: e.objectId,
        p_created: e.created.toISOString(),
      })
      if (error) fail('event claim', error)
      return data === true
    },
    async finishEvent(id, status, error) {
      const res = await db.rpc('stripe_event_finish', { p_event_id: id, p_status: status, p_error: error ?? null })
      if (res.error) fail('event finish', res.error)
    },
    async checkoutSession(id) {
      const { data, error } = await db
        .from('billing_checkout_sessions')
        .select('project_id, livemode, status')
        .eq('stripe_session_id', id)
        .maybeSingle()
      if (error) fail('checkout read', error)
      if (!data) return null
      const project = await db.from('projects').select('tenant_id').eq('id', data.project_id).maybeSingle()
      if (project.error) fail('project read', project.error)
      if (!project.data?.tenant_id) return null
      return { projectId: String(data.project_id), tenantId: String(project.data.tenant_id), livemode: data.livemode === true, status: String(data.status) }
    },
    async markCheckoutSession(id, status, at) {
      // complete is final truth from Stripe; expired only closes a still-open session.
      const q =
        status === 'complete'
          ? db.from('billing_checkout_sessions').update({ status: 'complete', completed_at: at.toISOString() }).eq('stripe_session_id', id).neq('status', 'complete')
          : db.from('billing_checkout_sessions').update({ status: 'expired' }).eq('stripe_session_id', id).eq('status', 'open')
      const { error } = await q
      if (error) fail('checkout update', error)
    },
    async customerByStripeId(id) {
      const { data, error } = await db.from('billing_customers').select('tenant_id, issuer_id, livemode').eq('stripe_customer_id', id).maybeSingle()
      if (error) fail('customer read', error)
      return data ? { tenantId: String(data.tenant_id), issuerId: String(data.issuer_id), livemode: data.livemode === true } : null
    },
    async subscriptionByStripeId(id, livemode) {
      const { data, error } = await db
        .from('billing_subscriptions')
        .select('id, tenant_id')
        .eq('stripe_subscription_id', id)
        .eq('livemode', livemode)
        .maybeSingle()
      if (error) fail('subscription read', error)
      if (!data) return null
      const linked = await db.from('project_billing').select('project_id').eq('billing_subscription_id', data.id).eq('livemode', livemode)
      if (linked.error) fail('project read', linked.error)
      return { id: String(data.id), tenantId: String(data.tenant_id), projectIds: (linked.data ?? []).map((r) => String(r.project_id)) }
    },
    async syncSubscription(snapshot) {
      const { data, error } = await db.rpc('billing_sync_subscription', { p: snapshot })
      if (error) fail('subscription sync', error)
      return String(data)
    },
    async recordInvoice(sub, livemode, invoice, outcome, at) {
      const { error } = await db.rpc('billing_record_invoice', {
        p_stripe_subscription_id: sub,
        p_livemode: livemode,
        p_invoice_id: invoice,
        p_outcome: outcome,
        p_at: at.toISOString(),
      })
      if (error) fail('invoice record', error)
    },
    async updateVatVerification(tenantId, livemode, vatId, patch) {
      const { data, error } = await db
        .from('billing_profiles')
        .update({ vat_verification: patch.status, vat_verified_at: patch.verifiedAt, vat_verified_name: patch.verifiedName })
        .eq('tenant_id', tenantId)
        .eq('livemode', livemode)
        .eq('vat_id', vatId)
        .select('tenant_id')
      if (error) fail('vat update', error)
      return (data ?? []).length > 0
    },
    async insertAlert(a: AlertInsert) {
      const { data, error } = await db
        .from('billing_alerts')
        .upsert(
          {
            livemode: a.livemode,
            kind: a.kind,
            stripe_object_id: a.stripeObjectId,
            tenant_id: a.tenantId,
            project_id: a.projectId,
            subscription_id: a.subscriptionId,
            amount_cents: a.amountCents,
            currency: a.currency,
          },
          { onConflict: 'kind,stripe_object_id', ignoreDuplicates: true },
        )
        .select('id')
      if (error) fail('alert insert', error)
      return (data ?? []).length > 0
    },
    async listOpenSubscriptions(livemode, limit) {
      const { data, error } = await db
        .from('billing_subscriptions')
        .select('stripe_subscription_id')
        .eq('livemode', livemode)
        .not('status', 'in', '(canceled,incomplete_expired)')
        .order('synced_at', { ascending: true })
        .limit(limit)
      if (error) fail('subscriptions list', error)
      return (data ?? []).map((r) => ({ stripeSubscriptionId: String(r.stripe_subscription_id) }))
    },
    async listRetryableEvents(livemode, olderThan, newerThan, limit) {
      const { data, error } = await db
        .from('stripe_webhook_events')
        .select('event_id')
        .eq('livemode', livemode)
        .in('status', ['received', 'failed'])
        .lt('received_at', olderThan.toISOString())
        .gte('received_at', newerThan.toISOString())
        .order('received_at', { ascending: true })
        .limit(limit)
      if (error) fail('events list', error)
      return (data ?? []).map((r) => ({ eventId: String(r.event_id) }))
    },
  }
}

/** The Stripe reads of the sync, over the real SDK (API version pinned in client.ts). */
export function stripeApi(stripe: Stripe): StripeApi {
  return {
    retrieveSubscription: (id) => stripe.subscriptions.retrieve(id) as unknown as ReturnType<StripeApi['retrieveSubscription']>,
    listSessionsForSubscription: async (subscription) => (await stripe.checkout.sessions.list({ subscription, limit: 10 })).data,
    retrieveSession: (id) => stripe.checkout.sessions.retrieve(id) as unknown as ReturnType<StripeApi['retrieveSession']>,
    retrieveInvoice: (id) => stripe.invoices.retrieve(id) as unknown as ReturnType<StripeApi['retrieveInvoice']>,
    async invoiceIdForPaymentIntent(paymentIntent) {
      const list = await stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntent }, limit: 1 })
      const inv = list.data[0]?.invoice
      return typeof inv === 'string' ? inv : (inv?.id ?? null)
    },
    retrieveCharge: (id) => stripe.charges.retrieve(id) as unknown as ReturnType<StripeApi['retrieveCharge']>,
    retrieveDispute: (id) => stripe.disputes.retrieve(id) as unknown as ReturnType<StripeApi['retrieveDispute']>,
    async listRefunds(charge) {
      return (await stripe.refunds.list({ charge, limit: 25 })).data as unknown as Awaited<ReturnType<StripeApi['listRefunds']>>
    },
    retrieveEarlyFraudWarning: (id) => stripe.radar.earlyFraudWarnings.retrieve(id) as unknown as ReturnType<StripeApi['retrieveEarlyFraudWarning']>,
    retrieveTaxId: (id) => stripe.taxIds.retrieve(id) as unknown as ReturnType<StripeApi['retrieveTaxId']>,
    retrieveEvent: (id) => stripe.events.retrieve(id) as unknown as ReturnType<StripeApi['retrieveEvent']>,
  }
}

// Server-only. Never import from a client component.
/**
 * Outbound Stripe side of billing (ADR-041 D6, D7, D12, D13, D14): customers,
 * products/prices, Checkout, Customer Portal, admin cancel-at-period-end.
 *
 * Fulfilment is NOT done here: webhooks (Phase 3b) link subscriptions and
 * record invoices. Abluo (billing_profiles / project_billing) is the source of
 * truth; Stripe receives a copy.
 *
 * Rules kept here: `payment_method_types` is never passed (card-only comes
 * from the Dashboard payment method configuration); every create carries an
 * idempotency key; Checkout carries an `integration_identifier`.
 */
import type Stripe from 'stripe'
import { billingLivemode } from '@/lib/admin/billing/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from './client'

/**
 * TODO(tax): Stripe Tax stays OFF until the accountant confirms issuer,
 * registrations and the product tax code (ADR-041 §7). Flip only after that.
 */
export const BILLING_AUTOMATIC_TAX = false

/** Label of `integration_identifier` (a random 8-letter suffix is appended per session). */
export const CHECKOUT_INTEGRATION_LABEL = 'abluo-checkout'
/** Sessions live 24 h (Stripe maximum); a little less so clock skew can never exceed it. */
export const CHECKOUT_LIFETIME_MS = 24 * 3_600_000 - 60_000
/** An open session is reused only while it has at least this long left. */
export const CHECKOUT_REUSE_MIN_LEFT_MS = 3_600_000

export type BillingErrorCode =
  | 'unavailable'
  | 'noIssuer'
  | 'notFound'
  | 'notBilled'
  | 'profileIncomplete'
  | 'vatNotVerified'
  /** VIES answered: the VAT number could not be confirmed (Stripe `unverified`). */
  | 'vatInvalid'
  | 'alreadySubscribed'
  | 'noCustomer'
  | 'failed'

export class BillingError extends Error {
  constructor(readonly code: BillingErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'BillingError'
  }
}

export type Issuer = { id: string; key: string; legal_name: string; country: string }

type ProfileRow = {
  billing_email: string | null
  customer_type: 'business' | 'individual' | null
  legal_name: string | null
  contact_name: string | null
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
  region: string | null
  country: string | null
  vat_id: string | null
  tax_code: string | null
  vat_verification: 'none' | 'pending' | 'verified' | 'unverified' | 'unavailable'
}
const PROFILE_COLUMNS =
  'billing_email, customer_type, legal_name, contact_name, address_line1, address_line2, postal_code, city, region, country, vat_id, tax_code, vat_verification'

type AgreementRow = {
  arrangement: 'stripe' | 'manual' | 'complimentary'
  amount_cents: number | null
  currency: string
  billing_interval: 'month' | 'year' | null
  interval_count: number
  terms_version: number
  stripe_price_id: string | null
  billing_subscription_id: string | null
}
const AGREEMENT_COLUMNS = 'arrangement, amount_cents, currency, billing_interval, interval_count, terms_version, stripe_price_id, billing_subscription_id'

export type ProjectRow = { id: string; slug: string; name: string; custom_domain: string | null; tenant_id: string }

const NON_TERMINAL_EXCLUDED = new Set(['incomplete_expired', 'canceled'])

const stripeOrThrow = (): Stripe => {
  const s = getStripe()
  if (!s) throw new BillingError('unavailable', 'stripe not configured')
  return s
}

/** 8 random lowercase letters. */
export function randomSuffix(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => String.fromCharCode(97 + (b % 26))).join('')
}

// ── Issuer ──────────────────────────────────────────────────────────────────
export async function activeIssuer(): Promise<Issuer> {
  const db = createAdminClient()
  const { data, error } = await db.from('billing_issuers').select('id, key, legal_name, country').eq('status', 'active').maybeSingle()
  if (error) throw new BillingError('failed', `issuer read: ${error.message}`)
  if (!data) throw new BillingError('noIssuer')
  return data as Issuer
}

// ── Profile helpers ─────────────────────────────────────────────────────────
/** Pure: is the profile complete enough to check out? (email, country, name — company name or full name; business: + VAT) */
export function profileCompleteness(p: ProfileRow | null): 'ok' | 'profileIncomplete' | 'vatNotVerified' {
  if (!p || !p.billing_email || !p.country || !p.customer_type) return 'profileIncomplete'
  if (p.customer_type === 'individual' && !p.legal_name) return 'profileIncomplete'
  if (p.customer_type === 'business') {
    if (!p.legal_name || !p.vat_id) return 'profileIncomplete'
    if (p.vat_verification !== 'verified') return 'vatNotVerified'
  }
  return 'ok'
}

async function readProfile(tenantId: string, livemode: boolean): Promise<ProfileRow | null> {
  const db = createAdminClient()
  const { data, error } = await db.from('billing_profiles').select(PROFILE_COLUMNS).eq('tenant_id', tenantId).eq('livemode', livemode).maybeSingle()
  if (error) throw new BillingError('failed', `profile read: ${error.message}`)
  return (data as ProfileRow | null) ?? null
}

const STRIPE_LOCALES = new Set(['en', 'it', 'de'])

function customerFields(p: ProfileRow, locale: string | null) {
  return {
    email: p.billing_email ?? undefined,
    name: p.legal_name ?? undefined,
    address: {
      line1: p.address_line1 ?? undefined,
      line2: p.address_line2 ?? undefined,
      postal_code: p.postal_code ?? undefined,
      city: p.city ?? undefined,
      state: p.region ?? undefined,
      country: p.country ?? undefined,
    },
    ...(locale && STRIPE_LOCALES.has(locale) ? { preferred_locales: [locale] } : {}),
  }
}

// ── Customer ────────────────────────────────────────────────────────────────
/**
 * The client's Stripe customer under this issuer and mode: reused when stored,
 * else created from the billing profile. Name, email and address are pushed on
 * every call (Abluo is the source of truth); a business VAT id is added as an
 * eu_vat tax id when Stripe does not hold it yet.
 */
export async function ensureCustomer(tenantId: string, issuer: Issuer, locale: string | null = null): Promise<string> {
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const profile = await readProfile(tenantId, livemode)
  if (!profile) throw new BillingError('profileIncomplete')
  const db = createAdminClient()

  const { data: existing, error } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .eq('issuer_id', issuer.id)
    .eq('livemode', livemode)
    .maybeSingle()
  if (error) throw new BillingError('failed', `customer read: ${error.message}`)

  const business = profile.customer_type === 'business' && profile.vat_id
  const metadata: Record<string, string> = { abluo_tenant_id: tenantId, abluo_issuer: issuer.key }
  const contact = profile.contact_name?.trim()
  if (contact) metadata.abluo_contact_name = contact

  if (existing?.stripe_customer_id) {
    const id = existing.stripe_customer_id as string
    // Stripe merges metadata: an empty value removes a contact person that was taken off.
    await stripe.customers.update(id, { ...customerFields(profile, locale), metadata: contact ? metadata : { ...metadata, abluo_contact_name: '' } })
    if (business) {
      const ids = await stripe.customers.listTaxIds(id, { limit: 100 })
      const held = ids.data.some((t) => t.type === 'eu_vat' && t.value.replace(/\s/g, '').toUpperCase() === profile.vat_id)
      if (!held) await stripe.customers.createTaxId(id, { type: 'eu_vat', value: profile.vat_id! }, { idempotencyKey: `taxid:${id}:${profile.vat_id}` })
    }
    return id
  }

  const customer = await stripe.customers.create(
    {
      ...customerFields(profile, locale),
      metadata,
      ...(business ? { tax_id_data: [{ type: 'eu_vat', value: profile.vat_id! }] } : {}),
    },
    { idempotencyKey: `customer:${tenantId}:${issuer.id}:${livemode ? 'live' : 'test'}` },
  )
  const { error: insertError } = await db
    .from('billing_customers')
    .insert({ tenant_id: tenantId, issuer_id: issuer.id, livemode, stripe_customer_id: customer.id })
  if (insertError) {
    // A concurrent call may have stored the same (idempotent) customer first.
    const { data: again } = await db
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('tenant_id', tenantId)
      .eq('issuer_id', issuer.id)
      .eq('livemode', livemode)
      .maybeSingle()
    if (again?.stripe_customer_id !== customer.id) throw new BillingError('failed', `customer store: ${insertError.message}`)
  }
  return customer.id
}

const VAT_STATES = new Set(['pending', 'verified', 'unverified', 'unavailable'])
const normVat = (v: string) => v.replace(/[\s.-]/g, '').toUpperCase()

/**
 * Make sure Stripe holds the client's VAT id (creating the customer if needed)
 * and copy Stripe's current VIES result to the billing profile. The
 * `customer.tax_id.updated` webhook keeps it current afterwards. Writes only
 * while the profile still holds that exact number. Returns the stored state.
 */
export async function refreshVatVerification(tenantId: string, issuer: Issuer, locale: string | null = null): Promise<ProfileRow['vat_verification'] | null> {
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const profile = await readProfile(tenantId, livemode)
  if (!profile || profile.customer_type !== 'business' || !profile.vat_id) return null
  const customerId = await ensureCustomer(tenantId, issuer, locale)
  const ids = await stripe.customers.listTaxIds(customerId, { limit: 100 })
  const want = normVat(profile.vat_id)
  const taxId = ids.data.find((t) => t.type === 'eu_vat' && normVat(t.value) === want)
  const status = taxId?.verification?.status
  if (!status || !VAT_STATES.has(status) || status === profile.vat_verification) return profile.vat_verification
  const verified = status === 'verified'
  const db = createAdminClient()
  const { error } = await db
    .from('billing_profiles')
    .update({
      vat_verification: status,
      vat_verified_at: verified ? new Date().toISOString() : null,
      vat_verified_name: verified ? taxId?.verification?.verified_name?.slice(0, 300) || null : null,
    })
    .eq('tenant_id', tenantId)
    .eq('livemode', livemode)
    .eq('vat_id', profile.vat_id)
  if (error) throw new BillingError('failed', `vat store: ${error.message}`)
  return status as ProfileRow['vat_verification']
}

// ── Product and price ───────────────────────────────────────────────────────
export function productName(project: Pick<ProjectRow, 'name' | 'custom_domain' | 'slug'>): string {
  return `Abluo — ${project.name?.trim() || project.custom_domain || project.slug}`
}

/**
 * One Product per project (found by `metadata.abluo_project_id`; created with
 * an idempotency key), one Price per terms version (id stored in
 * project_billing). Returns the Price id.
 */
export async function ensureProductAndPrice(project: ProjectRow, agreement: AgreementRow): Promise<string> {
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const mode = livemode ? 'live' : 'test'
  if (agreement.amount_cents == null || !agreement.billing_interval) throw new BillingError('notBilled', 'no price terms')
  const db = createAdminClient()
  const name = productName(project)

  // Product: search by our own metadata; create (idempotently) when missing.
  const found = await stripe.products.search({ query: `metadata['abluo_project_id']:'${project.id}'`, limit: 1 })
  let product = found.data[0]
  if (!product) {
    product = await stripe.products.create(
      { name, metadata: { abluo_project_id: project.id } },
      { idempotencyKey: `product:${project.id}:${mode}` },
    )
  } else if (product.name !== name || !product.active) {
    product = await stripe.products.update(product.id, { name, active: true })
  }

  if (agreement.stripe_price_id) {
    // Reuse only while the stored price still matches the agreed terms.
    const price = await stripe.prices.retrieve(agreement.stripe_price_id)
    const sameProduct = (typeof price.product === 'string' ? price.product : price.product.id) === product.id
    if (
      price.active &&
      sameProduct &&
      price.unit_amount === agreement.amount_cents &&
      price.currency === agreement.currency &&
      price.recurring?.interval === agreement.billing_interval &&
      price.recurring?.interval_count === agreement.interval_count
    ) {
      return price.id
    }
  }

  const price = await stripe.prices.create(
    {
      product: product.id,
      currency: agreement.currency,
      unit_amount: agreement.amount_cents,
      tax_behavior: 'exclusive',
      recurring: { interval: agreement.billing_interval, interval_count: agreement.interval_count },
      metadata: { abluo_project_id: project.id, terms_version: String(agreement.terms_version) },
    },
    { idempotencyKey: `price:${project.id}:${mode}:${agreement.terms_version}` },
  )
  const { error } = await db.from('project_billing').update({ stripe_price_id: price.id }).eq('project_id', project.id).eq('livemode', livemode)
  if (error) throw new BillingError('failed', `price store: ${error.message}`)
  return price.id
}

// ── Checkout ────────────────────────────────────────────────────────────────
export async function loadProject(projectId: string): Promise<ProjectRow> {
  const db = createAdminClient()
  const { data, error } = await db.from('projects').select('id, slug, name, custom_domain, tenant_id').eq('id', projectId).maybeSingle()
  if (error) throw new BillingError('failed', `project read: ${error.message}`)
  if (!data) throw new BillingError('notFound')
  return data as ProjectRow
}

type OpenSessionRow = { stripe_session_id: string; url: string | null; expires_at: string; terms_version: number }

export async function createCheckout(
  projectId: string,
  actorUserId: string | null,
  locale: string,
  baseUrl: string,
  now: Date = new Date(),
): Promise<{ url: string }> {
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const mode = livemode ? 'live' : 'test'
  const db = createAdminClient()
  const project = await loadProject(projectId)

  const { data: agreementData, error: agreementError } = await db
    .from('project_billing')
    .select(AGREEMENT_COLUMNS)
    .eq('project_id', projectId)
    .eq('livemode', livemode)
    .maybeSingle()
  if (agreementError) throw new BillingError('failed', `agreement read: ${agreementError.message}`)
  const agreement = agreementData as AgreementRow | null
  if (!agreement || agreement.arrangement !== 'stripe' || agreement.amount_cents == null || !agreement.billing_interval) throw new BillingError('notBilled')

  let profile = await readProfile(project.tenant_id, livemode)
  let completeness = profileCompleteness(profile)
  if (completeness === 'vatNotVerified') {
    // The VIES check runs in Stripe on the customer's tax id, so the customer
    // must exist first. Push it, copy Stripe's current result, re-check.
    await refreshVatVerification(project.tenant_id, await activeIssuer(), locale)
    profile = await readProfile(project.tenant_id, livemode)
    completeness = profileCompleteness(profile)
    // VIES gave a definite "no": say so (pending / unavailable / none stay vatNotVerified).
    if (completeness === 'vatNotVerified' && profile?.vat_verification === 'unverified') throw new BillingError('vatInvalid')
  }
  if (completeness !== 'ok') throw new BillingError(completeness)

  if (agreement.billing_subscription_id) {
    const { data: sub, error } = await db.from('billing_subscriptions').select('status').eq('id', agreement.billing_subscription_id).maybeSingle()
    if (error) throw new BillingError('failed', `subscription read: ${error.message}`)
    if (sub && !NON_TERMINAL_EXCLUDED.has(sub.status as string)) throw new BillingError('alreadySubscribed')
  }

  const issuer = await activeIssuer()

  // Open session: reuse with ≥ 1 h left (same terms), else expire it.
  const { data: openData, error: openError } = await db
    .from('billing_checkout_sessions')
    .select('stripe_session_id, url, expires_at, terms_version')
    .eq('project_id', projectId)
    .eq('livemode', livemode)
    .eq('status', 'open')
    .maybeSingle()
  if (openError) throw new BillingError('failed', `session read: ${openError.message}`)
  const open = openData as OpenSessionRow | null
  if (open) {
    const left = Date.parse(open.expires_at) - now.getTime()
    if (open.url && left >= CHECKOUT_REUSE_MIN_LEFT_MS && open.terms_version === agreement.terms_version) return { url: open.url }
    try {
      await stripe.checkout.sessions.expire(open.stripe_session_id)
    } catch (e) {
      const live = await stripe.checkout.sessions.retrieve(open.stripe_session_id).catch(() => null)
      if (live?.status === 'complete') throw new BillingError('alreadySubscribed')
      if (live && live.status !== 'expired') throw new BillingError('failed', `expire: ${(e as Error).message}`)
    }
    const { error } = await db
      .from('billing_checkout_sessions')
      .update({ status: 'expired' })
      .eq('stripe_session_id', open.stripe_session_id)
      .eq('status', 'open')
    if (error) throw new BillingError('failed', `session expire store: ${error.message}`)
  }

  const customerId = await ensureCustomer(project.tenant_id, issuer, locale)
  const priceId = await ensureProductAndPrice(project, agreement)

  const { count, error: countError } = await db
    .from('billing_checkout_sessions')
    .select('stripe_session_id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('livemode', livemode)
    .eq('terms_version', agreement.terms_version)
  if (countError) throw new BillingError('failed', `attempt count: ${countError.message}`)
  const attemptNo = (count ?? 0) + 1

  const back = `${baseUrl.replace(/\/$/, '')}/${locale}/${project.slug}/billing`
  const expiresAt = new Date(now.getTime() + CHECKOUT_LIFETIME_MS)
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: project.id,
      metadata: { project_id: project.id },
      subscription_data: { metadata: { project_id: project.id } },
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      automatic_tax: { enabled: BILLING_AUTOMATIC_TAX },
      customer_update: { name: 'never', address: 'never' },
      success_url: `${back}?checkout=success`,
      cancel_url: `${back}?checkout=cancel`,
      integration_identifier: `${CHECKOUT_INTEGRATION_LABEL}-${randomSuffix()}`,
    },
    { idempotencyKey: `checkout:${projectId}:${mode}:${agreement.terms_version}:${attemptNo}` },
  )
  if (!session.url) throw new BillingError('failed', 'session without url')

  const { error: insertError } = await db.from('billing_checkout_sessions').insert({
    stripe_session_id: session.id,
    project_id: projectId,
    livemode,
    terms_version: agreement.terms_version,
    status: 'open',
    url: session.url,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    created_by: actorUserId,
  })
  if (insertError) throw new BillingError('failed', `session store: ${insertError.message}`)
  return { url: session.url }
}

/**
 * After the client's billing details changed: push them to the Stripe customer
 * of the active issuer and mode — only when that customer already exists
 * (nothing is created here; Checkout creates it). Returns whether it pushed.
 */
export async function syncCustomerIfExists(tenantId: string, locale: string | null = null): Promise<boolean> {
  if (!getStripe()) return false
  const livemode = billingLivemode()
  const issuer = await activeIssuer()
  const { data, error } = await createAdminClient()
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .eq('issuer_id', issuer.id)
    .eq('livemode', livemode)
    .maybeSingle()
  if (error) throw new BillingError('failed', `customer read: ${error.message}`)
  if (!data?.stripe_customer_id) return false
  await ensureCustomer(tenantId, issuer, locale)
  return true
}

// ── Invoices ────────────────────────────────────────────────────────────────
export type InvoiceStatus = 'paid' | 'open' | 'void' | 'uncollectible'
export type InvoiceSummary = {
  id: string
  number: string | null
  /** ISO: when it was paid, else when it was created. */
  date: string
  amountCents: number
  currency: string
  status: InvoiceStatus
  hostedUrl: string | null
  pdfUrl: string | null
}

const INVOICE_STATUSES = new Set<InvoiceStatus>(['paid', 'open', 'void', 'uncollectible'])

/** Pure: Stripe invoice → the summary the client Billing page lists; null for drafts / unknown states. */
export function invoiceSummary(inv: Pick<Stripe.Invoice, 'id' | 'number' | 'created' | 'total' | 'currency' | 'status' | 'hosted_invoice_url' | 'invoice_pdf'> & {
  status_transitions?: { paid_at?: number | null } | null
}): InvoiceSummary | null {
  const status = inv.status as InvoiceStatus | null
  if (!inv.id || !status || !INVOICE_STATUSES.has(status)) return null
  const at = inv.status_transitions?.paid_at || inv.created
  return {
    id: inv.id,
    number: inv.number ?? null,
    date: new Date(at * 1000).toISOString(),
    amountCents: inv.total,
    currency: inv.currency,
    status,
    hostedUrl: inv.hosted_invoice_url ?? null,
    pdfUrl: inv.invoice_pdf ?? null,
  }
}

/**
 * The invoices of the project's linked subscription (newest first, at most 24,
 * drafts left out). [] when the project has no linked subscription. Throws
 * (BillingError) when Stripe or the database cannot answer — callers fail soft.
 */
export async function listInvoices(projectId: string): Promise<InvoiceSummary[]> {
  const livemode = billingLivemode()
  const db = createAdminClient()
  const { data: pb, error } = await db
    .from('project_billing')
    .select('billing_subscription_id')
    .eq('project_id', projectId)
    .eq('livemode', livemode)
    .maybeSingle()
  if (error) throw new BillingError('failed', `agreement read: ${error.message}`)
  if (!pb?.billing_subscription_id) return []
  const { data: row, error: subError } = await db
    .from('billing_subscriptions')
    .select('stripe_subscription_id')
    .eq('id', pb.billing_subscription_id)
    .maybeSingle()
  if (subError) throw new BillingError('failed', `subscription read: ${subError.message}`)
  if (!row?.stripe_subscription_id) return []
  const stripe = stripeOrThrow()
  const list = await stripe.invoices.list({ subscription: row.stripe_subscription_id as string, limit: 24 })
  return list.data.map((inv) => invoiceSummary(inv)).filter((i): i is InvoiceSummary => i !== null)
}

// ── Customer Portal ─────────────────────────────────────────────────────────
export async function createPortalSession(tenantId: string, returnUrl: string, locale: string | null = null): Promise<{ url: string }> {
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID
  if (!configuration) throw new BillingError('unavailable', 'no portal configuration')
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const issuer = await activeIssuer()
  const db = createAdminClient()
  const { data, error } = await db
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .eq('issuer_id', issuer.id)
    .eq('livemode', livemode)
    .maybeSingle()
  if (error) throw new BillingError('failed', `customer read: ${error.message}`)
  if (!data?.stripe_customer_id) throw new BillingError('noCustomer')
  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id as string,
    configuration,
    return_url: returnUrl,
    ...(locale && STRIPE_LOCALES.has(locale) ? { locale: locale as 'en' | 'it' | 'de' } : {}),
  })
  return { url: session.url }
}

// ── Subscription snapshot / admin cancel ────────────────────────────────────
const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null)

/** Pure: Stripe subscription → the jsonb `billing_sync_subscription` takes. Period dates come from the ITEM (API 2026-10-28). */
export function subscriptionSnapshot(
  sub: Stripe.Subscription,
  ctx: { tenantId: string; issuerId: string; livemode: boolean; projectId?: string | null },
) {
  const item = sub.items.data[0]
  const latest = sub.latest_invoice
  return {
    stripe_subscription_id: sub.id,
    livemode: ctx.livemode,
    tenant_id: ctx.tenantId,
    issuer_id: ctx.issuerId,
    project_id: ctx.projectId ?? null,
    status: sub.status,
    current_period_start: iso(item?.current_period_start),
    current_period_end: iso(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: iso(sub.canceled_at),
    ended_at: iso(sub.ended_at),
    latest_invoice_id: typeof latest === 'string' ? latest : (latest?.id ?? null),
  }
}

export async function setCancelAtPeriodEnd(projectId: string, cancel: boolean): Promise<void> {
  const stripe = stripeOrThrow()
  const livemode = billingLivemode()
  const db = createAdminClient()
  const project = await loadProject(projectId)
  const { data: pb, error } = await db
    .from('project_billing')
    .select('billing_subscription_id')
    .eq('project_id', projectId)
    .eq('livemode', livemode)
    .maybeSingle()
  if (error) throw new BillingError('failed', `agreement read: ${error.message}`)
  if (!pb?.billing_subscription_id) throw new BillingError('notBilled', 'no linked subscription')
  const { data: row, error: subError } = await db
    .from('billing_subscriptions')
    .select('stripe_subscription_id, tenant_id, issuer_id, status')
    .eq('id', pb.billing_subscription_id)
    .maybeSingle()
  if (subError) throw new BillingError('failed', `subscription read: ${subError.message}`)
  if (!row) throw new BillingError('notBilled', 'subscription missing')
  if (NON_TERMINAL_EXCLUDED.has(row.status as string)) throw new BillingError('failed', 'subscription is terminal')

  await stripe.subscriptions.update(row.stripe_subscription_id as string, { cancel_at_period_end: cancel })
  // Re-fetch (never apply the update response blindly) and re-sync through the DB function.
  const fresh = await stripe.subscriptions.retrieve(row.stripe_subscription_id as string)
  const { error: rpcError } = await db.rpc('billing_sync_subscription', {
    p: subscriptionSnapshot(fresh, { tenantId: row.tenant_id as string, issuerId: row.issuer_id as string, livemode, projectId: project.id }),
  })
  if (rpcError) throw new BillingError('failed', `sync: ${rpcError.message}`)
}

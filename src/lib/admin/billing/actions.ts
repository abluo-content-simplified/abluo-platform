'use server'
// Every action starts with requireBillingAdmin() (ADR-041 D9) — before any I/O — and writes admin_audit_log.
import { revalidatePath } from 'next/cache'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/provisioning/model'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProjectBilling } from '@/lib/billing/lifecycle'
import { requireBillingAdmin } from './access'
import { BILLING_SUBSCRIPTION_COLUMNS, PROJECT_BILLING_COLUMNS, toFacts, type BillingSubscriptionRow, type ProjectBillingRow } from './mapping'
import { billingLivemode } from './queries'
import { BILLING_CURRENCY, parseEuroToCents, romeDayEnd, romeDayStart, validateBillingProfile, validateBillingTerms, validateOverride } from './model'
import type {
  AcknowledgeBillingReviewInput,
  BillingActionResult,
  SaveBillingProfileInput,
  SaveBillingTermsInput,
  SetBillingOverrideInput,
} from './types'

const forbidden: BillingActionResult = { ok: false, error: 'forbidden' }
const failed: BillingActionResult = { ok: false, error: 'failed' }
const notFound: BillingActionResult = { ok: false, error: 'notFound' }
const invalid = (...fields: string[]): BillingActionResult => ({ ok: false, error: 'invalid', fields })

const refresh = () => revalidatePath('/[locale]/projects/[slug]', 'page')
/** Optional text: null when blank/absent, undefined when not text or too long (= invalid). */
const text = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t === '' ? null : t.length <= max ? t : undefined
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

type ExistingTerms = {
  arrangement: string
  amount_cents: number | null
  billing_interval: string | null
  terms_version: number
  billing_subscription_id: string | null
}

export async function saveBillingTermsAction(input: SaveBillingTermsInput): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input)) return invalid()
  if (!isUuid(input.projectId)) return notFound

  const now = new Date()
  const paid = input.arrangement !== 'complimentary'
  const typeErrors: string[] = []
  const amountText = text(input.amount, 40)
  const dueText = text(input.activationDueOn, 10)
  const startsOn = text(input.startsOn, 10)
  const paidThrough = text(input.manualPaidThrough, 10)
  if (amountText === undefined) typeErrors.push('amount')
  if (dueText === undefined) typeErrors.push('activationDueOn')
  if (startsOn === undefined) typeErrors.push('startsOn')
  if (paidThrough === undefined) typeErrors.push('manualPaidThrough')
  if (input.interval !== null && input.interval !== 'month' && input.interval !== 'year') typeErrors.push('interval')
  if (typeErrors.length || amountText === undefined || dueText === undefined || startsOn === undefined || paidThrough === undefined) return invalid(...typeErrors)
  const amountCents = paid && amountText ? parseEuroToCents(amountText) : null
  const interval = paid ? input.interval : null
  const dueAt = dueText ? romeDayStart(dueText) : null
  const reason = text(input.activationExtensionReason, 1000)
  const errors: string[] = validateBillingTerms(
    {
      arrangement: input.arrangement,
      amountCents,
      interval,
      startsOn,
      activationDueAt: paid ? dueAt : null,
      activationExtensionReason: reason ?? null,
      manualPaidThrough: paidThrough,
    },
    now,
  )
  if (dueText && !dueAt) errors.push('activationDueOn')
  if (reason === undefined) errors.push('activationExtensionReason')
  if (errors.length) return invalid(...errors)

  const stripe = input.arrangement === 'stripe'
  const values = {
    arrangement: input.arrangement,
    amount_cents: paid ? amountCents : null,
    currency: BILLING_CURRENCY,
    billing_interval: interval,
    starts_on: startsOn,
    // Stripe and manual agreements both have a payment due date that starts their clock.
    activation_due_at: paid && dueAt ? dueAt.toISOString() : null,
    activation_extension_reason: paid ? reason : null,
    manual_paid_through: input.arrangement === 'manual' ? paidThrough : null,
  }

  try {
    const db = createAdminClient()
    const livemode = billingLivemode()
    const { data: project, error: projectError } = await db.from('projects').select('id').eq('id', input.projectId).maybeSingle()
    if (projectError) return failed
    if (!project) return notFound

    const { data: existing, error: readError } = await db
      .from('project_billing')
      .select('arrangement, amount_cents, billing_interval, terms_version, billing_subscription_id')
      .eq('project_id', input.projectId)
      .eq('livemode', livemode)
      .maybeSingle()
    if (readError) return failed
    const prev = (existing as ExistingTerms | null) ?? null
    // A Stripe-linked agreement cannot silently become another arrangement (DB check); cancel the subscription first (Phase 3).
    if (prev?.billing_subscription_id && !stripe) return invalid('arrangement')

    const termsChanged = !prev || prev.arrangement !== values.arrangement || prev.amount_cents !== values.amount_cents || prev.billing_interval !== values.billing_interval
    const termsVersion = prev ? prev.terms_version + (termsChanged ? 1 : 0) : 1

    const { error } = prev
      ? await db.from('project_billing').update({ ...values, terms_version: termsVersion, ...(termsChanged || !stripe ? { stripe_price_id: null } : {}) }).eq('project_id', input.projectId).eq('livemode', livemode)
      : await db.from('project_billing').insert({ ...values, project_id: input.projectId, livemode, terms_version: termsVersion, created_by: actor.userId })
    if (error) {
      if (error.message?.includes('billing:activation_window')) return invalid('activationReasonRequired')
      return failed
    }

    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.terms.set',
      projectId: input.projectId,
      detail: { livemode, created: !prev, termsVersion, ...values },
    })
    refresh()
    return { ok: true }
  } catch {
    return failed
  }
}

export async function setBillingOverrideAction(input: SetBillingOverrideInput): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input)) return invalid()
  if (!isUuid(input.projectId)) return notFound

  const now = new Date()
  const untilText = text(input.untilOn, 10)
  if (untilText === undefined) return invalid('untilOn')
  const until = untilText ? romeDayEnd(untilText) : null
  const reason = text(input.reason, 1000)
  const errors: string[] = validateOverride({ override: input.override, until, reason: reason ?? null }, now)
  if (untilText && !until) errors.push('untilOn')
  if (reason === undefined) errors.push('reason')
  if (errors.length) return invalid(...errors)

  const clear = input.override === 'none'
  const values = clear
    ? { override: 'none', override_until: null, override_reason: null, override_by: null, override_set_at: null }
    : { override: input.override, override_until: until ? until.toISOString() : null, override_reason: reason, override_by: actor.userId, override_set_at: now.toISOString() }

  try {
    const db = createAdminClient()
    const livemode = billingLivemode()
    const { data: existing, error: readError } = await db.from('project_billing').select('project_id').eq('project_id', input.projectId).eq('livemode', livemode).maybeSingle()
    if (readError) return failed
    if (!existing) return notFound
    const { error } = await db.from('project_billing').update(values).eq('project_id', input.projectId).eq('livemode', livemode)
    if (error) return failed
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.override.set',
      projectId: input.projectId,
      detail: { livemode, override: values.override, until: values.override_until, reason: values.override_reason },
    })
    refresh()
    return { ok: true }
  } catch {
    return failed
  }
}

export async function acknowledgeBillingReviewAction(input: AcknowledgeBillingReviewInput): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input)) return invalid()
  if (!isUuid(input.projectId)) return notFound
  const note = text(input.note, 2000)
  if (note === undefined) return invalid('note')

  try {
    const db = createAdminClient()
    const livemode = billingLivemode()
    const { data: existing, error: readError } = await db
      .from('project_billing')
      .select(PROJECT_BILLING_COLUMNS)
      .eq('project_id', input.projectId)
      .eq('livemode', livemode)
      .maybeSingle()
    if (readError) return failed
    if (!existing) return notFound
    const row = existing as unknown as ProjectBillingRow
    let sub: BillingSubscriptionRow | null = null
    if (row.billing_subscription_id) {
      const { data, error } = await db.from('billing_subscriptions').select(BILLING_SUBSCRIPTION_COLUMNS).eq('id', row.billing_subscription_id).maybeSingle()
      if (error) return failed
      sub = (data as BillingSubscriptionRow | null) ?? null
    }
    // Only a project that is actually in review can be acknowledged — decided here, from the facts.
    if (resolveProjectBilling(toFacts(row, sub), new Date()).state !== 'review') return invalid('state')
    const { error } = await db
      .from('project_billing')
      .update({ review_acknowledged_at: new Date().toISOString(), review_note: note })
      .eq('project_id', input.projectId)
      .eq('livemode', livemode)
    if (error) return failed
    await recordAdminAudit({ actorId: actor.userId, action: 'billing.review.ack', projectId: input.projectId, detail: { livemode, note } })
    refresh()
    return { ok: true }
  } catch {
    return failed
  }
}

export async function saveBillingProfileAction(input: SaveBillingProfileInput): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input)) return invalid()
  if (!isUuid(input.tenantId)) return notFound

  const checked = validateBillingProfile(input)
  if (!checked.ok) return invalid(...checked.fields)
  const v = checked.value

  try {
    const db = createAdminClient()
    const livemode = billingLivemode()
    const { data: tenant, error: tenantError } = await db.from('tenants').select('id').eq('id', input.tenantId).maybeSingle()
    if (tenantError) return failed
    if (!tenant) return notFound

    const { data: existing, error: readError } = await db
      .from('billing_profiles')
      .select('vat_id')
      .eq('tenant_id', input.tenantId)
      .eq('livemode', livemode)
      .maybeSingle()
    if (readError) return failed
    const prev = (existing as { vat_id: string | null } | null) ?? null

    const values = {
      billing_email: v.billingEmail,
      customer_type: v.customerType,
      legal_name: v.legalName,
      address_line1: v.addressLine1,
      address_line2: v.addressLine2,
      postal_code: v.postalCode,
      city: v.city,
      region: v.region,
      country: v.country,
      vat_id: v.vatId,
    }
    // A new or changed VAT id is unverified until Stripe checks it (Phase 3).
    const vatChanged = !prev || prev.vat_id !== v.vatId
    const verification = vatChanged ? { vat_verification: 'none', vat_verified_at: null, vat_verified_name: null } : {}

    const { error } = prev
      ? await db.from('billing_profiles').update({ ...values, ...verification }).eq('tenant_id', input.tenantId).eq('livemode', livemode)
      : await db.from('billing_profiles').insert({ ...values, ...verification, tenant_id: input.tenantId, livemode })
    if (error) return failed

    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.profile.set',
      projectId: null,
      detail: { tenantId: input.tenantId, livemode, created: !prev, vatChanged, fields: Object.keys(values).filter((k) => values[k as keyof typeof values] !== null) },
    })
    refresh()
    return { ok: true }
  } catch {
    return failed
  }
}

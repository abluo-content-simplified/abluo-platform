// Server-only: service-role writes. Never import from a client component.
// NOT a 'use server' module: these helpers must never be callable from the browser.
// Callers authorize FIRST (admin: requireBillingAdmin; client: authorizeBillingManager).
import { recordAdminAudit, type AdminAuditAction } from '@/lib/admin/audit'
import { billingLivemode } from '@/lib/admin/billing/queries'
import { validateBillingProfile } from '@/lib/admin/billing/model'
import type { BillingActionResult, SaveBillingProfileInput } from '@/lib/admin/billing/types'
import { createAdminClient } from '@/lib/supabase/admin'

/** The profile fields a form sends (everything but the client id, which the server decides). */
export type BillingProfileFields = Omit<SaveBillingProfileInput, 'tenantId'>

/**
 * Validate, normalise and store one client's billing details (ADR-041 D9, D14),
 * shared by the admin Billing card and the client's own Billing page. The same
 * rules either way: fields that do not belong to the customer type are cleared,
 * and a new or changed VAT id is unverified until Stripe checks it again.
 * Writes one audit row (`detail.by` says who). Invalid input never reaches the database.
 */
export async function writeBillingProfile({
  tenantId,
  input,
  actorId,
  action,
  projectId = null,
  by,
}: {
  tenantId: string
  input: BillingProfileFields
  actorId: string
  action: Extract<AdminAuditAction, 'billing.profile.set' | 'billing.profile.update_by_client'>
  projectId?: string | null
  by: 'admin' | 'client'
}): Promise<BillingActionResult & { vatChanged?: boolean }> {
  const checked = validateBillingProfile(input)
  if (!checked.ok) return { ok: false, error: 'invalid', fields: checked.fields }
  const v = checked.value

  try {
    const db = createAdminClient()
    const livemode = billingLivemode()
    const { data: tenant, error: tenantError } = await db.from('tenants').select('id').eq('id', tenantId).maybeSingle()
    if (tenantError) return { ok: false, error: 'failed' }
    if (!tenant) return { ok: false, error: 'notFound' }

    const { data: existing, error: readError } = await db
      .from('billing_profiles')
      .select('vat_id')
      .eq('tenant_id', tenantId)
      .eq('livemode', livemode)
      .maybeSingle()
    if (readError) return { ok: false, error: 'failed' }
    const prev = (existing as { vat_id: string | null } | null) ?? null

    const values = {
      billing_email: v.billingEmail,
      customer_type: v.customerType,
      legal_name: v.legalName,
      contact_name: v.contactName,
      address_line1: v.addressLine1,
      address_line2: v.addressLine2,
      postal_code: v.postalCode,
      city: v.city,
      region: v.region,
      country: v.country,
      vat_id: v.vatId,
      tax_code: v.taxCode,
    }
    // A new or changed VAT id is unverified until Stripe checks it (Phase 3).
    const vatChanged = !prev || prev.vat_id !== v.vatId
    const verification = vatChanged ? { vat_verification: 'none', vat_verified_at: null, vat_verified_name: null } : {}

    const { error } = prev
      ? await db.from('billing_profiles').update({ ...values, ...verification }).eq('tenant_id', tenantId).eq('livemode', livemode)
      : await db.from('billing_profiles').insert({ ...values, ...verification, tenant_id: tenantId, livemode })
    if (error) return { ok: false, error: 'failed' }

    await recordAdminAudit({
      actorId,
      action,
      projectId,
      detail: { tenantId, livemode, by, created: !prev, vatChanged, fields: Object.keys(values).filter((k) => values[k as keyof typeof values] !== null) },
    })
    return { ok: true, vatChanged }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

'use server'
// Called from the CLIENT dashboard by a tenant user holding `billing.manage` on the project's tenant (ADR-041 D7, D12).
// Authorization first (before any Stripe or write I/O); Stripe work lives in ./stripe/service.ts.
import { headers } from 'next/headers'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { can } from '@/lib/authz/check'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import type { BillingActionResult } from '@/lib/admin/billing/types'
import { BillingError, createCheckout, createPortalSession, syncCustomerIfExists } from './stripe/service'
import { writeBillingProfile, type BillingProfileFields } from './profile-save'
import { trustedReturnOrigin } from './return-origin'

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: 'forbidden' | 'unavailable' | 'notBilled' | 'profileIncomplete' | 'vatNotVerified' | 'vatInvalid' | 'alreadySubscribed' | 'noIssuer' | 'failed' }
export type OpenPortalResult = { ok: true; url: string } | { ok: false; error: 'forbidden' | 'unavailable' | 'noCustomer' | 'failed' }

type Caller = { userId: string; projectId: string; projectSlug: string; tenantId: string }

/** Who is calling, and may they manage billing for this project's client? Null = refuse. Never in support mode. */
async function authorizeBillingManager(projectSlug: unknown): Promise<Caller | null> {
  if (typeof projectSlug !== 'string' || !projectSlug) return null
  const ctx = await getTenantAuthorizationContext({ purpose: 'mutation', project: projectSlug })
  if (!ctx || ctx.support) return null
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) return null
  // Cheap refusal before touching the database: the caller must hold billing.manage on SOME client.
  const candidates = (ctx.tenants ?? []).filter((t) => can(ctx, 'billing.manage', { kind: 'tenant', tenantId: t.tenantId }))
  if (candidates.length === 0) return null
  // The project's own client decides (grants carry no tenant id): server-side lookup by the resolved project id.
  const { data, error } = await createAdminClient().from('projects').select('tenant_id').eq('id', grant.projectId).maybeSingle()
  const tenantId = (data?.tenant_id as string | undefined) ?? null
  if (error || !tenantId) return null
  if (!can(ctx, 'billing.manage', { kind: 'tenant', tenantId })) return null
  return { userId: ctx.userId, projectId: grant.projectId, projectSlug: grant.projectSlug, tenantId }
}

/** `https://host` of this request (the client billing page the visitor came from). */
async function requestBaseUrl(): Promise<string | null> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)
  return trustedReturnOrigin(`${local ? 'http' : 'https'}://${host}`)
}

const knownLocale = (l: unknown): l is string => typeof l === 'string' && (LOCALE_CODES as readonly string[]).includes(l)

/** Stripe Checkout for this project's agreement (reuses an open session ≥ 1 h left). */
export async function startCheckoutAction(input: { projectSlug: string; locale: string }): Promise<StartCheckoutResult> {
  const caller = await authorizeBillingManager(input?.projectSlug)
  if (!caller) return { ok: false, error: 'forbidden' }
  if (!knownLocale(input.locale)) return { ok: false, error: 'failed' }
  try {
    const base = await requestBaseUrl()
    if (!base) return { ok: false, error: 'failed' }
    const { url } = await createCheckout(caller.projectId, caller.userId, input.locale, base)
    return { ok: true, url }
  } catch (e) {
    if (e instanceof BillingError) {
      switch (e.code) {
        case 'unavailable':
        case 'notBilled':
        case 'profileIncomplete':
        case 'vatNotVerified':
        case 'vatInvalid':
        case 'alreadySubscribed':
        case 'noIssuer':
          return { ok: false, error: e.code }
        default:
          break
      }
    }
    console.error('[billing] startCheckout failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'failed' }
  }
}

/** Stripe Customer Portal for the project's client (payment methods + invoices only). */
export async function openBillingPortalAction(input: { projectSlug: string; locale: string }): Promise<OpenPortalResult> {
  const caller = await authorizeBillingManager(input?.projectSlug)
  if (!caller) return { ok: false, error: 'forbidden' }
  if (!knownLocale(input.locale)) return { ok: false, error: 'failed' }
  try {
    const base = await requestBaseUrl()
    if (!base) return { ok: false, error: 'failed' }
    const { url } = await createPortalSession(caller.tenantId, `${base}/${input.locale}/${caller.projectSlug}/billing`, input.locale)
    return { ok: true, url }
  } catch (e) {
    if (e instanceof BillingError && (e.code === 'unavailable' || e.code === 'noCustomer')) return { ok: false, error: e.code }
    console.error('[billing] openPortal failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'failed' }
  }
}

/**
 * The Owner edits the client's own billing details (Tom, 2026-11-02). The client
 * is resolved server-side from the project (never from the browser); the same
 * validation, normalisation and VAT rule as the admin card (`writeBillingProfile`).
 * When a Stripe customer already exists, the new details are pushed to it — a
 * Stripe failure is logged and never fails the save (Abluo is the source of truth).
 */
export async function saveOwnBillingProfileAction(input: { projectSlug: string; locale?: string; profile: BillingProfileFields }): Promise<BillingActionResult> {
  const caller = await authorizeBillingManager(input?.projectSlug)
  if (!caller) return { ok: false, error: 'forbidden' }
  if (typeof input.profile !== 'object' || input.profile === null) return { ok: false, error: 'invalid', fields: [] }
  const r = await writeBillingProfile({
    tenantId: caller.tenantId,
    input: input.profile,
    actorId: caller.userId,
    action: 'billing.profile.update_by_client',
    projectId: caller.projectId,
    by: 'client',
  })
  if (!r.ok) return r
  try {
    await syncCustomerIfExists(caller.tenantId, knownLocale(input.locale) ? input.locale : null)
  } catch (e) {
    console.error('[billing] own profile saved; Stripe customer update failed', e instanceof Error ? e.message : e)
  }
  return { ok: true }
}

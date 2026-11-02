'use server'
// Billing admin only (ADR-041 D9, D12): requireBillingAdmin() first, before any I/O.
import { revalidatePath } from 'next/cache'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/provisioning/model'
import { BillingError, setCancelAtPeriodEnd } from '@/lib/billing/stripe/service'
import { requireBillingAdmin } from './access'
import { billingLivemode } from './queries'
import type { BillingActionResult } from './types'

/** Billing admin only: set or clear cancel-at-period-end on the project's Stripe subscription (ADR-041 D12). */
export async function setCancelAtPeriodEndAction(input: { projectId: string; cancel: boolean }): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return { ok: false, error: 'forbidden' }
  if (typeof input !== 'object' || input === null || typeof input.cancel !== 'boolean') return { ok: false, error: 'invalid', fields: ['cancel'] }
  if (!isUuid(input.projectId)) return { ok: false, error: 'notFound' }
  try {
    await setCancelAtPeriodEnd(input.projectId, input.cancel)
  } catch (e) {
    if (e instanceof BillingError && e.code === 'notFound') return { ok: false, error: 'notFound' }
    if (e instanceof BillingError && e.code === 'notBilled') return { ok: false, error: 'invalid', fields: ['subscription'] }
    const message = e instanceof Error ? e.message : String(e)
    console.error('[billing] setCancelAtPeriodEnd failed', message)
    // The Stripe change may already have happened (a later re-fetch or sync failed): keep a trace.
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.subscription.cancel_at_period_end',
      projectId: input.projectId,
      detail: { livemode: billingLivemode(), cancel: input.cancel, outcome: 'failed', error: message.slice(0, 300) },
    }).catch(() => {})
    return { ok: false, error: 'failed' }
  }
  await recordAdminAudit({
    actorId: actor.userId,
    action: 'billing.subscription.cancel_at_period_end',
    projectId: input.projectId,
    detail: { livemode: billingLivemode(), cancel: input.cancel },
  })
  revalidatePath('/[locale]/projects/[slug]', 'page')
  return { ok: true }
}

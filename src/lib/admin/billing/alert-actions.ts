'use server'
// Every action starts with requireBillingAdmin() (ADR-041 D9) — before any I/O — and writes admin_audit_log.
// Alerts never change access (D15): these actions only move the alert along.
import { revalidatePath } from 'next/cache'
import { recordAdminAudit } from '@/lib/admin/audit'
import { isUuid } from '@/lib/admin/provisioning/model'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBillingAdmin } from './access'
import { billingLivemode } from './queries'
import type { BillingActionResult } from './types'

const forbidden: BillingActionResult = { ok: false, error: 'forbidden' }
const failed: BillingActionResult = { ok: false, error: 'failed' }
const notFound: BillingActionResult = { ok: false, error: 'notFound' }
const NOTE_MAX = 2000

const refresh = () => revalidatePath('/[locale]/projects/[slug]', 'page')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

type AlertRow = { id: string; status: string; kind: string; project_id: string | null; tenant_id: string; acknowledged_at: string | null }

async function readAlert(alertId: string): Promise<AlertRow | null> {
  const { data, error } = await createAdminClient()
    .from('billing_alerts')
    .select('id, status, kind, project_id, tenant_id, acknowledged_at')
    .eq('id', alertId)
    .eq('livemode', billingLivemode())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? (data as AlertRow) : null
}

/** open → acknowledged. Acknowledging an alert that already moved on is a no-op success. */
export async function acknowledgeBillingAlertAction(input: { alertId: string }): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input) || !isUuid(input.alertId)) return notFound
  try {
    const alert = await readAlert(input.alertId)
    if (!alert) return notFound
    if (alert.status !== 'open') return { ok: true }
    const { error } = await createAdminClient()
      .from('billing_alerts')
      .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: actor.userId })
      .eq('id', alert.id)
      .eq('status', 'open')
    if (error) throw new Error(error.message)
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.alert.ack',
      projectId: alert.project_id,
      detail: { alertId: alert.id, kind: alert.kind, tenantId: alert.tenant_id },
    })
    refresh()
    return { ok: true }
  } catch (e) {
    console.error(`[billing] alert acknowledge failed: ${e instanceof Error ? e.message : 'error'}`)
    return failed
  }
}

/** open | acknowledged → resolved, with a required note. Resolving directly also records the acknowledgement. */
export async function resolveBillingAlertAction(input: { alertId: string; note: string }): Promise<BillingActionResult> {
  const actor = await requireBillingAdmin()
  if (!actor) return forbidden
  if (!isObject(input) || !isUuid(input.alertId)) return notFound
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note === '' || note.length > NOTE_MAX) return { ok: false, error: 'invalid', fields: ['note'] }
  try {
    const alert = await readAlert(input.alertId)
    if (!alert) return notFound
    if (alert.status === 'resolved') return { ok: true }
    const now = new Date().toISOString()
    const { error } = await createAdminClient()
      .from('billing_alerts')
      .update({
        status: 'resolved',
        resolved_at: now,
        resolved_by: actor.userId,
        resolution_note: note,
        ...(alert.acknowledged_at ? {} : { acknowledged_at: now, acknowledged_by: actor.userId }),
      })
      .eq('id', alert.id)
      .neq('status', 'resolved')
    if (error) throw new Error(error.message)
    await recordAdminAudit({
      actorId: actor.userId,
      action: 'billing.alert.resolve',
      projectId: alert.project_id,
      detail: { alertId: alert.id, kind: alert.kind, tenantId: alert.tenant_id, noteLength: note.length },
    })
    refresh()
    return { ok: true }
  } catch (e) {
    console.error(`[billing] alert resolve failed: ${e instanceof Error ? e.message : 'error'}`)
    return failed
  }
}

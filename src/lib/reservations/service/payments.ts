// ── Reservations — record a payment (ADR-044 D5, D6, D16.18) ──────────────────
import { assertCents } from '../money'
import type { PaymentStatus } from '../types'
import type { PaymentMethodInput } from '../server/store'
import type { Actor } from '../server/types'
import { fromStoreError, loadRuleContext, makeIntent, recipientsOf, refuse, succeed, type ServiceDeps, type ServiceResult, type TargetRef } from './types'

export type RecordPaymentInput = {
  projectId: string
  bookingId: string
  target: TargetRef
  method: PaymentMethodInput
  amountCents: number
  /** 'YYYY-MM-DD' */
  paidOn: string
  /** The bank's own reference. */
  reference?: string | null
  note?: string | null
  actor?: Actor
}

export type RecordPaymentOutcome = {
  paymentId: string
  paymentStatus: PaymentStatus
  confirmed: boolean
  /** Lapsed holds could not come back (sessions full): the tenant decides (return / credit). */
  paymentReview: boolean
  fullOccurrenceIds: string[]
}

const METHODS: readonly PaymentMethodInput[] = ['bank_transfer', 'cash', 'other']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function recordPayment(input: RecordPaymentInput, deps: ServiceDeps): Promise<ServiceResult<RecordPaymentOutcome>> {
  try { assertCents(input.amountCents) } catch { return refuse('invalid_amount') }
  if (input.amountCents <= 0) return refuse('invalid_amount')
  if (!METHODS.includes(input.method)) return refuse('invalid_method')
  if (!DATE.test(input.paidOn) || Number.isNaN(Date.parse(input.paidOn))) return refuse('invalid_date')

  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  if (input.method === 'bank_transfer' && !ctx.value.rules.acceptBankTransfer) return refuse('payment_method_not_available')

  const r = await deps.store.recordPayment(input.projectId, input.bookingId, {
    method: input.method, amountCents: input.amountCents, paidOn: input.paidOn,
    reference: input.reference ?? null, note: input.note ?? null, actor: input.actor ?? { kind: 'user' },
  })
  if (!r.ok) return fromStoreError(r.error)
  const c = r.value.confirm
  const confirmed = c?.confirmed === true
  const out: RecordPaymentOutcome = {
    paymentId: r.value.paymentId,
    paymentStatus: r.value.paymentStatus,
    confirmed,
    paymentReview: c !== null && !c.confirmed && c.full.length > 0,
    fullOccurrenceIds: c?.full ?? [],
  }

  // The booking just became confirmed (and not as a replay): tell the participant.
  // The management token is not known here (only its hash is stored), so the
  // mail carries the reference; the dashboard can rotate the link.
  if (confirmed && !c?.replayed) {
    const b = await deps.store.getBookingById(input.projectId, input.bookingId)
    if (b.ok && b.value && b.value.purchaserEmail) {
      await deps.store.enqueueOutbox(input.projectId, [{
        bookingId: b.value.id,
        intent: makeIntent(deps, {
          intent: 'booking.confirmed', dedupeKey: `booking.confirmed:${b.value.id}:payment`,
          recipients: recipientsOf({ email: b.value.purchaserEmail, name: b.value.purchaserName }),
          locale: b.value.locale, payload: { reference: b.value.reference, totalCents: b.value.totalCents, afterPayment: true },
        }),
      }])
    }
  }
  return succeed(out)
}

// ── Reservations — daily hold sweep (ADR-044 D5, D10) ─────────────────────────
// Expiry is logical (availability already ignores lapsed holds); the sweep marks
// bookings `expired` and queues the "your hold lapsed" email.
import { fromStoreError, makeIntent, recipientsOf, succeed, type ServiceDeps, type ServiceResult } from './types'

export type SweepResult = { expired: number; queued: number; failures: number }

export async function runSweep(deps: ServiceDeps): Promise<ServiceResult<SweepResult>> {
  const r = await deps.store.expireHolds(deps.now())
  if (!r.ok) return fromStoreError(r.error)
  let queued = 0
  let failures = 0
  for (const h of r.value) {
    const b = await deps.store.getBookingById(h.projectId, h.bookingId)
    if (!b.ok) { failures++; continue }
    if (!b.value || !b.value.purchaserEmail || b.value.anonymisedAt) continue
    const q = await deps.store.enqueueOutbox(h.projectId, [{
      bookingId: h.bookingId,
      intent: makeIntent(deps, {
        intent: 'booking.expired', dedupeKey: `booking.expired:${h.bookingId}`,
        recipients: recipientsOf({ email: b.value.purchaserEmail, name: b.value.purchaserName }), locale: b.value.locale,
        payload: { reference: b.value.reference },
      }),
    }])
    if (q.ok) queued += q.value.queued
    else failures++
  }
  return succeed({ expired: r.value.length, queued, failures })
}

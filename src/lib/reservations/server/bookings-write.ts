// ── Reservations — dashboard writes that have no 066 function (ADR-044 D5) ────
//
// "Mark eligibility verified": the tenant has looked at the proof (a membership
// card, an ID) for an attendee who got a member price. 066 has no function for
// it, so this is a project-scoped update of the attendees (`pending` → `verified`),
// then the booking's review flag is cleared once none is pending, then one
// activity line. Not one transaction: the steps are idempotent, a repeat is a
// no-op, and a half-done run leaves the booking flagged (the safe side).
// TODO(066 follow-up): a reservations_verify_eligibility() function would make it atomic.
import { fail, ok, parseReservationError, type DbErrorLike, type Result } from './errors'
import type { Actor } from './types'

export type BookingsWriteDb = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VerifyEligibilityResult = { verified: number; reviewCleared: boolean }

export type BookingsWriteStore = {
  verifyEligibility(projectId: string, bookingId: string, actor?: Actor): Promise<Result<VerifyEligibilityResult>>
}

export function createBookingsWriteStore(db: BookingsWriteDb): BookingsWriteStore {
  const err = (e: DbErrorLike) => fail(parseReservationError(e))
  return {
    async verifyEligibility(projectId, bookingId, actor) {
      if (!UUID.test(bookingId)) return fail({ kind: 'not_found', code: 'booking_not_found' })
      try {
        const b = await db.from('bookings').select('id, status').eq('project_id', projectId).eq('id', bookingId).limit(1)
        if (b.error) return err(b.error)
        if (!Array.isArray(b.data) || !b.data[0]) return fail({ kind: 'not_found', code: 'booking_not_found' })

        const upd = await db.from('booking_attendees')
          .update({ eligibility_result: 'verified', updated_at: new Date().toISOString() })
          .eq('project_id', projectId).eq('booking_id', bookingId).eq('eligibility_result', 'pending').select('id')
        if (upd.error) return err(upd.error)
        const verified = Array.isArray(upd.data) ? upd.data.length : 0

        const left = await db.from('booking_attendees').select('id').eq('project_id', projectId).eq('booking_id', bookingId).eq('eligibility_result', 'pending')
        if (left.error) return err(left.error)
        let reviewCleared = false
        if (!Array.isArray(left.data) || left.data.length === 0) {
          const flag = await db.from('bookings')
            .update({ eligibility_review: false, updated_at: new Date().toISOString() })
            .eq('project_id', projectId).eq('id', bookingId).eq('eligibility_review', true).select('id')
          if (flag.error) return err(flag.error)
          reviewCleared = Array.isArray(flag.data) && flag.data.length > 0
        }
        if (verified > 0 || reviewCleared) {
          const log = await db.rpc('reservations_log', {
            p_project_id: projectId, p_booking_id: bookingId, p_pass_id: null,
            p_actor: { kind: actor?.kind ?? 'user', id: actor?.id ?? null }, p_action: 'booking.eligibility_verified', p_detail: { attendees: verified },
          })
          if (log.error) return err(log.error)
        }
        return ok({ verified, reviewCleared })
      } catch {
        return fail({ kind: 'unavailable' })
      }
    },
  }
}

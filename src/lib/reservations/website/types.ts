// ── Reservations website — shared shapes of the two private link pages (ADR-044 D7, D9, D11) ──
//
// Plain JSON only: these cross the server → client boundary (props and server
// action results). They hold NO token, no email, no phone and no other
// person's data — only what the person behind the link may see.
import type { BookingStatus, PaymentStatus } from '../types'
import type { ReservationSiteMessages } from './messages'

export type ErrorKey = keyof ReservationSiteMessages['errors']
export type OutcomeKey = 'none' | 'credit' | 'refund_review'

export type BookingSessionView = {
  id: string
  title: string | null
  place: string | null
  dateLabel: string
  timeLabel: string
  state: 'attending' | 'released' | 'cancelled' | 'past'
  /** The "I can't come" button is offered (rules allow it, the session is ahead, the booking is confirmed). */
  canAbsent: boolean
}

export type BookingView = {
  reference: string
  status: BookingStatus
  paymentStatus: PaymentStatus
  amountLabel: string | null
  /** Set while the booking awaits payment: the date the hold lapses. */
  payByLabel: string | null
  /** Tenant text, shown only while payment is awaited. */
  paymentInstructions: string | null
  bankDetails: string | null
  isPass: boolean
  sessions: BookingSessionView[]
  cancel: { allowed: boolean; untilLabel: string | null }
}

export type PassBlock = 'not_open_yet' | 'closed' | 'full' | 'no_entries'

export type PassSessionView = {
  id: string
  title: string | null
  place: string | null
  dateLabel: string
  timeLabel: string
  cancelled: boolean
  /** `off` = just come along (no buttons); `opt_in` = Coming / Not coming. */
  mode: 'off' | 'opt_in'
  attending: boolean
  canCome: boolean
  canLeave: boolean
  blocked: PassBlock | null
  /** "You can answer from {date}" when the window has not opened. */
  opensLabel: string | null
}

export type PassView = {
  status: 'active' | 'cancelled' | 'expired' | 'not_started'
  validFromLabel: string
  validToLabel: string
  /** null = unlimited. */
  entriesLeft: number | null
  sessions: PassSessionView[]
}

export type ActionResult<V> =
  | { ok: true; view: V; outcome?: OutcomeKey; notice?: 'saved' | 'entryReturned' | 'entryKept' }
  | { ok: false; error: ErrorKey }

// ── Reservations — Bookings detail: pure view helpers (ADR-044 D4, D5) ────────
//
// Which actions the detail offers (and why one is switched off), how the
// allocations and the snapshot's sessions become one list, and the names of the
// sessions that are full. No database, no React, no wording (codes only).
import type { BookingStatus } from './types'
import type { AllocationView, BookingDetail, SnapshotSession } from './server/bookings-read'

export type ActionName = 'recordPayment' | 'confirm' | 'extendHold' | 'cancel' | 'verifyEligibility'
export type WhyNot = 'needWrite' | 'needPay' | 'closed' | 'notConfirmable' | 'notExtendable' | 'noEligibility'
export type ActionState = { enabled: true } | { enabled: false; why: WhyNot }

const CLOSED: readonly BookingStatus[] = ['cancelled', 'expired']
const CONFIRMABLE: readonly BookingStatus[] = ['held', 'awaiting_payment']
const EXTENDABLE: readonly BookingStatus[] = ['held', 'awaiting_payment']

export function actionStates(
  detail: Pick<BookingDetail, 'booking' | 'attendees'>,
  can: { write: boolean; pay: boolean },
): Record<ActionName, ActionState> {
  const status = detail.booking.status
  const closed = CLOSED.includes(status)
  const no = (why: WhyNot): ActionState => ({ enabled: false, why })
  const yes: ActionState = { enabled: true }
  return {
    recordPayment: !can.pay ? no('needPay') : closed ? no('closed') : yes,
    confirm: !can.write ? no('needWrite') : closed ? no('closed') : CONFIRMABLE.includes(status) ? yes : no('notConfirmable'),
    extendHold: !can.write ? no('needWrite') : closed ? no('closed') : EXTENDABLE.includes(status) ? yes : no('notExtendable'),
    cancel: !can.write ? no('needWrite') : closed ? no('closed') : yes,
    verifyEligibility: !can.write
      ? no('needWrite')
      : detail.attendees.some((a) => a.eligibilityResult === 'pending') || detail.booking.eligibilityReview ? yes : no('noEligibility'),
  }
}

export type SessionRow = {
  key: string
  occurrenceId: string | null
  title: string | null
  startsAt: string | null
  /** People with a place in this session (not released). */
  people: number
  /** The state shown: what the active places are, or why they were released. */
  state: { kind: AllocationView['kind'] } | { released: string }
}

/** One row per session: the snapshot's title and time, joined with the allocations. */
export function sessionRows(detail: Pick<BookingDetail, 'allocations' | 'sessions'>): SessionRow[] {
  const byOcc = new Map<string, AllocationView[]>()
  for (const a of detail.allocations) byOcc.set(a.occurrenceId, [...(byOcc.get(a.occurrenceId) ?? []), a])
  const snap = new Map<string, SnapshotSession>()
  for (const s of detail.sessions) if (s.occurrenceId) snap.set(s.occurrenceId, s)

  const rows: SessionRow[] = []
  for (const [occurrenceId, list] of byOcc) {
    const active = list.filter((a) => !a.releasedAt)
    const s = snap.get(occurrenceId)
    rows.push({
      key: occurrenceId,
      occurrenceId,
      title: s?.title ?? null,
      startsAt: s?.startsAt ?? null,
      people: active.length,
      state: active.length ? { kind: active[0].kind } : { released: list[0].releaseReason ?? 'cancelled' },
    })
  }
  // Snapshot sessions with no allocation row at all (should not happen): shown as they were booked.
  for (const s of detail.sessions) {
    if (s.occurrenceId && byOcc.has(s.occurrenceId)) continue
    rows.push({ key: s.occurrenceId ?? `snap-${rows.length}`, occurrenceId: s.occurrenceId, title: s.title, startsAt: s.startsAt, people: 0, state: { kind: 'confirmed' } })
  }
  return rows.sort((a, b) => (a.startsAt ?? '￿').localeCompare(b.startsAt ?? '￿'))
}

/** The names of the sessions named by `ids`, for "No places left on …"; null when none can be named. */
export function sessionNames(detail: Pick<BookingDetail, 'sessions'>, ids: readonly string[] | undefined, formatTime: (iso: string) => string): string | null {
  if (!ids?.length) return null
  const names = ids.map((id) => {
    const s = detail.sessions.find((x) => x.occurrenceId === id)
    if (!s?.title && !s?.startsAt) return null
    return [s.title, s.startsAt ? formatTime(s.startsAt) : null].filter(Boolean).join(', ')
  })
  const known = names.filter((n): n is string => !!n)
  return known.length ? known.join('; ') : null
}

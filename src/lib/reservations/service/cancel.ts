// ── Reservations — cancellations (ADR-044 D7, D9, D10, D16.10) ────────────────
import { proportionalRefund } from '../money'
import { hashToken, isWellFormedToken } from '../tokens'
import type { CancelOutcome } from '../types'
import type { OutboxInput } from '../server/payload'
import type { Actor, BookingRow } from '../server/types'
import {
  fromStoreError, HOUR, loadRuleContext, makeIntent, recipientsOf, refuse, sessionRules, succeed,
  type AffectedBooking, type ServiceDeps, type ServiceResult, type SessionInfo, type TargetRef,
} from './types'

/** What the tenant has to do afterwards. `refund_review` = a refund request awaits approval (never automatic). */
export type ParticipantOutcome = 'none' | 'credit' | 'refund_review'

const outcomeOf = (o: CancelOutcome, booking: Pick<BookingRow, 'paymentStatus'>): ParticipantOutcome => {
  if (booking.paymentStatus === 'unpaid') return 'none' // nothing was paid, nothing to return
  return o === 'refund' ? 'refund_review' : o === 'credit' ? 'credit' : 'none'
}

async function bookingByToken(projectId: string, token: string, deps: ServiceDeps) {
  if (!isWellFormedToken(token)) return refuse('not_found')
  const b = await deps.store.getBookingByTokenHash(hashToken(token))
  if (!b.ok) return fromStoreError(b.error)
  // Token lookups are not project-scoped: the caller's project must match.
  if (!b.value || b.value.projectId !== projectId || b.value.anonymisedAt) return refuse('not_found')
  return succeed(b.value)
}

// ── Participant cancels the whole booking ────────────────────────────────────
export type SelfCancelInput = {
  projectId: string
  managementToken: string
  target: TargetRef
  /** The booking's sessions (the deadline counts from the earliest). Empty for a pass-only booking. */
  sessions: SessionInfo[]
}

export async function selfCancel(
  input: SelfCancelInput, deps: ServiceDeps,
): Promise<ServiceResult<{ bookingId: string; outcome: ParticipantOutcome; released: number }>> {
  const b = await bookingByToken(input.projectId, input.managementToken, deps)
  if (!b.ok) return b
  const booking = b.value
  if (booking.status === 'cancelled' || booking.status === 'expired') return refuse('already_closed')

  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const rule = ctx.value.rules.selfCancel
  if (!rule.enabled) return refuse('self_cancel_disabled')

  if (input.sessions.length) {
    const first = Math.min(...input.sessions.map((s) => new Date(s.startsAt).getTime()))
    if (deps.now().getTime() > first - rule.deadlineHours * HOUR) return refuse('cancel_deadline_passed')
  }

  const r = await deps.store.release(input.projectId, booking.id, 'cancelled', { cancelBooking: true, actor: { kind: 'participant' } })
  if (!r.ok) return fromStoreError(r.error)

  if (booking.purchaserEmail) {
    await deps.store.enqueueOutbox(input.projectId, [{
      bookingId: booking.id,
      intent: makeIntent(deps, {
        intent: 'booking.cancelled', dedupeKey: `booking.cancelled:${booking.id}`,
        recipients: recipientsOf({ email: booking.purchaserEmail, name: booking.purchaserName }), locale: booking.locale,
        payload: { reference: booking.reference },
      }),
    }])
  }
  return succeed({ bookingId: booking.id, outcome: outcomeOf(rule.outcome, booking), released: r.value.released })
}

// ── Participant skips one session (absence notice) ───────────────────────────
export type AbsenceInput = { projectId: string; managementToken: string; target: TargetRef; session: SessionInfo }

export async function absenceNotice(
  input: AbsenceInput, deps: ServiceDeps,
): Promise<ServiceResult<{ bookingId: string; placeReleased: boolean; outcome: ParticipantOutcome }>> {
  const b = await bookingByToken(input.projectId, input.managementToken, deps)
  if (!b.ok) return b
  const booking = b.value
  if (booking.status !== 'confirmed' && booking.status !== 'held' && booking.status !== 'awaiting_payment') return refuse('already_closed')

  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const rule = sessionRules(ctx.value.rules, input.session).absenceNotice
  if (!rule.enabled) return refuse('absence_notice_disabled')
  if (deps.now().getTime() >= new Date(input.session.startsAt).getTime()) return refuse('session_started')

  let placeReleased = false
  if (rule.releasePlace) {
    const r = await deps.store.release(input.projectId, booking.id, 'absence', {
      occurrenceIds: [input.session.occurrenceId], actor: { kind: 'participant' },
    })
    if (!r.ok) return fromStoreError(r.error)
    placeReleased = r.value.released > 0
  }
  return succeed({ bookingId: booking.id, placeReleased, outcome: outcomeOf(rule.outcome, booking) })
}

// ── Organiser cancels a session ──────────────────────────────────────────────
export type OrganiserOutcome = 'notify_only' | 'credit' | 'refund_review'

export type AffectedEntry = {
  bookingId: string
  name: string | null
  email: string | null
  locale: string
  isPassHolder: boolean
  outcome: OrganiserOutcome
  /** Proportional refund suggestion in cents (only when outcome = refund_review). */
  suggestedRefundCents: number | null
  released: boolean
}

export type OrganiserCancelResult = {
  occurrenceId: string
  affected: AffectedEntry[]
  failures: Array<{ bookingId: string; code: string }>
  /** `session.cancelled` intents, one per affected booking with an email. NOT sent: see sendSessionCancelledNotices. */
  intents: Array<{ bookingId: string; intent: OutboxInput }>
}

export type OrganiserCancelInput = {
  projectId: string
  session: SessionInfo
  target: TargetRef
  actor?: Actor
  note?: string | null
}

export async function organiserCancelSession(input: OrganiserCancelInput, deps: ServiceDeps): Promise<ServiceResult<OrganiserCancelResult>> {
  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const configured = sessionRules(ctx.value.rules, input.session).organiserCancelOutcome

  const list = await deps.store.listAffectedBookings(input.projectId, [input.session.occurrenceId])
  if (!list.ok) return fromStoreError(list.error)

  const affected: AffectedEntry[] = []
  const failures: OrganiserCancelResult['failures'] = []
  const intents: OrganiserCancelResult['intents'] = []
  const seen = new Set<string>()
  for (const a of list.value) {
    if (seen.has(a.bookingId)) continue
    seen.add(a.bookingId)
    const r = await deps.store.release(input.projectId, a.bookingId, 'organiser_cancelled', {
      occurrenceIds: [input.session.occurrenceId], cancelBooking: false, actor: input.actor ?? { kind: 'user' }, note: input.note ?? null,
    })
    if (!r.ok) { failures.push({ bookingId: a.bookingId, code: fromStoreError(r.error).code }); continue }
    const e = organiserEntry(a, configured, r.value.released > 0)
    affected.push(e)
    if (a.email) {
      intents.push({
        bookingId: a.bookingId,
        intent: makeIntent(deps, {
          intent: 'session.cancelled', dedupeKey: `session.cancelled:${input.session.occurrenceId}:${a.bookingId}`,
          recipients: recipientsOf(a), locale: a.locale,
          payload: { occurrenceId: input.session.occurrenceId, outcome: e.outcome },
        }),
      })
    }
  }
  return succeed({ occurrenceId: input.session.occurrenceId, affected, failures, intents })
}

function organiserEntry(a: AffectedBooking, configured: string, released: boolean): AffectedEntry {
  const isPassHolder = a.passId !== null
  let outcome: OrganiserOutcome = 'notify_only'
  let suggestedRefundCents: number | null = null
  const paid = a.paymentStatus !== 'unpaid'
  // Pass holders: entries come back in the database; never a money outcome by default (D9).
  if (!isPassHolder && paid) {
    if (configured === 'credit') outcome = 'credit'
    else if (configured === 'proportional_refund') {
      outcome = 'refund_review'
      suggestedRefundCents = proportionalRefund(a.totalCents, Math.max(1, a.sessionCount), 1)
    }
  }
  return { bookingId: a.bookingId, name: a.name, email: a.email, locale: a.locale, isPassHolder, outcome, suggestedRefundCents, released }
}

/** The dashboard's "Notify N people?" confirmation: queues the prepared intents. */
export async function sendSessionCancelledNotices(
  result: OrganiserCancelResult, projectId: string, deps: ServiceDeps,
): Promise<ServiceResult<{ queued: number }>> {
  if (!result.intents.length) return succeed({ queued: 0 })
  const r = await deps.store.enqueueOutbox(projectId, result.intents.map((i) => ({ bookingId: i.bookingId, intent: i.intent })))
  if (!r.ok) return fromStoreError(r.error)
  return succeed({ queued: r.value.queued })
}

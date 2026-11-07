// ── Reservations website — view models of the booking page and My pass (ADR-044 D7, D9) ──
//
// PURE: no database, no network, no clock of its own (`now` is passed in).
// Everything the two pages show is decided here — what a person may do and
// why not — so the page, the client component and the actions never repeat a
// rule. The services (service/cancel.ts, service/passes.ts) stay the authority
// for the actual change; this only decides which buttons to offer.
//
// Dates and times are written in the SITE time zone (falling back to the
// session's own), 24-hour, in the page language.
import { chooseEmailLocale, formatAmount, formatDate, formatTime, intlLocale, pickLocalized } from '../notifications/templates/format'
import type { EmailLocale } from '../notifications/templates/dictionaries'
import { canWithdraw, canSignUp, entriesRemaining, scopeCovers } from '../passes'
import { localOf } from '@/lib/scheduling/time'
import type { SchedulePlace } from '@/lib/scheduling/types'
import type { BookingRules, BookingRulesOverride } from '../types'
import { resolveRules } from '../rules'
import type { BookingRow, PassRow, SessionAvailability } from '../server/types'
import type { BookingSessionView, BookingView, PassSessionView, PassView } from './types'

const HOUR = 3_600_000
export const DEFAULT_SITE_TIME_ZONE = 'Europe/Rome'

/** One session as the pages need it (decorated with title / place by the loader). */
export type SessionFact = {
  occurrenceId: string
  startsAt: string
  endsAt: string | null
  timeZone: string
  status: 'scheduled' | 'cancelled'
  ownerType: 'event' | 'course'
  ownerPublicId: string
  title: string | null
  /** Where the session happens as scheduling stores it; the loader turns it into `place`. */
  placeRef: SchedulePlace | null
  place: string | null
  rulesOverride: BookingRulesOverride | null
}

/** One row of booking_allocations, reduced to what the pages need. */
export type AllocationFact = {
  occurrenceId: string
  kind: 'hold' | 'confirmed' | 'pass_attendance'
  passId: string | null
  expiresAt: string | null
  releasedAt: string | null
  releaseReason: string | null
  usesEntry: boolean
  entryReturned: boolean
}

const sessionRulesOf = (base: BookingRules, s: Pick<SessionFact, 'rulesOverride'>): BookingRules => resolveRules(base, s.rulesOverride ?? null)

const zoneOf = (s: Pick<SessionFact, 'timeZone'>, siteTimeZone: string | null): string => siteTimeZone ?? s.timeZone ?? DEFAULT_SITE_TIME_ZONE

export function localeOf(locale: string, siteDefault?: string | null): EmailLocale {
  return chooseEmailLocale({ bookingLocale: locale, siteDefaultLocale: siteDefault })
}

/** "2 November 2026" for a project-local 'YYYY-MM-DD'. */
export function formatDay(ymd: string, locale: EmailLocale): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
}

const sessionLabels = (s: SessionFact, locale: EmailLocale, siteTz: string | null) => {
  const tz = zoneOf(s, siteTz)
  const start = formatTime(s.startsAt, locale, tz)
  const end = s.endsAt ? formatTime(s.endsAt, locale, tz) : ''
  return { dateLabel: formatDate(s.startsAt, locale, tz), timeLabel: end ? `${start}–${end}` : start }
}

const startMs = (s: Pick<SessionFact, 'startsAt'>) => new Date(s.startsAt).getTime()

// ── Booking page ─────────────────────────────────────────────────────────────
export type BookingViewInput = {
  booking: BookingRow
  /** The rules of the booking's target (project defaults + target override). */
  rules: BookingRules
  allocations: AllocationFact[]
  sessions: SessionFact[]
  /** The booking holds a pass (its sessions are answered on My pass instead). */
  isPass: boolean
  now: Date
  locale: string
  siteDefaultLocale?: string | null
  siteTimeZone: string | null
  paymentInstructions: unknown
  bankDetails: unknown
}

const RELEASED_BY_ORGANISER = new Set(['organiser_cancelled', 'session_removed'])

function stateOf(s: SessionFact, a: AllocationFact | undefined, now: Date): BookingSessionView['state'] | null {
  if (!a) return null
  if (a.releasedAt) return RELEASED_BY_ORGANISER.has(a.releaseReason ?? '') || s.status === 'cancelled' ? 'cancelled' : 'released'
  if (s.status === 'cancelled') return 'cancelled'
  return startMs(s) <= now.getTime() ? 'past' : 'attending'
}

/** One allocation per session: a live one wins over a released one. */
function byOccurrence(allocations: readonly AllocationFact[]): Map<string, AllocationFact> {
  const out = new Map<string, AllocationFact>()
  for (const a of allocations) {
    if (a.kind === 'pass_attendance') continue
    const prev = out.get(a.occurrenceId)
    if (!prev || (prev.releasedAt && !a.releasedAt)) out.set(a.occurrenceId, a)
  }
  return out
}

export function buildBookingView(input: BookingViewInput): BookingView {
  const { booking, rules, now } = input
  const loc = localeOf(input.locale, input.siteDefaultLocale)
  const alloc = byOccurrence(input.allocations)
  const open = booking.status === 'held' || booking.status === 'awaiting_payment' || booking.status === 'confirmed'

  const sessions: BookingSessionView[] = []
  const live: SessionFact[] = []
  for (const s of [...input.sessions].sort((a, b) => startMs(a) - startMs(b))) {
    const state = stateOf(s, alloc.get(s.occurrenceId), now)
    if (!state) continue
    if (state === 'attending' || state === 'past') live.push(s)
    const absence = sessionRulesOf(rules, s).absenceNotice
    sessions.push({
      id: s.occurrenceId,
      title: s.title,
      place: s.place,
      ...sessionLabels(s, loc, input.siteTimeZone),
      state,
      canAbsent: !input.isPass && booking.status === 'confirmed' && absence.enabled && state === 'attending',
    })
  }

  // Whole-booking cancellation: same test as selfCancel() — the deadline counts from the earliest live session.
  let cancelAllowed = open && rules.selfCancel.enabled
  let untilLabel: string | null = null
  if (cancelAllowed && live.length) {
    const first = Math.min(...live.map(startMs))
    const deadline = first - rules.selfCancel.deadlineHours * HOUR
    if (now.getTime() > deadline) cancelAllowed = false
    else untilLabel = `${formatDate(new Date(deadline).toISOString(), loc, input.siteTimeZone ?? live[0].timeZone)}, ${formatTime(new Date(deadline).toISOString(), loc, input.siteTimeZone ?? live[0].timeZone)}`
  }

  const awaiting = booking.status === 'awaiting_payment' || (booking.status === 'held' && booking.paymentStatus !== 'paid')
  const payBy = awaiting && booking.holdExpiresAt
    ? `${formatDate(booking.holdExpiresAt, loc, input.siteTimeZone)}, ${formatTime(booking.holdExpiresAt, loc, input.siteTimeZone)}`
    : null
  return {
    reference: booking.reference,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    amountLabel: booking.totalCents > 0 ? formatAmount(booking.totalCents, loc) : null,
    payByLabel: payBy,
    paymentInstructions: awaiting ? pickLocalized(input.paymentInstructions, loc, input.siteDefaultLocale) : null,
    bankDetails: awaiting ? pickLocalized(input.bankDetails, loc, input.siteDefaultLocale) : null,
    isPass: input.isPass,
    sessions,
    cancel: { allowed: cancelAllowed, untilLabel },
  }
}

// ── My pass ──────────────────────────────────────────────────────────────────
export type PassViewInput = {
  pass: PassRow
  /** The target's owner: a 'target'-scoped pass covers exactly this one. null = a project-wide target. */
  targetOwner: { ownerType: 'event' | 'course'; ownerPublicId: string } | null
  rules: BookingRules
  /** Allocations of THIS pass (live ones are the "Coming" answers). */
  allocations: AllocationFact[]
  /** Upcoming candidates from scheduling; coverage is re-checked here. */
  sessions: SessionFact[]
  availability: ReadonlyMap<string, Pick<SessionAvailability, 'places' | 'active'>>
  now: Date
  locale: string
  siteDefaultLocale?: string | null
  siteTimeZone: string | null
}

/** Does this pass give the right to attend the session (scope + validity, project-local dates)? */
export function passCoversSession(pass: PassRow, targetOwner: PassViewInput['targetOwner'], s: SessionFact, timeZone: string): boolean {
  const day = localOf(s.startsAt, timeZone).slice(0, 10)
  if (day < pass.validFrom || day > pass.validTo) return false
  if (pass.scope === 'all_courses') return scopeCovers({ kind: 'all_courses' }, s.ownerType, s.ownerPublicId)
  if (pass.scope === 'courses') return scopeCovers({ kind: 'courses', ownerPublicIds: pass.scopeOwnerIds ?? [] }, s.ownerType, s.ownerPublicId)
  return !!targetOwner && targetOwner.ownerType === s.ownerType && targetOwner.ownerPublicId === s.ownerPublicId
}

/** Entries used = consumed and not given back (the same rule as the database's counter). */
export function entriesUsed(allocations: readonly AllocationFact[]): number {
  return allocations.filter((a) => a.usesEntry && !a.entryReturned).length
}

export function buildPassView(input: PassViewInput): PassView {
  const { pass, rules, now } = input
  const loc = localeOf(input.locale, input.siteDefaultLocale)
  const siteTz = input.siteTimeZone ?? DEFAULT_SITE_TIME_ZONE
  const today = localOf(now.toISOString(), siteTz).slice(0, 10)
  const status: PassView['status'] =
    pass.status === 'cancelled' ? 'cancelled' : today > pass.validTo ? 'expired' : today < pass.validFrom ? 'not_started' : 'active'
  const left = entriesRemaining(pass.entriesTotal, Math.min(entriesUsed(input.allocations), pass.entriesTotal ?? Number.MAX_SAFE_INTEGER))

  const attending = new Set(input.allocations.filter((a) => !a.releasedAt && a.kind === 'pass_attendance').map((a) => a.occurrenceId))
  const sessions: PassSessionView[] = []
  if (status === 'active') {
    for (const s of [...input.sessions].sort((a, b) => startMs(a) - startMs(b))) {
      if (startMs(s) <= now.getTime()) continue
      if (!passCoversSession(pass, input.targetOwner, s, siteTz)) continue
      const cancelled = s.status === 'cancelled'
      const r = sessionRulesOf(rules, s)
      const mode = r.passSignUp === 'opt_in' ? 'opt_in' : 'off'
      const isAttending = attending.has(s.occurrenceId)
      const start = new Date(s.startsAt)
      const win = canSignUp({ now, sessionStartsAt: start, opensDaysBefore: r.signUpOpensDaysBefore, changeUntilHoursBefore: r.answerChangeUntilHoursBefore })
      const av = input.availability.get(s.occurrenceId)
      const full = !!av && av.places !== null && av.active >= av.places
      let blocked: PassSessionView['blocked'] = null
      if (mode === 'opt_in' && !cancelled && !isAttending) {
        if (win === 'not_open_yet') blocked = 'not_open_yet'
        else if (win === 'closed') blocked = 'closed'
        else if (full) blocked = 'full'
        else if (left !== null && left <= 0) blocked = 'no_entries'
      }
      let opensLabel: string | null = null
      if (blocked === 'not_open_yet' && r.signUpOpensDaysBefore !== null) {
        opensLabel = formatDate(new Date(start.getTime() - r.signUpOpensDaysBefore * 24 * HOUR).toISOString(), loc, zoneOf(s, input.siteTimeZone))
      }
      sessions.push({
        id: s.occurrenceId,
        title: s.title,
        place: s.place,
        ...sessionLabels(s, loc, input.siteTimeZone),
        cancelled,
        mode,
        attending: isAttending,
        canCome: mode === 'opt_in' && !cancelled && !isAttending && blocked === null,
        canLeave: mode === 'opt_in' && !cancelled && isAttending && canWithdraw({ now, sessionStartsAt: start, changeUntilHoursBefore: 0 }).allowed,
        blocked,
        opensLabel,
      })
    }
  }
  return {
    status,
    validFromLabel: formatDay(pass.validFrom, loc),
    validToLabel: formatDay(pass.validTo, loc),
    entriesLeft: left,
    sessions,
  }
}

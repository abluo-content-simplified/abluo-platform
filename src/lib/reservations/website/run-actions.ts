// ── Reservations website — what the buttons do (ADR-044 D7, D9, D11) ─────────
//
// The logic behind the server actions, with everything injected so it is
// tested without Next.js: token check (rate limited, project compared) →
// the existing service (selfCancel / absenceNotice / signUp / withdraw) →
// the fresh view the client replaces its state with. Service results are
// machine codes; this file maps them to the page's error keys (texts live in
// the dictionary). Nothing here logs, and no token leaves it.
import { absenceNotice, selfCancel, signUp, withdraw, type ParticipantOutcome } from '../service'
import type { ServiceStore, SessionInfo } from '../service/types'
import type { BookingRow } from '../server/types'
import { lookupBookingLink, lookupPassLink, type LinkLookup } from './link-guard'
import { loadBookingView, loadPassView, readBookingAllocations, readSessionFacts, readTargetRef, type SiteCtx } from './data'
import { DEFAULT_SITE_TIME_ZONE, type SessionFact } from './view-model'
import type { ActionResult, BookingView, ErrorKey, PassView } from './types'

export type ActionCtx = SiteCtx & { ipHash: string | null }
type LinkStore = Parameters<typeof lookupBookingLink>[0]

const linkStore = (ctx: ActionCtx): LinkStore => ctx.service.store as ServiceStore

/** Service codes → the dictionary's error keys. Unknown codes are a generic failure, never a leak. */
export function errorKeyFor(code: string): ErrorKey {
  switch (code) {
    case 'full': return 'full'
    case 'no_entries_left': return 'noEntries'
    case 'cancel_deadline_passed': return 'deadlinePassed'
    case 'session_started': return 'sessionStarted'
    case 'already_closed': return 'alreadyClosed'
    case 'self_cancel_disabled':
    case 'absence_notice_disabled':
    case 'sign_up_not_needed':
    case 'session_mismatch':
      return 'notAllowed'
    case 'sign_up_not_open_yet': return 'notOpenYet'
    case 'sign_up_closed': return 'closed'
    case 'pass_not_active':
    case 'pass_does_not_cover':
      return 'inactive'
    case 'unavailable':
    case 'settings_missing':
      return 'unavailable'
    default: return 'generic'
  }
}

function linkError(l: Exclude<LinkLookup<unknown>, { kind: 'ok' }>): ErrorKey {
  // An unknown/foreign link looks like any other refusal: nothing says whether it existed.
  return l.kind === 'limited' ? 'tooMany' : l.kind === 'unavailable' ? 'unavailable' : 'generic'
}

const infoOf = (s: SessionFact): SessionInfo => ({
  occurrenceId: s.occurrenceId, startsAt: s.startsAt, ownerType: s.ownerType, ownerPublicId: s.ownerPublicId, rulesOverride: s.rulesOverride,
})

const fail = (error: ErrorKey): { ok: false; error: ErrorKey } => ({ ok: false, error })

// ── Booking page ─────────────────────────────────────────────────────────────
export async function runCancelBooking(ctx: ActionCtx, input: { token: unknown }): Promise<ActionResult<BookingView>> {
  const link = await lookupBookingLink(linkStore(ctx), { projectId: ctx.projectId, token: input.token, ipHash: ctx.ipHash })
  if (link.kind !== 'ok') return fail(linkError(link))
  const before = await loadBookingView(ctx, link.value)
  if (!before.ok) return fail(errorKeyFor(before.code))

  // The sessions whose earliest start the deadline counts from: the live ones, as the page showed them.
  const live = before.value.sessions.filter((s) => before.value.view.sessions.some((v) => v.id === s.occurrenceId && (v.state === 'attending' || v.state === 'past')))
  const r = await selfCancel({ projectId: ctx.projectId, managementToken: String(input.token), target: before.value.target, sessions: live.map(infoOf) }, ctx.service)
  if (!r.ok) return fail(errorKeyFor(r.code))

  const after = await loadBookingView(ctx, await reread(ctx, link.value))
  if (!after.ok) return fail(errorKeyFor(after.code))
  return { ok: true, view: after.value.view, outcome: outcomeKey(r.value.outcome) }
}

export async function runAbsence(ctx: ActionCtx, input: { token: unknown; occurrenceId: unknown }): Promise<ActionResult<BookingView>> {
  if (typeof input.occurrenceId !== 'string') return fail('generic')
  const link = await lookupBookingLink(linkStore(ctx), { projectId: ctx.projectId, token: input.token, ipHash: ctx.ipHash })
  if (link.kind !== 'ok') return fail(linkError(link))
  const before = await loadBookingView(ctx, link.value)
  if (!before.ok) return fail(errorKeyFor(before.code))

  // Only a session this booking actually holds (a live allocation) can be skipped.
  const holds = (await readBookingAllocations(ctx.db, ctx.projectId, link.value.id)).some((a) => a.occurrenceId === input.occurrenceId && !a.releasedAt && a.kind !== 'pass_attendance')
  const session = before.value.sessions.find((s) => s.occurrenceId === input.occurrenceId)
  if (!holds || !session) return fail('notAllowed')

  const r = await absenceNotice({ projectId: ctx.projectId, managementToken: String(input.token), target: before.value.target, session: infoOf(session) }, ctx.service)
  if (!r.ok) return fail(errorKeyFor(r.code))
  const after = await loadBookingView(ctx, await reread(ctx, link.value))
  if (!after.ok) return fail(errorKeyFor(after.code))
  return { ok: true, view: after.value.view, outcome: outcomeKey(r.value.outcome) }
}

const outcomeKey = (o: ParticipantOutcome) => o

/** The booking as it is NOW (its status just changed); the row read before the change if the re-read fails. */
async function reread(ctx: ActionCtx, before: BookingRow): Promise<BookingRow> {
  const r = await ctx.service.store.getBookingById(ctx.projectId, before.id)
  return r.ok && r.value ? r.value : before
}

// ── My pass ──────────────────────────────────────────────────────────────────
export async function runPassAnswer(ctx: ActionCtx, input: { token: unknown; occurrenceId: unknown; coming: unknown }): Promise<ActionResult<PassView>> {
  if (typeof input.occurrenceId !== 'string' || typeof input.coming !== 'boolean') return fail('generic')
  const link = await lookupPassLink(linkStore(ctx), { projectId: ctx.projectId, token: input.token, ipHash: ctx.ipHash })
  if (link.kind !== 'ok') return fail(linkError(link))
  const pass = link.value

  // The session comes from the database, scoped to this project — never from the client.
  const [fact] = await readSessionFacts(ctx.db, ctx.projectId, [input.occurrenceId])
  const target = await readTargetRef(ctx.db, ctx.projectId, pass.targetId)
  if (!fact || !target) return fail('notAllowed')
  if (fact.status === 'cancelled') return fail('notAllowed')
  const timeZone = (await ctx.site.timeZone()) ?? DEFAULT_SITE_TIME_ZONE
  const base = { projectId: ctx.projectId, passToken: String(input.token), occurrenceId: fact.occurrenceId, session: infoOf(fact), target, timeZone }

  let notice: 'saved' | 'entryReturned' | 'entryKept' = 'saved'
  if (input.coming) {
    const r = await signUp(base, ctx.service)
    if (!r.ok) return fail(errorKeyFor(r.code))
  } else {
    const r = await withdraw(base, ctx.service)
    if (!r.ok) return fail(errorKeyFor(r.code))
    if (pass.entriesTotal !== null) notice = r.value.entryReturned ? 'entryReturned' : r.value.afterDeadline ? 'entryKept' : 'saved'
  }
  const after = await loadPassView(ctx, pass)
  if (!after.ok) return fail(errorKeyFor(after.code))
  return { ok: true, view: after.value.view, notice }
}

import { describe, expect, it } from 'vitest'
import { ok } from '../../server/errors'
import { fakeDb, type Call } from '../../server/__tests__/fake-db'
import { bookingRow, counterBytes, NOW, option, P, passRow, settings, target, TZ } from '../../service/__tests__/fake-store'
import { makeStore } from '../../service/__tests__/fake-store'
import type { ServiceDeps } from '../../service/types'
import { errorKeyFor, runAbsence, runCancelBooking, runPassAnswer, type ActionCtx } from '../run-actions'
import { mintManagementToken } from './helpers'

const TID = '33333333-3333-4333-8333-333333333331'
const BID = '44444444-4444-4444-8444-444444444441'
const PASS_ID = '55555555-5555-4555-8555-555555555551'
const OCC = '22222222-2222-4222-8222-222222222221'
const OCC2 = '22222222-2222-4222-8222-222222222222'
const TOKEN = mintManagementToken(5)
const IN_5D = '2026-11-12T17:00:00Z'

type Tables = Record<string, Array<Record<string, unknown>>>

function occurrence(id: string, startsAt: string, over: Record<string, unknown> = {}) {
  return { id, series_id: null, starts_at: startsAt, ends_at: null, time_zone: TZ, status: 'scheduled', owner_type: 'course', owner_public_id: 'c-yoga', place_override: null, ...over }
}

function setup(o: { tables?: Tables; store?: Parameters<typeof makeStore>[0]; ipHash?: string | null } = {}) {
  const tables: Tables = {
    reservable_targets: [{ owner_type: 'course', owner_public_id: 'c-yoga', edition_id: null }],
    event_occurrences: [occurrence(OCC, IN_5D)],
    session_capacity: [], event_series: [], booking_allocations: [], booking_passes: [], ...o.tables,
  }
  const { db, calls } = fakeDb((c: Call) => ({ data: c.kind === 'from' ? tables[c.table] ?? [] : null }))
  const s = makeStore({ target: target({ id: TID }), ...o.store })
  s.store.reserveLinkAttempt = (async () => ok({ allowed: true, attemptId: 1, retryAfterSeconds: 0 })) as never
  s.store.finishLinkAttempt = (async () => ok(true as const)) as never
  s.store.sessionAvailability = (async (_p: string, ids: string[]) => ok(ids.map((occurrenceId) => ({ occurrenceId, places: null, active: 0 })))) as never
  const service: ServiceDeps = { store: s.store, now: () => NOW, randomBytes: counterBytes(), environment: 'production' }
  const ctx: ActionCtx = {
    projectId: P, locale: 'en', db: db as never, service, ipHash: o.ipHash === undefined ? 'a'.repeat(64) : o.ipHash,
    site: { decorate: async (f) => f, timeZone: async () => TZ, defaultLocale: async () => 'en' },
  }
  return { ctx, s, calls }
}

const RULES_BOOKING = settings({ selfCancel: { enabled: true, deadlineHours: 48, outcome: 'credit' }, absenceNotice: { enabled: true, releasePlace: true, outcome: 'none' } })
const confirmedBooking = bookingRow({ id: BID, targetId: TID })
const live = (id = OCC) => ({ occurrence_id: id, kind: 'confirmed', pass_id: null, expires_at: null, released_at: null, release_reason: null, uses_entry: false, entry_returned: false })

describe('errorKeyFor', () => {
  it('maps service codes to dictionary keys; unknown codes are generic', () => {
    expect(errorKeyFor('full')).toBe('full')
    expect(errorKeyFor('no_entries_left')).toBe('noEntries')
    expect(errorKeyFor('cancel_deadline_passed')).toBe('deadlinePassed')
    expect(errorKeyFor('session_started')).toBe('sessionStarted')
    expect(errorKeyFor('already_closed')).toBe('alreadyClosed')
    expect(errorKeyFor('self_cancel_disabled')).toBe('notAllowed')
    expect(errorKeyFor('sign_up_not_needed')).toBe('notAllowed')
    expect(errorKeyFor('sign_up_not_open_yet')).toBe('notOpenYet')
    expect(errorKeyFor('sign_up_closed')).toBe('closed')
    expect(errorKeyFor('pass_does_not_cover')).toBe('inactive')
    expect(errorKeyFor('unavailable')).toBe('unavailable')
    expect(errorKeyFor('something_new')).toBe('generic')
  })
})

describe('runCancelBooking', () => {
  const tables = { booking_allocations: [live()] }

  it('cancels through selfCancel, returns the fresh view and the outcome (credit for a paid booking)', async () => {
    const { ctx, s } = setup({ tables, store: { settings: RULES_BOOKING, bookingByToken: confirmedBooking, bookingById: bookingRow({ id: BID, targetId: TID, status: 'cancelled' }) } })
    const r = await runCancelBooking(ctx, { token: TOKEN })
    expect(r).toMatchObject({ ok: true, outcome: 'credit', view: { status: 'cancelled', cancel: { allowed: false } } })
    expect(s.called('release')[0].args.slice(0, 3)).toEqual([P, BID, 'cancelled'])
    expect(s.called('release')[0].args[3]).toMatchObject({ cancelBooking: true, actor: { kind: 'participant' } })
  })

  it('refuses after the deadline with a dictionary key, and releases nothing', async () => {
    const { ctx, s } = setup({
      tables: { booking_allocations: [live()], event_occurrences: [occurrence(OCC, '2026-11-08T10:00:00Z')] },
      store: { settings: RULES_BOOKING, bookingByToken: confirmedBooking },
    })
    expect(await runCancelBooking(ctx, { token: TOKEN })).toEqual({ ok: false, error: 'deadlinePassed' })
    expect(s.called('release')).toHaveLength(0)
  })

  it('self-cancel switched off -> notAllowed', async () => {
    const { ctx } = setup({ tables, store: { settings: settings(), bookingByToken: confirmedBooking } })
    expect(await runCancelBooking(ctx, { token: TOKEN })).toEqual({ ok: false, error: 'notAllowed' })
  })

  it('a token of another project, a malformed token and a rate-limited address never reach the service', async () => {
    const other = setup({ tables, store: { settings: RULES_BOOKING, bookingByToken: bookingRow({ projectId: 'other' }) } })
    expect(await runCancelBooking(other.ctx, { token: TOKEN })).toEqual({ ok: false, error: 'generic' })
    expect(other.s.called('release')).toHaveLength(0)

    const bad = setup({ tables, store: { settings: RULES_BOOKING } })
    expect(await runCancelBooking(bad.ctx, { token: 'nope' })).toEqual({ ok: false, error: 'generic' })
    expect(bad.s.calls).toHaveLength(0)

    const limited = setup({ tables, store: { settings: RULES_BOOKING } })
    limited.s.store.reserveLinkAttempt = (async () => ok({ allowed: false, attemptId: null, retryAfterSeconds: 900 })) as never
    expect(await runCancelBooking(limited.ctx, { token: TOKEN })).toEqual({ ok: false, error: 'tooMany' })
    expect(limited.s.called('release')).toHaveLength(0)

    const noSalt = setup({ tables, store: { settings: RULES_BOOKING }, ipHash: null })
    expect(await runCancelBooking(noSalt.ctx, { token: TOKEN })).toEqual({ ok: false, error: 'unavailable' })
  })

  it('every database read carries the project id', async () => {
    const { ctx, calls } = setup({ tables, store: { settings: RULES_BOOKING, bookingByToken: confirmedBooking } })
    await runCancelBooking(ctx, { token: TOKEN })
    const reads = calls.filter((c): c is Extract<Call, { kind: 'from' }> => c.kind === 'from')
    expect(reads.length).toBeGreaterThan(0)
    for (const c of reads) expect(c.ops.some(([n, a]) => n === 'eq' && a[0] === 'project_id' && a[1] === P), c.table).toBe(true)
  })
})

describe('runAbsence', () => {
  const tables = { booking_allocations: [live()] }
  const store = { settings: RULES_BOOKING, bookingByToken: confirmedBooking, bookingById: confirmedBooking }

  it('releases the one session through absenceNotice', async () => {
    const { ctx, s } = setup({ tables, store })
    const r = await runAbsence(ctx, { token: TOKEN, occurrenceId: OCC })
    expect(r).toMatchObject({ ok: true, outcome: 'none' })
    expect(s.called('release')[0].args[2]).toBe('absence')
    expect(s.called('release')[0].args[3]).toMatchObject({ occurrenceIds: [OCC] })
  })

  it('a session this booking does not hold is refused without a release (even if it exists in the project)', async () => {
    const { ctx, s } = setup({ tables: { ...tables, event_occurrences: [occurrence(OCC, IN_5D), occurrence(OCC2, IN_5D)] }, store })
    expect(await runAbsence(ctx, { token: TOKEN, occurrenceId: OCC2 })).toEqual({ ok: false, error: 'notAllowed' })
    expect(await runAbsence(ctx, { token: TOKEN, occurrenceId: 42 })).toEqual({ ok: false, error: 'generic' })
    expect(s.called('release')).toHaveLength(0)
  })

  it('rule off -> notAllowed; session already started -> sessionStarted', async () => {
    expect(await runAbsence(setup({ tables, store: { settings: settings(), bookingByToken: confirmedBooking } }).ctx, { token: TOKEN, occurrenceId: OCC })).toEqual({ ok: false, error: 'notAllowed' })
    const started = setup({ tables: { ...tables, event_occurrences: [occurrence(OCC, '2026-11-07T09:00:00Z')] }, store })
    expect(await runAbsence(started.ctx, { token: TOKEN, occurrenceId: OCC })).toEqual({ ok: false, error: 'sessionStarted' })
  })
})

describe('runPassAnswer', () => {
  const OPT_IN = settings({ passSignUp: 'opt_in', signUpOpensDaysBefore: 7, answerChangeUntilHoursBefore: 2 })
  const pass = passRow({ id: PASS_ID, targetId: TID })
  const store = { settings: OPT_IN, passByToken: pass }

  it('Coming: the session is read from the database and the pass id comes from the token', async () => {
    const { ctx, s } = setup({ store })
    const r = await runPassAnswer(ctx, { token: TOKEN, occurrenceId: OCC, coming: true })
    expect(r).toMatchObject({ ok: true, notice: 'saved' })
    expect(s.called('passAttend')[0].args.slice(0, 3)).toEqual([P, PASS_ID, OCC])
  })

  it('Not coming before the deadline gives the entry back (notice), after it keeps it', async () => {
    const early = setup({ store })
    expect(await runPassAnswer(early.ctx, { token: TOKEN, occurrenceId: OCC, coming: false })).toMatchObject({ ok: true, notice: 'entryReturned' })
    expect(early.s.called('passWithdraw')[0].args[3]).toMatchObject({ returnEntry: true })
    const late = setup({ store, tables: { event_occurrences: [occurrence(OCC, '2026-11-07T11:00:00Z')] } })
    expect(await runPassAnswer(late.ctx, { token: TOKEN, occurrenceId: OCC, coming: false })).toMatchObject({ ok: true, notice: 'entryKept' })
    expect(late.s.called('passWithdraw')[0].args[3]).toMatchObject({ returnEntry: false })
    // an unlimited pass has no entry to talk about
    const unlimited = setup({ store: { ...store, passByToken: passRow({ id: PASS_ID, targetId: TID, entriesTotal: null }) } })
    expect(await runPassAnswer(unlimited.ctx, { token: TOKEN, occurrenceId: OCC, coming: false })).toMatchObject({ ok: true, notice: 'saved' })
  })

  it('maps service refusals: window closed, off mode, no entries, full', async () => {
    const closed = setup({ store, tables: { event_occurrences: [occurrence(OCC, '2026-11-07T11:00:00Z')] } })
    expect(await runPassAnswer(closed.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'closed' })
    const off = setup({ store: { settings: settings(), passByToken: pass } })
    expect(await runPassAnswer(off.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'notAllowed' })
    const noEntries = setup({ store })
    noEntries.s.store.passAttend = (async () => ({ ok: false, error: { kind: 'refused', code: 'no_entries_left' } })) as never
    expect(await runPassAnswer(noEntries.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'noEntries' })
    const full = setup({ store })
    full.s.store.passAttend = (async () => ({ ok: false, error: { kind: 'full', occurrenceIds: [OCC] } })) as never
    expect(await runPassAnswer(full.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'full' })
  })

  it('a session that is not in this project, a cancelled one, a wrong-project token: nothing is changed', async () => {
    const missing = setup({ store, tables: { event_occurrences: [] } })
    expect(await runPassAnswer(missing.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'notAllowed' })
    const cancelled = setup({ store, tables: { event_occurrences: [occurrence(OCC, IN_5D, { status: 'cancelled' })] } })
    expect(await runPassAnswer(cancelled.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'notAllowed' })
    const foreign = setup({ store: { settings: OPT_IN, passByToken: passRow({ projectId: 'other', targetId: TID }) } })
    expect(await runPassAnswer(foreign.ctx, { token: TOKEN, occurrenceId: OCC, coming: true })).toEqual({ ok: false, error: 'generic' })
    for (const x of [missing, cancelled, foreign]) {
      expect(x.s.called('passAttend')).toHaveLength(0)
      expect(x.s.called('passWithdraw')).toHaveLength(0)
    }
    expect(await runPassAnswer(setup({ store }).ctx, { token: TOKEN, occurrenceId: OCC, coming: 'yes' })).toEqual({ ok: false, error: 'generic' })
  })

  it('returns the fresh list: the class just answered shows as coming', async () => {
    const { ctx } = setup({
      store,
      tables: { booking_allocations: [{ occurrence_id: OCC, kind: 'pass_attendance', pass_id: PASS_ID, expires_at: null, released_at: null, release_reason: null, uses_entry: true, entry_returned: false }] },
    })
    const r = await runPassAnswer(ctx, { token: TOKEN, occurrenceId: OCC, coming: true })
    expect(r.ok && r.view.sessions.find((x) => x.id === OCC)).toMatchObject({ attending: true, canLeave: true })
    expect(r.ok && r.view.entriesLeft).toBe(9)
  })
})

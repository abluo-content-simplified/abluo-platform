import { describe, expect, it } from 'vitest'
import { absenceNotice, organiserCancelSession, selfCancel, sendSessionCancelledNotices } from '../cancel'
import { mintToken, type AffectedBooking } from '../types'
import { bookingRow, counterBytes, makeDeps, makeStore, O1, P, REF, settings } from './fake-store'

const tok = mintToken({ randomBytes: counterBytes(5) }).token
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code)
const session = (iso: string) => ({ occurrenceId: O1, startsAt: iso, ownerType: 'course' as const, ownerPublicId: 'c-yoga' })
const SELF = settings({ selfCancel: { enabled: true, deadlineHours: 48, outcome: 'refund' } })

describe('selfCancel', () => {
  const run = (st: ReturnType<typeof makeStore>, iso: string) =>
    selfCancel({ projectId: P, managementToken: tok, target: REF, sessions: [session(iso)] }, makeDeps(st.store))

  it('disabled by the rules -> self_cancel_disabled, nothing released', async () => {
    const s = makeStore()
    expect(code(await run(s, '2026-12-01T10:00:00Z'))).toBe('self_cancel_disabled')
    expect(s.called('release')).toHaveLength(0)
  })
  it('before the deadline: releases + cancels, outcome per rules', async () => {
    const s = makeStore({ settings: SELF })
    const r = await run(s, '2026-11-09T10:00:00Z') // exactly 48 h away = deadline, inclusive
    expect(r).toMatchObject({ ok: true, value: { bookingId: 'b1', outcome: 'refund_review', released: 1 } })
    expect(s.called('release')[0].args.slice(0, 3)).toEqual([P, 'b1', 'cancelled'])
    expect(s.called('release')[0].args[3]).toMatchObject({ cancelBooking: true })
    expect(s.outbox[0].intent.intent).toBe('booking.cancelled')
  })
  it('one millisecond after the deadline: refused', async () => {
    const s = makeStore({ settings: SELF })
    expect(code(await run(s, '2026-11-09T09:59:59.999Z'))).toBe('cancel_deadline_passed')
    expect(s.called('release')).toHaveLength(0)
  })
  it('credit outcome; unpaid booking -> none; other project / closed booking refused', async () => {
    const credit = settings({ selfCancel: { enabled: true, deadlineHours: 48, outcome: 'credit' } })
    expect(await run(makeStore({ settings: credit }), '2026-12-01T10:00:00Z')).toMatchObject({ value: { outcome: 'credit' } })
    expect(await run(makeStore({ settings: SELF, bookingByToken: bookingRow({ paymentStatus: 'unpaid' }) }), '2026-12-01T10:00:00Z')).toMatchObject({ value: { outcome: 'none' } })
    expect(code(await run(makeStore({ settings: SELF, bookingByToken: bookingRow({ projectId: 'other' }) }), '2026-12-01T10:00:00Z'))).toBe('not_found')
    expect(code(await run(makeStore({ settings: SELF, bookingByToken: bookingRow({ status: 'cancelled' }) }), '2026-12-01T10:00:00Z'))).toBe('already_closed')
    expect(code(await selfCancel({ projectId: P, managementToken: 'bad', target: REF, sessions: [] }, makeDeps(makeStore().store)))).toBe('not_found')
  })
})

describe('absenceNotice', () => {
  const run = (st: ReturnType<typeof makeStore>) => absenceNotice({ projectId: P, managementToken: tok, target: REF, session: session('2026-11-20T10:00:00Z') }, makeDeps(st.store))
  it('disabled -> refused', async () => expect(code(await run(makeStore()))).toBe('absence_notice_disabled'))
  it('releases the place only when releasePlace', async () => {
    const keep = makeStore({ settings: settings({ absenceNotice: { enabled: true, releasePlace: false, outcome: 'none' } }) })
    expect(await run(keep)).toMatchObject({ ok: true, value: { placeReleased: false } })
    expect(keep.called('release')).toHaveLength(0)
    const free = makeStore({ settings: settings({ absenceNotice: { enabled: true, releasePlace: true, outcome: 'credit' } }) })
    expect(await run(free)).toMatchObject({ ok: true, value: { placeReleased: true, outcome: 'credit' } })
    expect(free.called('release')[0].args.slice(2)[0]).toBe('absence')
    expect((free.called('release')[0].args[3] as { occurrenceIds: string[] }).occurrenceIds).toEqual([O1])
  })
})

describe('organiserCancelSession', () => {
  const aff = (over: Partial<AffectedBooking>): AffectedBooking => ({
    bookingId: 'b1', name: 'Anna Rossi', email: 'anna@example.test', locale: 'it', passId: null, totalCents: 3001, paymentStatus: 'paid', sessionCount: 3, ...over,
  })
  const affected = [aff({}), aff({ bookingId: 'b2', passId: 'pass1', email: 'luca@example.test' }), aff({ bookingId: 'b3', email: null }), aff({ bookingId: 'b4', paymentStatus: 'unpaid' })]
  const run = (st: ReturnType<typeof makeStore>, env: Partial<Parameters<typeof makeDeps>[1]> = {}) =>
    organiserCancelSession({ projectId: P, session: session('2026-11-20T10:00:00Z'), target: REF }, makeDeps(st.store, env))

  it('releases every allocation of the session, returns the list and sends NOTHING', async () => {
    const s = makeStore({ affected })
    const r = await run(s)
    if (!r.ok) throw new Error(r.code)
    expect(s.called('release')).toHaveLength(4)
    for (const c of s.called('release')) {
      expect(c.args[2]).toBe('organiser_cancelled')
      expect(c.args[3]).toMatchObject({ occurrenceIds: [O1], cancelBooking: false })
    }
    expect(r.value.affected.map((a) => a.bookingId)).toEqual(['b1', 'b2', 'b3', 'b4'])
    expect(r.value.affected.every((a) => a.outcome === 'notify_only')).toBe(true)
    expect(r.value.intents.map((i) => i.bookingId)).toEqual(['b1', 'b2', 'b4'])
    expect(s.called('enqueueOutbox')).toHaveLength(0)
    expect(s.outbox).toHaveLength(0)
  })
  it('intent shape and dedupe key; confirmation queues them', async () => {
    const s = makeStore({ affected })
    const r = await run(s)
    if (!r.ok) throw new Error(r.code)
    expect(r.value.intents[0].intent).toMatchObject({ intent: 'session.cancelled', dedupeKey: `session.cancelled:${O1}:b1` })
    expect(await sendSessionCancelledNotices(r.value, P, makeDeps(s.store))).toMatchObject({ ok: true, value: { queued: 3 } })
    expect(s.outbox).toHaveLength(3)
  })
  it('credit / proportional refund apply to paid non-pass bookings; pass holders stay notify_only', async () => {
    const prop = makeStore({ affected, settings: settings({ organiserCancelOutcome: 'proportional_refund' }) })
    const r = await run(prop)
    if (!r.ok) throw new Error(r.code)
    const by = Object.fromEntries(r.value.affected.map((a) => [a.bookingId, a]))
    expect(by.b1).toMatchObject({ outcome: 'refund_review', suggestedRefundCents: 1000 }) // floor(3001/3)
    expect(by.b2).toMatchObject({ outcome: 'notify_only', isPassHolder: true, suggestedRefundCents: null })
    expect(by.b4).toMatchObject({ outcome: 'notify_only' })
    const cred = await run(makeStore({ affected, settings: settings({ organiserCancelOutcome: 'credit' }) }))
    expect(cred.ok && cred.value.affected[0].outcome).toBe('credit')
  })
  it('a failing release is reported, the others continue; test recipient outside production', async () => {
    const s = makeStore({ affected: [aff({}), aff({ bookingId: 'b9' })] })
    let n = 0
    s.store.release = (async () => (++n === 1 ? { ok: false, error: { kind: 'not_found', code: 'booking_not_found' } } : { ok: true, value: { released: 1, cancelled: false } })) as never
    const r = await run(s, { environment: 'preview', testRecipient: 'tom@example.test' })
    if (!r.ok) throw new Error(r.code)
    expect(r.value.failures).toEqual([{ bookingId: 'b1', code: 'booking_not_found' }])
    expect(r.value.affected.map((a) => a.bookingId)).toEqual(['b9'])
    expect(r.value.intents[0].intent.recipients).toEqual([{ email: 'tom@example.test', name: null }])
  })
})

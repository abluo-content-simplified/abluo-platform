import { describe, expect, it } from 'vitest'
import { prepareChangeNotice, sendChangeNotice, firstNameOf } from '../change-notice'
import { runSweep } from '../sweep'
import { bookingRow, makeDeps, makeStore, O1, P } from './fake-store'

const recipients = [
  { bookingId: 'b1', name: 'Anna Maria Rossi', email: 'anna@example.test', locale: 'it' },
  { bookingId: 'b2', name: 'John Smith', email: 'john@example.test', locale: 'en-GB' },
  { bookingId: 'b2', name: 'John Smith', email: 'john@example.test', locale: 'en-GB' },
  { bookingId: 'b3', name: 'No Mail', email: null, locale: 'it' },
  { bookingId: 'b4', name: 'Hans', email: 'hans@example.test', locale: 'de' },
]
const MSG = { it: { subject: 'Cambio orario', body: 'Ciao {firstName}, la lezione cambia. {firstName}!' }, en: { subject: 'Time change', body: 'Hi {firstName}, it changes.' } }

describe('change notice', () => {
  it('prepare lists unique people with an email and a count; sends nothing', async () => {
    const s = makeStore({ recipients })
    const r = await prepareChangeNotice({ projectId: P, scope: { kind: 'session', occurrenceIds: [O1] } }, makeDeps(s.store))
    if (!r.ok) throw new Error(r.code)
    expect(r.value.count).toBe(3)
    expect(r.value.recipients.map((x) => x.bookingId)).toEqual(['b1', 'b2', 'b4'])
    expect(r.value.noticeId).toMatch(/^[0-9a-f]{16}$/)
    expect(s.called('enqueueOutbox')).toHaveLength(0)
  })
  it('send: one personalised intent per person, locale fallback, dedupe includes the notice id', async () => {
    const s = makeStore({ recipients })
    const d = makeDeps(s.store)
    const p = await prepareChangeNotice({ projectId: P, scope: { kind: 'target', targetId: 't' } }, d)
    if (!p.ok) throw new Error(p.code)
    const r = await sendChangeNotice(p.value, MSG, 'en', d)
    expect(r).toMatchObject({ ok: true, value: { queued: 3, skipped: [] } })
    const [a, b, c] = s.outbox.map((o) => o.intent)
    expect(a).toMatchObject({ intent: 'change.notice', dedupeKey: `change.notice:${p.value.noticeId}:b1`, locale: 'it', recipients: [{ email: 'anna@example.test' }] })
    expect(a.payload).toMatchObject({ subject: 'Cambio orario', body: 'Ciao Anna, la lezione cambia. Anna!', firstName: 'Anna' })
    expect(b.payload).toMatchObject({ body: 'Hi John, it changes.' })   // en-GB -> en
    expect(c.payload).toMatchObject({ body: 'Hi Hans, it changes.' })   // de -> fallback en
    expect(new Set(s.outbox.map((o) => o.intent.dedupeKey)).size).toBe(3)
  })
  it('two notices about the same change have different dedupe keys', async () => {
    const s = makeStore({ recipients: [recipients[0]] })
    const d = makeDeps(s.store)
    const a = await prepareChangeNotice({ projectId: P, scope: { kind: 'target', targetId: 't' } }, d)
    const b = await prepareChangeNotice({ projectId: P, scope: { kind: 'target', targetId: 't' } }, d)
    if (!a.ok || !b.ok) throw new Error('x')
    expect(a.value.noticeId).not.toBe(b.value.noticeId)
  })
  it('skips people without a matching message; refuses an empty message; replacement is literal', async () => {
    const s = makeStore({ recipients })
    const d = makeDeps(s.store)
    const p = await prepareChangeNotice({ projectId: P, scope: { kind: 'target', targetId: 't' } }, d)
    if (!p.ok) throw new Error(p.code)
    const r = await sendChangeNotice(p.value, { it: MSG.it }, 'fr', d)
    expect(r).toMatchObject({ ok: true, value: { queued: 1, skipped: [{ bookingId: 'b2' }, { bookingId: 'b4' }] } })
    expect(await sendChangeNotice(p.value, { it: { subject: ' ', body: 'x' } }, 'it', d)).toEqual({ ok: false, code: 'message_required' })
    expect(await sendChangeNotice(p.value, {}, 'it', d)).toEqual({ ok: false, code: 'message_required' })
    expect(firstNameOf("  $& Zed ")).toBe('$&')
  })
  it('outside production the notice goes to the test recipient', async () => {
    const s = makeStore({ recipients: [recipients[0]] })
    const d = makeDeps(s.store, { environment: 'development', testRecipient: 'tom@example.test' })
    const p = await prepareChangeNotice({ projectId: P, scope: { kind: 'target', targetId: 't' } }, d)
    if (!p.ok) throw new Error(p.code)
    await sendChangeNotice(p.value, MSG, 'en', d)
    expect(s.outbox[0].intent.recipients).toEqual([{ email: 'tom@example.test', name: null }])
  })
})

describe('runSweep', () => {
  it('expires holds then queues booking.expired per booking', async () => {
    const s = makeStore({ expired: [{ bookingId: 'b1', projectId: P }, { bookingId: 'b2', projectId: P }] })
    const r = await runSweep(makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { expired: 2, queued: 2, failures: 0 } })
    expect(s.calls[0].fn).toBe('expireHolds')
    expect(s.calls[0].args[0]).toEqual(new Date('2026-11-07T10:00:00Z'))
    expect(s.outbox[0]).toMatchObject({ bookingId: 'b1', intent: { intent: 'booking.expired', dedupeKey: 'booking.expired:b1' } })
  })
  it('skips bookings without an email or anonymised; nothing expired -> nothing queued', async () => {
    const none = makeStore({ expired: [], bookingById: bookingRow() })
    expect(await runSweep(makeDeps(none.store))).toMatchObject({ value: { expired: 0, queued: 0 } })
    const noMail = makeStore({ expired: [{ bookingId: 'b1', projectId: P }], bookingById: bookingRow({ purchaserEmail: null }) })
    expect(await runSweep(makeDeps(noMail.store))).toMatchObject({ value: { expired: 1, queued: 0 } })
    const anon = makeStore({ expired: [{ bookingId: 'b1', projectId: P }], bookingById: bookingRow({ anonymisedAt: '2026-01-01T00:00:00Z' }) })
    expect(await runSweep(makeDeps(anon.store))).toMatchObject({ value: { queued: 0 } })
  })
  it('a store failure is a code, and non-production mail is redirected', async () => {
    const s = makeStore()
    s.store.expireHolds = (async () => ({ ok: false, error: { kind: 'unavailable' } })) as never
    expect(await runSweep(makeDeps(s.store))).toEqual({ ok: false, code: 'unavailable' })
    const t = makeStore({ expired: [{ bookingId: 'b1', projectId: P }] })
    await runSweep(makeDeps(t.store, { environment: 'preview' }))
    expect(t.outbox[0].intent).toMatchObject({ recipients: [], payload: { skip: 'non_production_no_test_recipient' } })
  })
})

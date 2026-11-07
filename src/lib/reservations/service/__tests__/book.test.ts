import { describe, expect, it } from 'vitest'
import { createBooking, type CreateBookingInput } from '../book'
import { buildBookPayload } from '../../server/payload'
import { REFERENCE_ALPHABET } from '../../reference'
import { conflict, hash, makeDeps, makeStore, NOW, O1, O2, OPT, option, refused, settings, target, TZ, REF, P } from './fake-store'
import { ok } from '../../server/errors'

const SESSIONS = [
  { occurrenceId: O1, startsAt: '2026-11-20T17:00:00Z', ownerType: 'course' as const, ownerPublicId: 'c-yoga' },
  { occurrenceId: O2, startsAt: '2026-11-27T17:00:00Z', ownerType: 'course' as const, ownerPublicId: 'c-yoga' },
]
const input = (over: Partial<CreateBookingInput> = {}): CreateBookingInput => ({
  projectId: P, projectSlug: 'cyce', timeZone: TZ, target: REF, optionId: OPT, locale: 'it', source: 'website',
  idempotencyKey: 'idem-12345678', purchaser: { name: 'Anna Rossi', email: 'anna@example.test' },
  attendees: [{ key: 'a0', name: 'Anna Rossi' }], sessions: SESSIONS, ...over,
})
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code)
const bank = settings({ acceptBankTransfer: true, holdDays: 5 })

describe('createBooking', () => {
  it('a priced booking without bank transfer is refused; free is confirmed', async () => {
    const s = makeStore()
    expect(code(await createBooking(input(), makeDeps(s.store)))).toBe('payment_method_not_available')
    expect(s.called('book')).toHaveLength(0)
    const f = makeStore({ options: [option({ prices: [{ id: 'p', optionId: OPT, priceCategoryId: null, amountCents: 0, currency: 'EUR', validFrom: null }] })] })
    const r = await createBooking(input(), makeDeps(f.store))
    expect(r).toMatchObject({ ok: true, value: { status: 'confirmed', totalCents: 0, holdExpiresAt: null } })
    expect(f.outbox).toHaveLength(0)
    expect((f.called('book')[0].args[1] as { outbox: Array<{ intent: string }> }).outbox[0].intent).toBe('booking.confirmed')
  })

  it('bank transfer: awaiting_payment, hold = earliest of days / close / first session - cutoff, lines add up', async () => {
    const s = makeStore({ settings: bank })
    const r = await createBooking(input(), makeDeps(s.store))
    if (!r.ok) throw new Error(r.code)
    expect(r.value.status).toBe('awaiting_payment')
    expect(r.value.totalCents).toBe(4000)
    expect(r.value.holdExpiresAt).toBe('2026-11-12T10:00:00.000Z') // 5 days
    const req = s.called('book')[0].args[1] as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(req.lines).toEqual([expect.objectContaining({ quantity: 2, unitCents: 2000, amountCents: 4000 })])
    expect(req.sessions).toHaveLength(2)
    expect(buildBookPayload(req as never, NOW).ok).toBe(true)
  })

  it('hold boundaries: registration closing wins, closing exactly now is refused', async () => {
    const closing = makeStore({ settings: bank, target: target({ closesAt: '2026-11-09T10:00:00Z' }) })
    const r = await createBooking(input(), makeDeps(closing.store))
    expect(r).toMatchObject({ ok: true, value: { holdExpiresAt: '2026-11-09T10:00:00.000Z' } })
    const nearSession = makeStore({ settings: bank })
    const soon = [{ ...SESSIONS[0], startsAt: '2026-11-08T10:00:00Z' }]  // 24 h away, cutoff 24 h => expiry == now
    expect(code(await createBooking(input({ sessions: soon }), makeDeps(nearSession.store)))).toBe('hold_window_closed')
    const later = [{ ...SESSIONS[0], startsAt: '2026-11-08T10:00:01Z' }]
    expect(code(await createBooking(input({ sessions: later }), makeDeps(makeStore({ settings: bank }).store)))).toBe('ok')
  })

  it('retries on reference_taken up to 5 times, then gives up', async () => {
    const s = makeStore({ settings: bank, book: (n, p) => (n < 3 ? conflict('reference_taken') : ok({ bookingId: 'bk', reference: String(p.reference), replayed: false })) })
    const r = await createBooking(input(), makeDeps(s.store))
    expect(r.ok).toBe(true)
    const refs = s.called('book').map((c) => (c.args[1] as { reference: string }).reference)
    expect(refs).toHaveLength(3)
    expect(new Set(refs).size).toBe(3)
    for (const ref of refs) expect(ref).toMatch(new RegExp(`^CYCE-[${REFERENCE_ALPHABET}]{5}$`))
    const bad = makeStore({ settings: bank, book: () => conflict('reference_taken') })
    expect(code(await createBooking(input(), makeDeps(bad.store)))).toBe('reference_unavailable')
    expect(bad.called('book')).toHaveLength(5)
  })

  it('reference prefix: settings first, project slug as fallback, invalid -> code', async () => {
    const a = makeStore({ settings: settings({ acceptBankTransfer: true }, null) })
    await createBooking(input({ projectSlug: 'my-club' }), makeDeps(a.store))
    expect((a.called('book')[0].args[1] as { reference: string }).reference.startsWith('MYCLUB-')).toBe(true)
    const b = makeStore({ settings: settings({ acceptBankTransfer: true }, null) })
    expect(code(await createBooking(input({ projectSlug: undefined }), makeDeps(b.store)))).toBe('invalid_project_code')
  })

  it('hashes only: management token and per-pass tokens; clear tokens returned once', async () => {
    const po = option({ kind: 'pass', passValidity: 'duration', passDurationMonths: 12, prices: [{ id: 'p', optionId: OPT, priceCategoryId: null, amountCents: 0, currency: 'EUR', validFrom: null }] })
    const s = makeStore({ options: [po] })
    const r = await createBooking(input({ sessions: [], attendees: [{ key: 'a0', name: 'A' }, { key: 'a1', name: 'B' }] }), makeDeps(s.store))
    if (!r.ok) throw new Error(r.code)
    expect(r.value.managementToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(r.value.passTokens).toHaveLength(2)
    expect(r.value.passTokens[0].token).not.toBe(r.value.passTokens[1].token)
    const req = s.called('book')[0].args[1] as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(req.managementTokenHash).toBe(hash(r.value.managementToken!))
    expect(req.passes.map((p: { tokenHash: string }) => p.tokenHash)).toEqual(r.value.passTokens.map((t) => hash(t.token)))
    expect(req.passes[0]).toMatchObject({ validFrom: '2026-11-07', validTo: '2027-11-06', optionId: OPT })
    expect(Object.keys(req.passes[0])).not.toContain('scope')
    expect(JSON.stringify({ ...req, outbox: undefined })).not.toContain(r.value.managementToken!)
    expect(buildBookPayload(req as never, NOW).ok).toBe(true)
  })

  it('a replay returns no tokens (the first call had them)', async () => {
    const s = makeStore({ book: (_n, p) => ok({ bookingId: 'bk', reference: String(p.reference), replayed: true }), options: [option({ prices: [{ id: 'p', optionId: OPT, priceCategoryId: null, amountCents: 0, currency: 'EUR', validFrom: null }] })] })
    const r = await createBooking(input(), makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { replayed: true, managementToken: null, passTokens: [] } })
  })

  it('outbox: dedupe key from the idempotency key; production keeps the recipient', async () => {
    const s = makeStore({ settings: bank })
    await createBooking(input(), makeDeps(s.store))
    const ob = (s.called('book')[0].args[1] as { outbox: Array<Record<string, any>> }).outbox[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ob).toMatchObject({ intent: 'booking.awaiting_payment', dedupeKey: 'booking.awaiting_payment:idem-12345678', environment: 'production', recipients: [{ email: 'anna@example.test' }] })
  })

  it('outside production recipients become the test recipient, or the intent is marked skipped', async () => {
    const a = makeStore({ settings: bank })
    await createBooking(input(), makeDeps(a.store, { environment: 'preview', testRecipient: 'tom@example.test' }))
    const oa = (a.called('book')[0].args[1] as { outbox: Array<Record<string, any>> }).outbox[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(oa).toMatchObject({ environment: 'preview', recipients: [{ email: 'tom@example.test' }], payload: { testRedirect: true } })
    expect(JSON.stringify(oa)).not.toContain('anna@example.test')
    const b = makeStore({ settings: bank })
    await createBooking(input(), makeDeps(b.store, { environment: 'development' }))
    const ob = (b.called('book')[0].args[1] as { outbox: Array<Record<string, any>> }).outbox[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ob).toMatchObject({ recipients: [], payload: { skip: 'non_production_no_test_recipient' } })
    expect(JSON.stringify(ob)).not.toContain('anna@example.test')
  })

  it('validates kind vs sessions, option sessions, registration, age, guardian, membership', async () => {
    const d = (s: ReturnType<typeof makeStore>) => makeDeps(s.store)
    const free = [{ id: 'p', optionId: OPT, priceCategoryId: null, amountCents: 0, currency: 'EUR' as const, validFrom: null }]
    expect(code(await createBooking(input({ sessions: [] }), d(makeStore({ options: [option({ prices: free })] }))))).toBe('sessions_required')
    expect(code(await createBooking(input(), d(makeStore({ options: [option({ kind: 'pass', passValidity: 'duration', passDurationMonths: 1, prices: free })] }))))).toBe('option_kind_mismatch')
    expect(code(await createBooking(input(), d(makeStore({ options: [option({ kind: 'drop_in', prices: free })] }))))).toBe('option_kind_mismatch')
    expect(code(await createBooking(input(), d(makeStore({ options: [option({ sessionIds: [O1], prices: free })] }))))).toBe('session_not_in_option')
    expect(code(await createBooking(input(), d(makeStore({ options: [option({ status: 'archived', prices: free })] }))))).toBe('option_not_available')
    expect(code(await createBooking(input(), d(makeStore({ target: target({ registrationStatus: 'closed' }) }))))).toBe('registration_closed')
    expect(code(await createBooking(input(), d(makeStore({ target: target({ opensAt: '2026-11-08T00:00:00Z' }) }))))).toBe('registration_not_open')
    expect(code(await createBooking(input({ sessions: [{ ...SESSIONS[0], startsAt: '2026-11-07T09:00:00Z' }] }), d(makeStore({ options: [option({ prices: free })] }))))).toBe('session_started')
    const aged = makeStore({ options: [option({ prices: free, minAge: 18 })] })
    expect(code(await createBooking(input({ attendees: [{ key: 'a0', age: 12, isMinor: true, guardian: { name: 'M' } }] }), d(aged)))).toBe('age_out_of_range')
    expect(code(await createBooking(input({ attendees: [{ key: 'a0' }] }), d(aged)))).toBe('age_required')
    const kids = makeStore({ options: [option({ prices: free, maxAge: 17 })] })
    expect(code(await createBooking(input({ attendees: [{ key: 'a0', age: 12, isMinor: true }] }), d(kids)))).toBe('guardian_required')
    expect(code(await createBooking(input({ attendees: [{ key: 'a0', age: 12, isMinor: true, guardian: { name: 'M' } }] }), d(kids)))).toBe('ok')
    expect(code(await createBooking(input({ attendees: [] }), d(makeStore())))).toBe('attendees_required')
  })

  it('membership price: declaration required, then eligibility_review is flagged', async () => {
    const mo = option({ prices: [{ id: 'p', optionId: OPT, priceCategoryId: 'member', amountCents: 0, currency: 'EUR', validFrom: null }] })
    const cats = [{ id: 'member', requiresMembership: true }]
    const s = makeStore({ options: [mo] })
    expect(code(await createBooking(input({ priceCategories: cats, attendees: [{ key: 'a0', priceCategoryId: 'member' }] }), makeDeps(s.store)))).toBe('membership_declaration_required')
    const r = await createBooking(input({ priceCategories: cats, attendees: [{ key: 'a0', priceCategoryId: 'member', declaredEligible: true }] }), makeDeps(s.store))
    expect(r.ok).toBe(true)
    const req = s.called('book')[0].args[1] as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(req.flags).toMatchObject({ eligibilityReview: true })
    expect(req.attendees[0]).toMatchObject({ declaredEligible: true, eligibilityResult: 'pending' })
  })

  it('surfaces full sessions and store refusals as codes', async () => {
    const s = makeStore({ settings: bank, book: () => ({ ok: false as const, error: { kind: 'full' as const, occurrenceIds: [O1] } }) })
    expect(await createBooking(input(), makeDeps(s.store))).toEqual({ ok: false, code: 'full', occurrenceIds: [O1] })
    const r = makeStore({ settings: bank, book: () => refused('session_not_bookable') })
    expect(code(await createBooking(input(), makeDeps(r.store)))).toBe('session_not_bookable')
  })

  it('dashboard may book over capacity; a website request cannot', async () => {
    const a = makeStore({ settings: bank })
    await createBooking(input({ allowOverCapacity: true }), makeDeps(a.store))
    expect((a.called('book')[0].args[1] as { allowOverCapacity: boolean }).allowOverCapacity).toBe(false)
    const b = makeStore({ settings: bank })
    await createBooking(input({ source: 'dashboard', allowOverCapacity: true }), makeDeps(b.store))
    expect((b.called('book')[0].args[1] as { allowOverCapacity: boolean }).allowOverCapacity).toBe(true)
  })
})

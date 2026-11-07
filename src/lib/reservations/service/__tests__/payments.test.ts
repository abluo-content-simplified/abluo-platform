import { describe, expect, it } from 'vitest'
import { recordPayment, type RecordPaymentInput } from '../payments'
import { ok } from '../../server/errors'
import { bookingRow, makeDeps, makeStore, P, REF, settings } from './fake-store'

const base = (over: Partial<RecordPaymentInput> = {}): RecordPaymentInput => ({
  projectId: P, bookingId: 'b1', target: REF, method: 'bank_transfer', amountCents: 2000, paidOn: '2026-11-07', reference: 'CRO123', ...over,
})
const BANK = settings({ acceptBankTransfer: true })
const code = (r: { ok: boolean; code?: string }) => (r.ok ? 'ok' : r.code)

describe('recordPayment', () => {
  it('validates amount, method and date before any call', async () => {
    const s = makeStore({ settings: BANK })
    const d = makeDeps(s.store)
    for (const a of [0, -5, 10.5, Number.NaN]) expect(code(await recordPayment(base({ amountCents: a }), d))).toBe('invalid_amount')
    expect(code(await recordPayment(base({ method: 'stripe' as never }), d))).toBe('invalid_method')
    expect(code(await recordPayment(base({ paidOn: '7/11/2026' }), d))).toBe('invalid_date')
    expect(s.calls).toHaveLength(0)
  })
  it('bank transfer only if accepted; cash is always fine', async () => {
    const s = makeStore()
    expect(code(await recordPayment(base(), makeDeps(s.store)))).toBe('payment_method_not_available')
    expect(s.called('recordPayment')).toHaveLength(0)
    expect(code(await recordPayment(base({ method: 'cash' }), makeDeps(s.store)))).toBe('ok')
  })
  it('maps a confirmation and queues the confirmed email once', async () => {
    const s = makeStore({ settings: BANK })
    const r = await recordPayment(base(), makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { paymentId: 'pay1', paymentStatus: 'paid', confirmed: true, paymentReview: false } })
    expect(s.outbox[0].intent).toMatchObject({ intent: 'booking.confirmed', dedupeKey: 'booking.confirmed:b1:payment' })
  })
  it('lapsed holds that no longer fit -> payment_review, nothing queued', async () => {
    const s = makeStore({ settings: BANK, recordPayment: ok({ paymentId: 'pay2', paymentStatus: 'paid', confirm: { confirmed: false, replayed: false, full: ['o1'] } }) })
    const r = await recordPayment(base(), makeDeps(s.store))
    expect(r).toMatchObject({ ok: true, value: { confirmed: false, paymentReview: true, fullOccurrenceIds: ['o1'] } })
    expect(s.outbox).toHaveLength(0)
  })
  it('partial payment: no confirm block, no review', async () => {
    const s = makeStore({ settings: BANK, recordPayment: ok({ paymentId: 'pay3', paymentStatus: 'partially_paid', confirm: null }) })
    expect(await recordPayment(base({ amountCents: 500 }), makeDeps(s.store))).toMatchObject({ ok: true, value: { confirmed: false, paymentReview: false, paymentStatus: 'partially_paid' } })
  })
  it('a replayed confirmation queues nothing; non-production mail goes to the test recipient', async () => {
    const r = makeStore({ settings: BANK, recordPayment: ok({ paymentId: 'p', paymentStatus: 'paid', confirm: { confirmed: true, replayed: true, full: [] } }) })
    await recordPayment(base(), makeDeps(r.store))
    expect(r.outbox).toHaveLength(0)
    const t = makeStore({ settings: BANK, bookingById: bookingRow() })
    await recordPayment(base(), makeDeps(t.store, { environment: 'preview', testRecipient: 'tom@example.test' }))
    expect(t.outbox[0].intent.recipients).toEqual([{ email: 'tom@example.test', name: null }])
  })
})

import { describe, expect, it } from 'vitest'
import { buildBookPayload, type BookingRequest } from '../payload'

const NOW = new Date('2026-11-07T10:00:00Z')
const T = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222221'
const O2 = '22222222-2222-4222-8222-222222222222'

const base = (over: Partial<BookingRequest> = {}): BookingRequest => ({
  targetId: T,
  optionId: null,
  attendees: [{ key: 'a0', name: 'Ada', email: 'ada@example.test' }],
  sessions: [{ attendeeKey: 'a0', occurrenceId: O1 }, { attendeeKey: 'a0', occurrenceId: O2 }],
  lines: [{ attendeeKey: 'a0', kind: 'item', label: { en: 'Term' }, quantity: 2, unitCents: 1500, amountCents: 3000 }],
  totalCents: 3000,
  status: 'confirmed',
  idempotencyKey: 'idem-12345678',
  reference: 'CYCE-7K2MQ',
  locale: 'en',
  source: 'website',
  ...over,
})
const code = (r: ReturnType<typeof buildBookPayload>) => (r.ok ? 'ok' : r.error.kind === 'refused' ? r.error.code : r.error.kind)

describe('buildBookPayload', () => {
  it('builds the exact snake_case payload reservations_book reads', () => {
    const r = buildBookPayload(base({ purchaser: { name: 'Ada', email: 'ada@example.test' } }), NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(r.value).toMatchObject({
      target_id: T, option_id: null, idempotency_key: 'idem-12345678', reference: 'CYCE-7K2MQ', status: 'confirmed',
      locale: 'en', source: 'website', total_cents: 3000, hold_expires_at: null, allow_over_capacity: false,
      purchaser: { name: 'Ada', email: 'ada@example.test', phone: null, consent: null },
      flags: { payment_review: false, eligibility_review: false },
      actor: { kind: 'participant', id: null },
      attendees: [{ key: 'a0', name: 'Ada', email: 'ada@example.test', is_minor: false, guardian: null }],
      allocations: [{ attendee_key: 'a0', occurrence_id: O1 }, { attendee_key: 'a0', occurrence_id: O2 }],
      passes: [], outbox: [],
      lines: [{ attendee_key: 'a0', kind: 'item', label: { en: 'Term' }, quantity: 2, unit_cents: 1500, amount_cents: 3000 }],
    })
  })
  it('rejects total != sum(lines)', () => {
    expect(code(buildBookPayload(base({ totalCents: 2999 }), NOW))).toBe('total_mismatch')
    expect(code(buildBookPayload(base({ lines: [], totalCents: 100 }), NOW))).toBe('total_mismatch')
  })
  it('free booking with no lines is fine', () => {
    expect(code(buildBookPayload(base({ lines: [], totalCents: 0 }), NOW))).toBe('ok')
  })
  it('adjustments may be negative and still sum', () => {
    const r = buildBookPayload(base({
      lines: [
        { kind: 'item', label: {}, unitCents: 3000, amountCents: 3000 },
        { kind: 'adjustment', label: {}, unitCents: -500, amountCents: -500 },
      ], totalCents: 2500,
    }), NOW)
    expect(r.ok).toBe(true)
  })
  it('rejects non-integer cents and line arithmetic errors', () => {
    expect(code(buildBookPayload(base({ totalCents: 30.5 }), NOW))).toBe('invalid_cents')
    expect(code(buildBookPayload(base({ lines: [{ kind: 'item', label: {}, quantity: 2, unitCents: 1500, amountCents: 2999 }], totalCents: 2999 }), NOW))).toBe('line_mismatch')
  })
  it('hold statuses need a future expiry, and only then emit one', () => {
    expect(code(buildBookPayload(base({ status: 'awaiting_payment' }), NOW))).toBe('hold_expiry_required')
    expect(code(buildBookPayload(base({ status: 'held', holdExpiresAt: '2026-11-07T09:00:00Z' }), NOW))).toBe('hold_expiry_required')
    const ok = buildBookPayload(base({ status: 'awaiting_payment', holdExpiresAt: new Date('2026-11-14T10:00:00Z') }), NOW)
    expect(ok.ok && ok.value.hold_expires_at).toBe('2026-11-14T10:00:00.000Z')
    const conf = buildBookPayload(base({ holdExpiresAt: '2026-11-14T10:00:00Z' }), NOW)
    expect(conf.ok && conf.value.hold_expires_at).toBeNull()
  })
  it('validates structure', () => {
    expect(code(buildBookPayload(base({ idempotencyKey: 'short' }), NOW))).toBe('idempotency_key_required')
    expect(code(buildBookPayload(base({ reference: 'bad' }), NOW))).toBe('invalid_reference')
    expect(code(buildBookPayload(base({ locale: 'English' }), NOW))).toBe('invalid_locale')
    expect(code(buildBookPayload(base({ attendees: [] }), NOW))).toBe('attendees_required')
    expect(code(buildBookPayload(base({ sessions: [] }), NOW))).toBe('nothing_to_book')
    expect(code(buildBookPayload(base({ sessions: [{ attendeeKey: 'zz', occurrenceId: O1 }] }), NOW))).toBe('attendee_key_invalid')
    expect(code(buildBookPayload(base({ sessions: [{ attendeeKey: 'a0', occurrenceId: O1 }, { attendeeKey: 'a0', occurrenceId: O1 }] }), NOW))).toBe('duplicate_allocation')
    expect(code(buildBookPayload(base({ attendees: [{ key: 'a0' }, { key: 'a0' }] }), NOW))).toBe('attendee_key_invalid')
    expect(code(buildBookPayload(base({ attendees: [{ key: 'a0', isMinor: true }] }), NOW))).toBe('guardian_required')
    expect(code(buildBookPayload(base({ managementTokenHash: 'abc' }), NOW))).toBe('invalid_token_hash')
    expect(code(buildBookPayload(base({ allowOverCapacity: true }), NOW))).toBe('over_capacity_dashboard_only')
    expect(code(buildBookPayload(base({ allowOverCapacity: true, source: 'dashboard' }), NOW))).toBe('ok')
  })
  it('sends only option, window and token hash for passes (the database copies scope / entries)', () => {
    const r = buildBookPayload(base({
      sessions: [],
      passes: [
        { attendeeKey: 'a0', optionId: O1, validFrom: '2026-11-01', validTo: '2027-06-30', tokenHash: 'a'.repeat(64) },
        { attendeeKey: 'a0', optionId: O1, validFrom: '2026-11-01', validTo: '2027-06-30' },
      ],
    }), NOW)
    if (!r.ok) throw new Error('expected ok')
    const passes = r.value.passes as Array<Record<string, unknown>>
    expect(passes[0]).toEqual({ attendee_key: 'a0', option_id: O1, valid_from: '2026-11-01', valid_to: '2027-06-30', management_token_hash: 'a'.repeat(64) })
    expect(passes[1].management_token_hash).toBeNull()
    expect(Object.keys(passes[0])).not.toContain('scope')
    expect(Object.keys(passes[0])).not.toContain('entries_total')
    expect(code(buildBookPayload(base({ sessions: [], passes: [{ attendeeKey: 'a0', optionId: O1, validFrom: '2027-02-01', validTo: '2027-01-01' }] }), NOW))).toBe('invalid_pass_window')
    expect(code(buildBookPayload(base({ sessions: [], passes: [{ attendeeKey: 'zz', optionId: O1, validFrom: '2027-01-01', validTo: '2027-02-01' }] }), NOW))).toBe('attendee_key_invalid')
  })
  it("refuses a 'pending' status and never sends contact_id", () => {
    expect(code(buildBookPayload(base({ status: 'pending' as never }), NOW))).toBe('invalid_status')
    const r = buildBookPayload(base(), NOW)
    expect(r.ok && 'contact_id' in r.value).toBe(false)
  })
  it('enforces amount = quantity x unit for every item line', () => {
    expect(code(buildBookPayload(base({ lines: [{ kind: 'item', label: {}, quantity: 3, unitCents: 1000, amountCents: 3000 }], totalCents: 3000 }), NOW))).toBe('ok')
    expect(code(buildBookPayload(base({ lines: [{ kind: 'item', label: {}, unitCents: 1000, amountCents: 3000 }], totalCents: 3000 }), NOW))).toBe('line_mismatch')
  })
})

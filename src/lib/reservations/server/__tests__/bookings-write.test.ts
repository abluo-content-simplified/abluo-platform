import { describe, expect, it } from 'vitest'
import { createBookingsWriteStore } from '../bookings-write'
import { fakeDb, opsOf, type Call } from './fake-db'

const P = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222221'

function dbFor(over: { attendees?: unknown[]; left?: unknown[]; flag?: unknown[]; booking?: unknown[] } = {}) {
  let attendeeCalls = 0
  return fakeDb((c: Call) => {
    if (c.kind === 'rpc') return {}
    if (c.table === 'bookings') return { data: c.ops.some(([n]) => n === 'update') ? over.flag ?? [{ id: B }] : over.booking ?? [{ id: B, status: 'confirmed' }] }
    if (c.table === 'booking_attendees') {
      // The first call is the update, the second the "still pending?" read. Ops are recorded as they are chained.
      attendeeCalls++
      return { data: attendeeCalls === 1 ? over.attendees ?? [{ id: 'a1' }] : over.left ?? [] }
    }
    return {}
  })
}

describe('verifyEligibility', () => {
  it('verifies the pending attendees of THIS project\'s booking, clears the flag, logs it', async () => {
    const { db, calls } = dbFor()
    const r = await createBookingsWriteStore(db).verifyEligibility(P, B, { kind: 'user', id: 'u1' })
    expect(r).toEqual({ ok: true, value: { verified: 1, reviewCleared: true } })
    for (const c of calls) if (c.kind === 'from') expect(opsOf(c, 'eq').some(([k, v]) => k === 'project_id' && v === P), c.table).toBe(true)
    const log = calls.find((c) => c.kind === 'rpc') as Extract<Call, { kind: 'rpc' }>
    expect(log.fn).toBe('reservations_log')
    expect(log.args).toMatchObject({ p_project_id: P, p_booking_id: B, p_action: 'booking.eligibility_verified', p_actor: { kind: 'user', id: 'u1' } })
  })
  it('keeps the flag while someone is still pending', async () => {
    const { db, calls } = dbFor({ left: [{ id: 'a2' }] })
    const r = await createBookingsWriteStore(db).verifyEligibility(P, B)
    expect(r).toEqual({ ok: true, value: { verified: 1, reviewCleared: false } })
    expect(calls.filter((c) => c.kind === 'from' && c.table === 'bookings' && c.ops.some(([n]) => n === 'update'))).toHaveLength(0)
  })
  it('a booking of another project (or a bad id) is not found, nothing written', async () => {
    const empty = dbFor({ booking: [] })
    expect(await createBookingsWriteStore(empty.db).verifyEligibility(P, B)).toEqual({ ok: false, error: { kind: 'not_found', code: 'booking_not_found' } })
    expect(empty.calls.some((c) => c.kind === 'from' && c.ops.some(([n]) => n === 'update'))).toBe(false)
    const bad = dbFor()
    expect(await createBookingsWriteStore(bad.db).verifyEligibility(P, 'x')).toMatchObject({ ok: false })
    expect(bad.calls).toHaveLength(0)
  })
  it('a database without 066 is unavailable', async () => {
    const { db } = fakeDb({ error: { code: '42P01', message: 'missing' } })
    expect(await createBookingsWriteStore(db).verifyEligibility(P, B)).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})

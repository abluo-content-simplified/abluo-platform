/** GET /api/cron/reservations-sweep — CRON_SECRET bearer, unavailable = 200 skipped, never a 500 for 066 missing. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sweep = vi.fn()
vi.mock('@/lib/reservations/notifications/run.server', () => ({ runReservationsSweep: (...a: unknown[]) => sweep(...a) }))

const get = async (auth?: string) => {
  const { GET } = await import('../route')
  return GET(new Request('http://localhost/api/cron/reservations-sweep', { headers: auth ? { authorization: auth } : {} }) as never)
}

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret-for-tests'
  sweep.mockReset().mockResolvedValue({ holds: { expired: 1, queued: 1, failures: 0 }, outbox: { unavailable: false, due: 2, outcomes: { delivered: 2 } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/cron/reservations-sweep', () => {
  it('401 without a bearer, with a wrong one, and when CRON_SECRET is unset; nothing runs', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('Bearer nope')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await get('Bearer undefined')).status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })
  it('runs the sweep with the right secret and returns the counts', async () => {
    const res = await get('Bearer cron-secret-for-tests')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, holds: { expired: 1 }, outbox: { due: 2 } })
  })
  it('migration 066 not applied: 200 with skipped, not a 500', async () => {
    sweep.mockResolvedValue({ skipped: 'reservations unavailable' })
    const res = await get('Bearer cron-secret-for-tests')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'reservations unavailable' })
  })
  it('500 only for an unexpected throw, without leaking the message', async () => {
    sweep.mockRejectedValue(new Error('secret detail'))
    const res = await get('Bearer cron-secret-for-tests')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
  })
})

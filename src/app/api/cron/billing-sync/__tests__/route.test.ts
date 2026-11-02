/** GET /api/cron/billing-sync — CRON_SECRET bearer, not-configured skip, result passthrough. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let configured = true
const reconcile = vi.fn()
vi.mock('@/lib/billing/stripe/client', () => ({ getStripe: () => (configured ? {} : null) }))
vi.mock('@/lib/billing/stripe/store', () => ({ createSupabaseStore: () => ({}), stripeApi: () => ({}) }))
vi.mock('@/lib/billing/stripe/sync', () => ({ reconcileBilling: (...a: unknown[]) => reconcile(...a) }))
vi.mock('@/lib/access/environment', () => ({ resolveAccessEnvironment: () => 'production' }))

const get = async (auth?: string) => {
  const { GET } = await import('../route')
  return GET(new Request('http://localhost/api/cron/billing-sync', { headers: auth ? { authorization: auth } : {} }) as never)
}

beforeEach(() => {
  configured = true
  process.env.CRON_SECRET = 'cron-secret-for-tests'
  reconcile.mockReset().mockResolvedValue({ subscriptions: { checked: 1, synced: 1, ignored: 0, failed: 0 }, events: { retried: 0, processed: 0, ignored: 0, failed: 0 } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/cron/billing-sync', () => {
  it('401 without a bearer, with a wrong one, and when CRON_SECRET is unset', async () => {
    expect((await get()).status).toBe(401)
    expect((await get('Bearer nope')).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await get('Bearer undefined')).status).toBe(401)
    expect(reconcile).not.toHaveBeenCalled()
  })
  it('runs the reconcile for the production (live) mode with the right secret', async () => {
    const res = await get('Bearer cron-secret-for-tests')
    expect(res.status).toBe(200)
    expect(reconcile.mock.calls[0][0]).toMatchObject({ livemode: true })
    expect(await res.json()).toMatchObject({ ok: true, subscriptions: { checked: 1 } })
  })
  it('skips quietly when billing is not configured', async () => {
    configured = false
    expect(await (await get('Bearer cron-secret-for-tests')).json()).toMatchObject({ ok: true, skipped: 'billing not configured' })
    expect(reconcile).not.toHaveBeenCalled()
  })
  it('500 when the reconcile throws', async () => {
    reconcile.mockRejectedValue(new Error('x'))
    expect((await get('Bearer cron-secret-for-tests')).status).toBe(500)
  })
})

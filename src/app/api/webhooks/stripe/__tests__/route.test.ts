/** POST /api/webhooks/stripe — signature check on the raw body, status codes, duplicate handling. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'

const SECRET = 'whsec_testsecret0123456789'
const real = new Stripe('rk_test_unit', { apiVersion: '2026-10-28.endive' as never })
let configured = true
const ingest = vi.fn()
vi.mock('@/lib/billing/stripe/client', () => ({ getStripe: () => (configured ? real : null), stripeWebhookSecret: () => (configured ? SECRET : null) }))
vi.mock('@/lib/billing/stripe/store', () => ({ createSupabaseStore: () => ({}), stripeApi: () => ({}) }))
vi.mock('@/lib/billing/stripe/sync', () => ({ ingestEvent: (...a: unknown[]) => ingest(...a) }))
vi.mock('@/lib/access/environment', () => ({ resolveAccessEnvironment: () => 'development' }))

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'evt_TESTAAAA1', object: 'event', type: 'invoice.paid', created: 1_700_000_000, livemode: false, data: { object: { id: 'in_AAAAAA1' } }, ...over })
const signed = (body: string, secret = SECRET) => real.webhooks.generateTestHeaderString({ payload: body, secret })
const post = async (body: string, headers: Record<string, string> = {}) => {
  const { POST } = await import('../route')
  return POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body, headers }) as never)
}

beforeEach(() => {
  configured = true
  ingest.mockReset().mockResolvedValue('processed')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/webhooks/stripe', () => {
  it('400 without a signature header', async () => {
    expect((await post(payload())).status).toBe(400)
    expect(ingest).not.toHaveBeenCalled()
  })
  it('400 on a wrong signature', async () => {
    const body = payload()
    expect((await post(body, { 'stripe-signature': signed(body, 'whsec_somebodyelse0123456') })).status).toBe(400)
    expect(ingest).not.toHaveBeenCalled()
  })
  it('400 when the body was altered after signing (verified on the raw body)', async () => {
    const header = signed(payload())
    expect((await post(payload({ livemode: true }), { 'stripe-signature': header })).status).toBe(400)
  })
  it('200 and ingest for a valid signature', async () => {
    const body = payload()
    const res = await post(body, { 'stripe-signature': signed(body) })
    expect(res.status).toBe(200)
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(ingest.mock.calls[0][1]).toMatchObject({ id: 'evt_TESTAAAA1', type: 'invoice.paid' })
    expect(ingest.mock.calls[0][0]).toMatchObject({ livemode: false })
  })
  it('200 for a duplicate delivery', async () => {
    ingest.mockResolvedValue('duplicate')
    const body = payload()
    const res = await post(body, { 'stripe-signature': signed(body) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ result: 'duplicate' })
  })
  it('500 when processing failed, so Stripe retries', async () => {
    ingest.mockResolvedValue('failed')
    const body = payload()
    expect((await post(body, { 'stripe-signature': signed(body) })).status).toBe(500)
  })
  it('500 when the ledger itself is unavailable', async () => {
    ingest.mockRejectedValue(new Error('db down'))
    const body = payload()
    expect((await post(body, { 'stripe-signature': signed(body) })).status).toBe(500)
  })
  it('200 without processing an event of the other mode', async () => {
    const body = payload({ livemode: true })
    const res = await post(body, { 'stripe-signature': signed(body) })
    expect(res.status).toBe(200)
    expect(ingest).not.toHaveBeenCalled()
  })
  it('503 when billing is not configured here', async () => {
    configured = false
    expect((await post(payload(), { 'stripe-signature': 'x' })).status).toBe(503)
  })
})

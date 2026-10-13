/**
 * POST /api/webhooks/sanity-content-activity — only a correctly signed Sanity
 * delivery reaches the recorder; nothing else touches the log or Sanity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recordStudioChange } = vi.hoisted(() => ({ recordStudioChange: vi.fn(async (..._args: unknown[]) => ({ status: 204, result: 'recorded' })) }))
vi.mock('@/lib/lifecycle/studio-activity', () => ({ recordStudioChange }))
vi.mock('@/lib/lifecycle/activity-store', () => ({ createSupabaseActivityStore: () => ({}) }))
vi.mock('@/lib/sanity/history', () => ({ transactionOf: vi.fn(), dashboardSanityIdentity: vi.fn() }))

import { signWebhook } from '@/lib/connections/api/removals'
import { POST } from '@/app/api/webhooks/sanity-content-activity/route'

const SECRET = 'whsec_test_content_activity'
const body = JSON.stringify({ documentId: 'post-1', type: 'post' })
const post = (headers: Record<string, string>, b = body) =>
  POST(new Request('https://dev.abluo.app/api/webhooks/sanity-content-activity', { method: 'POST', body: b, headers }))

describe('sanity-content-activity webhook', () => {
  beforeEach(() => {
    recordStudioChange.mockClear()
    process.env.SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET = SECRET
  })

  it('unconfigured → 503; unsigned or wrongly signed → 401; nothing recorded', async () => {
    delete process.env.SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET
    expect((await post({})).status).toBe(503)
    process.env.SANITY_CONTENT_ACTIVITY_WEBHOOK_SECRET = SECRET
    expect((await post({})).status).toBe(401)
    expect((await post({ 'sanity-webhook-signature': signWebhook(body, 'other-secret', Date.now()) })).status).toBe(401)
    expect(recordStudioChange).not.toHaveBeenCalled()
  })

  it('a signed delivery is recorded with Sanity’s transaction id and time; the recorder decides the status', async () => {
    const r = await post({
      'sanity-webhook-signature': signWebhook(body, SECRET, Date.now()),
      'sanity-transaction-id': 'txn-1',
      'sanity-transaction-time': '2026-10-13T11:59:00Z',
    })
    expect(r.status).toBe(204)
    expect(recordStudioChange).toHaveBeenCalledWith(
      { body: { documentId: 'post-1', type: 'post' }, transactionId: 'txn-1', transactionTime: '2026-10-13T11:59:00Z' },
      expect.anything()
    )
  })

  it('an oversized body is refused before verification', async () => {
    expect((await post({}, 'x'.repeat(10_001))).status).toBe(413)
  })
})

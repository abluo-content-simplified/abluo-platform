import { describe, it, expect, vi, beforeEach } from 'vitest'

const PROJECT = '11111111-1111-4111-8111-111111111111'
let actor: { userId: string } | null = null
vi.mock('../access', () => ({ requireBillingAdmin: async () => actor }))
vi.mock('../queries', () => ({ billingLivemode: () => false }))
const setCancel = vi.fn()
class BillingError extends Error {
  constructor(readonly code: string) { super(code) }
}
vi.mock('@/lib/billing/stripe/service', () => ({ BillingError, setCancelAtPeriodEnd: (...a: unknown[]) => setCancel(...a) }))
const audit = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/lib/admin/audit', () => ({ recordAdminAudit: (...a: unknown[]) => audit(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const action = () => import('../stripe-actions')
beforeEach(() => {
  actor = { userId: 'tom' }
  setCancel.mockReset()
  audit.mockClear()
})

describe('setCancelAtPeriodEndAction', () => {
  it('without billing.admin: forbidden, no Stripe, no audit', async () => {
    actor = null
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: PROJECT, cancel: true })).toEqual({ ok: false, error: 'forbidden' })
    expect(setCancel).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
  it('rejects bad input before Stripe', async () => {
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: 'nope', cancel: true })).toEqual({ ok: false, error: 'notFound' })
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: PROJECT, cancel: 'yes' as never })).toMatchObject({ ok: false, error: 'invalid' })
    expect(setCancel).not.toHaveBeenCalled()
  })
  it('cancels, audits', async () => {
    setCancel.mockResolvedValue(undefined)
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: PROJECT, cancel: true })).toEqual({ ok: true })
    expect(setCancel).toHaveBeenCalledWith(PROJECT, true)
    expect(audit).toHaveBeenCalledWith({ actorId: 'tom', action: 'billing.subscription.cancel_at_period_end', projectId: PROJECT, detail: { livemode: false, cancel: true } })
  })
  it('a Stripe failure is failed, and the attempt is audited as failed (the Stripe change may already have happened)', async () => {
    setCancel.mockRejectedValue(new Error('stripe down'))
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: PROJECT, cancel: false })).toEqual({ ok: false, error: 'failed' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'billing.subscription.cancel_at_period_end',
      detail: expect.objectContaining({ outcome: 'failed', cancel: false }),
    }))
  })
  it('no subscription -> invalid', async () => {
    setCancel.mockRejectedValue(new BillingError('notBilled'))
    expect(await (await action()).setCancelAtPeriodEndAction({ projectId: PROJECT, cancel: true })).toMatchObject({ ok: false, error: 'invalid' })
  })
})

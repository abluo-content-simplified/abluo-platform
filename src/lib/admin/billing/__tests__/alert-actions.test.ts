/** Billing alert actions — permission first, state moves, audit. I/O boundaries faked. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ALERT = '33333333-3333-4333-8333-333333333333'
const PROJECT = '11111111-1111-4111-8111-111111111111'

type Call = { table: string; op: string; payload?: unknown; filters: [string, unknown][] }
let actor: { userId: string } | null = null
const calls: Call[] = []
let row: Record<string, unknown> | null = null

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] }
  const run = async () => {
    calls.push({ ...call })
    return { data: call.op === 'select' ? row : null, error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => (call.filters.push([k, v]), q),
    neq: (k: string, v: unknown) => (call.filters.push([`!${k}`, v]), q),
    update: (p: unknown) => ((call.op = 'update'), (call.payload = p), q),
    maybeSingle: run,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
  }
  return q
}

vi.mock('../access', () => ({ requireBillingAdmin: async () => actor }))
vi.mock('../queries', () => ({ billingLivemode: () => false }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => (calls.push({ table: '-', op: 'createAdminClient', filters: [] }), { from }) }))
const audit = vi.fn(async (...a: unknown[]) => void a)
vi.mock('@/lib/admin/audit', () => ({ recordAdminAudit: (...a: unknown[]) => audit(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const actions = () => import('../alert-actions')
const updates = () => calls.filter((c) => c.op === 'update')
const alertRow = (over: Record<string, unknown> = {}) => ({ id: ALERT, status: 'open', kind: 'dispute', project_id: PROJECT, tenant_id: 't', acknowledged_at: null, ...over })

beforeEach(() => {
  actor = { userId: 'user-tom' }
  calls.length = 0
  audit.mockClear()
  row = alertRow()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('billing alert actions', () => {
  it('refuse without billing.admin — before any I/O', async () => {
    actor = null
    const { acknowledgeBillingAlertAction, resolveBillingAlertAction } = await actions()
    expect(await acknowledgeBillingAlertAction({ alertId: ALERT })).toEqual({ ok: false, error: 'forbidden' })
    expect(await resolveBillingAlertAction({ alertId: ALERT, note: 'done' })).toEqual({ ok: false, error: 'forbidden' })
    expect(calls).toHaveLength(0)
    expect(audit).not.toHaveBeenCalled()
  })
  it('acknowledge: open → acknowledged, audited as billing.alert.ack', async () => {
    const { acknowledgeBillingAlertAction } = await actions()
    expect(await acknowledgeBillingAlertAction({ alertId: ALERT })).toEqual({ ok: true })
    expect(updates()).toHaveLength(1)
    expect(updates()[0].payload).toMatchObject({ status: 'acknowledged', acknowledged_by: 'user-tom' })
    expect(updates()[0].filters).toContainEqual(['status', 'open'])
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-tom', action: 'billing.alert.ack', projectId: PROJECT }))
  })
  it('acknowledging an alert that already moved on changes nothing', async () => {
    row = alertRow({ status: 'acknowledged' })
    const { acknowledgeBillingAlertAction } = await actions()
    expect(await acknowledgeBillingAlertAction({ alertId: ALERT })).toEqual({ ok: true })
    expect(updates()).toHaveLength(0)
  })
  it('resolve needs a note', async () => {
    const { resolveBillingAlertAction } = await actions()
    for (const note of ['', '   ', 'x'.repeat(2001)]) {
      expect(await resolveBillingAlertAction({ alertId: ALERT, note })).toEqual({ ok: false, error: 'invalid', fields: ['note'] })
    }
    expect(updates()).toHaveLength(0)
  })
  it('resolve from open also records the acknowledgement; audited as billing.alert.resolve without the note text', async () => {
    const { resolveBillingAlertAction } = await actions()
    expect(await resolveBillingAlertAction({ alertId: ALERT, note: '  Won the dispute  ' })).toEqual({ ok: true })
    expect(updates()[0].payload).toMatchObject({ status: 'resolved', resolution_note: 'Won the dispute', resolved_by: 'user-tom', acknowledged_by: 'user-tom' })
    const entry = audit.mock.calls[0][0] as { action: string; detail: Record<string, unknown> }
    expect(entry.action).toBe('billing.alert.resolve')
    expect(JSON.stringify(entry.detail)).not.toContain('Won the dispute')
  })
  it('resolve from acknowledged keeps the original acknowledgement', async () => {
    row = alertRow({ status: 'acknowledged', acknowledged_at: '2026-11-01T00:00:00Z' })
    const { resolveBillingAlertAction } = await actions()
    await resolveBillingAlertAction({ alertId: ALERT, note: 'ok' })
    expect(updates()[0].payload).not.toHaveProperty('acknowledged_by')
  })
  it('an unknown or malformed alert is notFound', async () => {
    const { acknowledgeBillingAlertAction, resolveBillingAlertAction } = await actions()
    expect(await acknowledgeBillingAlertAction({ alertId: 'nope' })).toEqual({ ok: false, error: 'notFound' })
    row = null
    expect(await resolveBillingAlertAction({ alertId: ALERT, note: 'x' })).toEqual({ ok: false, error: 'notFound' })
  })
})

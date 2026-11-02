import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyBillingEnforcement, billingEnforcementMode } from '../enforcement'
import type { ProjectBillingStatus } from '../lifecycle'

const locked: ProjectBillingStatus = { state: 'locked', reason: 'manual_overdue', clockStartedAt: new Date(0), day: 20, daysLeft: 8 }
const reminder: ProjectBillingStatus = { state: 'reminder', reason: 'manual_overdue', clockStartedAt: new Date(0), day: 3, daysLeft: 11 }
const ctx = () => ({
  userId: 'u',
  projects: [
    { projectId: 'p1', permissions: ['posts.read', 'posts.write', 'support.tickets.write'] },
    { projectId: 'p2', permissions: ['posts.read', 'posts.write'] },
    { projectId: 'p3', permissions: ['posts.write'] },
  ],
})
const statuses = new Map([['p1', locked], ['p2', reminder]])

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('billingEnforcementMode', () => {
  it('defaults to off and treats unknown values as off', () => {
    expect(billingEnforcementMode()).toBe('off')
    vi.stubEnv('BILLING_ENFORCEMENT', 'yes')
    expect(billingEnforcementMode()).toBe('off')
    vi.stubEnv('BILLING_ENFORCEMENT', 'ON')
    expect(billingEnforcementMode()).toBe('on')
    vi.stubEnv('BILLING_ENFORCEMENT', 'observe')
    expect(billingEnforcementMode()).toBe('observe')
  })
})

describe('applyBillingEnforcement', () => {
  it('off: identical context, no read', async () => {
    const load = vi.fn(async () => statuses)
    const c = ctx()
    expect(await applyBillingEnforcement(c, load, 'off')).toBe(c)
    expect(load).not.toHaveBeenCalled()
  })

  it('observe: permissions identical, billing attached, would-be locks logged', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await applyBillingEnforcement(ctx(), async () => statuses, 'observe')
    expect(out.projects.map((p) => p.permissions)).toEqual(ctx().projects.map((p) => p.permissions))
    expect(out.projects[0]).toMatchObject({ billing: locked })
    expect(out.projects[1]).toMatchObject({ billing: reminder })
    expect(out.projects[2]).not.toHaveProperty('billing')
    expect(info).toHaveBeenCalledTimes(1)
    expect(String(info.mock.calls[0][0])).toContain('p1')
  })

  it('on: locked project stripped to reads + allowlist, others identical', async () => {
    const out = await applyBillingEnforcement(ctx(), async () => statuses, 'on')
    expect(out.projects[0].permissions).toEqual(['posts.read', 'support.tickets.write'])
    expect(out.projects[1].permissions).toEqual(['posts.read', 'posts.write'])
    expect(out.projects[2]).toEqual(ctx().projects[2])
  })

  it('on: support visits are not locked', async () => {
    const c = { ...ctx(), support: { sessionId: 's' } }
    const out = await applyBillingEnforcement(c, async () => statuses, 'on')
    expect(out.projects[0].permissions).toEqual(ctx().projects[0].permissions)
  })

  it('error: fails open, context unchanged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = ctx()
    for (const mode of ['observe', 'on'] as const) {
      expect(await applyBillingEnforcement(c, async () => { throw new Error('db down') }, mode)).toBe(c)
    }
    expect(err).toHaveBeenCalledTimes(2)
  })
})

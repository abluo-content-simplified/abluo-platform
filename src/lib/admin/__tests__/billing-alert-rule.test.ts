import { describe, it, expect } from 'vitest'
import { billingAlertRule, buildAdminAttention } from '../attention'
import { isMissingAlertsTable } from '../billing/alerts'

const projects = [
  { id: 'p1', slug: 'livener', name: 'Livener', status: 'live', createdAt: '2026-01-01T00:00:00Z', ownerCount: 1 },
  { id: 'p2', slug: 'gorow', name: 'GoRow', status: 'live', createdAt: '2026-01-01T00:00:00Z', ownerCount: 1 },
]

describe('billingAlertRule (ADR-041 D15)', () => {
  it('one warn item per project with the open count, linking to its Billing card', () => {
    const items = billingAlertRule([{ id: 'a', projectId: 'p1' }, { id: 'b', projectId: 'p1' }, { id: 'c', projectId: 'p2' }], projects)
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.id === 'billingAlert:p1')).toMatchObject({ severity: 'warn', rule: 'billingAlert', params: { project: 'Livener', count: 2 }, href: '/projects/livener#billing' })
  })
  it('an alert without a known project is grouped and links to the project list', () => {
    expect(billingAlertRule([{ id: 'a', projectId: null }, { id: 'b', projectId: 'gone' }], projects)).toEqual([
      expect.objectContaining({ id: 'billingAlert:unassigned', params: { project: '—', count: 2 }, href: '/projects' }),
    ])
  })
  it('no alerts → no items; sorts before the other billing rules', () => {
    expect(billingAlertRule([], projects)).toEqual([])
    const all = buildAdminAttention({
      projects, invitations: null, requests: null,
      billing: [{ projectId: 'p2', state: 'review', reviewAcknowledged: false, day: 29, reason: null } as never],
      billingAlerts: [{ id: 'a', projectId: 'p1' }],
    })
    expect(all.map((i) => i.rule)).toEqual(['billingAlert', 'billingReview'])
  })
})

describe('isMissingAlertsTable', () => {
  it('recognises "059 not applied" and nothing else', () => {
    expect(isMissingAlertsTable({ code: '42P01', message: 'relation "public.billing_alerts" does not exist' })).toBe(true)
    expect(isMissingAlertsTable({ code: 'PGRST205', message: "Could not find the table 'public.billing_alerts' in the schema cache" })).toBe(true)
    expect(isMissingAlertsTable({ code: '57014', message: 'canceling statement' })).toBe(false)
    expect(isMissingAlertsTable(null)).toBe(false)
  })
})

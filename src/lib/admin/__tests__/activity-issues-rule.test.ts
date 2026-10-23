import { describe, expect, it } from 'vitest'
import { activityIssuesRule, buildAdminAttention } from '../attention'

const NOW = Date.parse('2026-10-13T12:00:00Z')
const projects = [{ id: 'p1', slug: 'tmz', name: 'tmz.it' }]

describe('activityIssues attention rule (ADR-032 D9 A4)', () => {
  it('one warning per project, counting each kind within 7 days', () => {
    const items = activityIssuesRule(
      [
        { projectId: 'p1', kind: 'unattributed', occurredAt: '2026-10-12T09:00:00Z' },
        { projectId: 'p1', kind: 'reconciled', occurredAt: '2026-10-12T09:00:00Z' },
        { projectId: 'p1', kind: 'failed', occurredAt: '2026-10-11T09:00:00Z' },
        { projectId: 'p1', kind: 'failed', occurredAt: '2026-09-01T09:00:00Z' }, // too old
        { projectId: 'gone', kind: 'failed', occurredAt: '2026-10-12T09:00:00Z' }, // unknown project
      ],
      projects,
      NOW
    )
    expect(items).toEqual([
      expect.objectContaining({ id: 'activityIssues:p1', severity: 'warn', titleKey: 'attention.activityIssues.title', href: '/projects/tmz', params: { project: 'tmz.it', unattributed: 1, reconciled: 1, failed: 1, days: 7 } }),
    ])
  })
  it('no item when a project only has unattributed / reconciled records', () => {
    const items = activityIssuesRule(
      [
        { projectId: 'p1', kind: 'unattributed', occurredAt: '2026-10-12T09:00:00Z' },
        { projectId: 'p1', kind: 'reconciled', occurredAt: '2026-10-12T09:00:00Z' },
      ],
      projects,
      NOW
    )
    expect(items).toEqual([])
  })
  it('a failure older than 7 days alone does not raise an item', () => {
    expect(activityIssuesRule([{ projectId: 'p1', kind: 'failed', occurredAt: '2026-09-01T09:00:00Z' }], projects, NOW)).toEqual([])
  })
  it('joins the Home list right after "no owner"', () => {
    const all = buildAdminAttention(
      { projects: [{ id: 'p1', slug: 'tmz', name: 'tmz.it', status: 'live', createdAt: '2026-01-01T00:00:00Z', ownerCount: 0 }], invitations: [], requests: [], activityIssues: [{ projectId: 'p1', kind: 'failed', occurredAt: '2026-10-12T09:00:00Z' }] },
      NOW
    )
    expect(all.map((i) => i.rule)).toEqual(['noOwner', 'activityIssues'])
  })
})

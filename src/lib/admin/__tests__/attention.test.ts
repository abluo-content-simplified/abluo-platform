import { describe, expect, it } from 'vitest'
import {
  adminProjectHref,
  buildAdminAttention,
  invitationRules,
  longPreviewRule,
  noOwnerRule,
  pendingInvitationCount,
  requestsWaitingRule,
  sortAdminAttention,
  unansweredRequestCounts,
  type AttentionProject,
} from '../attention'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const at = (hours: number) => new Date(NOW + hours * 3600_000).toISOString()
const DAY = 24

const project = (over: Partial<AttentionProject> & { id: string }): AttentionProject => ({
  slug: over.id,
  name: over.id.toUpperCase(),
  status: 'active',
  createdAt: at(-100 * DAY),
  ownerCount: 1,
  ...over,
})

describe('admin attention rules', () => {
  it('flags projects with no Owner, except retired ones', () => {
    const items = noOwnerRule([project({ id: 'a', ownerCount: 0 }), project({ id: 'b' }), project({ id: 'c', ownerCount: 0, status: 'inactive' })])
    expect(items.map((i) => i.id)).toEqual(['noOwner:a'])
    expect(items[0]).toMatchObject({ severity: 'warn', href: '/projects/a', titleKey: 'attention.noOwner.title', params: { project: 'A' } })
  })

  it('flags previews older than 14 days since creation', () => {
    const items = longPreviewRule(
      [project({ id: 'old', status: 'preview', createdAt: at(-20 * DAY) }), project({ id: 'new', status: 'preview', createdAt: at(-14 * DAY) }), project({ id: 'live' })],
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'longPreview:old', severity: 'info', params: { days: 20 } })
  })

  it('flags invitations expiring within 3 days and recently expired ones', () => {
    const target = { slug: 'p', name: 'P' }
    const items = invitationRules(
      [
        { id: '1', email: 'soon@x.it', expiresAt: at(2 * DAY), target },
        { id: '2', email: 'later@x.it', expiresAt: at(4 * DAY), target },
        { id: '3', email: 'gone@x.it', expiresAt: at(-5 * DAY), target: null },
        { id: '4', email: 'ancient@x.it', expiresAt: at(-40 * DAY), target },
        { id: '5', email: 'bad@x.it', expiresAt: 'nope', target },
      ],
      NOW,
    )
    expect(items.map((i) => i.id)).toEqual(['invitationExpiring:1', 'invitationExpired:3'])
    expect(items[0]).toMatchObject({ severity: 'info', href: '/projects/p', params: { email: 'soon@x.it', project: 'P', days: 2 } })
    expect(items[1]).toMatchObject({ severity: 'warn', href: '/projects', params: { project: '—', days: 5 } })
  })

  it('groups requests unanswered for over 2 days per project', () => {
    const projects = [project({ id: 'a' }), project({ id: 'b' })]
    const items = requestsWaitingRule(
      [
        { projectId: 'a', createdAt: at(-3 * DAY) },
        { projectId: 'a', createdAt: at(-5 * DAY) },
        { projectId: 'a', createdAt: at(-1 * DAY) },
        { projectId: 'b', createdAt: at(-47) },
        { projectId: 'gone', createdAt: at(-9 * DAY) },
      ],
      projects,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'requestsWaiting:a', severity: 'warn', href: adminProjectHref('a'), params: { count: 2, days: 5, project: 'A' } })
  })

  it('sorts warn before info, then by rule, and builds everything at once', () => {
    const items = buildAdminAttention(
      {
        projects: [project({ id: 'p', status: 'preview', createdAt: at(-30 * DAY), ownerCount: 0 })],
        invitations: [{ id: 'i', email: 'e@x.it', expiresAt: at(DAY), target: null }],
        requests: [{ projectId: 'p', createdAt: at(-3 * DAY) }],
      },
      NOW,
    )
    expect(items.map((i) => i.rule)).toEqual(['noOwner', 'requestsWaiting', 'invitationExpiring', 'longPreview'])
    expect(sortAdminAttention([...items].reverse()).map((i) => i.id)).toEqual(items.map((i) => i.id))
    // Missing sources simply contribute nothing.
    expect(buildAdminAttention({ projects: [], invitations: null, requests: null }, NOW)).toEqual([])
  })

  it('counts unanswered requests and pending invitations', () => {
    expect(unansweredRequestCounts([{ createdAt: at(-1 * DAY) }, { createdAt: at(-8 * DAY) }], NOW)).toEqual({ total: 2, week: 1 })
    expect(pendingInvitationCount([{ expiresAt: at(1) }, { expiresAt: at(-1) }], NOW)).toBe(1)
  })
})

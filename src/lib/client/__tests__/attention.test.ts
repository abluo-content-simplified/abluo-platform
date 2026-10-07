import { describe, expect, it } from 'vitest'
import {
  allowedAttentionRules,
  ATTENTION_MAX_SHOWN,
  invitationRules,
  missingAltTextRule,
  missingLanguageRule,
  newRequestsRule,
  scheduledSoonRule,
  SCHEDULED_SOON_HOURS,
  sortAttention,
  splitAttention,
  STALE_DRAFT_DAYS,
  staleDraftsRule,
  type AttentionItem,
} from '../attention'
import { grantPermissions } from '@/lib/api/tenant-context'

const NOW = Date.parse('2026-10-07T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()
const daysAgo = (d: number) => hoursAgo(d * 24)
const hoursAhead = (h: number) => new Date(NOW + h * 3600_000).toISOString()

describe('attention rules', () => {
  it('new requests: counts only status new; warns once one has waited over 48 h', () => {
    expect(newRequestsRule([{ status: 'processed', createdAt: hoursAgo(1) }], '/x', NOW)).toBeNull()
    const fresh = newRequestsRule([{ status: 'new', createdAt: hoursAgo(2) }, { status: 'archived', createdAt: hoursAgo(1) }], '/x', NOW)
    expect(fresh).toMatchObject({ severity: 'info', titleKey: 'attention.newRequests.title', params: { count: 1 }, href: '/x' })
    const old = newRequestsRule([{ status: 'new', createdAt: hoursAgo(2) }, { status: 'new', createdAt: hoursAgo(49) }], '/x', NOW)
    expect(old).toMatchObject({ severity: 'warn', titleKey: 'attention.newRequestsWaiting.title', params: { count: 2, days: 2 } })
  })

  it('stale drafts: only drafts untouched for the threshold, naming the oldest', () => {
    const drafts = [
      { updatedAt: daysAgo(STALE_DRAFT_DAYS - 1), title: 'Recent' },
      { updatedAt: daysAgo(STALE_DRAFT_DAYS), title: 'Two weeks' },
      { updatedAt: daysAgo(40), title: 'Ancient' },
      { updatedAt: 'bad', title: 'No date' },
    ]
    expect(staleDraftsRule('post', drafts, '/p', NOW)).toMatchObject({ id: 'stalePostDrafts', params: { count: 2, title: 'Ancient', days: STALE_DRAFT_DAYS } })
    expect(staleDraftsRule('gallery', drafts.slice(0, 1), '/g', NOW)).toBeNull()
    expect(staleDraftsRule('gallery', drafts, '/g', NOW)?.titleKey).toBe('attention.staleGalleryDrafts.title')
  })

  it('scheduled soon: future posts within the window, soonest first', () => {
    const posts = [
      { status: 'scheduled', publishedAt: hoursAhead(SCHEDULED_SOON_HOURS + 1), title: 'Later' },
      { status: 'scheduled', publishedAt: hoursAhead(30), title: 'Second' },
      { status: 'scheduled', publishedAt: hoursAhead(5), title: 'First' },
      { status: 'scheduled', publishedAt: hoursAgo(1), title: 'Past' },
      { status: 'published', publishedAt: hoursAhead(2), title: 'Not scheduled' },
    ]
    const item = scheduledSoonRule(posts, '/s', (iso) => `at ${iso}`, NOW)
    expect(item).toMatchObject({ params: { count: 2, title: 'First', when: `at ${hoursAhead(5)}` } })
    expect(scheduledSoonRule(posts.slice(0, 1), '/s', () => '', NOW)).toBeNull()
  })

  it('missing language: only published posts, only on multilingual sites', () => {
    const posts = [
      { status: 'published', completeLanguages: ['en', 'it'], title: 'Full' },
      { status: 'published', completeLanguages: ['en'], title: 'Half' },
      { status: 'draft', completeLanguages: [], title: 'Draft' },
    ]
    expect(missingLanguageRule(posts, ['en', 'it'], '/m')).toMatchObject({ params: { count: 1, title: 'Half' } })
    expect(missingLanguageRule(posts, ['en'], '/m')).toBeNull()
    expect(missingLanguageRule(posts, [], '/m')).toBeNull()
  })

  it('missing alt text and invitations', () => {
    expect(missingAltTextRule(0, '/media')).toBeNull()
    expect(missingAltTextRule(3, '/media')?.params).toEqual({ count: 3 })
    const inv = invitationRules([{ status: 'invited' }, { status: 'invited' }, { status: 'expired' }, { status: 'active' }], '/people')
    expect(inv.map((i) => [i.id, i.severity, i.params.count])).toEqual([
      ['expiredInvites', 'warn', 1],
      ['pendingInvites', 'info', 2],
    ])
    expect(invitationRules([{ status: 'active' }], '/people')).toEqual([])
  })
})

describe('ordering and overflow', () => {
  const item = (id: string, severity: 'info' | 'warn'): AttentionItem => ({ id, severity, titleKey: '', detailKey: '', actionKey: '', params: {}, href: '/' })

  it('warn first, otherwise stable; nulls dropped', () => {
    expect(sortAttention([item('a', 'info'), null, item('b', 'warn'), item('c', 'info'), item('d', 'warn')]).map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('shows the maximum and counts the rest, never "1 more"', () => {
    const many = Array.from({ length: ATTENTION_MAX_SHOWN + 3 }, (_, n) => n)
    expect(splitAttention(many)).toEqual({ shown: many.slice(0, ATTENTION_MAX_SHOWN), more: 3 })
    const oneOver = many.slice(0, ATTENTION_MAX_SHOWN + 1)
    expect(splitAttention(oneOver)).toEqual({ shown: oneOver, more: 0 })
  })
})

describe('who sees which rule', () => {
  it('follows module + permission, like the surface registry', () => {
    const owner = allowedAttentionRules({ permissions: grantPermissions('owner', ['blog', 'forms', 'gallery']), enabledModuleIds: ['blog', 'forms', 'gallery'] })
    expect([...owner].sort()).toEqual(
      ['missingAltText', 'missingLanguage', 'newRequests', 'pendingInvites', 'scheduledSoon', 'staleGalleryDrafts', 'stalePostDrafts'].sort(),
    )
    const viewerBlog = allowedAttentionRules({ permissions: grantPermissions('viewer', ['blog']), enabledModuleIds: ['blog'] })
    expect(viewerBlog.has('stalePostDrafts')).toBe(false)
    expect(viewerBlog.has('pendingInvites')).toBe(false)
    expect(allowedAttentionRules({ permissions: ['blog.post.write'], enabledModuleIds: [] }).size).toBe(0)
  })
})

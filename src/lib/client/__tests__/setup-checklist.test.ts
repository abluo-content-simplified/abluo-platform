import { describe, expect, it } from 'vitest'
import {
  buildSetupChecklist,
  setupFactsWanted,
  teamSizeOf,
  type SetupFacts,
} from '@/lib/client/setup-checklist'
import { buildTenantSurfaces, CONFIGURATION_PERMISSIONS, TENANT_SURFACES } from '@/lib/client/surfaces'

const OWNER = {
  permissions: ['blog.post.read', 'blog.post.write', 'media.library.manage', 'users.invite', 'users.manage', 'analytics.read'],
  enabledModuleIds: ['blog'],
}
const EDITOR = { permissions: ['blog.post.read', 'blog.post.write', 'media.library.manage'], enabledModuleIds: ['blog'] }

const NOTHING_DONE: SetupFacts = { publishedPosts: 0, mediaAssets: 0, teamSize: 1, analyticsConnected: false, domainConnected: false }
const ALL_DONE: SetupFacts = { publishedPosts: 3, mediaAssets: 12, teamSize: 2, analyticsConnected: true, domainConnected: true }
const HREFS = { firstPost: '/s/posts', photos: '/s/media/add', team: '/s/people', analytics: '/s/analytics' }

const build = (over: Partial<Parameters<typeof buildSetupChecklist>[0]> = {}) =>
  buildSetupChecklist({ grant: OWNER, facts: NOTHING_DONE, hrefs: HREFS, dismissed: false, ...over })
const ids = (c: ReturnType<typeof build>) => c.items.map((i) => i.id)

describe('setup checklist — which items a person sees', () => {
  it('an Owner with the blog sees all five, in order, with links where they act', () => {
    const c = build()
    expect(ids(c)).toEqual(['firstPost', 'photos', 'team', 'analytics', 'domain'])
    expect(c.items.map((i) => i.href)).toEqual(['/s/posts', '/s/media/add', '/s/people', '/s/analytics', null])
  })

  it('an Editor sees only what they can do: no team, no analytics, no domain', () => {
    expect(ids(build({ grant: EDITOR }))).toEqual(['firstPost', 'photos'])
  })

  it('no blog module → no "first article", even with the permission', () => {
    expect(ids(build({ grant: { ...OWNER, enabledModuleIds: [] } }))).not.toContain('firstPost')
  })

  it('analytics only with analytics.read (an Editor gets it with the extra)', () => {
    expect(ids(build({ grant: { ...EDITOR, permissions: [...EDITOR.permissions, 'analytics.read'] } }))).toContain('analytics')
  })

  it('an item that needs a page is left out when the page is not in the navigation', () => {
    const c = build({ hrefs: { ...HREFS, firstPost: null, photos: undefined, team: null } })
    expect(ids(c)).toEqual(['analytics', 'domain'])
  })

  it('analytics shows without a link (Abluo does it); domain never has one', () => {
    const c = build({ hrefs: { firstPost: '/a', photos: '/b', team: '/c' } })
    expect(c.items.find((i) => i.id === 'analytics')).toEqual({ id: 'analytics', done: false, href: null })
    expect(c.items.find((i) => i.id === 'domain')?.href).toBeNull()
  })

  it('a fact that could not be read leaves its item out (never a false "not done")', () => {
    const c = build({ facts: { publishedPosts: null, mediaAssets: 0, teamSize: null, analyticsConnected: null, domainConnected: false } })
    expect(ids(c)).toEqual(['photos', 'domain'])
  })

  it('no rule ever needs a configuration permission', () => {
    // Indirect: a grant holding every configuration permission and nothing else sees nothing.
    expect(build({ grant: { permissions: [...CONFIGURATION_PERMISSIONS], enabledModuleIds: ['blog'] } }).items).toEqual([])
  })
})

describe('setup checklist — done detection and progress', () => {
  it('nothing done → 0 of 5, visible', () => {
    const c = build()
    expect([c.doneCount, c.total, c.visible]).toEqual([0, 5, true])
    expect(c.items.every((i) => !i.done)).toBe(true)
  })

  it('thresholds: one published post, one photo, two people (incl. pending), data arrived, live on own domain', () => {
    const c = build({ facts: { publishedPosts: 1, mediaAssets: 1, teamSize: 2, analyticsConnected: true, domainConnected: false } })
    expect(c.items.map((i) => [i.id, i.done])).toEqual([
      ['firstPost', true],
      ['photos', true],
      ['team', true],
      ['analytics', true],
      ['domain', false],
    ])
    expect([c.doneCount, c.total, c.visible]).toEqual([4, 5, true])
  })

  it('a team of one (just you) is not done', () => {
    expect(build({ facts: { ...NOTHING_DONE, teamSize: 1 } }).items.find((i) => i.id === 'team')?.done).toBe(false)
  })

  it('everything done → the card disappears', () => {
    const c = build({ facts: ALL_DONE })
    expect([c.doneCount, c.total, c.visible]).toEqual([5, 5, false])
  })

  it('progress counts only the items this person sees', () => {
    const c = build({ grant: EDITOR, facts: { ...NOTHING_DONE, publishedPosts: 1 } })
    expect([c.doneCount, c.total, c.visible]).toEqual([1, 2, true])
  })

  it('hidden by the person → not visible, items still derived', () => {
    const c = build({ dismissed: true })
    expect(c.visible).toBe(false)
    expect(c.total).toBe(5)
  })

  it('no items at all → not visible', () => {
    expect(build({ grant: { permissions: [], enabledModuleIds: [] } }).visible).toBe(false)
  })
})

describe('setup checklist — helpers', () => {
  it('setupFactsWanted lists only the items the grant may see (Home skips the other reads)', () => {
    expect([...setupFactsWanted(EDITOR)]).toEqual(['firstPost', 'photos'])
    expect([...setupFactsWanted(OWNER)]).toEqual(['firstPost', 'photos', 'team', 'analytics', 'domain'])
  })

  it('teamSizeOf counts active people and pending invitations, not expired or archived', () => {
    expect(teamSizeOf([{ status: 'active' }, { status: 'invited' }, { status: 'expired' }, { status: 'archived' }])).toBe(2)
    expect(teamSizeOf([])).toBe(0)
  })

  it('the Home widget is registered and reaches every role that can act on an item', () => {
    expect(TENANT_SURFACES.some((s) => s.kind === 'widget' && s.id === 'setupChecklist')).toBe(true)
    expect(buildTenantSurfaces(EDITOR).widgets.map((w) => w.id)).toContain('setupChecklist')
    expect(buildTenantSurfaces({ permissions: ['blog.post.read'], enabledModuleIds: ['blog'] }).widgets.map((w) => w.id)).not.toContain(
      'setupChecklist',
    )
  })
})

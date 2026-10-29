/**
 * buildClientNavItems / resolveProjectGrant — the pure, Next.js-safe projection
 * of MODULE_REGISTRY into client-dashboard navigation (ADR-017 Phase 2 / task
 * #81). No I/O, no live request.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  buildClientNavItems,
  resolveProjectGrant,
  MODULE_DASHBOARD_ROUTES,
  MEDIA_SEGMENT,
  PEOPLE_SEGMENT,
  segmentOf,
  isNavItemActive,
  phoneNavLayout,
  formatBadgeCount,
} from '../client-navigation'
import type { ProjectGrant } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

function grantWith(enabledModuleIds: string[], permissions: string[] = []): ProjectGrant {
  return {
    projectId: 'project-a1',
    // `ProjectGrant.projectSlug` is `projects.slug`, and the client-dashboard
    // URL segment is built from it — so the href below is `/livener/...`.
    // (Sanity's separate `/livener-main/` name is gone: RENAME.md Step 4.)
    projectSlug: asSupabaseProjectSlug('livener'),
    membershipId: 'pm-1',
    role: 'editor',
    permissions,
    enabledModuleIds,
  }
}

describe('buildClientNavItems', () => {
  // Support (Tom, 2026-10-22) is listed for everyone on the project; the gating tests below look past it.
  const navWithoutSupport = (grant: Parameters<typeof buildClientNavItems>[0]) =>
    buildClientNavItems(grant).filter((i) => i.moduleId !== 'support')

  it('always lists Support, in the support & configuration group', () => {
    expect(buildClientNavItems(grantWith([], []))).toEqual([
      { moduleId: 'support', labelKey: 'clientDashboard.nav.support', href: '/livener/support', group: 'support' },
    ])
  })

  it('yields a Blog nav item ONLY when the module is installed AND blog.post.read is held', () => {
    const items = navWithoutSupport(grantWith(['blog'], ['blog.post.read']))
    // Posts also brings Categories & Tags (ADR-033 Amendment J), which the same permission opens.
    expect(items.filter((i) => i.moduleId !== 'taxonomy')).toEqual([{ moduleId: 'blog', labelKey: 'clientDashboard.nav.blog', href: '/livener/posts', group: 'publish' }])
  })

  it('yields NO Blog item when the module is not installed, even with the permission', () => {
    expect(navWithoutSupport(grantWith([], ['blog.post.read']))).toEqual([])
  })

  it('yields NO Blog item when the module is installed but the permission is missing', () => {
    expect(navWithoutSupport(grantWith(['blog'], []))).toEqual([])
  })

  it('gates Forms on forms.submission.read and Galleries on gallery.gallery.read', () => {
    const mods = ['forms', 'gallery']
    expect(navWithoutSupport(grantWith(mods, [])).map((i) => i.moduleId)).toEqual([])
    expect(navWithoutSupport(grantWith(mods, ['forms.submission.read'])).map((i) => i.moduleId)).toEqual(['forms'])
    expect(navWithoutSupport(grantWith(mods, ['gallery.gallery.read'])).map((i) => i.moduleId)).toEqual(['gallery', 'taxonomy']) // Categories & Tags: the galleries' internal tags
  })

  it('skips an enabled module that has no client-dashboard surface (events)', () => {
    expect(navWithoutSupport(grantWith(['events'], ['forms.submission.read']))).toEqual([])
  })

  it('shows Media on the permission alone (no module) and People on invite OR manage', () => {
    expect(navWithoutSupport(grantWith([], ['media.library.manage'])).map((i) => i.moduleId)).toEqual(['media', 'taxonomy']) // Categories & Tags: the media's internal tags
    expect(navWithoutSupport(grantWith([], ['users.invite'])).map((i) => i.moduleId)).toEqual(['people'])
    expect(navWithoutSupport(grantWith([], ['users.manage'])).map((i) => i.moduleId)).toEqual(['people'])
  })

  it('modules first in the shared PLAT-3 order (Publish · Show · Visitors), then Media, People, Categories & Tags', () => {
    const all = grantWith(
      ['blog', 'forms', 'gallery'],
      ['blog.post.read', 'forms.submission.read', 'gallery.gallery.read', 'media.library.manage', 'users.invite'],
    )
    expect(navWithoutSupport(all).map((i) => i.moduleId)).toEqual(['blog', 'gallery', 'forms', 'media', 'people', 'taxonomy'])
  })

  it('builds the href from the grant projectSlug + the registry segment', () => {
    const grant = { ...grantWith(['blog'], ['blog.post.read']), projectSlug: asSupabaseProjectSlug('studiomartegani') }
    const [item] = buildClientNavItems(grant)
    expect(item.href).toBe(`/studiomartegani/${MODULE_DASHBOARD_ROUTES.blog}`)
  })

  it('derives the exported segments from the registry', () => {
    expect(MODULE_DASHBOARD_ROUTES).toEqual({ blog: 'posts', events: 'agenda', forms: 'submissions', gallery: 'galleries', faq: 'faq-sets', documents: 'document-library', members: 'access', catalogue: 'catalogue' })
    expect(MEDIA_SEGMENT).toBe('media')
    expect(PEOPLE_SEGMENT).toBe('people')
    expect(segmentOf('blog')).toBe('posts')
    expect(segmentOf('nope')).toBeUndefined()
  })
})

describe('resolveProjectGrant', () => {
  const a = grantWith(['blog'])
  // SUPABASE namespace — a second real `projects.slug`, not a `-main` name.
  const b = { ...grantWith([]), projectId: 'project-b', projectSlug: asSupabaseProjectSlug('nologo') }

  it('returns the matching grant for a granted slug', () => {
    expect(resolveProjectGrant([a, b], 'nologo')).toBe(b)
  })

  it('returns null for a slug the caller has no grant for (no silent substitute)', () => {
    expect(resolveProjectGrant([a, b], 'not-granted')).toBeNull()
  })

  it('returns null for an empty grant set', () => {
    expect(resolveProjectGrant([], 'livener')).toBeNull()
  })

  // ── Migration 023: slugs are unique per TENANT, not globally ───────────────
  // A user who belongs to two tenants that each own a project called `main`
  // reaches `/en/main/posts` — a URL that carries no tenant and therefore
  // cannot say which `main` is meant. Before 023 this could not happen
  // (global unique); after it, it can. The old `.find()` would have returned
  // whichever grant came back first — one customer seeing another customer's
  // dashboard, with no error anywhere.
  describe('ambiguity (migration 023 made slugs unique per tenant, not globally)', () => {
    const mainInTenant1 = {
      ...grantWith(['blog']),
      projectId: 'project-main-t1',
      projectSlug: asSupabaseProjectSlug('main'),
    }
    const mainInTenant2 = {
      ...grantWith(['blog']),
      projectId: 'project-main-t2',
      projectSlug: asSupabaseProjectSlug('main'),
    }

    it('REFUSES rather than guessing when one slug matches two grants', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      // The critical assertion: not "returns the first one", but returns
      // NOTHING. Every caller turns null into notFound()/redirect, so this is
      // a 404 instead of the wrong client's content.
      expect(resolveProjectGrant([mainInTenant1, mainInTenant2], 'main')).toBeNull()
      spy.mockRestore()
    })

    it('names both candidate projects in the error, so the 404 is diagnosable', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      resolveProjectGrant([mainInTenant1, mainInTenant2], 'main')
      const msg = spy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
      expect(msg).toContain('AMBIGUOUS')
      expect(msg).toContain('project-main-t1')
      expect(msg).toContain('project-main-t2')
      spy.mockRestore()
    })

    it('still resolves an unambiguous slug when an ambiguous one is also present', () => {
      // Refusing must be scoped to the colliding slug, not to the whole set —
      // one collision cannot be allowed to break every other project.
      expect(resolveProjectGrant([mainInTenant1, mainInTenant2, b], 'nologo')).toBe(b)
    })
  })
})

describe('phoneNavLayout (Home · Content · Requests · Media · More)', () => {
  const item = (moduleId: string, segment: string, group = 'content') => ({
    moduleId,
    labelKey: `clientDashboard.nav.${moduleId}`,
    href: `/livener/${segment}`,
    group: group as 'content',
  })
  const ids = (xs: { moduleId: string }[]) => xs.map((i) => i.moduleId)
  /** Every item lands in exactly one place: content, requests, media or overflow. */
  const placedOnce = (items: ReturnType<typeof item>[]) => {
    const l = phoneNavLayout(items)
    const placed = ids([...l.content, ...(l.requests ? [l.requests] : []), ...(l.media ? [l.media] : []), ...l.overflow])
    expect([...placed].sort()).toEqual(ids(items).sort())
  }

  const tmz = [
    item('blog', 'posts', 'publish'),
    item('events', 'agenda', 'publish'),
    item('gallery', 'galleries', 'show'),
    item('catalogue', 'catalogue', 'show'),
    item('documents', 'document-library', 'show'),
    item('forms', 'submissions', 'visitors'),
    item('media', 'media'),
    item('people', 'people'),
    item('taxonomy', 'taxonomy'),
    item('analytics', 'analytics', 'activity'),
    item('support', 'support', 'support'),
  ]

  it('tmz-like: Content sheet of five modules, Requests, Media; the rest is More', () => {
    const l = phoneNavLayout(tmz)
    expect(ids(l.content)).toEqual(['blog', 'events', 'gallery', 'catalogue', 'documents'])
    expect(l.requests?.moduleId).toBe('forms')
    expect(l.media?.moduleId).toBe('media')
    expect(ids(l.overflow)).toEqual(['people', 'taxonomy', 'analytics', 'support'])
    placedOnce(tmz)
  })

  it('CYCE-like: Events + FAQ + Documents in the sheet, Requests, Media; Access (members) in More', () => {
    const cyce = [
      item('events', 'agenda', 'publish'),
      item('faq', 'faq-sets', 'publish'),
      item('documents', 'document-library', 'show'),
      item('forms', 'submissions', 'visitors'),
      item('members', 'access', 'visitors'),
      item('media', 'media'),
    ]
    const l = phoneNavLayout(cyce)
    expect(ids(l.content)).toEqual(['events', 'faq', 'documents'])
    expect(l.requests?.moduleId).toBe('forms')
    expect(l.media?.moduleId).toBe('media')
    expect(ids(l.overflow)).toEqual(['members'])
    placedOnce(cyce)
  })

  it('Amélie-like (galleries only, no forms): Content links straight to Galleries, no Requests tab', () => {
    const amelie = [item('gallery', 'galleries', 'show'), item('media', 'media')]
    const l = phoneNavLayout(amelie)
    expect(ids(l.content)).toEqual(['gallery']) // exactly one → the tab links straight to it
    expect(l.requests).toBeNull()
    expect(l.media?.moduleId).toBe('media')
    expect(l.overflow).toEqual([])
    placedOnce(amelie)
  })

  it('no Publish/Show module → no Content tab; Requests only when the person has forms', () => {
    const l = phoneNavLayout([item('media', 'media'), item('people', 'people')])
    expect(l.content).toEqual([])
    expect(l.requests).toBeNull()
    expect(ids(l.overflow)).toEqual(['people'])
    placedOnce([])
  })

  it('keeps menu order inside the Content sheet', () => {
    expect(ids(phoneNavLayout(tmz).content)).toEqual(ids(tmz.filter((i) => ['blog', 'events', 'gallery', 'catalogue', 'documents'].includes(i.moduleId))))
  })
})

describe('formatBadgeCount', () => {
  it('shows 1–99 as is and 99+ from 100', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(99)).toBe('99')
    expect(formatBadgeCount(100)).toBe('99+')
    expect(formatBadgeCount(1234)).toBe('99+')
  })
})

describe('isNavItemActive', () => {
  it('matches the page and its sub-pages only', () => {
    expect(isNavItemActive('/livener/posts', '/livener/posts')).toBe(true)
    expect(isNavItemActive('/livener/posts/abc', '/livener/posts')).toBe(true)
    expect(isNavItemActive('/livener/postsx', '/livener/posts')).toBe(false)
    expect(isNavItemActive('/livener/home', '/livener/posts')).toBe(false)
  })
})

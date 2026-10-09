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
  it('yields a Blog nav item ONLY when the module is installed AND blog.post.read is held', () => {
    const items = buildClientNavItems(grantWith(['blog'], ['blog.post.read']))
    expect(items).toEqual([{ moduleId: 'blog', labelKey: 'clientDashboard.nav.blog', href: '/livener/posts' }])
  })

  it('yields NO Blog item when the module is not installed, even with the permission', () => {
    expect(buildClientNavItems(grantWith([], ['blog.post.read']))).toEqual([])
  })

  it('yields NO Blog item when the module is installed but the permission is missing', () => {
    expect(buildClientNavItems(grantWith(['blog'], []))).toEqual([])
  })

  it('gates Forms on forms.submission.read and Galleries on gallery.gallery.read', () => {
    const mods = ['forms', 'gallery']
    expect(buildClientNavItems(grantWith(mods, [])).map((i) => i.moduleId)).toEqual([])
    expect(buildClientNavItems(grantWith(mods, ['forms.submission.read'])).map((i) => i.moduleId)).toEqual(['forms'])
    expect(buildClientNavItems(grantWith(mods, ['gallery.gallery.read'])).map((i) => i.moduleId)).toEqual(['gallery'])
  })

  it('skips an enabled module that has no client-dashboard surface (events)', () => {
    expect(buildClientNavItems(grantWith(['events'], ['blog.post.read']))).toEqual([])
  })

  it('shows Media on the permission alone (no module) and People on invite OR manage', () => {
    expect(buildClientNavItems(grantWith([], ['media.library.manage'])).map((i) => i.moduleId)).toEqual(['media'])
    expect(buildClientNavItems(grantWith([], ['users.invite'])).map((i) => i.moduleId)).toEqual(['people'])
    expect(buildClientNavItems(grantWith([], ['users.manage'])).map((i) => i.moduleId)).toEqual(['people'])
  })

  it('keeps registry order: modules first, then Media, then People', () => {
    const all = grantWith(
      ['blog', 'forms', 'gallery'],
      ['blog.post.read', 'forms.submission.read', 'gallery.gallery.read', 'media.library.manage', 'users.invite'],
    )
    expect(buildClientNavItems(all).map((i) => i.moduleId)).toEqual(['blog', 'forms', 'gallery', 'media', 'people'])
  })

  it('builds the href from the grant projectSlug + the registry segment', () => {
    const grant = { ...grantWith(['blog'], ['blog.post.read']), projectSlug: asSupabaseProjectSlug('studiomartegani') }
    const [item] = buildClientNavItems(grant)
    expect(item.href).toBe(`/studiomartegani/${MODULE_DASHBOARD_ROUTES.blog}`)
  })

  it('derives the exported segments from the registry', () => {
    expect(MODULE_DASHBOARD_ROUTES).toEqual({ blog: 'posts', events: 'agenda', forms: 'submissions', gallery: 'galleries' })
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

describe('phoneNavLayout', () => {
  const item = (moduleId: string, segment: string) => ({
    moduleId,
    labelKey: `clientDashboard.nav.${moduleId}`,
    href: `/livener/${segment}`,
  })
  const all = [
    item('blog', 'posts'),
    item('forms', 'submissions'),
    item('gallery', 'galleries'),
    item('media', 'media'),
    item('people', 'people'),
  ]

  it('gives Posts and Forms their own tab and sends the rest to More', () => {
    const layout = phoneNavLayout(all)
    expect(layout.content?.moduleId).toBe('blog')
    expect(layout.forms?.moduleId).toBe('forms')
    expect(layout.overflow.map((i) => i.moduleId)).toEqual(['gallery', 'media', 'people'])
  })

  it('puts every item in exactly one place (nothing unreachable on a phone)', () => {
    const layout = phoneNavLayout(all)
    const placed = [layout.content, layout.forms, ...layout.overflow].filter(Boolean)
    expect(placed).toHaveLength(all.length)
  })

  it('leaves the tab empty when the project lacks the module', () => {
    const layout = phoneNavLayout([item('gallery', 'galleries')])
    expect(layout.content).toBeNull()
    expect(layout.forms).toBeNull()
    expect(layout.overflow.map((i) => i.moduleId)).toEqual(['gallery'])
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

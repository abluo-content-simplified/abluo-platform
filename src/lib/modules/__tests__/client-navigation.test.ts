/**
 * buildClientNavItems / resolveProjectGrant — the pure, Next.js-safe projection
 * of MODULE_REGISTRY into client-dashboard navigation (ADR-017 Phase 2 / task
 * #81). No I/O, no live request.
 */
import { describe, it, expect } from 'vitest'
import {
  buildClientNavItems,
  resolveProjectGrant,
  MODULE_DASHBOARD_ROUTES,
} from '../client-navigation'
import type { ProjectGrant } from '@/lib/api/tenant-context'
import type { ModuleManifest } from '../types'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

function grantWith(enabledModuleIds: string[]): ProjectGrant {
  return {
    projectId: 'project-a1',
    // SUPABASE namespace. `ProjectGrant.projectSlug` is `projects.slug`, and
    // the client-dashboard URL segment is built from it — so the href below is
    // `/livener/...`, never Sanity's `/livener-main/...`.
    projectSlug: asSupabaseProjectSlug('livener'),
    membershipId: 'pm-1',
    role: 'editor',
    permissions: [],
    enabledModuleIds,
  }
}

// A minimal fake registry so the test does not depend on the exact live module
// set — blog is mapped to a dashboard route, ghost is not.
const fakeRegistry = [
  { id: 'blog' },
  { id: 'events' },
] as unknown as ModuleManifest[]

describe('buildClientNavItems', () => {
  it('yields a Blog nav item ONLY when the blog module is enabled', () => {
    const items = buildClientNavItems(grantWith(['blog']), fakeRegistry)
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      moduleId: 'blog',
      labelKey: 'clientDashboard.nav.blog',
      href: '/livener/posts',
    })
  })

  it('yields NO Blog nav item when the blog module is not enabled', () => {
    const items = buildClientNavItems(grantWith(['events']), fakeRegistry)
    expect(items.find((i) => i.moduleId === 'blog')).toBeUndefined()
  })

  it('skips an enabled module that has no client-dashboard route mapping', () => {
    // events is enabled but absent from MODULE_DASHBOARD_ROUTES → no item.
    const items = buildClientNavItems(grantWith(['events']), fakeRegistry)
    expect(items).toHaveLength(0)
  })

  it('yields no items when no modules are enabled', () => {
    expect(buildClientNavItems(grantWith([]), fakeRegistry)).toEqual([])
  })

  it('builds the href from the grant projectSlug + the route mapping', () => {
    // SUPABASE namespace (Sanity says `studiomartegani-main`).
    const grant = { ...grantWith(['blog']), projectSlug: asSupabaseProjectSlug('studiomartegani') }
    const [item] = buildClientNavItems(grant, fakeRegistry)
    expect(item.href).toBe(`/studiomartegani/${MODULE_DASHBOARD_ROUTES.blog}`)
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
})

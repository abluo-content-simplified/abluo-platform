/**
 * getDashboardPosts — the first real read path wiring the ADR-017 primitives
 * (ADR-017 slice 6 / ADR-015 close-out). These tests prove the enforcement
 * chain binds at the call site, with an injected fetch — no live Sanity.
 */
import { describe, it, expect, vi } from 'vitest'
import { getDashboardPosts } from '../client-dashboard'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'

function ctxWith(grants: ProjectGrant[]): TenantAuthorizationContext {
  return { userId: 'user-1', platformRole: 'tenant_user', projects: grants }
}

// A valid blog-enabled editor grant on project-a1. permissions include
// blog.post.read (viewer/editor/owner all hold it per the registry).
const validGrant: ProjectGrant = {
  projectId: 'project-a1',
  projectSlug: 'livener-main',
  membershipId: 'pm-editor-a1',
  role: 'editor',
  permissions: ['blog.post.read', 'blog.post.write'],
  enabledModuleIds: ['blog'],
}

// Same project, but the blog module is NOT installed.
const noBlogGrant: ProjectGrant = {
  ...validGrant,
  permissions: ['blog.post.read'],
  enabledModuleIds: ['events'],
}

describe('getDashboardPosts', () => {
  it('(a) throws when the blog module is not installed for the project — module-installed check first', async () => {
    const fetchMock = vi.fn()
    await expect(
      getDashboardPosts(ctxWith([noBlogGrant]), 'project-a1', { locale: 'en' }, { fetch: fetchMock })
    ).rejects.toThrow(TenantAuthorizationError)
    // Rejected before any Sanity read.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(b) blocks when the caller holds no grant on the requested project', async () => {
    const fetchMock = vi.fn()
    await expect(
      getDashboardPosts(ctxWith([validGrant]), 'project-b1', { locale: 'en' }, { fetch: fetchMock })
    ).rejects.toThrow(TenantAuthorizationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(c) returns posts for a valid grant', async () => {
    const rows = [
      { _id: 'p1', title: 'Hello', slug: 'hello', status: 'published', updatedAt: '2026-08-01T00:00:00Z' },
      { _id: 'p2', title: null, slug: null, status: 'draft', updatedAt: '2026-08-02T00:00:00Z' },
    ]
    const fetchMock = vi.fn().mockResolvedValue(rows)
    const posts = await getDashboardPosts(
      ctxWith([validGrant]),
      'project-a1',
      { locale: 'en' },
      { fetch: fetchMock }
    )
    expect(posts).toEqual(rows)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('(c2) returns an empty array (never null) when the fetch yields null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(null)
    const posts = await getDashboardPosts(
      ctxWith([validGrant]),
      'project-a1',
      { locale: 'en' },
      { fetch: fetchMock }
    )
    expect(posts).toEqual([])
  })

  it('(d) the query passed to fetch references $projectSlug and the scoped params force the grant slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue([])
    await getDashboardPosts(
      ctxWith([validGrant]),
      'project-a1',
      // Attempt to smuggle a different projectSlug via params — must be overwritten.
      { locale: 'it', defaultLocale: 'en' },
      { fetch: fetchMock }
    )
    const [query, params] = fetchMock.mock.calls[0]
    expect(query).toContain('$projectSlug')
    // The chokepoint forces the grant's own slug, never a caller value.
    expect(params.projectSlug).toBe('livener-main')
    expect(params.locale).toBe('it')
    expect(params.defaultLocale).toBe('en')
  })

  it('defaults defaultLocale to locale when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue([])
    await getDashboardPosts(
      ctxWith([validGrant]),
      'project-a1',
      { locale: 'de' },
      { fetch: fetchMock }
    )
    const [, params] = fetchMock.mock.calls[0]
    expect(params.defaultLocale).toBe('de')
  })
})

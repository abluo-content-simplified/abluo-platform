/**
 * getDashboardPosts — the first real read path wiring the ADR-017 primitives
 * (ADR-017 slice 6 / ADR-015 close-out). These tests prove the enforcement
 * chain binds at the call site, with an injected fetch — no live Sanity.
 */
import { describe, it, expect, vi } from 'vitest'
import { getDashboardPostRows, getDashboardPosts } from '../client-dashboard'
import { TenantAuthorizationError, type SanityFetchFn } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

function ctxWith(grants: ProjectGrant[]): TenantAuthorizationContext {
  return { userId: 'user-1', platformRole: 'tenant_user', projects: grants }
}

// A valid blog-enabled editor grant on project-a1. permissions include
// blog.post.read (viewer/editor/owner all hold it per the registry).
const validGrant: ProjectGrant = {
  projectId: 'project-a1',
  // SUPABASE namespace — `projects.slug` for Livener is `livener`. Sanity's
  // name for the same project was `livener-main`; branding THAT here made the
  // two namespaces coincide and hid the empty-Posts-list defect (see
  // `dashboard-posts-namespace.test.ts`).
  projectSlug: asSupabaseProjectSlug('livener'),
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
    // The chokepoint forces the grant's own slug, never a caller value —
    // and the grant's slug is SUPABASE's `livener`.
    expect(params.projectSlug).toBe('livener')
    // RENAME.md Step 4 renamed the documents and Step 5 deleted the dual-read,
    // so `$projectSlug` alone is what matches them now — and nothing may bind
    // the removed array again.
    expect(params).not.toHaveProperty('projectSlugs')
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

describe('getDashboardPostRows', () => {
  // Regression: an Italian-only site (hoffmann: it + de, default it) showed every
  // post as "Untitled" to an English dashboard because the site's default
  // language was never passed — the title fell back to `.en`, which is empty.
  function fakeFetch(postsRows: unknown[]) {
    return vi.fn(async (query: string, params: Record<string, unknown> = {}) => {
      if (query.includes('"site"')) {
        return {
          site: { defaultLocale: 'it', supportedLocales: ['it', 'de'] },
          categories: [{ value: 'self-care', label: { _type: 'localizedString', it: 'Prendersi cura di sé' } }],
        }
      }
      // The post query must receive the SITE default language, not the viewer's.
      expect(params.defaultLocale).toBe('it')
      return postsRows
    }) as unknown as SanityFetchFn & ReturnType<typeof vi.fn>
  }

  it('passes the site default language and resolves categories and languages', async () => {
    const fetchMock = fakeFetch([
      {
        _id: 'p1',
        title: 'Coltivare la consapevolezza',
        titleLocales: { _type: 'localizedString', it: 'Coltivare la consapevolezza', de: 'Bewusstsein kultivieren' },
        categoryKeys: ['self-care', 'unknown-key'],
        slug: 'x',
        status: 'published',
        updatedAt: '2026-08-01T00:00:00Z',
      },
    ])
    const [row] = await getDashboardPostRows(ctxWith([validGrant]), 'project-a1', { locale: 'en' }, { fetch: fetchMock })
    expect(row.title).toBe('Coltivare la consapevolezza')
    expect(row.categories).toEqual(['Prendersi cura di sé', 'unknown key'])
    expect(row.languages).toEqual(['it', 'de'])
    // Both reads went through the scoped client.
    for (const [, params] of fetchMock.mock.calls) expect(params.projectSlug).toBe('livener')
  })

  it('falls back to any language when the query found no title', async () => {
    const fetchMock = fakeFetch([
      { _id: 'p2', title: null, titleLocales: { de: 'Nur Deutsch' }, slug: null, status: 'draft', updatedAt: '2026-08-01T00:00:00Z' },
    ])
    const [row] = await getDashboardPostRows(ctxWith([validGrant]), 'project-a1', { locale: 'en' }, { fetch: fetchMock })
    expect(row.title).toBe('Nur Deutsch')
  })

  it('rejects before any read when the blog module is not installed', async () => {
    const fetchMock = vi.fn()
    await expect(
      getDashboardPostRows(ctxWith([noBlogGrant]), 'project-a1', { locale: 'en' }, { fetch: fetchMock })
    ).rejects.toThrow(TenantAuthorizationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

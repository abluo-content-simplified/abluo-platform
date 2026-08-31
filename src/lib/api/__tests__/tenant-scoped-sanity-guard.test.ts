/**
 * The dashboard chokepoint's query guard is UNCHANGED by finding I-9.
 *
 * Closing I-9 wired the public website's read path into the same tenant-scope
 * rule the dashboard already enforced, by extracting the detection into a
 * shared `findTenantScopeViolation` in `@/lib/sanity/client`. The website
 * needs a softer REACTION than the dashboard (it warns in production rather
 * than blacking out a live client site), and the obvious way to get there is
 * to loosen the shared rule. These tests exist so that loosening fails here.
 *
 * The dashboard must still: throw, throw `TenantAuthorizationError`, throw
 * before any fetch, and throw with the same messages it threw before.
 */
import { describe, it, expect, vi } from 'vitest'
import { tenantScopedSanityClient, TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'

const grant: ProjectGrant = {
  projectId: 'project-a1',
  projectSlug: 'livener-main',
  membershipId: 'pm-editor-a1',
  role: 'editor',
  permissions: ['blog.post.read'],
  enabledModuleIds: ['blog'],
}

const ctx: TenantAuthorizationContext = {
  userId: 'user-1',
  platformRole: 'tenant_user',
  projects: [grant],
}

describe('dashboard chokepoint query guard (unchanged by I-9)', () => {
  it('runs a scoped query and forces projectSlug from the grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue([])
    const scoped = tenantScopedSanityClient(ctx, 'project-a1', { fetch: fetchMock })

    const query = '*[_type == "post" && projectSlug == $projectSlug]'
    await scoped.fetch(query, { locale: 'en', projectSlug: 'attacker-supplied' })

    expect(fetchMock).toHaveBeenCalledWith(query, {
      locale: 'en',
      projectSlug: 'livener-main',
    })
  })

  it('THROWS (never warns) on an unscoped query, before any fetch', async () => {
    const fetchMock = vi.fn()
    const scoped = tenantScopedSanityClient(ctx, 'project-a1', { fetch: fetchMock })

    // Synchronous throw — the call never becomes a pending promise.
    expect(() => scoped.fetch('*[_type == "post"]')).toThrow(TenantAuthorizationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on an unscoped query regardless of NODE_ENV', () => {
    // The website path keys its reaction off NODE_ENV. This one must not:
    // production is exactly where a dashboard leak matters most.
    for (const env of ['development', 'production', 'test']) {
      vi.stubEnv('NODE_ENV', env)
      const scoped = tenantScopedSanityClient(ctx, 'project-a1', { fetch: vi.fn() })
      expect(() => scoped.fetch('*[_type == "post"]')).toThrow(TenantAuthorizationError)
    }
    vi.unstubAllEnvs()
  })

  it('keeps its exact error messages', () => {
    const scoped = tenantScopedSanityClient(ctx, 'project-a1', { fetch: vi.fn() })

    expect(() => scoped.fetch('*[_type == "post"]')).toThrow(
      'tenantScopedSanityClient: query must reference $projectSlug — every query executed ' +
        'through this chokepoint must be scoped by the bound projectSlug parameter.',
    )

    expect(() =>
      scoped.fetch('*[projectSlug == $projectSlug && _id == "${id}"]'),
    ).toThrow(/contains a template-literal interpolation/)
  })
})

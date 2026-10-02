import { describe, it, expect } from 'vitest'
import { evaluateMediaOwnership, MEDIA_OWNERSHIP_QUERY } from '../ownership'

const TENANT_A = 'client-a'
const TENANT_B = 'client-b'

describe('evaluateMediaOwnership — cross-tenant reference guard for POST /api/media', () => {
  it('accepts a tenant-only upload and derives no projectSlug', () => {
    expect(evaluateMediaOwnership({ tenantExists: true, project: null }, TENANT_A, null)).toEqual({
      ok: true,
      projectSlug: null,
    })
  })

  it('accepts a project owned by the tenant and takes projectSlug FROM THE PROJECT', () => {
    expect(
      evaluateMediaOwnership(
        { tenantExists: true, project: { projectSlug: 'livener', clientId: TENANT_A } },
        TENANT_A,
        'project-livener'
      )
    ).toEqual({ ok: true, projectSlug: 'livener' })
  })

  it("rejects tenant A's asset stamped with tenant B's project", () => {
    expect(
      evaluateMediaOwnership(
        { tenantExists: true, project: { projectSlug: 'hoffmann', clientId: TENANT_B } },
        TENANT_A,
        'project-hoffmann'
      )
    ).toEqual({ ok: false, error: 'project_not_owned_by_tenant' })
  })

  it('rejects a project with no owner (fail-closed)', () => {
    expect(
      evaluateMediaOwnership({ tenantExists: true, project: { projectSlug: 'x', clientId: null } }, TENANT_A, 'p')
    ).toEqual({ ok: false, error: 'project_not_owned_by_tenant' })
  })

  it('rejects an unknown project id', () => {
    expect(evaluateMediaOwnership({ tenantExists: true, project: null }, TENANT_A, 'nope')).toEqual({
      ok: false,
      error: 'unknown_project',
    })
  })

  it('rejects an unknown tenant id, and a missing row', () => {
    expect(evaluateMediaOwnership({ tenantExists: false }, 'ghost', null)).toEqual({ ok: false, error: 'unknown_tenant' })
    expect(evaluateMediaOwnership(null, TENANT_A, null)).toEqual({ ok: false, error: 'unknown_tenant' })
  })

  it('the lookup is parameterized (no interpolation) and ignores drafts', () => {
    expect(MEDIA_OWNERSHIP_QUERY).not.toContain('${')
    expect(MEDIA_OWNERSHIP_QUERY).toContain('$tenant')
    expect(MEDIA_OWNERSHIP_QUERY).toContain('$project')
    expect(MEDIA_OWNERSHIP_QUERY.match(/drafts\.\*\*/g)).toHaveLength(2)
  })
})

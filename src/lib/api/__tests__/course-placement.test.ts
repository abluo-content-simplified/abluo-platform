import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { COURSE_PLACEMENT_QUERY, getCoursePlacement, readPlacementInfo } from '../course-placement'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const PID = '11111111-1111-4111-8111-111111111111'
const grant = (permissions: string[]): ProjectGrant => ({ projectId: PID, projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm', role: 'editor', permissions, enabledModuleIds: ['courses'] })
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u', platformRole: 'tenant_user', projects: [g] })

const answer = {
  pages: [{ _id: 'p1', pageType: 'services', slugs: { fr: { current: 'horaires' } }, open: true, timetables: [{ courseScope: 'all', courseIds: null }] }],
  domain: 'https://cyce.info/',
  site: { defaultLocale: 'fr', supportedLocales: ['fr', 'en'] },
}

describe('the placement query', () => {
  it('reads only this project’s PUBLISHED pages with a timetable section, and never a draft', () => {
    expect(COURSE_PLACEMENT_QUERY).toContain('projectSlug == $projectSlug')
    expect(COURSE_PLACEMENT_QUERY).toContain('!(_id in path("drafts.**"))')
    expect(COURSE_PLACEMENT_QUERY).toContain('_type == "timetableSection"')
    expect(COURSE_PLACEMENT_QUERY).toContain('courseScope')
    expect(COURSE_PLACEMENT_QUERY).toContain('courses[]._ref')
  })
})

describe('readPlacementInfo / getCoursePlacement', () => {
  it('turns the answer into the origin (www), default language and pages', async () => {
    const fetch = vi.fn(async () => answer)
    const info = await readPlacementInfo({ fetch }, 'cyce')
    expect(fetch).toHaveBeenCalledWith(COURSE_PLACEMENT_QUERY, { projectSlug: 'cyce' }, { perspective: 'raw' })
    expect(info).toMatchObject({ origin: 'https://www.cyce.info', defaultLocale: 'fr' })
    expect(info.pages).toHaveLength(1)
  })

  it('without a domain there is no origin; an empty answer means no pages', async () => {
    expect((await readPlacementInfo({ fetch: async () => ({ ...answer, domain: null }) }, 'cyce')).origin).toBeNull()
    expect((await readPlacementInfo({ fetch: async () => null }, 'cyce')).pages).toEqual([])
  })

  it('needs courses.course.read and answers for the grant’s project only', async () => {
    const fetch = vi.fn(async () => answer)
    await expect(getCoursePlacement(ctx(grant([])), PID, { id: 'c1' }, { client: { fetch } })).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(fetch).not.toHaveBeenCalled()
    const r = await getCoursePlacement(ctx(grant(['courses.course.read'])), PID, { id: 'c1' }, { client: { fetch } })
    expect(r).toEqual({ onWebsite: true, url: 'https://www.cyce.info/fr/horaires' })
    expect(fetch).toHaveBeenCalledWith(COURSE_PLACEMENT_QUERY, { projectSlug: 'cyce' }, { perspective: 'raw' })
    await expect(getCoursePlacement(ctx(grant(['courses.course.read'])), PID, { id: '../x' }, { client: { fetch } })).rejects.toMatchObject({ code: 'not_found' })
  })
})

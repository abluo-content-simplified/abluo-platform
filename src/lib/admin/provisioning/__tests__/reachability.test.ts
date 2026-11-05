import { describe, expect, it } from 'vitest'
import { normaliseDomain, reachability } from '../reachability'
import type { GeneratedHostRoute } from '@/lib/tenancy/generated/route-config'

const route = (o: Partial<GeneratedHostRoute>): GeneratedHostRoute => ({
  host: 'x.preview.abluo.app',
  hostKind: 'preview-subdomain',
  tenantSlug: 't',
  projectSlug: 'x',
  projectId: 'p1',
  defaultLocale: 'en',
  supportedLocales: ['en'],
  status: 'preview',
  ...o,
})

describe('reachability (What’s next status)', () => {
  it('a project not in the running table is not reachable yet', () => {
    expect(reachability([route({ projectId: 'other', projectSlug: 'other' })], { id: 'p1', slug: 'x' })).toEqual({
      previewLive: false,
      customDomain: null,
      domainLive: false,
      status: null,
      deployedStatus: null,
    })
  })

  it('in the table: preview is live; a Supabase domain not yet in the table is not', () => {
    const r = reachability([route({})], { id: 'p1', slug: 'x', customDomain: 'https://www.Freeriders.app/', status: 'preview' })
    expect(r).toMatchObject({ previewLive: true, customDomain: 'freeriders.app', domainLive: false, deployedStatus: 'preview' })
  })

  it('domain and active status deployed', () => {
    const r = reachability([route({ status: 'active' }), route({ host: 'freeriders.app', hostKind: 'custom-domain', status: 'active' })], { id: 'p1', slug: 'x', customDomain: 'freeriders.app', status: 'active' })
    expect(r).toMatchObject({ domainLive: true, status: 'active', deployedStatus: 'active' })
  })

  it('normaliseDomain', () => {
    expect(normaliseDomain(' HTTPS://www.Example.com:443/path ')).toBe('example.com')
    expect(normaliseDomain('')).toBeNull()
    expect(normaliseDomain(null)).toBeNull()
  })
})

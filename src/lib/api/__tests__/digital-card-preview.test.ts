/**
 * The Digital Card editor's live-preview data (ADR-049 Amendment A): read
 * permission before any I/O, the card must be this project's, the language one
 * of the site's, every read scoped by the GRANT's project slug.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/sanity/client', () => ({ fetchDesignSystemById: vi.fn(async () => null) }))

import { DIGITAL_CARD_PREVIEW_QUERY, getDigitalCardPreview } from '../digital-card-preview'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: 'p1',
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'viewer',
  permissions: ['digital-cards.read'],
  enabledModuleIds: ['digital-cards'],
  ...o,
})
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

function fake() {
  const docs: Record<string, Record<string, unknown>> = {
    card: { _id: 'card', _type: 'digitalCard', projectSlug: 'cyce', kind: 'person', person: { _ref: 'person-anna' } },
    foreign: { _id: 'foreign', _type: 'digitalCard', projectSlug: 'livener', kind: 'site' },
  }
  const fetch = vi.fn(async (q: string, p: Record<string, unknown>) => {
    if (q.includes('{ defaultLocale, supportedLocales }') && !q.includes('"person"')) return { defaultLocale: 'it', supportedLocales: ['it', 'en'] }
    if (q === DIGITAL_CARD_PREVIEW_QUERY) {
      return {
        site: { siteName: 'CYCE' },
        project: { customDomain: 'cyce.info', enabledModules: ['digital-cards'] },
        person: p.personId === 'person-anna' ? { publicId: 'x', firstName: 'Anna' } : null,
        siteCard: null,
        pages: [{ _id: 'page-1', pageType: 'standard', slug: 'orari', title: 'Orari' }],
        catalogue: [{ _id: 'tmz-catalogue-page', type: 'cataloguePage', hasPage: null, slug: null, segment: 'books', title: 'Between the Lines' }],
        files: [],
        background: p.backgroundId ? { asset: { _ref: 'image-1' }, hotspot: { x: 0.2, y: 0.4 } } : null,
        themeMode: 'darkOnly',
      }
    }
    return { colors: {} }
  })
  return { fetch, client: { fetch, getDocument: vi.fn(async (id: string) => docs[id]) } }
}

describe('getDigitalCardPreview', () => {
  it('needs digital-cards.read before any read', async () => {
    const f = fake()
    await expect(getDigitalCardPreview(ctx(grant({ permissions: [] })), 'p1', { id: 'card', locale: 'it' }, { client: f.client as never })).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
  })

  it('refuses another project’s card and an unknown language', async () => {
    const f = fake()
    await expect(getDigitalCardPreview(ctx(grant()), 'p1', { id: 'foreign', locale: 'it' }, { client: f.client as never })).rejects.toMatchObject({ code: 'not_found' })
    await expect(getDigitalCardPreview(ctx(grant()), 'p1', { id: 'card', locale: 'fr' }, { client: f.client as never })).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('reads the site, the PUBLIC person, pages and the chosen background, scoped by the grant; the theme is scoped CSS', async () => {
    const f = fake()
    const r = await getDigitalCardPreview(ctx(grant()), 'p1', { id: 'card', locale: 'en', backgroundId: 'img-1', fileIds: ['bad id!', 'file-1'], targetIds: ['tmz-catalogue-page', 'drafts.x', 'bad id!'] }, { client: f.client as never, designSystem: async () => null })
    const call = f.fetch.mock.calls.find((c) => c[0] === DIGITAL_CARD_PREVIEW_QUERY)!
    expect(call[1]).toEqual({ projectSlug: 'cyce', locale: 'en', defaultLocale: 'it', personId: 'person-anna', fileIds: ['file-1'], targetIds: ['tmz-catalogue-page'], backgroundId: 'img-1' })
    expect(DIGITAL_CARD_PREVIEW_QUERY).not.toContain('person_private')
    expect(r.person).toMatchObject({ firstName: 'Anna' })
    expect(r.pages).toEqual({ 'page-1': { pageType: 'standard', slug: 'orari', title: 'Orari', access: null } })
    // Amendment B — the page links' catalogue targets, read with the navigation's own rule.
    expect(r.catalogue).toEqual({ 'tmz-catalogue-page': { type: 'cataloguePage', hasPage: null, slug: null, segment: 'books', title: 'Between the Lines' } })
    expect(DIGITAL_CARD_PREVIEW_QUERY).toContain('_id in $targetIds && projectSlug == $projectSlug && string::startsWith(_type, "catalogue")')
    expect(r.background).toMatchObject({ hotspot: { x: 0.2, y: 0.4 } })
    expect(r.theme.css).toContain('[data-card-preview="card"]')
    expect(r.theme.css).not.toContain('html.light')
  })
})

/**
 * Catalogue → Setup routes (R2-B, ADR-042 N2a, spec §9.2): the permission matrix of every
 * Setup page. Signed out → sign in; no grant / no Catalogue / no permission for the section →
 * 404 with nothing read; the Setup permission opens every section; `catalogue.taxonomy.write`
 * alone opens only Categories & Tags (and `/catalogue/setup` sends it there, without a way back
 * to an Overview it cannot open).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  reads: [] as string[],
  view: { rev: 'r1', defaultLocale: 'en', locales: ['en'], channels: [], currency: 'EUR', publicSegment: 'menu', publicSegmentHistory: [], publicName: {}, defaultItemProfile: null, showPricesByDefault: true, formatTemplates: [], dietaryTags: [], setup: { completedAt: null, source: null }, can: { manage: true } },
  taxonomy: { rev: '', exists: false, defaultLocale: 'en', locales: ['en'], categories: [], tags: [], issues: [], channels: [], can: { write: true, manage: false } },
  screen: (name: string) => (p: unknown) => ({ type: name, props: p }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))
vi.mock('@/lib/api/tenant-context', () => ({ getTenantAuthorizationContext: async () => h.ctx }))
vi.mock('@/lib/modules/catalogue/settings/service', () => ({
  loadCatalogueSettings: async () => {
    h.reads.push('settings')
    return h.view
  },
}))
vi.mock('@/lib/modules/catalogue/taxonomy/service', () => ({
  listTaxonomy: async () => {
    h.reads.push('taxonomy')
    return h.taxonomy
  },
}))
vi.mock('@/lib/api/catalogue-drafts', () => ({
  getCatalogueGlance: async () => {
    h.reads.push('glance')
    return { published: 3, drafts: 2, noPrice: 0 }
  },
  getCatalogueSite: async () => {
    h.reads.push('site')
    return { timeZone: 'Europe/Rome' }
  },
}))
vi.mock('@/lib/api/client-dashboard', () => ({ getProjectSiteDomain: async () => 'example.com' }))
vi.mock('@/components/app/ui/PageShell', () => ({ PageShell: ({ children }: { children: unknown }) => children }))
vi.mock('@/components/client/catalogue/setup/SetupOverview', () => ({ SetupOverview: h.screen('SetupOverview') }))
vi.mock('@/components/client/catalogue/setup/CategoriesSetup', () => ({ CategoriesSetup: h.screen('CategoriesSetup') }))
vi.mock('@/components/client/catalogue/setup/ServiceChannels', () => ({ ServiceChannels: h.screen('ServiceChannels') }))
vi.mock('@/components/client/catalogue/setup/ItemDefaults', () => ({ ItemDefaults: h.screen('ItemDefaults') }))
vi.mock('@/components/client/catalogue/setup/PublicWebsite', () => ({ PublicWebsite: h.screen('PublicWebsite') }))
vi.mock('@/components/client/catalogue/setup/setup-ui', () => ({ SetupHeader: h.screen('SetupHeader') }))
vi.mock('@/components/app/ui/EmptyState', () => ({ EmptyState: h.screen('EmptyState') }))

import OverviewPage from '../page'
import CategoriesPage from '../categories/page'
import ChannelsPage from '../channels/page'
import DefaultsPage from '../defaults/page'
import WebsitePage from '../website/page'
import StartersPage from '../starters/page'

const PAGES = {
  overview: OverviewPage,
  categories: CategoriesPage,
  channels: ChannelsPage,
  defaults: DefaultsPage,
  website: WebsitePage,
  starters: StartersPage,
} as const
type Section = keyof typeof PAGES

const grant = (permissions: string[], over: Record<string, unknown> = {}) => ({
  projectId: 'p-a',
  projectSlug: 'site-a',
  membershipId: 'm',
  role: 'owner',
  permissions: ['catalogue.item.read', ...permissions],
  enabledModuleIds: ['catalogue'],
  ...over,
})
const as = (g: ReturnType<typeof grant> | null) => {
  h.ctx = g ? { userId: 'u', platformRole: 'tenant_user', projects: [g] } : null
}
const open = (s: Section) => (PAGES[s] as (p: { params: Promise<{ tenant: string }> }) => Promise<unknown>)({ params: Promise.resolve({ tenant: 'site-a' }) })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rendered = async (s: Section): Promise<any> => {
  // PageShell is mocked to pass its children through; the screen inside is a JSX element whose type is the mocked screen.
  const el = (await open(s)) as { type: (p: unknown) => unknown; props: { children: unknown } }
  const shell = el.type(el.props) as { type: (p: unknown) => unknown; props: unknown } | { type: (p: unknown) => unknown; props: unknown }[]
  const first = Array.isArray(shell) ? shell[0] : shell
  return first.type(first.props)
}

beforeEach(() => {
  h.reads = []
})

describe('Catalogue → Setup pages: who may open what', () => {
  it('signed out → sign in, back to the same section', async () => {
    as(null)
    await expect(open('overview')).rejects.toThrow('REDIRECT /login?next=/site-a/catalogue/setup')
    await expect(open('channels')).rejects.toThrow('REDIRECT /login?next=/site-a/catalogue/setup/channels')
  })

  it('no grant on this project, no Catalogue, or neither permission → 404 everywhere, nothing read', async () => {
    for (const g of [grant(['catalogue.setup.manage'], { projectSlug: 'site-b' }), grant(['catalogue.setup.manage'], { enabledModuleIds: ['blog'] }), grant([])]) {
      as(g)
      for (const s of Object.keys(PAGES) as Section[]) await expect(open(s)).rejects.toThrow('NEXT_NOT_FOUND')
    }
    expect(h.reads).toEqual([])
  })

  it('the Setup permission opens every section', async () => {
    as(grant(['catalogue.setup.manage', 'catalogue.taxonomy.write']))
    const overview = await rendered('overview')
    expect(overview.type).toBe('SetupOverview')
    expect(overview.props.data.counts).toMatchObject({ items: 5, categories: 0, channels: 0 })
    expect((await rendered('categories')).props).toMatchObject({ projectSlug: 'site-a', backHref: '/site-a/catalogue/setup' })
    expect((await rendered('channels')).type).toBe('ServiceChannels')
    expect((await rendered('defaults')).type).toBe('ItemDefaults')
    const website = await rendered('website')
    expect(website.props).toMatchObject({ timeZone: 'Europe/Rome', siteAddress: 'example.com', settingsHref: '/site-a/settings' })
    expect(website.props.currencies).toContain('EUR')
    expect(await rendered('starters')).toBeTruthy()
  })

  it('catalogue.taxonomy.write only: Categories & Tags (no way back to the Overview); the Overview sends it there; the rest 404', async () => {
    as(grant(['catalogue.taxonomy.write']))
    await expect(open('overview')).rejects.toThrow('REDIRECT /site-a/catalogue/setup/categories')
    const categories = await rendered('categories')
    expect(categories.type).toBe('CategoriesSetup')
    expect(categories.props.backHref).toBeNull()
    for (const s of ['channels', 'defaults', 'website', 'starters'] as const) await expect(open(s)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('a read the services refuse (no catalogue.item.read) is a 404, not an error page', async () => {
    const { TenantAuthorizationError } = await import('@/lib/api/tenant-scoped-sanity')
    const svc = await import('@/lib/modules/catalogue/settings/service')
    const spy = vi.spyOn(svc, 'loadCatalogueSettings').mockRejectedValueOnce(new TenantAuthorizationError('Missing catalogue.item.read.'))
    as(grant(['catalogue.setup.manage']))
    await expect(open('channels')).rejects.toThrow('NEXT_NOT_FOUND')
    spy.mockRestore()
  })
})

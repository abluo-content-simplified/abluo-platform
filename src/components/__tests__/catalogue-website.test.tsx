/**
 * catalogueListingSection — New Section Checklist (CLAUDE.md) end to end, the
 * shared hydration both page routes use, and what the website renders
 * (spec §10.5, AC 3, 18, 19, 20, C6).
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SECTION_MAP, isSectionTypeAvailable } from '@/lib/modules/sections'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { buildSchema } from '@/lib/modules'
import { PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import * as Q from '@/lib/sanity/queries'
import { hydrateSections } from '@/components/sections/SectionRenderer'
import { CatalogueListingSection } from '@/components/sections/CatalogueListingSection'
import type { CatalogueListingSection as Section, PageSection } from '@/lib/sanity/types'
import type { CatalogueCollectionDTO, CatalogueItemDTO } from '@/lib/modules/catalogue/dto'
import { Byline, ItemLinks } from '@/components/catalogue/CatalogueItemParts'
import { getCatalogueWebsiteMessages, optionRuleText, CATALOGUE_WEBSITE_KEYS } from '@/components/catalogue/messages'

const ROOT = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('New Section Checklist — catalogueListingSection', () => {
  it('is owned by the catalogue module and has a SECTION_MAP entry', () => {
    const m = MODULE_REGISTRY.find((x) => x.id === 'catalogue')!
    expect(m.platformContract.sectionTypes).toEqual(['catalogueListingSection'])
    expect(m.platformContract.placement?.surfaces.map((s) => s.kind)).toContain('sections')
    expect(typeof SECTION_MAP.catalogueListingSection).toBe('function')
  })

  it('is gated on the installation (AC 3), failing open only when unresolved', () => {
    expect(isSectionTypeAvailable('catalogueListingSection', ['gallery'])).toBe(false)
    expect(isSectionTypeAvailable('catalogueListingSection', [])).toBe(false)
    expect(isSectionTypeAvailable('catalogueListingSection', ['catalogue'])).toBe(true)
  })

  it('has one schema definition and is in the shared page sections list (page, homePage, module pages)', () => {
    expect(buildSchema().filter((t) => t.name === 'catalogueListingSection')).toHaveLength(1)
    expect(PAGE_SECTIONS_OF.map((m) => (m as { type: string }).type)).toContain('catalogueListingSection')
  })

  it('is projected by every section query, without dereferencing the collection', () => {
    for (const q of [Q.PAGE_SECTIONS_PROJECTION, Q.homePageQuery]) {
      expect(q).toContain('"collectionId": collection._ref')
      expect(q).toMatch(/\bshowPrices\b/)
      expect(q).toMatch(/\ballergenPresentation\b/)
      expect(q).not.toMatch(/\bshowAllergens\b/)
      expect(q).toContain('emptyStateHeading')
    }
    for (const q of [Q.pageHomeQuery, Q.pageBySlugQuery, Q.cataloguePageQuery]) expect(q).toContain('"collectionId": collection._ref')
  })

  it('is hydrated in BOTH page routes (shared hydrateSections)', () => {
    for (const route of ['src/app/[locale]/(website)/[tenant]/page.tsx', 'src/app/[locale]/(website)/[tenant]/[...slug]/page.tsx']) {
      expect(read(route)).toContain('await hydrateSections(')
    }
    expect(read('src/components/sections/SectionRenderer.tsx')).toContain("section._type === 'catalogueListingSection'")
  })

  it('the catch-all dispatches the catalogue before the page lookup, in metadata and page', () => {
    const src = read('src/app/[locale]/(website)/[tenant]/[...slug]/page.tsx')
    const meta = src.slice(src.indexOf('export async function generateMetadata'), src.indexOf('export default'))
    const page = src.slice(src.indexOf('export default'))
    expect(meta.indexOf('planCatalogueRoute(')).toBeGreaterThan(-1)
    expect(meta.indexOf('planCatalogueRoute(')).toBeLessThan(meta.indexOf('if (!page) return {}'))
    expect(page.indexOf('planCatalogueRoute(')).toBeGreaterThan(-1)
    expect(page.indexOf('planCatalogueRoute(')).toBeLessThan(page.indexOf('pageByOldSlugQuery'))
  })
})

// ── Hydration ────────────────────────────────────────────────────────────────

const configRow = { catalogue: { publicSegment: 'menu', currency: 'EUR', showPricesByDefault: false }, timeZone: null }
const itemRow = (name: string, extra: Record<string, unknown> = {}) => ({
  publicId: name, itemProfile: 'foodOrDrink', name, hasPage: false, offers: [{ _key: `${name}-o`, price: 8.5 }],
  allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk', 'gluten'], mayContain: ['treeNuts'] }, ...extra,
})
const collectionRow = {
  publicId: 'c', collectionType: 'menu', name: 'Menu',
  sections: [
    { _key: 'pizza', name: 'Pizza', items: [] },
    { _key: 'bianche', parentKey: 'pizza', name: 'Pizze bianche', items: [itemRow('Bianca', { hasPage: true, slugMap: { en: { current: 'bianca' } } })] },
    { _key: 'dolci', name: 'Dolci', items: [itemRow('Tiramisù', { offers: [{ _key: 'f', price: 0 }] })] },
  ],
}

function fetcher(answers: { config?: unknown; collection?: unknown; throws?: boolean }) {
  const calls: string[] = []
  const fetchForTenant = (async (query: string) => {
    if (answers.throws) throw new Error('sanity down')
    if (query === Q.catalogueModuleConfigQuery) { calls.push('config'); return answers.config ?? null }
    if (query === Q.catalogueCollectionByIdQuery) { calls.push('collection'); return answers.collection ?? null }
    calls.push('other')
    return null
  }) as never
  return { fetchForTenant, calls }
}

const section = (extra: Partial<Section> = {}): Section => ({ _type: 'catalogueListingSection', _key: 'k', collectionId: 'c', ...extra })

describe('hydrateSections — catalogueListingSection', () => {
  it('reads the config once per page and the collection per section', async () => {
    const { fetchForTenant, calls } = fetcher({ config: configRow, collection: collectionRow })
    const sections = [section({ _key: 'a' }), section({ _key: 'b' })]
    await hydrateSections(sections as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
    expect(calls.filter((c) => c === 'config')).toHaveLength(1)
    expect(calls.filter((c) => c === 'collection')).toHaveLength(2)
    expect(sections[0].catalogue?.collection?.name).toBe('Menu')
    expect(sections[0].catalogue?.segment).toBe('menu')
  })

  it('module not installed (config null) → no data, even when gating fails open', async () => {
    const { fetchForTenant, calls } = fetcher({ config: { catalogue: null } })
    const s = section()
    await hydrateSections([s] as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: null })
    expect(s.catalogue).toBeUndefined()
    expect(calls).toEqual(['config'])
  })

  it('module gated off → not even fetched', async () => {
    const { fetchForTenant, calls } = fetcher({ config: configRow })
    const s = section()
    await hydrateSections([s] as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: ['blog'] })
    expect(calls).toEqual([])
  })

  it('an error omits the section, not the page', async () => {
    const { fetchForTenant } = fetcher({ throws: true })
    const s = section()
    const err = console.error
    console.error = () => {}
    try {
      await expect(hydrateSections([s] as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: ['catalogue'] })).resolves.toBeUndefined()
    } finally {
      console.error = err
    }
    expect(s.catalogue).toBeUndefined()
  })
})

// ── Rendering ────────────────────────────────────────────────────────────────

async function hydrated(extra: Partial<Section> = {}, collection: unknown = collectionRow) {
  const { fetchForTenant } = fetcher({ config: configRow, collection })
  const s = section(extra)
  await hydrateSections([s] as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
  return s
}

const render = (s: Section) =>
  renderToStaticMarkup(
    <CatalogueListingSection section={s} surface={'transparent' as never} designSystem={null} locale="en" tenantSlug="rist" />,
  )

describe('CatalogueListingSection — website', () => {
  it('renders nothing when not hydrated, or with no collection', () => {
    expect(render(section())).toBe('')
    expect(render(section({ catalogue: { collection: null, segment: 'menu', showPricesByDefault: true, affiliateDisclosure: null } }))).toBe('')
  })

  it('parent then children in stored order; a parent with no items still prints its heading (AC 18, 19)', async () => {
    const html = render(await hydrated({ title: 'Our menu' }))
    const order = ['Our menu', 'Pizza', 'Pizze bianche', 'Bianca', 'Dolci', 'Tiramisù'].map((t) => html.indexOf(t))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('links an item only where it has a page in the request locale (C6)', async () => {
    const html = render(await hydrated())
    expect(html).toContain('href="/en/rist/menu/bianca"')
    expect(html.match(/href=/g)).toHaveLength(1)
  })

  it('prices: "default" (and unset) follow the config default (here: off); show / hide override (D-6)', async () => {
    expect(render(await hydrated())).not.toContain('€8.50')
    expect(render(await hydrated({ showPrices: 'default' }))).not.toContain('€8.50')
    const on = render(await hydrated({ showPrices: 'show' }))
    expect(on).toContain('€8.50')
    expect(on).toContain(getCatalogueWebsiteMessages('en').free || '§missing§')
    expect(render(await hydrated({ showPrices: 'hide' }))).not.toContain('€8.50')
  })

  it('"default" follows the config LIVE: the same section shows prices once the setting is on (D-6)', async () => {
    const { fetchForTenant } = fetcher({ config: { ...configRow, catalogue: { ...configRow.catalogue, showPricesByDefault: true } }, collection: collectionRow })
    const s = section({ showPrices: 'default' })
    await hydrateSections([s] as PageSection[], { fetchForTenant, locale: 'en', defaultLocale: 'en', enabledModuleIds: ['catalogue'] })
    expect(render(s)).toContain('€8.50')
  })

  it('allergens always render for food, in Annex II order, with "may contain" separate; no option hides them (D-3)', async () => {
    const m = getCatalogueWebsiteMessages('en')
    for (const allergenPresentation of [undefined, 'compact', 'expanded'] as const) {
      const html = render(await hydrated({ allergenPresentation }))
      expect(html.indexOf(m.allergen('gluten'))).toBeGreaterThan(-1)
      expect(html.indexOf(m.allergen('gluten'))).toBeLessThan(html.indexOf(m.allergen('milk')))
      expect(html).toContain(m.mayContainHeading)
      expect(html.indexOf(m.allergen('milk'))).toBeLessThan(html.indexOf(m.allergen('treeNuts')))
    }
    expect(render(await hydrated({ allergenPresentation: 'expanded' }))).toContain('<dl')
    expect(render(await hydrated({ allergenPresentation: 'compact' }))).not.toContain('<dl')
  })

  it('"none declared" prints the approved wording; "not reviewed" and products print nothing — never an inferred claim (D-3)', async () => {
    const m = getCatalogueWebsiteMessages('en')
    const none = { ...collectionRow, sections: [{ _key: 's', name: 'S', items: [itemRow('Acqua', { allergenDeclaration: { status: 'noneDeclared', confirmed: true } })] }] }
    expect(render(await hydrated({}, none))).toContain(m.allergensNoneDeclared)
    const unreviewed = { ...collectionRow, sections: [{ _key: 's', name: 'S', items: [itemRow('X', { allergenDeclaration: { status: 'notReviewed' } })] }] }
    const product = { ...collectionRow, sections: [{ _key: 's', name: 'S', items: [itemRow('Libro', { itemProfile: 'product' })] }] }
    for (const c of [unreviewed, product]) {
      const html = render(await hydrated({}, c))
      expect(html).not.toContain(m.allergensHeading)
      expect(html).not.toContain(m.allergensNoneDeclared)
      expect(html).not.toMatch(/free from|allergen-free|senza glutine/i)
    }
  })

  it('empty collection: the authored empty state, or nothing', async () => {
    const empty = { ...collectionRow, sections: [{ _key: 'x', name: 'Vuota', items: [] }] }
    expect(render(await hydrated({}, empty))).toBe('')
    const html = render(await hydrated({ emptyStateHeading: 'Coming soon' }, empty))
    expect(html).toContain('Coming soon')
    expect(html).not.toContain('Vuota')
  })
})

describe('allergens beside each option choice (ADR-033 D-3a)', () => {
  const extras = (over: Record<string, unknown> = {}) => ({
    ...collectionRow,
    sections: [{ _key: 's', name: 'S', items: [itemRow('Pizza', {
      optionLists: [{ _key: 'att', list: { name: 'Extra', options: [
        { _key: 'm', label: 'Extra mozzarella', kind: 'add', allergenDeclaration: { status: 'containsListedAllergens', allergens: ['milk'], mayContain: ['treeNuts'] } },
        { _key: 'w', label: 'Acqua', kind: 'add', allergenDeclaration: { status: 'noneDeclared', confirmed: true } },
        { _key: 'u', label: 'Unreviewed', kind: 'add', allergenDeclaration: { status: 'notReviewed' } },
        { _key: 'r', label: 'cipolla', kind: 'remove' },
      ] } }],
      ...over,
    })] }],
  })
  it('compact: real text inline — "Extra mozzarella — Contains: Milk · May contain: Nuts"', async () => {
    const m = getCatalogueWebsiteMessages('en')
    const html = render(await hydrated({}, extras()))
    expect(html).toContain(`Extra mozzarella — ${m.containsHeading}: ${m.allergen('milk')} · ${m.mayContainHeading}: ${m.allergen('treeNuts')}`)
    expect(html).toContain(`Acqua — ${m.allergensNoneDeclared}`)
    expect(html).not.toMatch(/Unreviewed —/)
    expect(html).not.toMatch(/cipolla —/)
  })
  it('expanded: one choice per line with its allergens', async () => {
    const m = getCatalogueWebsiteMessages('en')
    const html = render(await hydrated({ allergenPresentation: 'expanded' }, extras()))
    expect(html).toContain('data-option="m"')
    expect(html).toContain(`${m.containsHeading}: ${m.allergen('milk')}`)
  })
  it('the same list on a product renders no choice allergens', async () => {
    const m = getCatalogueWebsiteMessages('en')
    const html = render(await hydrated({}, extras({ itemProfile: 'product' })))
    expect(html).toContain('Extra mozzarella')
    expect(html).not.toContain(`${m.containsHeading}:`)
    expect(html).not.toContain(m.allergensNoneDeclared)
  })
})

describe('"none declared" with "may contain" (ADR-033 E-1)', () => {
  it('renders the reviewed-none statement and, on a separate line, "May contain"', async () => {
    const m = getCatalogueWebsiteMessages('en')
    const c = { ...collectionRow, sections: [{ _key: 's', name: 'S', items: [itemRow('Biscotti', { allergenDeclaration: { status: 'noneDeclared', confirmed: true, mayContain: ['treeNuts'] } })] }] }
    const html = render(await hydrated({}, c))
    expect(html).toContain(m.allergensNoneDeclared)
    expect(html).toMatch(new RegExp(`data-allergens="may-contain"[^>]*>.*${m.mayContainHeading}`))
    expect(html).toContain(m.allergen('treeNuts'))
  })
  it('the working wording is the message (pending legal copy)', () => {
    expect(getCatalogueWebsiteMessages('en').allergensNoneDeclared).toBe('Allergen information reviewed: no EU-listed allergens declared.')
    expect(getCatalogueWebsiteMessages('it').allergensNoneDeclared).toBe('Informazioni sugli allergeni verificate: nessun allergene dell’elenco UE dichiarato.')
    expect(getCatalogueWebsiteMessages('de').allergensNoneDeclared).toBe('Allergenangaben geprüft: keine Allergene der EU-Liste deklariert.')
  })
})

describe('catalogue website messages', () => {
  it('every key exists in en, it and de (strings live in messages/*.json)', () => {
    for (const locale of ['en', 'it', 'de']) {
      const m = getCatalogueWebsiteMessages(locale)
      for (const k of CATALOGUE_WEBSITE_KEYS) expect(m[k], `${locale} catalogue.website.${k}`).not.toBe('')
    }
  })

  it('option rules', () => {
    const m = getCatalogueWebsiteMessages('en')
    expect(optionRuleText(m, 0, null)).toBeNull()
    expect(optionRuleText(m, 1, 1)).not.toBeNull()
  })
})

describe('byline and links (ADR-033 Amendment F)', () => {
  const row = itemRow('Dune', {
    byline: 'Frank Herbert · 1965',
    links: [
      { _key: 'a', label: 'Publisher', url: 'https://example.com/dune' },
      { _key: 'b', label: 'Bad', url: 'javascript:alert(1)' },
    ],
    offers: [],
  })
  const col = { ...collectionRow, sections: [{ _key: 's', name: 'Shelf', items: [row] }] }

  it('a card shows the byline under the name and a compact external link in a new tab', async () => {
    const html = render(await hydrated({}, col))
    expect(html).toContain('Frank Herbert · 1965')
    expect(html.indexOf('Dune')).toBeLessThan(html.indexOf('Frank Herbert'))
    expect(html).toContain('href="https://example.com/dune"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('Bad')
  })

  it('no byline and no links render nothing extra', async () => {
    const html = render(await hydrated({}, { ...collectionRow, sections: [{ _key: 's', name: 'Shelf', items: [itemRow('Plain')] }] }))
    expect(html).not.toContain('data-byline')
    expect(html).not.toContain('data-item-links')
  })

  it('ItemLinks: the site\'s own host stays in the same tab, an external one opens a new tab with rel', () => {
    const links = [
      { key: 'own', label: 'Home', url: 'https://www.mysite.it/page', kind: 'info' as const, affiliate: false },
      { key: 'ext', label: 'Elsewhere', url: 'https://other.org/x', kind: 'info' as const, affiliate: false },
    ]
    const html = renderToStaticMarkup(<ItemLinks links={links} siteHosts={['mysite.it']} compact={false} heading="Links" />)
    const own = html.slice(html.indexOf('mysite.it'), html.indexOf('Home'))
    const ext = html.slice(html.indexOf('other.org'), html.indexOf('Elsewhere'))
    expect(own).not.toContain('target=')
    expect(ext).toContain('target="_blank"')
    expect(ext).toContain('rel="noopener noreferrer"')
    expect(renderToStaticMarkup(<ItemLinks links={[]} compact />)).toBe('')
  })

  it('Byline renders plain text only when present', () => {
    expect(renderToStaticMarkup(<Byline byline={null} />)).toBe('')
    expect(renderToStaticMarkup(<Byline byline="<b>x</b>" />)).toContain('&lt;b&gt;')
  })
})

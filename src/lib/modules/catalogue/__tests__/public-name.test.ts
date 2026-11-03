// Contract C11.8 — public name fixtures: reader, pure migration plan, write
// validation, the proof that the dashboard no longer reads navLabel, and (R2)
// the two approved R-B consumers (D-12) — the landing-title fallback and the
// llms.txt heading — whose null behaviour is today's output, byte for byte.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planPublicNameMigration, publicNameIssues, publicNameOf, resolvePublicName } from '../public-name'
import { catalogueLandingTitle, resolveCatalogueConfig, resolveCataloguePage, type RawCatalogueConfigRow } from '../resolve'
import { catalogueHeading } from '@/lib/seo/llms'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import * as queries from '@/lib/sanity/queries'

describe('resolvePublicName (C11.3)', () => {
  it('resolve/locale', () => expect(resolvePublicName({ it: 'Libri', en: 'Books' }, { locale: 'it', defaultLocale: 'en' })).toEqual({ text: 'Libri', source: 'locale' }))
  it('resolve/default', () => expect(resolvePublicName({ en: 'Books' }, { locale: 'de', defaultLocale: 'en' })).toEqual({ text: 'Books', source: 'default_locale' }))
  it('resolve/never-other-locale', () => expect(resolvePublicName({ it: 'Libri' }, { locale: 'de', defaultLocale: 'en' })).toEqual({ text: null, source: 'none' }))
  it('resolve/blank', () => expect(resolvePublicName({ en: '  ' }, { locale: 'en', defaultLocale: 'en' })).toEqual({ text: null, source: 'none' }))
  it('resolve/never-catalogue', () => {
    for (const names of [null, undefined, {}, { en: '' }, { fr: 'Livres' }]) expect(resolvePublicName(names, { locale: 'en', defaultLocale: 'en' }).text).not.toBe('Catalogue')
    expect(resolvePublicName({ en: 'Catalogue' }, { locale: 'en', defaultLocale: 'en' }).text).toBe('Catalogue') // only when the tenant typed it
  })
  it('publicNameOf reads module config, trimmed', () => {
    expect(publicNameOf({ publicName: { en: ' Menu ', _type: 'localizedString' } }, { locale: 'it', defaultLocale: 'en' })).toBe('Menu')
    expect(publicNameOf(null, { locale: 'en', defaultLocale: 'en' })).toBeNull()
  })
})

describe('planPublicNameMigration (C11.5, data step D4)', () => {
  it('migrate/copy-tmz', () => {
    expect(planPublicNameMigration({ navLabel: { de: 'Bücher ', en: ' Books', it: 'Libri', _type: 'localizedString' } })).toEqual({ action: 'copy', publicName: { de: 'Bücher', en: 'Books', it: 'Libri' }, unset: ['navLabel'] })
  })
  it('migrate/existing', () => {
    expect(planPublicNameMigration({ publicName: { en: 'Menu' }, navLabel: { en: 'Food' } })).toEqual({ action: 'drop', unset: ['navLabel'], discarded: { en: 'Food' } })
  })
  it('migrate/blank-nav', () => expect(planPublicNameMigration({ navLabel: { en: '' } })).toEqual({ action: 'none' }))
  it('migrate/partial-existing', () => {
    expect(planPublicNameMigration({ publicName: { it: 'Menu' }, navLabel: { en: 'Food', it: 'Cibo', de: 'Essen' } })).toEqual({ action: 'drop', unset: ['navLabel'], discarded: { en: 'Food', it: 'Cibo', de: 'Essen' } })
  })
  it('migrate/idempotent', () => {
    const before = { navLabel: { en: 'Books' } as Record<string, string> | undefined, publicName: undefined as Record<string, string> | undefined }
    const plan = planPublicNameMigration(before)
    const after = plan.action === 'copy' ? { publicName: plan.publicName } : before
    expect(planPublicNameMigration(after)).toEqual({ action: 'none' })
  })
  it('migrate/extra-locale', () => expect(planPublicNameMigration({ navLabel: { fr: 'Livres' } })).toEqual({ action: 'copy', publicName: { fr: 'Livres' }, unset: ['navLabel'] }))
  it('public-name.preserved: after the copy, the resolved name equals the old designated word for every locale', () => {
    const navLabel = { de: 'Bücher', en: 'Books', it: 'Libri' }
    const plan = planPublicNameMigration({ navLabel })
    expect(plan.action).toBe('copy')
    const after = plan.action === 'copy' ? plan.publicName : {}
    for (const locale of ['en', 'it', 'de', 'fr']) {
      const word = (navLabel as Record<string, string>)[locale] ?? navLabel.en
      expect(resolvePublicName(after, { locale, defaultLocale: 'en' }).text).toBe(word)
    }
  })
})

describe('publicNameIssues (C11.2, writes only)', () => {
  const ctx = { defaultLocale: 'en', locales: ['en', 'it'] }
  it('validate/default-required', () => expect(publicNameIssues({ it: 'Libri' }, ctx)).toEqual([{ code: 'public_name_default_required', locale: 'en' }]))
  it('validate/too-long', () => expect(publicNameIssues({ en: 'x'.repeat(41) }, ctx)).toEqual([{ code: 'public_name_too_long', locale: 'en' }]))
  it('markup, punctuation and unknown locales', () => {
    expect(publicNameIssues({ en: '<b>Menu</b>' }, ctx).map((i) => i.code)).toContain('public_name_invalid')
    expect(publicNameIssues({ en: 'Menu!' }, ctx).map((i) => i.code)).toEqual(['public_name_invalid'])
    expect(publicNameIssues({ en: 'Menu', fr: 'Carte' }, ctx)).toEqual([{ code: 'public_name_locale_unknown', locale: 'fr' }])
  })
  it('an empty map is valid (= not set)', () => {
    expect(publicNameIssues({}, ctx)).toEqual([])
    expect(publicNameIssues({ en: '  ', _type: 'localizedString' }, ctx)).toEqual([])
    expect(publicNameIssues({ en: 'Wine list', it: "Carta dei vini" }, ctx)).toEqual([])
  })
})

describe('schema (C11.2, C11.6 R-A1)', () => {
  const catalogue = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
  const field = (id: string) => catalogue.platformContract.configSchema.find((f) => f.id === id)
  it('publicName is a localized config field; navLabel stays, hidden and deprecated', () => {
    expect(field('publicName')).toMatchObject({ type: 'localizedString' })
    expect(field('publicName')!.description).toContain('the dashboard always says Catalogue')
    expect(field('navLabel')).toMatchObject({ hidden: true })
  })
  it('setupCompletedAt is module-written (hidden); its sibling source field is checked in packs/__tests__', () => {
    expect(field('setupCompletedAt')).toMatchObject({ hidden: true })
  })
})

// ── equiv/website-output (R-A build): nothing public reads the name ──────────

const SRC = join(process.cwd(), 'src')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(full, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
const filesUnder = (...dirs: string[]) => dirs.flatMap((d) => {
  const full = join(SRC, d)
  return statSync(full).isDirectory() ? walk(full) : [full]
})

describe('website-output.unchanged (C11.5 proof 2) — and the R-B consumers only where approved', () => {
  const WEBSITE = [
    'app/[locale]/(website)',
    'app/llms.txt',
    'app/sitemap.ts',
    'components/catalogue',
    'lib/seo',
    'lib/sanity/queries.ts',
    'lib/modules/catalogue/resolve.ts',
    'lib/modules/catalogue/website.ts',
    'lib/modules/catalogue/structured.ts',
  ]
  // C11.4 rows 1 and 6 (D-12) are the ONLY public consumers: the landing title (CatalogueRoute → resolve.ts)
  // and the llms.txt heading (route → lib/seo/llms.ts). Nothing else on a public surface reads the name.
  const R_B_CONSUMERS = ['components/catalogue/CatalogueRoute.tsx', 'lib/modules/catalogue/resolve.ts', 'lib/sanity/queries.ts', 'lib/seo/llms.ts', 'app/llms.txt/route.ts']
  it('no other public surface reads publicName, and none reads navLabel (Brand Hub has its own unrelated navLabel)', () => {
    const files = filesUnder(...WEBSITE)
      .map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }))
      .filter(({ rel }) => !rel.includes('/brand/'))
    expect(files.filter(({ text }) => /\bnavLabel\b/.test(text)).map((f) => f.rel)).toEqual([])
    expect(files.filter(({ rel, text }) => /\bpublicName\b/.test(text) && !R_B_CONSUMERS.some((c) => rel.split('\\').join('/') === c)).map((f) => f.rel)).toEqual([])
  })
  it('the website queries never project navLabel; only the catalogue config query projects publicName', () => {
    for (const [name, q] of Object.entries(queries)) {
      if (typeof q !== 'string') continue
      expect(q, name).not.toMatch(/navLabel/)
      if (name !== 'catalogueModuleConfigQuery') expect(q, name).not.toMatch(/publicName/)
    }
  })
  const TMZ_ROW = (config: Record<string, unknown>): RawCatalogueConfigRow =>
    ({ catalogue: { currency: 'EUR', publicSegment: 'books', ...config }, categoryTerms: [{ key: 'design', order: 2000, label: 'Design' }], tagTerms: [], timeZone: 'Europe/Rome' }) as RawCatalogueConfigRow
  it('equiv/website-output: tmz config resolves byte-equal with navLabel and with neither; with publicName it only gains the name', () => {
    const base = JSON.stringify(resolveCatalogueConfig(TMZ_ROW({}), 'en', 'en'))
    expect(JSON.stringify(resolveCatalogueConfig(TMZ_ROW({ navLabel: { en: 'Books', it: 'Libri', de: 'Bücher' } }), 'en', 'en'))).toBe(base)
    expect(JSON.stringify(resolveCatalogueConfig(TMZ_ROW({ publicName: {} }), 'en', 'en'))).toBe(base)
    const named = resolveCatalogueConfig(TMZ_ROW({ publicName: { en: 'Books', it: 'Libri', de: 'Bücher' } }), 'it', 'en')!
    const { publicName, ...rest } = named
    expect(publicName).toBe('Libri')
    expect(JSON.stringify(rest)).toBe(JSON.stringify(resolveCatalogueConfig(TMZ_ROW({}), 'it', 'en')))
    // Locale → default locale, never another language.
    expect(resolveCatalogueConfig(TMZ_ROW({ publicName: { en: 'Books' } }), 'de', 'en')!.publicName).toBe('Books')
    expect(resolveCatalogueConfig(TMZ_ROW({ publicName: { it: 'Libri' } }), 'de', 'en')!).not.toHaveProperty('publicName')
  })
  it('landing-title/tmz and landing-title/no-title-project: the landing page DTO carries no name', () => {
    const tmz = resolveCataloguePage({ heroTitle: 'Between the Lines', seoTitle: 'Between the Lines — books' }, 'en', 'en')
    const bare = resolveCataloguePage({}, 'en', 'en')
    expect(JSON.stringify(tmz)).not.toMatch(/Books|publicName/)
    expect(bare).toMatchObject({ heroTitle: null, seoTitle: null })
  })
})

describe('C11 R-B consumers (D-12)', () => {
  // The exact rule CatalogueRoute used before R-B, kept as the oracle for the null case.
  const before = (p: { seoTitle?: string | null; heroTitle?: string | null }, site: string) => p.seoTitle ?? (p.heroTitle ? `${p.heroTitle} — ${site}` : site)
  const pages = [{ seoTitle: 'Between the Lines — books', heroTitle: 'Between the Lines' }, { heroTitle: 'Our menu' }, { seoTitle: 'Menu' }, {}, { seoTitle: null, heroTitle: null }]
  it('landing-title/fallback: no seoTitle, no heroTitle, publicName Menu → "Menu — Site"; null name → "Site"', () => {
    expect(catalogueLandingTitle({}, 'Site', 'Menu')).toBe('Menu — Site')
    expect(catalogueLandingTitle({}, 'Site', null)).toBe('Site')
    expect(catalogueLandingTitle({}, 'Site')).toBe('Site')
  })
  it('landing-title/no-name: byte-equal to the pre-R-B title for every page shape', () => {
    for (const p of pages) expect(catalogueLandingTitle(p, 'Site', undefined)).toBe(before(p, 'Site'))
  })
  it('landing-title/tmz: existing titles win — unchanged with or without a public name', () => {
    for (const p of pages.slice(0, 3)) expect(catalogueLandingTitle(p, 'tmz.it', 'Books')).toBe(before(p, 'tmz.it'))
  })
  it('llms/heading: null name → "## Catalogue" exactly as before; a name per language block, the default bare', () => {
    for (const names of [null, undefined, {}, { en: '  ' }]) {
      expect(catalogueHeading(names, 'en', 'en')).toBe('## Catalogue')
      expect(catalogueHeading(names, 'it', 'en')).toBe('## Catalogue (it)')
    }
    const tmz = { en: 'Books', it: 'Libri', de: 'Bücher' }
    expect(['en', 'it', 'de'].map((l) => catalogueHeading(tmz, l, 'en'))).toEqual(['## Books', '## Libri (it)', '## Bücher (de)'])
  })
  it('llms/heading: partial names fall back locale → default, never to another language', () => {
    expect(catalogueHeading({ en: 'Books' }, 'de', 'en')).toBe('## Books (de)')
    expect(catalogueHeading({ it: 'Libri' }, 'de', 'en')).toBe('## Catalogue (de)')
  })
})

describe('no-reader-left (dashboard part, R-A1)', () => {
  const DASHBOARD = ['app/[locale]/(client)', 'components/client', 'lib/client', 'lib/api', 'lib/modules/client-navigation.ts', 'lib/modules/catalogue/dashboard-queries.ts']
  it('no dashboard code reads navLabel any more', () => {
    const offenders = filesUnder(...DASHBOARD)
      .map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }))
      .filter(({ text }) => /\bnavLabel\b|loadCatalogueNavLabel|CATALOGUE_NAV_LABEL_QUERY/.test(text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})

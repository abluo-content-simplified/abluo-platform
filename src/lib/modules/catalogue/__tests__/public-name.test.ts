// Contract C11.8 — public name fixtures (R-A1 scope: reader, pure migration plan,
// write validation, and the proofs that website output is unchanged and the
// dashboard no longer reads navLabel). The R-B consumers (landing-title
// fallback, llms.txt heading) ship with data step D4 and are NOT wired here.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planPublicNameMigration, publicNameIssues, publicNameOf, resolvePublicName } from '../public-name'
import { resolveCatalogueConfig, resolveCataloguePage, type RawCatalogueConfigRow } from '../resolve'
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

describe('website-output.unchanged (C11.5 proof 2, R-A1)', () => {
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
  it('no public surface reads publicName or navLabel (Brand Hub has its own unrelated navLabel)', () => {
    const offenders = filesUnder(...WEBSITE)
      .map((f) => ({ rel: relative(SRC, f), text: readFileSync(f, 'utf8') }))
      .filter(({ rel }) => !rel.includes('/brand/'))
      .filter(({ text }) => /\bpublicName\b|\bnavLabel\b/.test(text))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
  it('the website queries never project the names', () => {
    for (const [name, q] of Object.entries(queries)) {
      if (typeof q !== 'string') continue
      expect(q, name).not.toMatch(/publicName|navLabel/)
    }
  })
  const TMZ_ROW = (config: Record<string, unknown>): RawCatalogueConfigRow =>
    ({ catalogue: { currency: 'EUR', publicSegment: 'books', ...config }, categoryTerms: [{ key: 'design', order: 2000, label: 'Design' }], tagTerms: [], timeZone: 'Europe/Rome' }) as RawCatalogueConfigRow
  it('equiv/website-output: tmz config resolves byte-equal with navLabel, with publicName, and with neither', () => {
    const base = JSON.stringify(resolveCatalogueConfig(TMZ_ROW({}), 'en', 'en'))
    expect(JSON.stringify(resolveCatalogueConfig(TMZ_ROW({ navLabel: { en: 'Books', it: 'Libri', de: 'Bücher' } }), 'en', 'en'))).toBe(base)
    expect(JSON.stringify(resolveCatalogueConfig(TMZ_ROW({ publicName: { en: 'Books', it: 'Libri', de: 'Bücher' } }), 'en', 'en'))).toBe(base)
  })
  it('landing-title/tmz and landing-title/no-title-project: the landing page DTO carries no name (R-B not wired)', () => {
    const tmz = resolveCataloguePage({ heroTitle: 'Between the Lines', seoTitle: 'Between the Lines — books' }, 'en', 'en')
    const bare = resolveCataloguePage({}, 'en', 'en')
    expect(JSON.stringify(tmz)).not.toMatch(/Books|publicName/)
    expect(bare).toMatchObject({ heroTitle: null, seoTitle: null })
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

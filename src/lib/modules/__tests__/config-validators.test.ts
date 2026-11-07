import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import {
  CHANGE_GUARDS,
  FIELD_VALIDATORS,
  configDataNeeds,
  loadConfigData,
  pageFirstSegments,
  pageFirstSegmentsByLocale,
  pendingGuards,
  persistedExtras,
  resolveFieldValidator,
} from '../config-validators'
import type { ModuleConfigFieldDef } from '../types'

const catalogue = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
const schema = catalogue.platformContract.configSchema
const field = (id: string) => schema.find((f) => f.id === id) as ModuleConfigFieldDef

describe('registry wiring', () => {
  it('every declared validator and changeGuard id resolves', () => {
    for (const m of MODULE_REGISTRY)
      for (const f of m.platformContract.configSchema) {
        if (f.validator) expect(FIELD_VALIDATORS[f.validator], `${m.id}.${f.id}`).toBeDefined()
        if (f.changeGuard) expect(CHANGE_GUARDS[f.changeGuard], `${m.id}.${f.id}`).toBeDefined()
      }
  })
})

describe('pageFirstSegments / loadConfigData', () => {
  it('reads localized slug objects and strings, first segment only', () => {
    expect(
      pageFirstSegments([{ slug: { en: { current: 'Menu/lunch' }, it: { current: 'carta' } } }, { slug: 'about' }, { slug: null }]).sort(),
    ).toEqual(['about', 'carta', 'menu'])
  })
  it('scopes every fetch by projectSlug', async () => {
    const calls: unknown[] = []
    const client = { fetch: async <T,>(q: string, p: Record<string, unknown>) => (calls.push(p), [] as unknown as T) }
    await loadConfigData(client, ['pageSlugs', 'itemPrices', 'pageSlugs'], 'proj')
    expect(calls).toEqual([{ projectSlug: 'proj' }, { projectSlug: 'proj' }])
  })
})

describe('catalogue.publicSegment', () => {
  const v = resolveFieldValidator('catalogue.publicSegment')!
  const f = field('publicSegment')
  const run = (value: string, stored?: Record<string, unknown>, pages = [{ slug: { en: { current: 'about' } } }]) =>
    v.validate({ field: f, value, values: {}, stored, data: { pageSlugs: pages } })

  it('names a page-slug clash', () => {
    expect(run('about').error).toMatch(/already the start of one of your pages/)
  })
  it('names a reserved route', () => {
    expect(run('events').error).toMatch(/already used by the website/)
  })
  it('accepts a free word with no notice', () => {
    expect(run('menu')).toEqual({ error: null, notice: null })
  })
  it('flags a revert with the notice, not an error', () => {
    const r = run('menu', { publicSegment: 'carta', publicSegmentHistory: ['menu'] })
    expect(r.error).toBeNull()
    expect(r.notice).toMatch(/was used before/)
  })
  it('does not re-litigate an unchanged saved value', () => {
    expect(run('about', { publicSegment: 'about' }).error).toBeNull()
  })
  it('persists history: rename appends, revert removes, first set adds nothing', () => {
    const p = (value: string, stored?: Record<string, unknown>) =>
      v.persist!({ field: f, value, values: {}, stored, data: {} })
    expect(p('carta', { publicSegment: 'menu', publicSegmentHistory: [] })).toEqual({ publicSegment: 'carta', publicSegmentHistory: ['menu'] })
    expect(p('menu', { publicSegment: 'carta', publicSegmentHistory: ['menu'] })).toEqual({ publicSegment: 'menu', publicSegmentHistory: ['carta'] })
    expect(p('menu')).toEqual({ publicSegment: 'menu', publicSegmentHistory: [] })
  })
  it('persistedExtras collects it through the schema', () => {
    expect(persistedExtras(schema, { publicSegment: 'carta' }, { publicSegment: 'menu' }, {})).toMatchObject({
      publicSegment: 'carta',
      publicSegmentHistory: ['menu'],
    })
  })
})

describe('catalogue.currencyChange', () => {
  const data = {
    itemPrices: [
      { _id: 'a', prices: [1, 2] },
      { _id: 'drafts.a', prices: [1, 2, 3] },
      { _id: 'b', prices: [4] },
    ],
    optionDeltas: [{ _id: 'o', deltas: [1.5, 0] }],
  }
  it('warns with counts, mentions options, converts nothing', () => {
    const [g] = pendingGuards(schema, { currency: 'CHF' }, { currency: 'EUR' }, data)
    expect(g.result.lines[0]).toBe('4 prices across 2 items will be read as CHF. No amounts are converted.')
    expect(g.result.lines[1]).toBe('Also 1 option price change.')
  })
  it('no guard when unchanged, first configuration, or nothing is priced', () => {
    expect(pendingGuards(schema, { currency: 'EUR' }, { currency: 'eur' }, data)).toEqual([])
    expect(pendingGuards(schema, { currency: 'CHF' }, undefined, data)).toEqual([])
    expect(pendingGuards(schema, { currency: 'CHF' }, { currency: 'EUR' }, { itemPrices: [], optionDeltas: [] })).toEqual([])
  })
  it('declares the data it needs', () => {
    expect(configDataNeeds(schema, { guards: true }).sort()).toEqual(['itemPrices', 'optionDeltas', 'pageSlugs'])
    expect(configDataNeeds(schema, { guards: false })).toEqual(['pageSlugs'])
  })
})

describe('people.profileSegment', () => {
  const people = MODULE_REGISTRY.find((m) => m.id === 'people')!
  const pf = people.platformContract.configSchema.find((f) => f.id === 'profileSegment') as ModuleConfigFieldDef
  const v = resolveFieldValidator('people.profileSegment')!
  const pages = [
    { slug: { en: { current: 'about' }, it: { current: 'chi-siamo/storia' } } },
    { slug: { en: { current: 'doctors/list' } } },
  ]
  const run = (
    value: Record<string, string>,
    o: { stored?: Record<string, unknown>; pages?: typeof pages; catalogueSegment?: string[] } = {},
  ) =>
    v.validate({
      field: pf,
      value,
      values: {},
      stored: o.stored,
      data: { pageSlugs: o.pages ?? pages, catalogueSegment: o.catalogueSegment ?? [] },
    })

  it('is wired in the manifest and needs pages + the catalogue and course segments', () => {
    expect(pf.validator).toBe('people.profileSegment')
    expect(configDataNeeds(people.platformContract.configSchema, { guards: false }).sort()).toEqual(['catalogueSegment', 'courseSegment', 'pageSlugs'])
  })

  it('accepts free segments, one per language, and empty values', () => {
    expect(run({ en: 'team', it: 'insegnanti', de: '' })).toEqual({ error: null, notice: null })
    expect(run({})).toEqual({ error: null, notice: null })
  })

  it('rejects anything that is not one lowercase url-safe segment', () => {
    for (const bad of ['Team', 'our team', 'a/b', 'tèam', '-x', 'x--y'])
      expect(run({ en: bad }).error, bad).toMatch(/English \(en\): ".*" is not a valid address/)
  })

  it('names a reserved word', () => {
    expect(run({ en: 'blog' }).error).toMatch(/English \(en\): "blog" is already used by the website/)
    expect(run({ it: 'users' }).error).toMatch(/Italian \(it\): "users" is already used/)
  })

  it('names a clash with a page of THAT language only', () => {
    expect(run({ en: 'about' }).error).toMatch(/English \(en\): "about" is already the start of one of your English pages/)
    expect(run({ it: 'chi-siamo' }).error).toMatch(/Italian \(it\): "chi-siamo" is already the start of one of your Italian pages/)
    // 'about' is an English page; the same word in Italian is free, and vice versa.
    expect(run({ it: 'about' }).error).toBeNull()
    expect(run({ en: 'chi-siamo' }).error).toBeNull()
  })

  it('names a clash with the catalogue segment', () => {
    expect(run({ en: 'menu' }, { catalogueSegment: ['menu'] }).error).toMatch(/"menu" is already the address of your catalogue/)
    expect(run({ en: 'menu' }, { catalogueSegment: [] }).error).toBeNull()
  })

  it('reports every offending language, and does not re-litigate an unchanged saved value', () => {
    const r = run({ en: 'about', it: 'blog', de: 'team' })
    expect(r.error).toMatch(/English/)
    expect(r.error).toMatch(/Italian/)
    expect(r.error).not.toMatch(/German/)
    expect(run({ en: 'about' }, { stored: { profileSegment: { en: 'about' } } }).error).toBeNull()
  })

  it('pageFirstSegmentsByLocale groups first segments per language', () => {
    expect(pageFirstSegmentsByLocale(pages)).toEqual({ en: ['about', 'doctors'], it: ['chi-siamo'] })
  })

  it('loads the catalogue segment scoped by projectSlug', async () => {
    const calls: unknown[] = []
    const client = { fetch: async <T,>(_q: string, p: Record<string, unknown>) => (calls.push(p), ['menu'] as unknown as T) }
    expect(await loadConfigData(client, ['catalogueSegment'], 'proj')).toEqual({ catalogueSegment: ['menu'] })
    expect(calls).toEqual([{ projectSlug: 'proj' }])
  })
})

describe('courses.courseSegment', () => {
  const courses = MODULE_REGISTRY.find((m) => m.id === 'courses')!
  const cf = courses.platformContract.configSchema.find((f) => f.id === 'courseSegment') as ModuleConfigFieldDef
  const v = resolveFieldValidator('courses.courseSegment')!
  const pages = [{ slug: { en: { current: 'about' }, fr: { current: 'horaires' } } }]
  const run = (value: Record<string, string>, o: { stored?: Record<string, unknown>; catalogueSegment?: string[]; peopleSegment?: unknown[] } = {}) =>
    v.validate({ field: cf, value, values: {}, stored: o.stored, data: { pageSlugs: pages, catalogueSegment: o.catalogueSegment ?? [], peopleSegment: o.peopleSegment ?? [] } })

  it('is a localized field wired to its validator, needing pages + the catalogue and people segments', () => {
    expect(cf).toMatchObject({ type: 'localizedString', validator: 'courses.courseSegment' })
    expect(configDataNeeds(courses.platformContract.configSchema, { guards: false }).sort()).toEqual(['catalogueSegment', 'pageSlugs', 'peopleSegment'])
  })

  it('accepts free segments per language and empty values', () => {
    expect(run({ en: 'classes', fr: 'cours', de: '' })).toEqual({ error: null, notice: null })
    // The dashboard's own route word.
    expect(run({ en: 'courses' }).error).toMatch(/"courses" is already used by the website/)
  })

  it('refuses bad syntax, platform words, a page of that language and the catalogue', () => {
    expect(run({ en: 'Our Courses' }).error).toMatch(/English \(en\): ".*" is not a valid address/)
    expect(run({ en: 'blog' }).error).toMatch(/"blog" is already used by the website/)
    expect(run({ fr: 'horaires' }).error).toMatch(/French \(fr\): "horaires" is already the start of one of your French pages/)
    expect(run({ en: 'horaires' }).error).toBeNull()
    expect(run({ en: 'menu' }, { catalogueSegment: ['menu'] }).error).toMatch(/address of your catalogue/)
  })

  it('refuses the People profile segment of the same language only', () => {
    const peopleSegment = [{ _type: 'localizedString', en: 'team', fr: 'equipe' }]
    expect(run({ en: 'team' }, { peopleSegment }).error).toMatch(/English \(en\): "team" is already the address of your people pages/)
    expect(run({ fr: 'team' }, { peopleSegment }).error).toBeNull()
    expect(run({ en: 'team' }, { peopleSegment, stored: { courseSegment: { en: 'team' } } }).error).toBeNull()
  })

  it('and the People rule refuses the course segment back', () => {
    const people = MODULE_REGISTRY.find((m) => m.id === 'people')!
    const pf = people.platformContract.configSchema.find((f) => f.id === 'profileSegment') as ModuleConfigFieldDef
    const pv = resolveFieldValidator('people.profileSegment')!
    const r = pv.validate({ field: pf, value: { fr: 'cours' }, values: {}, stored: undefined, data: { pageSlugs: [], catalogueSegment: [], courseSegment: [{ fr: 'cours' }] } })
    expect(r.error).toMatch(/French \(fr\): "cours" is already the address of your course pages/)
  })

  it('loads both module segments scoped by projectSlug', async () => {
    const calls: Array<[string, unknown]> = []
    const client = { fetch: async <T,>(q: string, p: Record<string, unknown>) => (calls.push([q, p]), [{ en: 'x' }] as unknown as T) }
    await loadConfigData(client, ['peopleSegment', 'courseSegment'], 'proj')
    expect(calls.map(([, p]) => p)).toEqual([{ projectSlug: 'proj' }, { projectSlug: 'proj' }])
    expect(calls[0][0]).toContain('moduleId == "people"')
    expect(calls[1][0]).toContain('moduleId == "courses"')
  })
})

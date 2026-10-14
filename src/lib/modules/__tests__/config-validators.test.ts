import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import {
  CHANGE_GUARDS,
  FIELD_VALIDATORS,
  configDataNeeds,
  loadConfigData,
  pageFirstSegments,
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

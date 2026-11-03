// C10-6 step 7 / C6 §6.13 item 2 — rule activation per project by markers.
// The model-dependent rules (primaryCategoryMissing, price/availability rules,
// integrity.*) run only when BOTH `catalogueMigrations.taxonomy` and
// `.commerce` are set for the project — in the editor (client facts), at the
// publish gate (server facts) and on the Items list badges. Without both,
// everything behaves exactly as in R1.
import { describe, expect, it } from 'vitest'
import { EMPTY_BOOK_DETAILS, NOT_REVIEWED, emptyFormats, type ItemState } from '../../dashboard-form'
import { itemIssues, publishBlockers, type ItemIssueContext } from '../../item-issues'
import { readChannels } from '../../commerce/channels'
import { buildTree } from '../../taxonomy/tree'
import type { CategoryNode } from '../../taxonomy/types'
import { WEBSITE, evaluateItem } from '../engine'
import { itemReadinessInputFromState } from '../facts-client'
import { MODEL_DEPENDENT_RULES, itemReadinessInputFromDoc } from '../facts-doc'
import { activationMarkers, modelRulesActive } from '../facts-model'
import { GAP_CODES, gapsFromResult, readinessGaps } from '../chips'
import { DEFAULT_RULES } from '../rules'
import { bornMigratedMarkers, installTimeConfig } from '../../migration-markers'
import { cataloguePublishGate, modelReadinessBlockers } from '@/lib/api/catalogue-publish-gate'
import { migrationsOf, type CatalogueSite } from '@/lib/api/catalogue-drafts'
import type { LifecycleClient, PublishNode } from '@/lib/lifecycle/service'

const node = (key: string, parentKey: string | null = null): CategoryNode => ({ key, label: { it: key }, parentKey, order: 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null })
const NODES = [node('food'), node('pizza', 'food')]
const TREE = buildTree(NODES)
const SERVICE_CHANNELS = [{ value: 'takeaway', label: { it: 'Asporto' }, defaultAvailability: 'available' }]
const CHANNELS = readChannels(SERVICE_CHANNELS).channels
const BOTH = { taxonomy: '2026-11-03T10:00:00.000Z', commerce: '2026-11-03T10:00:00.000Z' }
const ONLY_TAXONOMY = { taxonomy: '2026-11-03T10:00:00.000Z' }

const state: ItemState = {
  itemProfile: 'product',
  name: { it: 'Margherita' },
  byline: {},
  bookDetails: EMPTY_BOOK_DETAILS,
  description: {},
  links: [],
  assignment: { primary: null, additional: [] },
  tags: [],
  imageIds: [],
  formats: emptyFormats(),
  itemRules: {},
  allergenDeclaration: NOT_REVIEWED,
  dietary: [],
  options: [],
  hasPage: false,
  slug: {},
  visibility: 'public',
}
const ctx = (migrations?: Record<string, string>): ItemIssueContext => ({ defaultLocale: 'it', locales: ['it'], channels: ['takeaway'], optionCounts: new Map(), channelSet: CHANNELS, tree: TREE, timeZone: 'Europe/Rome', migrations })
const ids = (s: ItemState, m?: Record<string, string>) => publishBlockers(itemIssues(s, ctx(m))).map((i) => i.id)

describe('markers', () => {
  it('both data steps verified, or nothing (C10-6 step 7)', () => {
    expect(modelRulesActive(BOTH)).toBe(true)
    expect(modelRulesActive(ONLY_TAXONOMY)).toBe(false)
    expect(modelRulesActive({})).toBe(false)
    expect(modelRulesActive(undefined)).toBe(false)
    expect(activationMarkers(ONLY_TAXONOMY)).toEqual({})
    expect(activationMarkers(BOTH)).toBe(BOTH)
  })
  it('module config markers are read as ISO strings only (the stored object type and junk dropped)', () => {
    expect(migrationsOf({ _type: 'catalogueMigrationMarkers', taxonomy: 'a', commerce: 'b', other: 'x', publicName: 3 })).toEqual({ taxonomy: 'a', commerce: 'b' })
    expect(migrationsOf(null)).toEqual({})
  })
  it('a new Catalogue installation is born migrated; other modules get nothing', () => {
    const at = new Date('2026-11-03T12:00:00.000Z')
    expect(bornMigratedMarkers(at)).toEqual({ _type: 'catalogueMigrationMarkers', taxonomy: at.toISOString(), commerce: at.toISOString() })
    expect(modelRulesActive(migrationsOf(installTimeConfig('catalogue', at).catalogueMigrations))).toBe(true)
    expect(installTimeConfig('gallery', at)).toEqual({})
  })
  it('MODEL_DEPENDENT_RULES are exactly the taxonomy/commerce-activated rules', () => {
    expect(MODEL_DEPENDENT_RULES.map((r) => r.code)).toEqual(DEFAULT_RULES.filter((r) => r.activation === 'taxonomy' || r.activation === 'commerce').map((r) => r.code))
    expect(MODEL_DEPENDENT_RULES.map((r) => r.code)).toEqual(expect.arrayContaining(['primaryCategoryMissing', 'categoryMissing', 'priceMissing', 'integrity.currencyStored', 'integrity.unknownCategory']))
  })
})

describe('editor (client facts) — marker absent / present', () => {
  it('absent: no category is ever a publish blocker (R1 behaviour)', () => {
    expect(ids(state)).toEqual([])
    expect(ids(state, ONLY_TAXONOMY)).toEqual([])
  })
  it('present: no category, then additional without a main one, both block publishing, with a link to the category step', () => {
    expect(ids(state, BOTH)).toEqual(['categoryMissing'])
    expect(ids({ ...state, assignment: { primary: null, additional: ['pizza'] } }, BOTH)).toEqual(['primaryCategory'])
    const [issue] = publishBlockers(itemIssues({ ...state, assignment: { primary: null, additional: ['pizza'] } }, ctx(BOTH)))
    expect(issue).toMatchObject({ severity: 'blocksPublish', step: 'category', tab: 'content', messageKey: 'primaryCategoryMissing', values: { reason: 'noPrimary' } })
    expect(ids({ ...state, assignment: { primary: 'pizza', additional: [] } }, BOTH)).toEqual([])
  })
  it('a missing price is never a blocker on the website (D-8: recommended)', () => {
    const r = evaluateItem(itemReadinessInputFromState({ ...state, assignment: { primary: 'pizza', additional: [] } }, ctx(BOTH)), WEBSITE)
    expect(r.required).toEqual([])
    expect(r.recommended.map((f) => f.code)).toContain('priceMissing')
  })
})

describe('publish gate (server facts) — marker absent / present', () => {
  const site = (migrations: Record<string, string>) => ({ defaultLocale: 'it', locales: ['it'], timeZone: 'Europe/Rome', config: { serviceChannels: SERVICE_CHANNELS, categoryNodes: NODES, migrations } }) as unknown as CatalogueSite
  const client = { fetch: async () => [] } as unknown as LifecycleClient
  const publish = (s: CatalogueSite, draft: Record<string, unknown>) =>
    cataloguePublishGate(s, () => 'u')({ d: { type: 'catalogueItem', label: () => 'x' }, id: 'i1', draft, published: undefined, isRoot: true } as unknown as PublishNode, { client, projectSlug: 'p' })
  const doc = { itemProfile: 'product', name: { it: 'Margherita' } }

  it('absent: unchanged (publishes without a category)', async () => {
    expect(modelReadinessBlockers(site({}), 'i1', doc)).toEqual([])
    await expect(publish(site(ONLY_TAXONOMY), doc)).resolves.toMatchObject({ name: { it: 'Margherita' } })
  })
  it('present: refused as not_ready naming every required finding; a main category clears it', async () => {
    await expect(publish(site(BOTH), doc)).rejects.toMatchObject({ code: 'not_ready', detail: { readiness: [expect.objectContaining({ code: 'categoryMissing', level: 'required' })] } })
    await expect(publish(site(BOTH), { ...doc, additionalCategories: ['pizza'] })).rejects.toMatchObject({ code: 'not_ready', detail: { readiness: [expect.objectContaining({ code: 'primaryCategoryMissing' })] } })
    await expect(publish(site(BOTH), { ...doc, primaryCategory: 'pizza' })).resolves.toMatchObject({ primaryCategory: 'pizza' })
  })
  it('present: a legacy list publishes with its first existing category as primary (D-15)', async () => {
    expect(modelReadinessBlockers(site(BOTH), 'i1', { ...doc, categories: ['gone', 'pizza'] }).map((f) => f.code)).toEqual(['integrity.unknownCategory'])
    expect(modelReadinessBlockers(site(BOTH), 'i1', { ...doc, categories: ['pizza'] })).toEqual([])
  })
  it('present: integrity — a stored reserved currency and a stored price overlap refuse publishing', () => {
    const priced = (prices: unknown[]) => ({ ...doc, primaryCategory: 'pizza', formats: [{ _key: 'default', prices }] })
    expect(modelReadinessBlockers(site(BOTH), 'i1', priced([{ _key: 'a', amount: 5, currency: 'USD' }])).map((f) => f.code)).toEqual(['integrity.currencyStored'])
    expect(modelReadinessBlockers(site(BOTH), 'i1', priced([{ _key: 'a', amount: 5 }, { _key: 'b', amount: 6 }])).map((f) => f.code)).toEqual(['price.ambiguous'])
    expect(modelReadinessBlockers(site(BOTH), 'i1', priced([{ _key: 'a', amount: 5 }]))).toEqual([])
  })
})

describe('R-30: editor and gate judge the same model alike', () => {
  it('same item through client state and stored document → same model-rule findings', () => {
    const cases: Array<[Partial<ItemState>, Record<string, unknown>]> = [
      [{}, {}],
      [{ assignment: { primary: null, additional: ['pizza'] } }, { additionalCategories: ['pizza'] }],
      [{ assignment: { primary: 'pizza', additional: [] } }, { primaryCategory: 'pizza' }],
      [{ assignment: { primary: 'pizza', additional: [] }, formats: [{ ...emptyFormats()[0], prices: [{ key: 'a', scope: null, amount: 4, note: null, windows: [] }] }] }, { primaryCategory: 'pizza', formats: [{ _key: 'default', prices: [{ _key: 'a', amount: 4 }] }] }],
      [{ itemRules: { takeaway: { state: 'unavailable', overrides: [] } } }, { channelAvailability: [{ _key: 'takeaway', channel: 'takeaway', state: 'unavailable' }] }],
    ]
    const facts = { id: 'i1', defaultLocale: 'it', locales: ['it'], channels: CHANNELS, tree: TREE, timeZone: 'Europe/Rome', migrations: BOTH }
    const judge = (input: Parameters<typeof evaluateItem>[0]) => {
      const r = evaluateItem(input, WEBSITE, { families: ['standard', 'integrity'], rules: MODEL_DEPENDENT_RULES })
      return [...r.required, ...r.recommended].map((f) => [f.code, f.target.kind, f.target.formatKey ?? null])
    }
    for (const [s, d] of cases) {
      const client = judge(itemReadinessInputFromState({ ...state, ...s, id: 'i1' }, ctx(BOTH)))
      const server = judge(itemReadinessInputFromDoc({ itemProfile: 'product', name: { it: 'Margherita' }, ...d }, facts))
      expect(client, JSON.stringify(d)).toEqual(server)
    }
  })
})

describe('Items list badges (C6 §6.6) — engine when migrated, legacy counts otherwise', () => {
  const legacy = { imageCount: 0, offerCount: 0, allergensNotReviewed: false, categoryCount: 0 }
  const input = () => itemReadinessInputFromDoc({ itemProfile: 'product', name: { it: 'x' }, additionalCategories: ['pizza'] }, { id: 'i', defaultLocale: 'it', locales: ['it'], channels: CHANNELS, tree: TREE, timeZone: null, migrations: BOTH })
  it('absent: exactly the legacy itemGaps', () => {
    expect(readinessGaps({}, input, legacy)).toEqual(['noPhoto', 'noPrice', 'noCategory'])
  })
  it('present: from the engine (website context) — main category missing, no price, no photo', () => {
    expect(readinessGaps(BOTH, input, legacy)).toEqual(['noPhoto', 'noPrice', 'noPrimaryCategory'])
  })
  it('the mapping is one table; an overridden finding raises no badge', () => {
    expect(Object.keys(GAP_CODES)).toEqual(['noPhoto', 'noPrice', 'allergensNotReviewed', 'noCategory', 'noPrimaryCategory', 'profileMismatch'])
    expect(gapsFromResult({ required: [], recommended: [] })).toEqual([])
  })
})

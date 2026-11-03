/** D1–D4 planning cores on the frozen tmz production shapes — pure, no network. */
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { simulate } from '../lib/mutations'
import { catalogueInstallation, type Doc } from '../lib/docs'
import { markerGroup, type StepContext } from '../lib/step'
import { catalogueProjects } from '../lib/docs'
import { taxonomyStep } from '../lib/step-taxonomy'
import { commerceStep } from '../lib/step-commerce'
import { imageShapeToWrite, packHistoryStep } from '../lib/step-pack-history'
import { catalogueImageShape } from '@/lib/modules/catalogue/list-model'
import { publicNameStep, publicNameConfig } from '../lib/step-public-name'
import { readPackHistory } from '@/lib/modules/catalogue/packs/history'
import { isSetupComplete, readSetupState } from '@/lib/modules/catalogue/packs/setup-state'
import { itemCategoryAssignment } from '@/lib/modules/catalogue/taxonomy/read'
import { tmzProduction, TMZ_APPLIED_AT } from './fixtures/tmz-production'

const CTX: StepContext = { now: '2026-11-05T10:00:00.000Z', migrationId: 'test-run' }
const groupsOf = (plan: ReturnType<typeof taxonomyStep.plan>) => plan.projects.flatMap((p) => p.groups)
const run = (step: typeof taxonomyStep | typeof commerceStep | typeof packHistoryStep | typeof publicNameStep, docs: Doc[]) => {
  const plan = step.plan(docs, CTX)
  const after = simulate(docs, groupsOf(plan))
  return { plan, after, verification: step.verify(docs, after, CTX) }
}
const configOf = (docs: Doc[], id = 'project-tmz') => catalogueInstallation(docs.find((d) => d._id === id))!.config
const withMarkers = (docs: Doc[], ...steps: ('taxonomy' | 'commerce' | 'packHistory')[]) => {
  let out = docs
  for (const s of steps) out = simulate(out, catalogueProjects(out).map((v) => markerGroup(v, s, CTX.now, [])))
  return out
}

describe('D1 taxonomy on tmz', () => {
  it('seeds 3 root categories (order 1000/2000/3000) and 7 tags with keys verbatim, incl. illustrated_boos', () => {
    const { plan, after, verification } = run(taxonomyStep, tmzProduction())
    expect(plan.refusals).toEqual([])
    const tax = after.find((d) => d._id === 'catalogue-taxonomy.tmz')!
    expect((tax.categories as { key: string; order: number; parentKey?: string }[]).map((c) => [c.key, c.order, c.parentKey ?? null])).toEqual([
      ['technology', 1000, null],
      ['design', 2000, null],
      ['literature', 3000, null],
    ])
    expect((tax.tags as { key: string }[]).map((t) => t.key)).toEqual(['fantasy', 'humour', 'illustrated_boos', 'inspirational', 'memoir', 'satire', 'science_fiction'])
    expect((tax.categories as { label: unknown }[])[0].label).toEqual({ _type: 'localizedString', en: 'Technology', it: 'Tecnologia', de: 'Technologie' })
    expect(verification.pass).toBe(true)
  })

  it('assigns every item document (published and draft) with the same function; categories kept; D-15 first existing = primary', () => {
    const { plan, after } = run(taxonomyStep, tmzProduction())
    expect(plan.projects[0].counts).toMatchObject({ itemsAssigned: 15, itemsUnassigned: 1, itemsAlreadyAssigned: 0 })
    const two = after.find((d) => d._id === 'drafts.c2c4fa97-0011')!
    expect([two.primaryCategory, two.additionalCategories]).toEqual(['technology', ['literature']])
    expect(two.categories).toEqual(['technology', 'literature'])
    const food = after.find((d) => d._id === 'drafts.c2c4fa97-0012')!
    expect(food).not.toHaveProperty('primaryCategory')
    const pub = after.find((d) => d._id === 'b1a7e0c2-0001')!
    const draft = after.find((d) => d._id === 'drafts.b1a7e0c2-0001')!
    expect(itemCategoryAssignment(pub as never)).toEqual(itemCategoryAssignment(draft as never))
    // the pair is one group → never split across transactions
    expect(plan.projects[0].groups.find((g) => g.key === 'item:b1a7e0c2-0001')!.mutations).toHaveLength(2)
  })

  it('reports the multi-category draft and the stale config.categories (ignored: terms win)', () => {
    const { plan } = run(taxonomyStep, tmzProduction())
    expect(plan.findings.find((f) => f.code === 'item.multiCategory')).toMatchObject({ id: 'drafts.c2c4fa97-0011', detail: { primary: 'technology', additional: ['literature'] } })
    expect(plan.findings.find((f) => f.code === 'taxonomy.configListIgnored')).toMatchObject({ detail: { configKeys: ['design', 'technology'], stale: true } })
  })

  it('every patch is guarded by the document revision', () => {
    const { plan } = run(taxonomyStep, tmzProduction())
    for (const m of groupsOf(plan).flatMap((g) => g.mutations)) if ('patch' in m) expect(m.patch.ifRevisionID).toMatch(/^rev-/)
  })

  it('is idempotent: a second run plans nothing', () => {
    const { after } = run(taxonomyStep, tmzProduction())
    expect(groupsOf(taxonomyStep.plan(after, CTX))).toEqual([])
  })

  it('an R2-written assignment is newer and wins', () => {
    const docs = tmzProduction().map((d) => (d._id === 'b1a7e0c2-0002' ? { ...d, primaryCategory: 'design', additionalCategories: [] } : d))
    const { plan, verification } = run(taxonomyStep, docs)
    expect(groupsOf(plan).find((g) => g.key === 'item:b1a7e0c2-0002')).toBeUndefined()
    expect(verification.pass).toBe(true)
  })

  it('refuses a taxonomy with duplicate keys', () => {
    const docs = [...tmzProduction(), { _id: 'term.tmz.catalogue.category.design-dup', _type: 'taxonomyTerm', projectSlug: 'tmz', module: 'catalogue', kind: 'category', key: 'design', order: 9000, label: {} }]
    expect(taxonomyStep.plan(docs, CTX).refusals.map((r) => r.code)).toContain('taxonomy.duplicateKey')
  })

  it('refuses a stored taxonomy document with a cycle', () => {
    const docs = [
      ...tmzProduction(),
      { _id: 'catalogue-taxonomy.tmz', _type: 'catalogueTaxonomy', projectSlug: 'tmz', categories: [{ _key: 'a', key: 'a', parentKey: 'b', order: 1 }, { _key: 'b', key: 'b', parentKey: 'a', order: 2 }], tags: [] },
    ]
    expect(taxonomyStep.plan(docs, CTX).refusals.map((r) => r.code)).toContain('taxonomy.treeIssue')
  })

  it('revert unsets exactly the D1 output and the marker', () => {
    const migrated = withMarkers(run(taxonomyStep, tmzProduction()).after, 'taxonomy')
    const back = simulate(migrated, groupsOf(taxonomyStep.revert(migrated, CTX)))
    expect(back.find((d) => d._id === 'b1a7e0c2-0001')).not.toHaveProperty('primaryCategory')
    expect(configOf(back).catalogueMigrations).toEqual({})
  })
})

describe('D2 commerce on tmz (no channels)', () => {
  it('writes one implicit format per priced document, keeps offers, writes no availability and no config change', () => {
    const docs = withMarkers(tmzProduction(), 'taxonomy')
    const { plan, after, verification } = run(commerceStep, docs)
    expect(plan.refusals).toEqual([])
    expect(plan.projects[0].counts).toEqual({ documents: 4, prices: 4, channels: 0 })
    const d = after.find((x) => x._id === 'b1a7e0c2-0001')!
    expect(d.formats).toEqual([{ _key: 'default', _type: 'catalogueFormat', prices: [{ _key: 'o-1', _type: 'cataloguePrice', amount: 24 }] }])
    expect(d.offers).toEqual([{ _key: 'o-1', _type: 'catalogueOffer', price: 24 }])
    expect(d).not.toHaveProperty('channelAvailability')
    expect(after.find((x) => x._id === 'drafts.b1a7e0c2-0001')!.formats).toEqual(d.formats)
    expect(groupsOf(plan).some((g) => g.key.startsWith('config:'))).toBe(false)
    expect(verification.checks.map((c) => [c.name, c.pass])).toEqual([
      ['commerce.equivalence(E1–E9)', true],
      ['commerce.classW', true],
      ['commerce.offersKept', true],
      ['commerce.channelEntries', true],
      ['commerce.unchangedElsewhere', true],
    ])
    expect(groupsOf(commerceStep.plan(after, CTX))).toEqual([])
  })
})

/** A channel project (C10-5 F-E3/F-E4 shapes). */
function channelProject(offersA: unknown[], offersB: unknown[], channels: unknown[] = [{ _key: 'ch1', value: 'dine-in', label: { en: 'Dine in' } }, { _key: 'ch2', value: 'takeaway', label: { en: 'Takeaway' } }]): Doc[] {
  return [
    { _id: 'project-pizza', _type: 'project', _rev: 'r0', projectSlug: 'pizza', moduleInstallations: [{ _key: 'ic', moduleId: 'catalogue', config: { currency: 'EUR', serviceChannels: channels, catalogueMigrations: { taxonomy: '2026-11-05T00:00:00Z' } } }] },
    { _id: 'siteConfig-pizza', _type: 'siteConfig', projectSlug: 'pizza', timeZone: 'Europe/Rome', defaultLocale: 'it', supportedLocales: ['it'] },
    { _id: 'item-a', _type: 'catalogueItem', _rev: 'ra', projectSlug: 'pizza', name: { it: 'A' }, offers: offersA },
    { _id: 'item-b', _type: 'catalogueItem', _rev: 'rb', projectSlug: 'pizza', name: { it: 'B' }, offers: offersB },
  ]
}

describe('D2 commerce in a channel project (D-10)', () => {
  it('F-E4: defaults unavailable on every channel, explicit available rows only where the old model sold', () => {
    const docs = channelProject([{ _key: 'a1', price: 8, channel: 'takeaway' }], [{ _key: 'b1', price: 9 }])
    const { after, verification } = run(commerceStep, docs)
    expect(after.find((d) => d._id === 'item-a')!.channelAvailability).toEqual([{ _key: 'takeaway', _type: 'catalogueChannelRule', channel: 'takeaway', state: 'available' }])
    expect((after.find((d) => d._id === 'item-b')!.channelAvailability as { channel: string }[]).map((r) => r.channel)).toEqual(['dine-in', 'takeaway'])
    const entries = configOf(after, 'project-pizza').serviceChannels as Record<string, unknown>[]
    expect(entries.map((e) => [e.value, e.active, e.defaultAvailability])).toEqual([
      ['dine-in', true, 'unavailable'],
      ['takeaway', true, 'unavailable'],
    ])
    expect(verification.pass).toBe(true)
  })

  it('F-E9 unknown channel and F-E10 reserved currency refuse', () => {
    const codes = commerceStep.plan(channelProject([{ _key: 'a1', price: 8, channel: 'delivery' }], [{ _key: 'b1', price: 9, currency: 'USD' }]), CTX).refusals.map((r) => r.code)
    expect(codes).toEqual(expect.arrayContaining(['offer.unknownChannel', 'offer.reservedField']))
  })

  it('an invalid offer refuses (never dropped silently)', () => {
    expect(commerceStep.plan(channelProject([{ _key: 'a1', price: -1 }], []), CTX).refusals.map((r) => r.code)).toContain('offer.invalidOffer')
  })

  it('F-E5: windowed offers with a gap are class W and refuse', () => {
    const lunch = { _key: 'w1', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '12:00', to: '15:00' }
    const dinner = { _key: 'w2', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '19:00', to: '23:00' }
    const plan = commerceStep.plan(channelProject([{ _key: 'a1', price: 8, availability: [lunch] }, { _key: 'a2', price: 12, availability: [dinner] }], [], []), CTX)
    expect(plan.refusals.map((r) => r.code)).toContain('commerce.classW')
  })

  it('non-conforming legacy channel entries refuse', () => {
    const plan = commerceStep.plan(channelProject([], [], [{ value: 'Dine In' }, { value: 'takeaway' }, { value: 'takeaway' }, { label: 'x' }]), CTX)
    expect(plan.refusals.filter((r) => r.code === 'channel.nonConforming').map((r) => (r.detail as { problem: string }).problem)).toEqual(['invalidKey', 'duplicate', 'missingValue'])
  })
})

describe('D3 pack history on tmz', () => {
  it('converts appliedPreset{bookshop,1} into bookshop@1 and completes setup in the same group', () => {
    const { plan, after, verification } = run(packHistoryStep, tmzProduction())
    expect(plan.refusals).toEqual([])
    expect(plan.projects[0].groups).toHaveLength(1)
    const hist = after.find((d) => d._id === 'catalogue-packs.tmz')!
    expect(hist).toMatchObject({ _type: 'cataloguePackHistory', projectSlug: 'tmz' })
    expect(hist.applied).toEqual([
      {
        _key: 'bookshop@1',
        _type: 'catalogueAppliedPack',
        id: 'bookshop',
        version: 1,
        appliedAt: TMZ_APPLIED_AT,
        appliedBy: 'migration',
        added: { categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: ['publicSegment', 'defaultItemProfile'] },
        mapped: [],
        skipped: [],
      },
    ])
    const cfg = configOf(after)
    expect(readSetupState(cfg)).toEqual({ completedAt: TMZ_APPLIED_AT, source: 'pack' })
    expect(isSetupComplete(cfg)).toBe(true)
    const preset = catalogueProjects(after)[0].appliedPreset
    expect(preset).toEqual({ id: 'bookshop', version: 1, appliedAt: TMZ_APPLIED_AT }) // kept at installation level
    expect(cfg.appliedPreset).toBeUndefined() // never inside config
    expect(cfg.defaultItemProfile).toBe('product') // never changed automatically (D-13 part 3)
    expect(readPackHistory({ applied: hist.applied, appliedPreset: preset }).map((h) => [h._key, h.source])).toEqual([['bookshop@1', 'history']])
    expect(verification.pass).toBe(true)
    expect(groupsOf(packHistoryStep.plan(after, CTX))).toEqual([])
  })

  it('regression 2026-11-03: the preset is read from the installation, not from config (pre-flight converted 0)', () => {
    const { plan } = run(packHistoryStep, tmzProduction())
    expect(plan.projects[0].counts).toEqual({ converted: 1 })
  })

  it('image-shape/tmz-fallback: writes itemImageShape=portrait once so items without a profile keep their upright covers (D-13 part 4)', () => {
    const before = configOf(tmzProduction())
    // Without D3, module config alone (defaultItemProfile=product) would frame them landscape.
    expect(catalogueImageShape({ defaultItemProfile: before.defaultItemProfile as string })).toBe('landscape')
    const { plan, after, verification } = run(packHistoryStep, tmzProduction())
    const cfg = configOf(after)
    expect(cfg.itemImageShape).toBe('portrait')
    expect(cfg.defaultItemProfile).toBe('product')
    expect(catalogueImageShape({ defaultItemProfile: cfg.defaultItemProfile as string, itemImageShape: cfg.itemImageShape as string })).toBe('portrait')
    // An item WITH a profile still follows its profile.
    expect(catalogueImageShape({ itemProfile: 'product', itemImageShape: cfg.itemImageShape as string })).toBe('landscape')
    expect(plan.projects[0].groups[0].mutations).toHaveLength(2) // history create + ONE config patch (setup + shape)
    expect(verification.pass).toBe(true)
    // Idempotent: a second run writes nothing.
    expect(groupsOf(packHistoryStep.plan(after, CTX))).toEqual([])
  })

  it('image shape: nothing written where module config already gives the legacy shape, or the shape is already set', () => {
    expect(imageShapeToWrite({ defaultItemProfile: 'book' }, 'bookshop')).toBeNull()
    expect(imageShapeToWrite({ defaultItemProfile: 'product', itemImageShape: 'landscape' }, 'bookshop')).toBeNull()
    expect(imageShapeToWrite({ defaultItemProfile: 'product' }, 'restaurant')).toBeNull()
    expect(imageShapeToWrite({}, 'bookshop')).toBe('portrait')
  })

  it('image shape: a project already marked complete still gets the shape (and keeps its completion)', () => {
    const docs = tmzProduction().map((d) => {
      if (d._id !== 'project-tmz') return d
      const insts = (d.moduleInstallations as Record<string, unknown>[]).map((i) => (i.moduleId === 'catalogue' ? { ...i, config: { ...(i.config as object), setupCompletedAt: '2026-10-01T00:00:00.000Z', setupSource: 'manual' } } : i))
      return { ...d, moduleInstallations: insts }
    })
    const { after, verification } = run(packHistoryStep, docs)
    const cfg = configOf(after)
    expect(cfg.itemImageShape).toBe('portrait')
    expect(readSetupState(cfg)).toEqual({ completedAt: '2026-10-01T00:00:00.000Z', source: 'manual' })
    expect(verification.pass).toBe(true)
  })

  it('revert deletes the history document', () => {
    const after = run(packHistoryStep, tmzProduction()).after
    expect(simulate(after, groupsOf(packHistoryStep.revert(after, CTX))).find((d) => d._id === 'catalogue-packs.tmz')).toBeUndefined()
  })
})

describe('D4 public name', () => {
  it('migrate/copy-tmz: copy all three locales, unset navLabel; preserved word per locale', () => {
    const docs = withMarkers(tmzProduction(), 'taxonomy', 'commerce', 'packHistory')
    const { plan, after, verification } = run(publicNameStep, docs)
    const cfg = configOf(after)
    expect(cfg.publicName).toEqual({ _type: 'localizedString', en: 'Books', it: 'Libri', de: 'Bücher' })
    expect(cfg).not.toHaveProperty('navLabel')
    expect(plan.findings.map((f) => f.code)).toEqual(['publicName.copy'])
    expect(verification.pass).toBe(true)
    expect(groupsOf(publicNameStep.plan(after, CTX))).toEqual([]) // migrate/idempotent
    expect(publicNameStep.auditDetail('tmz', docs, after, { ...CTX, verification })).toEqual({ migrationId: 'test-run', action: 'copy', old: { en: 'Books', it: 'Libri', de: 'Bücher' }, new: { en: 'Books', it: 'Libri', de: 'Bücher' }, discarded: null })
  })

  it('migrate/existing and migrate/partial-existing: drop, publicName untouched, discarded recorded', () => {
    expect(publicNameConfig({ publicName: { en: 'Menu' }, navLabel: { en: 'Food' } })).toEqual({ publicName: { en: 'Menu' } })
    const docs = withMarkers(tmzProduction(), 'taxonomy', 'commerce', 'packHistory').map((d) =>
      d._id === 'project-tmz' ? JSON.parse(JSON.stringify(d).replace('"navLabel":', '"publicName":{"it":"Menu"},"navLabel":')) : d,
    )
    const { plan, verification } = run(publicNameStep, docs)
    expect(plan.findings.map((f) => f.code)).toEqual(['publicName.partialDrop'])
    expect(verification.pass).toBe(true)
  })

  it('migrate/blank-nav: none, but the blank navLabel is still unset', () => {
    expect(publicNameConfig({ navLabel: { en: '' }, currency: 'EUR' })).toEqual({ currency: 'EUR' })
    expect(publicNameConfig({ currency: 'EUR' })).toBeNull()
  })

  it('migrate/extra-locale: a locale the site does not enable is copied (nothing lost)', () => {
    expect(publicNameConfig({ navLabel: { fr: 'Livres' } })).toEqual({ publicName: { _type: 'localizedString', fr: 'Livres' } })
  })

  it('a project draft gets the same function as the published copy', () => {
    const docs = withMarkers(tmzProduction(), 'taxonomy', 'commerce', 'packHistory')
    const project = docs.find((d) => d._id === 'project-tmz')!
    const withDraft = [...docs, { ...JSON.parse(JSON.stringify(project)), _id: 'drafts.project-tmz', _rev: 'rev-draft' }]
    const { plan, after } = run(publicNameStep, withDraft)
    expect(plan.projects[0].groups[0].mutations).toHaveLength(2)
    expect(configOf(after, 'drafts.project-tmz').publicName).toEqual(configOf(after).publicName)
  })

  it('revert restores navLabel from the P′ export and unsets the copied publicName', () => {
    const docs = withMarkers(tmzProduction(), 'taxonomy', 'commerce', 'packHistory')
    const after = run(publicNameStep, docs).after
    const back = simulate(after, groupsOf(publicNameStep.revert(after, { ...CTX, rollback: docs })))
    expect(configOf(back).navLabel).toEqual({ _type: 'localizedString', en: 'Books', it: 'Libri', de: 'Bücher' })
    expect(configOf(back)).not.toHaveProperty('publicName')
  })
})

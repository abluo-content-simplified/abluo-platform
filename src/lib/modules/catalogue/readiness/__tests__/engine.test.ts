// C6 §6.15 engine fixtures (names = case ids). d = 'it', siteLocales = [it, en], ctx = website unless stated.
import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, NOT_A_READINESS_CODE, PRICE_ISSUE_TO_RULE, REEXPOSE_SAFETY_SUBSET, SCHEDULE_ERRORS, activeRules } from '../rules'
import { WEBSITE, contextKey, evaluateItem, findingFingerprint, offeringContextOf } from '../engine'
import { asChannelKey as ck, asFormatKey as fk } from '../../commerce/commerce-types'
import { buildTree } from '../../taxonomy/tree'
import type { FormatReadinessFacts, ItemReadinessInput, PublicationContext, ReadinessOverride } from '../types'

const COMMERCE = { commerce: '2026-12-01T00:00:00Z' }
const TAXONOMY = { taxonomy: '2026-12-01T00:00:00Z' }
const node = (key: string, parentKey: string | null, order: number) => ({ key, label: {}, parentKey, order, channelRules: {}, defaultOptionListIds: [], archivedAt: null })
const fmt = (f: Partial<FormatReadinessFacts> = {}): FormatReadinessFacts => ({ key: fk('default'), priceIssues: [], everAvailable: true, priceCoverage: { kind: 'full' }, availability: { issues: [] }, ...f })

function input(over: Partial<ItemReadinessInput> = {}, formats: FormatReadinessFacts[] = [fmt()]): ItemReadinessInput {
  return {
    id: 'item-1',
    profile: 'service',
    name: { it: 'Massaggio', en: 'Massage' },
    description: { it: 'Un’ora.' },
    siteLocales: ['it', 'en'],
    defaultLocale: 'it',
    photoCount: 1,
    categories: { primary: 'wellness', additional: [] },
    categoryState: 'ok',
    primaryPath: { kind: 'path', keys: ['wellness'] },
    categoryTree: buildTree([node('wellness', null, 1000), node('food', null, 2000), node('pizza', 'food', 1000)]),
    formats: () => formats,
    placements: 1,
    allergen: { declaration: null },
    options: [],
    optionFacts: { counts: new Map(), unreviewedChoices: [] },
    dependencies: { neverPublished: [], missing: [] },
    page: { hasPage: false, slug: {}, conflicts: [] },
    bookIsbn: null,
    overrides: [],
    ...over,
  }
}
const codes = (fs: { code: string }[]) => fs.map((f) => f.code)
const FOOD = 'foodOrDrink' as const

describe('C6 engine — standard family', () => {
  it('R-01 ready-minimal-service', () => {
    const r = evaluateItem(input(), WEBSITE)
    expect(r).toMatchObject({ state: 'ready', required: [], recommended: [], overridden: [], staleOverrides: [], context: 'website', subject: { kind: 'item', id: 'item-1' } })
  })

  it('R-02 draft-no-profile', () => {
    const r = evaluateItem(input({ profile: null }), WEBSITE)
    expect(r.state).toBe('blocked')
    expect(r.required.map((f) => [f.code, f.gate])).toEqual([['profileMissing', 'advance']])
  })

  it('R-03 name-only-in-en', () => {
    const r = evaluateItem(input({ name: { en: 'Pizza' } }), WEBSITE)
    const f = r.required.find((x) => x.code === 'nameMissing')!
    expect(f.fix).toMatchObject({ surface: 'item', focus: '[data-name-locale="it"]' })
    expect(r.recommended.filter((x) => x.code === 'translationMissing')).toEqual([])
  })

  it.each<PublicationContext>([WEBSITE, { kind: 'channel', channel: ck('delivery') }, { kind: 'export', profile: 'csv-full' }, { kind: 'print', template: 'classic', locale: 'it' }, { kind: 'marketplace', connection: 'deliveroo', policyVersion: '2026-03' }])(
    'R-04 food-not-reviewed (%o)',
    (ctx) => {
      const r = evaluateItem(input({ profile: FOOD, allergen: { declaration: { status: 'notReviewed' } } }), ctx)
      expect(r.required.find((f) => f.code === 'allergenReview')).toMatchObject({ gate: 'publish', messageKey: 'allergens.notReviewed', level: 'required' })
    }
  )

  it('R-05 food-none-unconfirmed', () => {
    const r = evaluateItem(input({ profile: FOOD, allergen: { declaration: { status: 'noneDeclared' } } }), WEBSITE)
    expect(r.required.find((f) => f.code === 'allergenReview')?.messageKey).toBe('allergens.notConfirmed')
  })

  it('R-06 product-with-stale-declaration', () => {
    expect(codes(evaluateItem(input({ profile: 'product', allergen: { declaration: { status: 'notReviewed' } } }), WEBSITE).required)).toEqual([])
  })

  it('R-07 unreviewed-free-text-extra', () => {
    const r = evaluateItem(input({ profile: FOOD, allergen: { declaration: { status: 'noneDeclared', confirmed: true } }, optionFacts: { counts: new Map(), unreviewedChoices: [{ id: 'L', type: 'catalogueOptionList', label: 'Extras · Mozzarella' }] } }), WEBSITE)
    expect(r.state).toBe('blocked')
    expect(r.required.map((f) => [f.code, f.values])).toEqual([['allergenChoicesReview', { choices: 'Extras · Mozzarella' }]])
  })

  it('R-16 dependency-never-published (Referrer label preserved)', () => {
    const r = evaluateItem(input({ dependencies: { neverPublished: [{ id: 'L', type: 'catalogueOptionList', label: 'Sauces' }], missing: [] } }), WEBSITE)
    expect(r.required).toMatchObject([{ code: 'dependenciesPublishable', values: { names: 'Sauces' } }])
  })

  it('R-17 page-address-empty-slug', () => {
    expect(codes(evaluateItem(input({ name: { it: '!!!', en: 'x' }, page: { hasPage: true, slug: {}, conflicts: [] } }), WEBSITE).required)).toEqual(['pageAddressInvalid'])
  })

  it('R-18 stray-address-de', () => {
    const multi = input({ siteLocales: ['it', 'en', 'de'], name: { it: 'A', en: 'A' }, page: { hasPage: true, slug: { de: 'a' }, conflicts: [] } })
    expect(evaluateItem(multi, WEBSITE).required).toMatchObject([{ code: 'strayAddress', values: { locale: 'de' }, fix: { tab: 'languages' } }])
    const main = input({ name: { en: 'A' }, page: { hasPage: true, slug: { it: 'a' }, conflicts: [] } })
    expect(evaluateItem(main, WEBSITE).required.find((f) => f.code === 'strayAddress')?.fix).toMatchObject({ tab: 'content' })
  })

  it('R-19 slug-taken', () => {
    const conflicts = [{ locale: 'it', slug: 'menu', owner: { id: 'c1', type: 'catalogueCollection', name: 'Menu' } }] as never
    expect(evaluateItem(input({ page: { hasPage: true, slug: { it: 'menu' }, conflicts } }), WEBSITE).required).toMatchObject([{ code: 'pageAddressTaken', values: { locale: 'it' } }])
  })

  it('R-20 option-list-missing', () => {
    expect(codes(evaluateItem(input({ options: [{ key: 'a', listId: 'GONE', min: 0, max: null }] }), WEBSITE).required)).toEqual(['optionListMissing'])
  })

  it('R-21 isbn-bad', () => {
    const r = evaluateItem(input({ profile: 'book', bookIsbn: '123' }), WEBSITE)
    expect(r.recommended).toMatchObject([{ code: 'isbnInvalid', overridable: false, level: 'recommended' }])
    expect(r.state).toBe('readyWithWarnings')
  })

  it('photo / description / translation are recommended, never blocking', () => {
    const r = evaluateItem(input({ photoCount: 0, description: {}, name: { it: 'A' } }), WEBSITE)
    expect(r.state).toBe('readyWithWarnings')
    expect(codes(r.recommended)).toEqual(['photoMissing', 'descriptionMissing', 'translationMissing'])
  })

  it('placement: unknown (null) is not judged; 0 is a recommended finding', () => {
    expect(codes(evaluateItem(input({ placements: null }), WEBSITE).recommended)).toEqual([])
    expect(codes(evaluateItem(input({ placements: 0 }), WEBSITE).recommended)).toEqual(['placementMissing'])
  })
})

describe('C6 engine — model-dependent rules stay inactive until the project is migrated (R-40)', () => {
  it('R-40 activation-per-project: categoryMissing active for a migrated project only', () => {
    const A = input({ categoryState: 'none', migrations: TAXONOMY })
    const B = input({ categoryState: 'none' })
    expect(codes(evaluateItem(A, WEBSITE).required)).toEqual(['categoryMissing'])
    expect(codes(evaluateItem(B, WEBSITE).required)).toEqual([])
  })

  it('no marker ⇒ only always-rules are active; allergenEvidenceMissing waits for the allergen slice', () => {
    const always = DEFAULT_RULES.filter((r) => r.activation === 'always').map((r) => r.code)
    expect([...activeRules(undefined)]).toEqual(always)
    expect(activeRules({ taxonomy: 'x', commerce: 'y' }).has('allergenEvidenceMissing')).toBe(false)
    expect(activeRules(undefined, { allergenSlice: true }).has('allergenEvidenceMissing')).toBe(true)
  })

  it('R-14 category-none / R-15 category-no-primary', () => {
    expect(codes(evaluateItem(input({ categoryState: 'none', primaryPath: { kind: 'none' }, migrations: TAXONOMY }), WEBSITE).required)).toEqual(['categoryMissing'])
    expect(evaluateItem(input({ categoryState: 'no_primary', primaryPath: { kind: 'none' }, migrations: TAXONOMY }), WEBSITE).required).toMatchObject([{ code: 'primaryCategoryMissing', values: { reason: 'noPrimary' } }])
  })

  it('R-34 primary-broken-visible / R-35 primary-archived', () => {
    const r = evaluateItem(input({ categoryState: 'unknown_primary', primaryPath: { kind: 'broken', reason: 'missingCategory', keys: [] }, migrations: TAXONOMY }), WEBSITE, { families: ['standard', 'integrity'] })
    expect(r.required).toMatchObject([{ code: 'primaryCategoryMissing', values: { reason: 'missingCategory' }, fix: { surface: 'item', step: 'category' } }])
    const a = evaluateItem(input({ categoryState: 'archived_primary', migrations: TAXONOMY }), WEBSITE)
    expect(a.state).toBe('readyWithWarnings')
    expect(codes(a.recommended)).toEqual(['primaryCategoryArchived'])
  })

  it('R-08 price-missing-available-website: recommended, availability input untouched', () => {
    const f = fmt({ priceCoverage: { kind: 'none' } })
    const r = evaluateItem(input({ migrations: COMMERCE }, [f]), WEBSITE)
    expect(offeringContextOf(WEBSITE)).toEqual({ kind: 'general' })
    expect(r.state).toBe('readyWithWarnings')
    expect(codes(r.recommended)).toEqual(['priceMissing'])
    expect(f.availability).toEqual({ issues: [] })
  })

  it('R-09 price-missing-unavailable-format / R-43 needs ever-available', () => {
    for (const ctx of [WEBSITE, { kind: 'channel', channel: ck('delivery') }] as PublicationContext[]) {
      expect(codes(evaluateItem(input({ migrations: COMMERCE }, [fmt({ everAvailable: false, priceCoverage: { kind: 'none' } })]), ctx).recommended.concat(evaluateItem(input({ migrations: COMMERCE }, [fmt({ everAvailable: false, priceCoverage: { kind: 'none' } })]), ctx).required))).toEqual([])
    }
    expect(codes(evaluateItem(input({ migrations: COMMERCE }, [fmt({ everAvailable: true, priceCoverage: { kind: 'none' } })]), WEBSITE).recommended)).toEqual(['priceMissing'])
  })

  it('R-10 price-missing-channel: required', () => {
    const ctx: PublicationContext = { kind: 'channel', channel: ck('delivery') }
    expect(offeringContextOf(ctx)).toEqual({ kind: 'channel', channel: ck('delivery') })
    const r = evaluateItem(input({ migrations: COMMERCE }, [fmt({ priceCoverage: { kind: 'none' } })]), ctx)
    expect(r.state).toBe('blocked')
    expect(codes(r.required)).toEqual(['priceMissing'])
  })

  it('R-11 price-partial-coverage / R-12 one of two formats / R-13 print without price column', () => {
    const p = evaluateItem(input({ migrations: COMMERCE }, [fmt({ priceCoverage: { kind: 'partial', gaps: [{ start: 0, end: 60 }, { start: 120, end: 180 }] } })]), WEBSITE)
    expect(p.recommended).toMatchObject([{ code: 'pricePartial', values: { gaps: 2 } }])
    const two = evaluateItem(input({ migrations: COMMERCE }, [fmt({ key: fk('glass') }), fmt({ key: fk('bottle'), priceCoverage: { kind: 'none' } })]), WEBSITE)
    expect(two.recommended).toMatchObject([{ code: 'priceMissing', target: { formatKey: 'bottle' } }])
    expect(codes(evaluateItem(input({ migrations: COMMERCE }, [fmt({ priceCoverage: { kind: 'none' } })]), { kind: 'print', template: 'classic', locale: 'it', showsPrice: false }).required)).toEqual([])
  })

  it('R-37 ambiguous-price / R-38 conflicting-rows / R-42 schedule-overlap-required', () => {
    const amb = fmt({ priceIssues: [{ code: 'price.ambiguous' }] })
    expect(codes(evaluateItem(input({ migrations: COMMERCE }, [amb]), WEBSITE).required)).toEqual(['price.ambiguous'])
    expect(amb.everAvailable).toBe(true)
    expect(codes(evaluateItem(input({ migrations: COMMERCE }, [fmt({ availability: { issues: ['availability.conflictingRows'] } })]), WEBSITE).required)).toEqual(['availability.conflictingRows'])
    const overlap = evaluateItem(input({ migrations: COMMERCE }, [fmt({ availability: { issues: ['availability.scheduleOverlap'] } })]), WEBSITE)
    expect(overlap.state).toBe('blocked')
    expect(overlap.required).toMatchObject([{ code: 'availability.scheduleInvalid', values: { reason: 'availability.scheduleOverlap' } }])
    expect(evaluateItem(input({ migrations: COMMERCE }, [fmt({ availability: { issues: ['availability.scheduleRedundant'] } })]), WEBSITE).state).toBe('ready')
  })

  it('R-41 schedule-not-a-problem: readiness takes no instant', () => {
    // The same facts built "at 15:00" and "at 19:00" are the same facts — there is no time input at all.
    const at15 = evaluateItem(input({ migrations: COMMERCE }, [fmt()]), WEBSITE)
    const at19 = evaluateItem(input({ migrations: COMMERCE }, [fmt()]), WEBSITE)
    expect(at15).toEqual(at19)
    expect(JSON.stringify(at15)).not.toMatch(/availab/i)
  })
})

describe('C6 engine — standards and overrides', () => {
  const descMissing = input({ description: {} })
  const finding = evaluateItem(descMissing, WEBSITE).recommended[0]
  const ov = (o: Partial<ReadinessOverride> = {}): ReadinessOverride => ({ _key: 'o1', ruleCode: 'descriptionMissing', context: 'website', standard: 'default', standardVersion: 1, fingerprint: findingFingerprint(finding), by: 'u1', at: '2026-11-02T10:00:00Z', reason: 'Self-explanatory', ...o })

  it('R-22 override-valid', () => {
    const r = evaluateItem({ ...descMissing, overrides: [ov()] }, WEBSITE)
    expect(r.state).toBe('ready')
    expect(r.overridden).toHaveLength(1)
    expect(r.staleOverrides).toEqual([])
  })

  it('R-23 override-standard-bumped', () => {
    const r = evaluateItem({ ...descMissing, overrides: [ov({ standardVersion: 0 })] }, WEBSITE)
    expect(r.state).toBe('readyWithWarnings')
    expect(r.staleOverrides).toHaveLength(1)
  })

  it('R-24 override-finding-changed', () => {
    const base = input({ siteLocales: ['it', 'en', 'de', 'fr'], name: { it: 'A', en: 'A', fr: 'A' } })
    const de = evaluateItem(base, WEBSITE).recommended.find((f) => f.values?.locale === 'de')!
    const now = input({ siteLocales: ['it', 'en', 'de', 'fr'], name: { it: 'A', en: 'A', de: 'A' }, overrides: [ov({ ruleCode: 'translationMissing', fingerprint: findingFingerprint(de) })] })
    const r = evaluateItem(now, WEBSITE)
    expect(r.staleOverrides).toHaveLength(1)
    expect(r.recommended.map((f) => f.values?.locale)).toEqual(['fr'])
  })

  it('R-25 override-resolved', () => {
    expect(evaluateItem(input({ overrides: [ov()] }), WEBSITE).staleOverrides).toHaveLength(1)
  })

  it('R-26 override-required-refused: an override on a required finding is ignored', () => {
    const food = input({ profile: FOOD, allergen: { declaration: { status: 'notReviewed' } }, overrides: [ov({ ruleCode: 'allergenReview' })] })
    expect(evaluateItem(food, WEBSITE).state).toBe('blocked')
  })

  it('an override for another context does not apply (contextKey is part of the match)', () => {
    expect(evaluateItem({ ...descMissing, overrides: [ov({ context: 'channel:delivery' })] }, WEBSITE).state).toBe('readyWithWarnings')
  })

  const std = (rules: Array<{ code: 'priceMissing' | 'allergenReview'; level: 'required' | 'recommended' }>) => ({
    default: { key: 'default', version: 1, name: {}, scope: {}, rules: [] },
    extra: [{ key: 'tenant', version: 1, name: {}, scope: {}, rules: rules.map((r) => ({ ...r, scope: { contexts: ['website' as const] } })) }],
  })

  it('R-27 tenant-raises-price', () => {
    const r = evaluateItem(input({ migrations: COMMERCE, standards: std([{ code: 'priceMissing', level: 'required' }]) }, [fmt({ priceCoverage: { kind: 'none' } })]), WEBSITE)
    expect(r.state).toBe('blocked')
  })

  it('R-28 tenant-cannot-lower', () => {
    const r = evaluateItem(input({ profile: FOOD, allergen: { declaration: { status: 'notReviewed' } }, standards: std([{ code: 'allergenReview', level: 'recommended' }]) }), WEBSITE)
    expect(r.required.map((f) => f.code)).toContain('allergenReview')
  })
})

describe('C6 engine — integrity, determinism, contexts', () => {
  it('R-29 integrity-ref-other-project (gate families only)', () => {
    const i = input({ integrity: { refs: [{ path: 'images[0]', target: 'm1', resolves: true, sameProject: false }], storedCurrency: false, unknownKeys: [] } })
    expect(codes(evaluateItem(i, WEBSITE, { families: ['standard', 'integrity'] }).required)).toEqual(['integrity.refOtherProject'])
    expect(codes(evaluateItem(i, WEBSITE).required)).toEqual([])
  })

  it('R-36 unknown-additional-key', () => {
    const i = input({ categories: { primary: 'wellness', additional: ['ghost'] }, migrations: TAXONOMY })
    expect(evaluateItem(i, WEBSITE, { families: ['standard', 'integrity'] }).required).toMatchObject([{ code: 'integrity.unknownCategory', values: { paths: 'ghost' } }])
  })

  it('R-31 determinism: shuffled registry, same result', () => {
    const i = input({ profile: null, name: {}, photoCount: 0, description: {} })
    const shuffled = [...DEFAULT_RULES].reverse()
    expect(evaluateItem(i, WEBSITE, { rules: shuffled })).toEqual(evaluateItem(i, WEBSITE))
    expect(evaluateItem(i, WEBSITE)).toEqual(evaluateItem(i, WEBSITE))
  })

  it('R-32 context-keys', () => {
    expect(contextKey(WEBSITE)).toBe('website')
    expect(contextKey({ kind: 'channel', channel: ck('delivery') })).toBe('channel:delivery')
    expect(contextKey({ kind: 'export', profile: 'csv-full' })).toBe('export:csv-full')
    expect(contextKey({ kind: 'print', template: 'classic', channel: ck('delivery'), locale: 'it' })).toBe('print:classic:delivery:it')
    expect(contextKey({ kind: 'marketplace', connection: 'deliveroo', policyVersion: '2026-03' })).toBe('marketplace:deliveroo@2026-03')
  })

  it('R-39 offering-context-of', () => {
    expect(offeringContextOf({ kind: 'export', profile: 'x' })).toEqual({ kind: 'general' })
    expect(offeringContextOf({ kind: 'print', template: 't', locale: 'it' })).toEqual({ kind: 'general' })
    expect(offeringContextOf({ kind: 'print', template: 't', locale: 'it', channel: ck('takeaway') })).toEqual({ kind: 'channel', channel: ck('takeaway') })
    expect(offeringContextOf({ kind: 'marketplace', connection: 'm', policyVersion: '1' })).toEqual({ kind: 'general' })
    expect(offeringContextOf({ kind: 'marketplace', connection: 'm', policyVersion: '1', channel: ck('delivery') })).toEqual({ kind: 'channel', channel: ck('delivery') })
  })

  it('total: a malformed declaration never throws', () => {
    expect(() => evaluateItem(input({ profile: FOOD, allergen: { declaration: 'garbage' } }), WEBSITE, { families: ['standard', 'integrity'] })).not.toThrow()
  })

  it('D-15 re-exposure safety subset is exactly the four rules (hook recorded, not wired in R1)', () => {
    expect([...REEXPOSE_SAFETY_SUBSET].sort()).toEqual(['allergenChoicesReview', 'allergenReview', 'integrity.declarationShape', 'integrity.refUnresolved'])
  })

  it('R-33 (R1 part) every legacy offer-form kind and every C5a schedule error is mapped; scheduleRedundant is allow-listed', () => {
    for (const k of ['invalidPrice', 'negativePrice', 'tooManyDecimals', 'invalidTime', 'zeroLength', 'incompleteWindow', 'overlappingOffers', 'unknownChannel']) expect(PRICE_ISSUE_TO_RULE[k], k).toBeDefined()
    expect(SCHEDULE_ERRORS.has('availability.scheduleRedundant')).toBe(false)
    expect(NOT_A_READINESS_CODE.has('availability.scheduleRedundant')).toBe(true)
  })

  it('registry codes are unique', () => {
    const all = DEFAULT_RULES.map((r) => r.code)
    expect(new Set(all).size).toBe(all.length)
  })
})

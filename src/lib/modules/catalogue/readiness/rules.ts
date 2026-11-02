// ── Catalogue readiness — the built-in default standard, version 1 (C6 §6.5) ──
//
// Rules are DATA; the engine is a loop. Registry order = the order findings
// appear in (C6 §6.3 semantics 5). The table numbers of §6.5 are noted per rule.
//
// Activation (C6 §6.13 item 2, C10-6 step 7). Only rules whose data exists
// today are active in R1 (`activation: 'always'`). Model-dependent rules are
// registered but INACTIVE until the project's own migration marker says its
// data is there (`catalogueMigrations.taxonomy` / `.commerce`) — never by date
// or release. `allergenEvidenceMissing` waits for the allergen slice.
//
// This is the ONLY place outside allergens.ts that reads the allergen
// declaration validators (G-02).

import { allergenDeclarationIssues } from '../allergens'
import { attachmentIssues, isBlockingAttachmentIssue, slugFromName } from '../dashboard-form'
import { isValidIsbn } from '../isbn'
import { PROFILES, can } from '../profiles'
import type { CatalogueMigrationState } from '../schema-commerce'
import type { OfferingContext } from '../commerce/commerce-types'
import type { ItemReadinessInput, PublicationContext, PublicationStandard, ReadinessCode, ReadinessRule, RuleFailure, RuleLevel } from './types'

export const DEFAULT_STANDARD_KEY = 'default'
export const DEFAULT_STANDARD_VERSION = 1

const everywhere = (level: RuleLevel) => () => level
const websiteOnly = (level: RuleLevel) => (ctx: PublicationContext) => (ctx.kind === 'website' ? level : null)
const item = (input: ItemReadinessInput) => ({ kind: 'item' as const, id: input.id })

/**
 * C6 §6.5 row 3 — `PRICE_ISSUE_TO_RULE`: the one table that turns every
 * save-time price/format code into one of the four price groups. R1 carries
 * the legacy offer-form kinds (`offerFormIssues`); C3/C4 add their `format.*`
 * / `price.*` codes here when the commerce model lands (REVIEW C-17).
 */
export const PRICE_ISSUE_TO_RULE: Readonly<Record<string, 'price.invalid' | 'price.times' | 'price.overlap' | 'price.channel'>> = Object.freeze({
  invalidPrice: 'price.invalid',
  negativePrice: 'price.invalid',
  tooManyDecimals: 'price.invalid',
  invalidTime: 'price.times',
  zeroLength: 'price.times',
  incompleteWindow: 'price.times',
  overlappingOffers: 'price.overlap',
  unknownChannel: 'price.channel',
})

const PRICE_MESSAGE: Record<'price.invalid' | 'price.times' | 'price.overlap' | 'price.channel', string> = {
  'price.invalid': 'invalidPrice',
  'price.times': 'priceTimes',
  'price.overlap': 'priceOverlap',
  'price.channel': 'priceChannel',
}

/** One rule per price group; the focus is the first offending row (none for an overlap — it is about two rows). */
function priceGroupRule(code: 'price.invalid' | 'price.times' | 'price.overlap' | 'price.channel'): ReadinessRule {
  return {
    code,
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('required'),
    scope: {},
    gate: 'advance',
    check: (input) => {
      const issues = input.formats({ kind: 'general' }).flatMap((f) => f.priceIssues)
      const hits = issues.filter((i) => PRICE_ISSUE_TO_RULE[i.code] === code)
      if (!hits.length) return []
      const keyed = code === 'price.overlap' ? undefined : hits.find((i) => typeof i.key === 'string')
      return [{ target: item(input), fix: { surface: 'item', step: 'price', tab: 'prices', ...(keyed && { focus: `[data-offer-key="${keyed.key}"]` }) }, messageKey: PRICE_MESSAGE[code] }]
    },
  }
}

const hasFoodInformation = (input: ItemReadinessInput) => !!input.profile && can(input.profile, 'foodInformation')

/** The built-in rules, in registry order. */
export const DEFAULT_RULES: readonly ReadinessRule[] = Object.freeze([
  // 1
  {
    code: 'profileMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('required'),
    scope: {},
    gate: 'advance',
    check: (input) => (input.profile == null ? [{ target: item(input), fix: { surface: 'item', step: 'profile', tab: 'content' }, messageKey: 'profile' }] : []),
  },
  // 2
  {
    code: 'nameMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('required'),
    scope: {},
    gate: 'advance',
    check: (input) => {
      const d = input.defaultLocale
      if (input.name[d]?.trim()) return []
      const messageKey = input.profile && PROFILES[input.profile].nameLabelKey === 'title' ? 'bookTitle' : 'name'
      return [{ target: { ...item(input), locale: d }, fix: { surface: 'item', step: 'name', tab: 'content', focus: `[data-name-locale="${d}"]` }, messageKey, values: { locale: d } }]
    },
  },
  // 3
  priceGroupRule('price.invalid'),
  priceGroupRule('price.times'),
  priceGroupRule('price.overlap'),
  priceGroupRule('price.channel'),
  // 4
  {
    code: 'optionsMinMax',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('required'),
    scope: {},
    gate: 'advance',
    check: (input) => {
      const minMax = attachmentIssues(input.options, input.optionFacts.counts).find(isBlockingAttachmentIssue)
      return minMax ? [{ target: item(input), fix: { surface: 'item', step: 'options', tab: 'options', focus: `[data-attachment-key="${minMax.key}"]` }, messageKey: 'optionsMinMax' }] : []
    },
  },
  // 5
  {
    code: 'categoryMissing',
    subject: 'item',
    family: 'standard',
    activation: 'taxonomy',
    levelIn: (ctx) => (ctx.kind === 'channel' ? 'recommended' : ctx.kind === 'export' ? 'recommended' : 'required'),
    scope: {},
    gate: 'publish',
    check: (input) => (input.categoryState === 'none' ? [{ target: item(input), fix: { surface: 'item', step: 'category', tab: 'content' }, messageKey: 'categoryMissing' }] : []),
  },
  // 6
  {
    code: 'primaryCategoryMissing',
    subject: 'item',
    family: 'standard',
    activation: 'taxonomy',
    levelIn: (ctx) => (ctx.kind === 'website' || ctx.kind === 'marketplace' ? 'required' : 'recommended'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      const s = input.categoryState
      const broken = input.primaryPath?.kind === 'broken' ? input.primaryPath.reason : null
      const reason = broken ?? (s === 'no_primary' ? 'noPrimary' : s === 'unknown_primary' ? 'unknownPrimary' : null)
      return reason ? [{ target: item(input), fix: { surface: 'item', step: 'category', tab: 'content' }, messageKey: 'primaryCategoryMissing', values: { reason } }] : []
    },
  },
  // 7
  {
    code: 'allergenReview',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    reexpose: true,
    levelIn: everywhere('required'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      if (!hasFoodInformation(input)) return []
      // = !isPublishableDeclaration, plus the C13 evidence checks (mayContainNotAssessed, editedOutsideReview).
      // R1: C13 `staleLinked` and open compliance tasks need the server facts loader (allergen slice).
      const first = allergenDeclarationIssues(input.allergen.declaration, { defaultLocale: input.defaultLocale })[0]
      return first ? [{ target: item(input), fix: { surface: 'item', step: 'details', tab: 'details' }, messageKey: `allergens.${first}` }] : []
    },
  },
  // 8
  {
    code: 'allergenChoicesReview',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    reexpose: true,
    levelIn: everywhere('required'),
    scope: {},
    gate: 'publish',
    check: (input) =>
      hasFoodInformation(input) && input.optionFacts.unreviewedChoices.length
        ? [{ target: item(input), fix: { surface: 'item', step: 'options', tab: 'options' }, messageKey: 'allergenChoicesReview', values: { choices: input.optionFacts.unreviewedChoices.map((c) => c.label).join(', ') } }]
        : [],
  },
  // 9
  {
    code: 'dependenciesPublishable',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('required'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      const deps = [...input.dependencies.neverPublished, ...input.dependencies.missing]
      return deps.length ? [{ target: item(input), fix: { surface: 'item', step: 'publish', tab: 'publishing' }, messageKey: 'dependenciesPublishable', values: { names: deps.map((d) => d.label).join(', ') } }] : []
    },
  },
  // 10
  {
    code: 'optionListMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('required'),
    scope: {},
    gate: 'publish',
    check: (input) =>
      attachmentIssues(input.options, input.optionFacts.counts).some((i) => i.kind === 'missingList')
        ? [{ target: item(input), fix: { surface: 'item', step: 'options', tab: 'options' }, messageKey: 'optionListMissing' }]
        : [],
  },
  // 11
  {
    code: 'pageAddressInvalid',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('required'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      if (!input.page.hasPage) return []
      const d = input.defaultLocale
      const base = input.page.slug[d]?.trim() ? input.page.slug[d] : (input.name[d] ?? '')
      return input.name[d]?.trim() && !slugFromName(base) ? [{ target: item(input), fix: { surface: 'item', step: 'page', tab: 'page', focus: '[data-slug-locale]' }, messageKey: 'pageAddress' }] : []
    },
  },
  // 12
  {
    code: 'strayAddress',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('required'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      if (!input.page.hasPage) return []
      const d = input.defaultLocale
      // E-3: an address in a language where the name is empty.
      const stray = input.siteLocales.find((l) => input.page.slug[l]?.trim() && !input.name[l]?.trim())
      if (!stray) return []
      const inName = stray === d || input.siteLocales.length <= 1
      return [{
        target: { ...item(input), locale: stray },
        fix: { surface: 'item', step: inName ? 'name' : 'languages', tab: inName ? 'content' : 'languages', focus: `[data-name-locale="${stray}"]` },
        messageKey: 'strayAddress',
        values: { locale: stray },
      }]
    },
  },
  // 13
  {
    code: 'pageAddressTaken',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('required'),
    scope: {},
    gate: 'publish',
    check: (input) => {
      const c = input.page.hasPage ? input.page.conflicts[0] : undefined
      return c ? [{ target: { ...item(input), locale: c.locale }, fix: { surface: 'item', step: 'page', tab: 'page', focus: `[data-slug-locale="${c.locale}"]` }, messageKey: 'pageAddressTaken', values: { locale: c.locale } }] : []
    },
  },
  // 14
  {
    code: 'nameMissingInLocale',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: (ctx) => (ctx.kind === 'export' || ctx.kind === 'print' || ctx.kind === 'marketplace' ? 'required' : null),
    scope: {},
    check: (input, ctx) => {
      const l = 'locale' in ctx ? ctx.locale : undefined
      return l && !input.name[l]?.trim() ? [{ target: { ...item(input), locale: l }, fix: { surface: 'item', step: 'languages', tab: 'languages', focus: `[data-name-locale="${l}"]` }, messageKey: 'name', values: { locale: l } }] : []
    },
  },
  // 15
  {
    code: 'priceMissing',
    subject: 'item',
    family: 'standard',
    activation: 'commerce',
    levelIn: (ctx) => (ctx.kind === 'website' ? 'recommended' : ctx.kind === 'print' && ctx.showsPrice === false ? null : 'required'),
    scope: {},
    check: (input, ctx) =>
      input.formats(offeringContextFor(ctx)).filter((f) => f.everAvailable === true && f.priceCoverage?.kind === 'none').map((f) => ({
        target: { kind: 'format', id: input.id, formatKey: f.key },
        fix: { surface: 'item', step: 'price', tab: 'prices' },
        messageKey: 'priceMissing',
      })),
  },
  // 16
  {
    code: 'pricePartial',
    subject: 'item',
    family: 'standard',
    activation: 'commerce',
    levelIn: everywhere('recommended'),
    scope: {},
    check: (input, ctx) =>
      input.formats(offeringContextFor(ctx)).flatMap((f) =>
        f.everAvailable === true && f.priceCoverage?.kind === 'partial'
          ? [{ target: { kind: 'format' as const, id: input.id, formatKey: f.key }, fix: { surface: 'item' as const, step: 'price' as const, tab: 'prices' as const }, messageKey: 'pricePartial', values: { gaps: f.priceCoverage.gaps.length } }]
          : []
      ),
  },
  // 17
  {
    code: 'photoMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('recommended'),
    scope: {},
    check: (input) => (input.photoCount === 0 ? [{ target: item(input), fix: { surface: 'item', step: 'photo', tab: 'photos' }, messageKey: 'photoMissing' }] : []),
  },
  // 18
  {
    code: 'descriptionMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: everywhere('recommended'),
    scope: {},
    check: (input) => (input.description[input.defaultLocale]?.trim() ? [] : [{ target: item(input), fix: { surface: 'item', step: 'name', tab: 'content' }, messageKey: 'descriptionMissing' }]),
  },
  // 19
  {
    code: 'placementMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: (ctx) => (ctx.kind === 'website' || ctx.kind === 'channel' ? 'recommended' : null),
    scope: {},
    // null = this facts builder does not know (client state in R1): not judged rather than guessed.
    check: (input) => (input.placements === 0 ? [{ target: item(input), fix: { surface: 'item', step: 'publish', tab: 'publishing' }, messageKey: 'placementMissing' }] : []),
  },
  // 20
  {
    code: 'translationMissing',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('recommended'),
    scope: {},
    check: (input) =>
      input.siteLocales
        .filter((l) => l !== input.defaultLocale && !input.name[l]?.trim())
        .map((l) => ({ target: { ...item(input), locale: l }, fix: { surface: 'item' as const, step: 'languages' as const, tab: 'languages' as const, focus: `[data-name-locale="${l}"]` }, messageKey: 'translationMissing', values: { locale: l } })),
  },
  // 21
  {
    code: 'isbnInvalid',
    subject: 'item',
    family: 'standard',
    activation: 'always',
    levelIn: websiteOnly('recommended'),
    scope: {},
    overridable: false,
    check: (input) =>
      input.profile && can(input.profile, 'bookDetails') && input.bookIsbn?.trim() && !isValidIsbn(input.bookIsbn)
        ? [{ target: item(input), fix: { surface: 'item', step: 'name', tab: 'content', focus: '[data-book-isbn]' }, messageKey: 'isbn' }]
        : [],
  },
  // 22
  {
    code: 'primaryCategoryArchived',
    subject: 'item',
    family: 'standard',
    activation: 'taxonomy',
    levelIn: everywhere('recommended'),
    scope: {},
    check: (input) => (input.categoryState === 'archived_primary' ? [{ target: item(input), fix: { surface: 'item', step: 'category', tab: 'content' }, messageKey: 'primaryCategoryArchived' }] : []),
  },
  // 23
  formatCodeRule('price.ambiguous', 'publish', (f) => f.priceIssues.some((i) => i.code === 'price.ambiguous')),
  // 24
  {
    ...formatCodeRule('price.indeterminate', 'publish', (f) => f.priceIssues.some((i) => i.code === 'price.indeterminate')),
    check: (input, ctx) =>
      input.formats(offeringContextFor(ctx)).some((f) => f.priceIssues.some((i) => i.code === 'price.indeterminate'))
        ? [{ target: item(input), fix: { surface: 'setup', section: 'publicWebsite', focus: 'timeZone' }, messageKey: 'priceIndeterminate' }]
        : [],
  },
  // 25
  formatCodeRule('availability.conflictingRows', 'publish', (f) => !!f.availability?.issues.includes('availability.conflictingRows')),
  // 26
  {
    ...formatCodeRule('price.inactiveChannel', undefined, (f) => f.priceIssues.some((i) => i.code === 'price.inactiveChannel') || !!f.availability?.issues.includes('availability.inactiveChannel')),
    levelIn: (ctx) => (ctx.kind === 'website' || ctx.kind === 'channel' ? 'recommended' : null),
  },
  // 27
  {
    ...formatCodeRule('format.skuDuplicateInProject', undefined, (f) => f.skuDuplicateInProject === true),
    levelIn: (ctx) => (ctx.kind === 'print' ? null : 'recommended'),
  },
  // 28
  {
    code: 'allergenEvidenceMissing',
    subject: 'item',
    family: 'standard',
    activation: 'allergenSlice',
    levelIn: everywhere('recommended'),
    scope: {},
    overridable: false,
    check: (input) => {
      const d = input.allergen.declaration as { status?: unknown; review?: unknown } | null
      const reviewed = d?.status === 'containsListedAllergens' || d?.status === 'noneDeclared'
      return hasFoodInformation(input) && reviewed && d?.review == null ? [{ target: item(input), fix: { surface: 'item', step: 'details', tab: 'details' }, messageKey: 'allergenEvidenceMissing' }] : []
    },
  },
  // 30 (D-6) — schedule errors; before the integrity family so every family list keeps the table order.
  {
    code: 'availability.scheduleInvalid',
    subject: 'item',
    family: 'standard',
    activation: 'commerce',
    levelIn: everywhere('required'),
    scope: {},
    gate: 'publish',
    check: (input, ctx) =>
      input.formats(offeringContextFor(ctx)).flatMap((f) => {
        const hit = f.availability?.issues.find((i) => SCHEDULE_ERRORS.has(i))
        return hit ? [{ target: { kind: 'format' as const, id: input.id, formatKey: f.key }, fix: { surface: 'item' as const, step: 'price' as const, tab: 'prices' as const }, messageKey: 'scheduleInvalid', values: { reason: hit } }] : []
      }),
  },
  // ── Integrity family (gate-only, §6.7.3) ──
  integrityRule('integrity.refUnresolved', 'always', (input) => (input.integrity?.refs ?? []).filter((r) => !r.resolves).map((r) => r.path), true),
  integrityRule('integrity.refOtherProject', 'always', (input) => (input.integrity?.refs ?? []).filter((r) => r.resolves && !r.sameProject).map((r) => r.path)),
  integrityRule('integrity.declarationShape', 'always', (input) => {
    if (!hasFoodInformation(input)) return []
    const shape = allergenDeclarationIssues(input.allergen.declaration).filter((i) => i === 'unknownStatus' || i === 'unknownKey' || i === 'unexpectedField' || i === 'reviewShape')
    return shape.length ? ['allergenDeclaration'] : []
  }, true),
  integrityRule('integrity.unknownKey', 'commerce', (input) => [...input.integrity?.unknownKeys ?? []]),
  integrityRule('integrity.currencyStored', 'commerce', (input) => (input.integrity?.storedCurrency ? ['offers'] : [])),
  integrityRule('integrity.unknownCategory', 'taxonomy', (input) => {
    const tree = input.categoryTree
    return tree ? input.categories.additional.filter((k) => !tree.nodes.has(k)) : []
  }),
] satisfies ReadinessRule[])

/** C5a schedule/row errors that make row 30 fail. `availability.scheduleRedundant` is a warning, deliberately absent (NOT_A_READINESS_CODE). */
export const SCHEDULE_ERRORS: ReadonlySet<string> = new Set([
  'availability.scheduleOverlap',
  'availability.scheduleInvalidTime',
  'availability.scheduleIncomplete',
  'availability.scheduleZeroLength',
  'availability.scheduleUnknownDay',
  'availability.scheduleUnknownKind',
  'availability.scheduleLimitExceeded',
  'availability.scheduleOnImplicitFormat',
  'availability.keyMismatch',
  'availability.duplicateChannel',
  'availability.stateInvalid',
])

/** Handed-over codes that are intentionally not readiness findings (R-33 allow-list). */
export const NOT_A_READINESS_CODE: ReadonlySet<string> = new Set(['availability.scheduleRedundant'])

function formatCodeRule(code: ReadinessCode, gate: 'publish' | undefined, hit: (f: ReturnType<ItemReadinessInput['formats']>[number]) => boolean): ReadinessRule {
  return {
    code,
    subject: 'item',
    family: 'standard',
    activation: 'commerce',
    levelIn: everywhere(gate ? 'required' : 'recommended'),
    scope: {},
    ...(gate && { gate }),
    check: (input, ctx) =>
      input.formats(offeringContextFor(ctx)).filter(hit).map((f) => ({ target: { kind: 'format' as const, id: input.id, formatKey: f.key }, fix: { surface: 'item' as const, step: 'price' as const, tab: 'prices' as const }, messageKey: code })),
  }
}

function integrityRule(code: ReadinessCode, activation: ReadinessRule['activation'], paths: (input: ItemReadinessInput) => string[], reexpose = false): ReadinessRule {
  return {
    code,
    subject: 'item',
    family: 'integrity',
    activation,
    ...(reexpose && { reexpose: true as const }),
    levelIn: (ctx) => (ctx.kind === 'website' ? 'required' : null),
    scope: {},
    gate: 'publish',
    check: (input): RuleFailure[] => {
      const p = paths(input)
      return p.length ? [{ target: item(input), fix: { surface: 'none' }, messageKey: code, values: { paths: p.join(', ') } }] : []
    },
  }
}

/** §6.4a — the only mapping from a publication context to an offering context (re-exported by the engine). */
export function offeringContextFor(ctx: PublicationContext): OfferingContext {
  switch (ctx.kind) {
    case 'website':
      return { kind: 'general' }
    case 'channel':
      return { kind: 'channel', channel: ctx.channel }
    case 'print':
    case 'marketplace':
      return ctx.channel ? { kind: 'channel', channel: ctx.channel } : { kind: 'general' }
    case 'export':
      return { kind: 'general' }
  }
}

/**
 * C6 §6.13 item 2 — `STANDARD_V1_ACTIVATE`: which rules are active for a
 * project, keyed by ITS migration state (C10-6 markers), never by date or
 * release. With no marker (every project in R1) only `activation: 'always'`
 * rules run. `allergenSlice` rules turn on with that slice's release flag.
 */
export function activeRules(state: CatalogueMigrationState | undefined, opts: { allergenSlice?: boolean } = {}): ReadonlySet<ReadinessCode> {
  return new Set(
    DEFAULT_RULES.filter((r) =>
      r.activation === 'always' ||
      (r.activation === 'taxonomy' && !!state?.taxonomy) ||
      (r.activation === 'commerce' && !!state?.commerce) ||
      (r.activation === 'allergenSlice' && opts.allergenSlice === true)
    ).map((r) => r.code)
  )
}

/**
 * D-15 — the re-exposure safety subset (backOnline, restore → back online,
 * setDates): allergen review; option-choice allergen review; valid declaration
 * shape; dangling or unresolved references. Nothing else is re-run on a copy
 * that was already gated. RECORDED HERE, NOT YET WIRED: the hook point is
 * `LifecycleDescriptor.reexposeCheck?: (published, x) => Promise<void>` set by
 * the Catalogue descriptors, calling `cataloguePublishGate` in `mode: 'reexpose'`
 * (C6 §6.7.2; lands with R2 together with the server facts loader).
 */
export const REEXPOSE_SAFETY_SUBSET: readonly ReadinessCode[] = Object.freeze(DEFAULT_RULES.filter((r) => r.reexpose).map((r) => r.code))

/** The built-in standard as data (§6.8): tenant standards add to it, never replace its integrity family. */
export const DEFAULT_STANDARD: PublicationStandard = Object.freeze({
  key: DEFAULT_STANDARD_KEY,
  version: DEFAULT_STANDARD_VERSION,
  name: { en: 'Abluo default' },
  scope: {},
  rules: DEFAULT_RULES.map((r) => ({ code: r.code })),
})

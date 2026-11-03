// ── Catalogue readiness — core types (C6 §6.2; pure, browser-safe) ───────────
//
// One engine answers "is this ready, for this purpose?" against a publication
// context. Readiness is DERIVED, never stored; the only stored readiness state
// is an override of a recommended finding (§6.9, R2).

import type { Referrer } from '@/lib/lifecycle/service'
import type { AttachmentForm, ItemStep } from '../dashboard-form'
import type { ItemTab } from '../item-issues'
import type { ItemProfile } from '../profiles'
import type { NamedSlugConflict } from '../validation'
// Types owned by the other Catalogue contracts — imported, never redefined (K-9).
import type { CatalogueMigrationState } from '../schema-commerce'
import type { CategoryAssignmentState, CategoryKey, CategoryTree, PrimaryPath } from '../taxonomy/types'
import type { ChannelKey, FormatKey, OfferingContext } from '../commerce/commerce-types'
import type { EffectiveRule } from '../commerce/channel-availability'
import type { PriceCoverage, PriceIssue } from '../commerce/prices'
import type { ProfileFinding } from '../taxonomy/profile-applicability'

export type { CatalogueMigrationState, CategoryAssignmentState, CategoryKey, CategoryTree, ChannelKey, EffectiveRule, FormatKey, OfferingContext, PriceCoverage, PrimaryPath }

/** A catalogueCollection document id. */
export type CollectionId = string

/**
 * A C3/C4 save-time issue (`format.*`, `price.*`) as readiness reads it: the
 * code, and the one row it is about. A C4 `PriceIssue` maps with
 * `priceIssueFact`; R1's legacy offer-form issues map in facts-client.ts.
 */
export type PriceIssueFact = { code: PriceIssue['code'] | (string & {}); key?: string }
export const priceIssueFact = (i: PriceIssue): PriceIssueFact => ({ code: i.code, ...(i.keys[0] !== undefined && { key: i.keys[0] }) })

export type RuleLevel = 'required' | 'recommended'

/** What is being judged. */
export type ReadinessSubjectKind = 'item' | 'collection' | 'catalogue'

export type ExportProfileKey = string
export type PrintTemplateKey = string
export type MarketplaceKey = string

/** Where the result will be used. Never inferred from a localized label. */
export type PublicationContext =
  | { kind: 'website' }
  | { kind: 'channel'; channel: ChannelKey }
  | { kind: 'export'; profile: ExportProfileKey; locale?: string }
  | { kind: 'print'; template: PrintTemplateKey; channel?: ChannelKey; locale: string; showsPrice?: boolean }
  | { kind: 'marketplace'; connection: MarketplaceKey; policyVersion: string; channel?: ChannelKey }

/** 'website' | 'channel:delivery' | 'export:csv-full' | 'print:classic:delivery:it' | 'marketplace:deliveroo@2026-03'. */
export type ContextKey = string
export type ContextKind = PublicationContext['kind']

/** Which items/contexts a rule applies to. Every present member must match (AND); absent = no restriction. */
export type RuleScope = {
  contexts?: readonly ContextKind[]
  channels?: readonly ChannelKey[]
  profiles?: readonly ItemProfile[]
  primaryCategorySubtree?: CategoryKey
  collection?: CollectionId
}

export type ReadinessCode =
  // minimum to exist (today 'blocksNext')
  | 'profileMissing' | 'nameMissing' | 'price.invalid' | 'price.times' | 'price.overlap' | 'price.channel' | 'optionsMinMax'
  // publication (today 'blocksPublish')
  | 'categoryMissing' | 'primaryCategoryMissing'
  | 'allergenReview' | 'allergenChoicesReview'
  | 'dependenciesPublishable' | 'optionListMissing'
  | 'pageAddressInvalid' | 'strayAddress' | 'pageAddressTaken'
  | 'nameMissingInLocale'
  | 'priceMissing'
  // recommended
  | 'pricePartial' | 'photoMissing' | 'descriptionMissing' | 'placementMissing' | 'translationMissing' | 'isbnInvalid'
  | 'primaryCategoryArchived' | 'price.inactiveChannel' | 'format.skuDuplicateInProject' | 'allergenEvidenceMissing'
  // handed over by C2–C5
  | 'price.ambiguous' | 'price.indeterminate' | 'availability.conflictingRows'
  // aggregate
  | 'collectionEmpty' | 'collectionCoverage'
  // integrity (gate-only, §6.7.3)
  | 'integrity.refUnresolved' | 'integrity.refOtherProject' | 'integrity.declarationShape' | 'integrity.unknownKey'
  | 'integrity.currencyStored' | 'integrity.priceShape' | 'integrity.unknownCategory' | 'integrity.unknownChannel'
  | 'availability.scheduleInvalid'
  // D-22 (C1.12): a category, tag or option list not used for the item's profile
  | 'profileMismatch'
  | 'integrity.legacyOffersShadowed'
  // tenant-defined (later)
  | `custom.${string}`

export type SetupSection = string
export type ListFilter = string

/** Where the person goes to fix a finding. Superset of ItemIssue's {step, tab, focus}. */
export type FixTarget =
  | { surface: 'item'; step: ItemStep; tab: ItemTab; focus?: string }
  | { surface: 'setup'; section: SetupSection; focus?: string }
  | { surface: 'collection'; id: CollectionId; focus?: string }
  | { surface: 'list'; filter: ListFilter }
  | { surface: 'none' }

export type FindingTarget = { kind: 'item' | 'format' | 'collection' | 'catalogue'; id: string; formatKey?: FormatKey; locale?: string }

export type Finding = {
  code: ReadinessCode
  level: RuleLevel
  /** Rule that produced it + the version of the standard it came from (§6.8). */
  rule: { code: ReadinessCode; standard: string; standardVersion: number }
  target: FindingTarget
  fix: FixTarget
  /** i18n key under `catalogue.dashboard.item.issues` (existing keys keep working). */
  messageKey: string
  /** ICU values; `locale` becomes a language name in the UI. Part of the override fingerprint. */
  values?: Record<string, string | number>
  /** Required findings only: 'advance' = old blocksNext, 'publish' = old blocksPublish. */
  gate?: 'advance' | 'publish'
  /** Recommended findings only: false for pure data hints (isbnInvalid). */
  overridable?: boolean
}

/** §6.9 — stored on the item (`readinessOverrides`); written only by `overrideReadiness()` (R2). */
export type ReadinessOverride = {
  _key: string
  ruleCode: ReadinessCode
  context: ContextKey
  standard: string
  standardVersion: number
  fingerprint: string
  by: string
  at: string
  reason: string
}

export type OverriddenFinding = { finding: Finding; override: ReadinessOverride }

export type ReadinessState = 'ready' | 'blocked' | 'readyWithWarnings'

export type ReadinessResult = {
  context: ContextKey
  subject: { kind: ReadinessSubjectKind; id: string }
  state: ReadinessState
  required: Finding[]
  recommended: Finding[]
  overridden: OverriddenFinding[]
  staleOverrides: ReadinessOverride[]
}

export type RuleFamily = 'standard' | 'integrity'

export type RuleFailure = Omit<Finding, 'rule' | 'level' | 'gate' | 'overridable' | 'code'>

export type ReadinessRule = {
  code: ReadinessCode
  subject: 'item'
  /** Per context: the level, or null = rule does not apply there. Pure function of the context only. */
  levelIn: (ctx: PublicationContext, input: ItemReadinessInput) => RuleLevel | null
  scope: RuleScope
  gate?: 'advance' | 'publish'
  overridable?: boolean
  check: (input: ItemReadinessInput, ctx: PublicationContext) => RuleFailure[]
  family: RuleFamily
  /**
   * How the rule becomes active (C6 §6.13 item 2, C10-6 step 7):
   *   'always'      data exists today — active from R1;
   *   'taxonomy'    active for a project once its C1 data step (D1) is verified (`catalogueMigrations.taxonomy`);
   *   'commerce'    … once its C10 commerce step (D2) is verified (`catalogueMigrations.commerce`);
   *   'allergenSlice' … once the allergen slice (C13 writers) ships — never by migration marker alone.
   */
  activation: 'always' | 'taxonomy' | 'commerce' | 'allergenSlice'
  /** D-15: one of the four rules re-run when an already-gated version is re-exposed (backOnline, restore, setDates). */
  reexpose?: true
}

// ── Inputs (facts, not documents) ────────────────────────────────────────────

export type FormatReadinessFacts = {
  key: FormatKey
  /**
   * C5 effectiveRule(...) for that offering context. OPTIONAL in R1: the
   * commerce model (C3/C4/C5) is not built yet; `undefined` = not known, and
   * every rule that reads it is inactive until `catalogueMigrations.commerce`.
   */
  availability?: Pick<EffectiveRule, 'issues'>
  /** D-6: available at SOME time of the week in this offering context. Optional in R1 (see above). */
  everAvailable?: boolean
  /** C4 priceCoverage. Optional in R1 (see above). */
  priceCoverage?: PriceCoverage
  /** C3/C4 save-time shape problems + runtime price codes. In R1: the legacy offer-form issues (`offerFormIssues`). */
  priceIssues: ReadonlyArray<PriceIssueFact>
  skuDuplicateInProject?: boolean
}

export type ItemReadinessInput = {
  id: string
  profile: ItemProfile | null
  name: Record<string, string>
  description: Record<string, string>
  /** Locales the site offers, default first. */
  siteLocales: readonly string[]
  defaultLocale: string
  photoCount: number
  categories: { primary: CategoryKey | null; additional: readonly CategoryKey[] }
  categoryTree?: CategoryTree
  /** C1 categoryAssignmentState — undefined until the taxonomy model lands (taxonomy rules inactive). */
  categoryState?: CategoryAssignmentState
  primaryPath?: PrimaryPath
  formats: (oc: OfferingContext) => ReadonlyArray<FormatReadinessFacts>
  /** Collections/sections the item sits in; null = not known by this facts builder (rule skipped). */
  placements: number | null
  allergen: { declaration: unknown }
  options: ReadonlyArray<AttachmentForm>
  optionFacts: { counts: ReadonlyMap<string, number>; unreviewedChoices: readonly Referrer[] }
  dependencies: { neverPublished: readonly Referrer[]; missing: readonly Referrer[] }
  page: { hasPage: boolean; slug: Record<string, string>; conflicts: readonly NamedSlugConflict[] }
  /** Book profile only; null when the item has none. */
  bookIsbn: string | null
  integrity?: {
    refs: ReadonlyArray<{ path: string; target: string; resolves: boolean; sameProject: boolean }>
    storedCurrency: boolean
    unknownKeys: readonly string[]
  }
  overrides: readonly ReadinessOverride[]
  standards?: ResolvedStandards
  /** C10-6 markers of the item's project: gate rule activation. Absent = nothing migrated. */
  migrations?: CatalogueMigrationState
  /**
   * D-22 (C1.12): every assignment not used for the item's profile (`incompatibleAssignments`), each
   * with its display name in the site's main language. Absent = not known by this builder (rule silent).
   */
  profileFindings?: ReadonlyArray<ProfileFinding & { name: string }>
}

// ── Standards (§6.8, shape only) ─────────────────────────────────────────────

export type RuleRef = { code: ReadinessCode; level?: RuleLevel; scope?: RuleScope }

export type PublicationStandard = {
  key: string
  version: number
  name: Record<string, string>
  scope: RuleScope
  rules: ReadonlyArray<RuleRef>
  effectiveFrom?: string
  external?: { source: string; policyVersion: string; country?: string; partner?: string }
}

export type ResolvedStandards = { default: PublicationStandard; extra: readonly PublicationStandard[] }

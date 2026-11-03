# Catalogue redesign — step-2 contracts C6, C8, C9, C12

**Status:** Accepted — Tom 2026-11-02 (final consistency review applied, Rev 4). Tom decided all 21 items in `DECISIONS-step2-final-2026-11-02.md`; that file is the authority and its wording is used verbatim where quoted. Each former "Provisional" marker is now recorded inline as **Decided — Tom 2026-11-02, D-n**. Design only: nothing here is implemented, no existing file was changed.
**Date:** 2026-11-02

> **Rev 4 changelog (applies `REVIEW-step3-final-consistency.md`, findings targeting this file).**
> - **C-1** audit kind CHECK/regex now `^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*){1,2}$` so `public_name.migrated` inserts; A-18/A-19 test the whole union. **C-2** readiness is instant-free: `availability: EffectiveRule`, `everAvailable = availableSometime(rule)`, price coverage over the week profile; semantics 2 and 7, 6.14, R-08/09/12 corrected. **C-4** one `CATALOGUE_WRITER_PREFIXES` list for the detective webhook, reconciliation and T-11. **C-6** C8's duplicate "unused" predicate removed; C1 `deletionBlockers`/`deletionRoute` consumed. **C-7** `availability.scheduleInvalid` added to `ReadinessCode`; every handed-over availability code mapped. **C-8** re-exposure reads open compliance tasks from the draft and the derived `staleLinked` from the published copy. **C-10/C-11/C-17** `filterKeys`, rule numbers 28/29 swapped, migration state from `catalogueMigrations`. **C-13** `SANITY_MUTATION_MAX_BYTES` named constant. **C-15** one audit kind per schedule change. **C-21** `term.archive`/`term.unarchive`. **C-22** Setup → Import & export is Setup-only. **C-25** `LifecycleDescriptor.publishEffects` hook and a follow-up job for dependents beyond the cap. **C-26/C-30** pointers and small fixes.
>
> **Rev 3 changelog (applies `DECISIONS-step2-final-2026-11-02.md`, D-1 … D-21).**
> - **All provisional markers removed** and replaced inline by "Decided — Tom 2026-11-02, D-n"; the "Provisional status" table at the end became a decisions record.
> - **C6:** D-8 price levels restated (website recommended; channel delivery, priced export, PDF, marketplace required; packs may propose website-required for food, tenant reviews it). D-9 "a requirement blocks only its scoped action". D-15 re-exposure safety subset worded exactly (no quality rules on re-exposure). D-17 override: Owner/Site admin only, **who, when and why recorded (reason now required)**, expires when the underlying meaning changes, required findings never overridable. D-19 `publishManyTogether` rewritten (validate everything first, one transaction or nothing, payload calculated before attempting against the real limit, 100-document operational cap, clear refusal when too large; reviewed UI batches never called atomic). **D-6:** readiness never treats "currently unavailable by schedule" as a problem and never reads the clock; one new required rule `availability.scheduleInvalid` (C5a schedule errors, overlapping overrides included); `FormatReadinessFacts.everAvailable`. D-1 storage restated as decided.
> - **C8:** D-3 operation split written out (`taxonomy.write` vs `setup.manage`, with the precise definition of "unused"); inline creation calls the same Catalogue taxonomy service; Setup → Categories & Tags visible with either permission; `catalogue.allergen.update` for Owner/Site admin/Editor and never in support mode (D-16); export unavailable in support mode (D-21).
> - **C9:** D-18 made normative: restricted seats and tokens, detective webhook, daily reconciliation, audit events for writes outside the authorised gate, explicit break-glass; ADR-032 D14 is being corrected by Tom to "designed/documented, not implemented".
> - **C12:** new kinds `availability.schedule_changed`, `compliance.task_created`, `allergen.linked_invalidated`, `allergen.dependency_removed` (the audited non-reset), `readiness.override_recorded`, `readiness.override_expired`; `studio.write_outside_gate` (existing) gains `detectedBy`; all payloads content-free. D-20 retention restated (5 years platform default; longer allergen retention pending legal/privacy review; no hard-coded ten years; decided before the first production evidence record).
> - **C13 is now a full contract** (was a draft): D-16 reset and no-reset lists verbatim, review service vs uncontrolled edit, remove/detach audited without reset, linked-item timing rules verbatim with fixtures W-11 … W-23, system-created compliance task, D-20 retention.
>
> **Rev 2 changelog (applies `REVIEW-step2-cross-contract.md`: E-11 … E-15 and every section A/B/C item naming this contract).**
> - **C6:** readiness inputs now use C5 `AvailabilityExplanation` and C4 `PriceCoverage` unchanged (`full | partial | none`); registry rows added for every code C2–C5 hand over (X-4); unknown/broken primary merged into the visible `primaryCategoryMissing` via C1 `categoryAssignmentState` + `primaryPath`, new `primaryCategoryArchived` (X-5); `offeringContextOf` added (X-6); publication standards stored in `catalogue-standards.<slug>` (X-7) and I-5's "move out of the array" request **withdrawn**; the gate now covers every path that makes a version public — `backOnline`, restore, `setDates` — with an explicit "versions, not copies" rule (C-15); `STANDARD_V1_ACTIVATE` keyed per project by migration state (C-16); `translationMissing` reads the site's public locales, not C11 (X-15); legacy offer vocabulary flagged for re-expression over C3/C4 codes (C-17).
> - **C8:** term-operation check lives in `CatalogueTaxonomyService`, generic service refuses `catalogue` (X-8); `dietaryTags` is **not** a tag set — stays in module config under `setup.manage` (X-10); `setup.manage` text says "default availability" (C-4); sub-destination permissions for Setup → Categories & Tags and the ADR-042 N2a amendment note (X-9).
> - **C9:** `CATALOGUE_STUDIO_TYPES` gains `catalogueTaxonomy`, `cataloguePackHistory`, `cataloguePublicationStandards`, pack-run marker (X-16); lock timing split **R1 = documents, R2 = config + `taxonomyTerm` with Setup** (C-18); operator context explicitly covers option lists and pages (C-19, no new permission needed); own migration order replaced by the single plan **E-1 owned by C10**.
> - **C12:** channel payloads, `public_name.migrated`, `category.rule_changed` aligned with C2/C5/C11 `AvailabilityImpact`; kinds added: `channel.removed`, `channel.default_changed`, `migration.commerce`, `migration.taxonomy`, `migration.pack_history`, `pack.interrupted`; A-04/A-05/A-12 corrected; "same unit of work" wording fixed (C-20).
> - **Migration numbering (E-15):** reserve **M0 = `catalogue_audit_log`** first, then **`studio_break_glass`** second, both after the billing series. All ordering lives in the C10 plan (E-1); this file no longer defines its own.
> - **New: C13 — allergen declaration evidence fields** (the gap the reviewer found; a draft in Rev 2, a full contract in Rev 3).
> - (Rev 2) Items that depended on REVIEW section D were marked provisional; all are decided as of Rev 3.
**Authority:** ADR-033 Amendment K (K-3 rule 10, K-5, K-7, K-9, K-11) wins over the brief; then ADR-032 (D5, D6, D9 + amendments), ADR-028, ADR-033 §4 / C4 / C9 / D-3 / D-3a / E.
**Parallel contracts referenced by name only:** C1 (`CategoryTree`, `CategoryKey`, `CategoryNode`, `PrimaryPath`, `primaryPath`, `categoryAssignmentState`), C2 (`Channel`, `ChannelKey`, `AvailabilityRuleValue`, `ChannelAvailabilityState`), C3 (`Format`, `FormatKey`), C4 (`Price`, `PriceCoverage`, `priceCoverage`, `priceIssues`), C5 (`AvailabilityExplanation`, `explainAvailability`, `availabilityImpact`), all as exported by their owners (REVIEW X-2). Where this document needs a function from them it names it in a `// C4:` / `// C5:` comment; the owning contract decides the exact signature, and the dependency is listed in each section's "Needs from other contracts".

Code facts this document relies on (verified in the repo, 2026-11-02):

- The **only server publication gate** is `cataloguePrepare(site, uuid)` in `src/lib/api/catalogue-drafts.ts` (~line 778). It is passed as the `prepare` callback to `lifecycle.publishTogether` by `publishCatalogueDraft`, and called in a loop by `previewCataloguePublish`. `publishTogether` runs `prepare` for the root and every dependency **before writing anything**, then commits one revision-guarded transaction.
- `itemIssues()` (`src/lib/modules/catalogue/item-issues.ts`) is UI guidance; it says so itself ("the server re-validates everything"). The server checks a different, partly smaller set (see C6 §6 mismatch table).
- `content_audit_log` (migration 041) has a **closed CHECK on `action`** (9 lifecycle values), requires a non-null `content_id`, and is read by `readContentActivity` per item. It cannot carry project-level or non-lifecycle events without widening a constraint that `ContentAction` (a closed TS union used by `lifecycleAction`, Activity, the Studio webhook and reconciliation) depends on.
- Studio today: `document.actions` in `sanity.config.ts` special-cases only `designSystem`, `formDefinition`, `project` and `publicId` duplicates. **ADR-032 D14 (replace Delete with Archive for lifecycle types) is documented but not implemented there.** There is no `readOnly` on any Catalogue document type, and `ACTIVITY_WEBHOOK_FILTER` lists `post, newsArticle, event, gallery, faqSet` — **not** the Catalogue types.
- Module permission defaults are authored against `'owner' | 'editor' | 'viewer'`; `moduleRoleFor` maps Owner and Site admin to `'owner'`, Editor to `'editor'`, retired Viewer to `'viewer'`. `isWritePermission(id)` in `src/lib/support/state.ts` treats **every permission not ending in `.read` as a write** (relevant to support mode, C8 §7).

---

# C6 — Readiness engine

## 6.1 Purpose

One pure engine answers "is this ready, for this purpose?" for an item, a collection, or a whole catalogue, against a **publication context**. Everything that today says "what is missing" derives from it:

- the item editor's blocker list and tab badges (via an adapter that keeps `ItemIssue`),
- the "To complete" chips and Overview counts,
- bulk publish,
- the server publication gate (`cataloguePrepare`),
- the Studio break-glass publish (same gate),
- exports / print / marketplace pre-flight.

No second implementation of any rule may exist (K-9 "one implementation per concept"). Rules are **data** (`ReadinessRule`), the engine is a loop. Tenant-defined standards later add rules to the same loop.

Readiness is **derived, never stored**. The only stored readiness state is an **override** of a recommended finding (6.9).

## 6.2 Types

```ts
// src/lib/modules/catalogue/readiness/types.ts   (pure, browser-safe)

export type RuleLevel = 'required' | 'recommended'

/** What is being judged. */
export type ReadinessSubjectKind = 'item' | 'collection' | 'catalogue'

/** Where the result will be used. Never inferred from a localized label. */
export type PublicationContext =
  | { kind: 'website' }                                              // the general site, no channel (K-3 rule 7)
  | { kind: 'channel'; channel: ChannelKey }                         // C2
  | { kind: 'export'; profile: ExportProfileKey; locale?: string }   // 'csv-full', 'xlsx-roundtrip', 'allergen-register' ...
  | { kind: 'print'; template: PrintTemplateKey; channel?: ChannelKey; locale: string }
  | { kind: 'marketplace'; connection: MarketplaceKey; policyVersion: string; channel?: ChannelKey } // versioned external policy (brief 2.6, 18.4)

/** Stable, serialisable key of a context: 'website' | 'channel:delivery' | 'export:csv-full' | 'print:classic:delivery:it' | 'marketplace:deliveroo@2026-03'. */
export type ContextKey = string

export type ContextKind = PublicationContext['kind']

/** Which items/contexts a rule applies to. Every present member must match (AND); absent = no restriction. */
export type RuleScope = {
  contexts?: readonly ContextKind[]
  channels?: readonly ChannelKey[]            // only for kind 'channel' | 'print' | 'marketplace' with that channel
  profiles?: readonly ItemProfile[]           // 'foodOrDrink' | 'book' | 'product' | 'service'
  primaryCategorySubtree?: CategoryKey        // C1: item's primary category is this key or a descendant
  collection?: CollectionId                   // item is placed in this collection
}

export type ReadinessCode =
  // minimum to exist (today 'blocksNext')
  | 'profileMissing' | 'nameMissing' | 'price.invalid' | 'price.times' | 'price.overlap' | 'price.channel' | 'optionsMinMax'
  // publication (today 'blocksPublish')
  | 'categoryMissing' | 'primaryCategoryMissing'      // primaryCategoryMissing = no_primary ∪ unknown_primary ∪ broken path (values.reason)
  | 'allergenReview' | 'allergenChoicesReview'
  | 'dependenciesPublishable' | 'optionListMissing'
  | 'pageAddressInvalid' | 'strayAddress' | 'pageAddressTaken'
  | 'nameMissingInLocale'
  | 'priceMissing'
  // recommended
  | 'pricePartial' | 'photoMissing' | 'descriptionMissing' | 'placementMissing' | 'translationMissing' | 'isbnInvalid'
  | 'primaryCategoryArchived' | 'price.inactiveChannel' | 'format.skuDuplicateInProject' | 'allergenEvidenceMissing'
  // handed over by C2–C5 (REVIEW X-4)
  | 'price.ambiguous' | 'price.indeterminate' | 'availability.conflictingRows'
  // aggregate
  | 'collectionEmpty' | 'collectionCoverage'
  // integrity (gate-only, 6.7)
  | 'integrity.refUnresolved' | 'integrity.refOtherProject' | 'integrity.declarationShape' | 'integrity.unknownKey'
  | 'integrity.currencyStored' | 'integrity.priceShape' | 'integrity.unknownCategory' | 'integrity.unknownChannel'
  | 'availability.scheduleInvalid'                 // D-6, row 30
  | 'integrity.legacyOffersShadowed'               // C10 `legacy.offersShadowed`: legacy offers alongside formats
  // tenant-defined (later): 'custom.<standardKey>.<ruleKey>'
  | `custom.${string}`

/** Where the person goes to fix a finding. Superset of today's {step, tab, focus}. */
export type FixTarget =
  | { surface: 'item'; step: ItemStep; tab: ItemTab; focus?: string }      // = ItemIssue.step/tab/focus today
  | { surface: 'setup'; section: SetupSection; focus?: string }            // C2/C1 owners define SetupSection
  | { surface: 'collection'; id: CollectionId; focus?: string }
  | { surface: 'list'; filter: ListFilter }                                // aggregate findings: opens the Items list filtered
  | { surface: 'none' }                                                    // integrity findings: nothing a person can click

export type Finding = {
  code: ReadinessCode
  level: RuleLevel
  /** Rule that produced it + the version of the standard it came from (6.8). */
  rule: { code: ReadinessCode; standard: string; standardVersion: number }
  /** What it is about, so a bulk result can name rows and a format-level finding can name the format. */
  target: { kind: 'item' | 'format' | 'collection' | 'catalogue'; id: string; formatKey?: FormatKey; locale?: string }
  fix: FixTarget
  /** i18n key under `catalogue.dashboard.item.issues` (kept: existing message keys continue to work). */
  messageKey: string
  /** ICU values; `locale` becomes a language name in the UI. Part of the override fingerprint (6.9). */
  values?: Record<string, string | number>
  /** Required findings only: what the old UI called the severity (blocksNext = stops the wizard advancing; blocksPublish = stops Publish). */
  gate?: 'advance' | 'publish'
  /** Recommended findings only: can a person with `catalogue.readiness.update` silence it? false for pure data hints (isbnInvalid). */
  overridable?: boolean
}

export type OverriddenFinding = { finding: Finding; override: ReadinessOverride }

export type ReadinessState = 'ready' | 'blocked' | 'readyWithWarnings'

export type ReadinessResult = {
  context: ContextKey
  subject: { kind: ReadinessSubjectKind; id: string }
  state: ReadinessState
  /** Required failures, in rule order. state === 'blocked' iff non-empty. */
  required: Finding[]
  /** Recommended failures NOT overridden, in rule order. state === 'readyWithWarnings' iff required is empty and this is not. */
  recommended: Finding[]
  /** Recommended failures silenced by a still-valid override. They do not affect `state`. */
  overridden: OverriddenFinding[]
  /** Overrides that no longer apply (rule passes now / finding changed / standard version changed). The writer clears them (6.9). */
  staleOverrides: ReadinessOverride[]
}
```

### Rules

```ts
export type RuleInput<S extends ReadinessSubjectKind> =
  S extends 'item' ? ItemReadinessInput :
  S extends 'collection' ? CollectionReadinessInput : CatalogueReadinessInput

export type ReadinessRule<S extends ReadinessSubjectKind = ReadinessSubjectKind> = {
  code: ReadinessCode
  subject: S
  /** Per context: the level, or null = rule does not apply in that context. Pure function of the context only. */
  levelIn: (ctx: PublicationContext) => RuleLevel | null
  scope: RuleScope
  /** Required rules only. Maps the old ItemIssueSeverity: 'advance' = blocksNext, 'publish' = blocksPublish. Absent on recommended. */
  gate?: 'advance' | 'publish'
  overridable?: boolean            // recommended only; default true
  /** Evaluate once per subject; may return several findings (one per format, one per locale). Pure. */
  check: (input: RuleInput<S>, ctx: PublicationContext) => RuleFailure[]
  /** Family: 'standard' (UI + gate) | 'integrity' (gate only, never shown in the editor). */
  family: 'standard' | 'integrity'
}

export type RuleFailure = Omit<Finding, 'rule' | 'level' | 'gate' | 'overridable' | 'code'>   // engine fills the rest from the rule
```

### Inputs (facts, not documents)

The engine never reads Sanity. Callers pass **facts**, so the dashboard (client state), the list (projected rows), the server gate (documents + queries) and Studio (`context.getClient`) feed the same rules.

```ts
export type ItemReadinessInput = {
  id: string                              // base id, no 'drafts.'
  /** The version that will be judged: the draft if there is one, else the published copy. */
  profile: ItemProfile | null
  name: Record<string, string>            // locale → text
  description: Record<string, string>
  siteLocales: readonly string[]          // locales the site offers (translationMissing)
  defaultLocale: string
  photoCount: number
  /** C1 — the engine never reads item category fields itself (REVIEW X-5). */
  categories: { primary: CategoryKey | null; additional: readonly CategoryKey[] }
  categoryTree: CategoryTree              // for subtree scope + unknown-additional-key integrity
  categoryState: 'ok' | 'none' | 'no_primary' | 'unknown_primary' | 'archived_primary'   // = C1 categoryAssignmentState(tree, assignment)
  primaryPath: PrimaryPath                // = C1 primaryPath(tree, primary); 'broken' carries reason missingCategory | cycle | orphan
  /**
   * C3 + C4 + C5: one row per format (implicit default format = one row), computed FOR a given offering
   * context. A function, not an array, because the same item is judged in several contexts (website → 'general',
   * channel → that channel). The facts builder memoises it; it is pure.
   */
  formats: (oc: OfferingContext) => ReadonlyArray<FormatReadinessFacts>
  placements: number                      // collections/sections the item sits in
  allergen: { declaration: unknown; mayContainEvidence?: never }  // validated with allergens.ts (allergenDeclarationIssues)
  options: ReadonlyArray<AttachmentForm>  // existing shape
  optionFacts: { counts: ReadonlyMap<string, number>; unreviewedChoices: readonly Referrer[] }   // from facts loader
  dependencies: { neverPublished: readonly Referrer[]; missing: readonly Referrer[] }          // from planPublish / client state
  page: { hasPage: boolean; slug: Record<string, string>; conflicts: readonly NamedSlugConflict[]; strayLocales: readonly string[] }
  bookIsbn: string | null
  /** Integrity facts, only supplied by the server gate and the Studio validator. */
  integrity?: { refs: ReadonlyArray<{ path: string; target: string; resolves: boolean; sameProject: boolean }>; storedCurrency: boolean; unknownKeys: readonly string[] }
  overrides: readonly ReadinessOverride[] // 6.9, from the item document
  standards: ResolvedStandards            // 6.8: which extra rules apply to this item
}

export type FormatReadinessFacts = {
  key: FormatKey
  /** C5 effectiveRule(...) for that offering context — instant-free (no `at`, no time zone). `issues` carry availability.* codes. */
  availability: EffectiveRule
  /**
   * D-6: true when the resolved availability is `available` at SOME time of the week in this offering context
   * (baseline available, or at least one scheduled `available` interval survives precedence). Derived by C5
   * (`// C5a: availableSometime(availability.rule)`); readiness never receives "now" and never asks "available right now".
   */
  everAvailable: boolean
  /** C4 priceCoverage(format, oc, channels), unchanged: { kind: 'full' } | { kind: 'partial'; gaps } | { kind: 'none' }. */
  priceCoverage: PriceCoverage
  /** C4 priceIssues(format, channels) (save-time shape problems) + runtime codes (price.ambiguous, price.indeterminate). */
  priceIssues: ReadonlyArray<PriceIssue>
  skuDuplicateInProject: boolean          // C3 facts loader (cross-document)
}

export type CollectionReadinessInput = {
  id: string
  items: ReadonlyArray<{ id: string; results: ReadonlyArray<ReadinessResult> }>   // item results already computed for this context
  placement: { sections: number; itemCount: number }
}

export type CatalogueReadinessInput = {
  items: ReadonlyArray<{ id: string; lifecycle: LifecycleStatus; results: ReadinessResult }>  // one result per item for the SAME context
  collections: ReadonlyArray<{ id: string; result: ReadinessResult }>
}
```

## 6.3 Pure functions

```ts
// src/lib/modules/catalogue/readiness/engine.ts

/** The built-in default standard, version 1 (6.5). A constant; tenant standards add to it, never replace its integrity family. */
export const DEFAULT_STANDARD: PublicationStandard

export function contextKey(ctx: PublicationContext): ContextKey

/** Rules of the default standard + the item's resolved extra standards, whose scope matches `input` in `ctx`, in registry order. */
export function applicableRules(input: ItemReadinessInput, ctx: PublicationContext, opts?: { families?: ReadonlyArray<'standard' | 'integrity'> }): ReadinessRule<'item'>[]

/** Judge one item. `families` default ['standard']; the server gate passes ['standard','integrity']. */
export function evaluateItem(input: ItemReadinessInput, ctx: PublicationContext, opts?: { families?: ReadonlyArray<'standard' | 'integrity'> }): ReadinessResult

/** Judge one collection: its own rules (collectionEmpty, collectionCoverage) over already-computed item results. */
export function evaluateCollection(input: CollectionReadinessInput, ctx: PublicationContext, standards: ResolvedStandards): ReadinessResult

/** Aggregate over many items: counts and per-state buckets. Not a pass/fail. */
export function evaluateCatalogue(input: CatalogueReadinessInput, ctx: PublicationContext): CatalogueReadiness

export type CatalogueReadiness = {
  context: ContextKey
  byState: Record<ReadinessState, number>           // over non-archived items
  byCode: Partial<Record<ReadinessCode, { required: number; recommended: number; overridden: number }>>
  chips: Record<ReadinessChip, number>              // 6.10
}

/** Pure: the stable id of "this finding as it stands" — the override fingerprint (6.9). */
export function findingFingerprint(f: Pick<Finding, 'code' | 'target' | 'values'> & { rule: Finding['rule'] }): string
```

Semantics (normative):

1. `evaluateItem` runs `applicableRules`, calls `check`, collects failures, attaches `level = rule.levelIn(ctx)`, `gate`, `overridable`, `rule = {code, standard, standardVersion}`.
2. Rules whose `levelIn(ctx)` is `null` are skipped (not "passed"). A rule never runs for a format that is **never available** in the context when the rule is availability-dependent (`priceMissing`, `pricePartial`): a format with `everAvailable === false` produces **no** price finding; `everAvailable === true` and no price ⇒ finding; the item stays available. This is the whole of K-3 rule 10's complement.
3. Overrides apply to **recommended** findings only. A required finding is never overridable, by anyone, including break-glass.
4. `state`: `required.length > 0` → `blocked`; else `recommended.length > 0` → `readyWithWarnings`; else `ready`. Overridden findings are in `overridden` and do not count.
5. Findings are in **rule registry order**, then format order, then locale order (stable, deterministic; tests rely on it).
6. `evaluateItem` is **total and never throws**: malformed input yields an `integrity.*` finding when `families` includes `integrity`, otherwise the field is treated as missing.
7. No clock, no randomness, no I/O. Time-dependent availability/price windows are resolved by C4/C5 **before** the facts are built; readiness reads C4 `priceCoverage` (`full | partial | none`, unchanged), which is time-independent (it asks "does some price apply at every minute of the week **at which the format is available** in this context", not "what is the price now").
8. Collection and catalogue evaluation consume item results for the **same context key**; mixing contexts is a programming error and throws in dev (`assertSameContext`).

## 6.4 Context semantics: what "blocked" does

| Context | What a `required` failure blocks |
|---|---|
| `website` | **Publishing / scheduling** of the item (the server gate). It also gates "Publish changes". Nothing else. |
| `channel:<key>` *(Decided — Tom 2026-11-02, D-9)* | Nothing automatically. **A requirement blocks only its scoped action** (D-9: e.g. a marketplace-image failure blocks that marketplace export, never the website or Catalogue availability). It gates actions explicitly tied to the channel (that channel's PDF/menu export, that channel's feed). The item **stays visible and available** in the channel; readiness never changes availability (K-3 rule 10). |
| `export:<profile>` | That export for that row (the export result lists blocked rows by code; the person may export the ready rows or the whole set with warnings, per profile `strictness`). |
| `print:<template>` | PDF generation for that template/locale. |
| `marketplace:<connection>@<policy>` | Sync/publish to that connection for that row. Historical results are never rewritten when a policy version changes (brief 18.4). |

Only `website` is evaluated inside `publishTogether`. Other contexts are evaluated by their own actions, which call the same `evaluateItem`.

### 6.4a Publication context → offering context (REVIEW X-6)

C5/C4 answer questions about an `OfferingContext` (`general | channel`); readiness is asked about a `PublicationContext`. They stay two types; one pure function relates them, and **it is the only place the mapping exists**:

```ts
export function offeringContextOf(ctx: PublicationContext): OfferingContext {
  switch (ctx.kind) {
    case 'website':     return { kind: 'general' }                       // no channel selected (K-3 rule 7)
    case 'channel':     return { kind: 'channel', channel: ctx.channel }
    case 'print':       return ctx.channel ? { kind: 'channel', channel: ctx.channel } : { kind: 'general' }
    case 'marketplace': return ctx.channel ? { kind: 'channel', channel: ctx.channel } : { kind: 'general' }
    case 'export':      return { kind: 'general' }
  }
}
```

`evaluateItem` calls `input.formats(offeringContextOf(ctx))`. Fixtures R-08 … R-13 state the mapping they rely on.

## 6.5 Built-in default standard (version 1)

`levelIn` per context. R = required, r = recommended, – = not applicable. Order is the registry order (and the order findings appear in).

| # | Code | Applies when | website | channel | export | print | marketplace | gate | Fix target |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `profileMissing` | profile null | R | R | R | R | R | advance | item · profile · content |
| 2 | `nameMissing` | no text in `defaultLocale` | R | R | R | R | R | advance | item · name · content · `[data-name-locale="<d>"]` |
| 3 | `price.invalid` / `.times` / `.overlap` / `.channel` | C4 `priceIssues` non-empty (one finding per kind, same grouping as `itemIssues` today). **One mapping table owned by C6** (`PRICE_ISSUE_TO_RULE`) turns every C3/C4 save-time code (`format.*`, `price.*`) into one of these four groups; `[data-offer-key]` focus selectors are legacy offer vocabulary and are re-expressed over C3/C4 keys (`[data-format-key]`, `[data-price-key]`) when R2 ships (REVIEW C-17) | R | R | R | R | R | advance | item · price · prices · `[data-offer-key=…]` |
| 4 | `optionsMinMax` | an attachment min > max | R | R | R | R | R | advance | item · options · options |
| 5 | `categoryMissing` | `categoryState === 'none'` (C1 `categoryAssignmentState`; the engine does not read item fields) | R | r | R if profile `export.requiresCategory`, else r | R | R | publish | item · category · content (C1 picker) |
| 6 | `primaryCategoryMissing` | `categoryState` ∈ {`no_primary`, `unknown_primary`} **or** `primaryPath.kind === 'broken'`. `values.reason` ∈ `noPrimary | unknownPrimary | missingCategory | cycle | orphan` (also carries C5 `availability.primaryCategoryBroken` — same row, not a second finding). Visible in the editor (REVIEW X-5) | R | r | r | r | R | publish | item · category |
| 7 | `allergenReview` | profile has `foodInformation` and (`!isPublishableDeclaration`, or C13 `editedOutsideReview`, `mayContainNotAssessed`, `staleLinked` (a linked choice's recorded fingerprint differs from the linked item's published one), or an open `ComplianceTask`) | R | R | R | R | R | publish | item · details · details |
| 8 | `allergenChoicesReview` | food item with ≥1 unreviewed free-text add choice (`optionFacts.unreviewedChoices`) | R | R | R | R | R | publish | item · options · options |
| 9 | `dependenciesPublishable` | `dependencies.neverPublished` or `.missing` non-empty | R | – | – | – | – | publish | item (names each dependency, link to it) |
| 10 | `optionListMissing` | attachment points at a list that does not exist | R | – | – | – | – | publish | item · options · options |
| 11 | `pageAddressInvalid` | `hasPage` and name present and `slugFromName(base)` empty | R | – | – | – | – | publish | item · page · page · `[data-slug-locale]` |
| 12 | `strayAddress` | slug in a locale whose name is empty (E-3) | R | – | – | – | – | publish | item · name/languages |
| 13 | `pageAddressTaken` | `page.conflicts` non-empty (D11 shared namespace) | R | – | – | – | – | publish | item · page (names the other document) |
| 14 | `nameMissingInLocale` | export/print/marketplace in locale L and `name[L]` empty | – | – | R | R | R | – | item · languages |
| 15 | `priceMissing` | a format that is **available at some time** (`everAvailable`, D-6) has `priceCoverage.kind === 'none'` (C4 code `price.missing`) | **r** | **R** | R if profile `export.showsPrice` else r | R if template `showsPrice` else – | R | – | item · price · prices |
| 16 | `pricePartial` | a format that is available at some time (`everAvailable`) has `priceCoverage.kind === 'partial'` (C4 `price.partialCoverage`; `values.gaps` = number of uncovered week intervals; message names the first) | r | r | r | r | r | – | item · price |
| 17 | `photoMissing` | `photoCount === 0` | r | r | r | r (if template shows images) | R if connection policy says so (policy rule, #custom) else r | – | item · photo · photos |
| 18 | `descriptionMissing` | no text in `defaultLocale` | r | r | r | r | r | – | item · name · content |
| 19 | `placementMissing` | published-eligible item in no collection/section | r | r | – | – | – | – | item (or collection builder) |
| 20 | `translationMissing` | one finding per locale in `siteLocales \ {default}` where `name[L]` empty. Locales come from the site's existing **public locale configuration** (the source the website language switcher uses), not from C11 (REVIEW X-15); a locale added in the current session is excluded until someone starts translating it. | r | – | – | – | – | – | item · languages · `[data-name-locale="<L>"]` |
| 21 | `isbnInvalid` | book profile, ISBN set, `!isValidIsbn` | r (`overridable: false`) | – | – | – | – | – | item · name · content · `[data-book-isbn]` |
| 22 | `primaryCategoryArchived` | `categoryState === 'archived_primary'` | r | r | r | r | r | – | item · category |
| 23 | `price.ambiguous` | any format has runtime `price.ambiguous` (two prices at the same precedence and instant — never a pick, K-3.11) | R | R | R | R | R | publish | item · price |
| 24 | `price.indeterminate` | a windowed price exists but the project has no time zone (C4) | R | R | R | R | R | publish | Setup · public website · time zone (`fix.surface:'setup'`) |
| 25 | `availability.conflictingRows` | duplicate availability rows with conflicting states at one level (C5: level treated as unset, error reported) | R | R | R | R | R | publish | item · channels |
| 26 | `price.inactiveChannel` | a price **or availability row** names an inactive or unknown channel (ignored by resolvers; code `price.inactiveChannel` kept) | r | r | – | – | – | – | item · price |
| 27 | `format.skuDuplicateInProject` | SKU repeated in another document (cross-document, cannot be a save-time error) | r | r | r | – | r | – | item · price (format row) |
| 28 | `allergenEvidenceMissing` | food item, declaration reviewed but `review` block absent/incomplete (legacy declarations before C13) — see C13 | r (`overridable: false`) | r | r | r | r | – | item · details · details |
| 29 | `integrity.legacyOffersShadowed` | legacy `offers[]` non-empty alongside `formats[]` (C10 `legacy.offersShadowed`) | gate-only, R | – | – | – | – | publish | none |
| 30 | `availability.scheduleInvalid` *(D-6, added Rev 3)* | any format's availability `issues` carry a C5a **schedule/row error**: `availability.scheduleOverlap` (overlapping overrides at one scope), `scheduleInvalidTime`, `scheduleIncomplete`, `scheduleZeroLength`, `scheduleUnknownDay`, `scheduleUnknownKind`, `scheduleLimitExceeded`, `scheduleOnImplicitFormat`, `keyMismatch`, `duplicateChannel` or `stateInvalid`. `values.reason` = the C5a code; one finding per format, naming the first. **Not** raised for `availability.scheduleRedundant` (a C5a warning, shown in the schedule editor only) and **never** for "currently unavailable by schedule" (see below) | R | R | R | R | R | publish | item · channels (`fix.surface:'setup'` when the overlap sits on a category or channel schedule) |
| 31 | `profileMismatch` *(D-22, added 2026-11-03)* | an assigned primary or additional category, tag or attached option list whose "Use for" excludes the item's profile (C1.12 `incompatibleAssignments`; one finding per assignment; `values.kind` = primary · additional · tag · option, `values.key`) — activation `always` (fires only where `useFor` data exists); **not** in the D-15 re-exposure subset | R | R | R | R | R | publish | item · category (categories) / content (tags) / options |

### Price: the decision (K-3 rule 10)

*Decided — Tom 2026-11-02, D-8:* website: recommended warning by default. Channel-specific delivery, priced export, PDF or marketplace output: required. Restaurant packs may propose website price required for food; the tenant can review that standard. A missing price never changes availability. So: **`website` = recommended; every context that delivers a price to a customer or partner (channel delivery, priced export, PDF, marketplace) = required.**

Reasons: (a) the website legitimately shows priced-on-request services, books without a shop price, and tasting events (D-6 three-state price visibility, F-3 "page without an offer emits no Product"); blocking publication would stop those tenants. (b) A takeaway menu, a PDF with a price column and a marketplace feed are *about* the price; a missing price there is a defect in that deliverable. (c) A website item with a missing price still shows in the dashboard as a gap and in the "No price" chip, so the warning is not lost. A tenant who wants it required on the website adds a tenant rule (6.8) scoped to the website context or to a category subtree (a restaurant starter pack ships that rule — see 6.8).

**Codes handed over by C2–C5 are all in the registry (REVIEW X-4):** `price.missing`→15, `price.partialCoverage`→16, `price.ambiguous`→23, `price.indeterminate`→24, `availability.conflictingRows`→25, `availability.primaryCategoryBroken`→6 (`values.reason`), `price.inactiveChannel`→26, `format.skuDuplicateInProject`→27, `legacy.offersShadowed`→29, and the C3/C4 save-time `format.*`/`price.*` codes→3 via `PRICE_ISSUE_TO_RULE`. Also: `availability.unknownChannel`→`integrity.unknownChannel`; `availability.inactiveChannel`→26; `availability.scheduleRedundant`→`NOT_A_READINESS_CODE`; `availability.scheduleUnknownKind`, `scheduleLimitExceeded`, `scheduleOnImplicitFormat`, `keyMismatch`, `duplicateChannel`, `stateInvalid` and the other schedule errors→30. A test (R-33) fails if a code exported by `ChannelIssueCode | FormatIssueCode | PriceIssueCode | AvailabilityIssueCode` has no mapping.

### Time-based availability is not a readiness problem (D-6)

*Decided — Tom 2026-11-02, D-6.* Availability now has weekly schedules (C5a, in the C2–C5 file). Consequences for this engine, all normative:

1. **"Currently unavailable by schedule" is never a finding.** Dinner at 15:00, breakfast at 14:00, "not on Sundays" are normal states. No rule reads `availableNow`, `nextTransition` or `activeOverride`; readiness takes no instant at all, so findings, chips and counts (AC-10) never change at 18:00 without an edit.
2. **Price rules ask "ever available", not "available now".** `priceMissing` / `pricePartial` apply to a format that is available at some time of the week (`FormatReadinessFacts.everAvailable`). A dish that is only available 18:00–23:00 and has no price is still flagged; a format that is never available (baseline `unavailable`, no `available` interval) is not.
3. **Only invalid schedules are findings:** row 30 `availability.scheduleInvalid` (required, all contexts, publish gate, plus the fix target into the schedule editor). The C5a code `availability.scheduleRedundant` (warning) is deliberately **not** mapped to a rule: it is advisory in the schedule editor, and test R-33 lists it in an explicit `NOT_A_READINESS_CODE` allow-list so "every handed-over code is mapped" still fails on any genuinely forgotten code.
4. Readiness never changes availability (K-3 rule 10) — unchanged, and now also true of schedules.

### Rules deliberately NOT in v1

- "Item unavailable on every channel": intent, not a defect.
- Image technical policy, rights/provenance: added by the media-compliance slice as `custom` rules (`mediaPolicy`, `imageRights`); the shape already accommodates them (declarative rule `kind: 'imageRights'`).

## 6.6 How `item-issues.ts` maps in without losing UI focus links

`item-issues.ts` stays as a **thin adapter**; the UI keeps working without change.

```ts
// item-issues.ts (after)
export function itemIssues(s: ItemIssueState, ctx: ItemIssueContext): ItemIssue[] {
  const result = evaluateItem(itemReadinessInputFromState(s, ctx), WEBSITE, { families: ['standard'] })
  return [...result.required, ...result.recommended.filter((f) => f.overridable === false)]  // advice stays advice
    .map(findingToItemIssue)
}

export function findingToItemIssue(f: Finding): ItemIssue   // pure, 1:1
//  severity: f.level === 'required' ? (f.gate === 'advance' ? 'blocksNext' : 'blocksPublish') : 'advice'
//  step/tab/focus: from f.fix when f.fix.surface === 'item'
//  id: f.code mapped by LEGACY_ID (below); messageKey, values copied
```

Legacy id mapping (tests pin it): `profile←profileMissing`, `name←nameMissing`, `price←price.invalid`, `priceTimes←price.times`, `priceOverlap←price.overlap`, `priceChannel←price.channel`, `optionsMinMax`, `allergens←allergenReview` (messageKey `allergens.<first declaration issue>` preserved through `values.detail`), `optionList←optionListMissing`, `pageAddress←pageAddressInvalid`, `strayAddress`, `isbn←isbnInvalid`.

- `blocksNextOn`, `publishBlockers`, `issueCountByTab`, `adviceTabs` are unchanged (they only read `severity`, `step`, `tab`).
- Recommended findings that are **not** advice (photo, description, placement, translation, partial price) are **not** projected into `ItemIssue` — the editor does not change today. They appear in a new "Ready to publish" panel (Catalogue UI slice) that renders `ReadinessResult` directly, with the same `FixTarget` jump.
- The wizard's per-step hint (`blocksNextOn(issues, step)`) keeps working because `gate:'advance'` findings carry `fix.step`.
- `itemReadinessInputFromState(s, ctx)` is the **client** facts builder (state → input); `loadItemFacts(...)` (6.7) is the server/Studio one. Both are tested to produce identical inputs for the same document (fixture R-30).
- Missing today and added: the dashboard never showed `categoryMissing`, `pageAddressTaken`, `dependenciesPublishable` as blockers before Publish was pressed; now they appear because the same engine runs. This is intended.

**Superseded:** `ItemGap`, `itemGaps()` (dashboard-form.ts) — its four gaps become chips derived from the engine (`noPhoto←photoMissing`, `noPrice←priceMissing` in the website context, `allergensNotReviewed←allergenReview`, `noCategory←categoryMissing`). `GapBadges` takes `Finding[]`. `getCatalogueGlance().noPrice` and `CATALOGUE_GLANCE_QUERY` `noPrice` (offers==0) are replaced by the engine count (otherwise Home and the list disagree — AC-10).

## 6.7 The server publication gate (exact placement)

**Gate = `cataloguePrepare` in `src/lib/api/catalogue-drafts.ts`.** Refactor (behaviour-preserving first, then extended):

1. Extract it, unchanged, to `src/lib/api/catalogue-publish-gate.ts` and export as `cataloguePublishGate(site, uuid)`; `catalogue-drafts.ts` imports it. (Needed so the Studio break-glass route can import the same function without importing the whole drafts API.)
2. Inside the returned `prepare(node, x)`, replace the inline checks (`missing_name`, `no_options`, `allergens_not_reviewed`, `option_allergens_not_reviewed`, `slug_without_name`, `slug_taken`, `missing_slug`) by:

```ts
const facts = await loadNodeFacts(node, { client: x.client, projectSlug: x.projectSlug, site })      // IO: the queries that exist today
const result = evaluateNode(node, facts, WEBSITE, { families: ['standard', 'integrity'] })
if (result.state === 'blocked') throw readinessToCatalogueError(result, node)                         // 6.7.1
// … then the existing doc-building code (publicId, slugs via slugsForPublish) is unchanged
```

where `evaluateNode` maps option lists / collections / pages to their subject rules (option list: `no_options`, unreviewed choices; collection: name; cataloguePage: name) and items to `evaluateItem`.

3. `loadNodeFacts` is the **only** IO: it reuses `unreviewedChoicesOf`, `namespace()` + `namedSlugConflicts`, `CATALOGUE_REF_TARGETS_QUERY` (new: integrity refs), and the `planPublish` result already computed by `publishTogether` (dependencies). It is built on an injected `fetch`, so Studio can call the same loader with `context.getClient({apiVersion}).fetch` (6.7.2).

### 6.7.1 Error compatibility

`CatalogueErrorCode` stays stable. `readinessToCatalogueError` maps the **first required finding** (registry order) to the code the UI already handles, and attaches the full list:

```ts
const LEGACY_ERROR_CODE: Partial<Record<ReadinessCode, CatalogueErrorCode>> = {
  nameMissing: 'missing_name', allergenReview: 'allergens_not_reviewed', allergenChoicesReview: 'option_allergens_not_reviewed',
  strayAddress: 'slug_without_name', pageAddressTaken: 'slug_taken', pageAddressInvalid: 'missing_slug',
  dependenciesPublishable: 'unpublished_dependencies', optionListMissing: 'unpublished_dependencies',
}
// anything else → new code 'not_ready'; detail.readiness = Finding[] (all required findings, with fix targets)
```

`CatalogueErrorCode` gains `'not_ready'`. `CatalogueErrorDetail` gains `readiness?: Finding[]`. For a dependency node the existing `named()` wrapper still prefixes the dependency (so a combined publish names which dependency failed).

### 6.7.2 Who calls the gate

| Caller | Path | Notes |
|---|---|---|
| Dashboard single publish | `publishCatalogueDraft` → `publishTogether(prepare = cataloguePublishGate)` | today |
| Dashboard preview of publish | `previewCataloguePublish` → loops `prepare` | `blocked[]` gains `findings` |
| Dashboard bulk publish | `publishCatalogueBatch` (6.11) → per row `publishCatalogueDraft`, or `publishManyTogether` for all-or-nothing | new |
| Studio break-glass publish | route `POST /api/admin/catalogue/studio-publish` → `publishCatalogueAsOperator` → `publishTogether(prepare = cataloguePublishGate)` | C9 §9.5; the **only** way a Studio publish can happen |
| Studio validation (UX only) | `studioValidation(document, getClient)` → `loadItemFacts` + `evaluateItem` → markers | advisory; not the gate |
| `backOnline` (Publish again), **restore → back online**, `setDates` (re-exposing a published copy) | `lifecycle.backOnline` / `lifecycle.setDates` via `runCatalogueLifecycle` | **Re-exposure of an already-gated version**, not publication of a new one (below). Runs `cataloguePublishGate` in `mode: 'reexpose'` on the *published copy*, re-running **only the safety subset** (*Decided — Tom 2026-11-02, D-15*): **allergen review; option-choice allergen review; valid declaration shape; dangling or unresolved references** (rules `allergenReview`, `allergenChoicesReview`, `integrity.declarationShape`, `integrity.refUnresolved` — the only rules flagged `reexpose`). **Ordinary quality requirements (image, description, placement) are not re-run on re-exposure**; no other rule runs (facts include the draft's open compliance tasks, C13 13.4). Refuses with findings. Needs a small service extension: `LifecycleDescriptor.reexposeCheck?: (published, x) => Promise<void>`, set by the Catalogue descriptors. |
| Scheduled go-live | none | `publishTogether` writes the published copy at schedule time; no job runs at go-live (ADR-032 D6/D8). A later change to a dependency cannot un-ready an already-scheduled copy; edits go to a new draft which is judged again at its own publish. |

**"Versions, not copies" (REVIEW C-15, stated normatively).** The required-rule gate (`mode: 'publish'`) runs on **every transition that creates or replaces a published version**: single publish, publish with dependencies, bulk publish, schedule, "Publish changes" and the Studio operator publish — all through `publishTogether`. Transitions that only change *when an existing published version is visible* (`backOnline`, restore, `setDates`, unpublish, archive) never re-judge it against the **current** standard — otherwise tightening a standard would silently take live content down or block restore (REVIEW Issue 5 "never retroactive"). The one exception is the narrow safety subset above, because an allergen declaration or a dangling reference on a copy that returns to the website is a legal/integrity matter, not a standards matter (decided, D-15: back online, restore and date changes re-run only the safety subset; image, description and placement are never re-run there). Any path that creates a published version without `publishTogether` is a defect: test **G-04** enumerates every writer of a Catalogue published document and fails on an unknown one.

### 6.7.3 Integrity family (gate-only)

Why: the dashboard's patch path (`cleanCatalogueSet`) guarantees well-formed documents; `cataloguePrepare` today **relies** on that. A Studio break-glass edit bypasses `cleanCatalogueSet`, so the gate must re-establish integrity itself (K-7: "referential integrity, … price/availability validity"). Integrity rules never appear in the editor (`fix: none`), always `required`, always `levelIn → 'R'` in `website`, and `families` includes `'integrity'` only at the gate and in Studio validation.

| Code | Fails when |
|---|---|
| `integrity.refUnresolved` | any `_ref` (photos, option lists, items in sections, linked items, categories) does not resolve to a document of the expected type |
| `integrity.refOtherProject` | a ref resolves to a document whose `projectSlug` ≠ the node's |
| `integrity.declarationShape` | `allergenDeclarationIssues` contains `unknownStatus`, `unknownKey` or `unexpectedField` (and for option choices `optionDeclarationIssues`) |
| `integrity.unknownKey` | a category/tag/channel/format/dietary key not defined in the project (C1/C2/C3 key sets) |
| `integrity.currencyStored` | a price or legacy offer carries `currency` or `locationKey` (D7/A6: never stored per offer) |
| `integrity.priceShape` | negative price, > 2 decimals, non-finite, C4 `priceIssues` of kind overlap/ambiguity |
| `integrity.unknownCategory` / `.unknownChannel` | as above, split so the person-facing messages differ |

## 6.8 Publication standards (shape only, versioned)

```ts
export type PublicationStandard = {
  key: string                       // 'default' | 'restaurant-menu' | tenant-defined
  version: number                   // increments on any change; stored with every override
  name: Record<string, string>
  scope: RuleScope                  // where the whole standard applies
  rules: ReadonlyArray<RuleRef | DeclarativeRule>
  effectiveFrom?: string            // ISO; policy standards (marketplace) are effective-dated
  external?: { source: string; policyVersion: string; country?: string; partner?: string }   // brief 2.6/18.4: metadata only, never "guaranteed accepted"
}

/** Re-levels or scopes a built-in rule: { code: 'priceMissing', level: 'required', scope: { contexts: ['website'], primaryCategorySubtree: 'food' } } */
export type RuleRef = { code: ReadinessCode; level?: RuleLevel; scope?: RuleScope }

/** Tenant-definable, declarative (brief 17.3). No code from tenants. */
export type DeclarativeRule =
  | { key: string; kind: 'fieldPresent'; field: ItemFieldPath; locales?: 'default' | 'all'; level: RuleLevel; scope: RuleScope }
  | { key: string; kind: 'textLength'; field: ItemFieldPath; min?: number; max?: number; level: RuleLevel; scope: RuleScope }
  | { key: string; kind: 'imagePresent'; min: number; level: RuleLevel; scope: RuleScope }
  | { key: string; kind: 'placementPresent'; level: RuleLevel; scope: RuleScope }
  | { key: string; kind: 'translationPresent'; locales: readonly string[]; level: RuleLevel; scope: RuleScope }
  | { key: string; kind: 'collectionCoverage'; field: 'photo' | 'description' | 'price'; minPercent: number; level: RuleLevel; scope: RuleScope }   // aggregate

/** What an item resolves to: the default standard + each standard whose scope matches it. Computed by the caller from settings. */
export type ResolvedStandards = { default: PublicationStandard; extra: readonly PublicationStandard[] }

export function resolveStandards(settings: { standards: readonly PublicationStandard[] }, item: Pick<ItemReadinessInput, 'profile' | 'categories' | 'categoryTree'>, ctx: PublicationContext): ResolvedStandards
```

Rules of composition (normative):

- **Conflicts resolve toward stricter**: if the default and a tenant standard give the same code different levels in the same context, `required` beats `recommended`. A tenant standard can **raise** a recommended rule to required and add rules; it **cannot lower** a built-in required rule or disable the integrity family (publication safety and allergens are not configurable — same rule as "no configuration may hide an allergen").
- Custom finding codes are `custom.<standardKey>.<ruleKey>`; message text is tenant-supplied localized text stored with the standard.
- A standard change **increments `version`**, which expires overrides of its rules (6.9) and writes `standard.changed` (C12).
- Storage (6.12): `cataloguePublicationStandards.standards: PublicationStandard[]` (ordered) in `catalogue-standards.<slug>`, plus `defaultStandard: 'default'`. The built-in default is code, not data, so an upgrade of the platform standard (v1→v2) is a deployed change with its own `standardVersion`; tenants are never migrated silently.
- Launch packs may ship a standard (e.g. restaurant packs add `{ code: 'priceMissing', level: 'required', scope: { contexts: ['website'], primaryCategorySubtree: <food root> } }`) as a **suggestion** in the pack preview — applied only if the person accepts (K-6: never silently).

## 6.9 Override of a recommended finding

```ts
export type ReadinessOverride = {
  _key: string
  ruleCode: ReadinessCode
  context: ContextKey                // 'website' | 'channel:delivery' …
  standard: string
  standardVersion: number            // rule's standard version at override time
  fingerprint: string                // findingFingerprint(...) at override time
  by: string                         // user id (Supabase auth id), never a name
  at: string                         // ISO UTC
  reason: string                     // REQUIRED (D-17: record who, when and why); 3–200 chars; stays on the item, never copied to audit
}
```

- **Who** *(Decided — Tom 2026-11-02, D-17)*: only Owner and Site admin may override a recommended warning — a member holding `catalogue.readiness.update` (C8; default Owner and Site admin; **not** Editor). **Record who, when and why** (`by`, `at`, required `reason`). It expires when the underlying meaning changes (below). **Required findings are never overridable**, nor are non-overridable recommended findings (`isbnInvalid`, `allergenEvidenceMissing`): the server refuses with `invalid_value`. A missing or empty `reason` is also `invalid_value`.
- **Where recorded:** on the **item document** as `readinessOverrides: ReadinessOverride[]` (field is outside the dashboard patch allowlist; written only by `overrideReadiness()`, never by `patchCatalogueDraft`; Studio field is `readOnly` always, even in break-glass). It travels with the draft and is copied to the published copy on publish. It is item-scoped because it must disappear with the item and be evaluated with the same facts. Each write also records `readiness.override_recorded` (C12; the Rev 2 name `readiness.overridden` is retired before any row exists), and each expiry `readiness.override_expired`.
- **Does it expire when content changes?** It expires on **meaning**, not on any edit:
  1. the rule now passes → override is stale (moot) and the writer drops it with `readiness.override_expired{cause:'resolved'}`;
  2. the finding's fingerprint differs (e.g. the missing translation was German and is now French; the format that lacked a price changed) → stale, expired `cause:'changed'`;
  3. the standard version that defines the rule increased → stale, expired `cause:'standardChanged'`;
  4. manual revoke → expired `cause:'revoked'`.
  Unrelated edits (e.g. fixing a typo in the name) do **not** expire it. `evaluateItem` reports `staleOverrides`; clearing happens on the next write of the item (publish or save), never in a read path.
- An override never changes `state` for a *different* context: `contextKey` is part of the match.

## 6.10 Overview counts and "To complete" chips (AC-10)

```ts
export const READINESS_CHIPS = [
  'needsAllergenReview', 'noPhoto', 'noDescription', 'noCategory', 'noPrimaryCategory', 'noPlacement',
  'missingDependency', 'missingTranslation', 'noPrice', 'channelPolicyFailure', 'imagePolicyFailure',
] as const
export type ReadinessChip = (typeof READINESS_CHIPS)[number]

/** Chip → the finding codes that make an item match it. The ONLY place this mapping exists. */
export const CHIP_CODES: Record<ReadinessChip, readonly ReadinessCode[]> = {
  needsAllergenReview: ['allergenReview', 'allergenChoicesReview'],
  noPhoto: ['photoMissing'], noDescription: ['descriptionMissing'],
  noCategory: ['categoryMissing'], noPrimaryCategory: ['primaryCategoryMissing'], noPlacement: ['placementMissing'],
  missingDependency: ['dependenciesPublishable', 'optionListMissing'], missingTranslation: ['translationMissing'],
  noPrice: ['priceMissing', 'pricePartial'], channelPolicyFailure: [/* custom.* of channel/marketplace standards */], imagePolicyFailure: [/* mediaPolicy, imageRights (later) */],
}

export function rowMatchesChip(r: ReadinessResult, chip: ReadinessChip): boolean   // any required|recommended|overridden? → required ∪ recommended only (overridden do NOT match)
export function filterByChip<T extends { readiness: ReadinessResult }>(rows: readonly T[], chip: ReadinessChip): T[]
export function countChips(rows: readonly { readiness: ReadinessResult }[]): Record<ReadinessChip, number>   // = filterByChip(...).length, implemented as such
```

- Counts are computed over the **same list rows** the Items list shows, in the `website` context unless a channel is selected in the list header (then that channel's context). Because `countChips` is *defined* as `filterByChip(...).length`, a chip and its filtered list cannot disagree; a property test pins it.
- Scope of the rows: non-archived items, **drafts included** (readiness is judged on the version that would be published next). Archived items are excluded (they cannot publish). Issue I-9 below explains why `needsAllergenReview` inflates on fresh drafts and the suggested toggle.
- `listCatalogue` computes `readiness` per row server-side from projected facts (extending `CATALOGUE_DASHBOARD_LIST_QUERY` with the fields the facts need). It is O(rows × rules); acceptable for thousands of rows; if profiling shows otherwise, memoise per `(id, _rev, ctxKey)`.

## 6.11 Bulk publish

```ts
export type BulkPublishMode = 'publishReady' | 'allOrNothing'

export type BulkRowPlan =
  | { id: string; outcome: 'willPublish'; step: BatchStep; readiness: ReadinessResult }        // BatchStep from list-model.ts
  | { id: string; outcome: 'blocked'; readiness: ReadinessResult }                              // required findings, with fix targets
  | { id: string; outcome: 'skipped'; reason: 'notApplicable' | 'archived' | 'noDraft' }        // batchStep returned null

export type BulkPublishPlan = { mode: BulkPublishMode; rows: BulkRowPlan[]; canProceed: boolean; counts: { willPublish: number; blocked: number; skipped: number } }

/** PURE. Rows with their statuses and readiness → plan. `allOrNothing`: canProceed iff blocked === 0 (skipped rows do not block). */
export function planBulkPublish(rows: ReadonlyArray<{ id: string; status: LifecycleState; readiness: ReadinessResult }>, mode: BulkPublishMode, canWrite: boolean): BulkPublishPlan
```

Server (`catalogue-drafts.ts`, new):

```ts
export function previewCatalogueBatch(ctx, projectId, input: { op: BatchOp; ids: string[]; mode: BulkPublishMode }, deps): Promise<BulkPublishPlan>   // read-only; same loader + engine as the gate
export function publishCatalogueBatch(ctx, projectId, input: { ids: string[]; revs: Record<string, string>; mode: BulkPublishMode; confirmedPlan: string }, deps): Promise<BulkPublishResult>
export type BulkPublishResult = { bulkId: string; rows: Array<{ id: string; ok: boolean; code?: CatalogueErrorCode | 'not_ready'; findings?: Finding[] }>; done: number }
```

- Per-row result names every blocker (codes + fix targets) — the existing `summarizeBatch` `reason` becomes `findings`.
- `publishReady`: each ready row goes through `publishCatalogueDraft` (so each passes the gate again — the plan is advisory, the gate authoritative; a row that became blocked between preview and publish is reported blocked, not failed).
- `allOrNothing` *(Decided — Tom 2026-11-02, D-19)*: **`publishManyTogether(descriptors, ctx, projectId, roots[], prepare, deps)`** — a new lifecycle primitive in the bulk slice (the current `publishTogether` is single-root). Exactly:
  1. **Validate all documents and dependencies first** (`prepare` for every root and every dependency, nothing written yet).
  2. **One transaction or nothing**: a single Sanity transaction with revision guards; any failure writes zero documents.
  3. **Respect the real payload limit.** The limit is one constant, `SANITY_MUTATION_MAX_BYTES = 4_000_000` in `src/lib/sanity/limits.ts`, with a comment citing Sanity's "Technical limits" page (mutation request body ≤ 4 MB, read 2026-11-02). `estimatePublishManyPayload` compares against it with a 20 % margin; tests inject a smaller value. (C7 `PACK_MAX_TX_BYTES = min(1_000_000, SANITY_MUTATION_MAX_BYTES)` from the same module.)
  4. **100-document operational cap** (an operational ceiling we choose, below any payload limit in normal use).
  5. **Calculate the payload before attempting**: `estimatePublishManyPayload(plan): { documents: number; bytes: number }` is pure (serialised mutations plus a safety margin) and runs before the transaction is built.
  6. **Refuse clearly when too large**: more than 100 documents, or an estimate over the limit → `too_large`, naming which of the two failed, the counts, and the number to reduce to; nothing is attempted.
  7. Larger needs use **reviewed batches in the UI** (the user reviews each chunk's plan). A reviewed batch is **never described as atomic** — copy and result summary say "published in N batches"; only a single `publishManyTogether` call may be called all-or-nothing.
- `allOrNothing` result copy: success = "All N published together"; refusal = the `too_large`/`blocked` message; a partial outcome cannot occur in this mode.
- `confirmedPlan` is a hash of the previewed `willPublish` ids+revs; if the server's re-plan differs in `allOrNothing` mode it refuses with `conflict` (no partial surprise).
- Activity: each published row writes its normal `published` row to `content_audit_log` (existing `audited`), all sharing `detail.bulkId`; plus one `bulk.executed` row in the Catalogue audit (C12).

## 6.12 Storage shape

- Engine: no storage. Facts: existing documents + queries.
- Overrides: `catalogueItem.readinessOverrides` (above). Schema: array of objects, all fields `readOnly`, `hidden` in Studio form (visible in the "Readiness" tab as read-only list).
- Standards: own per-project `liveEdit` document **`cataloguePublicationStandards`**, `_id = catalogue-standards.<projectSlug>` (REVIEW X-7: structured, independently-revisioned data does not belong in the shared, contended project document; edited only in Catalogue → Setup; `projectSlug` required; fields: `standards: PublicationStandard[]` (array, never map-shaped, per Sanity's attribute limit), `defaultStandard: 'default'`, `rev`-guarded writes by the Setup service). The module config (`project.moduleInstallations[catalogue].config`) keeps only scalar settings (C2/C11). *Decided — Tom 2026-11-02, D-1.*
- Nothing about results is stored. The Overview never reads a cached count.

## 6.13 Migration from today

**Ordering is not defined here.** The single ordered plan (M0 audit store → R1 readers → pre-flight/rehearsal → Tom → R2 writers → data steps D1–D4 → R3 cleanup → model-dependent rules on) is **E-1, owned by the C10 contract**. C6 contributes these work items and nothing else:

1. **R1:** add `readiness/` (types, engine, rules, facts builders); re-implement `itemIssues` as the adapter, existing `item-issues.test.ts` / `dashboard-form.test.ts` unchanged and green (the editor equivalence proof); extract `cataloguePublishGate` (pure move) and switch its body to the engine **with `LEGACY_ERROR_CODE` mapping**, add `not_ready`. Behaviour-preserving: only rules whose data exists today are active.
2. **Activation of model-dependent rules is per project, keyed by migration state, not by date or release** (REVIEW C-16): `STANDARD_V1_ACTIVATE` is a function `activeRules(projectMigrationState)`; `categoryMissing`/`primaryCategoryMissing` become active for a project when its C1 data step (D1) is verified; the price/availability rules and `integrity.*` shape rules when its C10 step (D2) is verified. A project migrated later therefore never tightens silently earlier or later than its data. The state is read from module config `catalogueMigrations.taxonomy` / `.commerce` (C10-6): D1 verified ⇒ `taxonomy` set; D2 verified ⇒ `commerce` set. Not from the release.
3. **R2:** replace `itemGaps` / glance `noPrice` with chips (needs C4 `priceCoverage`); `readinessOverrides` field + `overrideReadiness()` with the C8 permission (override UI last); `LifecycleDescriptor.reexposeCheck` (6.7.2) and `LifecycleDescriptor.publishEffects?: (plan, x) => Mutation[]` — extra mutations added to the publish transaction (C13 linked invalidation), counted against the 100-document cap.
4. No data migration for the engine itself. Production today: 16 items, all `tmz`, no channels — all findings are computable from existing documents.

## 6.14 Needs from other contracts

C1: `filterKeys(tree, subtree).includes(primary)` for `primaryCategorySubtree` scope (no new C1 function), `categoryAssignmentState`, `primaryPath`/`PrimaryPath`. C3: `Format[]` with `key`, implicit default format. C4: `priceCoverage(format, oc, channels, availability: WeekProfile): PriceCoverage` (`full | partial | none`; `weekProfile(availability.rule)`), `priceIssues`, runtime `price.ambiguous | price.indeterminate`. C5: `effectiveRule(..., ctx: OfferingContext): EffectiveRule` (+ `issues`; for `general` with channels the any-channel union profile), `availabilityImpact`, and (C5a) `availableSometime(rule)` / `weekProfile(rule)` feeding `FormatReadinessFacts.everAvailable` plus the `availability.schedule*` issue codes on `AvailabilityExplanation.issues`. C2: `Channel`, `ChannelKey`, `active`. C10: the per-project migration state read by `activeRules` and the owner of the ordered plan E-1. **Not** C11: public locales come from the site locale configuration (X-15).

## 6.15 Test fixtures (names are file/case ids)

Engine, `readiness/__tests__/engine.test.ts`. Format `name: input → expected`. `d` = default locale `it`, `siteLocales` = `[it, en]`, `ctx` = website unless stated.

| Fixture | Input | Expected |
|---|---|---|
| R-01 `ready-minimal-service` | profile `service`, name.it, 1 category primary, 1 photo, description, placed, 1 format available with full price | `ready`; all lists empty |
| R-02 `draft-no-profile` | profile null, name.it set | `blocked`; required = [`profileMissing`(advance)] |
| R-03 `name-only-in-en` | name `{en:'Pizza'}`, d=it | required has `nameMissing`, `fix.focus === '[data-name-locale="it"]'`; `translationMissing` not produced for it |
| R-04 `food-not-reviewed` | profile food, declaration `{status:'notReviewed'}` | required has `allergenReview`, `gate:'publish'`, `messageKey:'allergens.notReviewed'`; same in every context kind |
| R-05 `food-none-unconfirmed` | `{status:'noneDeclared'}` (no confirmed) | `allergenReview` with detail `notConfirmed` |
| R-06 `product-with-stale-declaration` | profile product, declaration `{status:'notReviewed'}` | no allergen finding (profile has no foodInformation) |
| R-07 `unreviewed-free-text-extra` | food, reviewed item, attached list has free-text add choice `notReviewed` | required `allergenChoicesReview`, `values` names list · choice; item ready otherwise → `blocked` |
| R-08 `price-missing-available-website` | `offeringContextOf(website)` = `general`; one format with `everAvailable: true`, `priceCoverage:{kind:'none'}` | website: `readyWithWarnings`, recommended has `priceMissing`; **format availability unchanged** (assert input `availability` identical to output context) |
| R-09 `price-missing-unavailable-format` | format `everAvailable: false`, `priceCoverage:'none'` | no price finding in any context |
| R-10 `price-missing-channel` | ctx `channel:delivery` (`offeringContextOf` → channel `delivery`), available, `{kind:'none'}` | `blocked`, required `priceMissing` |
| R-11 `price-partial-coverage` | available, `priceCoverage:{kind:'partial', gaps:[…]}` | recommended `pricePartial` in all contexts; website `readyWithWarnings` |
| R-12 `price-missing-one-of-two-formats` | formats glass(full), bottle(none), both `everAvailable: true` | exactly one `priceMissing`, `target.formatKey === 'bottle'` |
| R-13 `price-missing-print-no-price-column` | ctx `print:classic` with template `showsPrice:false`, `none` | no `priceMissing` (rule `levelIn` → null) |
| R-14 `category-none` | no categories | required `categoryMissing`; `primaryCategoryMissing` NOT also produced |
| R-15 `category-no-primary` | additional=[x], primary null | required `primaryCategoryMissing` only |
| R-16 `dependency-never-published` | option list never published | required `dependenciesPublishable` naming it; Referrer label preserved |
| R-17 `page-address-empty-slug` | hasPage, name `'!!!'` | required `pageAddressInvalid` |
| R-18 `stray-address-de` | hasPage, slug.de set, name.de empty, multi-locale | required `strayAddress`, `values.locale === 'de'`, `fix.tab === 'languages'`; same locale = default → `tab 'content'` |
| R-19 `slug-taken` | conflict with collection "Menu" in `it` | required `pageAddressTaken`, names the other document |
| R-20 `option-list-missing` | attachment → nonexistent list | required `optionListMissing` |
| R-21 `isbn-bad` | book, isbn `123` | recommended `isbnInvalid`, `overridable:false`; `findingToItemIssue` → severity `advice` |
| R-22 `override-valid` | `descriptionMissing` failing + override with same fingerprint, standardVersion 1 | `state:'ready'`, `overridden.length===1`, `staleOverrides` empty |
| R-23 `override-standard-bumped` | same, standard now v2 | `readyWithWarnings`; `staleOverrides.length===1` |
| R-24 `override-finding-changed` | `translationMissing{locale:'de'}` overridden, now missing `fr` | de override stale; fr finding active |
| R-25 `override-resolved` | description now present | override stale (moot) |
| R-26 `override-required-refused` | override targeting `allergenReview` | writer refuses (`invalid_value`); engine ignores such an override if found in data (still `blocked`) |
| R-27 `tenant-raises-price` | tenant rule `{code:'priceMissing', level:'required', scope:{contexts:['website']}}`, price none | website `blocked` |
| R-28 `tenant-cannot-lower` | tenant rule lowering `allergenReview` to recommended | ignored; still required (stricter wins) |
| R-29 `integrity-ref-other-project` | photo ref to doc with other `projectSlug`, families incl. integrity | required `integrity.refOtherProject`; with families `['standard']` → not reported |
| R-30 `client-server-facts-equal` | same document through `itemReadinessInputFromState` and `loadItemFacts` (fake client) | deep-equal inputs |
| R-31 `determinism` | same input twice, shuffled rule array order in a test harness | identical `ReadinessResult` (findings order = registry order) |
| R-33 `handed-over-codes-mapped` | each code in `ChannelIssueCode | FormatIssueCode | PriceIssueCode | AvailabilityIssueCode` | maps to a registry rule via `PRICE_ISSUE_TO_RULE`/table; unmapped ⇒ test fails (X-4), except codes in the explicit `NOT_A_READINESS_CODE` list (`availability.scheduleRedundant`, D-6) |
| R-34 `primary-broken-visible` | `primaryPath {kind:'broken',reason:'missingCategory'}` and `categoryState:'unknown_primary'` | exactly one required `primaryCategoryMissing`, `values.reason:'missingCategory'`, fix = item · category; no `integrity.unknownCategory` |
| R-35 `primary-archived` | `categoryState:'archived_primary'` | recommended `primaryCategoryArchived`; state `readyWithWarnings` |
| R-36 `unknown-additional-key` | additional category key not in tree, families incl. integrity | required `integrity.unknownCategory` (additional only) |
| R-37 `ambiguous-price` | format runtime `price.ambiguous` | required `price.ambiguous` in website; item stays available (assert availability untouched) |
| R-38 `conflicting-rows` | C5 issues `['availability.conflictingRows']` | required `availability.conflictingRows` |
| R-39 `offering-context-of` | all 5 context kinds, with/without channel | table in 6.4a |
| R-41 `schedule-not-a-problem` | format available only every day 18:00–23:00; facts built for 15:00 and for 19:00 (same item) | identical `ReadinessResult`; no finding mentions availability; `availableNow` is not an input |
| R-42 `schedule-overlap-required` | C5a issue `availability.scheduleOverlap` on a format | required `availability.scheduleInvalid`, `values.reason:'availability.scheduleOverlap'`, blocked in website; `scheduleRedundant` → no finding |
| R-43 `price-missing-needs-ever-available` | format with `priceCoverage none`: (a) `everAvailable:true`, (b) `everAvailable:false` | (a) `priceMissing`; (b) none |
| R-44 `override-needs-reason` | `overrideReadiness` with empty `reason`; with an Editor; on a required finding | `invalid_value`; forbidden naming `catalogue.readiness.update`; `invalid_value` |
| R-40 `activation-per-project` | project A migrated (D1 verified), project B not | `categoryMissing` active for A only; B unchanged on the same release |
| R-32 `context-keys` | each context | `contextKey` stable: `website`, `channel:delivery`, `export:csv-full`, `print:classic:delivery:it`, `marketplace:deliveroo@2026-03` |
| C-01 `chip-count-equals-filter` | 200 generated rows incl. overridden/archived | for every chip `countChips(rows)[c] === filterByChip(rows,c).length`; overridden findings do not match |
| C-02 `collection-coverage` | collection of 10 items, 6 with photos, rule `collectionCoverage{photo,70}` recommended | one recommended `collectionCoverage`, values `{have:6,need:7}` |
| B-01 `bulk-partial` | 5 draft rows, 2 blocked | plan: 3 `willPublish`, 2 `blocked` naming codes; `canProceed` true for `publishReady`, false for `allOrNothing` |
| B-02 `bulk-all-or-nothing-race` | preview all ready; one row edited into blocked before commit | server returns `conflict`, nothing published (fake client asserts zero transactions) |
| B-04 `many-together-cap` | `allOrNothing` over 101 documents | `too_large`, names the 100 cap, zero Sanity calls |
| B-05 `many-together-payload` | 60 documents whose estimated payload exceeds the injected limit | `too_large` naming payload; estimate computed before any transaction is built (spy: zero `mutate`) |
| B-06 `many-together-validate-first` | one dependency of the 40th root fails `prepare` | nothing written; refusal lists the finding; no partial documents |
| B-07 `reviewed-batches-not-atomic` | 250 ids in `publishReady` mode | UI result says "published in 3 batches"; the words atomic / all-or-nothing are absent from that copy |
| B-03 `bulk-uses-gate` | spy on `cataloguePublishGate` | called once per row (publishReady) / once per document of the single transaction (allOrNothing) |
| G-01 `gate-legacy-codes` | the seven pre-existing refusal scenarios | same `CatalogueErrorCode` as today (golden table) |
| G-02 `gate-no-second-implementation` | grep test over `src/` | no import of `allergenDeclarationIssues`/`isPublishableDeclaration` outside `readiness/rules`, `allergens.ts`, tests, and Studio schema (which calls the engine) |
| G-04 `every-published-writer-gated` | enumerate callers writing a Catalogue published doc (`createOrReplace`/`create` of non-draft ids) | only `publishTogether` (+ migrations listed in C10); unknown writer fails |
| G-05 `reexpose-safety-subset` | published food copy with `notReviewed` declaration; `backOnline`, restore, `setDates` | each refused with `allergenReview`; a copy missing a primary category, an image or a description is re-exposed fine (D-15: no quality rules, not retroactive) |
| G-06 `reexpose-dangling-ref` | published copy referencing a deleted option list | `backOnline` refused with `integrity.refUnresolved`; the same copy missing a photo → allowed |
| G-03 `adapter-equivalence` | existing `item-issues` fixtures | adapter output deep-equals the pre-refactor output |


---

# C8 — Permissions

## 8.1 Purpose

Define the new Catalogue capabilities (K-5), their defaults under ADR-028, how a multi-document action proves permission for **every** target before writing (AC-16), and what a refusal looks like. Editing includes publishing (K-5, ADR-032 D5/D7): **no `catalogue.*.publish` id is introduced**; single, bulk, scheduled and publish-with-dependencies publish all require the same `*.write` ids as today.

## 8.2 Decision: the minimal set

Naming follows `catalogue.{noun}.{verb}` with the ADR-028 verb vocabulary (`read` see · `write` create+edit · `update` change state of an existing record · `delete` · `manage` configure/administer · `use` invoke a tool); a test enforces the vocabulary, so no new verbs.

```ts
export const CATALOGUE_PERMISSIONS_V2 = [
  // unchanged ids
  { id: 'catalogue.item.read',               defaultRoles: ['owner', 'editor', 'viewer'] },
  { id: 'catalogue.item.write',              defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.item.delete',             defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.item.deletePublished',    defaultRoles: ['owner'] },
  { id: 'catalogue.collection.write',        defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.collection.delete',       defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.collection.deletePublished', defaultRoles: ['owner'] },
  // narrowed (same id, new meaning)
  { id: 'catalogue.taxonomy.write',          defaultRoles: ['owner', 'editor'] },
  // new
  { id: 'catalogue.setup.manage',            defaultRoles: ['owner'] },
  { id: 'catalogue.import.use',              defaultRoles: ['owner'] },
  { id: 'catalogue.export.use',              defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.allergen.update',         defaultRoles: ['owner', 'editor'] },
  { id: 'catalogue.readiness.update',        defaultRoles: ['owner'] },
] as const
```

`'owner'` in `defaultRoles` means **Owner and Site admin** (`moduleRoleFor`); `'editor'` means Editor. Viewer (retired) keeps only `catalogue.item.read`. Net: **5 new ids** (`setup.manage`, `import.use`, `export.use`, `allergen.update`, `readiness.update`), 1 narrowed.

| id | Label (en, Title Case) | Covers | Why this default |
|---|---|---|---|
| `catalogue.setup.manage` | Manage Catalogue Setup | Starter packs (apply, update); service channels (activate/deactivate, labels, **default availability** — the C2 `Channel.defaultAvailability`; there is no separate "default for new items", REVIEW C-4/D-5); **category structure** (move/re-parent, delete, reassign) and **category availability rules**; item profile defaults and item defaults (including the **`dietaryTags` dietary-declaration vocabulary**, which is not a tag set — REVIEW X-10); format templates; pricing/availability project defaults; currency (D7 flow); **publication standards**; public website settings (public name, public segment, affiliate disclosure); Catalogue Setup pages in general | K-5: "Setup, starters and standards default to owner/admin-equivalent". One id for all of it: a second id for "standards" or "channels" could not be granted separately today anyway (module permissions are not grantable extras — I-2), so splitting adds ids that nothing can use. |
| `catalogue.taxonomy.write` | Manage Categories And Tags | *(Decided — Tom 2026-11-02, D-3.)* **Create inline, rename/translate, reorder siblings, delete an unused leaf, manage tags.** New categories are created with `inherit` rules, under a parent the user chooses, with the complete category path shown. It does **not** cover moving a category between parents, reassigning on delete, deleting a category in use, channel/category availability rules (including schedules) or applying packs — those change availability or structure for many items and are `catalogue.setup.manage` (8.3 has the exact split and the precise definition of "unused") | Keeps the `taxonomyWritePermission(module)` id convention (`src/lib/taxonomy/permissions.ts`, also used by `surfaces.ts`) and today's editor behaviour (inline "+ Add category" in the item editor, brief 8.1). Enforced by `CatalogueTaxonomyService` (8.3). See I-1 for the deviation from K-5's wording. |
| `catalogue.import.use` | Import Catalogue Data | Starting, confirming and undoing an import batch. Also requires `catalogue.item.write` (it writes drafts) and, where the import creates categories/tags, `catalogue.taxonomy.write`; it **never** creates channels, packs or standards (those need `setup.manage` and are proposals only) | Bulk blast radius; undoable but heavy. Owner/Site admin by default. A tenant that wants editors to import changes the default in the manifest; no schema impact. |
| `catalogue.export.use` | Export Catalogue Data | Data exports (CSV/XLSX), PDF menu generation, allergen register export. Also requires `catalogue.item.read`. Recording a snapshot is part of the action | Reads data out, creates a snapshot record (so it is a "use", not a "read"). Editors need it for printed menus. **Export is unavailable in support mode** (*Decided — Tom 2026-11-02, D-21*): `catalogue.export.use` is added to `SUPPORT_NEVER_WRITES` beside `catalogue.allergen.update`, so it is refused in both support view and approved-edit sessions (support views client data, never takes it out). |
| `catalogue.allergen.update` | Review Allergens | Setting a food item's (or free-text choice's) declaration to a **reviewed** state: reviewer identity, basis, timestamp are recorded. Changing the declaration **content** also requires `catalogue.item.write`. *(Decided — Tom 2026-11-02, D-16.)* Held by **Owner, Site admin and Editor**; **never available in support mode** | Decision below. |
| `catalogue.readiness.update` | Override Readiness Warnings | Silencing a recommended finding on an item (6.9); revoking an override | An override silences the owner's own publication standard; *Decided — Tom 2026-11-02, D-17:* only Owner and Site admin (not Editor); every override records who, when and why. |

### Is allergen review separate from `catalogue.item.write`?

*Decided — Tom 2026-11-02, D-16.* **Yes, a separate id, `catalogue.allergen.update`, defaulted to Owner + Site admin + Editor (no change in who can do it today), and never available in support mode.** Reasons:

1. The review is an **attestation** (reviewer, basis, date — brief 20.2). It is a different act from editing a description, and a tenant (kitchen vs website editor) may later want them held by different people. A separate id is the only way to express that without a role redesign.
2. 20.3 "Abluo enforces the process; the food-business operator remains responsible": an Abluo support person acting in an approved support-edit session must **not** be able to attest allergens for the client. `catalogue.allergen.update` is added to `SUPPORT_NEVER_WRITES` (like people/modules/billing) so support-mode writes can never review allergens, in view or approved-edit sessions (I-3). `catalogue.export.use` joins it (D-21).
3. Reset semantics already separate the two: editing relevant data resets the review (20.2), so a website editor who only has `item.write` can save a food item but cannot make it publishable.

**Limit, stated plainly (I-2):** ADR-028 §3 says extras only *add* and only *platform* grantable permissions can be extras. Module permissions cannot be granted individually. So today "kitchen reviews, website editor cannot" is **not achievable** with ADR-028 as written — a default of `['owner','editor']` means every Editor can review. Splitting the id is still correct and costs nothing; making it useful needs an ADR-028 amendment (module permissions as grantable extras, or custom roles). Not part of this redesign.

## 8.3 What replaces `catalogue.taxonomy.write`

**Nothing replaces it; it is narrowed (and its manifest label/description change), and `catalogue.setup.manage` is added beside it.** Consequences:

- Registry entry: label `Manage Categories And Tags`; description "Create, rename, translate and delete unused categories and tags." Today's label "Manage categories, dietary tags and service channels" is wrong after K-4: **service channels leave this permission** (they were in its label because they lived in module config).
- Consumers to update: `src/lib/client/surfaces.ts` (anyPermission list: add `catalogue.setup.manage` to the Catalogue Setup surface; keep taxonomy.write for the Categories & Tags area only as long as the Catalogue tab exists — K-4 removes it, so remove `catalogue.taxonomy.write` from that platform surface), `ItemEditor`/`ItemWizard` `canAddCategory` (still `catalogue.taxonomy.write`), `src/lib/modules/__tests__/permissions.test.ts` (count/ids).
- **`dietaryTags` is not a tag set** (REVIEW X-10): it is the controlled dietary-declaration vocabulary feeding `item.dietary` (brief §9: tags must not duplicate controlled dietary declarations). It stays in module config, is edited in Setup → Item defaults, and requires `catalogue.setup.manage`. C1 declares it out of scope.
- **Where the term-operation check lives (REVIEW X-8):** in the Catalogue-owned `CatalogueTaxonomyService` (C1), not in the generic taxonomy service — the generic service refuses `module: 'catalogue'` (`kind_not_declared`). The service calls this contract's `capabilitiesFor({ op: 'term.*' })`: `setup.manage` for `reparent | reassign | deleteInUse | setAvailabilityRule`, `taxonomy.write` otherwise (exact split below). Inline creation in the item editor is a call into the same service (one writer), so K-4's test "no other surface writes Catalogue terms" holds with that single named exception.

### Term operations: the exact split (D-3)

*Decided — Tom 2026-11-02, D-3.*

| Permission | Operations |
|---|---|
| `catalogue.taxonomy.write` | create inline (`term.create`); rename and translate (`term.rename`, `term.translate`); reorder siblings (`term.reorder`); delete an **unused leaf** (`term.deleteUnusedLeaf`); manage tags (every tag operation: tags carry no availability and no structure) |
| `catalogue.setup.manage` | move between parents (`term.reparent`); reassign on delete (`term.reassign`); delete in use (`term.deleteInUse`); channel rules **including schedules** (`term.setAvailabilityRule` for categories, `setup.channels` for channel defaults and schedules, C5a); apply packs (`setup.applyPack`); archive/unarchive a **category** (`term.archive`; tag archive stays with `taxonomy.write`) |

**"Unused" (precise, verbatim from D-3).** A category is unused only when it has no assigned items **including drafts**, no child categories, no automatic-listing references, no publication-standard or availability-policy references outside the category itself, and no other stored Catalogue reference that would become broken by deletion. An editor may delete only a genuinely unreferenced **leaf** category; otherwise deletion requires the Setup permission and a counted, previewed reassignment or cleanup operation.

The predicate is **C1's**, not defined here: `deletionRoute(deletionBlockers(tree, key, refs))` gives `capability: 'taxonomy.write'` ⇔ op `term.deleteUnusedLeaf`, and `'setup.manage'` ⇔ op `term.deleteInUse`. `capabilitiesFor` maps the op; C8 defines no usage type (K-9, one implementation per concept). The dashboard enables or disables the delete control from the same C1 result.

- The service evaluates C1's `deletionBlockers` and picks the operation; the capability is derived from the operation, not from the client's claim. **The usage is re-read inside the revision-guarded write**: an editor who passed the check and then races an assignment gets a refusal naming `catalogue.setup.manage`, not a deletion.
- `deleteInUse` / `reassign` run only as a **counted, previewed** operation (counts of items, drafts, rules and references affected, shown before confirm; audited as `category.restructured`, C12).
- **Inline creation is not a second implementation.** The item editor's "+ Add category" calls the **same Catalogue taxonomy service as Setup** (`CatalogueTaxonomyService.create`). When creating inline the user can still choose the parent and sees the complete category path. K-4 and ADR-042 N2a are amended accordingly (see 8.3a and the Issues record).
- Item-level availability (`item.setAvailabilityOverride`, including an item's own schedule) stays `item.write`: it changes one item, not a structure.

### 8.3a Setup sub-destinations and permissions (REVIEW X-9, C-4)

ADR-042 N2a says Setup is visible only with the Setup permission; K-4 says categories/tags are edited only in Setup; Editors hold `taxonomy.write`. To give those rights a surface without a second editor:

```ts
export const SETUP_SECTIONS = [
  { id: 'overview',          anyPermission: ['catalogue.setup.manage'] },
  { id: 'starterStructures', anyPermission: ['catalogue.setup.manage'] },
  { id: 'categories',        anyPermission: ['catalogue.setup.manage', 'catalogue.taxonomy.write'] },   // editors: create/rename/reorder/delete-unused only; structure + rules controls hidden/disabled with the reason
  { id: 'tags',              anyPermission: ['catalogue.setup.manage', 'catalogue.taxonomy.write'] },
  { id: 'serviceChannels',   anyPermission: ['catalogue.setup.manage'] },
  { id: 'pricingAvailability', anyPermission: ['catalogue.setup.manage'] },
  { id: 'itemDefaults',      anyPermission: ['catalogue.setup.manage'] },                              // incl. dietaryTags
  { id: 'publicationStandards', anyPermission: ['catalogue.setup.manage'] },
  { id: 'publicWebsite',     anyPermission: ['catalogue.setup.manage'] },
  { id: 'importExport',      anyPermission: ['catalogue.setup.manage'] },   // import configuration, mappings, history. Editors export from the Items list actions ("Export", "Print menu") and the item editor, not from Setup (ADR-042 N2a: other sections stay Setup-only)
] as const
```

The Setup entry in the sidebar is shown when **any** section is visible (`anyPermission` over the union), each section by its own list. **ADR-042 N2a needs the matching amendment** ("Setup is shown to people holding any Setup sub-destination permission; each sub-destination by its own"), and **K-4 is amended** to allow the single named exception (inline creation through the same service). *Decided — Tom 2026-11-02, D-3:* **Setup → Categories & Tags is visible with either permission** (`catalogue.setup.manage` or `catalogue.taxonomy.write`); an editor sees the structure and rule controls disabled with the reason.

## 8.4 Capability map for every Catalogue write (single source)

```ts
// src/lib/modules/catalogue/capabilities.ts  (pure, browser-safe)

export type CatalogueCapability =
  | 'catalogue.item.read' | 'catalogue.item.write' | 'catalogue.item.delete' | 'catalogue.item.deletePublished'
  | 'catalogue.collection.write' | 'catalogue.collection.delete' | 'catalogue.collection.deletePublished'
  | 'catalogue.taxonomy.write' | 'catalogue.setup.manage' | 'catalogue.import.use' | 'catalogue.export.use'
  | 'catalogue.allergen.update' | 'catalogue.readiness.update'

export type CatalogueOperation =
  | { op: 'item.create' | 'item.edit' | 'item.publish' | 'item.unpublish' | 'item.archive' | 'item.restore' | 'item.setSchedule' }
  | { op: 'item.delete'; published: boolean }
  | { op: 'item.reviewAllergens' }                      // status → reviewed
  | { op: 'item.editAllergenContent' }                  // changes declaration content — IS a review (C13): needs allergen.update
  | { op: 'item.overrideReadiness' }
  | { op: 'item.assignCategories'; createsCategory: boolean }
  | { op: 'item.setAvailabilityOverride' | 'item.setPrice' | 'item.attachOption' }
  | { op: 'collection.edit' | 'collection.publish' | 'collection.place'; }   // placing an item in a collection edits the COLLECTION
  | { op: 'collection.delete'; published: boolean }
  | { op: 'optionList.edit' | 'optionList.publish' | 'optionList.delete' }
  | { op: 'term.create' | 'term.rename' | 'term.translate' | 'term.reorder' | 'term.deleteUnusedLeaf' }   // taxonomy.write (D-3)
  | { op: 'term.archive' | 'term.unarchive'; kind: 'category' | 'tag' }                                       // category → setup.manage, tag → taxonomy.write (C-21)
  | { op: 'term.reparent' | 'term.reassign' | 'term.deleteInUse' | 'term.setAvailabilityRule' }            // setup.manage (D-3)
  | { op: 'term.setUseFor'; kind: 'category' | 'tag' }                                                        // D-22 (C1.12.7): category → setup.manage, tag → taxonomy.write
  | { op: 'optionList.setUseFor' }                                                                              // D-22: item.write + setup.manage
  | { op: 'setup.applyPack' | 'setup.channels' | 'setup.standards' | 'setup.publicWebsite' | 'setup.defaults' | 'setup.currency' }
  | { op: 'import.start' | 'import.confirm' | 'import.undo'; createsTerms: boolean }
  | { op: 'export.data' | 'export.pdf' | 'export.allergenRegister' }

/** PURE. The full set of capabilities this operation needs, all of which must hold. Deterministic and tested exhaustively. */
export function capabilitiesFor(op: CatalogueOperation): readonly CatalogueCapability[]

/** PURE. Union over a plan of operations, deduplicated, stable order. */
export function capabilitiesForPlan(ops: readonly CatalogueOperation[]): readonly CatalogueCapability[]
```

Selected rows (normative; the function is the table):

| Operation | Capabilities (all required) |
|---|---|
| item.create / edit / publish / unpublish / archive / restore / setSchedule | `item.write` (publishing included) |
| item.delete (never published) / (published) | `item.write`+`item.delete` / + `item.deletePublished` (existing `catalogueAbilities` logic) |
| item.reviewAllergens | `item.write` + `allergen.update` |
| item.editAllergenContent | `item.write` + `allergen.update` — declaration content cannot change without the review block being written in the same call (C13); a person with only `item.write` can save the rest of a food item but not its declaration |
| item.overrideReadiness | `item.write` + `readiness.update` |
| item.assignCategories | `item.write` (+ `taxonomy.write` if it creates a category inline) |
| collection.place (add/move item in a collection section) | `collection.write` — and **`item.read`** for every referenced item; it does not need `item.write` because the item document is unchanged (placement lives in the collection, brief 10) |
| bulk publish / archive / restore of items | `item.write` per op (no separate bulk capability — K-5) |
| bulk category/primary assignment, channel override, price update, option attachment | `item.write` |
| term.create / rename / translate / reorder / deleteUnusedLeaf (and all tag operations) | `taxonomy.write` |
| term.reparent / reassign / deleteInUse / setAvailabilityRule (state and schedules) / archive+unarchive of a category | `setup.manage` (tag archive: `taxonomy.write`) |
| setup.* (channels and their schedules, packs, standards, defaults, currency, public website) | `setup.manage` |
| import.start / confirm / undo | `import.use` + `item.write` (+ `taxonomy.write` iff `createsTerms`) |
| export.* | `export.use` + `item.read` |

## 8.5 Multi-document actions: check every target before writing (AC-16)

Today permissions are **per project and per kind**, not per document, so "every affected document" means: (a) every distinct *operation* in the plan is authorised, (b) every target document belongs to this project and the expected kind, (c) nothing is written until both hold for **all** targets.

```ts
// src/lib/api/catalogue-batch-guard.ts   (server)

export type TargetRef = { kind: CatalogueKind | 'term'; id: string }

export type BatchPlan = {
  ops: CatalogueOperation[]                 // the DISTINCT operations the action performs, one per (op, kind)
  targets: TargetRef[]                      // every document the action will read-for-write
}

export type PreparedBatch = { projectSlug: string; targets: Array<{ ref: TargetRef; rev: string }> }

/**
 * Throws CatalogueForbidden / CatalogueError('not_found') BEFORE any write.
 *   1. assertModuleAction(ctx, projectId, cap) for EVERY cap in capabilitiesForPlan(plan.ops)   — first, before any I/O (as today)
 *   2. re-read all targets with readPair (project + kind ownership, as today); any foreign/missing id → not_found
 *      for the WHOLE batch, naming nothing (no probing which id was wrong)
 *   3. assertSingleSanityProject once
 * Returns the revs for the revision guards; the caller then writes (one transaction where the primitive allows it).
 */
export async function prepareBatch(ctx: TenantAuthorizationContext, projectId: string, plan: BatchPlan, deps: CatalogueDeps): Promise<PreparedBatch>
```

Rules:

- Capability check **precedes** target reads (a viewer learns nothing about which ids exist).
- A batch is **all-checked-then-all-written**. Where the write primitive is not atomic (many separate `patchCatalogueDraft` calls), the batch is *re-checked per row at write time* too (cheap; permission cannot change mid-request but revisions can) and a row that fails reports `conflict` without stopping the others, **after** the pre-check has proven nothing is forbidden. A forbidden target never leads to a partial write: the pre-check fails the whole request first.
- Cross-kind actions (e.g. import that creates items + terms; bulk "move to collection") declare **all** kinds in `plan.ops`; an editor without `taxonomy.write` importing a file that would create categories gets the whole import refused at preview, with the offending operation named by capability only.
- Support-mode: `supportRefuses` still applies to every cap (all new write ids are non-`.read`, hence refused without a live approval; `allergen.update` never).

## 8.6 Refusal shape (names the capability, leaks nothing)

```ts
export type CatalogueRefusal = {
  ok: false
  error: 'forbidden'
  /** The FIRST missing capability, by stable id. The UI maps it to its translated label (`catalogue.capabilities.<id>`); the message never includes role, project slug, user id, document ids/titles or counts. */
  capability: CatalogueCapability
}
```

- Produced by `catalogueRefusal(error)`: catches `TenantAuthorizationError`, extracts the capability **structurally** (the guard throws `CatalogueForbidden(capability)`, a subclass carrying the id) — it must not parse the free-text `assertModuleAction` message, which includes role and project slug.
- The existing server-action pattern (`error instanceof TenantAuthorizationError → { ok:false, error:'forbidden' }` in `catalogue/actions.ts`) is extended with `capability`.
- Previews that include rows the person cannot act on return plan rows with `outcome: 'skipped', reason: 'notPermitted'` **without ids of rows the caller could not read**; since read is per project, rows are always readable, so this only applies to capability gaps and is stated once for the whole plan, not per row.
- Missing module (module not installed) still yields the existing generic `forbidden` without `capability` (step-4 rule: never reveal whether the permission would have been held).

## 8.7 Default roles table (ADR-028 effective)

| Capability | Super Admin (platform) | Owner | Site admin | Editor | Viewer (retired) | Support (approved edit) | Support (view) |
|---|---|---|---|---|---|---|---|
| item.read | via support/membership only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| item.write / collection.write | – | ✓ | ✓ | ✓ | – | ✓ (with approval) | – |
| item.delete / collection.delete | – | ✓ | ✓ | ✓ | – | ✓ (with approval) | – |
| *.deletePublished | – | ✓ | ✓ | – | – | ✓ (with approval) | – |
| taxonomy.write | – | ✓ | ✓ | ✓ | – | ✓ (with approval) | – |
| setup.manage | – | ✓ | ✓ | – | – | ✓ (with approval) | – |
| import.use | – | ✓ | ✓ | – | – | ✓ (with approval) | – |
| export.use | – | ✓ | ✓ | ✓ | – | **never** (SUPPORT_NEVER_WRITES, D-21) | – |
| allergen.update | – | ✓ | ✓ | ✓ | – | **never** (SUPPORT_NEVER_WRITES) | – |
| readiness.update | – | ✓ | ✓ | – | – | ✓ (with approval) | – |

Super Admin has no implicit tenant permission (ADR-028 §2). The Studio break-glass path (C9) does **not** use these ids; it uses its own server-side operator context (9.5). *Allergen separation and the support-mode rule: Decided — Tom 2026-11-02, D-16. Export unavailable in support mode: Decided, D-21.*

## 8.8 Migration from today

1. Add the five ids to the Catalogue manifest (`registry.ts` ~line 1180); `MODULE_PERMISSION_MAP` derives them. Roles are resolved per request from the registry, so **no data migration**: existing Owners/Site admins/Editors gain exactly the table above on deploy (Editors lose nothing: they keep `taxonomy.write`, gain `export.use` and `allergen.update`, which were implicit in `item.write` before).
2. Narrow `catalogue.taxonomy.write` description/label; move `serviceChannels` management to `setup.manage` (service lands with C2).
3. Until C1/C2 ship, nothing calls `setup.manage`; the id exists for the Setup shell (slice 1).
4. Add `catalogue.allergen.update` **and `catalogue.export.use`** to `SUPPORT_NEVER_WRITES` (`src/lib/support/state.ts`).
5. No change to `assertModuleAction`; add `CatalogueForbidden` and `capabilitiesFor`.
6. Tests that count permissions (`permissions.test.ts`) updated in the same commit.

## 8.9 Test fixtures

| Fixture | Input → expected |
|---|---|
| P-01 `ids-follow-convention` | every id in `CATALOGUE_PERMISSIONS_V2` matches `^catalogue\.[a-z]+\.(read|write|update|delete|deletePublished|manage|use)$`; the existing vocabulary test passes (`deletePublished` is the pre-existing exception) |
| P-02 `no-publish-id` | no permission id contains `publish` except `deletePublished` |
| P-03 `role-resolution` | `resolveProjectPermissions` for role admin/editor/owner with catalogue enabled → table 8.7 (exact sets) |
| P-04 `editor-cannot-setup` | editor ctx, `prepareBatch({ops:[{op:'setup.channels'}]})` → throws `CatalogueForbidden('catalogue.setup.manage')`, **zero** Sanity calls (fake client call count 0) |
| P-05 `batch-all-or-none` | owner bulk op with 3 targets, one id from another project → `not_found` for the batch, zero writes, error text contains none of the three ids |
| P-06 `import-needs-three` | editor with `import.use` injected but no `taxonomy.write`, file creates a category → refused naming `catalogue.taxonomy.write` at preview |
| P-07 `refusal-no-leak` | forbidden refusal JSON-serialised contains no role name, project slug, uuid, document title |
| P-08 `capability-from-structure` | `catalogueRefusal(new TenantAuthorizationError('…role "editor" … project "tmz"…'))` (plain) → `{error:'forbidden'}` with **no** capability field (never parsed from text) |
| P-09 `support-never-allergen` | support ctx with `writesAllowed:true`, `assertModuleAction(…,'catalogue.allergen.update')` → throws; `catalogue.item.write` passes |
| P-18 `support-never-export` | support ctx with `writesAllowed:true` and in view mode: `assertModuleAction(…,'catalogue.export.use')` → throws in both; owner/editor ctx passes |
| P-19 `unused-leaf-precise` | C1 `CategoryReferences` fixtures (reuse C1 `delete/*`); category cases: (a) leaf, 0 items → `deleteUnusedLeaf`; (b) leaf with 1 **draft** item; (c) leaf referenced by a publication standard scope; (d) leaf referenced by an automatic listing; (e) leaf with an availability-policy reference; (f) category with a child | (a) editor allowed; (b)–(f) `deletionRoute` = `setup.manage` (`term.deleteInUse`), editor refused naming `catalogue.setup.manage`, setup.manage gets a counted preview |
| P-20 `delete-race` | editor deletes a leaf that read as unused, an item is assigned before the guarded write | refusal naming `setup.manage`; nothing deleted |
| P-21 `inline-create-same-service` | static + runtime: `ItemEditor`/`ItemWizard` "+ Add category" and Setup both call `CatalogueTaxonomyService.create`; inline create with a chosen parent returns the full path; there is no second writer (grep test) |
| P-22 `channel-schedule-needs-setup` | editor sets a channel or category schedule (C5a) → refused naming `setup.manage`; editor sets an item's own schedule → allowed (`item.write`) |
| P-23 `categories-tags-either-permission` | `setup.manage` only; `taxonomy.write` only; neither → Categories & Tags section visible, visible, hidden |
| P-10 `placement-needs-collection-write` | `capabilitiesFor({op:'collection.place'})` = [`collection.write`, `item.read`] |
| P-11 `capabilities-exhaustive` | every `CatalogueOperation['op']` appears in a table test; adding an op without a mapping fails the type-level exhaustive switch |
| P-15 `setup-section-visibility` | editor (taxonomy.write only) → visible sections = `categories`, `tags` only; owner → all; viewer → none; sidebar Setup shown iff ≥1 section visible |
| P-16 `generic-service-refuses-catalogue` | generic taxonomy service with `module:'catalogue'` → `kind_not_declared`; `CatalogueTaxonomyService.reparent` as editor → forbidden naming `setup.manage` |
| P-17 `dietary-tags-need-setup` | editor edits `dietaryTags` → refused naming `setup.manage` |
| P-12 `taxonomy-split` | by an editor: `term.reparent`, `term.reassign`, `term.deleteInUse`, `term.setAvailabilityRule` → refused naming `setup.manage`; `term.create`, `term.rename`, `term.translate`, `term.reorder`, `term.deleteUnusedLeaf`, any tag op (incl. tag archive) → allowed; `term.archive`/`term.unarchive` of a category → refused naming `setup.manage` |
| P-13 `viewer-read-only` | legacy viewer has `item.read` only; every other cap refused |
| P-14 `bulk-publish-needs-write-only` | owner/editor bulk publish plan → `capabilitiesForPlan` = [`item.write`] (K-5) |


---

# C9 — Studio posture

## 9.1 Purpose

K-7: the dashboard is the editor; Catalogue documents are **read-only in Studio by default**; any Studio write path is break-glass: explicit, super-admin-only, logged, visibly marked, and it must use or enforce the critical shared rules. No undocumented bypass of the server publication gate, and a test that fails if one appears.

## 9.2 What exists today (so this contract only adds)

- Studio = Sanity v5 (`sanity@^5.31`), embedded at `/studio`, structure built in `sanity.config.ts` from `MODULE_REGISTRY`; document types come from `catalogueSchemaTypes` (`catalogueItem`, `catalogueCollection`, `catalogueOptionList`, `cataloguePage` are `document`; the rest are objects).
- `document.actions` in `sanity.config.ts` is a chain of `if (context.schemaType === …)`; Catalogue types fall through to `return prev` (built-in Publish, Unpublish, Delete, Duplicate, Restore all available). D14's lifecycle guardrails are **not** implemented for them.
- Studio validations in `catalogue/schema.ts` that touch food safety or integrity: `allergenDeclaration` (item), option `allergenDeclaration` (error shape / warning incomplete), `catalogueItem.optionLists` (async GROQ: unreviewed free-text choices), `catalogueOptionList.options` (async GROQ: food users), `slugsWithoutName`, offer `price` required/precision, HH:mm regex, window overlap `catalogueOffer` validation.
- Catalogue module **configuration** lives inside `project.moduleInstallations[]` (the `project` document), edited through the custom Modules pane (`ModuleList.tsx` + `module-save.ts`, key-level patches with `ifRevisionId`), and by the dashboard (affiliate disclosure, public settings). Catalogue **terms** are `taxonomyTerm` documents (`module == 'catalogue'`).
- Studio is gated by the admin host (`admin.abluo.app/studio`, Supabase `abluo_admin`) and by Sanity project membership. The platform cannot restrict Studio by Sanity role on the Growth plan (ADR-032 D14: "the security boundary remains Sanity membership").

## 9.3 Mechanism (four layers, all new code under `src/lib/sanity/studio/`)

```ts
// catalogue-posture.ts  — PURE (no React, no Sanity imports); imported by sanity.config.ts, the schema, and tests

/** Every Catalogue DOCUMENT type. A test ties this to the registry (9.8, T-3). */
export const CATALOGUE_STUDIO_TYPES = [
  'catalogueItem', 'catalogueCollection', 'catalogueOptionList', 'cataloguePage',          // today
  'catalogueTaxonomy',                 // C1  (catalogue-taxonomy.<slug>)
  'cataloguePackHistory',              // C7  (catalogue-packs.<slug>)
  'cataloguePublicationStandards',     // C6  (catalogue-standards.<slug>, X-7)
  'cataloguePackRun',                  // C7  in-progress marker for interrupted pack application (name per C7)
] as const
// Any further Catalogue document type is added here in the SAME commit that defines it — test T-3 fails until then (REVIEW X-16).

/**
 * Documents of a shared type that belong to Catalogue, with the release at which their lock starts (REVIEW C-18):
 *   'R1' = locked from the gate/posture release (documents the dashboard already edits);
 *   'R2' = locked only when Setup and the Catalogue terms/config editors exist (K-9 step 4) — locking earlier would remove the only editor.
 */
export const CATALOGUE_STUDIO_SCOPED: ReadonlyArray<{ type: string; lockFrom: 'R1' | 'R2'; owns: (doc: Record<string, unknown>) => boolean }> =
  [{ type: 'taxonomyTerm', lockFrom: 'R2', owns: (d) => d.module === 'catalogue' }]
/** Bumped from 'R1' to 'R2' by the R2 release (C10 plan E-1). `catalogueReadOnly` applies a scoped entry only when CATALOGUE_LOCK_PHASE >= lockFrom. */
export const CATALOGUE_LOCK_PHASE: 'R1' | 'R2' = 'R1'

export type BreakGlassGrant = { id: string; projectSlug: string; expiresAt: string; reason?: never /* reason is never sent to Studio */ ; enabledBy: 'abluo-admin' }
export type PostureState = { grants: readonly BreakGlassGrant[]; loaded: boolean }   // loaded=false (fetch failed / not yet) ⇒ FAIL CLOSED

export function isCatalogueStudioDoc(type: string, doc?: Record<string, unknown> | null): boolean

/** true = read-only. Read-only unless (state.loaded && an unexpired grant exists for the document's projectSlug). */
export function catalogueReadOnly(args: { type: string; doc: Record<string, unknown> | null | undefined; state: PostureState; now: Date }): boolean

/** document.actions for a Catalogue doc. Posture off → []. Posture on → [catalogueGatePublishAction, discard] and NOTHING else (no built-in publish/unpublish/delete/duplicate/restore). */
export function catalogueDocumentActions<A extends { action?: string }>(prev: A[], args: { type: string; doc: Record<string, unknown> | null | undefined; state: PostureState; now: Date; gate: A }): A[]

/** Catalogue templates are removed from the "+ New" menu always (documents are created by the dashboard, never in Studio, even in break-glass). */
export const CATALOGUE_TEMPLATE_IDS: readonly string[]   // 'catalogueItemProjectOwned', 'catalogueCollectionProjectOwned', 'catalogueOptionListProjectOwned', … (C1–C3 add theirs)
```

Layers:

1. **Schema `readOnly` (the field-level lock).** `withCataloguePosture(type)` wraps each document type in `catalogueSchemaTypes` (and the `taxonomyTerm` type) adding `readOnly: ({ document }) => catalogueReadOnly({ type, doc: document, state: postureStore.get(), now: new Date() })`. A document-level `readOnly` makes the whole form read-only (Sanity v5 document-type `readOnly` accepts a callback with `document`). `readinessOverrides`, `publicId`, `projectSlug`, lifecycle fields stay `readOnly: true` unconditionally, break-glass included.
2. **`document.actions` (the write lock).** In `sanity.config.ts`, a first branch before all others:
   ```ts
   if (isCatalogueStudioDoc(context.schemaType, /* doc not available here */ undefined)) {
     return catalogueDocumentActions(prev, { type: context.schemaType, doc: undefined, state: postureStore.get(), now: new Date(), gate: CatalogueGatePublishAction })
   }
   ```
   (`document.actions` receives `context` without the document; posture there is "any unexpired grant", and the route re-checks the specific project at publish — the action is only a door, the server is the lock.) Built-in `publish`, `unpublish`, `delete`, `duplicate`, `restore`, `schedule` are **absent** in both states. Replacing them is what makes the gate unavoidable *from the Studio UI*.
3. **`document.newDocumentOptions`.** Append the Catalogue template ids to the existing filter list in `sanity.config.ts`.
4. **Posture loader (`CataloguePostureLayout`).** A Studio layout component (`studio.components.layout`) that (a) fetches `GET /api/admin/studio/break-glass` (same origin, Supabase cookie, `abluo_admin` + aal2) every 30 s, on focus and at the earliest `expiresAt`, writes the result to `postureStore`; (b) **fails closed**: a non-200 or network error sets `loaded:false` ⇒ everything read-only, including a Studio instance served somewhere the endpoint is not reachable (a hosted `sanity.studio` copy is therefore always read-only); (c) renders the banner (9.6).

Structure: unchanged (items stay listable and openable for inspection and diagnosis). Vision (GROQ) remains available for read.

The **Modules pane** for `catalogue`: `ModuleList` receives `readOnlyModules = modulesWithDashboardConfig(MODULE_REGISTRY)` (derived from a new manifest flag `configSurface: 'dashboard'` on Catalogue — one flag, not a hard-coded id); for those modules the config section renders values read-only with the sentence "Configured in the Abluo dashboard → Catalogue → Setup", and `buildInstallationPatch` is never reached. Status (enabled) toggling stays (installation is a platform-owner act, ADR-020).

**The `project` document gap:** because the config sits in `project.moduleInstallations[]`, a read-only pane is not enough — the generic `project` document form can edit the array. The `moduleInstallations[]` member type gets `readOnly: ({ parent }) => configSurfaceIsDashboard(parent?.moduleId)` for the `config` object only. **This config lock (and the Modules-pane read-only state) ships in R2 together with Setup, not in the R1 posture release** (REVIEW C-18/X-13e): locking earlier would remove the only editor of `publicSegment`, `currency` and `serviceChannels`. It applies to the scalar settings that stay in module config (REVIEW X-7: `currency`, `publicSegment(+History)`, `publicName`, `defaultItemProfile`, `serviceChannels[]` (incl. `defaultSchedule`), `formatTemplates[]`, `catalogueMigrations`, `dietaryTags[]`, `setupCompletedAt`, `setupSource`). Break-glass does **not** unlock this: configuration changes in an emergency go through a server-side setup service call run by the operator (documented runbook), not through Studio typing. (I-5, rewritten in Rev 2: the earlier request to move `serviceChannels`/`categories`/`dietaryTags`/`navLabel` out of the array is **withdrawn**.)

## 9.4 The break-glass switch

| Question | Decision |
|---|---|
| Who | An Abluo Super Admin (`platform_role = 'abluo_admin'`) with an **aal2** session. Not a client user. Not Support mode (ADR-028 §8: "no emergency override in support mode"). |
| How enabled | In the admin project page: "Catalogue Studio access (break-glass)". Form: **reason** (required, ≥ 10 characters), **duration** (15 min · 60 min default · 4 h max). `POST /api/admin/studio/break-glass { projectId, reason, minutes }`. One active grant per project. Renewal = a new grant with a new reason. |
| Scope | One project (matched on the document's `projectSlug`). Catalogue document types only (9.3). Never `project`, `siteConfig`, design systems. |
| Stored | Supabase `studio_break_glass` (below). Server-only (service role), RLS on, no grants to anon/authenticated. |
| Time limit | Mandatory `expires_at` (≤ 4 h). The Studio store evaluates `now < expiresAt` on every read-only callback, and the server re-checks at publish. No cron needed; expiry cannot be forgotten. Ending early: `DELETE …/break-glass/:id` sets `ended_at`. |
| Logged | On enable/expire/end/publish: `admin_audit_log` (new actions `studio.catalogue_break_glass.start|end|publish`, `detail`: projectId, grantId, minutes — **never the reason text in client-visible rows**) and `catalogue_audit_log` (C12 `studio.break_glass_enabled` / `_ended` / `_publish`, client-visible: "The Abluo team maintained Catalogue data"). |
| Visibly marked | (a) Studio: full-width banner "Catalogue break-glass is ON for <project> until HH:mm — edits are recorded and publishing goes through the Abluo publication gate" (existing attention colour; no new colour, per Tom's rule); a document badge "Break-glass" on every Catalogue doc while active. (b) Client dashboard: a notice on Catalogue Overview while a grant is active ("Abluo is maintaining your Catalogue until 15:40 — avoid editing the same items"). (c) The audit rows. |
| Fails closed | Any posture-load failure ⇒ read-only. |

```sql
-- migration: studio_break_glass — number reserved SECOND (after M0 catalogue_audit_log), both after the billing series (REVIEW E-15); order in the C10 plan E-1
create table public.studio_break_glass (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  enabled_by   uuid not null references auth.users (id) on delete restrict,
  reason       text not null check (char_length(reason) between 10 and 500),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '4 hours'),
  ended_at     timestamptz check (ended_at is null or ended_at >= created_at)
);
create unique index studio_break_glass_one_active on public.studio_break_glass (project_id) where ended_at is null;  -- expiry handled in queries (expires_at > now()); an expired un-ended row is closed lazily on next enable
alter table public.studio_break_glass enable row level security;
revoke all on public.studio_break_glass from anon, authenticated;
grant select, insert, update on public.studio_break_glass to service_role;
```

(If the partial index blocks re-enabling after expiry, `enable` first sets `ended_at = least(now(), expires_at)` on any expired open row in the same transaction.)

## 9.5 What a break-glass write can be, and the critical rule set

**Allowed in break-glass:** (1) editing **draft** fields in Studio (the form is writable), (2) **publishing through the gate**, (3) discarding a draft. **Not allowed, in any state:** creating Catalogue documents, built-in Publish/Unpublish/Delete/Duplicate/Restore, lifecycle changes (archive/restore/unpublish go through the dashboard or the existing lifecycle service), editing project configuration, editing `readinessOverrides`.

Publishing is the one thing that changes what visitors see (drafts are inert). So the critical rules are enforced **at publish, on the server**:

```ts
// src/lib/api/catalogue-break-glass.ts
export type OperatorContext = TenantAuthorizationContext   // synthesised, see below

/** Builds a context whose ONLY grants are `catalogue.item.write` + `catalogue.collection.write` on the grant's project, support-style `mutation`. These two cover every publishable Catalogue type with no new id: items and **option lists** use `catalogue.item.*`, collections and **`cataloguePage`** use `catalogue.collection.*` (ADR-033 C4), so a dependency of any of the four types publishes in the same call (REVIEW C-19). The C1/C6/C7 documents (`catalogueTaxonomy`, `cataloguePublicationStandards`, `cataloguePackHistory`) are NOT publishable through this path — they are `liveEdit` and written only by Setup services. Throws unless: caller is abluo_admin with aal2 AND an unexpired, un-ended studio_break_glass row exists for projectId. */
export function operatorContextFor(admin: AdminSession, grant: BreakGlassRow): OperatorContext

export async function publishCatalogueAsOperator(
  admin: AdminSession,
  input: { projectSlug: string; kind: CatalogueKind; id: string; rev: string; withDependencies: boolean },
  deps: CatalogueDeps,
): Promise<ReturnType<typeof publishCatalogueDraft>>
//   = publishTogether(PUBLISH_DESCRIPTORS, operatorContext, projectId, {root, withDependencies:true|false, timing:'keep'|'now'}, cataloguePublishGate(site, uuid), …)
//   i.e. THE SAME GATE (C6 §6.7), families ['standard','integrity'], plus audit actor_kind 'studio', detail.breakGlass = grantId.
```

Route: `POST /api/admin/catalogue/studio-publish` (`requireAbluoAdmin()` + aal2 + grant check + `assertSingleSanityProject`). The Studio **action** `CatalogueGatePublishAction` shows a confirmation, calls the route with the draft `_rev`, and renders the refusal list (`detail.readiness: Finding[]`) when the gate says no. There is no other code path from Studio to a published Catalogue document.

Critical rule set — each row says how Studio enforces it:

| Rule (K-7) | Enforced by | In Studio form (UX only) |
|---|---|---|
| Referential integrity (refs resolve, same project, right type) | Gate `integrity.refUnresolved` / `refOtherProject` / `unknownKey` | Validation marker from the same rule via `loadItemFacts(getClient().fetch)` |
| Allergen review (item + free-text choices) | Gate `allergenReview`, `allergenChoicesReview`, `integrity.declarationShape` | Marker; the existing async GROQ validations are **replaced** by the engine call |
| Dependencies publishable | `publishTogether` + gate `dependenciesPublishable` | Marker |
| Price / availability validity | Gate `integrity.priceShape`, `integrity.currencyStored`, C4/C5 validity | Marker |
| Publication blockers (name, category, page address, stray address, slug namespace) | Gate (standard family) | Marker |
| Lifecycle fields untouched by drafts | `publishTogether` (already) | `readOnly` |
| Attribution | `audited()` with the operator actor | – |

**Honest limit (I-4):** drafts written via Studio can contain anything the Studio form allows; the gate judges them at publish. Writes that **bypass Studio entirely** (Sanity API/CLI/MCP with an editor token, Vision mutations, the Sanity web "Manage" tools) cannot be prevented from this repo; the security boundary is Sanity project membership and token custody. The compensating, **detective** control is part of this contract:

- A second Sanity webhook (same pattern as `ACTIVITY_WEBHOOK_FILTER`) on **any** create/update/delete of a `CATALOGUE_STUDIO_TYPES` document in the production dataset, projection `{documentId, type, projectSlug, transactionId}`.
- The receiver accepts a transaction whose id starts with a prefix in **`CATALOGUE_WRITER_PREFIXES = ['abluo-dash-', 'abluo-gate-', 'abluo-pack-', 'abluo-setup-', 'abluo-migr-']`** (one exported constant in `catalogue-posture.ts`; every server writer of a `CATALOGUE_STUDIO_TYPES` document sets one: dashboard `abluo-dash-`, operator route `abluo-gate-`, packs `abluo-pack-`, Setup/taxonomy/standards services `abluo-setup-`, migration scripts `abluo-migr-<migrationId>-`), or when it is a **draft** write inside an unexpired grant for that project. Anything else records `studio.write_outside_gate` (C12) and appears in admin Home → "Needs your attention".
- The daily reconciliation (ADR-032 A4's reconciliation, extended to the Catalogue types) runs the same check and backfills any missed webhook delivery (D-18; see 9.5a).

## 9.5a Studio limits and compensating controls (D-18)

*Decided — Tom 2026-11-02, D-18.* Verbatim: "Accept read-only Studio as a UI control, not a security boundary. Add restricted seats and tokens; detective webhook; daily reconciliation; audit events for writes outside the authorised gate; explicit break-glass. Correct ADR-032 D14 to say the protection is designed/documented until implemented."

| Control | What it is | Where specified |
|---|---|---|
| **Read-only Studio = a UI control, not a security boundary** | Stated in this contract, in ADR-033 K-7 wording and in the break-glass banner help text; nobody may describe the lock as preventing writes by someone with API access | 9.1, I-4 |
| **Restricted seats and tokens** | An **access register** (an operational checklist, reviewed quarterly and on every staff change, not code): (1) Sanity project seats limited to named Abluo staff, the minimum role the Growth plan offers (verify which roles exist); (2) the **only** write-capable token is the server token used by the dashboard/gate/operator route (stored server-side, never in a browser bundle); (3) a separate migration token held out of band and revoked after each run; (4) MCP, CLI and personal tokens are **read-only**; no personal write tokens; (5) tokens are named, owned, dated and rotated; (6) a write by anything other than (2) or a break-glass draft write is, by definition, out of gate and detected below | this section; ops item in the C10 plan |
| **Detective webhook** | The Sanity webhook on every create/update/delete of a `CATALOGUE_STUDIO_TYPES` document (9.5): accepts transaction ids starting with a prefix in `CATALOGUE_WRITER_PREFIXES` (9.5), and draft writes inside an unexpired grant; anything else is out of gate | 9.5 |
| **Daily reconciliation** | Once a day, for every Catalogue document changed since the last run, compare its latest transaction id against the allowed prefixes and the break-glass grants active at that time; anything else records `studio.write_outside_gate` with `detectedBy:'reconciliation'`. The row is idempotent on `(transaction_id, kind, target_id)`, so webhook + reconciliation never double-count; a missed webhook delivery is therefore caught within a day | 9.5, C12 |
| **Audit events** | `studio.write_outside_gate` (C12): document type, document id, transaction id, `detectedBy`; content-free; hidden from clients, shown in admin Home → Needs your attention | C12 12.3 |
| **Explicit break-glass** | 9.4: the only sanctioned Studio write path; Super Admin + aal2, reason, 15/60/240 minutes, per project, banner, logged, publish only through the gate | 9.4, 9.5 |

**ADR-032 D14.** D14 says lifecycle guardrails (Delete replaced by Archive) exist in Studio. They do not, for Catalogue or any other type (this contract's code facts). **Tom is correcting ADR-032 D14 himself** to say the protection is *designed/documented, not implemented* until this contract's R1 posture ships. This file does not edit ADR-032; it only states that until R1 ships the Catalogue Studio types are unprotected and treats D14 as "designed".

## 9.6 What happens to existing Studio validations in `catalogue/schema.ts`

K-13: "Studio Catalogue schema validation shrinks to the critical set once documents are read-only; until then it stays as is." Decision:

| Today | Fate |
|---|---|
| `allergenDeclaration` item validation (`allergenDeclarationIssues` + `describeDeclarationIssue`) | **Replaced** by `studioValidation(document, getClient)` calling `loadItemFacts` + `evaluateItem(…, {families:['standard','integrity']})`; markers = findings. Same wording source (`describeDeclarationIssue`). |
| Option choice `allergenDeclaration` (error shape / warning incomplete) | **Kept** for shape (errors) via engine `integrity.declarationShape`; the "incomplete" warning is dropped (the dashboard shows it). |
| `catalogueItem.optionLists` async GROQ (unreviewed choices) | **Removed**; covered by `allergenChoicesReview` (same facts loader; no duplicate query string). |
| `catalogueOptionList.options` async GROQ (`OPTION_LIST_FOOD_USERS_QUERY`, `studioOptionListProblem`) | **Removed**; the option-list node rules (`no_options`, unreviewed choices used by a food item) live in `evaluateNode`. |
| `slugsWithoutName` | **Removed**; `strayAddress`. |
| offer `price` required / precision / HH:mm regex / window overlap | **Kept until C3/C4 replace `catalogueOffer`**; then replaced by C4 `integrity.priceShape`. The `required` on price is dropped (price is recommended on the website, K-3 rule 10; Studio must not make an unpriced item unsaveable). |
| `Rule.required()` on `name` etc. | **Kept** (cheap, structural). |
| `hidden: ({document}) => !can(profileOf(...))` conveniences | **Kept** (display). |
| Cosmetic descriptions, groups, previews | Kept; no new Studio conveniences are built (K-7). |

The Studio marker adapter is ~40 lines: `findingToStudioMarker(f) → { level: f.level==='required' ? 'error' : 'warning', message: describeFinding(f) }` (English, as today: "Studio is the platform owner's tool"). Since break-glass publish is replaced by the gate action, Studio's own "validation errors block Publish" mechanism is moot; the markers are diagnostics. This is why the engine call is acceptable in Studio even though it is async: a failed fact read yields one marker "Could not check readiness; the publication gate will check on publish" (never a silent pass).

## 9.7 Migration from today

**Ordering is defined once, in the C10 plan (E-1).** C9's contribution:

- **R1 (with the gate extraction, C6):** `catalogue-posture.ts`, `CataloguePostureLayout`, the `sanity.config.ts` branch, the `readOnly` wrapper for **Catalogue documents** (layers 1–3), `studio_break_glass` table (number reserved second, after M0 `catalogue_audit_log`), routes, the second webhook. `CATALOGUE_LOCK_PHASE = 'R1'`. Break-glass publish needs `cataloguePublishGate`, which is why the gate extraction lands in the same release.
- **R2 (with Setup):** `CATALOGUE_LOCK_PHASE = 'R2'` — locks Catalogue `taxonomyTerm` (`lockFrom:'R2'`) and `moduleInstallations[].config` / Modules pane (9.3). Before flipping, ask Tom for any real Studio-only workflow (D-9 delivery matrix checks, term corrections): each becomes a dashboard feature or a runbook, not a permanent Studio write.
- Remove the Studio GROQ duplicates per 9.6 **in the same commit** as the engine adapter, so there is never a window with neither.
- Implement ADR-032 D14 for the *other* lifecycle types separately; not a dependency.

## 9.8 Tests (named)

| Test | Fails when |
|---|---|
| T-1 `every-catalogue-document-type-readonly` | for each name in `CATALOGUE_STUDIO_TYPES ∪ CATALOGUE_STUDIO_SCOPED`: the schema type from `catalogueSchemaTypes`/taxonomy has a function-valued `readOnly`, and `readOnly({document:{projectSlug:'p',module:'catalogue'}})` is `true` with `postureStore = {grants:[], loaded:true}`, with `{loaded:false}`, and with an **expired** grant |
| T-2 `no-publishable-without-break-glass` | `catalogueDocumentActions(prev=[publish, unpublish, delete, duplicate, restore, discard], …)` with posture off returns `[]` |
| T-3 `registry-and-posture-agree` | the set of `document`-typed definitions in `catalogueSchemaTypes` (plus any type in the Catalogue manifest's `schemaTypes` with `type:'document'`) differs from `CATALOGUE_STUDIO_TYPES`: **adding a Catalogue document type without classifying it fails the build** |
| T-4 `break-glass-has-one-door` | with posture on, the result contains exactly `[catalogueGatePublish, discard]`; no action with `action` in `{'publish','unpublish','delete','duplicate','restore'}` |
| T-5 `sanity-config-delegates` | static check: `sanity.config.ts` contains `catalogueDocumentActions(` before the first `context.schemaType ===` branch, and `newDocumentOptions` includes `CATALOGUE_TEMPLATE_IDS` |
| T-6 `gate-is-shared` | `catalogue-break-glass.ts` imports `cataloguePublishGate` from `catalogue-publish-gate.ts` and does **not** import `lifecycle.publishTogether` with any other `prepare`; `publishCatalogueDraft` uses the same export (identity assertion on the function reference via a spy) |
| T-7 `grant-time-limit` | route: grant 61 min old with `minutes:60` → `studio-publish` refuses `forbidden`; 4h+1 min request refused at enable; expired-unended row does not block re-enable |
| T-8 `non-admin-refused` | tenant owner, abluo_admin without aal2, and admin without grant: each `forbidden` on enable and on studio-publish; zero Sanity calls |
| T-9 `gate-refuses-malformed-from-studio` | draft with a ref to another project's photo, negative price, unknown allergen key → `studio-publish` refuses with `integrity.*` findings; nothing published (transaction spy 0) |
| T-10 `fails-closed` | `postureStore.loaded=false` ⇒ `catalogueReadOnly` true for every type |
| T-11 `outside-gate-detected` | webhook receiver: txn id `abc` on `catalogueItem` outside a grant ⇒ `studio.write_outside_gate` row; one case per prefix in `CATALOGUE_WRITER_PREFIXES` (`abluo-dash-`, `abluo-gate-`, `abluo-pack-`, `abluo-setup-`, `abluo-migr-`) ⇒ none; draft write inside grant ⇒ none |
| T-12 `modules-pane-readonly` | `ModuleList` for `catalogue` renders no inputs for config fields (render test) and `moduleInstallations[].config` is `readOnly` when `moduleId` is a dashboard-config module |
| T-14 `operator-covers-all-publishable-types` | `operatorContextFor` grants exactly `catalogue.item.write` + `catalogue.collection.write`; publishing an item whose dependency is an option list, and a collection whose dependency is a `cataloguePage`, through `publishCatalogueAsOperator` both succeed (fake client) |
| T-15 `lock-phases` | with `CATALOGUE_LOCK_PHASE='R1'`: `catalogueItem` read-only, `taxonomyTerm{module:'catalogue'}` writable, `moduleInstallations[catalogue].config` writable; with `'R2'`: all read-only |
| T-16 `reconciliation-catches-missed-webhook` | a Catalogue write with transaction id `abc` and the webhook delivery dropped; reconciliation runs twice | exactly one `studio.write_outside_gate` row, `detectedBy:'reconciliation'`; second run adds none (idempotent); a write with `abluo-gate-…` or inside an unexpired grant adds none |
| T-17 `outside-gate-payload-content-free` | a write that changes a name, a price and an allergen list | the audit row contains only type, id, transaction id, `detectedBy` — none of the changed values |
| T-18 `draft-write-after-expiry-flagged` | draft write at grant expiry + 1 minute | flagged `studio.write_outside_gate` (grant expired); a write at expiry − 1 minute is not |
| T-19 `access-register-documented` | docs lint: the C10 plan lists the access-register checklist (seats, single write token, read-only MCP/CLI tokens) | fails if the checklist item is absent |
| T-13 `validations-shrunk` | `schema.ts` contains no `OPTION_LIST_FOOD_USERS_QUERY`/`studioOptionListProblem` usage after the cut-over; allergen validation calls `evaluateItem` |

### R1 implementation note — `cataloguePage` stays Studio-edited

`cataloguePage` (the public Catalogue landing page: sections, SEO) is edited **only in Studio**; the dashboard has no editor for it. Locking it in R1 (read-only form, no document actions) would leave nobody able to edit or publish it. R1 therefore classifies it as **"Studio-edited until a dashboard editor exists"**: it stays in `CATALOGUE_STUDIO_TYPES` (T-3 still requires every Catalogue document type to be classified) and is listed, with that reason, in `CATALOGUE_STUDIO_EDITED` (`src/lib/sanity/studio/catalogue-posture.ts`). The R1 lock applies to `CATALOGUE_LOCKED_TYPES` = the classified types minus that exception: `cataloguePage` keeps its normal document actions, its pre-R1 "+ New" templates, and no posture `readOnly`. T-1, T-10 and T-5's template check run over the locked types; the posture test asserts the exception and its reason. The entry is removed — and the page locked like the other types — in the same commit that ships a dashboard editor for it.


---

# C12 — Audit events

## 12.1 Purpose

Brief §28 / ADR-032 D9: record who did what to which target and when, with the **material before/after meaning** and no unnecessary content. Catalogue adds many events that are not document lifecycle events (a pack applied, a rule changed, a channel switched, an import undone). This contract fixes the kinds, payloads, storage, retention and visibility.

## 12.2 Storage decision

**A new Supabase table `catalogue_audit_log`, written by a new writer that reuses the existing writer's pattern; per-item events also appear in the item's Activity.**

Why not reuse `content_audit_log`:

- Its `action` column has a CHECK of nine lifecycle values mirrored by the closed `ContentAction` union, which `lifecycleAction`, `toActivityItem`, the Studio webhook and reconciliation all depend on; adding 20 kinds would widen a contract five consumers pattern-match on.
- It requires a non-null `content_id` and a per-item index; setup-level events (pack applied, standard changed, channel switched) have no document.
- Different audience (setup events are for Owner/Site admin, not every editor) and different payloads (impact counts).

Why not `admin_audit_log` (ADR-030): internal only, for Abluo staff; clients must see their own Catalogue history. **Break-glass enable/end/publish are written to both** (admin log for staff accountability, Catalogue log for client transparency).

What is reused: the service-role writer pattern (`recordContentActivity`: one retry, tagged log line `[catalogue-audit] not recorded`, never breaks the action), the `audited()`-style wrapper (`auditedCatalogue`), the retention job (`purge`), and the `[content-audit]` admin monitoring.

```sql
-- migration M0: catalogue_audit_log — number reserved FIRST, before studio_break_glass, both after the billing series (REVIEW E-15); order in the C10 plan E-1
create table public.catalogue_audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  project_id     uuid references public.projects (id) on delete set null,
  kind           text not null check (kind ~ '^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*){1,2}$'),        -- stable, see 12.3 (open set, validated in TS, not CHECK-listed)
  scope          text not null check (scope in ('project', 'item', 'collection', 'category', 'channel', 'standard', 'import', 'export')),
  target_id      text check (target_id is null or length(target_id) between 1 and 128),   -- item publicId/_id, category key, channel key, batch id …
  actor_kind     text not null check (actor_kind in ('user', 'studio', 'system')),
  actor_id       uuid references auth.users (id) on delete set null,
  outcome        text not null default 'ok' check (outcome in ('ok', 'refused', 'failed')),
  transaction_id text check (transaction_id is null or length(transaction_id) between 1 and 128),
  correlation_id text check (correlation_id is null or length(correlation_id) between 1 and 128),   -- bulkId / importBatchId / grantId / sessionId
  detail         jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 8192)
);
create index catalogue_audit_project_time on public.catalogue_audit_log (project_id, occurred_at desc);
create index catalogue_audit_target_time  on public.catalogue_audit_log (project_id, scope, target_id, occurred_at desc);
create index catalogue_audit_correlation  on public.catalogue_audit_log (correlation_id) where correlation_id is not null;
create unique index catalogue_audit_txn   on public.catalogue_audit_log (transaction_id, kind, coalesce(target_id, '')) where transaction_id is not null;
alter table public.catalogue_audit_log enable row level security;
revoke all on public.catalogue_audit_log from anon, authenticated;
grant select, insert, delete on public.catalogue_audit_log to service_role;
```

Application order: this table is **M0, the first step of the C10 plan (E-1)** — the writer ships with "table missing = log and continue" (as 041 says), then the migration is applied, then event producers are enabled; every later migration step (taxonomy, commerce, pack history, public name) writes its audit rows into it. Migration numbers: `catalogue_audit_log` first, `studio_break_glass` second, both after the billing series (REVIEW E-15).

## 12.3 Kinds and payloads

```ts
// src/lib/modules/catalogue/audit-events.ts   (pure types + builders; browser-safe)

export type CatalogueAuditKind =
  | 'pack.applied' | 'pack.updated'
  | 'category.rule_changed' | 'category.restructured'
  | 'channel.activated' | 'channel.deactivated' | 'channel.removed' | 'channel.default_changed'
  | 'standard.changed'
  | 'allergen.reviewed' | 'allergen.invalidated'
  | 'import.started' | 'import.completed' | 'import.failed' | 'import.undone'
  | 'bulk.executed'
  | 'export.snapshot'
  | 'readiness.override_recorded' | 'readiness.override_expired'
  | 'availability.schedule_changed'
  | 'compliance.task_created'
  | 'allergen.linked_invalidated' | 'allergen.dependency_removed'
  | 'public_name.migrated'
  | 'migration.commerce' | 'migration.taxonomy' | 'migration.pack_history' | 'pack.interrupted'
  | 'studio.break_glass_enabled' | 'studio.break_glass_ended' | 'studio.break_glass_publish' | 'studio.write_outside_gate'

type Counts = { items: number; formats?: number; collections?: number }

export type CatalogueAuditPayload = {
  'pack.applied':   { packId: string; packVersion: number; added: { categories: number; tags: number; collections: number; sections: number; formats: number; optionGroups: number; channelsSuggested: number }; equivalentExisting: number; conflictsResolved: number }
  'pack.updated':   { packId: string; fromVersion: number; toVersion: number; added: Record<string, number> }
  'category.rule_changed': { categoryKey: string; channel: string | null /* null = all */; before: RuleSummary; after: RuleSummary; impact: ImpactCounts }   // state and/or schedule change (one row)
  'category.restructured': { op: 'move' | 'delete' | 'reassign'; categoryKey: string; fromParent?: string | null; toParent?: string | null; reassignedTo?: string; impact: Counts }
  'channel.activated':   { channelKey: string; defaultAvailability: ChannelAvailabilityState; impact: ImpactCounts }
  'channel.deactivated': { channelKey: string; impact: ImpactCounts }
  'channel.default_changed': { channelKey: string; before: ScheduleSummary; after: ScheduleSummary; impact: ImpactCounts }   // baseline and/or defaultSchedule
  'channel.removed':     { channelKey: string; cleanup: { categoryRules: number; itemRules: number; formatRules: number; prices: number } }   // counted, audited cleanup only (REVIEW D-21)
  'standard.changed': { standardKey: string; fromVersion: number | null; toVersion: number; rules: { added: string[]; removed: string[]; levelChanged: Array<{ code: string; from: RuleLevel; to: RuleLevel }> }; overridesExpired: number }
  'allergen.reviewed':    { itemId: string; status: 'containsListedAllergens' | 'noneDeclared'; contains: AllergenKey[]; mayContain: AllergenKey[]; basis: ReviewBasis; riskAssessmentConfirmed: boolean; declarationVersion: number; previousStatus: AllergenDeclarationStatus; scope: 'item' | 'choice'; choiceKey?: string }   // fields = C13 `AllergenReview`; reviewer = actor
  'allergen.invalidated': { itemId: string; cause: Exclude<AllergenInvalidationCause, 'linkedItemChanged'>; previousStatus: AllergenDeclarationStatus }   // cause union owned by C13; linked-item resets use `allergen.linked_invalidated`
  'allergen.linked_invalidated': { parentItemId: string; linkedItemId: string; choiceKey?: string; trigger: 'linkedItemPublished' | 'combinedPublication'; previousStatus: AllergenDeclarationStatus; taskId: string }   // D-16: one row per affected parent, same correlation_id; actor `system`
  'allergen.dependency_removed': { itemId: string; what: 'optionRemoved' | 'optionListDetached'; listId?: string; choiceKey?: string; previousStatus: AllergenDeclarationStatus }   // D-16: audited, does NOT reset the review
  'compliance.task_created': { taskId: string; itemId: string; reason: 'linkedItemChanged'; createdDraft: boolean; linkedItemId: string }   // D-16: system-created draft/review task (C13 13.4); actor `system`
  'availability.schedule_changed': { level: 'item' | 'format'; targetKey: string; channel: string | null; before: ScheduleSummary; after: ScheduleSummary; affected: { items: number; formats: number } }   // D-6/C5a; category and channel-default schedule edits are recorded by `category.rule_changed` / `channel.default_changed`
  'import.started':   { batchId: string; sourceKind: 'csv' | 'xlsx' | 'paste'; sourceFingerprint: string; rows: number }
  'import.completed': { batchId: string; created: number; updated: number; skipped: number; invalid: number; createdTerms: number }
  'import.failed':    { batchId: string; stage: 'parse' | 'map' | 'match' | 'apply'; code: string; appliedBeforeFailure: number }
  'import.undone':    { batchId: string; removedDrafts: number; revertedFields: number; blockedByLaterEdits: number }
  'bulk.executed':    { bulkId: string; op: BatchOp | 'assignCategory' | 'assignPrimary' | 'place' | 'channelOverride' | 'priceUpdate' | 'attachOption' | 'edit'; mode?: BulkPublishMode; requested: number; done: number; blocked: number; skipped: number; blockedByCode: Partial<Record<ReadinessCode, number>> }
  'export.snapshot':  { snapshotId: string; format: 'csv' | 'xlsx' | 'pdf'; template?: string; scope: { kind: 'all' | 'filtered' | 'selected'; count: number }; locale?: string; channel?: string; contextKey: string; readiness: { ready: number; readyWithWarnings: number; blocked: number }; sourceRevision: string; policyVersion?: string }
  'readiness.override_recorded': { itemId: string; ruleCode: string; contextKey: string; standard: string; standardVersion: number }   // D-17: who = actor, when = occurred_at, why = on the item (never copied here)
  'readiness.override_expired':  { itemId: string; ruleCode: string; contextKey: string; cause: 'resolved' | 'changed' | 'standardChanged' | 'revoked' }
  'public_name.migrated': { migrationId: string; action: 'copy' | 'drop'; old: Record<string, string>; new: Record<string, string> | null; discarded: Record<string, string> | null }   // = the C11 plan verbatim (REVIEW X-12); `old` = navLabel, K-2 requires it
  'migration.commerce':   { migrationId: string; items: number; formats: number; prices: number; legacyOffersKept: number; equivalence: 'verified' | 'diffNonEmpty' }
  'migration.taxonomy':   { migrationId: string; categories: number; tags: number; itemsAssigned: number; itemsUnassigned: number }
  'migration.pack_history': { migrationId: string; converted: Array<{ packId: string; packVersion: number }> }     // appliedPreset → history (C7.6)
  'pack.interrupted':     { packId: string; packVersion: number; stage: string; resumable: boolean }
  'studio.break_glass_enabled': { grantId: string; minutes: number }                       // reason is NOT here (admin log only)
  'studio.break_glass_ended':   { grantId: string; how: 'expired' | 'ended' }
  'studio.break_glass_publish': { grantId: string; documentType: string; documentId: string; documents: number }
  'studio.write_outside_gate':  { documentType: string; documentId: string; transactionId: string; detectedBy: 'webhook' | 'reconciliation' }   // D-18
}
type Tri = AvailabilityRuleValue      // C2: 'inherit' | 'available' | 'unavailable'
/** Content-free summary of a C5a `ChannelAvailabilityRule`: counts and a hash, never times or labels. */
type RuleSummary = 'inherit' | ScheduleSummary   // 'inherit' when the rule is unset; otherwise baseline + schedule summary
type ScheduleSummary = { baseline: ChannelAvailabilityState; overrides: number; daysCovered: number; fingerprint: string }
/** Derived from C5 `AvailabilityImpact` (the single implementation): itemsChanged, formatsChanged, summed byChannel, shieldedByOverride. */
type ImpactCounts = { items: number; formats: number; toAvailable: number; toUnavailable: number; shieldedByOverride: number }
export function impactCounts(i: AvailabilityImpact): ImpactCounts

export function auditEntry<K extends CatalogueAuditKind>(kind: K, args: { projectId: string; targetId?: string; actor: AuditActor; correlationId?: string; transactionId?: string; outcome?: AuditOutcome; detail: CatalogueAuditPayload[K] }): CatalogueAuditEntry
export function validateAuditDetail(kind: CatalogueAuditKind, detail: unknown): detail is object      // size + field allowlist; rejects free text
```

### Per-kind table: actor, target, meaning

| Kind | Actor | Target (`scope` / `target_id`) | Before/after meaning recorded | Notes |
|---|---|---|---|---|
| `pack.applied` | user (needs `setup.manage`) | project / packId | counts of what was **added**; equivalents found; no names/content | K-6 history; only the setup flow reads the applied-pack record, never runtime |
| `pack.updated` | user | project / packId | from/to version, added counts | optional update with diff |
| `category.rule_changed` | user (`setup.manage`) | category / categoryKey | tri-state before → after on a channel, plus **impact counts** = C5 `availabilityImpact` (items/formats changed, to-available / to-unavailable, shielded by explicit overrides) | brief 11.4: confirmed, counts shown |
| `category.restructured` | user (`setup.manage`) | category / key | move/delete/reassign + counts | not in brief §28 but availability-material (I-8) |
| `taxonomy.use_for_changed` | user (`setup.manage` for categories and option lists, `taxonomy.write` for tags) | category / key (tag, option list: same scope rules, `target` names which) | profile ids before → after + count of items newly incompatible | D-22, C1.12.7; registry ids only, never labels |
| `channel.activated` / `.deactivated` | user (`setup.manage`) | channel / channelKey | `defaultAvailability` chosen + C5 `availabilityImpact` counts. Activation changes availability **only through the channel's `defaultAvailability`** (an `available` default makes items without overrides available on it; an `unavailable` default changes nothing) — K-3 rule 1 ("entering a price never activates a channel") is a statement about prices, not about this explicit setting | `channel.default_changed` and `channel.removed` are separate rows |
| `standard.changed` | user (`setup.manage`) | standard / standardKey | version bump, rule codes added/removed/re-levelled, overrides expired | codes only, no tenant message text |
| `allergen.reviewed` | user (`allergen.update`) | item / publicId (choice: item id + `choiceKey`) | status → status, the Annex II keys contains / may contain (closed legal list, not personal), **basis**, previous status; reviewer = actor | The only place the declaration's content appears; it is the evidence (20.2). Not the free-text note. |
| `allergen.invalidated` | user who made the edit, or `system` | item / publicId | cause (D-16 list) + previous status; status → `notReviewed` | one row per reset item; a cascade shares one `correlation_id` |
| `allergen.linked_invalidated` | `system` | item / parent publicId | the linked item that became effective, trigger (`linkedItemPublished` or `combinedPublication`), previous status, the compliance task id | D-16: written when a linked item's declaration or relevant food profile **becomes effective through publication**; one row per affected parent, same `correlation_id`; the parent stays online |
| `allergen.dependency_removed` | user (`item.write`) | item / publicId | an option or an option-list attachment was removed; previous status | D-16: removing an option or detaching a list does not reset the review but is audited |
| `compliance.task_created` | `system` | item / parent publicId | task id, linked item id, whether a draft was created from the published copy solely to carry the task | D-16: the system-created draft/review task (C13 13.4); shown as a compliance task, not a manual change |
| `availability.schedule_changed` | user (`setup.manage` for channel/category; `item.write` for item/format) | channel / category / item (the scope of `targetKey`) | before/after summary (baseline, number of overrides, days covered, fingerprint) and affected item/format counts | D-6/C5a; times and labels are not recorded; impact counts use the C5 impact function |
| `import.started/completed/failed/undone` | user (`import.use`) | import / batchId | counts only; `sourceFingerprint` (hash) not file name or cell values | row-level outcomes live in the batch record (C-import), not here |
| `bulk.executed` | user | project / bulkId | requested/done/blocked/skipped and a histogram of blocker codes | every published/changed row **also** has its normal `content_audit_log` `published` row with `detail.bulkId` |
| `export.snapshot` | user (`export.use`) | export / snapshotId | what/where/when: format, template, scope size, locale/channel, context, readiness summary, `sourceRevision` (hash of source revisions) | snapshot content is stored by C-export; this row is the pointer and the AC-13 "register matches snapshot" anchor |
| `readiness.override_recorded` | user (`readiness.update`: Owner or Site admin) | item / publicId | rule, context, standard version; who = actor, when = row time; **why stays on the item** (always present, D-17), not duplicated | |
| `readiness.override_expired` | user or `system` | item / publicId | cause (`resolved`, `changed`, `standardChanged`, `revoked`) | emitted by the writer on next write; D-17: expires when the underlying meaning changes |
| `public_name.migrated` | `system` (`detail.migration = 'catalogue-public-name'`) | project / `project.slug` | K-2: project, **old value** (the navLabel map, a business label), new value, copy vs drop (+ discarded values), migration id, timestamp | one row per project migrated; also appended to the migration report |
| `studio.break_glass_enabled/_ended` | studio/admin user | project / grantId | minutes; reason **only** in `admin_audit_log` | client-visible: "The Abluo team maintained Catalogue data" |
| `studio.break_glass_publish` | studio (admin user id in `actor_id`, `actor_kind:'studio'`) | item or collection / id | which document(s) the gate published | each published doc also has a `content_audit_log` `published` row (actor studio) |
| `studio.write_outside_gate` | system | item / id | doc type/id, transaction id, `detectedBy` (`webhook` or `reconciliation`) | D-18; internal (hidden from clients, shown in admin attention) |

### Actors (never inferred — ADR-032 A1)

`user` = a signed-in dashboard user (support mode: `detail.support = true`, shown as "Abluo support"); `studio` = Abluo staff in Studio break-glass (shown as "the Abluo team"); `system` = migrations, invalidation cascades, outside-gate detection. A person is named only when the dashboard recorded their authenticated action.

### What is deliberately **not** recorded

Item names/descriptions, prices, free-text allergen notes, override reasons, import cell values, file names, search strings, emails. Counts, keys, codes, hashes, versions only. (Category/channel/format keys are stable machine keys, not personal data. The `public_name.migrated` old value is the tenant's own navigation label, required by K-2.)

## 12.4 Writer

```ts
export type CatalogueAuditEntry = { projectId: string; kind: CatalogueAuditKind; scope: AuditScope; targetId?: string; actorKind: 'user' | 'studio' | 'system'; actorId: string | null; outcome: AuditOutcome; transactionId?: string; correlationId?: string; detail: object; occurredAt?: string }
export type CatalogueAuditWriter = (entry: CatalogueAuditEntry) => Promise<void>

/** Default writer: validateAuditDetail → insert via runAsTrustedSystemOperation('Catalogue audit …') → one retry → tagged log. Never throws. */
export function recordCatalogueActivity(entry: CatalogueAuditEntry, deps?: { db?: AuditDb }): Promise<void>

/** Wrapper for operations: records ok on success, refused/failed on error (kind = the intended kind), re-throws unchanged. Mirrors `audited()`. */
export function auditedCatalogue<T>(spec: { ctx: Pick<TenantAuthorizationContext, 'userId' | 'support'>; projectId: string; kind: CatalogueAuditKind; scope: AuditScope; targetId?: string; correlationId?: string; writer?: CatalogueAuditWriter }, run: (txnId: string) => Promise<{ value: T; detail: object }>): Promise<T>
```

Only successful events (`outcome: 'ok'`) are shown to clients, as with Activity. A refusal for a **write attempted without capability** records `refused` with `detail: { capability }` (internal).

Supabase and Sanity cannot share a transaction (REVIEW C-20). Audit rows are therefore written **after the Sanity commit, keyed by the Sanity transaction id** (stored in `transaction_id`; the unique index makes retries safe); multi-row events (an invalidation cascade, a pack applied) write all their rows after that one commit. If the audit insert fails it is logged with the tag and re-created by the daily reconciliation job from the Sanity transaction (extend ADR-032 A4 to recognise `abluo-dash-` transactions that touched Catalogue setup documents without a `catalogue_audit_log` row; for operations where the transaction id is the only link: pack apply, channel switch, standard change).

## 12.5 Retention and visibility

| | Decision |
|---|---|
| Retention `ok` | *(Decided — Tom 2026-11-02, D-20.)* **5 years as the platform audit default**, enforced by the same daily purge job (`purge` extended to this table). **Allergen events (`allergen.*`, `compliance.task_created`) are compliance evidence: longer allergen retention is pending legal/privacy review.** The exact duration is deferred to that review and **is not hard-coded** (no ten-year constant in code, config or this contract): it must be decided before the first allergen-review evidence record is created in production, by jurisdiction, evidence purpose and privacy obligations. Until then the platform default (5 years) applies; because the decision precedes the first production evidence record, no allergen row can reach a purge date before the longer value exists. When approved it becomes one reviewed setting, never a literal (C13 13.6). |
| Retention `refused`/`failed`/`studio.write_outside_gate` | 12 months |
| `actor_id` | nulled on account deletion (FK `on delete set null`); `project_id` nulled, never cascaded, on project deletion |
| Survives content deletion | yes (no link to Sanity) |
| Personal data | none beyond the actor id |
| Client visibility | (1) **Item Activity** (existing `readContentActivity` view) additionally merges `catalogue_audit_log` rows with `scope='item'` for the item, kinds `allergen.reviewed`, `allergen.invalidated`, `allergen.linked_invalidated`, `allergen.dependency_removed`, `compliance.task_created`, `readiness.*`, and `availability.schedule_changed` for an item or format; visible to anyone with `catalogue.item.read`. (2) **Catalogue → Setup → Overview → Activity** (new, table-only list per Tom's list rule): all `scope <> 'item'` rows except `studio.write_outside_gate`; visible to `catalogue.setup.manage`. (3) `studio.break_glass_*` and `studio.break_glass_publish` are shown to `catalogue.setup.manage` as "The Abluo team …" (no reason). |
| Abluo staff | admin project page: full table including `refused`/`failed`/outside-gate; admin Home "Needs your attention" counts outside-gate and failed writes (extends the existing "Activity needs a look") |
| Export of the log | none in v1 |

## 12.6 Migration from today

- No existing catalogue audit events exist other than lifecycle rows in `content_audit_log` for posts/events/galleries/faq; **Catalogue lifecycle actions already write there via `audited`** (catalogue-drafts uses `audited` through `publishTogether` / `runCatalogueLifecycle`). Those stay and keep driving the existing per-item Activity.
- Add the table and writer (12.2). Add the Catalogue types to `ACTIVITY_WEBHOOK_FILTER` for **lifecycle** field changes so Studio publishes/unpublishes of Catalogue are recorded (today they are not — I-6); the new break-glass webhook (C9) covers content changes.
- The K-2 migration script writes `public_name.migrated` rows from its first run (dry-run prints them without writing). Ordering of all migration steps and of M0 is the C10 plan (E-1); this table is created first so that every later step can write its audit row.
- `AdminAuditAction` gains `studio.catalogue_break_glass.start|end|publish`.

## 12.7 Test fixtures

| Fixture | Input → expected |
|---|---|
| A-01 `payload-allowlist` | `validateAuditDetail('allergen.reviewed', {…, note:'free text'})` → false; any string field longer than 64 chars (except `public_name.migrated` `old`/`new`/`discarded` values ≤ 200) → false; detail ≥ 8 KB → false |
| A-02 `every-kind-has-builder-and-table-row` | each `CatalogueAuditKind` has a payload type, a builder, and an entry in the visibility map (type-level exhaustive + runtime list) |
| A-03 `pack-applied-counts` | apply fixture pack (2 channels suggested, 14 categories) → one `pack.applied` row, `added.categories=14`, no label strings in `detail` |
| A-04 `category-rule-impact` | change `delivery` rule on `food.pizza` inherit→unavailable over 12 items with 2 explicit overrides → `impact` equal to `impactCounts(availabilityImpact(before, after, items))` (items 12, formats 12, shieldedByOverride 2)`, `before:'inherit'`, `after` a `ScheduleSummary{baseline:'unavailable'}` |
| A-05 `channel-activation-impact` | activate a channel with `defaultAvailability:'unavailable'` → row impact all zeros; with `'available'` over 6 formats lacking overrides (C5-F13) → `toAvailable:6`; the row's counts always equal `impactCounts(availabilityImpact(...))` |
| A-18 `new-kinds` | `channel.removed`, `channel.default_changed`, `migration.commerce`, `migration.taxonomy`, `migration.pack_history`, `pack.interrupted` each validate, pass the kind regex, and carry no free text; `public_name.migrated` and every other `CatalogueAuditKind` literal pass the SQL CHECK (test runs the regex over the union) |
| A-06 `allergen-review-evidence` | reviewed by user U with basis `recipe`, contains [milk, gluten], previous `notReviewed` → row has U as actor, keys sorted in Annex II order |
| A-07 `allergen-invalidated-cascade` | publish a linked item whose allergen fingerprint changed, used by 3 option lists / 5 foods → 5 `allergen.linked_invalidated` rows (actor `system`, `trigger:'linkedItemPublished'`), 5 `compliance.task_created` rows, one `correlation_id`; editing only the linked draft writes none |
| A-08 `import-roundtrip-rows` | import 10 rows → `import.started` then `import.completed{created:9,invalid:1}`; undo → `import.undone`; none contain cell values or file name |
| A-09 `bulk-summary-and-rows` | bulk publish 5 (2 blocked) → one `bulk.executed{done:3,blocked:2,blockedByCode:{allergenReview:2}}` + 3 `published` rows in `content_audit_log` with `detail.bulkId` equal to `correlation_id` |
| A-10 `export-snapshot-anchor` | PDF export → `export.snapshot` with `sourceRevision` hash; re-export of unchanged data → same hash |
| A-11 `override-cycle` | override `descriptionMissing` (reason required) → `readiness.override_recorded`; then add description + save → `readiness.override_expired{cause:'resolved'}`; the reason text appears in no audit row |
| A-12 `public-name-migration` | project with navLabel `{it:'Menù',en:'Menu'}`, no public name → `action:'copy'`, `old` equals input, `new` equals `old`; project with both → `action:'drop'`, `discarded` equals the navLabel; same `migrationId` across a project's rows; dry-run writes nothing |
| A-13 `break-glass-trail` | enable → publish via gate → expire: admin log has reason once; Catalogue log has enabled/publish/ended without reason; client Overview Activity shows "The Abluo team …" for the three |
| A-14 `visibility-matrix` | editor sees item-scope rows only; owner/site admin sees setup rows; outside-gate row visible to neither; viewer (`item.read`) sees item-scope rows |
| A-15 `writer-never-throws` | db throws twice → function resolves, logs `[catalogue-audit] not recorded` once |
| A-16 `idempotent-txn` | same `(transaction_id, kind, target_id)` inserted twice → second ignored (23505 treated as success) |
| A-17 `retention` | purge cut: `ok` older than 5 y deleted (allergen rows included, using the one retention setting, default 5 y; no ten-year literal anywhere — C13 W-23); refused/failed older than 12 mo deleted |
| A-19 `new-kinds-rev3` | `availability.schedule_changed`, `compliance.task_created`, `allergen.linked_invalidated`, `allergen.dependency_removed`, `readiness.override_recorded`, `readiness.override_expired` each validate, pass the kind regex `^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*){1,2}$`, and carry only ids, keys, counts, enums and hashes |
| A-20 `schedule-change-content-free` | change a Dinner category schedule (18:00–23:00 available) → one `category.rule_changed` row with `before/after: ScheduleSummary` and impact counts (and no `availability.schedule_changed` row; item/format edits write that kind); the row contains no times, labels or day names, only `baseline`, counts and `fingerprint` |
| A-21 `dependency-removed` | detach an option list from a reviewed food item → `allergen.dependency_removed{what:'optionListDetached'}`, no `allergen.invalidated` |
| A-22 `outside-gate-detected-by` | webhook and reconciliation both see the same transaction → one `studio.write_outside_gate` row, `detectedBy:'webhook'` (first writer wins) |

---

# C13 — Allergen declaration evidence, invalidation and retention

**Status:** Full contract (was a Rev 2 draft). Accepted — Tom 2026-11-02 (final consistency review applied). *Decided — Tom 2026-11-02, D-16* (reset and no-reset lists, review service, linked-item timing) *and D-20* (retention). REVIEW found that no contract owned the item-side stored shape of the review evidence required by brief §20.2 and AC-13; C8 (`catalogue.allergen.update`) and C12 (`allergen.*`, `compliance.task_created`) reference it. Not blocking the model slice; blocks the allergen slice. Extends, never replaces, `allergens.ts` (D-3 / D-3a / E-1): the three statuses and every existing rule stand.

## 13.1 Stored shape (on `catalogueItem.allergenDeclaration` and on free-text add choices)

```ts
export type ReviewBasis = 'recipe' | 'supplierLabel' | 'technicalSheet' | 'riskAssessment' | 'other'

export type AllergenReview = {
  reviewedBy: string                     // Supabase user id of the reviewer (never a name; resolved at read time like Activity actors)
  reviewedAt: string                     // ISO UTC, set by the SERVER, never by the client
  basis: ReviewBasis
  basisNote?: string                     // ≤ 120 chars, only when basis = 'other'; not localized; not copied to audit
  /** Brief 20.2: explicit risk-assessment confirmation for "may contain". REQUIRED when mayContain is non-empty. */
  mayContainRiskAssessment?: { confirmed: true; confirmedBy: string; confirmedAt: string }
  declarationVersion: number             // 1, 2, 3 … incremented by each review of this item/choice; the register and exports cite it
  /** Fingerprint of the declaration CONTENT as reviewed (status + sorted contains + sorted mayContain + default-locale note). Written only by the review service. */
  contentFingerprint: string
  /** For every LINKED choice the parent depends on: which linked item, and its published allergen fingerprint at review time. */
  linked?: ReadonlyArray<{ choiceKey: string; itemId: string; fingerprint: string }>
}

export type AllergenDeclaration =                 // supersedes the D-3 union, same statuses
  | { status: 'notReviewed'; invalidation?: { cause: AllergenInvalidationCause; at: string } }   // the reason the review was reset, for the editor's message
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[]; note?: AllergenNote; review?: AllergenReview }
  | { status: 'noneDeclared'; confirmed: true; mayContain?: AllergenKey[]; note?: AllergenNote; review?: AllergenReview }
// Option choices: same, without `note` (D-3a). A choice LINKED to an item stores nothing: it derives the item's declaration and review.

export type AllergenInvalidationCause =           // D-16 "Reset when" list, one cause per clause
  | 'profileChangedToFood'               // the profile changes to Food or drink
  | 'optionListAttached'                 // an option-list attachment is added or replaced
  | 'freeTextChoiceAdded'                // a free-text add choice is added
  | 'freeTextChoiceEdited'               // a free-text add choice is materially edited (13.2)
  | 'choiceChangedToAdd'                 // a choice changes from remove to add
  | 'linkedChoiceTargetChanged'          // a linked choice changes its target
  | 'linkedItemChanged'                  // a linked item's allergen declaration or relevant food profile changes (effective through publication, 13.4)
  | 'declarationStatusChanged'           // Contains / May contain / none-declared status or related declaration content changed OUTSIDE the dedicated review action
  | 'reviewBasisDataChanged'             // FUTURE: recipe, ingredient, supplier-label or technical-sheet data used as the review basis changes (no such data exists today; the cause is reserved so adding it later is not a contract change)
```

`review` is optional **only for legacy declarations** (stored before this contract). The reader treats a reviewed status without `review` as legacy: still publishable (nothing is un-published, no data migration), reported by recommended rule `allergenEvidenceMissing` (C6 rule 28, not overridable) until someone reviews again. A declaration reviewed through the new service always carries `review`.

On the item document (arrays only, never map-shaped; `readOnly` in Studio including break-glass; outside the dashboard patch allowlist):

```ts
export type ComplianceTask = {
  _key: string
  taskId: string                         // deterministic: hash(parentId, linkedItemId, linkedFingerprint) → idempotent (13.4)
  kind: 'allergenReview'
  reason: 'linkedItemChanged'
  linkedItemId: string
  choiceKeys: string[]
  createdAt: string                      // ISO UTC, server
  createdBy: 'system'                    // always; the marker that distinguishes it from a manual change (D-16)
  carriedDraft: boolean                  // true = the draft exists solely to carry this task (parent had no draft)
  resolvedAt?: string                    // set by reviewAllergens when sign-off is renewed
}
// catalogueItem.complianceTasks: ComplianceTask[]
```

## 13.2 Reset and no-reset, verbatim (D-16)

**Reset when** (verbatim): *the profile changes to Food or drink; an option-list attachment is added or replaced; a free-text add choice is added or materially edited; a choice changes from remove to add; a linked choice changes its target; a linked item's allergen declaration or relevant food profile changes; Contains / May contain / none-declared status or related declaration content changes outside the dedicated review action; future recipe, ingredient, supplier-label or technical-sheet data used as the review basis changes.*

**Do not reset for** (verbatim): *name; description; price; images; categories; placement; translation-only edits.*

**Other rules** (verbatim): *The review service distinguishes a valid review action from an uncontrolled edit, so reviewing does not invalidate itself. Removing an option or detaching an option list does not by itself require a reset but is audited.*

Definitions this contract adds (not in D-16, needed to implement it):

- **"Materially edited" (free-text add choice):** a change to the choice's default-locale label, its action (`add`/`remove`, covered separately by `choiceChangedToAdd`), or its declaration content outside the review service. Translation-only edits and price changes are not material.
- **"Relevant food profile" (linked item):** the item's `foodInformation` presence and its declaration; captured by the **allergen fingerprint** `allergenFingerprint(item)` = hash of (is food profile, declaration status, sorted `allergens`, sorted `mayContain`). Names, notes in other locales, prices and images are not part of it, so a linked item's non-allergen edits never invalidate dependents.

```ts
export function allergenFingerprint(item: Pick<ItemSnapshot, 'profile' | 'allergenDeclaration'>): string   // pure
export function contentFingerprint(decl: AllergenDeclaration): string                                      // pure; over status + keys + default-locale note
```

## 13.3 The review service vs an uncontrolled edit

There are exactly two ways declaration content can change, and the system tells them apart:

1. **The review service** (`reviewAllergens`, below) — the only writer of declaration content. It writes the content, `review` and `review.contentFingerprint` together, and **never calls `invalidationFor`** for its own write. Reviewing therefore cannot invalidate itself.
2. **Everything else** (generic `patchCatalogueDraft`, import, migration, Studio break-glass). The generic patch cannot write declaration content at all. For writers that bypass it (Studio, import, migration), the **fingerprint check** catches them: if `contentFingerprint(decl) !== decl.review.contentFingerprint` the declaration was edited outside the review action, and `invalidationFor` returns `declarationStatusChanged`. The check runs in `applyInvalidation` on the next write of the item and in the gate (`allergenReview` fails with `values.detail:'editedOutsideReview'`), so an uncontrolled edit can never be published as if it were reviewed.

```ts
export function reviewAllergens(ctx, projectId, input: {
  kind: 'item' | 'optionChoice'; id: string; rev: string; choiceKey?: string
  declaration: { status: 'containsListedAllergens' | 'noneDeclared'; allergens?: AllergenKey[]; mayContain?: AllergenKey[]; confirmed?: true; note?: AllergenNote }
  basis: ReviewBasis; basisNote?: string; mayContainRiskAssessmentConfirmed?: boolean
}, deps): Promise<{ declarationVersion: number }>

/** PURE. The single implementation of the D-16 reset list for every writer except the review service. */
export function invalidationFor(before: ItemSnapshot, after: ItemSnapshot, via: 'edit' | 'studio' | 'import' | 'migration'): AllergenInvalidationCause | null
export function applyInvalidation(decl: AllergenDeclaration, cause: AllergenInvalidationCause, now: Date): AllergenDeclaration   // → { status:'notReviewed', invalidation:{cause, at} }
```

- Capabilities: `catalogue.item.write` + `catalogue.allergen.update` (C8 `item.reviewAllergens` / `item.editAllergenContent`), held by Owner, Site admin and Editor; **never available in support mode** (D-16). `reviewedBy`/`reviewedAt` come from the context and the server clock — a client cannot supply them.
- Refuses `invalid_value` when: `mayContain` is non-empty and `mayContainRiskAssessmentConfirmed !== true`; basis missing; `noneDeclared` without `confirmed`; profile has no `foodInformation`.
- `declarationVersion` = previous + 1 (1 on first review). The previous declaration is **not** kept on the document (history = Sanity revisions within their window, plus the `allergen.reviewed` rows in C12, which carry the keys and basis — the durable change history of brief §20.2).
- At review time the service records `review.linked` for every linked choice the item depends on, using the linked item's **published** `allergenFingerprint` (13.4).
- A successful review sets `resolvedAt` on any open `ComplianceTask` of the item whose linked fingerprint it just recorded.
- **Does not reset** (D-16): removing an option, or detaching an option list. The writer records `allergen.dependency_removed` (C12) and leaves the review as it is. A detached or shortened list reduces what the review covers; it never adds an unreviewed item.
- Never resets for: name, description, price, images, categories, placement, translation-only edits — `invalidationFor` has no branch for them (fixture W-11 is table-driven over both lists).
- `review`, `invalidation`, `declarationVersion`, `complianceTasks` are `readOnly` in Studio, break-glass included.

## 13.4 Linked-item timing (D-16, verbatim, then made precise)

*Linked-item changes — timing* (verbatim): *editing only the linked item's draft does not affect live dependents; dependents are invalidated when the linked declaration **becomes effective through publication**; if linked item and parent are published together, the combined transaction performs the same invalidation and validation before committing; published parents stay online and keep resolving the linked item's current published allergens; a draft/review task is created or updated for every affected parent, marked `notReviewed`, shown clearly in the dashboard; each parent's next publication is blocked until sign-off is renewed; nothing is silently unpublished. If an affected parent has no draft, a draft is created from its published copy solely to carry the invalidation and review task, **identified as a system-created compliance task**, not an unexplained manual change.*

Mechanism, in two layers so that safety never depends on a write succeeding:

- **Authoritative (derived, always correct):** the gate rule `allergenReview` is stale for a parent whenever any `review.linked[i].fingerprint` differs from the linked item's current published `allergenFingerprint` (`values.detail:'staleLinked'`). This needs no stored marker, so a missed or partial write cannot let a stale sign-off be published.
- **Visible (written):** the invalidation writer sets the parent's draft to `notReviewed` (cause `linkedItemChanged`), creates or updates the `ComplianceTask`, and writes `allergen.linked_invalidated` and `compliance.task_created` (C12).

| Situation | Behaviour |
|---|---|
| Only the linked item's **draft** is edited | Nothing happens to any dependent. No task, no reset, no audit row beyond the edit. Live parents are untouched. |
| The linked item is **published** and its allergen fingerprint changed | At that moment, in the **same Sanity transaction** as the publish (up to the shared 100-document operational cap, C6 6.11), every affected parent gets its draft set to `notReviewed` and a `ComplianceTask`. A publish that does not change the fingerprint (name, price, image, translation) invalidates nobody. |
| Linked item and parent are **published together** (`publishTogether` / `publishManyTogether`) | `prepare` evaluates the parent against the **incoming** linked fingerprint **before committing**. If the parent's sign-off predates it, the whole publication is refused with `allergenReview` (`staleLinked`); if the parent was re-reviewed against the new fingerprint, both commit in one transaction and **no task is created** (nothing is stale). Same invalidation rule, same validation, one commit. |
| **Published parents** | Stay online. They keep resolving the linked item's **current published** allergens (the linked choice derives, it stores nothing). Nothing is unpublished, taken offline or scheduled away. |
| Parent **has a draft** | The draft is updated: declaration `notReviewed` (cause `linkedItemChanged`), task added or merged. The editor's other draft changes are preserved. |
| Parent **has no draft** | A draft is created from its published copy **solely** to carry the invalidation and the task (`carriedDraft: true`). It is identified in the dashboard and in Activity as a **system-created compliance task** ("Allergen review needed because a linked item changed"), not as a manual change; it never appears as something the person edited. |
| **Next publication** of an affected parent | Blocked by `allergenReview` until `reviewAllergens` renews the sign-off (which records the new `linked` fingerprints and resolves the task). |
| **Dashboard** | The item shows `notReviewed` with the reason and the linked item's name (resolved at read time, not stored in audit); the item counts in the "Needs allergen review" chip and in "Not yet" (D-21 Ready / Not yet split). |
| Re-exposure of an affected parent (`backOnline`, restore, `setDates`) | The safety subset (C6 6.7.2, D-15) evaluates `allergenReview` on the published copy **using** (a) the derived `staleLinked` check — the published copy's `review.linked[i].fingerprint` against the linked item's current published `allergenFingerprint` — and (b) any open `ComplianceTask` on the item's **draft** (`drafts.<id>`), read by `loadNodeFacts`; either fails the check. This is the only place a task blocks anything other than the parent's next publication. *(Interpretation of D-15/D-16, flagged in the Issues record.)* |
| More dependents than the transaction cap | The publish still proceeds. Layer 1 (derived) blocks each parent's next publication regardless; the remaining drafts/tasks are created by a follow-up job started immediately after the commit (the daily reconciliation is the backstop); until then the dashboard shows the derived `staleLinked` state, so "shown clearly" does not wait a day. Task ids are deterministic, so retries and the reconciliation are idempotent. |

All invalidation rows of one cascade share one `correlation_id`.

## 13.5 How C6 and C12 consume it

- **C6:** `ItemReadinessInput.allergen.declaration` is the stored object above. `allergenDeclarationIssues` gains kinds, only for declarations that **have** a `review` block: `reviewShape` (bad reviewer id / date / basis / `declarationVersion` / fingerprint) → `integrity.declarationShape` at the gate; `mayContainNotAssessed` → required `allergenReview` (`values.detail`), `editedOutsideReview` and `staleLinked` → required `allergenReview` (`values.detail`). Legacy declarations (no `review`) → recommended `allergenEvidenceMissing`. `isPublishableDeclaration` is otherwise unchanged. `allergenChoicesReview` uses the same choice shape.
- **C12:** `allergen.reviewed` is written by `reviewAllergens` after the Sanity commit with exactly the fields of `AllergenReview` that are not personal (basis, keys, declarationVersion, risk-assessment flag); the reviewer is the audit `actor_id`, identical to `review.reviewedBy`. `allergen.invalidated.cause` is `AllergenInvalidationCause` minus `linkedItemChanged`, which is written as `allergen.linked_invalidated` with `compliance.task_created`. `allergen.dependency_removed` records the audited non-reset. A discrepancy between the latest `allergen.reviewed` row and the item's `declarationVersion` is a reconciliation finding.
- **Register / exports (AC-13):** the printable register reads `allergenDeclaration` + `review` of the published copies and cites `declarationVersion` and `reviewedAt`; its `export.snapshot` row (C12) stores the `sourceRevision` hash, so "register matches snapshot" is checkable. Review reminders (brief §20.2) use `reviewedAt`; their schedule is out of scope here.

## 13.6 Retention of allergen evidence (D-20)

*Decided — Tom 2026-11-02, D-20:* **defer the exact duration to the privacy/legal review; do not hard-code ten years.** It must be decided **before the first allergen-review evidence record is created in production**, by jurisdiction, evidence purpose and privacy obligations. **Until then: five years as the platform audit default; longer allergen retention pending legal/privacy approval.**

- This contract defines no retention duration for allergen evidence. `allergen.reviewed`, `allergen.invalidated`, `allergen.linked_invalidated`, `allergen.dependency_removed` and `compliance.task_created` rows follow the C12 default (5 years) until the review sets a longer allergen value.
- The longer value, when approved, is **one reviewed setting** in the purge job's configuration, per evidence class if the review distinguishes jurisdictions — never a literal in code, a constant named for ten years, or text in a contract.
- **Release gate, not runtime code:** the allergen slice (`reviewAllergens` writers on) is not enabled in production until the privacy/legal decision is recorded in the C10 plan. Because the decision therefore precedes the first record, no allergen row can reach its purge date before the decision exists. The item-side `review` block is not purged with audit rows; it lives and dies with the item.

## 13.7 Migration

No data migration: `review`, `contentFingerprint`, `linked` and `complianceTasks` are optional for legacy data (13.1). Reader ships first (C10 plan R1 includes the tolerant `allergens.ts`); writers (`reviewAllergens`, invalidation hooks, compliance tasks) ship with the allergen slice (R2-or-later), after the D-20 decision. Production: 16 items, all `tmz`; how many are food is read in the pre-flight, nothing is rewritten. A legacy parent whose linked choices have no recorded `linked[]` is treated as legacy (recommended `allergenEvidenceMissing`), not stale: staleness needs a recorded fingerprint to differ from.

## 13.8 Fixtures

| Fixture | Input → expected |
|---|---|
| W-01 `review-writes-evidence` | owner reviews food item: contains [milk], basis `recipe` → stored `review{reviewedBy:U, reviewedAt: server now, basis:'recipe', declarationVersion:1, contentFingerprint}`; row `allergen.reviewed` |
| W-02 `may-contain-needs-assessment` | mayContain [fish], no confirmation → `invalid_value`; with confirmation → stored `mayContainRiskAssessment.confirmed:true` |
| W-03 `item-write-only-cannot-edit-declaration` | editor-without-allergen.update (injected) saves a declaration change → forbidden naming `catalogue.allergen.update`; saving the name works |
| W-04 `client-cannot-set-reviewer` | payload with `reviewedBy`/`reviewedAt`/`contentFingerprint` → ignored/refused; stored values come from context |
| W-05 `invalidate-profile-to-food` | product → food → `notReviewed`, `invalidation.cause:'profileChangedToFood'`; live copy untouched |
| W-06 `invalidate-cascade` | linked item published with a changed fingerprint; 5 food parents attach lists with a choice linked to it → 5 resets, 5 `allergen.linked_invalidated`, one `correlation_id` |
| W-07 `name-edit-does-not-invalidate` | food item reviewed, name/description/price edited → declaration unchanged |
| W-08 `legacy-declaration` | reviewed status, no `review` → publishable; recommended `allergenEvidenceMissing`, `overridable:false`; after a new review the finding is gone |
| W-09 `studio-edit-detected` | break-glass edit changes allergens in a draft → fingerprint mismatch → draft reset to `notReviewed` cause `declarationStatusChanged` on the next write; the gate refuses publish (`editedOutsideReview`) even before that write |
| W-10 `version-monotonic` | three reviews → `declarationVersion` 1,2,3; `allergen.reviewed` rows carry the same numbers |
| W-11 `reset-and-no-reset-lists` | table-driven, one case per clause. Resets: profile→Food or drink; list attached; list replaced; free-text add choice added; choice label materially edited; remove→add; linked choice target changed; linked item's declaration or food profile changed (via publication); status/keys changed outside the review action; (reserved) review-basis data changed. Does not reset: name; description; price; images; categories; placement; translation-only edit | each reset case → `notReviewed` with the matching cause; each no-reset case → declaration byte-identical |
| W-12 `review-does-not-invalidate-itself` | `reviewAllergens` changes status and keys | result `reviewed`; no `allergen.invalidated` row; `invalidationFor` not called; fingerprint equals the stored `review.contentFingerprint` |
| W-13 `uncontrolled-edit-vs-review` | same content change made (a) through `reviewAllergens`, (b) through a Studio break-glass patch, (c) through import | (a) reviewed; (b) and (c) `notReviewed`, cause `declarationStatusChanged`, publish refused |
| W-14 `remove-option-no-reset-audited` | remove one option from an attached list; detach a list from a reviewed food item | review unchanged (`reviewed`), one `allergen.dependency_removed` row each (`optionRemoved`, `optionListDetached`) |
| W-15 `linked-draft-edit-no-effect` | edit only the linked item's draft allergens (not published) | 5 live parents unchanged; no task, no reset, no `allergen.linked_invalidated` |
| W-16 `linked-publish-invalidates-dependents` | publish the linked item with a changed fingerprint; 5 parents: 3 have drafts, 2 do not | all 5 drafts `notReviewed` (cause `linkedItemChanged`) with a `ComplianceTask`; 2 drafts created from the published copy with `carriedDraft:true` and `createdBy:'system'`; 5 `allergen.linked_invalidated`, 5 `compliance.task_created` (2 with `createdDraft:true`); the 3 existing drafts keep their other edits |
| W-17 `combined-publication` | linked item + parent published together: (a) parent's sign-off predates the new fingerprint; (b) parent re-reviewed against it | (a) refused before commit with `allergenReview` / `staleLinked`, zero mutations; (b) one transaction commits both, no task created |
| W-18 `nothing-silently-unpublished` | after W-16 | the 5 parents are still `published` and visible; their published copies are byte-identical; they resolve the linked item's **new** published allergens |
| W-19 `next-publication-blocked-until-renewed` | publish an affected parent's draft; then `reviewAllergens` and publish again | first refused (`allergenReview`, `staleLinked`); after the review the task has `resolvedAt`, publish succeeds, `review.linked` holds the new fingerprint |
| W-20 `task-idempotent` | run the invalidation twice (retry) and then the reconciliation | one task and one `allergen.linked_invalidated` per (parent, linked item, fingerprint) |
| W-21 `dependents-beyond-cap` | 130 dependent parents | linked publish succeeds; all 130 block at their own next publication (derived layer); the reconciliation creates the remaining drafts/tasks; no duplicates |
| W-22 `reexpose-with-open-task` | affected published parent (task on the carried draft) is unpublished, then `backOnline` | refused with `allergenReview` while the task is open; allowed after renewal |
| W-23 `retention-not-hardcoded` | grep test over `src/` and the purge config | no ten-year literal or constant (`10 * 365`, `3650`, `TEN_YEARS`) for allergen evidence; purge reads one retention setting; with no allergen-specific setting the default is 5 years |

---

# Issues and decisions record

Rev 3: every item that was "needs decision" or "Provisional — awaiting Tom" is now recorded as **Decided — Tom 2026-11-02, D-n** (authority: `DECISIONS-step2-final-2026-11-02.md`). Each entry keeps what is inconsistent or missing, where, and the resolution reflected in the contracts above. Interpretations made while applying the decisions are listed at the end (I-19 … I-24) for the final consistency review.

**I-1 — K-5 puts categories and tags under "setup", the brief and today's code let editors create them (Decided — Tom 2026-11-02, D-3).** K-5: "manage Catalogue setup (incl. … categories, tags …)" defaulting to owner/admin; brief 8.1 wants inline category creation with parent selection; `ItemEditor`/`ItemWizard` show "+ Add category" to anyone with `catalogue.taxonomy.write` (editors today); and `taxonomyWritePermission(module)` is a shared convention. *Resolution used:* keep `catalogue.taxonomy.write` (Owner, Site admin, Editor) for create / rename / translate / sibling-reorder / delete-unused; move re-parenting, deleting-in-use and **availability rules** to `catalogue.setup.manage`. If you want editors out of categories entirely, remove the `editor` default from `taxonomy.write` — one-line change, but editors then cannot add a category while creating an item. *Decided:* the split used is the decided one, written out in C8 8.3 (including the precise definition of an unused category); inline creation calls the same Catalogue taxonomy service as Setup, and K-4 and ADR-042 N2a are to be amended.

**I-2 — "Review allergen declarations" as a separate capability cannot be granted separately under ADR-028.** ADR-028 §3: extras only add, and only platform grantable permissions can be extras; module permissions come solely from role defaults. So `catalogue.allergen.update` defaulting to Editor means every Editor can review; "kitchen reviews, website editor cannot" is not expressible. *Resolution:* add the id now (support-mode and audit benefits, no behaviour change); if the separation matters, amend ADR-028 so module permissions can be grantable extras. *Decided — Tom 2026-11-02, D-16:* `catalogue.allergen.update` for Owner, Site admin and Editor, never in support mode; the ADR-028 amendment stays outside this redesign.

**I-3 — Support mode would let Abluo staff attest allergens.** `isWritePermission` treats every non-`.read` id as a write and only people/modules/billing are `SUPPORT_NEVER_WRITES`. With approved edit access, support could mark a dish "none of the 14 allergens". 20.3 says the operator is responsible. *Resolution:* add `catalogue.allergen.update` to `SUPPORT_NEVER_WRITES`. *Decided — Tom 2026-11-02, D-16 and D-21:* both `catalogue.allergen.update` and `catalogue.export.use` are in `SUPPORT_NEVER_WRITES` (export is unavailable in support mode; listed explicitly because `isWritePermission` alone refuses it only in view mode, not in an approved-edit session).

**I-4 — K-7 "restricted to super administrators" is not enforceable at the Sanity boundary.** The Sanity Growth plan has no per-document restriction; Studio's `readOnly`/actions only constrain the Studio UI. Anyone with a Sanity editor seat, a write token, Vision, the CLI or an MCP connector can write Catalogue documents directly, including published ones, without any gate. *Resolution:* C9 locks the Studio UI, makes publish go through the one gate, and adds a **detective** webhook + reconciliation that flags any Catalogue write not made by the dashboard or the operator route. State this limit in the ADR so nobody reads "read-only" as a security boundary; keep Sanity seats and write tokens minimal (verify which Growth roles exist). *Decided — Tom 2026-11-02, D-18:* accepted as a UI control, not a security boundary; restricted seats and tokens, detective webhook, daily reconciliation, audit events for out-of-gate writes and explicit break-glass are specified in C9 9.5a. Tom is correcting ADR-032 D14 himself to "designed/documented, not implemented".

**I-5 — (rewritten, Rev 2) Catalogue scalar configuration stays in `project.moduleInstallations[catalogue].config`; a read-only Modules pane is not sufficient.** The generic `project` document form can edit the array. *Resolution:* `readOnly` on the Catalogue installation's `config` object (C9 9.3), shipped in R2 with Setup. The earlier request to move `serviceChannels`, `categories`, `dietaryTags` and `navLabel` out of the array is **withdrawn** (REVIEW X-7: scalar settings stay in module config; structured data lives in the per-project documents `catalogue-taxonomy`, `catalogue-packs`, `catalogue-standards`; one editing surface, Catalogue → Setup). Config emergencies use a server-side setup service call, not Studio. *Decided — Tom 2026-11-02, D-1.*

**I-6 — Studio changes to Catalogue are not audited today, and ADR-032 D14 is not implemented for them.** `ACTIVITY_WEBHOOK_FILTER` omits the Catalogue types, so a Studio publish/unpublish of an item produces no Activity row (and the daily reconciliation does not cover them); `sanity.config.ts` has no lifecycle `document.actions` branch (D14 says there is one). Today a Studio user can hard-Delete a published item. *Resolution:* C9 removes the built-in actions; C12 adds the Catalogue types to the lifecycle webhook/reconciliation; fix D14's status in ADR-032 (documented, not built; Tom is editing it himself, D-18).

**I-7 — The server gate does not validate document shape; the dashboard's patch path does.** `cataloguePrepare` checks name, allergens, slugs, dependencies, but relies on `cleanCatalogueSet` having produced a well-formed document (refs same project, price shape, no stored currency, known keys). A Studio break-glass draft skips that. *Resolution:* the `integrity` rule family evaluated at the gate (C6 6.7.3) — also strictly better for the dashboard (defence in depth).

**I-8 — Brief §28 lists "category rule changes", but moves and deletions change availability too.** Under K-3 rule 4/5, re-parenting a primary category changes the ancestor-rule path of every item under it. *Resolution:* `category.restructured` event and `setup.manage` for re-parenting (C8); impact counts shown before confirm (brief 11.4 extended from "inherited rule" to "move").

**I-9 — Brief 17.6 counts will mislead if drafts are included naively.** "Needs allergen review" counts every new food draft (they start `notReviewed`), so a manager importing 80 dishes sees 80 "problems". Likewise `noPrice` counted offers==0 in three places (`itemGaps`, `CATALOGUE_GLANCE_QUERY`, Home) that K-3 rule 10 redefines. *Resolution:* chips count non-archived items on the version that would be published next (C6 6.10) and Home reuses the same function; add a "Ready to publish / Not yet" split in the Overview so drafts-in-progress are visible as a group. *Decided — Tom 2026-11-02, D-21:* counts include drafts and distinguish Ready / Not yet; Home does not wait for an editor-marked "ready for review" state (that would be the future approval capability of K-5).

**I-10 — Retention of allergen evidence.** ADR-032 A5 retention is provisional (5 y / 12 mo, pending privacy review). Allergen review history is food-safety evidence (brief 20.2/20.3) and printable registers (AC-13) may need to be reconstructed later. *Decided — Tom 2026-11-02, D-20:* defer the exact duration to the privacy/legal review; **do not hard-code ten years**. It must be decided before the first allergen-review evidence record is created in production, by jurisdiction, evidence purpose and privacy obligations. Until then: five years as the platform audit default; longer allergen retention pending legal/privacy approval (C12 12.5, C13 13.6; the allergen slice's production enablement is a release gate on that decision).

**I-11 — "Reset to `notReviewed` when relevant data changes" (brief 20.2) has no definition of "relevant".** There is no ingredient field; item allergens are declared directly. *Resolution used (C12 `allergen.invalidated.cause`):* profile changed *to* food; an option list attached; a free-text add choice added or edited; a linked item's declaration changed; the declaration itself edited after review. **Not** name/description/price edits. *Decided — Tom 2026-11-02, D-16:* the list is Tom's, broader than this first proposal; C13 13.2 holds the verbatim reset and no-reset lists, the review-service rule and the linked-item timing. Note the live (published) copy stays valid until the next publish; invalidation applies to the draft, so the website is never silently changed by an invalidation.

**I-12 — What does "blocked" mean in a non-website context?** The brief says a Required rule "blocks publication/delivery/export in the scoped context" and shows "Delivery marketplace Blocked (image missing)" next to "Own website Ready". Nothing says whether a channel-blocked item is hidden from that channel on the site. *Resolution used:* readiness never changes availability or visibility (K-3 rule 10); non-website contexts gate only the actions tied to them (export, PDF, feed). *Decided — Tom 2026-11-02, D-9: confirmed; a requirement blocks only its scoped action.* The opposite reading ("hide from the Takeaway view when its standard fails") is plausible and would be a second, readiness-driven availability mechanism that K-3 forbids.

**I-13 — Override semantics are underspecified.** A *recommended* failure blocks nothing, so "override" only silences it (and removes it from counts). The brief does not say who may, whether it expires, or where it is recorded. *Resolution:* C6 6.9 — Owner/Site admin (`readiness.update`), stored on the item, expires on meaning (rule passes, finding changes, standard version changes), never on unrelated edits, audited. *Decided — Tom 2026-11-02, D-17:* only Owner and Site admin; who, when and why are recorded (the reason is now required); it expires when the underlying meaning changes; required findings are never overridable. Editors do not hold it.

**I-14 — All-or-nothing bulk publish needs a lifecycle primitive that does not exist.** `publishTogether` has a single root. *Resolution:* `publishManyTogether` (one transaction, validate-all-first), capped (100-document operational cap plus the real payload limit). Without it, "all-or-nothing" can only be best-effort and must not be offered. *Decided — Tom 2026-11-02, D-19:* `publishManyTogether` in the bulk slice — validate all documents and dependencies first; one transaction or nothing; respect the real payload limit; 100-document operational cap; calculate payload before attempting; refuse clearly when too large; larger needs use reviewed batches in the UI, never described as atomic (C6 6.11).

**I-15 — Locale growth silently creates warnings.** `translationMissing` per site locale means adding a language (project_dynamic_locales audit) instantly produces N warnings per item. *Resolution:* the rule applies only to the site's public locales (existing locale configuration — REVIEW X-15, not C11) and never to a locale added in the last session without an explicit "start translating" action; otherwise counts jump overnight with no one having done anything. *Decided — Tom 2026-11-02, D-21.*

**I-16 — Price rule level (Decided — Tom 2026-11-02, D-8).** K-3 rule 10 says "missing price readiness issue" without a level. Recommended: website = recommended; channel/export-with-price/print-with-price/marketplace = required; restaurant packs *suggest* a tenant rule making it required on the website for food categories (never silently applied). If you prefer required on the website for every tenant, services and books without prices would be unpublishable.

**I-17 — Smaller inconsistencies noticed.** (a) `catalogue.item.read` still lists retired `viewer`; harmless but stale vs ADR-028. (b) `registry.ts` `serviceChannels` description says "an unscoped price applies everywhere" — contradicts K-3; replaced by C2. (c) Brief 13.2 text is corrected by K-3 but remains in the brief; add a "superseded" marker next to it. (d) `CatalogueErrorCode` has no code for "not ready" beyond individual ones; `not_ready` added. (e) `previewCataloguePublish.blocked[].code` is a single opaque code per document; the editor needs full finding lists for the "Ready to publish" panel — `findings` added. (f) The migration for K-2 audit mandates "actor = migration" and an old value, which `content_audit_log` cannot hold; satisfied by the new table. (g) `list-model.batchStep` treats a never-published draft as publishable via `{via:'publish', mode:'now'}` without any readiness; bulk publish today lets the server fail row by row with a bare reason — C6 6.11 replaces that with preview-first.

**I-18 — (Rev 2) The safety subset on re-exposure goes one step beyond the review's recommendation.** REVIEW C-15 recommended that `backOnline`, restore and `setDates` never re-run the gate ("versions, not copies"). C6 6.7.2 keeps the rule but retains a narrow safety subset on those three paths, because an allergen declaration on a copy returning to the website is legal exposure rather than a standards matter, and legacy/Studio-written copies may never have passed the gate. *Decided — Tom 2026-11-02, D-15:* yes, including the safety subset — allergen review; option-choice allergen review; valid declaration shape; dangling or unresolved references; ordinary quality requirements (image, description, placement) are not re-run on re-exposure. Cost: a small `LifecycleDescriptor.reexposeCheck` extension.

### Decisions record (all decided — Tom 2026-11-02)

| Issue / section | Decision | Applied as |
|---|---|---|
| I-1, C8 8.2/8.3/8.3a | D-3 | `taxonomy.write`: create inline, rename/translate, reorder siblings, delete an unused leaf, manage tags; `setup.manage`: move between parents, reassign on delete, delete in use, channel rules incl. schedules, apply packs; precise "unused"; inline creation through the same Catalogue taxonomy service; Setup → Categories & Tags visible with either permission; K-4 and ADR-042 N2a to amend |
| I-2, I-3, I-11, C8, C13 | D-16 | separate `allergen.update` (Owner, Site admin, Editor; never in support mode); reset and no-reset lists, review service vs uncontrolled edit, remove/detach audited without reset, linked-item timing (C13) |
| I-5, 6.8, 6.12, C9 | D-1 | scalar settings in module config; standards in `catalogue-standards.<slug>` |
| I-9 | D-21 | chip counts include drafts, "Ready / Not yet" split |
| I-10, 12.5, C13 13.6 | D-20 | 5 y platform default; longer allergen retention pending legal/privacy review; no hard-coded ten years; decided before the first production evidence record |
| I-12, 6.4 | D-9 | a requirement blocks only its scoped action |
| I-13, 6.9 | D-17 | Owner/Site admin only; who, when, why; expires on meaning; required findings never overridable |
| I-14, 6.11 | D-19 | `publishManyTogether`; payload estimated first; 100-document operational cap; reviewed batches never atomic |
| I-15 | D-21 | public locales only, not for a just-added locale |
| I-16, 6.5 | D-8 | website recommended; delivery, priced export, PDF, marketplace required; packs may propose website-required for food |
| 6.7.2, I-18 | D-15 | versions-not-copies; re-exposure safety subset only |
| 6.13 | D-15/E-1 | activation per project by migration state |
| 6.5 row 30, 6.5 "Time-based availability", fixtures R-41 … R-43 | D-6 | readiness ignores the clock; only invalid schedules are findings; price rules use `everAvailable` |
| C9 9.5a, I-4, I-6 | D-18 | UI control not a security boundary; restricted seats/tokens; detective webhook; daily reconciliation; out-of-gate audit events; explicit break-glass; ADR-032 D14 corrected by Tom |
| 8.2 export.use, 8.7 | D-21 | export unavailable in support mode (`SUPPORT_NEVER_WRITES`) |

### Interpretations made in Rev 3 (for the final consistency review)

**I-19 — The "real payload limit" for `publishManyTogether`.** *Resolved (Rev 4, C-13):* one named constant `SANITY_MUTATION_MAX_BYTES = 4_000_000` with a cited source and a 20 % margin; the 100-document cap stays the operational ceiling.

**I-20 — Compliance task storage is invented here.** D-16 requires a "system-created compliance task" on a draft but no contract defines a field. C13 13.1 adds `catalogueItem.complianceTasks: ComplianceTask[]` (array, `readOnly` in Studio, outside the patch allowlist, `createdBy:'system'`, `carriedDraft`). C1/C2–C5 need no change, but the item schema owner (C3) should list the field.

**I-21 — An open compliance task blocks re-exposure.** C13 13.4 treats an open `ComplianceTask` as an outstanding allergen review inside the D-15 safety subset, so an affected parent that was taken offline cannot come back online with a stale sign-off. D-15/D-16 do not say this explicitly; it is the safe reading and costs nothing for parents that stay online. Delete one row of 13.4 and fixture W-22 to undo it.

**I-22 — Two derived mechanisms make D-16 enforceable.** C13 adds `allergenFingerprint` (linked-item staleness, so safety does not depend on a write succeeding) and `contentFingerprint` (how the review service tells a valid review from an uncontrolled edit). D-16 requires the behaviour; the fingerprints are this contract's means. "Materially edited" for a free-text choice is defined in 13.2 (default-locale label, action, declaration content; not translations or price).

**I-23 — `export.use` is added to `SUPPORT_NEVER_WRITES`.** `isWritePermission` alone refuses export only in support *view* mode; an approved-edit session would still pass. D-21 says export is unavailable in support mode, so the id is listed explicitly beside `allergen.update` (C8 8.2, 8.8 step 4, fixture P-18).

**I-24 — Smaller naming and scope calls.** (a) `allergen.dependency_removed` is a new C12 kind, needed so that "audited" in D-16 has a row to point to. (b) The Rev 2 kinds `readiness.overridden` / `readiness.override_cleared` are renamed `readiness.override_recorded` / `readiness.override_expired` before any row exists; the kind regex forces `compliance.task_created` rather than `compliance_task.created`. (c) The D-21 rename of the option-item picker result from `offered` to `hasPrice` ("This item needs at least one price before it can be used as a linked choice.") is owned by C5-5 (C2–C5 file); nothing here reads `offered`. (d) C6 row 30 maps C5a schedule *errors* only; `availability.scheduleRedundant` stays editor-only via an explicit allow-list in R-33. (e) All tag operations sit under `taxonomy.write` (D-3 "manage tags"); tags have no availability or structure to protect.

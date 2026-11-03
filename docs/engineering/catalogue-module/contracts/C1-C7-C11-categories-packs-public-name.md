# Catalogue redesign — step-2 contracts C1, C7, C11

**Status:** Accepted — Tom 2026-11-02 (final consistency review applied; `DECISIONS-step2-final-2026-11-02.md`, `REVIEW-step3-final-consistency.md`). Design only; nothing implemented, no git or data touched.
**Date:** 2026-11-02 · **Rev 5** (2026-11-03)

> **Rev 5 changelog** (Tom's decision D-22, 2026-11-03). New **C1.12 Profile applicability**: optional `useFor` (item profiles) on root categories (inherited by descendants), Catalogue tags and option lists; one pure compatibility rule enforced by the item writer, the publish gate, readiness, Studio validation and (when they exist) bulk edit and import; pickers filter; Setup shows profile chips, a profile filter and a "Use for" editor; packs set the values; tmz is fixed in Setup by Tom (RUNBOOK §13). C7.2/C7.3 gain the pack fields and two codes.

> **Rev 4 changelog** (final consistency review, section C/D items for this file; no decision changed).
> - **C-5 / D(b)** Pizzeria delivery is evening-only consistently (text, rule on defaults, fixtures); `PackSelection.channelRules: 'skip'` also skips channel default schedules (`defaultAvailabilityWithoutSchedule`), so the schedule is declinable in the preview; new fixtures. **C-6** `deletionBlockers`/`deletionRoute` is THE "unused" implementation; C8 consumes it. **C-21** `term.archive`/`term.unarchive` operation ids stated (category = `setup.manage`, tag = `taxonomy.write`). **C-4** every taxonomy mutation carries `abluo-setup-` transaction ids (packs keep `abluo-pack-`). **C-12** legacy `categories` timing aligned with C10 (kept by D1, unset by R2 writers, all by R3). **C-13** `PACK_MAX_TX_BYTES = min(1_000_000, SANITY_MUTATION_MAX_BYTES)`. **C-14** C11.2 "Where" list gains `defaultSchedule` and `catalogueMigrations`. **C-16** audit kind is `public_name.migrated` (no prefix). **C-27** stale "Issue n" wording replaced. **C-28** `image-shape/tmz-fallback` fixture owned here. **C-30** `assertModuleAction` per `capabilitiesFor(op)`.
>
> **Rev 3 changelog** (Tom's final decisions; every "Provisional" marker is replaced by "Decided — Tom 2026-11-02, D-n").
> - **D-1 / D-2** storage confirmed (module config for short settings incl. `setupCompletedAt`/`setupSource`; one `catalogueTaxonomy` document; one `cataloguePackHistory` document; standards document owned by C6). New **C1.7a concurrent-edit contract**: `ifRevisionId` on every write, idempotent operations refetch + re-plan + retry (max 3), user operations surface `category_conflict`, tree operations are one patch, arrays only (attribute-path budget test).
> - **D-3** operations split exactly as decided; inline creation calls the same `CatalogueTaxonomyService`, lets the user pick the parent and shows the complete path (`previewPath`). **"Unused" is Tom's precise definition**; `deletionBlockers` now takes references from a **registered reference-source interface** (`CategoryReferenceSource`) so later slices (automatic listings, standards, availability policies) register their sources; new blockers `referenced_by_availability_policy` and `referenced_by_other`; editors delete only unreferenced leaves, otherwise Setup + counted, previewed cleanup (`planCategoryDeletion`). Category archive moves to Setup (not in Tom's editor list).
> - **D-6** category rules are complete rules: `ChannelAvailabilityRule` = baseline state + optional weekly overrides (C5a), stored as `catalogueChannelRule {…, state, schedule?}`; `categoryChannelRule` returns the complete rule or `'inherit'`; packs declare category (and channel-default) schedules: Café breakfast 07:00–11:00 and overnight cocktails, Traditional lunch specials, Fine dining tasting menus 19:00–23:00, Pizzeria evening delivery.
> - **D-12** both public uses approved (landing-title fallback; `llms.txt` heading per language block; existing titles still win). **D-13** all four parts incl. the `presetId` image-shape replacement and the install-time segment. **D-14** `setupCompletedAt` + `setupSource`; editor reads completion only. **D-15** first *existing* legacy category becomes primary; primary required on publishing a new version; never unpublish; category checks are not part of the re-exposure safety subset. **D-21** pack keys `dine-in`/`takeaway`, limits 300 categories / 200 tags confirmed.
> - Issues section becomes a **decisions record** with a short list of residual notes for the final consistency review.

> **Rev 2 changelog** (applies `REVIEW-step2-cross-contract.md` E-2 … E-8 and the section A/B/C items naming this file). Where a fix depended on a REVIEW section D decision, Rev 3 records Tom's decision.
> - **E-2 / X-1** category rules are stored as `catalogueChannelRule { _key: <channelKey>, _type, channel, state }`; `ChannelRule` is gone, the value type is C2's `AvailabilityRuleValue`.
> - **E-3 / X-3** C1 adds `primaryPath(tree, key): PrimaryPath`; C5 must not walk parents.
> - **E-4 / X-13** C1.9 and the preset/public-name orders are replaced by a reference to the single ordered plan **E-1 held by C10**; this file keeps only its data-step definitions **D1** (taxonomy + item assignment), **D3** (`appliedPreset` → pack history) and **D4** (public name) with their equivalence checks. Defect fixed: item `categories` is no longer unset while writers still write it (D1 is additive; R2 writers come first).
> - **A5 / C-8** complete reader list of Catalogue `taxonomyTerm` added (C1.10); **E-5 / X-10** `dietaryTags` declared out of C1 scope.
> - **E-6 / A6 / C-9** F7 and Issue 13 corrected: the Modules pane patches changed keys with `ifRevisionId` (`module-save.ts:1-15`); history-document rationale changed.
> - **E-7 / X-11 / C-10 / C-11 / C-12** pack channel suggestions carry a required `defaultAvailability` (C2's `ChannelAvailabilityState`) and every launch pack declares explicit channel defaults; C7.5 guarded set includes the project `_rev`; sections go to the draft of an existing collection; creates use the shared Catalogue create builder; `ruleChangeImpact` → `availabilityImpact`.
> - **E-8 / X-7 / C-13** `publicName`, `setupCompletedAt`, `formatTemplates` live in **module config**; the C2-decides conditional is removed; C11 audit payload aligned with C12.
> - **X-8 / X-9** term-operation permission check lives in `CatalogueTaxonomyService` (Decided — Tom 2026-11-02, D-3). **X-16** new document types listed for C9. **C-14** extra equivalence fixture.
**Authority:** `docs/architecture/ADR-033-amendment-K-catalogue-redesign.md` (K-2, K-4, K-6, K-9, K-11), then the brief (`catalogue-redesign-brief-2026-11-02.md` §6–§10, §25, §27, §29 AC-04/05), then ADR-033 Amendments D-1 and J. Where this file disagrees with K or the brief it says so in the **Decisions record** (end of file).
**Sibling contracts (written elsewhere, referenced by name only):** C2 channel model (`Channel`, `ChannelKey`, `AvailabilityRuleValue`, `ChannelAvailabilityState`; channel `active`, `defaultAvailability`), C3 format model (`FormatTemplate`, formats embedded on items with stable `_key`), C4 price model, C5 availability resolver (owns precedence and `availabilityImpact`; consumes C1's `categoryChannelRule` and `primaryPath`), C6 readiness engine, C8 permissions, C9 Studio posture, C10 migration, C12 audit events.

Code references are to the repo as read on 2026-11-02. Production facts come from read-only Sanity queries (project 3n7t84j3, dataset production).

---

## 0. Facts verified before designing (they change the answers)

| # | Fact | Where seen |
|---|---|---|
| F1 | **The website never reads `navLabel`.** It is dashboard-only: sidebar (`(client)/[tenant]/layout.tsx:90-94`), Home glance (`home/page.tsx:276-319`), Catalogue page title (`catalogue/page.tsx:53`), Categories & Tags tab label (`taxonomy/page.tsx:50-51`). `llms.txt/route.ts:216` states it "never reaches a machine-readable surface". | grep `navLabel` over `src` |
| F2 | Public strings today: landing `<title>` = `seoTitle ?? (heroTitle ? "heroTitle — siteName") ?? siteName` (`CatalogueRoute.tsx:95`); collection/item `<title>` = `"{name} — {siteName}"` (`:121`); **no breadcrumbs exist** anywhere in catalogue (`JsonLd.tsx:53` only says "a BreadcrumbList will need it"); JSON-LD names are collection/section/item names only (`structured.ts`); the "all items" listing is an unnamed synthetic collection (`website.ts:205`); the only visitor-or-crawler-visible word "Catalogue" is the fixed heading `## Catalogue` in `llms.txt`. | `CatalogueRoute.tsx`, `structured.ts`, `website.ts`, `llms.txt/route.ts:225` |
| F3 | Production has one Catalogue project, `tmz`: `navLabel = {en:"Books", it:"Libri", de:"Bücher"}`, `publicSegment = books`, `appliedPreset = {bookshop, v1, 2026-10-14}`. Its landing page `tmz-catalogue-page` has `heroTitle = "Between the Lines"` and `seoTitle = "Between the Lines — books"` (en/it/de). So tmz's website shows **"Between the Lines"**, never "Books". | Sanity query |
| F4 | tmz already has `taxonomyTerm` records: 3 categories (`technology` 1000, `design` 2000, `literature` 3000) and 7 tags (`science_fiction`, `fantasy`, `humour`, `satire`, `illustrated_boos` (sic), `inspirational`, `memoir`). The legacy `config.categories` list still holds only `design` and `technology` (stale: `literature` is missing). Under the J-8 dual-read rule the config list is therefore already ignored for tmz. | Sanity query, `vocabulary.ts` |
| F5 | Items store plain key arrays: `categories: string[]` (insertion order preserved by `stringSet`, `dashboard-patch.ts:204`) and `tags: string[]`. 16 `catalogueItem` documents (13 logical items; drafts and published copies counted separately). All keys used exist as term records. One draft (`c2c4fa97…`) holds two categories `[technology, literature]`; two drafts hold none; all published items hold exactly one. | Sanity query |
| F6 | `taxonomyTerm` is flat: `order` is global per module+kind, `reorderTerms` rewrites a flat sequence, `buildUsageQuery` matches `$key in field` (array only), the generic manager lists by `manageableTaxonomyModules`. `MAX_TERMS_PER_KIND = 200`, `MAX_LABEL_LENGTH = 80`, `ORDER_STEP = 1000`, keys `^[a-z0-9]+(?:[_-][a-z0-9]+)*$` max 48. | `src/lib/taxonomy/*` |
| F7 | `appliedPreset` is one `{id, version, appliedAt}` object on the installation (`config-schema.ts:333`), written by the Modules pane install flow (`ModuleList.tsx:656`), guarded by `applied-preset-guard.test.ts` (allow-list of 9 files, two of them narrowed exceptions reading it as a fallback for items without a profile). The Modules pane patches **changed keys only**, addressed by `_key`, and commits with `ifRevisionId` (`module-save.ts:1-15`; `appliedPreset` is kept via `TOP_LEVEL`) — the Rev 1 claim that it rewrote the whole entry was wrong. | code |
| F8 | Presets today: `restaurant` v2 (`publicSegment: menu`, channels `dine-in`/`takeaway`, profile `foodOrDrink`) and `bookshop` v2 (`books`, profile `product`). The brief says Bookshop's default profile should be **Book**. | `registry.ts:1356-1380` |

F1 and F3 are the reason C11 is not a plain rename (see C11 §1 and Issue 1).

---

# C1 — Category and tag model

## C1.1 Purpose

Define how Catalogue categories (hierarchical, ordered, with an operational availability role) and Catalogue tags (flat descriptors) are stored, validated, queried and edited, so that:

- they are edited **only** in Catalogue → Setup (K-4);
- the tree has exactly one implementation of traversal, ancestry, cycle refusal and path rendering (K-9 "one implementation per concept");
- Amendment J's guarantees still hold: deterministic ids, immutable keys, labels per locale, `projectSlug` scoping, unknown key resolves to nothing.

## C1.2 Decision: Catalogue-owned type, not `taxonomyTerm`

**Decision.** Categories **and** tags for the Catalogue move to a **Catalogue-owned vocabulary document**, one per project: `catalogueTaxonomy`, `_id = catalogue-taxonomy.<projectSlug>`, `liveEdit`, holding `categories[]` and `tags[]` as keyed arrays. The Catalogue stops declaring `taxonomies` in its manifest; the generic `taxonomyTerm` machinery remains for Posts, News, Events, Documents and others, untouched.

**Why not extend `taxonomyTerm` (adding `parentKey` + `channelRules`):**

1. *The generic service cannot be made tree-safe cheaply.* `order` is global per kind, `reorderTerms` rewrites a flat sequence, delete checks one scalar `usedBy` array, and the manager UI is a flat list. Each would need a Catalogue special case — which is a second implementation of the same concept hidden inside the first.
2. *K-4 needs a hard wall, not a flag.* "A test enforces that no dashboard surface other than Setup writes Catalogue terms" is trivial if Catalogue vocabulary is a different type that the taxonomy service refuses (`kind_not_declared`) and the generic manager cannot list. With `taxonomyTerm` the wall is a filter that every future change to the manager must remember.
3. *Operational data does not belong in a labelling record.* Category availability rules (C5 input) change what visitors can order-ish; they need typed validation (channel exists, value in tri-state) and impact preview. `taxonomyTerm` is deliberately "label + order + colour".
4. *Cycle and sibling-order integrity need atomic multi-node writes.* With one document per node, "move A under B" and "move B under A" validated concurrently against their own snapshots can each succeed and together form a cycle; closing that needs a revision guard on every ancestor of the target (no-op patches on N documents). With **one document per project** every structural write is a single patch guarded by one `ifRevisionId`, so the tree can never be committed in a state the validator did not see. A pack (C7) inserts its whole category tree in one patch — atomic with no chunking for the part that matters most.

**Why one document per project rather than one document per category (the brief's `catalogueCategory` in §25):**
the brief marks §25 as concepts, not syntax. One-document-per-node is the only thing J-3 had that this gives up (see decisions record, D-2); everything J listed as an *integrity guarantee* is kept (C1.4). Size is not a concern: 300 categories × ~0.6 KB ≈ 180 KB, far under Sanity's document limit; reads become one fetch instead of N.

**Why tags move too (rather than staying `taxonomyTerm` kind `tag`):** K-4 says Catalogue tags are Setup-only as well; leaving them in `taxonomyTerm` would keep the generic service, its permission (`catalogue.taxonomy.write`) and a dual manifest declaration alive for seven records. Tags are flat, so moving them is mechanical (C1.9). Cost: a second migration step; accepted.

**Reused, not rewritten:** `deriveTermKey`, `labelIssues`, `keyIssue`, `nextOrder`, `ORDER_STEP`, `translationCoverage`, `isValidTermKey`, `SLUG_PART_PATTERN` from `src/lib/taxonomy/*` (pure helpers). New code lives in `src/lib/modules/catalogue/taxonomy/`.

## C1.3 Types

```ts
// ── identity ────────────────────────────────────────────────────────────────
export type CategoryKey = string          // isValidTermKey(); immutable once created
export type TagKey = string               // same pattern; separate namespace from categories
import type { ChannelKey, AvailabilityRuleValue, ChannelAvailabilityState, ChannelAvailabilityRule, ScheduledOverride, Weekday } from './commerce-types'   // C2/C5a own these names
export type Localized = Record<string, string>   // locale -> text; default locale required, others optional

// ── tri-state (K-3 rule 4): AvailabilityRuleValue = 'inherit' | 'available' | 'unavailable' (C2) ──
/**
 * D-6 (Rev 3): a category rule is a COMPLETE availability rule — baseline state + optional weekly overrides (C5a) — never a bare tri-state.
 * Absent channel == inherit. Stored as catalogueChannelRule rows (C1.4); 'inherit' is never stored.
 * ChannelAvailabilityRule / ScheduledOverride / Weekday are owned by C2-C5a and imported, never redefined here.
 */
export type ChannelRules = Partial<Record<ChannelKey, ChannelAvailabilityRule>>

/** Result of primaryPath (X-3). C1 owns it; C5 imports it and walks nothing itself. */
export type PrimaryPath =
  | { kind: 'path'; keys: readonly CategoryKey[] }                                  // root … primary, all nodes resolved
  | { kind: 'none' }                                                                  // no primary category (drafts may lack one)
  | { kind: 'broken'; reason: 'missingCategory' | 'cycle' | 'orphan'; keys: readonly CategoryKey[] }  // primary unknown, or tree.issues touch the path; keys = the resolvable part

// ── nodes ───────────────────────────────────────────────────────────────────
export type CategoryNode = {
  key: CategoryKey
  label: Localized
  parentKey: CategoryKey | null             // exactly one parent or root
  order: number                              // among siblings only (same parentKey); gaps of ORDER_STEP
  channelRules: ChannelRules                 // missing channel == inherit; present == the complete rule for that channel (replace, never merge — D-6.1)
  defaultOptionListIds: string[]             // brief §25; defaults for NEW items only, attachment explicit afterwards
  archivedAt: string | null                  // ISO; retires from new assignment, nothing else changes
}
export type TagNode = {
  key: TagKey
  label: Localized
  order: number
  archivedAt: string | null
}

// ── tree (derived, never stored) ────────────────────────────────────────────
export type TreeIssueCode = 'duplicate-key' | 'orphan' | 'cycle' | 'depth-exceeded'
export type TreeIssue = { code: TreeIssueCode; key: CategoryKey; detail?: string }

export type CategoryTree = {
  readonly nodes: ReadonlyMap<CategoryKey, CategoryNode>
  readonly roots: readonly CategoryKey[]                              // sibling order
  readonly childrenOf: ReadonlyMap<CategoryKey, readonly CategoryKey[]> // sibling order; every key present (maybe [])
  readonly parentOf: ReadonlyMap<CategoryKey, CategoryKey | null>
  readonly depthOf: ReadonlyMap<CategoryKey, number>                  // roots are 0
  readonly issues: readonly TreeIssue[]                               // corrupt-data findings; [] for valid data
}

// ── item assignment (stored on catalogueItem) ───────────────────────────────
export type CategoryAssignment = {
  primary: CategoryKey | null
  additional: readonly CategoryKey[]        // disjoint from primary, no duplicates, <= MAX_ADDITIONAL_CATEGORIES
}

// ── paths ───────────────────────────────────────────────────────────────────
export type CategoryPath = {
  keys: readonly CategoryKey[]               // root first, node last
  segments: readonly string[]                // label per key in the requested locale (with fallback)
  text: string                               // segments.join(' › ')
  /** index into segments that used a fallback locale or the key itself */
  fallbackAt: readonly number[]
  /** per segment: locales (of the project's enabled set) that have no label */
  missingLocales: readonly (readonly string[])[]
  complete: boolean                          // fallbackAt.length === 0
}

// ── delete: Tom's definition of "unused" (D-3, verbatim in C1.7) ───────────────────────────────
export type CategoryRef = { id: string; type: string; name: string }

/**
 * A reference source answers "what stored Catalogue data points at this category key, other than the category node itself?".
 * Sources are REGISTERED (registry in taxonomy/reference-sources.ts); later slices (automatic listings, publication standards,
 * availability policies, …) add theirs without touching deletionBlockers. Server-side only; always project-scoped; draft-including.
 */
export type CategoryReferenceKind =
  | 'item_primary' | 'item_additional' | 'automatic_listing' | 'publication_standard' | 'availability_policy' | 'other'
export type CategoryReferenceSource = {
  id: string                                  // stable, kebab-case: 'items', 'automatic-listings', 'publication-standards', 'availability-policies'
  kind: CategoryReferenceKind
  /** Document type + field(s) that store a category key; used by the registry-completeness test. */
  stores: readonly { type: string; field: string }[]
  /** References to `key` (draft + published copies of one document count once; archived documents count). Never counts the category node itself. */
  find(projectSlug: string, key: CategoryKey): Promise<CategoryReferenceHit>
  /** Optional: how a counted, previewed cleanup works for this source. Absent ⇒ the source is a hard blocker the person must resolve by editing the referring documents. */
  cleanup?: {
    preview(projectSlug: string, key: CategoryKey, to: CategoryKey | null): Promise<{ affected: number; sample: readonly CategoryRef[] }>
    apply(projectSlug: string, key: CategoryKey, to: CategoryKey | null): Promise<{ changed: number }>   // idempotent; chunked ≤ 100 documents
  }
}
export type CategoryReferenceHit = { count: number; sample: readonly CategoryRef[] }   // sample ≤ 10 (IN_USE_ITEM_LIMIT)
export function registerCategoryReferenceSource(source: CategoryReferenceSource): void  // throws on duplicate id

/** What the service passes to the pure function: one hit per registered source id (sources added later appear automatically). */
export type CategoryReferences = Readonly<Record<string, { source: Pick<CategoryReferenceSource, 'id' | 'kind'> & { cleanable: boolean }; hit: CategoryReferenceHit }>>

export type DeletionBlockerCode =
  | 'unknown_category'
  | 'has_children'                        // child categories (archived included)
  | 'used_as_primary'                     // assigned items as primary — drafts included
  | 'used_as_additional'                  // assigned items as additional — drafts included
  | 'referenced_by_listing'               // automatic-listing references
  | 'referenced_by_standard'              // publication-standard references
  | 'referenced_by_availability_policy'   // availability-policy references outside the category's own rule
  | 'referenced_by_other'                 // any other stored Catalogue reference that deletion would break (detail.sourceId names it)
export type DeletionBlocker = {
  code: DeletionBlockerCode
  count: number                           // children / items / listings / standards / policies / other
  sourceId?: string                       // the registered source (absent for has_children / unknown_category)
  cleanable: boolean                      // true when a counted, previewed reassignment/cleanup exists (items always; others per source.cleanup)
  sample: readonly (CategoryRef | { key: CategoryKey; label: Localized })[]   // first 10 (IN_USE_ITEM_LIMIT)
}

// ── moves ───────────────────────────────────────────────────────────────────
export type MoveRequest = { key: CategoryKey; newParentKey: CategoryKey | null; index?: number } // index among new siblings; omitted = last
export type MoveIssueCode =
  | 'category_unknown' | 'category_parent_unknown' | 'category_cycle' | 'category_depth_exceeded' | 'category_archived_parent'
export type MovePlan = {
  ok: true
  /** Minimal set of nodes whose parentKey/order change (the moved node, plus siblings only if a renumber was unavoidable). */
  patches: readonly { key: CategoryKey; parentKey: CategoryKey | null; order: number }[]
} | { ok: false; code: MoveIssueCode; key: CategoryKey; detail?: string }
```

*D-22 (2026-11-03):* `CategoryNode` (roots only) and `TagNode` gain an optional `useFor?: readonly ItemProfile[]` — see **C1.12**.

**Constants** (in `taxonomy/limits.ts`, single source):

| Name | Value | Note |
|---|---|---|
| `MAX_CATEGORIES` | 300 | up from the generic 200 ("large catalogues", brief §1); D-21 |
| `MAX_TAGS` | 200 | unchanged |
| `MAX_DEPTH` | 32 levels | a safety rail against corrupt data, **not** a product rule; the editor guides to ≤3 (D6 "model permits depth, editor guides") |
| `MAX_ADDITIONAL_CATEGORIES` | 20 | today's `CATALOGUE_LIMITS.categories` |
| `LABEL_MAX` | 80 | `MAX_LABEL_LENGTH` |
| `PATH_SEPARATOR` | `' › '` | U+203A with spaces, matches the brief's "Food › Pizza › Bianche" |

## C1.4 Stored Sanity shape

```
_type       catalogueTaxonomy                    liveEdit (no drafts), registered like taxonomyTerm, no desk entry in tenant Studio
_id         catalogue-taxonomy.<projectSlug>     deterministic; SLUG_PART_PATTERN-validated; built by catalogueTaxonomyId()
projectSlug string                               shared projectSlugField; every query is scoped by $projectSlug
categories  array of catalogueCategory           _key == key (so patches address [_key=="pizza"])
tags        array of catalogueTag
updatedAt, updatedBy

catalogueCategory (object)
  _key       = key
  key        string   read-only once set; isValidTermKey
  label      localizedString   default language required
  parentKey? string   absent = root
  order      number
  channelRules? array of catalogueChannelRule { _key: <channelKey>, _type: 'catalogueChannelRule', channel: <channelKey>, state: 'available'|'unavailable',   // BASELINE
                                                schedule?: catalogueWeeklyOverride[] }                                       // OPTIONAL weekly overrides (C5a-2), typed members so dated exceptions are additive later
                 // C2/C5 row type, one validator (availabilityRowIssues + scheduleIssues); 'inherit' is never stored; a row is the COMPLETE rule for its channel (replace, never merge)
                 // MUST stay an array of rows: Sanity counts unique attribute paths (<=1,000 per document on Growth), so a map keyed by channel/category would exhaust the single-document budget
  defaultOptionListIds? string[]
  archivedAt? datetime

catalogueTag (object)    _key = key, key, label, order, archivedAt?

catalogueItem (changed fields; see C10 for the migration)
  primaryCategory?       string          key
  additionalCategories?  string[]        keys, excluding primaryCategory
  tags?                  string[]        unchanged
  categories?            string[]        LEGACY. Read while migrating; kept by D1 (additive); unset by the R2 writer on each document it writes and on all documents by R3; removed from the schema in R3
```

**Guarantees carried over from Amendment J (K-4 asks for them):**

| J guarantee | How it holds here |
|---|---|
| Deterministic ids | The document id is a pure function of `projectSlug`; node identity is `key`, unique per array, enforced by `validateTaxonomyWrite` and by `buildTree` (`duplicate-key` issue). A pack or two concurrent creates cannot produce two nodes with one key: every write is guarded by `ifRevisionId`, retry re-reads and re-validates. |
| Immutable keys | `key` is `readOnly` once set in schema; the service refuses a different `nextKey` (`category_key_immutable`). A move or rename changes `parentKey`/`label`, never `key`, so item references never break. |
| Labels per locale | `label` is a `localizedString`; coverage derived by `translationCoverage` (never stored). Adding a language needs no data change. |
| `projectSlug` scoping | Document id embeds it, field present, all reads go through `tenantScopedSanityClient`, all writes call `assertSingleSanityProject`. |
| Unknown key resolves to nothing | `buildTree` ignores nothing: lookups of an unknown key return `undefined`/`[]`; the public resolver drops an unknown primary/additional key (missing badge, never an error). A node whose `parentKey` points nowhere is a root with an `orphan` issue (never throws). |

Studio posture (C9): read-only by default; break-glass writes must run the same `validateTaxonomyWrite` rules — referential integrity is a critical rule.

## C1.5 Invariants

I1. A node has **exactly one parent or none** (`parentKey` is a single key or absent).
I2. **No cycles.** `wouldCycle` is checked on every move and on every write that sets `parentKey`; `buildTree` additionally detects cycles in corrupt data and cuts the edge at the lexicographically smallest key in the cycle (deterministic), reporting `cycle`.
I3. **Depth is unbounded in storage** up to `MAX_DEPTH`; exceeding it is `category_depth_exceeded`.
I4. **Sibling order is explicit**: `order` is meaningful only among nodes sharing `parentKey`; ties break by `key`; non-finite `order` sorts last. Gaps of `ORDER_STEP`; `orderBetween` renumbers the sibling group only when no integer gap remains.
I5. **Keys are unique within `categories` and within `tags`**, immutable, `isValidTermKey`. Category and tag keys are independent namespaces.
I6. **Labels**: default-language label required, each ≤ `LABEL_MAX` after trim; no two *active* siblings share a folded default-language label (`category_label_duplicate_sibling`) — cousins may (Food › Pizza › Classiche vs Food › Pasta › Classiche).
I7. **Channel rules** only name a channel that exists in C2's channel list (active or inactive); a write naming an unknown key is refused (`category_rule_unknown_channel`); a rule's schedule must pass C5a `scheduleIssues` (`category_rule_schedule_invalid`, carrying the C5a code, e.g. `availability.scheduleOverlap`). A category rule row *replaces* the inherited rule for its channel as a whole: a row `available` with no schedule means available all week even under an ancestor scheduled 18:00–23:00 (D-6.1). Rules of a channel that is later deactivated are **kept** (C5 ignores inactive channels); deleting a channel must prune its rules (C2's duty; flagged).
I8. **Item assignment**: `primary ∉ additional`; no duplicates; `additional` non-empty ⇒ `primary` set (`category_primary_required`); every key must exist; a *new* assignment of an archived key is refused (`category_archived_target`), an unchanged existing one is kept.
I9. **Archived** node: keeps its place in the tree, keeps its `channelRules` (they still govern items whose primary path passes through it), stays resolvable; excluded from pickers for new assignment; hidden from the public filter bar when it has no visible items. Archiving never cascades.
I10. **Primary is separate from additional** (decision): the assigned set is `{primary} ∪ additional`. Reasons: no redundant copy of the primary inside a list (no "primary not in list" invalid state), swapping primary is a two-field write, K-3 rule 5 ("additional never influence availability") is visible in the shape.
I11. **Additional categories never participate in availability** (K-3.5). `categoryChannelRule` only walks the primary path; additional categories feed `expandForFilter` only.

## C1.6 Pure services

All in `src/lib/modules/catalogue/taxonomy/tree.ts` (no React, no I/O, no Date.now). Every Catalogue surface — Setup, picker, resolver, readiness, import, packs, listings — imports these; none re-implements them.

```ts
/** Never throws. Tolerant of corrupt data; findings go to tree.issues. */
export function buildTree(nodes: readonly CategoryNode[]): CategoryTree

/** Nearest parent first, root last; excludes the node; unknown key → []. */
export function ancestorsOf(tree: CategoryTree, key: CategoryKey): CategoryKey[]

/** Pre-order, sibling order; excludes the node unless includeSelf; unknown key → []. */
export function descendantsOf(tree: CategoryTree, key: CategoryKey, opts?: { includeSelf?: boolean }): CategoryKey[]

/** True when making `newParentKey` the parent of `key` would create a cycle (including newParentKey === key). null parent never cycles. */
export function wouldCycle(tree: CategoryTree, key: CategoryKey, newParentKey: CategoryKey | null): boolean

/** Validates and plans a move/reorder. Pure: returns the patches or the first issue. Order of checks: unknown → parent unknown → cycle → depth (target depth + subtree height > MAX_DEPTH) → archived parent (only when the parent is archived and was not already the parent). */
export function validateMove(tree: CategoryTree, req: MoveRequest): MovePlan

/** Numeric order for inserting at index among siblings (midpoint of neighbours; null when no integer gap → caller renumbers). */
export function orderBetween(prev: number | null, next: number | null): number | null

/**
 * Membership set used for filtering: each assigned key plus all its ancestors.
 * Primary and additional both contribute (brief 8.1 "automatic ancestor membership"; additional categories affect discovery, not availability).
 * Unknown keys are skipped.
 */
export function expandForFilter(tree: CategoryTree, assigned: CategoryAssignment): Set<CategoryKey>

/** Keys whose items match a filter on `key`: the key and all its descendants. Unknown → []. Archived descendants included. */
export function filterKeys(tree: CategoryTree, key: CategoryKey): CategoryKey[]

/**
 * Localized path. Per segment: label[locale] → label[defaultLocale] → first non-empty label in key order of `locales` → the key itself.
 * Segments that did not use label[locale] are listed in fallbackAt; missingLocales lists, per segment, enabled locales without a label.
 * Unknown key → { keys: [], segments: [], text: '', complete: false, … }.
 */
export function pathOf(tree: CategoryTree, key: CategoryKey, ctx: { locale: string; defaultLocale: string; locales: readonly string[] }): CategoryPath

/**
 * Search by label or full path. Folds case and accents (NFD, strip combining marks). The query is split on whitespace and '›'/'>'/'/' ;
 * a node matches when every token is a substring of its folded searchable text = its path in `locale`, in `defaultLocale`, in every other enabled locale, and its key path.
 * Ranking: (0) leaf label equals the query, (1) leaf label starts with it, (2) leaf label contains it, (3) path-only match; then tree order. Archived nodes excluded unless includeArchived.
 */
export function searchCategories(tree: CategoryTree, query: string, ctx: { locale: string; defaultLocale: string; locales: readonly string[]; includeArchived?: boolean }): CategoryKey[]

/**
 * Effective category-level rule for ONE channel on the PRIMARY path: nearest self-or-ancestor whose rule is not 'inherit'.
 * C5 calls this; precedence between this and project default / item / format stays in C5.
 */
export function categoryChannelRule(tree: CategoryTree, primary: CategoryKey | null, channel: ChannelKey): { rule: ChannelAvailabilityRule | 'inherit'; sourceKey: CategoryKey | null }   // D-6: the COMPLETE rule (baseline + schedule) of the nearest non-inherited node; 'inherit' when none. No merging of ancestor schedules.

/**
 * The one primary-path walk (REVIEW X-3). 'none' when primary is null; 'broken' when the primary is unknown or tree.issues
 * (orphan/cycle) touch a node on its path (buildTree repairs the tree, this reports that it had to). C5 uses categoryChannelRule for level L1 and
 * primaryPath only for the explanation path and the primaryCategoryBroken finding; C6 maps broken/none/unknown through categoryAssignmentState.
 */
export function primaryPath(tree: CategoryTree, key: CategoryKey | null): PrimaryPath

/** Categories whose effective rule for `channel` would change if `key`'s own rule changed: key + descendants, not descending below a node with its own non-inherit rule. Input to C5's impact calculation. */
export function categoriesSharingRule(tree: CategoryTree, key: CategoryKey, channel: ChannelKey): CategoryKey[]

/**
 * Tom's definition (D-3, verbatim): a category is unused only when it has "no assigned items, including drafts; no child categories; no
 * automatic-listing references; no publication-standard or availability-policy references outside the category itself; no other stored
 * Catalogue reference that would become broken by deletion".
 * Blockers in fixed order: unknown_category, has_children, used_as_primary, used_as_additional, referenced_by_listing, referenced_by_standard,
 * referenced_by_availability_policy, referenced_by_other (sources in registration order). Empty array ⇒ unused. Archiving is never blocked. **This is the single implementation of D-3's "unused" (K-9):** C8 defines no usage type; it maps `deletionRoute(deletionBlockers(...))` to `term.deleteUnusedLeaf` (`taxonomy.write`) or `term.deleteInUse` (`setup.manage`) and consumes this function as is.
 */
export function deletionBlockers(tree: CategoryTree, key: CategoryKey, refs: CategoryReferences): DeletionBlocker[]

/**
 * Who may delete (D-3): [] ⇒ 'taxonomy.write' (an editor may delete only a genuinely unreferenced LEAF category — has_children is a blocker, so a
 * leaf is implied). Otherwise 'setup.manage', and the deletion must go through planCategoryDeletion (counted, previewed). A blocker with
 * cleanable=false (a source without cleanup) makes the deletion 'unresolvable' until the person edits the referring documents.
 */
export function deletionRoute(blockers: readonly DeletionBlocker[]): { capability: 'taxonomy.write' | 'setup.manage'; resolvable: boolean }

/** Counted, previewed cleanup for a deletion that has blockers: children promoted/moved, items reassigned, each cleanable source's preview. Pure over the previews the service gathered. */
export function planCategoryDeletion(tree: CategoryTree, key: CategoryKey, refs: CategoryReferences, opts: { reassignTo: CategoryKey | null; promoteChildrenTo: CategoryKey | null | 'parent' }):
  { ok: true; steps: readonly { kind: 'move_children' | 'reassign_items' | 'cleanup_source'; sourceId?: string; count: number }[] } | { ok: false; code: 'category_cleanup_unresolvable' | 'category_unknown' | 'category_cycle'; blockers: readonly DeletionBlocker[] }

/**
 * Inline creation (D-3): the complete path a NEW category would have, for the "Add category" form — the user picks the parent and sees
 * e.g. "Food › Pizza › Focacce" before saving. Same labelling/fallback rules as pathOf. parentKey null = a new root.
 */
export function previewPath(tree: CategoryTree, parentKey: CategoryKey | null, label: string, ctx: { locale: string; defaultLocale: string; locales: readonly string[] }): CategoryPath

/** Item-side validation (I8). `previous` lets an unchanged archived key through. */
export function validateAssignment(tree: CategoryTree, next: CategoryAssignment, previous?: CategoryAssignment): { ok: true } | { ok: false; code: 'category_unknown' | 'category_primary_required' | 'category_archived_target' | 'category_duplicate' | 'category_too_many'; key?: CategoryKey }

/** Reassignment plan for "move items from → to" (merge/delete flow). Per item: primary==from → to (dropping `to` from additional); from in additional → replaced by `to`, deduplicated, dropped if `to` is the primary. Idempotent: running it twice changes nothing the second time. */
export function planReassign(items: readonly { id: string; assignment: CategoryAssignment }[], from: CategoryKey, to: CategoryKey): { id: string; next: CategoryAssignment }[]

/** What readiness (C6) learns. 'none' = no primary and no additional; 'no_primary' = additional but no primary (only reachable from legacy/break-glass data); 'unknown_primary' = primary not in tree. */
export function categoryAssignmentState(tree: CategoryTree, a: CategoryAssignment): 'ok' | 'none' | 'no_primary' | 'unknown_primary' | 'archived_primary'

/** Legacy → new (D-15): the first EXISTING category becomes primary. With `tree`, keys that are not in the vocabulary are skipped (and reported by the migration); without it, the first non-empty deduplicated key. The rest are additional. */
export function legacyCategoriesToAssignment(categories: readonly string[] | null | undefined, tree?: CategoryTree): CategoryAssignment
```

**How readiness learns "no category / no primary" (C6 contract surface).** C6 does not read item fields itself; it calls `categoryAssignmentState`. Mapping the brief's rules: `none` → "No category" (draft: no issue; publish: **Required** failure `primary_category`), `no_primary` and `unknown_primary` → Required failure `primary_category` (message distinguishes), `archived_primary` → Recommended warning. The overview chips "no category" and "no primary category" (brief §17.6) are `none` and `no_primary ∪ unknown_primary`. *Decided — Tom 2026-11-02, D-15:* a primary category is mandatory when **publishing a new version**; existing public items are never silently unpublished; back online, restore and date changes re-run **only** C6's safety subset (allergen review, option-choice allergen review, declaration shape, dangling references) — the category rule is an ordinary quality requirement and is **not** re-run on re-exposure.

## C1.7 Service (impure) — `CatalogueTaxonomyService`

Server-only, in `src/lib/modules/catalogue/taxonomy/service.ts`; same posture as `taxonomy/service.ts`: `assertModuleAction` for every capability in C8 `capabilitiesFor(op)` first, tenant-scoped reads, `assertSingleSanityProject` before writes, `ifRevisionId` on every write, every mutation carries `transactionId = 'abluo-setup-' + <op>-<hash>` (C9 writer prefix list; packs use `abluo-pack-`), errors as `CatalogueTaxonomyError` with the stable codes below. The Setup UI and C7's pack application both call it; nothing else writes `catalogueTaxonomy` (K-4 test, C1.10).

**Permissions — Decided — Tom 2026-11-02, D-3 (option B).**

| Operation | Capability |
|---|---|
| Create a category (Setup, or **inline while editing an item**), choosing its parent; rename and translate; reorder siblings (same parent); delete a **genuinely unreferenced leaf** category; all tag operations (create, rename/translate, reorder, archive, delete-when-unused) | `catalogue.taxonomy.write` (Editors, Owner, Site admin) **or** `setup.manage` |
| Move categories between parents; reassign items during deletion; delete a category that has blockers (children, assigned items incl. drafts, references); edit channel-availability rules and their schedules; apply starter packs; archive/unarchive a category (not in Tom's editor list, so Setup — interpretation, see notes) | `catalogue.setup.manage` |

Catalogue → Setup → Categories & Tags is visible to people holding **either** permission. The service checks the stricter capability per operation **before any I/O** through C8's `capabilitiesFor({op:'term.*'})`; the check lives here, **not** in the generic taxonomy service, which refuses `module:'catalogue'` (X-8). Amends K-4 ("only in Setup" gains the approved contextual inline creation) and ADR-042 N2a (sub-destination permission is `anyOf`).

**Inline creation (D-3).** The item editor's "+ Add category" is a thin form over `createCategory` — **the same service call Setup makes, not a second implementation**. The form requires an explicit parent choice (tree picker, `searchCategories`; "Top level" is a choice, not a default), shows `previewPath(...)` live (the complete path in the editing locale, with fallback marks), and on success returns the created `CategoryPath` and selects it. New categories are created with **no channel rule (inherit)**; people without `taxonomy.write` can pick but not add.

Operation ids (C8 `CatalogueOperation`): archive/unarchive of a **category** is `term.archive`/`term.unarchive` with `kind:'category'` (capability `setup.manage`); of a **tag** `kind:'tag'` (`taxonomy.write`). Operations: `listTaxonomy`, `createCategory({labels, parentKey, index?})`, `updateCategory({key, labels?, channelRules?, defaultOptionListIds?, rev})` (`channelRules` needs `setup.manage`), `moveCategory(MoveRequest & {rev})` (re-parent needs `setup.manage`; same-parent reorder is `reorderChildren`), `reorderChildren(parentKey, keysInOrder, rev)`, `archiveCategory/unarchiveCategory`, `deleteCategory(key)` (route from `deletionRoute`), `previewCategoryDeletion(key, opts)`, `reassignCategory(from, to, {promoteChildrenTo?})`, `createTag/updateTag/reorderTags/archiveTag/deleteTag`, `categoryUsage(key)`.

### C1.7a Concurrent edits (D-1 / D-2)

All Catalogue vocabulary lives in **one revision-guarded document**; every write is one Sanity mutation (all of an operation's `set`/`insert`/`unset` steps in a single patch) with `ifRevisionId` = the revision the operation was planned against.

- **Atomic tree operations.** create, move, reorder (including the sibling renumber), archive, rule edit and a pack's whole insertion are each one patch on one document: either every step applies or none; the tree can never be committed in a state `validateMove`/`buildTree` did not see. Multi-document work (reassigning items, cleanup of other sources) is chunked ≤ 100 documents, idempotent, and ends with a recount before the single guarded delete.
- **On HTTP 409 / `ifRevisionId` mismatch** the service refetches the document and then, by class:
  - *Idempotent operations* — create (new key derived against the fresh keys; a twin with the same folded default label is returned instead of duplicated), archive/unarchive, tag create/archive, pack node insertion, taxonomy seeding, item reassignment chunks, `deleteCategory` of an already-absent key: **re-plan against the fresh tree and retry**, at most 3 attempts with jitter; if the re-plan fails validation (e.g. parent vanished) the typed validation code is returned, not a conflict.
  - *User-intent operations* — move, reorder, rename/translate, rule and schedule edits, delete, reassign: **no silent retry**. The service returns `category_conflict` with `{ rev, tree, changedKeys }` (keys whose node differs from the caller's base) so the UI can show "Changed elsewhere — review", re-plan with the person, and resubmit with the new `rev`. The UI always sends the `rev` it loaded.
- **Delete race.** The recount is done immediately before the guarded delete patch; an item written in that window (the dashboard item writer validates keys against the vocabulary but not transactionally) leaves an unknown key, which resolves to nothing and shows as visible readiness (`unknown_primary`), never a crash.
- **Arrays only (attribute-path budget).** Sanity counts unique attribute paths (≤ 1,000 per document on Growth); array elements share paths, so the budget depends on the *shape*, not the number of categories. Nothing in `catalogueTaxonomy` is map-shaped (no field named by a category, tag, channel or day key; `label` is the only locale-keyed object and is bounded by the project's locales). Test `taxonomy/attribute-paths`: a 300-category × 200-tag × 12-channel × 14-override fixture counts ≤ 150 unique paths and contains no data-named key.
- **Studio.** Break-glass writes (C9) use the same `ifRevisionId` discipline and `validateTaxonomyWrite`.

**Stable error codes** (snake_case, matching `TaxonomyErrorCode` style): `category_unknown`, `category_parent_unknown`, `category_cycle`, `category_depth_exceeded`, `category_archived_parent`, `category_archived_target`, `category_key_invalid`, `category_key_immutable`, `category_label_required`, `category_label_too_long`, `category_label_duplicate_sibling`, `category_limit`, `category_rule_unknown_channel`, `category_primary_required`, `category_duplicate`, `category_too_many`, `category_has_children`, `category_in_use` (detail: counts + first 10), `category_referenced` (detail: blockers with `sourceId`), `category_setup_required` (an editor attempted an operation that needs `setup.manage`, e.g. deleting a category with blockers), `category_cleanup_unresolvable`, `category_rule_schedule_invalid`, `category_conflict` (detail: `rev`, `tree`, `changedKeys`), `category_failed`; tags reuse `tag_unknown`, `tag_key_immutable`, `tag_label_*`, `tag_limit`, `tag_in_use`, `tag_conflict`. `TenantAuthorizationError` passes through as `forbidden`.

### Delete / archive / reassign rules

| Action | Rule |
|---|---|
| Archive / unarchive (categories) | `setup.manage`. Always allowed. Rules and ancestry keep working. Reversible. |
| Delete — unused | An editor (`taxonomy.write`) or Setup may delete a category only when `deletionBlockers` is empty = **unused, Tom's definition (D-3)**: no assigned items **including drafts**; no child categories; no automatic-listing references; no publication-standard or availability-policy references outside the category itself; no other stored Catalogue reference that would become broken by deletion. Because a child is a blocker, an editor can delete only a **genuinely unreferenced leaf**. Usage is recomputed server-side from the registered reference sources with the draft-including perspective (`raw`); the client's counts are never trusted. |
| Delete — anything with blockers | `setup.manage` **and** a counted, previewed operation: `previewCategoryDeletion` shows children to move, items to reassign (count + first 10), and each cleanable source's affected count; the person picks `reassignTo` / `promoteChildrenTo`; `deleteCategory` executes it. A non-cleanable source (no `cleanup`) must be resolved by editing the referring documents first (`category_cleanup_unresolvable`). |
| Reassign then delete ("merge") | `reassignCategory(from, to, {promoteChildrenTo})`: children move first (`validateMove`, default target = `from`'s parent), then `planReassign` patches items in chunks of ≤ 100 documents (drafts included), then each cleanable source's `apply`, then a server re-count must be 0 before the node is deleted. Each chunk is idempotent; an interruption leaves a valid, retryable state (items partly on `to`, node still present). |
| Delete in Studio (break-glass) | Must run `deletionBlockers`; otherwise refused (C9). |

**Reference-source registry.** Sources register in `taxonomy/reference-sources.ts`. Today only `items` exists (kinds `item_primary`/`item_additional`, fields `catalogueItem.primaryCategory`/`additionalCategories`, plus legacy `categories` while it exists). Later slices register `automatic-listings`, `publication-standards`, `availability-policies` (and any other document type that stores a category key) **in the same slice that adds the field** — enforced by test `refs/registry-complete`: every schema field declared with `x-category-key: true` (a `stores` entry) must be covered by a registered source, so a later slice cannot ship a category-key field the deletion guard does not see. Until a source is registered its documents cannot exist, so the guard is complete at every commit.

Item-side effect of rule changes is C5's concern; C1 only supplies `categoriesSharingRule`.

## C1.8 Reading: public and dashboard

- One shared GROQ fragment `catalogueTaxonomyGroq(labelExpr)` returns `*[_id == "catalogue-taxonomy." + $projectSlug][0]{ categories[]{key,"label":label,parentKey,order,channelRules,archivedAt}, tags[]{key,"label":label,order,archivedAt} }`. It replaces `catalogueCategoryTermsGroq`, `catalogueTermsGroq('tag',…)` and the `categoryTerms`/`tagTerms` members of `CATALOGUE_SITE_QUERY` / the public vocabulary query (`resolve.ts:391`).
- Public resolver DTO: `primaryCategory: CatalogueTermDTO | null`, `categories: CatalogueTermDTO[]` (primary first, then additional, in tree order), `categoryPath` for the primary (locale resolved). Filter bar on collection pages: roots (or the chosen level) that have ≥1 visible item via `expandForFilter`; selecting a node filters by `filterKeys`.
- Items are never re-written when the tree changes (keys only).

## C1.9 Migration from today — C1's data step (D1) in the single ordered plan

The order of releases and data steps is **not defined here**: it is the one plan owned by C10 (REVIEW E-1: M0 audit store → R1 readers + schema → pre-flight, staging rehearsal and Tom's approval → R2 writers → D1 … D4 → R3 cleanup → per-project rule activation). C1 contributes these pieces to it:

**R1 (readers, writers unchanged).** Vocabulary resolution order: (a) `catalogue-taxonomy.<project>` if it exists and has the kind → used entirely, never mixed; else (b) `taxonomyTerm` records with `module == "catalogue"` (today's rule); else (c) legacy `config.categories` (categories only). Item reading: `primaryCategory`/`additionalCategories` if either is present, else `legacyCategoriesToAssignment(categories)`. `primaryPath`, `categoryChannelRule`, `categoryAssignmentState` ship. Nothing live changes.

**R2 (writers).** `CatalogueTaxonomyService` is the only vocabulary writer and **seeds `catalogue-taxonomy.<slug>` from the term records on its first write**, with the same pure function the D1 script uses (`seedTaxonomyFromTerms(terms, configList)`; `createIfNotExists`, never overwrites an existing document). The Catalogue tab of Categories & Tags disappears in the same release, so no `taxonomyTerm` writer exists after R2 (no lost edits between copy and switch). The dashboard item writer writes `primaryCategory` + `additionalCategories` and unsets `categories` **on the same document** in the same patch.

**D1 — taxonomy copy + item assignment** (`scripts/catalogue/migrate-taxonomy.mjs`; dry-run first; idempotent; additive; audited as `migration.taxonomy` via M0):
1. Build `catalogue-taxonomy.<slug>` with `seedTaxonomyFromTerms` — tmz: categories `technology`/`design`/`literature` (labels, `order` 1000/2000/3000, all roots, no rules), the 7 tags with labels and order; **keys copied verbatim, including `illustrated_boos`**. A project with no term records but a `config.categories` list is seeded from the list (none today; the script asserts and prints the count). Skipped if the document already exists (the R2 service may have seeded it).
2. For every `catalogueItem` document (published **and** `drafts.`; `versions.*` included, production has 0): set `primaryCategory`/`additionalCategories` from `legacyCategoriesToAssignment(categories, tree)` (first *existing* category = primary; keys missing from the vocabulary are not assigned and are listed in the report) **unless either field is already present** (an R2 write is newer and wins); **`categories` is kept** until R3.
3. Equivalence check (`scripts/catalogue/verify-taxonomy.mjs`, committed report): per item document and locale, `{primary} ∪ additional` equals the legacy `categories` as a set, `primary == categories[0]`, resolved labels equal; vocabulary labels per locale equal the term-record labels; diff must be empty.

Expected for tmz: 3 roots, 7 tags, 16 item documents processed, one draft with two legacy categories (`c2c4fa97…`: primary `technology` = the first existing category, additional `[literature]` — *Decided — Tom 2026-11-02, D-15*), two drafts without category stay without.

**R3 (cleanup, separate and explicit):** unset legacy `categories` on items, delete Catalogue `taxonomyTerm` documents and the stale `config.categories`, drop the readers (b)/(c) and `config.categories` from `configSchema`/`usage`, remove the Catalogue `taxonomies` manifest declaration.

## C1.10 Superseded by C1

**Complete reader/writer list of Catalogue `taxonomyTerm` that D1/R2/R3 must switch (REVIEW A5):** `queries.ts:2624-2626` (website config query), `resolve.ts:391`, `catalogue-drafts.ts:243`, `dashboard-queries.ts:21-23`, `taxonomy/vocabulary.ts:66-109`, the generic manager and its Catalogue tab, the seed scripts (`scripts/taxonomy/*`, `scripts/lib/taxonomy-seed.mjs`), Studio `lib/sanity/fields/CategorySelectInput.tsx:62-70` (term query for the Studio category picker), the Studio `catalogueItem.tags` field and its description "keys of the tags defined under Categories & Tags" (`modules/catalogue/schema.ts:632-641`), Studio `sanity/components/TermUsageView.tsx` and `NewTermPane.tsx`, `lib/taxonomy/studio.ts:88-95` `TERM_MANAGED_CONFIG_FIELDS` (the Modules pane hides `catalogue.categories`), `lib/api/client-dashboard.ts:214`, `lib/client/surfaces.ts:160` (Categories & Tags surface lists `catalogue.taxonomy.write`, `catalogue.item.read`), `canAddCategory` in `catalogue/new/page.tsx:33` and `catalogue/[id]/page.tsx:44`, and the website filter `components/catalogue/CatalogueCategoryFilter.tsx` (flat `data-cats` CSS filter: it must receive the ancestor keys from `expandForFilter`).

**Out of C1's scope — `dietaryTags`.** `dietaryTags` is the controlled dietary-declaration vocabulary feeding `item.dietary` (brief §9: tags must not duplicate it). It is not a tag set; it stays in module config, edited in Setup → Item defaults under `setup.manage` (REVIEW X-10).

**New document types for C9's Studio table (REVIEW X-16):** `catalogueTaxonomy` (this contract), `cataloguePackHistory` and the pack-run marker type `cataloguePackRun` (C7.5).

- J-3/J-4 for the Catalogue: `taxonomyTerm` with `module: 'catalogue'`; dashboard editing of Catalogue terms in Categories & Tags; the Catalogue `taxonomies` manifest entry (the permission id `catalogue.taxonomy.write` is kept, now enforced by the Catalogue service rather than the generic one); the Catalogue branch of `manageableTaxonomyModules`; `loadCatalogueNavLabel` use in `taxonomy/page.tsx` (disappears with the tab).
- Legacy dual-read of the `categories` config list (`catalogueCategoryVocabulary`'s config argument; `config.categories` field; `catalogue.config.categories` strings).
- `CatalogueItem.categories` (plain array) and `dashboard-patch.ts` `categories` field → `primaryCategory` / `additionalCategories`; `itemGaps`'s `noCategory` becomes `categoryAssignmentState`.
- The seed script `scripts/taxonomy/seed-catalogue-categories.mjs` and `--module catalogue` mode of `seed-categories.mjs` (kept for other modules).
- Studio: the "Categories & Tags" desk group no longer lists Catalogue terms; a read-only `catalogueTaxonomy` list is added (C9).
- `TermPicker` stays for tags; Catalogue **categories** get a tree picker showing full paths (new interaction, brief §8.3) built on `pathOf`/`searchCategories`.

## C1.11 Named test fixtures

Base tree **T-food** (en default; it/de where noted):

| key | parent | order | en | it | de |
|---|---|---|---|---|---|
| `food` | – | 1000 | Food | Cibo | Essen |
| `pizza` | food | 1000 | Pizza | Pizza | Pizza |
| `pizza_classiche` | pizza | 1000 | Classic | Classiche | *(missing)* |
| `pizza_bianche` | pizza | 2000 | White | Bianche | *(missing)* |
| `desserts` | food | 2000 | Desserts | Dolci | Desserts |
| `beverages` | – | 2000 | Beverages | Bevande | Getränke |
| `alcoholic` | beverages | 1000 | Alcoholic | Alcolici | Alkoholisch |
| `liqueurs` | alcoholic | 1000 | Liqueurs | Liquori | Liköre |

| Fixture | Input | Expected |
|---|---|---|
| `tree/basic` | `buildTree(T-food)` | roots `[food,beverages]`; `childrenOf(pizza)=[pizza_classiche,pizza_bianche]`; `depthOf(liqueurs)=2`; `issues=[]` |
| `tree/order-ties` | two siblings with order 1000, keys `b`,`a` | `[a,b]`; non-finite order last |
| `tree/ancestors` | `ancestorsOf(pizza_bianche)` | `[pizza,food]`; `ancestorsOf('nope')=[]` |
| `tree/descendants` | `descendantsOf(food)` / with `includeSelf` | `[pizza,pizza_classiche,pizza_bianche,desserts]` / with `food` first |
| `path/en` | `pathOf(pizza_bianche, en)` | text `Food › Pizza › White`, complete true |
| `path/de-missing` | `pathOf(pizza_bianche, de)` | `Essen › Pizza › White` (de→default en for last segment; `pizza` has de) — `fallbackAt=[2]`, `missingLocales[2]=[de]`, complete false |
| `path/key-only` | node with empty label map | segment equals key |
| `cycle/self` | `validateMove(food → parent food)` | `category_cycle` |
| `cycle/descendant` | `validateMove(food → parent pizza_bianche)`; `wouldCycle` | `category_cycle`; true |
| `move/ok-between` | `pizza → beverages, index 0` | ok; patches `[{pizza, beverages, order<1000}]` only |
| `move/renumber` | siblings orders 1000,1001; insert between | patches include sibling renumber to 1000-step |
| `move/depth` | chain of 33 | `category_depth_exceeded` on the 33rd |
| `move/unknown` | unknown key / unknown parent | `category_unknown` / `category_parent_unknown` |
| `tree/corrupt-cycle` | `a.parent=b`, `b.parent=a` | no throw; issue `cycle`; `a` is root (smallest key); `b` child of `a` |
| `tree/orphan` | `x.parent='gone'` | `x` is a root; issue `orphan` |
| `tree/duplicate` | two nodes key `pizza` | first wins; issue `duplicate-key` |
| `expand/assigned` | primary `pizza_bianche`, additional `[desserts]` | `{pizza_bianche,pizza,food,desserts}` |
| `expand/unknown` | primary `nope` | `{}` |
| `filter/keys` | `filterKeys(food)` | `[food,pizza,pizza_classiche,pizza_bianche,desserts]` |
| `search/path` | query `pizza bian`, locale it | first result `pizza_bianche` |
| `search/accent` | `caffe` vs label `Caffè` | matches |
| `search/arrow` | `food › pizza` | `pizza` first, then its children |
| `search/archived` | archived node | excluded by default, included with `includeArchived` |
| `rule/nearest` | `food: delivery={unavailable}`, `pizza: delivery={available}` | `categoryChannelRule(pizza_bianche, delivery)` → `{rule:{state:'available',overrides:[]}, sourceKey:'pizza'}`; `(desserts)` → `{state:'unavailable'}` from `food` |
| `rule/schedule-replaces` | `food: delivery={unavailable, weekly available 18:00–23:00}`, `pizza: delivery={available}` (no schedule) | `categoryChannelRule(pizza_bianche, delivery)` → pizza's rule with `overrides: []` (available all week); the ancestor's schedule is **not** merged (D-6.1) |
| `rule/schedule-inherited` | same without the `pizza` row | `categoryChannelRule(pizza_bianche, delivery)` → food's complete rule incl. its schedule, `sourceKey:'food'` |
| `rule/schedule-invalid` | two overlapping overrides in one rule | write refused `category_rule_schedule_invalid` (C5a `availability.scheduleOverlap`) |
| `rule/stored-shape` | rule `{unavailable, [18:00–23:00 available]}` | stored row `{_key:'delivery', _type:'catalogueChannelRule', channel:'delivery', state:'unavailable', schedule:[{_type:'catalogueWeeklyOverride',…}]}`; `available`/no-schedule row is kept (never collapsed to absence) |
| `rule/additional-inert` | item primary `desserts`, additional `pizza` | rule resolution uses only `desserts` path |
| `path/primary-ok` | `primaryPath(T-food, pizza_bianche)` | `{kind:'path', keys:[food,pizza,pizza_bianche]}` |
| `path/primary-none-broken` | `primaryPath(null)`; unknown key; node inside a corrupt cycle | `none`; `broken/missingCategory`; `broken/cycle` (keys = resolvable part) |
| `rule/sharing` | `categoriesSharingRule(food, delivery)` with `pizza` having its own rule | `[food,desserts]` (does not enter `pizza` subtree) |
| `assign/valid` | primary `pizza`, additional `[desserts]` | ok |
| `assign/primary-in-additional` | primary `pizza`, additional `[pizza]` | `category_duplicate` |
| `assign/no-primary` | primary null, additional `[desserts]` | `category_primary_required` |
| `assign/archived-new` | primary archived, previous different | `category_archived_target`; unchanged archived → ok |
| `assign/too-many` | 21 additional | `category_too_many` |
| `legacy/two` | `['technology','literature']` | primary `technology`, additional `[literature]` |
| `legacy/first-existing` | `['gone','literature','technology']` with tree lacking `gone` | primary `literature`, additional `[technology]`; `gone` reported, not assigned (D-15) |
| `legacy/empty` | `null`, `[]`, `['','a','a']` | none; none; primary `a` |
| `delete/children` | `deletionBlockers(pizza, no references)` | `[has_children count 2]`, `cleanable` true (children can be moved) |
| `delete/used-published` | `pizza_bianche`: source `items` hit primary 3, additional 2 | `[used_as_primary 3, used_as_additional 2]`, samples ≤ 10, `cleanable:true` |
| `delete/used-draft-only` | one draft-only item (no published copy) with primary `liqueurs` | `[used_as_primary 1]` — drafts count (D-3); a draft + published copy of one item count once |
| `delete/used-archived-item` | archived item assigned | counts |
| `delete/listing-ref` | registered fake source `automatic-listings` (kind `automatic_listing`) hit 2 | `[referenced_by_listing 2]` with `sourceId` |
| `delete/standard-ref` | fake source `publication-standards` hit 1 (standard scoped to the subtree) | `[referenced_by_standard 1]` |
| `delete/availability-policy-ref` | fake source `availability-policies` hit 1 (policy outside the category's own rule) | `[referenced_by_availability_policy 1]`; the category's **own** `channelRules` never count |
| `delete/other-ref` | fake source `x-future` kind `other` hit 3 | `[referenced_by_other 3]` with `sourceId:'x-future'` |
| `delete/late-source` | a source registered after the fact | appears in `deletionBlockers` output with no change to the function |
| `delete/order` | children + items + listing + standard + policy | blockers in the fixed order |
| `delete/clean` | `liqueurs`, no references | `[]` |
| `delete/unknown` | unknown key | `[unknown_category]` |
| `delete/route-editor` | `[]` | `{capability:'taxonomy.write', resolvable:true}`; editor deletes |
| `delete/route-setup` | any blocker | `{capability:'setup.manage'}`; an editor calling `deleteCategory` → `category_setup_required`, zero writes |
| `delete/preview` | `pizza` with children, 5 items, 1 cleanable listing, `reassignTo:'food'`, `promoteChildrenTo:'parent'` | steps `[move_children 2, reassign_items 5, cleanup_source(listings) 1]` counted, nothing written |
| `delete/unresolvable` | a source without `cleanup`, hit 1 | `planCategoryDeletion` → `category_cleanup_unresolvable`; `deletionRoute.resolvable:false` |
| `refs/registry-complete` | schema scan for category-key fields | each field is covered by a registered source; a test double field without a source fails |
| `inline/create-path` | `previewPath(T-food, pizza, 'Focacce', en)`; `parent=null` | `Food › Pizza › Focacce`; `Focacce`; `createCategory` returns the same `CategoryPath`; the call goes through the same service function as Setup (spy) |
| `inline/parent-required` | `createCategory` without an explicit parent choice | validation error (null is explicit "top level"; `undefined` refused) |
| `perm/editor-ops` | editor: create, rename, reorder siblings, delete unreferenced leaf, tag ops | allowed |
| `perm/setup-ops` | editor: move between parents, reassign, delete in-use, edit rules, apply pack, archive | `category_setup_required` / `forbidden`, zero writes |
| `conc/idempotent-retry` | 409 on create | refetch, re-derive key, retry ≤ 3, one node |
| `conc/user-conflict` | 409 on move / rename | `category_conflict` with `rev`, `tree`, `changedKeys`; no retry |
| `conc/atomic-move` | move failing validation midway | document byte-identical |
| `taxonomy/attribute-paths` | 300 categories × 200 tags × 12 channel rules × 14 overrides | ≤ 150 unique paths; no data-named keys |
| `reassign/merge` | items {p=a}, {p=b, add=[a]}, {p=b, add=[a,c]} from a to b | {p=b}; {p=b, add=[]}; {p=b, add=[c]}; second run no change |
| `state/*` | `categoryAssignmentState` for none, additional-only, unknown, archived, ok | `none`, `no_primary`, `unknown_primary`, `archived_primary`, `ok` |
| `migrate/tmz` | production term records + item docs (frozen JSON fixture) | tree = 3 roots; every item's assignment set equals legacy set; before/after resolved labels equal; `illustrated_boos` preserved |
| `surface/single-writer` | static scan of `src/` | `catalogueTaxonomy` written only under `lib/modules/catalogue/taxonomy/`; `MODULE_REGISTRY` catalogue has no `taxonomies`; `manageableTaxonomyModules` never returns `catalogue`; taxonomy service called with module `catalogue` → `kind_not_declared` |
| `guard/no-mixing` | project with both `catalogueTaxonomy` and term records | document wins entirely; labels never merged |

## C1.12 Profile applicability (D-22)

*Decided — Tom 2026-11-03, D-22 (`DECISIONS-step2-final-2026-11-02.md`).* A category branch, a tag or an option list may be meant for some item profiles only (a pizza never belongs in "Books › Design"). This section is the single definition of that rule; every writer, picker, gate and validator imports it.

### C1.12.1 Model

```ts
import type { ItemProfile } from '../profiles'          // the profile registry ids: book · foodOrDrink · product · service
/** "Use for". Absent or EMPTY = every item profile ("All item types"). No sentinel value is stored. */
export type UseFor = readonly ItemProfile[]

CategoryNode.useFor?: UseFor     // meaningful on ROOT categories only (parentKey null)
TagNode.useFor?: UseFor          // per tag (tags are flat)
catalogueOptionList.useFor?: UseFor   // per option list document (draft/published like the list's other fields)
```

Stored shape (arrays only, D-2 attribute-path budget): `catalogueCategory.useFor?: string[]`, `catalogueTag.useFor?: string[]`, `catalogueOptionList.useFor?: string[]` — profile ids, deduplicated, in `PROFILE_ORDER`. Writers **unset** the field for "All item types" (never write `[]`, never a sentinel such as `"all"`). The list is stored as chosen: ticking all four profiles stores four ids (it is "all of today's profiles"; a profile added to the registry later is then not included until someone adds it). Unknown ids are refused by every writer and by Studio validation; the reader drops them, and a stored list whose every id is unknown reads as **no profile at all** (`[]` would mean "all", so the reader keeps a distinct `unknownOnly` flag and `appliesTo` answers *false* for it — a corrupt value never widens applicability).

UI labels (Tom): **Food or drink · Book · Other product · Service · All item types** (`catalogue.useFor.*`); the registry ids stay internal.

### C1.12.2 Inheritance

- **All descendants inherit the profiles of their top-level category.** `effectiveProfiles(tree, key)` = the `useFor` of the root of `key`'s path in the built tree (`ancestorsOf(key).at(-1) ?? key`). No per-level overrides: a non-root node's own `useFor` is ignored by every reader, refused by every writer (`category_use_for_not_root`) and flagged by Studio validation.
- A node that `buildTree` repairs to a root (orphan, cycle cut) uses its own `useFor`.
- **Moves.** Moving a root under a parent **drops its `useFor` in the same guarded patch**; the moved branch inherits the new root's profiles. Moving a node to the top level gives it no `useFor` (all item types) until Setup sets one. `previewCategoryMove` returns `profiles: { before, after }` (effective, for the moved node) and `newlyIncompatible` (items of the moved subtree whose assignment becomes incompatible); the move confirmation shows both whenever they differ. A move never changes an item.
- Unknown key: `effectiveProfiles` returns `[]` (all) — unknown keys are reported by `integrity.unknownCategory` / `unknown_primary`, not here.

### C1.12.3 Compatibility rule (pure, `taxonomy/profile-applicability.ts` — the ONE implementation)

```ts
export function readUseFor(raw: unknown): { profiles: ItemProfile[]; unknownOnly: boolean }
export function appliesTo(useFor: UseFor | undefined, profile: ItemProfile, unknownOnly?: boolean): boolean  // empty/absent → true
export function effectiveProfiles(tree: CategoryTree, key: CategoryKey): ItemProfile[]
export function isCategoryCompatible(tree: CategoryTree, key: CategoryKey, profile: ItemProfile): boolean
export function isTagCompatible(tag: Pick<TagNode, 'useFor'> | undefined, profile: ItemProfile): boolean        // unknown tag → true (integrity elsewhere)
export function isOptionListCompatible(list: { useFor?: UseFor } | undefined, profile: ItemProfile): boolean
export type ProfileFinding =
  | { kind: 'primary' | 'additional'; key: CategoryKey; root: CategoryKey; useFor: ItemProfile[] }
  | { kind: 'tag'; key: TagKey; useFor: ItemProfile[] }
  | { kind: 'option'; key: string /* list id */; useFor: ItemProfile[] }
export function incompatibleAssignments(item: ApplicabilityItem, taxonomy: { tree: CategoryTree; tags: readonly TagNode[] }, optionLists: ReadonlyMap<string, UseFor | undefined>): ProfileFinding[]
export function newIncompatibleAssignments(before: ApplicabilityItem, after: ApplicabilityItem, taxonomy, optionLists): ProfileFinding[]  // findings of `after` whose (kind,key) was not assigned in `before`
export function narrowingImpact(items: { id; item: ApplicabilityItem }[], before: { taxonomy; optionLists? }, after: { taxonomy; optionLists? }): { items: number; sample: string[] }   // items (per id, drafts included) newly incompatible after a useFor change or a move
// ApplicabilityItem = { profile: ItemProfile | null; assignment: CategoryAssignment; tags: readonly string[]; optionListIds: readonly string[] }
```

- **Both primary and additional categories must be compatible**; every tag; every attached option list.
- An item with **no valid profile** produces no profile findings (`profileMissing` already blocks it).
- Findings are listed in a fixed order: primary, additional (stored order), tags (stored order), option lists (attachment order).
- **Changing an item's profile checks all existing assignments** — it does so by construction: findings are a pure function of (profile, assignments, taxonomy), recomputed on every render, save, gate and validation.

### C1.12.4 Enforcement points (same rule everywhere)

| Where | Behaviour |
|---|---|
| Item writer (`item-writer.ts` `profileApplicabilityRefusal`, called by `cleanCatalogueSet` + the draft save) | Refuses a save that **adds** an incompatible assignment (`newIncompatibleAssignments` non-empty): `invalid_value`, field `primaryCategory`/`additionalCategories`/`tags`/`optionLists`, message names the term. **Never deletes** an existing assignment; a profile change is always saved and keeps every assignment (findings surface). |
| Publish gate (`cataloguePublishGate`) | Required readiness finding `profileMismatch` per incompatible assignment → `not_ready` with the named findings (fix links: categories → item `category` step / content tab; tags → content tab; option lists → options tab). Runs **independently of the migration markers** (activation `always`): without any `useFor` in the project it can never fire, so unchanged data behaves exactly as before. Primary **and** additional categories, tags and option lists. |
| Readiness (`readiness/rules.ts`, `facts-model.ts`) | Rule `profileMismatch`, level **required** in every context, gate `publish`, family `standard`, activation `always`; facts `profileFindings` built by the ONE shared `modelFacts` for editor and gate (R-30 equivalence). List chip `profileMismatch` ("Doesn’t fit its type") in every project. |
| Studio (critical validation) | `catalogueItem.itemProfile` carries an async `Rule.custom(...).error()` that reads the project's `catalogueTaxonomy` and the attached option lists and runs `incompatibleAssignments` (the same function); `catalogueCategory.useFor` refuses unknown ids and a value on a non-root node. Studio stays read-only (C9); this protects break-glass writes. |
| Bulk edit | No Catalogue bulk-edit writer exists yet. D-19 `publishManyTogether` runs the publish gate per document, so it inherits the rule; a future bulk "set category / tag / profile" action **must** call `newIncompatibleAssignments` per item before writing (test required in that slice). |
| Import | No import path exists yet (`import.*` operations are declared only). The import slice **must** call `incompatibleAssignments` per row in its dry-run and refuse rows that would add an incompatible assignment, with the same messages. Exported from the pure module for that purpose. |
| Re-exposure (D-15 safety subset) | **Not included.** Incompatibility is a publication-time quality rule like `primaryCategoryMissing`; back online / restore / date changes do not re-run it (the safety subset stays the four rules). Recorded 2026-11-03. |

### C1.12.5 Pickers (dashboard)

- `CategoryPicker` receives `compatible(key)` and `incompatibleText(key)`: the browser and search list only compatible branches; an existing incompatible assignment stays visible (summary and browser) with **"Not used for <profile>"**, a remove action and the normal way to choose a replacement; it is never removed automatically. Inline "Add category" offers only compatible parents, or **Top level** — a new root created inline from an item gets `useFor = [item profile]` (part of `term.create`, `taxonomy.write`: a brand-new root has no items, so no impact).
- The tag picker (`TermPicker` with `isAvailable` / `unavailableText`) and the option-list picker (`OptionsField`) apply the same filter and the same "Not used for" state.

### C1.12.6 Setup

- **Categories & Tags:** a profile chip per root (`Pill`, one per profile; none = "All item types") and per tag; a **"Show for" filter by item profile** (`ProfileFilter`) beside the search of the tree and of the tag list (shows the branches/tags applicable to that profile); "Use for" editor (`UseForField` inside `UseForSection`: square checkboxes, "All item types" clears, explicit Save) in the category sheet for **root** categories only (children show "Used for: … — set on <root>") and in a tag sheet (⋯ → Use for…).
- **Options:** the option-list editor shows the same "Use for" section (saved through the list's draft autosave; disabled with the reason without Catalogue Setup); its narrowing count is computed from the project's item list (items whose type the list stops serving).
- **Narrowing** a root's or tag's `useFor` shows an impact preview first — the number of items (drafts included) that become incompatible — and **never modifies items**; widening needs no preview.

### C1.12.7 Service operations, permissions, audit

| Operation | Capability | C8 op |
|---|---|---|
| `setCategoryUseFor({ key, useFor, rev, baseHashes })` + `previewCategoryUseFor` (root only; user-intent, revision-guarded, `category_conflict` on 409) | `catalogue.setup.manage` | `term.setUseFor` `kind:'category'` |
| `setTagUseFor({ key, useFor, rev, baseHashes })` + `previewTagUseFor` | `catalogue.taxonomy.write` (D-3: editors manage tags) | `term.setUseFor` `kind:'tag'` |
| Option list `useFor` via the existing draft writer (`saveCatalogueDraft`, kind `optionList`, field `useFor`) | `catalogue.setup.manage` in addition to `optionList.edit` | `optionList.setUseFor` |
| `createCategory({ …, useFor })` — only when `parentKey === null` | `catalogue.taxonomy.write` | `term.create` |

Audit (C12, through `recordCatalogueActivity`, content-free — profile ids are registry ids, not tenant content): **`taxonomy.use_for_changed`** `{ target: 'category' | 'tag' | 'optionList'; key: string; before: ItemProfile[]; after: ItemProfile[]; newlyIncompatible: number }`, scope `category` (category, tag) / `project` (option list — the SQL scope set of migration 061 has no option-list value). Moves that drop a root's `useFor` are already audited as `category.restructured` (its `impact.items`).

Stable error codes added: `category_use_for_not_root`, `use_for_invalid` (unknown profile id or malformed list).

### C1.12.8 Packs (C7)

`PackCategory.useFor?` (roots only — `pack_use_for_not_root`), `PackTag.useFor?`, `PackOptionGroup.useFor?`; values validated against `PROFILES` (`pack_profile_unknown`). Every root and every option group of a non-empty pack **declares** `useFor` (`pack_use_for_missing`); tags may omit it (generic tags such as New, Seasonal, Local, Staff pick, Limited stay available to all profiles). Bookshop roots/tags → Book; the five restaurant packs → Food or drink (their food-specific tags too); applying writes `useFor` only on nodes/lists it **creates** (never on equivalent existing ones — fill-if-absent never overwrites a tenant's choice). Food setup applies the same packs. **Runtime reads only the stored `useFor`, never which pack was applied** (C7.9 guard unchanged).

### C1.12.9 Migration of existing data (tmz)

No automatic data step: absent `useFor` = all item types, so every existing project keeps today's behaviour. tmz is fixed by Tom in Setup (RUNBOOK §13): create root **Books** (Use for: Book), move Literature, Technology, Design and the other book categories under it (setup permission; the move drops nothing — they were roots without `useFor`). The draft pizza then shows **"Design isn't used for Food or drink"** and must be fixed by Tom; nothing is ever auto-replaced. The read-only report `scripts/catalogue/report-profile-applicability.mjs` lists every incompatible assignment with the same pure function (dry-run only).

### C1.12.10 Named test fixtures (`taxonomy/__tests__/profile-applicability.test.ts` unless noted)

Base tree **T-mixed**: `food` (root, useFor `[foodOrDrink]`) › `pizza` › `pizza_bianche`; `books` (root, useFor `[book]`) › `design`, `literature`; `shop` (root, useFor `[book, product]`) › `gifts`; `misc` (root, no useFor). Tags: `new` (none), `spicy` `[foodOrDrink]`, `signed_copy` `[book]`. Lists: `extras` `[foodOrDrink]`, `wrap` (none).

| Fixture | Input | Expected |
|---|---|---|
| `use-for/read` | `['book','book','x']`, `['x']`, `null`, `[]` | `{profiles:[book]}`, `{profiles:[],unknownOnly:true}`, all, all |
| `use-for/inherit` | `effectiveProfiles(pizza_bianche)`, `(gifts)`, `(misc)`, `('nope')` | `[foodOrDrink]`, `[book,product]`, `[]`, `[]` |
| `use-for/non-root-ignored` | `design` stored with own `useFor:[service]` | effective `[book]` |
| `use-for/unknown-only` | root stored `useFor:['x']` | compatible with no profile |
| `compat/pizza-design` | pizza `{profile foodOrDrink, primary design}` | `[{kind:'primary', key:'design', root:'books'}]` |
| `compat/additional` | book `{primary literature, additional [pizza]}` | one `additional` finding |
| `compat/multi-profile` | product in `gifts`; book in `gifts` | compatible both |
| `compat/tags-options` | pizza with tags `[new, signed_copy]`, lists `[extras, wrap]` | one `tag` finding (`signed_copy`), no option finding |
| `compat/order` | primary + additional + tag + option all incompatible | findings in that order |
| `compat/no-profile` | profile null | `[]` |
| `compat/profile-change` | book in `literature` changes profile to foodOrDrink | finding for `literature`; assignment unchanged |
| `new/only-added` | before `{primary design}` after `{primary design, additional [literature]}` for a pizza | `newIncompatible` = `literature` only (design already there) |
| `new/profile-change-never-refuses` | before book/design, after foodOrDrink/design | `[]` |
| `narrow/impact` | `shop` narrowed to `[book]`, two products + one book in `gifts` | `items: 2` |
| `move/drops-use-for` | move `books` under `misc` (service `moveCategory`, fake client) | patch unsets `useFor` on `books`; preview `profiles.before [book]`, `after []` |
| `writer/refuse-add` (`item-writer` test) | pizza draft adds `literature` | `invalid_value` naming `additionalCategories`; nothing written |
| `writer/keep-existing` (`item-writer` test) | pizza draft with `design` saves its name | saved; `design` kept |
| `gate/blocks` (`catalogue-publish-gate` test) | pizza with primary `design`, project WITHOUT migration markers | `not_ready`, finding `profileMismatch` values `{kind:'primary', key:'design'}` |
| `readiness/rule` (readiness test) | same input through editor and doc facts builders | identical `profileMismatch` findings (R-30) |
| `studio/validation` (schema test) | Studio custom rule with fake client | error text names `design` |
| `service/set-use-for` (service test) | root ok; non-root → `category_use_for_not_root`; editor on category → forbidden; editor on tag → ok; audit `taxonomy.use_for_changed` content-free | as stated |
| `pack/use-for` (packs test) | every registry pack | roots + option groups declare `useFor`; Bookshop roots `[book]`; restaurant roots `[foodOrDrink]`; plan → apply writes `useFor` on created nodes only |

---

# C7 — Pack format

## C7.1 Purpose

Generalise D-1 "starter presets" into **packs**: typed, versioned, validated bundles of *ordinary data* that Setup can preview and add to an installation at any time (K-6). A pack adds what is missing, never changes or deletes what exists, never touches currency, and leaves everything editable. Runtime code never learns which pack was applied.

Seven packs at launch (K-6): **Pizzeria, Traditional restaurant, Fine dining, Café and bar, Wine bar, Empty** (the six restaurant starters; five carry content, Empty carries none) and **Bookshop**.

Location: `src/lib/modules/catalogue/packs/` — `types.ts`, `registry.ts` (the typed registry; one file per pack under `declarations/`), `validate.ts`, `plan.ts`, `apply.ts` (pure mutation builder), `service.ts` (impure application), `history.ts`. The old `ModuleStarterPreset` / `presets.ts` machinery stays for other modules; the Catalogue's `starterPresets` entry is removed from its manifest (superseded).

## C7.2 Declaration

```ts
export type PackId = 'pizzeria' | 'traditional-restaurant' | 'fine-dining' | 'cafe-and-bar' | 'wine-bar' | 'empty' | 'bookshop'
export type PackLocalized = { en: string; it: string; de: string } & Record<string, string | undefined>   // launch packs: en/it/de required

export type PackCategory = {
  key: CategoryKey                          // STABLE IDENTITY across versions; never a translated string
  label: PackLocalized
  parent: CategoryKey | null                // a key declared in this pack; tree order = array order among siblings
  /** Suggested rules, only for channels this pack also suggests. 'inherit' is not expressible. */
  /** Suggested COMPLETE rules (D-6): baseline + optional weekly overrides. Only for channels this pack also suggests. 'inherit' is not expressible. */
  channelRules?: Record<ChannelKey, PackAvailabilityRule>
  defaultOptionGroups?: string[]            // PackOptionGroup keys; apply to NEW items only
}
export type PackWeeklyOverride = { key: string; days: Weekday[]; from: string | null; to: string | null; state: ChannelAvailabilityState }   // = C5a ScheduledOverride kind 'weekly'; to <= from = overnight (days name the START day)
export type PackAvailabilityRule = { state: ChannelAvailabilityState; overrides?: PackWeeklyOverride[] }
export type PackTag = { key: TagKey; label: PackLocalized }

/** Never auto-activated (K-6, brief 6.3 step 2): applied only if the person ticks it in the preview. */
export type PackChannelSuggestion = {
  key: ChannelKey; label: PackLocalized; preselected: boolean
  /** REQUIRED (X-11). Written explicitly with the channel (C2: Setup and packs always write both `active` and `defaultAvailability`). Shown in the preview. */
  defaultAvailability: ChannelAvailabilityState
  /** Optional weekly overrides of that baseline (C2 `defaultSchedule`, e.g. delivery only in the evening). */
  defaultSchedule?: PackWeeklyOverride[]
}

export type PackSection = { key: string; name: PackLocalized; children?: PackSection[] }
export type PackCollection = { key: string; name: PackLocalized; collectionType: 'menu' | 'list'; sections: PackSection[] }

export type PackOptionGroup = {            // shape = catalogueOptionList minus ids/lifecycle
  key: string; name: PackLocalized; min: number; max: number | null
  choices: { key: string; label: PackLocalized; priceDelta: 0; kind: 'add' | 'remove' }[]   // price deltas are never suggested (no money in a pack)
}

export type PackDeclaration = {
  id: PackId
  version: number                           // positive integer; continues the preset numbering (restaurant/bookshop were v2) → launch packs are v3
  name: PackLocalized
  description: PackLocalized
  empty?: true                              // Empty pack: every list below must be empty and every suggestion absent
  suggestedPublicName?: PackLocalized       // C11; fill-if-empty, never overwrites
  suggestedSegment?: string                 // D11 segment; validated with validateSegment; applied only when no segment exists yet
  suggestedDefaultProfile?: ItemProfile     // existing PROFILES id; fill-if-empty
  channels: PackChannelSuggestion[]
  categories: PackCategory[]
  tags: PackTag[]
  collections: PackCollection[]
  formatSuggestions: FormatTemplate[]       // C3: project-level reusable format templates (e.g. Glass 15 cl, Bottle 75 cl)
  optionGroups: PackOptionGroup[]
  policySuggestions: PublicationStandardSuggestion[]   // C6: internal tenant standards only, never external marketplace policies (brief 2.6)
}
```

*D-22 (2026-11-03):* `PackCategory.useFor?: ItemProfile[]` (roots only), `PackTag.useFor?`, `PackOptionGroup.useFor?` — rules and validation codes (`pack_use_for_missing`, `pack_use_for_not_root`) in **C1.12.8**.

**Forbidden content (test-enforced):** any key named `currency`; any money amount; any `_id`; any `appliedPack` reference; any external-channel policy; any reference to Studio.

## C7.3 Validation at build time (`validatePackDeclaration`, run by a vitest over the registry)

`validatePackDeclaration(pack, ctx) → PackIssue[]` where `PackIssue = { code, path, message }`. Stable codes:

| Code | Rule |
|---|---|
| `pack_id_invalid` / `pack_id_duplicate` | kebab-case; unique in the registry |
| `pack_version_invalid` | positive integer; strictly greater than every earlier version of the same id (a registry snapshot test pins released versions) |
| `pack_label_missing` | every label has `en`, `it`, `de`, non-empty, ≤ 80 chars (names/descriptions ≤ 200) |
| `pack_key_invalid` / `pack_key_duplicate` | `isValidTermKey` for categories/tags; unique per area; section keys unique per collection tree; option-group keys unique |
| `pack_parent_unknown` / `pack_cycle` / `pack_depth` | parents exist; `buildTree` over the declaration yields no issues; depth ≤ 4 (packs guide, storage allows more) |
| `pack_channel_default_missing` | a channel suggestion without an explicit `defaultAvailability` (C2 would read a missing value as `unavailable` and a fresh install would be invisible everywhere) |
| `pack_schedule_invalid` | any category rule or channel default whose schedule fails C5a `scheduleIssues` (overlap, malformed time, >14 overrides, unknown day); the C5a code is carried in `message` |
| `pack_rule_channel_unknown` | `channelRules` only name keys in this pack's `channels` |
| `pack_empty_not_empty` | `empty: true` ⇒ no content, no suggestions |
| `pack_segment_invalid` | `suggestedSegment` passes `validateSegment` with default context |
| `pack_profile_unknown` | profile id exists in `PROFILES` |
| `pack_currency_present` | deep scan finds a `currency` key or an ISO currency value |
| `pack_too_large` | exceeds `MAX_CATEGORIES`/`MAX_TAGS`, or planned mutation count / payload for an empty project exceeds the single-transaction budget (not an error: sets `needsChunking`, asserted in a fixture only for the synthetic oversize pack) |
| `pack_option_ref_unknown` | `defaultOptionGroups`, collection refs name declared groups |
| `pack_runtime_branch` | registry consumers outside the allow-list (C7.9) |
| `pack_use_for_missing` / `pack_use_for_not_root` | D-22: a root category or option group of a non-empty pack without `useFor`; a `useFor` on a child category (C1.12.8) |

## C7.4 Current state, equivalence, plan

```ts
export type PackArea = 'category' | 'tag' | 'collection' | 'section' | 'optionGroup' | 'formatSuggestion' | 'channelSuggestion' | 'setting' | 'policySuggestion'

export type CatalogueState = {            // everything planPack needs; read by the service, passed in so planPack stays pure
  projectSlug: string
  defaultLocale: string; locales: readonly string[]
  categories: readonly CategoryNode[]; tags: readonly TagNode[]
  channels: readonly Channel[]                                 // C2 (key, label, active, defaultAvailability)
  settings: { setupCompletedAt: string | null; /* module config, X-7 */ publicSegment: string | null; publicSegmentHistory: readonly string[]; publicName: Localized; defaultItemProfile: ItemProfile | null }
  collections: readonly { id: string; exists: 'draft' | 'published' | 'both'; name: Localized; slugs: Localized; sectionKeys: readonly string[] }[]
  takenSlugs: readonly { locale: string; slug: string; id: string }[]    // items + collections share one namespace (D11.1)
  optionLists: readonly { id: string; exists: 'draft' | 'published' | 'both'; name: Localized }[]
  formatTemplates: readonly FormatTemplate[]                   // C3
  pageFirstSegments: readonly string[]
  history: readonly AppliedPackRecord[]
}

export type PlanItem = {
  area: PackArea
  key: string                              // stable key (or setting id)
  parentKey?: string | null
  label: PackLocalized | Localized
  id?: string                              // deterministic document id for collections/option groups
  requiresConfirmation?: boolean           // channel suggestions; settings the person may decline
  note?: 'archived_in_project'             // equivalent node exists but is archived: left archived
}
export type PlanConflict = {
  code: PackConflictCode
  area: PackArea; key: string
  blocking: boolean
  detail?: Record<string, string>
}
export type PackConflictCode =
  | 'pack_already_applied'          // blocking: same id@version in history
  | 'segment_clash'                 // blocking: suggestedSegment would be written and validateSegment fails (reserved/page/…)
  | 'slug_collision'                // blocking until the selection supplies a slugOverride: pack collection slug already used by another item/collection
  | 'limit_exceeded'                // blocking: result would exceed MAX_CATEGORIES/MAX_TAGS
  | 'parent_differs'                // info: same key exists under a different parent — left exactly as is
  | 'label_differs'                 // info: same key, different label — tenant's label wins
  | 'setting_differs'               // info: publicName/defaultItemProfile/segment already set to something else — not changed
  | 'rule_skipped_inactive_channel' // info: pack rule for a channel the person did not activate — not written
export type LabelProposal = {         // NEVER merged automatically
  area: 'category' | 'tag'; packKey: string; existingKey: string
  basis: 'default_locale_label' | 'any_locale_label'      // folded, case/accent-insensitive
}
export type PackPlan = {
  pack: { id: PackId; version: number }
  add: readonly PlanItem[]
  equivalent: readonly PlanItem[]
  conflicts: readonly PlanConflict[]
  proposals: readonly LabelProposal[]
  fingerprint: string                // hash of (pack id, version, canonical add/equivalent/conflict lists, state revision tokens)
  needsChunking: boolean
}

export function planPack(current: CatalogueState, pack: PackDeclaration, selection?: PackSelection): PackPlan
```

**Equivalence is by stable key only.** `planPack` classifies each declared element:

- category/tag: **equivalent** if a node with the same `key` exists in the project (any archived state; archived stays archived, `note: 'archived_in_project'`); else **add**.
- collection / option group: **equivalent** if the deterministic id `catalogue-collection.<project>.<packKey>` / `catalogue-option-list.<project>.<packKey>` exists as draft or published; else **add**. (A tenant-made "Menu" collection has a random id, so it is not equivalent; collections get no label proposals — the preview lists the person's existing collections beside the pack's, and the shared-slug check blocks an accidental collision.)
- section: equivalent if the parent collection exists with that section `_key`; sections of an *equivalent* collection that are missing are **added at the end** (update path only; see C7.8). Fresh collections add all their sections.
- format suggestion: equivalent if a template with the same `key` exists (C3).
- channel suggestion: equivalent if a channel with the same `key` exists (active or not); else **add** with `requiresConfirmation`.
- settings: `publicName`, `defaultItemProfile`, `publicSegment` are **fill-if-empty**: add when empty, `setting_differs` info when set and different, equivalent when equal.

**Label matches are proposals.** For each *add* category/tag whose default-locale label (folded) equals a different existing node's label in any locale, emit a `LabelProposal`. The preview shows "Looks like your *Dolci*. [Use yours] [Add anyway]". Nothing is merged by the planner. A person's explicit choice enters `PackSelection.resolutions` (below) and is recorded in history; the pack's children then attach to *their* node. Default for an unanswered proposal is **add anyway** (the literal pack the preview showed), never merge.

```ts
export type PackSelection = {
  acceptChannels: readonly ChannelKey[]                       // only these suggested channels are created, each with `active: true` and the pack's declared `defaultAvailability`
  acceptSettings: readonly ('publicName' | 'defaultItemProfile' | 'publicSegment')[]
  resolutions: Readonly<Record<string, { use: 'existing'; key: string } | { use: 'add' }>>   // key "category:<packKey>" / "tag:<packKey>"
  exclude: readonly string[]                                  // "<area>:<key>" the person unticked (and, for categories, their whole subtree)
  slugOverrides: Readonly<Record<string, Localized>>          // collection key → slug per locale, to clear slug_collision
  channelRules: 'apply' | 'skip'                              // brief 6.3 step 4 — rules only for accepted channels; 'skip' ALSO writes accepted channels without defaultSchedule (a channel whose baseline is unavailable only because of its schedule declares defaultAvailabilityWithoutSchedule: 'available', used in that case)
}
```

**Exact preview.** `planPack(current, pack, selection)` is what the preview renders and what `applyPack` executes: `applyPack` recomputes the plan from fresh state and compares `fingerprint`; a different fingerprint returns `pack_plan_changed` with the new plan instead of applying (AC-04 "exact preview").

## C7.5 Application — all-or-nothing, retry-safe, stable identity

```ts
export type AppliedPackRecord = {
  _key: string                    // `${id}@${version}` — one entry per pack version
  id: PackId; version: number
  appliedAt: string; appliedBy: string               // user id (ctx.userId)
  added: { categories: string[]; tags: string[]; collections: string[]; sections: string[]; optionGroups: string[]; channels: string[]; formats: string[]; settings: string[] }  // keys only
  mapped: Record<string, string>                     // packKey -> existing key chosen by the person ("category:dolci": "desserts")
  skipped: string[]                                  // "<area>:<key>" unticked or not applicable
}
export type ApplyPackResult =
  | { ok: true; record: AppliedPackRecord; plan: PackPlan }
  | { ok: false; code: PackErrorCode; plan?: PackPlan; detail?: unknown }
export type PackErrorCode =
  | 'pack_unknown' | 'pack_forbidden' | 'pack_already_applied' | 'pack_blocked' | 'pack_plan_changed'
  | 'pack_conflict' | 'pack_interrupted' | 'pack_failed'
export function applyPack(ctx, projectId, req: { packId: PackId; version: number; selection: PackSelection; planFingerprint: string }, deps?): Promise<ApplyPackResult>
```

**Identity = stable key, never a localized name.** Deterministic document ids: collections `catalogue-collection.<projectSlug>.<packKey>`, option lists `catalogue-option-list.<projectSlug>.<packKey>` (draft copies use the `drafts.` prefix; created as **drafts**, never published by a pack); categories/tags/channels/format templates are keyed entries inside their owning documents (`_key` = key). History entry `_key = <id>@<version>`.

**Strategy.** `buildPackMutations(plan, selection, state, now) → { chunks: Mutation[][]; history: AppliedPackRecord; singleTransaction: boolean }` is pure and tested without Sanity. `Mutation` is one of: `createIfNotExists(doc)`, `patchInsertNodes(taxonomyDoc, nodes)` (one patch inserting all new category and tag nodes after the last existing sibling, guarded by `ifRevisionId`), `patchSetIfMissing(config…)`, `patchInsertChannels` (via C2's writer shape), `patchInsertSections(collection, sections)`, `createHistoryOrInsert`. Every mutation is idempotent *relative to a fresh plan*: a retry replans, and anything already present is `equivalent`, so nothing is added twice.

1. **Fast path — one Sanity transaction** whenever the planned mutation count ≤ `PACK_MAX_MUTATIONS_PER_TX = 100` and serialized payload ≤ `PACK_MAX_TX_BYTES = min(1_000_000, SANITY_MUTATION_MAX_BYTES)` (the second is the single named constant in `src/lib/sanity/limits.ts`, 4 MB per Sanity's technical limits; the 1 MB budget is deliberately far under it). All creates, all node inserts, settings, and the history entry commit together: `applied` exists **iff** everything exists. The transaction carries a deterministic `transactionId = "abluo-pack-" + sha1(project|id|version|fingerprint)`; a duplicate-transaction error means the first attempt committed (the response was lost) and the service verifies by replanning (empty `add` ⇒ success).
2. **Large packs (should not occur at launch; designed for)** — chunk order: **chunk 0** = taxonomy insert (categories+tags are *always* one patch: the tree is never split) + the run marker `catalogue-pack-run.<project>.<id>@<version>` (type `cataloguePackRun`, `status: 'running'`, journal of what chunk 0 added); **chunks 1…n** = collections, option lists, format templates in dependency order, each appending its added keys to the run marker's journal inside the same transaction; **final chunk** = settings + channels + history entry insert + run marker delete. A failure at chunk k leaves valid, ordinary, editable content and **no history entry**; Setup shows "Setup was interrupted — resume" from the run marker (this marker is installation bookkeeping, not an "applied" record). Retry replans: earlier chunks' output is `equivalent`; the journal supplies the complete `added` list for the final history entry (otherwise a resumed pack would under-report). Re-running after full success is refused `pack_already_applied`.
3. **History document.** `cataloguePackHistory`, `_id = catalogue-packs.<projectSlug>`, `liveEdit`, `applied: AppliedPackRecord[]`. Created with `create` (fails if concurrently created) when absent at plan time, else patched with `ifRevisionId`; this is in the same transaction as the content, so no window exists in which content exists, the record does not, and a *second* application of the same version could pass the check. It is **not** stored on the installation, so the record commits in the same transaction as the content without contending on the project document (REVIEW A6/C-9; the Rev 1 rationale about the Modules pane was wrong — that pane patches changed keys with `ifRevisionId`).

**Guarded set (C-10).** Every document the transaction writes is revision-guarded and part of the plan `fingerprint`: the `catalogueTaxonomy` document, the `cataloguePackHistory` document, **and the project document (`project` `_rev`)**, which the same transaction patches for channels, `formatTemplates`, `publicName`, `defaultItemProfile`, `publicSegment`, `setupCompletedAt`. A concurrent Settings or billing write to the project document between plan and apply is therefore detected (`pack_conflict`, fresh plan) instead of silently interleaved. Settings are fill-if-empty patches (`setIfMissing`), so no existing value is overwritten even if the guard were absent.

**Existing collections (C-11).** Sections added to an equivalent collection (update path) are written to its **draft**: if only a published copy exists, the draft is created from it first, then patched; the published copy is never patched. "Never published by a pack" covers creates only.

**Document builders (C-12).** Collections and option lists are built with the same builder the dashboard create path uses (`publicId`, `projectSlug`, lifecycle fields, localized slug rules) and only the `_id` is overridden with the deterministic id — never raw `createIfNotExists` of a hand-written document. Test: a pack-created collection passes the dashboard's own validation and a `cataloguePrepare` dry-run as a draft.

**Concurrency and conflicts.** `ifRevisionId` on the guarded set above; 409 ⇒ `pack_conflict` with a fresh plan (the person re-confirms). `assertSingleSanityProject` before any write. Permission: C8 "manage Catalogue setup" (owner/admin-equivalent, K-5), checked before any I/O.

**Never done by application (test-enforced by plan invariants):** overwrite or rename an existing node; reorder existing siblings (new nodes append); change `parentKey` of an existing node; delete anything; unarchive; touch `currency`; activate a channel not in `acceptChannels`; set a channel rule on a channel that is not active after the application; publish a created collection/option list; change an item.

## C7.6 Update offer for a newer version

```ts
export function planPackUpdate(
  current: CatalogueState, applied: AppliedPackRecord, previous: PackDeclaration | null, next: PackDeclaration, selection?: PackSelection
): PackPlan & { removedByTenant: readonly PlanItem[]; noLongerInPack: readonly PlanItem[] }
```

- Offered in Setup when the registry has a version greater than the highest applied version of that pack id. **Never automatic**; dismissible per version (a Setup preference, not history).
- `add` = elements new in `next` (by key) that are absent from the project. Elements that were in the earlier record's `added` but are now gone from the project are **`removedByTenant`** — not re-added (the tenant deleted them). Elements that the tenant renamed or moved are `equivalent` (info conflicts as above). Elements dropped from `next` are `noLongerInPack` — kept, never deleted.
- The record for version N+1 is a new history entry; earlier entries stay.
- Legacy installs: the one existing `appliedPreset` (`tmz`, `bookshop` v1) is converted **once**, by data step **D3** of the C10 plan (below), into a history entry `bookshop@1` with `added.settings = ['publicSegment','defaultItemProfile']`; Setup then offers `bookshop@3` as an update showing its new categories/tags/formats as optional additions (D-13). Legacy `appliedPreset` stays on the installation as an inert field until R3.

*Decided — Tom 2026-11-02, D-13 (all four parts):* (1) tmz's `bookshop v1` record is converted to pack history (D3); (2) the newer Bookshop pack is offered as an **optional, non-destructive update**; (3) Bookshop's future default profile is **Book** — tmz's existing `product` profile is **not** changed automatically (`defaultItemProfile` is fill-if-empty); (4) the legacy `presetId` image-shape fallback is **replaced before the field is removed** — `dashboard-queries.ts` and `list-model.ts` stop reading `appliedPreset`/`presetId` and use `catalogueImageShape({ defaultItemProfile })` from module config; C10's fixture `image-shape/tmz-fallback` must show the resolved frame shape for tmz's items without a profile is identical before and after, and if it differs D3 writes the shape once as an explicit per-project setting instead (never a behaviour change); only then do the two guard exceptions and the field go (R3); (5) the **module installation flow asks for the public URL segment** (required, no default, `validateSegment`, ADR-033 C1) — packs no longer run at install and only ever fill an empty segment.

**D3 — `appliedPreset` → `cataloguePackHistory`** (`scripts/catalogue/migrate-pack-history.mjs`; idempotent; audited `migration.pack_history`): for each installation with `appliedPreset{id,version,appliedAt}` and no history entry `<id>@<version>`: create or patch `catalogue-packs.<slug>` adding `{_key:'<id>@<version>', id, version, appliedAt, appliedBy:'migration', added:{settings:[the preset's config keys, never currency]}, mapped:{}, skipped:[]}`; set `setupCompletedAt = appliedAt`, `setupSource='pack'` in module config if unset. Equivalence: the history lists exactly the legacy record; `listPacks` offers `bookshop@3` as an update; no content, setting or label changed (diff of all Catalogue documents before/after is empty). R1's reader already treats the legacy record as the virtual entry, so D3 only makes it permanent.

## C7.7 Empty pack

`empty` pack: `empty: true`, all lists empty, no suggestions. Applying it writes one history entry (`added` all empty) and **sets `setupCompletedAt` with `setupSource: 'empty'`** (C7.9). Wizard "Start empty" = apply `empty`. "Save and exit" records nothing. Applying `empty` after other packs is allowed (it is a no-op record) but pointless; the UI hides it once any pack is recorded.

## C7.8 Segment collisions and currency

- `suggestedSegment` is written only when the project has **no** `publicSegment` yet; otherwise `setting_differs`/equivalent. When it would be written, `validateSegment(segment, {pageFirstSegments, history})` must be `ok`; a clash is `segment_clash` (**blocking**) with the clash kind in `detail`. Collision between a pack collection's slug and an existing item/collection slug (D11.1) is `slug_collision` (blocking until `slugOverrides` clears it).
- The preview shows the project's current currency read-only. No code path in `packs/` imports or references `currency` except the preview renderer (test: grep + type).

## C7.9 The guard (generalised)

Setup/history facts are **installation history**. Replace `applied-preset-guard.test.ts` by `applied-pack-guard.test.ts` with the same walk-and-grep structure:

- Forbidden outside the allow-list: the identifiers `appliedPacks`, `cataloguePackHistory`, `AppliedPackRecord`, `catalogue-packs.`, and imports from `lib/modules/catalogue/packs/history`. Allow-list: `lib/modules/catalogue/packs/**`, the Setup pack/starter screens under `components/client/catalogue/setup/**`, the migration script, and the tests.
- Retain the legacy identifier `appliedPreset` allow-list until cleanup; the two narrowed exceptions (`dashboard-queries.ts`, `list-model.ts`, image-shape fallback for items without a profile) are re-checked and removed in the cleanup release (note: they read `presetId` today — replaced per D-13 part 4 (C7.6) before R3; fixture `image-shape/tmz-fallback` below).
- Additional test: no module outside `packs/` imports `registry.ts` of packs by pack id (`PACK_REGISTRY`) — only enumeration (`listPacks()`) and `getPack(id)` for Setup.
- **Setup state is not pack history.** Brief 6.1 ("food setup never completed" from inside the item editor) needs one runtime fact. *Decided — Tom 2026-11-02, D-14.* `setupCompletedAt?: string` and `setupSource?: 'empty' | 'pack' | 'manual'` live in Catalogue **module config**, stored separately from pack history. Starting empty (`'empty'`), applying any pack (`'pack'`) or deliberately marking setup complete in Setup (`'manual'`) each satisfy completion. The item editor may call `isSetupComplete(config): boolean` (reads `setupCompletedAt` only) — never `setupSource`, never which pack: `setupSource` and the pack history are readable only by Setup (allow-listed by the guard). `isSetupComplete` is the sole export the editor may import from `packs/`.

## C7.10 Pack contents — outlines for review (not final copy)

All category keys are stable `snake_case`; `›` shows nesting; labels are en / it / de for **top-level** categories (children carry en/it/de in the declaration; shown by key here). Channel suggestion keys: `dine-in`, `takeaway`, `delivery`, `room-service` (kept hyphenated as in the current `restaurant` preset; C2's channel-key pattern accepts hyphens — *Decided — Tom 2026-11-02, D-21*). Rules are *suggestions applied only for accepted channels*; `{unavailable}` / `{available}` are complete rules with no schedule; everything not listed stays `inherit` (the project default / C2 decides). Times are wall-clock in the project time zone (C5a).

**Design note shared by all wine-carrying packs.** Glass vs bottle is a **format**, not a category: wine categories are by *kind*, and the pack suggests the format templates *Glass 15 cl*, *Glass 25 cl*, *Bottle 75 cl*, *Half bottle 37.5 cl* (C3). Putting "By the glass" in the tree would force an item to choose one and break availability rules per format.

### Pizzeria — `pizzeria` v3
Public name suggestion: Menu / Menu / Speisekarte · profile `foodOrDrink` · channels: dine-in ✓, takeaway ✓ (`defaultAvailability: available`), delivery ✓ (`defaultAvailability: unavailable` + `defaultSchedule` 18:00–23:00 every day, i.e. evening delivery; `defaultAvailabilityWithoutSchedule: available`), all preselected; room-service not suggested.
Categories
- Pizza / Pizza / Pizza (`pizza`) › Classiche (`pizza_classiche`), Bianche (`pizza_bianche`), Speciali (`pizza_speciali`), Calzoni (`calzoni`)
- Starters / Antipasti / Vorspeisen (`starters`) › Fritti (`fried_starters`), Taglieri (`boards`)
- Salads / Insalate / Salate (`salads`)
- Desserts / Dolci / Desserts (`desserts`)
- Beverages / Bevande / Getränke (`beverages`) › Soft drinks (`soft_drinks`), Beer (`beer`), Wine (`wine`), Spirits and digestifs (`spirits`)
Rules: `spirits` × `delivery` = `{unavailable}` (suggestion only; the tenant's licence and local rules decide) · everything else inherits. **Schedule (D-6):** channel `delivery` suggests `defaultAvailability: unavailable` + weekly override `available` 18:00–23:00 every day (`defaultSchedule`), i.e. delivery in the evening only — preselected but shown in the preview; dine-in and takeaway stay available all week.
Tags (dietary claims are a controlled declaration, never a tag — brief 9): Chef's choice (`chefs_choice`), New (`new`), Seasonal (`seasonal`), Spicy (`spicy`), Local (`local`).
Collections: Menu (`menu`, type `menu`): sections Pizza, Starters, Salads, Desserts, Beverages (section keys = same names, independent of categories).
Formats: *Glass 25 cl*, *Bottle 33 cl*, *Bottle 75 cl* (no pizza sizes: they vary per tenant).
Option groups: Extra toppings (`extra_toppings`, add, 0..5), Remove ingredients (`remove_ingredients`, remove). Default for `pizza` subtree.
Policy suggestions: require photo as **Recommended** for Pizza.

### Traditional restaurant — `traditional-restaurant` v3
Public name: Menu / Menu / Speisekarte · `foodOrDrink` · channels (all `defaultAvailability: available`): dine-in ✓, takeaway ✓ preselected; delivery and room-service offered, not preselected.
- Starters / Antipasti / Vorspeisen (`starters`)
- First courses / Primi piatti / Erste Gänge (`first_courses`) › Pasta (`pasta`), Soups and risotto (`soups_risotto`)
- Main courses / Secondi piatti / Hauptgerichte (`main_courses`) › Meat (`meat`), Fish (`fish`), Vegetarian (`vegetarian_mains`)
- Side dishes / Contorni / Beilagen (`sides`)
- Desserts / Dolci / Desserts (`desserts`)
- Beverages / Bevande / Getränke (`beverages`) › Soft drinks, Beer, Coffee, Digestifs (`digestifs`)
- Wine / Vini / Weine (`wine`) › Red (`wine_red`), White (`wine_white`), Rosé (`wine_rose`), Sparkling (`wine_sparkling`), Sweet (`wine_sweet`)
Rules: `wine` × `takeaway` = `{unavailable}` (suggestion). **Schedules (D-6):** `lunch_specials` — Lunch specials / Piatti del giorno / Mittagsgerichte (new top-level category) — `dine-in` and `takeaway` = baseline `unavailable` + weekly override `available` 12:00–15:00 Mon–Sat (a lunch menu is a category rule; the *Lunch* collection stays presentation, D-6.2).
Tags: Chef's choice, Seasonal, Local, House speciality (`house_speciality`).
Collections: Menu + Wine list (`wine_list`, type `list`) with sections per wine kind.
Formats: Glass 15 cl, Bottle 75 cl, Half bottle 37.5 cl.
Option groups: Side choice (`side_choice`, min 1 max 1), Cooking point (`cooking_point`) for `meat`.

### Fine dining — `fine-dining` v3
Public name: Menu / Menu / Menü · `foodOrDrink` · channels (all `defaultAvailability: available`): dine-in ✓ preselected; takeaway and delivery offered, not preselected.
- Amuse-bouche / Amuse-bouche / Amuse-Bouche (`amuse`)
- Tasting menus / Menu degustazione / Degustationsmenüs (`tasting_menus`)
- À la carte / Alla carta / À la carte (`a_la_carte`) › Starters (`starters`), Fish (`fish`), Meat (`meat`), Vegetarian (`vegetarian`)
- Cheese / Formaggi / Käse (`cheese`)
- Desserts and petits fours / Dolci e piccola pasticceria / Desserts und Petits Fours (`desserts`)
- Wine / Vini / Weine (`wine`) › Red, White, Sparkling and Champagne (`wine_sparkling`), Sweet
- Pairings / Abbinamenti / Weinbegleitung (`pairings`)
- Beverages / Bevande / Getränke (`beverages`)
Rules: none besides the schedule. **Schedule (D-6):** `tasting_menus` × `dine-in` = baseline `unavailable` + weekly override `available` 19:00–23:00 Tue–Sun (the Dinner example: baseline unavailable, scheduled available).
Tags: Signature dish (`signature`), Seasonal (`seasonal`).
Collections: Menu, Tasting menu (`tasting`), Wine list.
Formats: Glass 10 cl, Glass 15 cl, Bottle 75 cl, Magnum 150 cl.
Option groups: none (set menus carry their own structure); policy suggestion: description **Recommended** for every item; photo not requested.

### Café and bar — `cafe-and-bar` v3
Public name: Menu / Menu / Karte · `foodOrDrink` · channels (all `defaultAvailability: available`): dine-in ✓, takeaway ✓ preselected; delivery offered, not preselected.
- Coffee and tea / Caffè e tè / Kaffee und Tee (`coffee_tea`) › Coffee (`coffee`), Tea and infusions (`tea`)
- Breakfast / Colazione / Frühstück (`breakfast`)
- Pastries / Pasticceria / Gebäck (`pastries`)
- Sandwiches and snacks / Panini e snack / Sandwiches und Snacks (`sandwiches_snacks`)
- Cocktails / Cocktail / Cocktails (`cocktails`)
- Beer and wine / Birre e vini / Bier und Wein (`beer_wine`)
- Soft drinks and juices / Bibite e succhi / Softdrinks und Säfte (`soft_drinks_juices`)
Rules: `beer_wine` × `takeaway` = `{unavailable}` (suggestion). **Schedules (D-6):** `breakfast` × `dine-in`/`takeaway` = baseline `unavailable` + weekly override `available` 07:00–11:00 every day; `cocktails` × `dine-in` = baseline `unavailable` + weekly override `available` 17:00–01:00 every day (overnight; `days` name the start day), × `takeaway` = `{unavailable}`.
Tags: New (`new`), Seasonal (`seasonal`), Local (`local`), Barista's choice (`baristas_choice`).
Collections: Menu (sections per category group), Breakfast (`breakfast_menu`).
Formats: Small / Medium / Large (generic, `size_s`,`size_m`,`size_l`), Glass 25 cl, Glass 40 cl.
Option groups: Milk choice (`milk_choice`), Extras (`extras`: extra shot, syrup).

### Wine bar — `wine-bar` v3
Public name: Wine list / Carta dei vini / Weinkarte · `foodOrDrink` · channels (all `defaultAvailability: available`): dine-in ✓ preselected; takeaway (bottle shop) and delivery offered, not preselected.
- Wine / Vini / Weine (`wine`) › Red (`wine_red`), White (`wine_white`), Rosé (`wine_rose`), Orange (`wine_orange`), Sparkling (`wine_sparkling`), Sweet and fortified (`wine_sweet`)
- Small plates / Piccoli piatti / Kleine Gerichte (`small_plates`)
- Cheese and charcuterie / Taglieri / Käse und Wurst (`boards`)
- Beer and spirits / Birre e distillati / Bier und Spirituosen (`beer_spirits`)
- Non-alcoholic / Analcolici / Alkoholfrei (`non_alcoholic`)
Rules: `small_plates` × `takeaway` = `{unavailable}` (suggestion), `wine` × `takeaway` = `{available}` (explicit, if takeaway accepted — a complete all-week rule). No schedules.
Tags: Natural (`natural`), Organic (`organic`), Local (`local`), Staff pick (`staff_pick`), Limited (`limited`).
Collections: Wine list (`wine_list`, sections per wine kind), Food (`food_menu`).
Formats: Glass 10 cl, Glass 15 cl, Bottle 75 cl, Half bottle 37.5 cl, Magnum 150 cl.
Option groups: none.

**Rule on defaults (all packs).** Every suggested channel declares an explicit default: `available` all week, except Pizzeria `delivery` (baseline `unavailable` + 18:00–23:00 `available`). No fresh pack is unavailable on every channel at every hour. Restrictions and schedules are expressed as category rules and channel defaults, listed in the preview with the `availabilityImpact` counts C5 computes for the tree being added. Empty and Bookshop suggest no channel.

### Empty — `empty` v3 (declared `version: 3` so all launch packs share one version)
No content. Effect: one history entry + setup marker.

### Bookshop — `bookshop` v3
Public name: Books / Libri / Bücher · profile **`book`** (the brief) — the current preset says `product` (D-13/F8) · segment suggestion `books` (fill-if-empty) · channels: none (no channel is suggested, so nothing is gated: the website shows every published item with its standard price, K-3.7) · formats: Paperback (`paperback`), Hardcover (`hardcover`), E-book (`ebook`).
- Fiction / Narrativa / Belletristik (`fiction`) › Literary fiction (`literary_fiction`), Crime and thriller (`crime_thriller`), Science fiction and fantasy (`sff`)
- Non-fiction / Saggistica / Sachbuch (`non_fiction`) › Biography and memoir (`biography_memoir`), History (`history`), Science and technology (`science_tech`), Art and design (`art_design`)
- Children and young adults / Ragazzi / Kinder und Jugend (`children_ya`)
- Travel and cookery / Viaggi e cucina / Reise und Küche (`travel_cookery`)
Tags: New (`new`), Staff pick (`staff_pick`), Signed copy (`signed_copy`), Illustrated (`illustrated`), Local author (`local_author`).
Collections: All books (`all_books`, type `list`, one unnamed section).
Option groups: none. Rules: none (no channels).
Note for tmz: its existing keys (`technology`, `design`, `literature`) are not pack keys; the update offer therefore shows the pack's categories as additions and, for tmz's Design/Technology, **label proposals** only if default-locale labels match (they do not today: pack uses "Art and design", "Science and technology").

## C7.11 Named test fixtures

| Fixture | Input | Expected |
|---|---|---|
| `pack/registry-valid` | every declaration | `validatePackDeclaration` → `[]` |
| `pack/missing-locale` | label without `de` | `pack_label_missing` |
| `pack/currency` | any key `currency` | `pack_currency_present` |
| `pack/empty-has-content` | `empty:true` + one category | `pack_empty_not_empty` |
| `pack/cycle` | `a.parent=b, b.parent=a` | `pack_cycle` |
| `plan/empty-project` | Pizzeria on a project with nothing | `add` = every category/tag/collection/section/option group/format/channel suggestion; `equivalent=[]`; `conflicts=[]` |
| `plan/idempotent` | plan, apply (fake client), plan again | second plan `add=[]`, everything `equivalent`; `pack_already_applied` blocking |
| `plan/key-equivalence` | tenant has `pizza` under `food` | `pizza` equivalent; `pizza_bianche` add with parent `pizza`; no `parent_differs` when parents match; `parent_differs` info when tenant's `pizza` is a root |
| `plan/label-is-proposal` | tenant node `dolci`, label it `Dolci`; pack `desserts` it `Dolci` | `desserts` in `add`; one `LabelProposal{desserts→dolci}`; not in `equivalent`; apply without a resolution adds `desserts` |
| `plan/resolution-use-existing` | same, `resolutions['category:desserts']={use:'existing',key:'dolci'}` | no `desserts` added; pack children of `desserts` attach under `dolci`; history `mapped={ 'category:desserts':'dolci' }` |
| `plan/archived-equivalent` | tenant `pizza` archived | equivalent with note; not unarchived by apply |
| `plan/segment-clash` | project has no segment; pack suggests `menu`; page `menu/lunch` exists | `segment_clash` blocking; apply → `pack_blocked`, zero writes |
| `plan/segment-set` | project segment `carta` | `setting_differs` info; segment unchanged |
| `plan/slug-collision` | tenant item slug `menu` in en | `slug_collision` blocking; with `slugOverrides` → clears |
| `plan/limit` | project at 299 categories, pack adds 5 | `limit_exceeded` blocking |
| `plan/channel-default-explicit` | Pizzeria, `acceptChannels=[dine-in,takeaway,delivery]` | dine-in and takeaway written `active:true, defaultAvailability:'available'`; delivery `defaultAvailability:'unavailable'` with the 18:00–23:00 schedule; a declaration without the field fails `pack_channel_default_missing`; an item created afterwards is available on dine-in and takeaway all week and on delivery 18:00–23:00, except spirits on delivery (never) |
| `apply/project-rev-guard` | project document `_rev` moves between plan and apply | `pack_conflict`, zero writes; fingerprint includes the project `_rev` |
| `apply/existing-published-collection` | update adds a section to a published-only collection | draft created from published then patched; published copy byte-identical |
| `apply/builder` | pack collection | passes the dashboard create builder's validation (publicId, projectSlug, lifecycle) |
| `pack/schedule-valid` | every pack's category rules and `defaultSchedule` | pass C5a `scheduleIssues` (no overlap; times valid) |
| `pack/schedule-overlap` | two overlapping overrides in one rule | `pack_schedule_invalid` |
| `plan/category-schedules-written` | Café and bar, channels dine-in+takeaway accepted, `channelRules:'apply'` | `breakfast` rows written as `catalogueChannelRule{state:'unavailable', schedule:[07:00–11:00 available]}`; at 08:00 a breakfast item is `available`, at 12:00 `unavailable` (C5 `explainAvailability`, project zone); cocktails overnight available at 00:30 (starts the previous day) |
| `plan/channel-schedule-written` | Pizzeria, delivery accepted | channel written with `defaultAvailability:'unavailable'`, `defaultSchedule:[18:00–23:00 available]`; a fresh item is available on delivery at 19:00, not at 15:00; dine-in available all week |
| `plan/schedule-declined` | `channelRules:'skip'` | no category rule or schedule written; channels written without `defaultSchedule`: Pizzeria delivery written `available`, no schedule |
| `plan/schedules-never-overwrite` | tenant already has a rule on `breakfast` × `dine-in` | key equivalent; the tenant's rule is untouched (`setting_differs` info) |
| `plan/channels-never-activated` | `acceptChannels=[]` | no channel added; category `channelRules` for those channels reported `rule_skipped_inactive_channel` and not written |
| `plan/currency-readonly` | any | plan has no `currency` element; apply never calls a currency writer |
| `image-shape/tmz-fallback` | tmz (`appliedPreset` bookshop v1, no `defaultItemProfile` on items) | `dashboard-queries.ts`/`list-model.ts` read the image shape from `defaultItemProfile` (D-13 part 4); no `presetId` read remains; guard exceptions removable at R3 |
| `apply/single-tx` | Pizzeria, fake client | exactly one `transaction().commit()`; contains taxonomy patch, N createIfNotExists, history entry; transactionId deterministic |
| `apply/failure-no-record` | fake client throws on commit | no history entry; second call succeeds, no duplicate documents (fake store compared by id) |
| `apply/lost-response` | commit succeeded, client saw timeout; retry | duplicate-transaction handled; replan empty; returns ok once; history has one entry |
| `apply/plan-changed` | state changes between preview and apply | `pack_plan_changed` with new plan, zero writes |
| `apply/revision-conflict` | taxonomy doc rev moved | `pack_conflict`, zero writes |
| `apply/chunked` | synthetic oversize pack (250 mutations) | chunks: taxonomy+marker; docs; final; fail chunk 2 → no history, marker present, taxonomy nodes present; resume completes, `added` complete, marker gone |
| `apply/never-overwrites` | tenant renamed `pizza`, reordered siblings | after apply: labels, parents, orders of all existing nodes byte-identical; new nodes appended |
| `apply/drafts-only` | collections/option lists | created as drafts, no `publishedAt` |
| `apply/permission` | role without setup capability | `forbidden` before any read |
| `update/offer` | applied `pizzeria@3`, registry has v4 with two new categories and one dropped | `add` = 2 categories; dropped one in `noLongerInPack`; tenant-deleted v3 category in `removedByTenant`, not re-added |
| `update/never-auto` | v4 registered | no mutation without `applyPack` call |
| `empty/records-only` | apply `empty` | one history entry, `setupCompletedAt` set, no other writes |
| `guard/pack-history` | scan `src/` | history identifiers only in allow-listed files; `setupCompletedAt` readable anywhere |
| `guard/legacy-preset` | migration of `appliedPreset{bookshop,1}` | produces `bookshop@1` history entry with settings added; `bookshop@3` update offered |
| `bookshop/tmz` | tmz state (segment `books`, profile `product`) | segment equivalent, profile `setting_differs` (kept `product`), categories/tags/formats as additions |

---

# C11 — Public name

## C11.1 Purpose and the premise that does not hold

K-2 fixes the dashboard module name to "Catalogue" and introduces a tenant-chosen **public name** (Menu, Books, Wine List…) for website use, migrating `navLabel` into it "so the website keeps the name it shows today". **Verified fact F1/F3: the website shows no `navLabel` today** — it is a dashboard-only string (tmz: `navLabel = Books`, website landing title = "Between the Lines"). So there is no public name "that the website shows today" to preserve. What exists to preserve is the tenant's *chosen word*, plus the strict requirement that **the migration release changes nothing a visitor or crawler sees**.

This contract therefore separates two things K-2 combined:

1. **The migration (R-A)** — copies the tenant's word into the new field; the dashboard says "Catalogue"; **every public output is byte-identical before and after** (the proof K-2 asks for, restated on rendered outputs).
2. **The consumers (R-B)** — the two approved uses (landing-title fallback, `llms.txt` heading), each with a null behaviour equal to today's output and a before/after diff in the release notes. Nothing in R-A depends on R-B.

## C11.2 Field, type, storage

- **Name:** `publicName` (brief §25's `publicLabel` is conceptual; K-2 says "public name"; `label` is overloaded in the manifest).
- **Type:** `localizedString` config field of the Catalogue module (map `locale → string`), the same type `navLabel` has — so no new editor type, translation tooling works as for other localized config.
- **Where:** `moduleInstallations[catalogue].config.publicName`, next to `publicSegment` (ADR-014: one configuration surface). Settled by REVIEW X-7: module config holds the short scalar settings (`currency`, `publicSegment`, `publicName`, `defaultItemProfile`, `serviceChannels[]` (+`active`, `defaultAvailability`, `defaultSchedule`), `catalogueMigrations`, `formatTemplates[]`, `dietaryTags[]`, `setupCompletedAt`, `setupSource`); there is no `catalogueSettings` document. *Decided — Tom 2026-11-02, D-1.*
- **Edit surface:** Catalogue → Setup → Public website (brief §4.3) only; Studio Modules pane shows it read-only (K-7). Capability: C8 "manage Catalogue setup".
- **Validation (writes only; readers are tolerant):** each locale value trimmed, ≤ 40 characters, no markup characters (`<`, `>`), no leading/trailing punctuation; if any locale is given, the project's default-locale value is required (`public_name_default_required`); locales must be enabled website locales (`public_name_locale_unknown`); empty map is valid (= not set). Stable error codes: `public_name_default_required`, `public_name_too_long`, `public_name_invalid`, `public_name_locale_unknown`.
- Never a machine identifier: routes, ids, permission ids and GROQ stay `catalogue` (D12's rule holds); the public name is **content localization**, not a route.

## C11.3 Resolution and fallback (pure)

```ts
export type PublicNameSource = 'locale' | 'default_locale' | 'none'
export function resolvePublicName(
  names: Readonly<Record<string, string | undefined>> | null | undefined,
  ctx: { locale: string; defaultLocale: string },
): { text: string | null; source: PublicNameSource }
// names[locale] (trimmed, non-empty) → names[defaultLocale] → { text: null, source: 'none' }
```

**Fallback decision.** Locale value → default-locale value → **nothing**. It never falls back to any other locale (that would print Italian on the German site) and **never to the literal "Catalogue"**. Every consumer must treat `null` as "behave exactly as today". The one place the word "Catalogue" reaches outsiders today — the fixed `llms.txt` heading — keeps it when the name is null (today's behaviour, machine-readable, platform text), which is the permitted exception to "must not show Catalogue to visitors".

## C11.4 Every place the public name is (or may be) used

| # | Place | Today | Consumer (R-B) when name resolves | Null behaviour |
|---|---|---|---|---|
| 1 | Landing page `<title>` + OG title (`CatalogueRoute.tsx:95`) | `seoTitle ?? "heroTitle — siteName" ?? siteName` | **Approved (D-12).** Add one fallback step: `… ?? "publicName — siteName" ?? siteName`. An existing title (`seoTitle`, `heroTitle`) always wins — tmz keeps "Between the Lines". | `siteName` as today |
| 2 | Landing page H1 / hero | authored in sections | none (content). Authoring aid only: Setup pre-fills a new landing page's `heroTitle` with the public name | n/a |
| 3 | Collection and item page titles | `"{name} — {siteName}"` | **No change** (the document name is the title) | n/a |
| 4 | Breadcrumbs (visible) and `BreadcrumbList` JSON-LD | **do not exist** | When breadcrumbs are introduced (separate slice, own approval): Home › *publicName* (links to `/{segment}` when the landing page is public) › document. Label source = `resolvePublicName`. | Middle crumb omitted — never "Catalogue" |
| 5 | Structured data | collection/section/item names only | Where a catalogue-level name is wanted: `ItemList.name` of the synthetic "all items" listing; `CollectionPage`/`WebPage` `name` of the landing page if/when a landing JSON-LD is added | `name` omitted |
| 6 | `llms.txt` heading `## Catalogue` / `## Catalogue (<loc>)` | fixed platform text | **Approved (D-12).** Each language block uses `resolvePublicName(names, { locale: <that block's locale>, defaultLocale })` — the heading in the appropriate locale; normal locale fallback for partial names. tmz: `## Catalogue` → `## Books` (en) / `## Libri` (it) / `## Bücher` (de). | `## Catalogue` as today |
| 7 | Navigation links | navigation docs carry their own label | none at runtime. Authoring aid: when a person adds a link to the landing page, the label field is pre-filled with the public name | n/a |
| 8 | Sitemap | URLs only | none | n/a |
| 9 | Dashboard (sidebar, Home glance, page titles, Categories & Tags) | `navLabel ?? "Catalogue"` | **never** — always the interface dictionary's "Catalogue" (K-2) | n/a |
| 10 | Listing section default heading | empty = no heading | none (no behaviour change) | n/a |

Rows 1 and 6 are the R-B consumers *Decided — Tom 2026-11-02, D-12*; R-A ships neither. Rows 4 and 5 (breadcrumbs, structured data) are not part of that decision and need their own approval when those features are built.

## C11.5 `navLabel` migration (exactly K-2, plus the audit and the proof)

```ts
export type PublicNameMigrationPlan =
  | { action: 'none' }                                            // no non-empty navLabel; (an empty/blank navLabel object is still unset)
  | { action: 'copy'; publicName: Record<string, string>; unset: ['navLabel'] }            // navLabel non-empty AND publicName has no non-empty value
  | { action: 'drop'; unset: ['navLabel']; discarded: Record<string, string> }             // publicName already has a non-empty value → untouched
export function planPublicNameMigration(config: { navLabel?: unknown; publicName?: unknown }): PublicNameMigrationPlan
```

- "non-empty" = at least one locale with a string that is non-empty after trim. `copy` keeps **every** locale with a non-empty value (also locales the site does not enable — nothing is lost), trimmed.
- `drop` leaves `publicName` exactly as is. The discarded `navLabel` values are written to the audit entry so the step is reversible (K-2 says "dropped"; this adds the record).
- **Audit entry** (one per project, written in the same run, `actor = migration`): kind `public_name.migrated` (C12 §12.3 owns the id) with the payload of the C12 kind `public_name.migrated` = this plan verbatim: `{ action: 'copy' | 'drop', old, new, discarded, migrationId }` (project, actor `migration` and timestamp are the audit row's own columns). The store is C12's `catalogue_audit_log`, created by step M0 of the C10 plan **before** this step runs; the entry is also written to the committed migration report.
- **Order:** not defined here — see the single plan owned by C10 (REVIEW E-1). C11 contributes R1 (**R-A1**: schema gets `publicName`; every `navLabel` reader switches to the dictionary, C11.6; `navLabel` stays in the schema, deprecated/read-only; no public consumer), **data step D4** (below) and R3 (**R-A3**: `navLabel` removed from `configSchema`, strings and the i18n status file). D4 runs only after R1 is in production, which is why unsetting `navLabel` is safe.
- **D4 — public name** (`scripts/catalogue/migrate-public-name.mjs`, dry-run first, idempotent: a second run is `none`; audited `public_name.migrated` via M0): per project, `planPublicNameMigration(config)`; `copy` writes `publicName` and unsets `navLabel`; `drop` unsets `navLabel` only. Equivalence proofs 1 and 2 below run before/after D4 and their reports are committed.
- **tmz expected result:** `{action:'copy', publicName:{de:'Bücher', en:'Books', it:'Libri'}}`; `navLabel` unset; dashboard shows "Catalogue" (visible dashboard change, intended by K-2); website unchanged.

**Equivalence proofs (both required):**
1. `public-name.preserved` — for every project and every locale: `resolvePublicName(after.publicName)` equals the old designated word `navLabel[locale] ?? navLabel[defaultLocale] ?? null` (K-2's "compare the public name before and after", with "before" defined as the tenant's own choice because the website resolved nothing).
2. `website-output.unchanged` — snapshot, for every project × locale, of: landing `<title>`/OG title/description, a collection page and an item page `<title>`, all JSON-LD blocks, `llms.txt`, sitemap entries; taken with the pre-migration build+data and the post-migration build+data **with R-B consumers disabled**: byte-equal. Run as a script against production reads (read-only) plus a vitest on frozen fixtures (tmz documents).
3. R-B diffs: when consumers are enabled, the same snapshot must differ **only** in rows 1 and 6 of C11.4 (tmz: row 6 only — `llms.txt` headings; its landing title is unchanged because `seoTitle`/`heroTitle` win).

## C11.6 Every code site that reads `navLabel` today, and what it becomes

| Site | Reads for | Becomes |
|---|---|---|
| `src/lib/modules/registry.ts:1302` (configSchema field `navLabel`, "Dashboard name") | module config field | R-A1: field kept hidden/read-only "deprecated". New field `publicName` (label "Public name", description "Used on your website; the dashboard always says Catalogue"). R-A3: `navLabel` removed. |
| `src/lib/modules/catalogue/dashboard-queries.ts:27` `CATALOGUE_NAV_LABEL_QUERY` | sidebar/Home/taxonomy label | **Deleted.** Layout and Home save one Sanity round-trip per request. |
| `src/lib/api/catalogue-drafts.ts:275` `loadCatalogueNavLabel` | same | **Deleted** with its three callers below. |
| `src/lib/api/catalogue-drafts.ts:200,238` `CatalogueSite.config.navLabel` | dashboard title | Renamed `publicName: Record<string,string>`, read only by Setup → Public website. |
| `src/app/[locale]/(client)/[tenant]/layout.tsx:90-94` | override sidebar item label | Removed; sidebar uses `clientDashboard.nav.catalogue` (ADR-042 groups). The `{...i, label}` override disappears. |
| `src/app/[locale]/(client)/[tenant]/home/page.tsx:276-319` | glance tile label | `tcat('label')` always; `loadCatalogueNavLabel` call removed. |
| `src/app/[locale]/(client)/[tenant]/catalogue/page.tsx:19,53` | page title | `t('catalogue')`; doc comment rewritten. |
| `src/app/[locale]/(client)/[tenant]/taxonomy/page.tsx:50-51` | tab label for Catalogue | Removed with the Catalogue tab (K-4). |
| `src/components/client/catalogue/CatalogueBrowser.tsx:110` | `title` prop doc | Prop doc updated; always the dictionary value (or replaced by the four destinations of ADR-042). |
| `src/lib/modules/client-navigation.ts:76` (`NavItem.label?` override) and `src/lib/client/surfaces.ts:129` (comment) | override plumbing | Override field removed if no other module uses it (the layout was its only writer: verify with `grep` at implementation); comment updated. |
| `src/app/llms.txt/route.ts:216` (comment) | documents "navLabel never reaches machine-readable surfaces" | Rewritten: heading uses `resolvePublicName` (R-B row 6) with fallback "Catalogue". |
| `src/lib/modules/__tests__/presets.test.ts:35` ("no preset carries navLabel") | test | Replaced by `packs.test`: no pack writes a dashboard name; `suggestedPublicName` is the only name a pack carries. |
| `src/lib/i18n/interface-translation-status.json:668/1301/4938/5571` + messages | `catalogue.config.navLabel` strings | Renamed `catalogue.config.publicName` (en/it/de reviewed). The `admin.shell.navLabel` entries are the admin sidebar landmark label — unrelated, untouched. |
| `src/components/app/shell/AppSidebar.tsx`, `AdminSidebar.tsx` (`navLabel` prop) | a11y landmark label | **Unrelated; untouched.** |
| `src/app/[locale]/(website)/[tenant]/brand/[[...page]]/page.tsx:35-37`, `components/brand-hub/BrandHub.tsx:51`, `i18n/brand-hub-messages.ts` (`m.navLabel`) | Brand Hub page name | **Unrelated; untouched.** |

Production data: `project.moduleInstallations[catalogue].config.navLabel` on `tmz` only (one document).

## C11.7 Superseded by C11

D12 (project-configurable dashboard label) and the 2026-10-16 note in D-1; the `navLabel` field, loader, query and override plumbing; the D12 sentence "a renamed label must never reach a machine-readable surface" is replaced by: *the public name may reach public and machine-readable surfaces; the dashboard name never does; neither is ever a route or an identifier.*

## C11.8 Named test fixtures

| Fixture | Input | Expected |
|---|---|---|
| `resolve/locale` | `{it:'Libri',en:'Books'}`, locale it | `{text:'Libri',source:'locale'}` |
| `resolve/default` | `{en:'Books'}`, locale de, default en | `{text:'Books',source:'default_locale'}` |
| `resolve/never-other-locale` | `{it:'Libri'}`, locale de, default en | `{text:null,source:'none'}` |
| `resolve/blank` | `{en:'  '}` | `none` |
| `resolve/never-catalogue` | any | `text` is never `'Catalogue'` unless the tenant typed it |
| `migrate/copy-tmz` | `navLabel{de,en,it}`, no `publicName` | `copy` with all three, trimmed; `unset navLabel` |
| `migrate/existing` | `publicName{en:'Menu'}`, `navLabel{en:'Food'}` | `drop`, `discarded{en:'Food'}`, `publicName` untouched |
| `migrate/blank-nav` | `navLabel{en:''}` | `none` + unset |
| `migrate/partial-existing` | `publicName{it:'Menu'}`, `navLabel{en:'Food',it:'Cibo',de:'Essen'}` | `drop` (K-2 literal); discarded recorded; flagged in report (Issue 9) |
| `migrate/idempotent` | run twice | second run `none` |
| `migrate/extra-locale` | `navLabel{fr:'Livres'}` on a site without fr | copied (nothing lost) |
| `equiv/website-output` | tmz frozen documents, R-A build | byte-equal outputs before/after (title, OG, JSON-LD, llms.txt, sitemap) |
| `equiv/dashboard` | same | dashboard label before `Books`, after `Catalogue` (documented expected diff) |
| `landing-title/fallback` | no `seoTitle`, no `heroTitle`, `publicName{en:'Menu'}` | R-B: `Menu — Site`; null name: `Site` |
| `landing-title/tmz` | tmz page | unchanged with or without R-B |
| `landing-title/no-title-project` | synthetic project: landing page with neither `seoTitle` nor `heroTitle`, `publicName{en:'Menu'}` (REVIEW C-14) | R-A: `siteName` before and after (byte-equal); R-B: `Menu — Site`; the website-output snapshot suite includes this project, not only tmz |
| `llms/heading` | name null / tmz `{en:Books,it:Libri,de:Bücher}` | `## Catalogue` / `## Books`, `## Libri (it)`, `## Bücher (de)` per language block; partial names fall back locale → default; machine ids and routes never contain the name |
| `no-reader-left` | scan `src/` | no reference to `navLabel` for the Catalogue after R-A3 (Brand Hub and sidebar landmark allow-listed by path) |
| `validate/default-required` | `{it:'Libri'}` on default `en` | `public_name_default_required` |
| `validate/too-long` | 41 chars | `public_name_too_long` |

---

# Decisions record (was: Issues for Tom)

Every item of the Rev 2 list is settled by `DECISIONS-step2-final-2026-11-02.md`; this table records where each lives in the contract.

| Rev 2 issue | Decision | Where |
|---|---|---|
| 1 K-2 premise (website never shows `navLabel`) | D-12: keep the automatic copy (audited); both public uses approved; existing titles win; partial locales use normal locale fallback, discarded legacy values audited | C11.1, C11.4 rows 1 and 6, C11.5 |
| 2 `llms.txt` heading changes for tmz | D-12: approved, per language block | C11.4 row 6 |
| 3 One taxonomy document vs one record per term | D-2: one document, arrays only; supersedes the Catalogue part of Amendment J | C1.2, C1.4, C1.7a |
| 4 Pack-history guard vs "setup never completed" | D-14: `setupCompletedAt` + `setupSource`, editor reads completion only | C7.9 |
| 5 Primary category on publishing | D-15: required when publishing a new version; never unpublish; safety subset only on re-exposure | C1.6 |
| 6 Primary for legacy multi-category | D-15: first existing category | C1.6, C1.9, fixture `legacy/first-existing` |
| 7 No config-level audit store | C12 `catalogue_audit_log` is step M0 of the C10 plan | C11.5, C1.9 |
| 8 Preset → pack loose ends | D-13 all four parts + install-time segment | C7.6 |
| 9 Partial `publicName` vs full `navLabel` | D-12: K-2 literal drop, discarded values audited | C11.5 |
| 10 Channel key format | D-21: packs reuse `dine-in`/`takeaway` | C7.10 |
| 11 Transaction ceiling | internal budgets stay; real limit 4 MB payload (REVIEW A8) | C7.5 |
| 12 Limits | D-21: 300 categories / 200 Catalogue tags | C1.3 |
| 13 Studio config lock | ships with Setup (C10 plan step R2) | C10 plan |
| 14, 15, 16 | stated, no decision needed | — |

**Residual notes for the final consistency review (interpretations I made; nothing blocks).**
1. *Category archive* is not in Tom's D-3 editor list; I placed archive/unarchive under `setup.manage` (tag archive stays with "manage tags"). Reverse by moving one row of the C1.7 table.
2. *`lunch_specials` and `tasting_menus` as categories.* Tom's rule puts lunchtime availability on a category/item/format; the Traditional pack therefore adds a `lunch_specials` category purely to carry the schedule. A tenant that classifies lunch dishes under their normal categories would instead set the schedule on an item or on those categories; the preview says so.
3. *Pack channel defaults vs schedules:* every suggested channel is `defaultAvailability: available` except Pizzeria `delivery` (baseline unavailable + 18:00–23:00), so no fresh pack is invisible everywhere; Pizzeria delivery is deliberately evening-only and shown in the preview.
4. *D-6.3 "available now" caching* is owned by C5a/automatic listings; C1 adds nothing except that tree edits (move, rule, schedule) invalidate any cached availability — the service emits the C12 event and the cache key includes the taxonomy document `_rev`.
5. *Reference sources for listings/standards/availability policies* are defined as an interface only; their documents belong to later slices (K-9) and must register in the same slice.
6. *`isSetupComplete`* is the only symbol the item editor may import from `packs/`; the guard test needs that single exception (C7.9).

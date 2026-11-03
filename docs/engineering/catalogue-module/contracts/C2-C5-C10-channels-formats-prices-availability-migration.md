# Catalogue step-2 contracts — C2 Channels · C3 Formats · C4 Prices · C5 Availability · C10 Migration

**Status:** Rev 4 — 2026-11-02. **Accepted — Tom 2026-11-02 (final consistency review applied).** Design only; nothing implemented. Decisions recorded inline as *Decided — Tom 2026-11-02, D-n* (`DECISIONS-step2-final-2026-11-02.md`); consistency fixes from `REVIEW-step3-final-consistency.md`.

> **Changelog**
> - **Rev 4 (2026-11-02) — final consistency review applied** (`REVIEW-step3-final-consistency.md`, findings for this file): C-2 `effectiveRule` accepts an `OfferingContext` (incl. `general` = any-channel union); C-3 R1 schema list complete (item `primaryCategory`, `additionalCategories`, `formats`, `channelAvailability`, `readinessOverrides`, `complianceTasks[]`, C13 declaration fields; config `setupCompletedAt`/`setupSource`, `publicName`; tolerant allergen readers); C-4 migration scripts write with the C9 `CATALOGUE_WRITER_PREFIXES` prefix `abluo-migr-<migrationId>-`; C-7 full availability-code hand-over mapping; C-9 interfaces: C1 rule type and `schedule?` corrected, C1 requests marked met; C-13 one named payload limit `SANITY_MUTATION_MAX_BYTES` used by migration scripts; C-14 channel storage text includes `defaultSchedule` and `catalogueMigrations`; C-18 D3 writes setup completion; C-19 fresh production export P′ before D1; C-20 gates outside the data steps (access register, D-20 allergen-retention release gate); C-23 channel audit payloads defer to C12; C-27 editions decided; C-28 image-shape fallback replaced in R2; C-29 DST repeated hour stated in C5a-1; C-30 staging rehearsal of writers via a staging-only preview; D(e) optional fixture B-7 added.
> - **Rev 3 (2026-11-02) — Tom's final decisions applied** (`DECISIONS-step2-final-2026-11-02.md`): every provisional marker replaced by the decision; **D-6 changed** — time-based **availability** is now in scope: new **C5a Availability schedules** (rule = baseline + weekly scheduled overrides, discriminated and extensible; replace-never-merge per channel; instant + project zone on every evaluation; `nextAvailabilityTransition`; "available now" invariant and cache contract; boundary test for automatic listings; collections never decide availability; time never hides an item page; structured data unchanged); channel defaults may carry a schedule (C2); `resolveOffering`, `publicCommerce`, `availabilityImpact` (schedule changes, minutes gained/lost), `priceCoverage` (gaps counted only where available) and fixtures updated; C10: migrated rules have a baseline only, old offer windows stay **price** windows, equivalence per D-7 over visitor-visible outcomes; rollout plan carries D-11's seven steps verbatim (staging never writes production); D-21 `offered` → **`hasPrice`** with the decided message; Issues section becomes a decisions record.
> - **Rev 2 (2026-11-02) — applied review corrections** from `REVIEW-step2-cross-contract.md`: **E-1** this contract now owns the single ordered rollout plan for *all* Catalogue data changes (M0 audit store, R1/R2/R3 releases, data steps D1 taxonomy · D2 commerce · D3 `appliedPreset` · D4 public name, per-project rule activation) — C10-6, rollback C10-7; **E-9 / X-2 / X-3** `CategoryNode`, `CategoryTree`, `PrimaryPath` imported from C1, L1 = C1's `categoryChannelRule`, explanation path = C1's `primaryPath` (C5 no longer walks the tree); **X-1** one row shape `catalogueChannelRule { _key: <channelKey>, _type, channel, state }` at category, item and format level; **E-10 / X-14** reserved `currency`/`locationKey` are not copied, pre-flight refuses; **C-1 / D-10** migration default per channel is `unavailable` with an override on every sold item; **C-2** windows carried in the DTO, not rendered in R1; **A7 / C-3 / C-5** caller table adds `CURRENCY_ITEM_PRICES_QUERY` (currency-change validator) and the wizard/editor state files; **C-6** versions count asserted; **X-12** audit kind names aligned with C12; **E-15** migration numbers reserved in the plan; **name collision** — the new effective state is **`ChannelAvailabilityState`** (the existing `AvailabilityState` in `availability.ts` keeps its meaning until the window rename, so the two can never be confused even during the alias period).
> - Rev 1 (2026-11-02) — first draft.

**Authority (in order):** ADR-033 Amendment K (K-3, K-9, K-11) → brief 2026-11-02 (§11–13, §25–27, §29 AC-06/07, §30) → ADR-033 (D3, D7, D14, §5, A1–A5, A8, D-1, F-3).
**Owner of these contracts:** the Catalogue domain (`src/lib/modules/catalogue/`). Per K-9 each concept below has **exactly one** pure implementation; every other workstream imports it.
**Depends on:** C1 (`CategoryNode`, `CategoryTree`, `categoryChannelRule`, `primaryPath` — imported, see Interfaces). **Depended on by:** C6 readiness, C7 packs, C1 (rule storage), C11/C12, and **every contract's rollout order (C10-6 is the single plan)**.

Facts this document was written against (verified 2026-11-02, read-only):

- Sanity project `3n7t84j3`, dataset `production`: 16 `catalogueItem` documents (10 published, 6 `drafts.*`), all `projectSlug: "tmz"`. 4 carry exactly one offer each (2 published, 2 drafts: `1ebde323…`, `c2c4fa97…`, `drafts.c2c4fa97…`, `drafts.ee333af2…`); every offer is unscoped, has no `availability`, no `priceNote`, no `currency`, no `locationKey`. 6 books carry `bookDetails.isbn`.
- Only one project has Catalogue installed (`tmz`): `serviceChannels` = null, `currency` = EUR, `appliedPreset` = `bookshop` v1, `navLabel` = {en Books, it Libri, de Bücher}. The Restaurant preset has never been applied anywhere, so **no project has service channels**. Site time zone `Europe/Rome`.
- Dataset `staging` exists and is empty. **There is no development Sanity dataset**: dev, preview and production all read `production` (docs/engineering/shared-environments.md).
- **No production code path calls `resolveOffer`, `channelState` or `isSoldOn`** (only tests). The website renders *every* stored offer of an item (`OfferList`, stored order, channel label shown when there is more than one offer or any is scoped). JSON-LD emits every offer as `InStock` and deliberately ignores windows (structured.ts header). `CatalogueOfferDTO.state` is computed but no renderer reads it. Item presence on the website depends only on lifecycle + visibility, never on offers. This fact is what makes C10's equivalence achievable (see C10-2).

Conventions used: camelCase fields; `localizedString` for labels; array order is the explicit order; `_key` is identity and is never regenerated (D14); "inherit" is **never stored** — it is the absence of a row. Error codes are stable strings `<area>.<problem>`; UI copy maps codes, never the reverse.

---

## 0. Shared vocabulary

```ts
/** A channel's stable machine key, e.g. "dine-in". Immutable once created. */
export type ChannelKey = string & { readonly __brand: 'ChannelKey' }
/** A format's stable key (its Sanity `_key` within the item). */
export type FormatKey = string & { readonly __brand: 'FormatKey' }
/** A category's stable key (C1). */
export type CategoryKey = string

/** The value a person can set at category, item and format level. Never stored as 'inherit'. */
export type AvailabilityRuleValue = 'inherit' | 'available' | 'unavailable'
/** An effective result. Two values only. */
export type ChannelAvailabilityState = 'available' | 'unavailable'

/**
 * WHERE a question is asked. The resolver understands both kinds explicitly.
 * 'general' = the item on the website with no channel selected (K-3 rule 7).
 */
export type OfferingContext =
  | { kind: 'channel'; channel: ChannelKey }
  | { kind: 'general' }

export type Locale = string
export type LocalizedString = Partial<Record<Locale, string>>
```

**Naming (Issue T-12, resolved in Rev 2):** the effective two-value result is **`ChannelAvailabilityState`** — deliberately *not* `AvailabilityState`, which `availability.ts` already exports for weekly windows (`'available' | 'outOfHours'`). Under K-3 windows no longer express availability, so the model slice also renames that module's concept to **weekly windows** — `windows.ts`, `WindowState = 'inWindow' | 'outsideWindow'`, `evaluateWindows`, `windowsOverlap`, `windowIssues` — with deprecated re-exports (`AvailabilityState`, `evaluate`, `rulesOverlap`, `ruleIssues`) for one release, then removed in R3. All interval / overnight / DST semantics (A1, A8, half-open intervals, `days` = start day, required IANA zone, no rules = always) are **reused unchanged**; only names change. Below, `WeeklyWindow` = today's `AvailabilityRule`.

```ts
export type WeeklyWindow = { days?: readonly Weekday[]; from?: string | null; to?: string | null } // == AvailabilityRule
```

---

## C2 — Channel model

### C2-1 Purpose
A service channel is *how* an item is obtained (dine-in, takeaway, delivery, room service, shipped, …). It is a short, ordered, localized, project-level vocabulary that carries two extra facts: whether it is active, and its **project default availability** (a baseline state plus an optional weekly schedule, C5a) — the bottom of the C5 inheritance chain.

### C2-2 Types

```ts
export type Channel = {
  key: ChannelKey                 // /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, ≤ 40 chars, immutable
  label: LocalizedString          // required in the site default locale
  active: boolean                 // inactive = hidden from editors and from every public/derived output
  defaultAvailability: ChannelAvailabilityState  // baseline of the PROJECT DEFAULT rule for this channel (C5 level 0)
  defaultSchedule: readonly ScheduledOverride[]  // optional weekly overrides of that baseline (C5a); [] = baseline all week
  // C5 reads { state: defaultAvailability, overrides: defaultSchedule } as one ChannelAvailabilityRule
  // order = position in the array; there is no separate order field
}

/** Normalised, ordered, read-only view used by every resolver. */
export type ChannelSet = {
  all: readonly Channel[]         // stored order, active and inactive
  active: readonly Channel[]      // stored order
  byKey: ReadonlyMap<ChannelKey, Channel>
  /** true when no ACTIVE channel exists → the website is in the 'general' context (K-3 rule 7). */
  none: boolean
}
```

Functions (pure, in `channels.ts`):

```ts
/** Raw module config → ChannelSet. Total: never throws; malformed entries are dropped and reported. */
export function readChannels(raw: unknown): { channels: ChannelSet; issues: ChannelIssue[] }

/** Save-time validation of a whole proposed list against the previously stored list. */
export function channelListIssues(next: readonly Channel[], previous: readonly Channel[], ctx: { defaultLocale: Locale }): ChannelIssue[]

/** Which contexts a public caller must iterate: the active channels, or exactly [{kind:'general'}] when none. */
export function publicContexts(channels: ChannelSet): readonly OfferingContext[]

/** Can this key be removed now? Counts every price row and availability row (items, formats, categories) that names it, drafts included. */
export function channelUsage(key: ChannelKey, docs: CommerceUsageInput): { prices: number; itemRules: number; formatRules: number; categoryRules: number }
```

Read defaults (for entries written before this contract, e.g. the Restaurant preset v2 shape `{ _key, value, label }`): `active` absent ⇒ `true`; `defaultAvailability` absent ⇒ **`'unavailable'`**, `defaultSchedule` absent ⇒ `[]` (brief §27: defaults never silently make items available through a channel). Setup and packs always write both fields explicitly (C7 `PackChannelSuggestion.defaultAvailability` is required, REVIEW X-11), so the read default only ever applies to legacy entries — and C10 writes explicit values for those.

### C2-3 Where it is stored — recommendation

*Decided — Tom 2026-11-02, D-1:* "Module configuration for short settings: channels, currency, segment, public name, defaults and setup-completion state. One project document for Catalogue taxonomy; one for pack history; one for publication standards. Catalogue → Setup is the only normal editing area for all of them." **Keep channels in the Catalogue module configuration** (`project.moduleInstallations[moduleId=="catalogue"].config.serviceChannels`), the existing field, with two optional attributes added to each entry. Do **not** introduce a `catalogueSettings` document (brief §25).

Reasons:
1. ADR-014: the module configuration *is* the one configuration surface. A settings document would be a second home for facts that already live in config (currency, segment, channels), and the brief's `catalogueSettings` lists exactly those.
2. K-7: "Catalogue module configuration moves to Catalogue → Setup; the Studio Modules pane shows it read-only." The store does not move — its *editor* does. Setup writes through the existing module-config service and the same validators; the Modules pane renders the catalogue entry read-only.
3. One read: `catalogueModuleConfigQuery` already projects `serviceChannels`; resolvers need no extra round trip.
4. Precedent for attribute flags on `localizedStringList` entries exists (`supportsColor`, `supportsRouting`). Add a declaration flag **`supportsChannelAttributes: true`** in `modules/types.ts`; entries then carry `active?`, `defaultAvailability?` and `defaultSchedule?` (array of `catalogueWeeklyOverride`).

This **amends D3**, which said a channel becomes a document type "the moment it needs a second attribute". Two scalar attributes on a ≤12-entry vocabulary do not justify a document type (no references, no own lifecycle, no per-channel permissions). Revisit when a channel gets a location or fulfilment rules; a weekly default schedule does not justify a document type (D-1, D-6).

Stored shape (Sanity, inside the generated `catalogueModuleConfig` object):

```jsonc
"serviceChannels": [
  { "_key": "k1", "value": "dine-in",  "label": { "en": "Dine-in", "it": "Al tavolo", "de": "Vor Ort" },
    "active": true, "defaultAvailability": "available" },          // no defaultSchedule = available all week
  { "_key": "k2", "value": "delivery", "label": { "en": "Delivery" },
    "active": false, "defaultAvailability": "unavailable",
    "defaultSchedule": [ { "_key": "s1", "_type": "catalogueWeeklyOverride", "from": "18:00", "to": "23:00", "state": "available" } ] }
]
```
(`value` is the existing field name for the stable key; the TypeScript `Channel.key` maps from it.) Limit: **12 channels** per project.

`defaultChannelsForNewItems[]` (brief §25) is **not** introduced. *Decided — Tom 2026-11-02, D-5:* "One concept: `defaultAvailability` is the channel's runtime default. New items store no redundant channel values unless the user creates an explicit override. No `defaultChannelsForNewItems`."

**The one storage story (REVIEW X-7), which every contract follows:** (1) **module config** (`project.moduleInstallations[catalogue].config`) holds short scalar settings — `currency`, `publicSegment`(+`History`), `publicName` (C11), `defaultItemProfile`, `serviceChannels[]` (+`active`, `defaultAvailability`, `defaultSchedule`), `formatTemplates[]` (C3-6), `dietaryTags[]`, `setupCompletedAt`/`setupSource` (C7), and `catalogueMigrations` (C10-6); (2) **own per-project `liveEdit` documents** for structured, independently revisioned data — `catalogueTaxonomy` (C1), `cataloguePackHistory` (C7), `cataloguePublicationStandards` (C6); (3) **one editing surface for all of it: Catalogue → Setup** (ADR-014 is about the surface, not the container). There is no `catalogueSettings` document.

### C2-4 Invariants
- I-C2-1 Keys are unique, match the regex, and are immutable once saved (a rename is a label change).
- I-C2-2 A key that is still referenced anywhere (any price row, any availability row, any category rule, drafts included) cannot be removed from the list (`channel.deleteReferenced`). Setup offers **Deactivate** as the normal action, and an explicit **"Remove channel and its N prices and M rules"** cleanup. The cleanup is one transaction: it removes those references, then removes the entry, and writes the C12 event `channel.removed` with the payload defined in C12 §12.3 (no second payload definition here). After that the key is free.
- I-C2-3 Deactivation never edits or deletes data. Prices and rules that name an inactive channel are kept as they are and ignored by every resolver; reactivating restores the previous behaviour exactly.
- I-C2-4 Activating a channel, deactivating it, or changing `defaultAvailability` or `defaultSchedule` is a **rule change**: Setup must run `availabilityImpact` (C5-6), show the counts, ask for confirmation, and write the C12 event `channel.activated` / `channel.deactivated` / `channel.default_changed` with the payload defined in C12 §12.3 (`impact = impactCounts(availabilityImpact(...))`; brief §11.4).
- I-C2-5 Channel order affects presentation only (editor rows, price display order across channels). It never affects resolution.

### C2-5 Deactivation and deletion semantics (normative)

| Reference to a channel that is… | Price resolution (C4) | Availability (C5) | Editor | Validation |
|---|---|---|---|---|
| active | normal | normal | shown | — |
| **inactive** | channel prices ignored; no fallback is computed *for* that channel because the channel is never asked | `explainAvailability` for that channel returns `{ state: 'unavailable', source: { level: 'channelInactive' } }`; rows are ignored | rows shown collapsed under "Inactive channels", editable | `price.inactiveChannel` / `availability.inactiveChannel` = **warning** |
| **unknown** (not in config, e.g. hand-edited or imported) | ignored | ignored | rows shown flagged "Unknown channel" so they can be fixed (today's `offerRows` behaviour) | `price.unknownChannel` / `availability.unknownChannel` = **error on save** (existing `unknownChannel` rule), **readiness error** on stored data |

### C2-6 The "no channels" context (K-3 rule 7)
`ChannelSet.none === true` when **no active channel** exists — whether the list is empty or all are inactive. Then:
- `publicContexts()` returns exactly `[{ kind: 'general' }]`;
- every public item is available in `general` (C5-3), source `{ level: 'noChannels' }`;
- its displayed price is the standard price (C4);
- item/format availability rows (which can only name channels) are ignored; editors hide availability controls entirely.
`general` may also be asked when channels exist (website "all channels" view, listings): see C5-3.

### C2-7 Validation errors

| Code | Level | When |
|---|---|---|
| `channel.keyInvalid` | error | key fails regex/length |
| `channel.keyDuplicate` | error | two entries share a key |
| `channel.keyImmutable` | error | an existing entry's key changed |
| `channel.labelMissing` | error | no label in the site default locale |
| `channel.defaultAvailabilityInvalid` | error | not `available`/`unavailable` |
| `channel.deleteReferenced` | error | removal while referenced (payload: `channelUsage`) |
| `channel.limitExceeded` | error | > 12 entries |
| `channel.malformedEntry` | read issue | `readChannels` dropped an entry |
| `availability.schedule*` (C5-10) | error | `defaultSchedule` invalid — the same schedule validator as every other level |

Save-time validation of `defaultSchedule` runs in the Setup channel writer: `channelListIssues` calls `scheduleIssues` for every entry (REVIEW C-14).

### C2-8 Supersedes
D3 "an item with no offer on a channel is simply not supplied that way" (already by K-3); D3's "becomes a document type" trigger (amended, T-3); registry description of `serviceChannels` ("Each price belongs to one channel … an unscoped price applies everywhere"); `catalogue.taxonomy.write` as the channel permission (replaced by C8's setup capability).

### C2-9 Test fixtures (`channels.test.ts`)
- `C2-F1 empty` — raw `null` → `{ all: [], active: [], none: true }`; `publicContexts` = `[general]`.
- `C2-F2 legacy preset entry` — `{value:'dine-in', label:{en:'Dine-in'}}` → `active: true, defaultAvailability: 'unavailable'`.
- `C2-F3 all inactive` — two entries `active:false` → `none: true`.
- `C2-F4 order` — `[takeaway, dine-in]` stays in that order in `all` and `active`.
- `C2-F5 key rename refused` — previous `dine-in`, next `dinein` with same `_key` → `channel.keyImmutable`.
- `C2-F6 delete referenced` — remove `takeaway` while one draft price names it → `channel.deleteReferenced` with `{prices:1,…}`.
- `C2-F7 key literally "default"` — accepted, does not collide with the standard (unscoped) price bucket (carries over the existing `scopeOf` guarantee).
- `C2-F8 malformed` — `{value: 'Dine In'}` → dropped, `channel.malformedEntry`.

---

## C3 — Format model

### C3-1 Purpose
A format is a sellable form of an item (Glass 25 cl, Bottle 33 cl, Paperback, 500 ml). Prices (C4) and the most specific availability override (C5) live on it. Options (extra mozzarella) are not formats (brief §12.3).

### C3-2 Types

```ts
export type QuantityUnit = 'ml' | 'cl' | 'l' | 'g' | 'kg' | 'piece'   // closed list; extend by contract change only

export type FormatIdentifiers = {
  sku?: string     // trimmed, 1–64 chars, [A-Za-z0-9._-]
  isbn?: string    // stored normalised (isbn.ts normalizeIsbn); validated with isValidIsbn
  gtin?: string    // 8, 12, 13 or 14 digits with a valid GS1 mod-10 check digit
}

export type Format = {
  key: FormatKey                    // Sanity _key
  label: LocalizedString | null     // null ONLY for the implicit format
  identifiers: FormatIdentifiers
  quantity: { value: number; unit: QuantityUnit } | null   // value > 0, ≤ 3 decimals
  templateKey: string | null        // provenance from a format template (C3-6); never a live link
  availability: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>    // format rules (baseline + schedule, C5a); absent key = inherit
  prices: readonly Price[]          // C4
  implicit: boolean                 // derived, never stored: true when label === null and it is the only format
}
```

Functions (`formats.ts`):

```ts
export const IMPLICIT_FORMAT_KEY = 'default' as FormatKey

/** Raw item → ordered formats. Absent/empty `formats` (and no legacy offers) → [implicit format with no prices]. Never returns []. */
export function formatsOf(raw: RawCommerce): readonly Format[]

/** True when the editor should show the simple single-price form (one format, no label). */
export function isSimple(formats: readonly Format[]): boolean

/** "Add another size or format": turns the implicit format into a labelled first format (label required), appends a new one. Keys preserved. */
export function addFormat(formats: readonly Format[], firstLabel: LocalizedString, next: { key: FormatKey; label: LocalizedString }): Format[]

/** Removing down to one format keeps that format's key; it becomes implicit only if its label is cleared deliberately. */
export function removeFormat(formats: readonly Format[], key: FormatKey): Format[]

export function formatIssues(formats: readonly Format[], ctx: { channels: ChannelSet; defaultLocale: Locale; itemProfile: ItemProfile; bookIsbn: string | null }): FormatIssue[]

/** ONE answer to "which ISBN identifies this format" (see C3-5). */
export function effectiveIsbn(format: Format, formats: readonly Format[], bookIsbn: string | null): string | null
```

### C3-3 Stored shape

```jsonc
// on catalogueItem
"formats": [                                   // OPTIONAL. Absent or [] = one implicit format with no prices.
  {
    "_key": "default",                         // migration-created implicit format; otherwise a random key
    "_type": "catalogueFormat",
    "label": { "_type": "localizedString", "en": "Glass 25 cl" },   // omitted on the implicit format
    "identifiers": { "sku": "BEER-25", "gtin": "8001234567895" },  // object, every member optional
    "quantity": { "value": 25, "unit": "cl" },
    "templateKey": "glass-25cl",
    "channelAvailability": [                   // format overrides (C5 level 4). No row = inherit.
      { "_key": "delivery", "_type": "catalogueChannelRule", "channel": "delivery", "state": "unavailable" }   // optional "schedule": [...] (C5a-2)
    ],
    "prices": [ /* cataloguePrice, C4 */ ]
  }
]
```

### C3-4 Invariants
- I-C3-1 `formatsOf` always returns ≥ 1 format. An item with no `formats` is one implicit format (`key: 'default'`, no label, no prices). This is what makes a single-format item simple and a no-offer item need no migration write.
- I-C3-2 Only a **sole** format may be unlabelled. With ≥ 2 formats every format needs a label in the default locale (`format.labelRequired`).
- I-C3-3 `_key`s are unique within the item and never regenerated. External identity of a format = `(item.publicId, format._key)`.
- I-C3-4 **Implicit format carries no availability override.** For a simple item, the editor writes overrides at item level only; a stored format override on an implicit format is refused (`format.implicitOverride`). Two places for the same decision on a single-format item would make the "source" explanation meaningless.
- I-C3-5 Order = array order (draggable, keyboard move up/down).
- I-C3-6 Limits: ≤ 24 formats per item; ≤ 50 prices per format.

### C3-5 Relation to `bookDetails.isbn` — recommendation
`bookDetails.isbn` stays the authority for a **single-format** book; per-format ISBNs exist only on items with ≥ 2 formats (Paperback/Hardcover have different ISBNs).
- `effectiveIsbn(f, formats, bookIsbn)` = `f.identifiers.isbn` if set; else `bookIsbn` **iff** `formats.length === 1`; else `null`. This is the only function that answers the question (JSON-LD `isbn`, import matching, export).
- Validation: a single-format item may not carry both a format ISBN and a book ISBN (`format.isbnConflictsBook`); when a second format is added, the editor offers to move the book ISBN to the first format (explicit, never automatic).
- Migration does **not** move ISBNs (6 published books keep `bookDetails.isbn`; JSON-LD unchanged).
- Book *editions* (`links[].edition`, one buy link per language) are a separate existing concept and are **not** formats. *Decided — Tom 2026-11-02, D-21:* editions do not become formats in this slice.

### C3-6 Project-level format suggestions — recommendation: templates, not a vocabulary
Formats are embedded content, labelled freely per item; a vocabulary (which items *select from*) would make every item's format depend on a project record and turn a rename into a mass edit. Packs and restaurants still need quick picks ("Glass 25 cl, Glass 50 cl, Bottle 33 cl"). So:
- Module config gains **`formatTemplates`**: an ordered list `{ _key, key, label: LocalizedString, quantity?: {value, unit} }`, edited in Setup → Item defaults, writable by packs (C7, additive by `key`).
- Choosing a template **copies** label and quantity into a new format and sets `templateKey`. Editing the template later never changes existing formats (K-6: never rename silently). `templateKey` enables bulk operations ("all Glass 50 cl: +€0.50"), import mapping and pack equivalence; nothing at runtime branches on it.
- A template whose `key` is in use may be removed; formats keep their copied label and a dangling `templateKey` (harmless, reported as info).

### C3-7 Validation errors

| Code | Level |
|---|---|
| `format.keyDuplicate` | error |
| `format.labelRequired` (≥2 formats, label missing in default locale) | error |
| `format.limitExceeded` / `format.pricesLimitExceeded` | error |
| `format.skuInvalid` · `format.skuDuplicateInItem` | error |
| `format.skuDuplicateInProject` | readiness warning (cross-document uniqueness cannot be enforced transactionally) |
| `format.isbnInvalid` · `format.isbnConflictsBook` | error |
| `format.gtinInvalid` | error |
| `format.quantityInvalid` (≤0, >3 decimals, unit without value or vice versa) · `format.unitUnknown` | error |
| `format.implicitOverride` | error |
| `availability.keyMismatch` · `availability.duplicateChannel` · `availability.stateInvalid` · `availability.unknownChannel` | error (shared with C5 `availabilityRowIssues`) |

### C3-8 Supersedes
ADR-033 §5 "Variants and stock: a child `catalogueUnit` type … the item's own `offers[]` become the single implicit unit's" — formats are that unit, embedded (extraction stays possible: `_key` → `publicId`, as D14). Item-level `offers[]` (legacy, removed in C10 cleanup).

### C3-9 Test fixtures (`formats.test.ts`)
- `C3-F1 no formats` — `{}` → one format `{key:'default', label:null, implicit:true, prices:[]}`.
- `C3-F2 legacy offers only` — `{offers:[{_key:'gmcfddpsji', price:999}]}` → implicit format with one standard price keyed `gmcfddpsji` (same mapping as C10-3).
- `C3-F3 two formats, second unlabelled` → `format.labelRequired` on the second key.
- `C3-F4 addFormat` from implicit → first gets the given label and keeps key `default`; second appended.
- `C3-F5 removeFormat` to one → remaining keeps label, `implicit:false`; `isSimple` false until label cleared.
- `C3-F6 ISBN` — single format, `bookIsbn '1529105102'` → `effectiveIsbn` = it; two formats each with ISBN → each its own; two formats, one without → that one `null`.
- `C3-F7 GTIN` — `'4006381333931'` ok; `'4006381333932'` → `format.gtinInvalid`.
- `C3-F8 implicit override` — implicit format with a `channelAvailability` row → `format.implicitOverride`.

---

## C4 — Price model

### C4-1 Purpose
Answers **"how much"**, and only that (K-3 table). A price never activates a channel (rule 1); a price window chooses *which* price applies at a time and never decides availability (rule 9).

### C4-2 Types

```ts
export type Price = {
  key: string                       // Sanity _key — stable identity (D14), carried over from the legacy offer
  scope: ChannelKey | null          // null = STANDARD price; a key = channel-specific price
  amount: number                    // ≥ 0, ≤ 2 decimals; 0 = free
  note: LocalizedString | null      // "per 100 g", "from" — displayed, never parsed
  windows: readonly WeeklyWindow[]  // [] = always
  // reserved, never read (D7, D14, A5): currency, locationKey
}

export type PriceSource =
  | { kind: 'channel'; channel: ChannelKey; priceKey: string }
  | { kind: 'standard'; priceKey: string; fallbackFrom: ChannelKey | null }  // fallbackFrom set when a channel was asked

export type PriceResolution =
  | { kind: 'price'; price: Price; source: PriceSource; currency: string }
  | { kind: 'noPrice'; reason: 'noPrices' | 'outsideWindows' }
  | { kind: 'ambiguous'; scope: ChannelKey | null; priceKeys: string[] }
  | { kind: 'indeterminate'; reason: 'timeZoneMissing' }   // windowed candidates, no site zone (never guessed, A8)
```

### C4-3 Functions (`prices.ts`; supersedes `offers.ts`)

```ts
export function effectiveCurrency(project: { currency: string }): string   // unchanged: project.currency, full stop (D7/A6)

/**
 * The price of ONE format in ONE context at ONE instant. Knows nothing about availability.
 * 'channel' c:
 *   1. channel prices with scope === c whose windows apply at instant: exactly 1 → price{channel}; ≥2 → ambiguous{c}
 *   2. otherwise standard prices whose windows apply: exactly 1 → price{standard, fallbackFrom: c}; ≥2 → ambiguous{null}
 *   3. otherwise noPrice ('noPrices' if the format has no standard and no c price at all, else 'outsideWindows')
 * 'general': step 2 only (fallbackFrom: null).
 * Prices whose scope is an inactive or unknown channel are never candidates.
 * Ambiguity at step 1 does NOT fall through to step 2 (never a pick — A4/K-3 rule 11).
 * A candidate with windows and timeZone === null → indeterminate (checked before counting).
 */
export function resolvePrice(format: Format, ctx: OfferingContext, instant: Date, timeZone: string | null,
                             channels: ChannelSet, project: { currency: string }): PriceResolution

/**
 * Instant-free: the prices a PUBLIC page lists for a format (pages are cached; a point-in-time answer
 * would be wrong in any cached page — same reasoning as structured.ts). Returns stored order, filtered:
 *   - a standard price is listed iff the format is available at SOME time of the week in ≥1 public context
 *     (C5a availableSometime over the effective rule) — always true when ChannelSet.none;
 *   - a channel price is listed iff its channel is active AND the format is available on it at some time of the week.
 *   Instant-free on purpose: a breakfast-only dish keeps its listed price at 16:00 (D-6: "a standard price that stays the
 *   same whenever the item is available").
 * Each entry carries its scope (for the channel label) and its windows. **R1 carries windows in the DTO but does not render them** — today's `OfferPrice` never shows windows, and rendering them would break E6 equivalence; showing "12:00–15:00" is a separate, approved change (REVIEW C-2).
 */
export function displayPrices(format: Format, availability: FormatAvailabilityMap, channels: ChannelSet): readonly Price[]

/**
 * Static, instant-free coverage for readiness (C6): does some price apply at every minute of the week AT WHICH THE FORMAT IS
 * AVAILABLE in this context (effective rule's weekProfile, C5a)? Gaps are reported only inside available minutes — a
 * breakfast item priced 07:00–11:00 is 'full'. Availability is an INPUT here, never an output (D-6 independence).
 */
export type PriceCoverage =
  | { kind: 'full' } | { kind: 'partial'; gaps: { start: number; end: number }[] } | { kind: 'none' }
/** C6 consumes this type unchanged: rule `pricePartial` ⇔ kind 'partial', `priceMissing` ⇔ kind 'none' (REVIEW X-4). */
export function priceCoverage(format: Format, ctx: OfferingContext, channels: ChannelSet, availability: WeekProfile): PriceCoverage

/** Save-time validation (supersedes offerIssues). */
export function priceIssues(format: Format, channels: ChannelSet): PriceIssue[]
```

`FormatAvailabilityMap` = `ReadonlyMap<'general' | ChannelKey, EffectiveRule>` produced by C5 `availabilityMatrix` for that format (instant-free).

**Independence (D-6, verbatim):** availability answers whether the item can be obtained at that moment; price windows answer which price applies at that moment; a missing price never means unavailable; a price never makes an item available. Price windows (`cataloguePrice.windows`) and availability schedules (`catalogueChannelRule.schedule`) are separate fields with separate validators; they share only `windows.ts` arithmetic.

### C4-4 Stored shape

```jsonc
"prices": [   // on catalogueFormat
  { "_key": "gmcfddpsji", "_type": "cataloguePrice",
    "amount": 999,
    "channel": "takeaway",                              // omitted = standard price
    "note": { "_type": "localizedString", "en": "from" },
    "windows": [ { "_key": "w1", "_type": "catalogueWeeklyWindow", "days": ["fri"], "from": "18:00", "to": "02:00" } ]
    // "currency", "locationKey": reserved in the schema (hidden), never written by anyone — not by the dashboard,
    // import, packs or the migration (D7, D14, A5; REVIEW X-14). A stored value is a C6 integrity error.
  }
]
```
New type names (`cataloguePrice`, `catalogueWeeklyWindow`) rather than reusing `catalogueOffer.availability`: the field's meaning changed (K-3 rule 9), and the legacy `offers[]` must stay readable unchanged until cleanup. `catalogueWeeklyWindow` has today's `catalogueAvailability` fields and validation.

### C4-5 Invariants
- I-C4-1 **Currency is project-only.** `effectiveCurrency(project)`; `price.currency` is never read (D7/A6). Packs never write currency (K-6).
- I-C4-2 **Non-overlap per scope** (A3): within one format, two prices with the same scope (same channel, or both standard) must have disjoint windows over the whole week (`windowsOverlap`, half-open, overnight-aware). `[]` overlaps everything. Overlap *across* scopes is legal — precedence resolves it.
- I-C4-3 Scope comparison uses `null` for standard, never a string sentinel (carried over from `scopeOf`).
- I-C4-4 A price never creates availability; deleting all prices never removes availability (K-3 rules 1, 10).
- I-C4-5 One active channel needs no channel price: the standard price applies there (rule 8).
- I-C4-6 Precedence is per format; prices never fall back across formats.

### C4-6 Edge cases
- Channel price outside its window, standard price always-on → standard (`fallbackFrom: c`) — rule 9.
- Channel price outside its window, no standard → `noPrice{outsideWindows}`; availability unaffected (available + missing-price issue, rule 10).
- Lunch €10 (12–15) + dinner €14 (18–23) both standard, asked at 16:00 → `noPrice{outsideWindows}`; `priceCoverage` = `partial` with the gaps.
- Friday 18:00–02:00 asked Saturday 01:30 local → applies (A1). Sunday 23:00–01:00 asked Monday 00:30 → applies (week wrap).
- DST: windows are wall-clock (A8 composition with `lifecycle/time.ts`), unchanged.
- Legacy/imported overlap in one scope → runtime `ambiguous`, never first/cheapest.
- `amount: 0` → a real price ("Free").

### C4-7 Validation errors

| Code | Level |
|---|---|
| `price.amountInvalid` (negative, non-finite) · `price.tooManyDecimals` | error |
| `price.overlap` (payload: scope, two keys) | error |
| `price.unknownChannel` | error |
| `price.inactiveChannel` | warning |
| `price.windowInvalidTime` · `price.windowIncomplete` · `price.windowZeroLength` · `price.windowUnknownDay` | error |
| `price.reservedFieldWritten` (currency/locationKey from a client) | error (server patch); a *stored* value is C6 `integrity.currencyStored` |
| `price.ambiguous` (runtime, stored data) | readiness error, C6 |
| `price.missing` (available in a context, `priceCoverage` = none) | readiness issue, C6 (K-3 rule 10). *Decided — Tom 2026-11-02, D-8:* website = recommended warning by default; channel-specific delivery, priced export, PDF or marketplace output = required. A missing price never changes availability. |
| `price.partialCoverage` | readiness recommendation, C6 |

### C4-8 Supersedes
`offers.ts` (`resolveOffer`, `isSoldOn`, `channelState`, `offerIssues`, `Resolution.notSold`), A2 and A4 step 3 in their availability meaning (already by K-3), the `notSold` vocabulary, `OfferForm`/`offerFormIssues`/`offersToDoc`/`offerRows` in `dashboard-form.ts` and `cleanOffers` in `dashboard-patch.ts` (replaced by format/price equivalents that **also carry `note`** — today the dashboard silently drops `priceNote` on save, Issue T-10), and `CatalogueOfferDTO.state`.

### C4-9 Test fixtures (`prices.test.ts`) — fixed zone `Europe/Rome`
Instants: `T_MON_1100 = 2026-11-02T10:00:00Z` (Mon 11:00 local), `T_MON_1600 = 2026-11-02T15:00:00Z`, `T_FRI_2330 = 2026-11-06T22:30:00Z`, `T_SAT_0130 = 2026-11-07T00:30:00Z`, `T_SUN_2330 = 2026-11-08T22:30:00Z`, `T_MON_0030 = 2026-11-08T23:30:00Z`.
- `C4-F1 standard only, general` — `[std 12]` → `price{standard, fallbackFrom:null}` 12, currency EUR.
- `C4-F2 channel wins` — `[std 12, takeaway 10]`, ctx takeaway → `price{channel takeaway}` 10.
- `C4-F3 fallback outside channel window` — `[std 12, takeaway 10 @mon 12–15]` at `T_MON_1600` → `price{standard, fallbackFrom:'takeaway'}` 12.
- `C4-F4 no fallback available` — `[takeaway 10 @12–15]` at `T_MON_1600`, ctx takeaway → `noPrice{outsideWindows}`.
- `C4-F5 lunch/dinner gap` — `[std 10 @12–15, std 14 @18–23]` at `T_MON_1600` → `noPrice{outsideWindows}`; `priceCoverage` partial with gaps `[0,720)…`.
- `C4-F6 overnight` — `[std 8 @fri 18:00–02:00]` at `T_SAT_0130` → 8; at `T_MON_1100` → noPrice.
- `C4-F7 week wrap` — `[std 8 @sun 23:00–01:00]` at `T_MON_0030` → 8.
- `C4-F8 ambiguous channel does not fall through` — two always-on takeaway prices + std → `ambiguous{scope:'takeaway'}`.
- `C4-F9 ambiguous standard` — two always-on std → `ambiguous{scope:null}`; `priceIssues` → `price.overlap`.
- `C4-F10 inactive channel ignored` — `[std 12, delivery 9]`, delivery inactive, ctx delivery → never asked by public callers; `resolvePrice` directly → `price{standard, fallbackFrom:'delivery'}`; `priceIssues` → `price.inactiveChannel` warning.
- `C4-F11 no zone` — windowed candidate, `timeZone:null` → `indeterminate`; un-windowed only → resolves normally.
- `C4-F12 currency reserved` — price with `currency:'USD'`, project CHF → `currency:'CHF'`.
- `C4-F13 displayPrices` — `[takeaway 10, std 12, dine-in 11]`, channels dine-in (available), takeaway (unavailable for this item) → `[std 12, dine-in 11]` in stored order.
- `C4-F14 key literally "default"` channel → its price is a channel price, not standard.

---

## C5 — Availability resolver (with availability schedules, D-6)

### C5-1 Purpose
Answers **"where and when can it be obtained"**, per format and channel, at a supplied instant in the project time zone, with the **source** of the answer for the UI (K-3 rule 6), the **active scheduled override**, and the **next transition instant** (for caching). It also gives instant-free views (the effective rule and its weekly profile) and the impact of a proposed rule or schedule change (brief §11.4).

*Decided — Tom 2026-11-02, D-6 (changed from Rev 2): time-based availability is in scope now, separate from price windows.* "Catalogue V2 supports both availability windows and price windows. A restaurant must be able to express: breakfast 07:00–11:00; a lunch menu only at lunchtime; delivery only in the evening; a dish unavailable on Sundays; a standard price that stays the same whenever the item is available."

**Independence of availability and price (D-6, verbatim):** availability answers whether the item can be obtained at that moment; price windows answer which price applies at that moment; a missing price never means unavailable; a price never makes an item available.

Both use the same interval arithmetic (`windows.ts`: weekly ranges, `days` names the day an interval **starts** (A1), overnight wrap, week wrap, half-open intervals, wall-clock evaluation in an explicit IANA zone via `lifecycle/time.ts` (A8)). They share arithmetic, never meaning: no function reads a price window to answer availability, or an availability schedule to choose a price.

### C5-2 Inputs and types

```ts
// ── Owned by C1 — imported, never redefined here (REVIEW X-2 / X-3 / E-9) ─────────────────
import type { CategoryKey, CategoryNode, CategoryTree, PrimaryPath } from './taxonomy/types'
import { categoryChannelRule, primaryPath } from './taxonomy/tree'
//   categoryChannelRule(tree, primary, c) → { rule: ChannelAvailabilityRule | 'inherit'; sourceKey: CategoryKey | null }
//      = nearest self-or-ancestor NON-inherited rule on the PRIMARY path (C1 I11), returned COMPLETE (state + schedule)
//   primaryPath(tree, key) → PrimaryPath = { kind:'path'; keys } | { kind:'none' } | { kind:'broken'; reason; keys }
//   REQUIRED OF C1 (Rev 3, D-6): CategoryNode.channelRules : Partial<Record<ChannelKey, ChannelAvailabilityRule>>
//      in memory (absent = inherit), stored as catalogueChannelRule rows (C5-7). If C1 names differ, C1's names win.

// ── Schedules (C5a) ──────────────────────────────────────────────────────────────────────
/** One scheduled override. Discriminated so later kinds are additive (D-6.4). */
export type ScheduledOverride =
  | { kind: 'weekly'; key: string; days: readonly Weekday[]; from: string | null; to: string | null; state: ChannelAvailabilityState }
  // future, additive, no migration: | { kind: 'dated'; key: string; fromDate: string; toDate: string; …; state }

/** A complete availability rule for ONE channel at ONE level. */
export type ChannelAvailabilityRule = {
  state: ChannelAvailabilityState              // the BASELINE, in force whenever no override applies
  overrides: readonly ScheduledOverride[]      // [] = the baseline all week
}

export type AvailabilityInputs = {
  channels: ChannelSet        // C2 — each active channel carries its default rule (baseline + optional schedule)
  tree: CategoryTree          // C1 buildTree() over the project's catalogueTaxonomy categories
}

export type ItemAvailabilityInput = {
  itemId: string
  primaryCategory: CategoryKey | null                    // additionalCategories deliberately NOT an input (K-3 rule 5)
  itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
  formats: readonly Pick<Format, 'key' | 'availability' | 'implicit'>[]   // Format.availability: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>
}

export type AvailabilitySource =
  | { level: 'noChannels' }                                          // ChannelSet.none, general context
  | { level: 'channelInactive' }
  | { level: 'projectDefault'; channel: ChannelKey }
  | { level: 'category'; channel: ChannelKey; categoryKey: CategoryKey; path: readonly CategoryKey[]; inheritedFromAncestor: boolean }
  | { level: 'item'; channel: ChannelKey }
  | { level: 'format'; channel: ChannelKey; formatKey: FormatKey }
  | { level: 'anyChannel'; channels: readonly ChannelKey[] }         // general context when channels exist

/** Instant-free: WHICH complete rule governs (format, channel) and where it comes from. */
export type EffectiveRule = {
  rule: ChannelAvailabilityRule
  source: AvailabilitySource
  /** The complete upstream rule that "Use category default" would restore (null when the source is already inherited). */
  inherited: { rule: ChannelAvailabilityRule; source: AvailabilitySource } | null
  issues: readonly AvailabilityIssueCode[]   // e.g. 'availability.primaryCategoryBroken'
}

/** At an instant. */
export type AvailabilityExplanation = EffectiveRule & {
  state: ChannelAvailabilityState
  /** The override in force at the instant, or null when the baseline applies. */
  activeOverride: { key: string; kind: ScheduledOverride['kind']; endsAt: Date } | null
  /** First instant > `at` at which `state` differs; null = never changes (constant rule). See C5a-4. */
  nextTransition: Date | null
  at: Date
  timeZone: string
}

/** Instant-free weekly profile: the wall-clock week as half-open minute ranges [0,10080) with their states, merged and sorted. */
export type WeekProfile = readonly { start: number; end: number; state: ChannelAvailabilityState }[]
```

### C5-3 Precedence (K-3 rule 4, exactly) — replace, never merge (D-6.1)

*Decided — Tom 2026-11-02, D-6.1 (verbatim):* "For each channel, the most specific non-inherited rule supplies the **complete** availability rule and schedule for that channel. An item rule replaces the inherited category rule for that channel; a format rule replaces the item or category rule for that channel; rules for other channels are unaffected; "Use category default" restores inheritance of the complete upstream rule and schedule. A simple item-level "Available" therefore means available all week on that channel, even if the inherited category rule was 18:00–23:00 only. Each rule = baseline state + optional weekly scheduled overrides. Overlapping scheduled overrides at equal precedence are invalid."

For a channel context `c` (active), format `f`, item `i` — choose ONE complete rule, then evaluate it:

```
L0  project default        channels.byKey(c).defaultRule = { state: defaultAvailability, overrides: defaultSchedule }   — always defined
L1  primary-category path  { rule, sourceKey } = categoryChannelRule(inputs.tree, i.primaryCategory, c)   (C1's single implementation)
                           Explanation path = primaryPath(inputs.tree, i.primaryCategory).keys;
                           inheritedFromAncestor = sourceKey !== i.primaryCategory
L2  item rule              i.itemRules.get(c)
L3  format rule            f.availability.get(c)          (never on an implicit format, I-C3-4)
effective rule = the rule of the HIGHEST level that has one. Nothing from a lower level survives: no baseline, no override.
state at t     = evaluateRule(effective rule, t, timeZone)   (C5a-3)
```

- Inheritance bottoms out at the project default: L0 always exists (C2 read default: `unavailable`, no schedule).
- Inactive `c` → `{ state: 'unavailable', source: channelInactive, nextTransition: null }`, no levels consulted.
- `primaryPath` = `none` → L1 contributes nothing (drafts may lack a category, brief §8.4).
- `primaryPath` = `broken` → L1 is whatever `categoryChannelRule` returns over C1's deterministically repaired tree (unknown primary ⇒ `inherit`), **and** `availability.primaryCategoryBroken` with `reason`; C6 folds it into `primaryCategoryMissing` (`values.reason`) — fail-visible; not fail-closed (the category level is a default, not a gate).
- Additional categories are not an input (rule 5) — enforced by the type. **Collections are not an input** (D-6.2, below).

`general` context (instant-based):
- `ChannelSet.none` → `{ available, source: noChannels, nextTransition: null }` (rule 7). No schedules apply: in a project without active channels there is no rule to carry one.
- otherwise → `available` at t iff the format is available on ≥ 1 active channel at t; source `{ level: 'anyChannel', channels: [those available at t] }`; `nextTransition` = the earliest `nextTransition` among the active channels (a safe bound: the aggregate can only change when a member changes).

Item-level state (listings, badges) at t = available on `c` iff **any** format is available on `c` at t; `nextTransition` = earliest among its formats.

**Collections never determine operational availability (D-6.2, verbatim):** "A Lunch collection is presentation; lunchtime availability belongs to a category, item or format rule. Scheduling the display of a collection/section is a separate presentation capability, not in this slice."

### C5a — Availability schedules

#### C5a-1 Rule and schedule semantics
- A rule's **baseline** `state` is in force at every instant not covered by one of its overrides.
- A **weekly override** `{ days, from, to, state }` is in force on the wall-clock week ranges `windows.ts` derives (`ruleRanges`): `days` empty = every day; `from`/`to` both absent = all day; `to ≤ from` = overnight into the next day (A1, `days` = start day); Sunday overnight wraps into Monday; half-open (an override ending 11:00 is over at 11:00).
- **DST:** at fall-back, wall-clock evaluation means an override covering 02:00–02:59 applies in **both** occurrences of that hour; at spring-forward, minutes that do not exist never apply. Same as price windows (A8); accepted (D-6 "reusing the existing time-zone, DST … semantics"). Fixtures C5-S6/S7 and B-5 prove it against a minute-scan oracle.
- **Non-overlap at equal precedence:** within one rule, no two overrides may share any minute of the week (`availability.scheduleOverlap`), whatever their states. Overrides in *different* rules never conflict — only one rule is ever evaluated (replace, never merge).
- An override whose `state` equals the baseline is legal but redundant (`availability.scheduleRedundant`, warning).
- Precedence among override kinds (for later additive kinds, D-6.4): a future `dated` override would outrank `weekly` overrides of the same rule on its dates; weekly-only rules are unaffected by adding the kind.

#### C5a-2 Stored shape (extends C5-7)
```jsonc
{ "_key": "dine-in", "_type": "catalogueChannelRule", "channel": "dine-in",
  "state": "unavailable",                                   // baseline
  "schedule": [                                             // OPTIONAL; absent or [] = baseline all week
    { "_key": "s1", "_type": "catalogueWeeklyOverride",
      "days": ["mon","tue","wed","thu","fri","sat","sun"], "from": "18:00", "to": "23:00", "state": "available" }
  ] }
```
- `schedule[]` is an array of **typed members**: today only `catalogueWeeklyOverride` (`days?`, `from?`, `to?`, `state`). The member `_type` is the discriminator (`kind` in TypeScript). A dated exception arrives later as a new member type `catalogueDatedOverride` in the same array's `of:` list — **no existing rule is rewritten** (D-6.4).
- The channel default (C2) uses the same member type in `serviceChannels[].defaultSchedule[]`.
- Limits: ≤ 14 overrides per rule.

#### C5a-3 Functions (`availability-schedule.ts`)
```ts
/** Normalise stored rows (any level) → rule; total, never throws; unknown member types are kept as issues, never evaluated. */
export function readChannelRule(row: unknown): { rule: ChannelAvailabilityRule | null; issues: AvailabilityIssueCode[] }

/** State at an instant. `timeZone` is REQUIRED (no default, A8); a malformed zone throws a typed error, never guesses. */
export function evaluateRule(rule: ChannelAvailabilityRule, at: Date, timeZone: string):
  { state: ChannelAvailabilityState; activeOverride: ScheduledOverride | null }

/** Instant-free weekly profile (wall clock). Used by impact, by displayPrices/priceCoverage and to display "Served 07:00–11:00". */
export function weekProfile(rule: ChannelAvailabilityRule): WeekProfile

/** True when the rule is available at some minute of the week (instant-free). */
export function availableSometime(rule: ChannelAvailabilityRule): boolean

/** Save-time validation of one rule. */
export function scheduleIssues(rule: ChannelAvailabilityRule): ScheduleIssue[]
```

#### C5a-4 Next transition and the cache contract
```ts
/**
 * DEFINITION: the earliest instant t' > at such that evaluateRule(rule, t', tz).state !== evaluateRule(rule, at, tz).state,
 * evaluated with the same wall-clock semantics as evaluateRule (so DST gaps and repeated hours behave exactly as evaluation does).
 * null when the state never changes (no overrides, or every override equals the baseline).
 * Searches at most 8 days ahead (a weekly rule that has not changed in 8 days never changes).
 * Resolution: one minute (rule boundaries are whole minutes). Implementations compute it from range boundaries converted
 * with lifecycle/time.ts localToUtc (gap → first valid instant after the gap; overlap → evaluated as evaluateRule would);
 * the test oracle is a brute-force minute scan.
 */
export function nextAvailabilityTransition(rule: ChannelAvailabilityRule, at: Date, timeZone: string): Date | null

/** The one result shape any "available now" claim must carry. */
export type AvailableNow =
  | { kind: 'known'; state: ChannelAvailabilityState; evaluatedAt: Date; timeZone: string; validUntil: Date | null }
  | { kind: 'scheduleOnly'; reason: 'timeZoneMissing' | 'cannotGuaranteeFreshness'; profile: WeekProfile }

export function availableNow(inputs: AvailabilityInputs, item: ItemAvailabilityInput, formatKey: FormatKey | null,
                             ctx: OfferingContext, at: Date, timeZone: string | null): AvailableNow
```

**Invariant for anything claiming "available now" (D-6.3, verbatim):** "evaluation always receives an explicit instant and project time zone; a cached result must never survive beyond the next relevant availability transition; browser or server must refresh/re-evaluate at that boundary; if the system cannot guarantee a current result it shows the schedule rather than an incorrect "available now"."

Cache contract (binding on every consumer — automatic listings, item page labels, preview, partner output):
1. Every "available now" result is an `AvailableNow` with `validUntil = nextTransition` (for aggregates: the earliest member transition). `validUntil: null` means valid until the inputs change.
2. A cache layer may store it only with an expiry **≤ `validUntil`** (server: revalidate/tag expiry no later than `validUntil`; browser: re-evaluate locally at `validUntil` from the schedule shipped alongside, or refetch). A cached result is never served at or after its `validUntil`.
3. Input changes (rule edit, publish) invalidate as any content change does; that is independent of time.
4. When the consumer cannot honour 2 (e.g. a page cache whose expiry it cannot set), it renders `scheduleOnly` (the weekly profile: "Served 07:00–11:00"), never a stale "available now".
5. No time zone → `scheduleOnly{timeZoneMissing}`; never the server's zone.

**Boundary test the automatic-listing contract must pass** (`listing-availability-boundary.test.ts`; injected clock and cache adapter; page-cache TTL deliberately set to 1 hour):
- Rule: dine-in baseline `unavailable`, weekly override every day 18:00–23:00 `available`; zone `Europe/Rome`.
- `B-1` Render "available now" listing at `2026-11-02T16:59:00Z` (17:59 local) → item absent; response cached with expiry `2026-11-02T17:00:00Z`.
- `B-2` Request at `2026-11-02T17:00:00Z` (18:00 local) through the same cache → item **present** (the 1-hour TTL is not waited for).
- `B-3` Request at `2026-11-02T21:59:59Z` → present; at `2026-11-02T22:00:00Z` (23:00 local) → absent.
- `B-4` Overnight: rule Fri 22:00–02:00 available → present at `2026-11-07T00:00:00Z` (Sat 01:00 local), absent at `2026-11-07T01:00:00Z` (Sat 02:00).
- `B-5` DST fall-back (`2026-10-25`, Europe/Rome) and spring-forward (`2027-03-28`) with an override ending at 02:30: the listing flips exactly at the instants `nextAvailabilityTransition` returns.
- `B-6` Zone missing → listing shows the schedule form, never "available now".
- `B-7` (optional) `general` context, two channels: one member flips at its transition but the other keeps the item available → membership unchanged, a new `validUntil` is issued (the any-channel bound is early, never late).
- Pass criterion: for every request, the served membership equals a fresh `availableNow` at the request instant.

#### C5a-5 Website, item pages and structured data (D-4, D-6.3)
- *Decided — Tom 2026-11-02, D-4 (verbatim):* "Lifecycle and visibility determine whether an item appears on the general website. Channel availability determines where it can be obtained, which prices apply and which availability labels are shown. An item unavailable through every active channel may still have an informational page or appear in the Catalogue. Hiding such items may come later as an explicit, opt-in website rule; never an implicit consequence of channel availability."
- **Time does not hide an item page** (D-6.3): the page stays accessible at every hour; it may display its schedule (`weekProfile`); an "available now" label obeys C5a-4.
- **Structured data is unchanged and carries no schedule**: every displayed price stays an `Offer` with `InStock`; nothing in JSON-LD depends on the instant.

### C5-4 Functions (`channel-availability.ts`)

```ts
/** Instant-free: which complete rule governs, with its source. */
export function effectiveRule(inputs: AvailabilityInputs, item: ItemAvailabilityInput,
                              formatKey: FormatKey, ctx: OfferingContext): EffectiveRule
//  ctx 'channel' → the complete rule chosen by C5-3.
//  ctx 'general' → ChannelSet.none: constant available (source noChannels);
//                  otherwise the ANY-CHANNEL UNION: a synthetic rule whose weekProfile is available wherever ≥1 active channel's
//                  effective rule is available (source anyChannel). This is what C6 (instant-free) consumes for the website context.

/** At an instant, in the project zone (both required). */
export function explainAvailability(inputs: AvailabilityInputs, item: ItemAvailabilityInput, formatKey: FormatKey,
                                    ctx: OfferingContext, at: Date, timeZone: string): AvailabilityExplanation

/** Instant-free: the effective rule of every (format × public context). Renderers ship it; readiness and impact consume it. */
export function availabilityMatrix(inputs: AvailabilityInputs, item: ItemAvailabilityInput):
  ReadonlyMap<FormatKey, FormatAvailabilityMap>          // FormatAvailabilityMap = ReadonlyMap<'general' | ChannelKey, EffectiveRule>

/** Save-time validation of rows on items, formats (and, via C1, categories, and C2 channel defaults). */
export function availabilityRowIssues(rows: readonly unknown[], channels: ChannelSet): AvailabilityRowIssue[]
```

### C5-5 The composed public question — ONE function

"Can this be obtained on context X at instant T, and at what price?" is answered only by:

```ts
export type EffectiveOffer =
  | { kind: 'unavailable'; availability: AvailabilityExplanation }            // carries nextTransition
  | { kind: 'available'; availability: AvailabilityExplanation; price: PriceResolution;
      issues: readonly ('price.missing' | 'price.ambiguous' | 'price.indeterminate')[] }

/**
 * explainAvailability(at, tz) → (if available) resolvePrice(at, tz). Availability is computed first and is never changed by
 * the price answer (D-6 independence; K-3 rules 9–10): available + noPrice = available with 'price.missing'.
 * Price windows never shorten or extend availability; availability schedules never choose a price.
 * The zone is required. A caller without a project zone uses availableNow(), which returns 'scheduleOnly' (C5a-4).
 */
export function resolveOffering(inputs: AvailabilityInputs, item: ItemAvailabilityInput & { formats: readonly Format[] },
                                formatKey: FormatKey, ctx: OfferingContext, at: Date,
                                timeZone: string, project: { currency: string }): EffectiveOffer

/** Instant-free for cached public pages: effective rules (as weekly profiles) + displayPrices per format. */
export function publicCommerce(inputs: AvailabilityInputs, item: …, project: { currency: string }): PublicCommerce
export type PublicCommerce = {
  formats: readonly {
    key: FormatKey; label: LocalizedString | null
    /** Per public context: its weekly profile (constant profiles collapse to one range). For "Served 18:00–23:00" display and client-side re-evaluation. */
    availability: readonly { context: OfferingContext; profile: WeekProfile; availableSometime: boolean }[]
    prices: readonly Price[]                     // displayPrices — instant-free
  }[]
  /** Any format available at some time in some public context. Does NOT decide website presence (D-4). */
  availableSomewhere: boolean
  currency: string
}
```
`publicCommerce` contains no "now": a cached page built from it is valid at every hour. A page that wants "available now" adds an `AvailableNow` per C5a-4.

Callers that **must** switch (no caller keeps reading offers directly):

| Caller | Today | After |
|---|---|---|
| `resolve.ts` `resolveOffers` / `resolveItem` (`offers`, `hasOffers`) | every stored offer → DTO | `publicCommerce` → DTO `formats[]` with `prices` (display list) and `availability` profiles; `hasPrices` replaces `hasOffers` |
| `resolve.ts` `resolveCollection` (`hasOffers`) | any item has offers | any item has a displayed price |
| `structured.ts` `offersOf`, F-3 rule, OfferCatalog | `item.offers` | the DTO display prices (still `InStock`, no schedule, instant-free); F-3 = "no displayed price ⇒ no Product node" |
| `website.ts` (via resolve) | — | gets `channels` + category inputs + site `timeZone` into `CatalogueResolveContext` |
| `CatalogueItemParts` `OfferList` | `item.offers` | DTO display prices; channel label shown on the same rule as today (more than one price or any channel-scoped); windows/schedules not rendered in R1 |
| `dashboard-form.ts`, `dashboard-patch.ts` (`cleanOffers`), `item-issues.ts`, `itemGaps('noPrice')` | offer forms | format/price forms (carrying `note`); availability rule + schedule forms; `noPrice` → C6 `priceMissing` (`priceCoverage.kind === 'none'`) |
| `components/client/catalogue/ItemWizard.tsx` (initial `offers: []`, `PriceField`, `ItemPreview offers=`), `use-item-state.ts` (`offerRows`, `offersToDoc`, `OfferForm`), `item-fields.tsx` (`PriceField`, offer rows and windows), `ItemEditor.tsx` | offer state | format/price state; simple single-price form while `isSimple` (REVIEW A7) |
| `modules/catalogue/validation.ts:118` `CURRENCY_ITEM_PRICES_QUERY` (`offers[defined(price)].price`), used by `modules/config-validators.ts:41` (the D7 currency-change warning) | legacy offers | `coalesce(formats[].prices[].amount, offers[defined(price)].price)` in R1 — **must ship in R1**, because R2 writers unset `offers` and the warning would otherwise under-count (REVIEW A7, C-5) |
| `dashboard-queries.ts` `offerCount`, `prices`, `CATALOGUE_GLANCE_QUERY.noPrice`, list-model price sort | `offers` | `formats[].prices` (+ legacy during transition) |
| `dashboard-queries.ts` `CATALOGUE_REF_TARGETS_QUERY` result **`offered`** (option-item picker, D2) | `count(offers) > 0` | renamed **`hasPrice`** = ≥ 1 price on any format (legacy `offers` during transition). *Decided — Tom 2026-11-02, D-21:* refusal message **"This item needs at least one price before it can be used as a linked choice."** An item with at least one price qualifies even when unavailable on a particular channel; all other picker requirements (project scope, valid draft/published dependency, lifecycle checks) continue to apply. After the split, "offered" is never a synonym for "priced". |
| Future: automatic listings ("available now / at this time", D-6), preview, PDF, export, partner API | — | `availableNow` / `resolveOffering` (point-in-time, cache contract C5a-4) or `publicCommerce` (instant-free) — nothing else |

> **R1 implementation note (D-21):** R1 ships the option-item refusal under the renamed code **`linked_item_needs_price`** (was `invalid_value`) with Tom's decided message "This item needs at least one price before it can be used as a linked choice." (`src/lib/api/catalogue-drafts.ts`).

### C5-6 Impact calculator (rules and schedules)

```ts
export type AvailabilityChange = {
  itemId: string; formatKey: FormatKey; channel: ChannelKey
  before: WeekProfile; after: WeekProfile
  minutesToAvailable: number          // minutes of the week that become available
  minutesToUnavailable: number        // minutes of the week that become unavailable
}
export type AvailabilityImpact = {
  changes: readonly AvailabilityChange[]
  itemsChanged: number                 // distinct items with ≥1 change
  formatsChanged: number               // distinct (item, format) with ≥1 change
  byChannel: Readonly<Record<ChannelKey, { gainAvailability: number; loseAvailability: number; scheduleOnly: number }>>  // counted in formats
  shieldedByOverride: number           // (item, format, channel) whose upstream rule changed but an explicit item/format rule kept the result
}

/**
 * Pure, instant-free diff of two complete input sets over the same items. A change = the weekly profile of the effective
 * rule differs (so a schedule edit 18:00–23:00 → 18:30–23:00 counts, with its minutes). Never edits rules:
 * "preserving explicit overrides" is a property of the inputs, not an action.
 */
export function availabilityImpact(before: AvailabilityInputs, after: AvailabilityInputs,
                                   items: readonly ItemAvailabilityInput[]): AvailabilityImpact
```
Scope of `items`: every non-archived item of the project, **drafts and published versions both**. Counts are per stored document id; the UI shows "N items" using distinct base ids. Used by: channel activate/deactivate/default rule or schedule change (C2), category rule or schedule change and category move/reparent (C1), primary-category bulk reassignment (bulk slice), pack application preview (C7), "Use category default" in bulk.

### C5-7 Stored shape
One object type for every level — category (stored by C1 in `catalogueTaxonomy.categories[].channelRules[]`), item (`catalogueItem.channelAvailability[]`), format (`catalogueFormat.channelAvailability[]`); the channel default uses the same `state` + `schedule` pair on its config entry (C2):

```jsonc
{ "_key": "delivery", "_type": "catalogueChannelRule", "channel": "delivery", "state": "unavailable",
  "schedule": [ /* optional, C5a-2 */ ] }
```
- `_key` **is the channel key** (addressable by patch path; a second row for the same channel is impossible in a valid array); `channel` repeats it for readable GROQ; `state ∈ { available, unavailable }` is the baseline.
- "Inherit" = no row. "Use category default" = unset the row — which restores the **complete** upstream rule and schedule (D-6.1). Never store `'inherit'`.
- One validator for all levels: `availabilityRowIssues` — row codes and schedule codes (C5-10).

### C5-8 Invariants
- I-C5-1 Total and deterministic: for every (format, active channel, instant, zone) exactly one state; never the machine zone.
- I-C5-2 At most one row per channel per level (guaranteed by `_key` = channel key; `availability.duplicateChannel` for data that bypassed it). *Decided — Tom 2026-11-02, D-21:* conflicting duplicate rows → that level is treated as unset **and** `availability.conflictingRows` is a visible readiness error — never an arbitrary winner.
- I-C5-3 A rule or schedule change never writes item/format rows.
- I-C5-4 `general` never has stored rules.
- I-C5-5 Replace, never merge: the evaluated schedule always belongs to exactly one rule.
- I-C5-6 Availability never reads prices; prices never read availability schedules (D-6 independence).
- I-C5-7 Instant-free outputs (`effectiveRule`, `weekProfile`, `publicCommerce`) contain no "now"; every instant-based output carries `at`, `timeZone`, `nextTransition`.

### C5-9 Test fixtures (`channel-availability.test.ts`, `availability-schedule.test.ts`) — zone `Europe/Rome`
Fixture project: channels `dine-in` (default available), `takeaway` (default available), `delivery` (default unavailable), `room` (inactive). Tree: `food` › `pizza` › `bianche`; `food.delivery = available`; `pizza.delivery = unavailable`; `bianche` none; `drinks` (root) `{takeaway: unavailable}`; `dinner` (root) `{dine-in: baseline unavailable, override every day 18:00–23:00 available}`.
Instants (UTC → Rome, CET = UTC+1 after 2026-10-25): `MON_0800 = 2026-11-02T07:00:00Z`, `MON_1100 = 2026-11-02T10:00:00Z`, `MON_1759 = 2026-11-02T16:59:00Z`, `MON_1800 = 2026-11-02T17:00:00Z`, `MON_2300 = 2026-11-02T22:00:00Z`, `FRI_2200 = 2026-11-06T21:00:00Z`, `SAT_0100 = 2026-11-07T00:00:00Z`, `SAT_0200 = 2026-11-07T01:00:00Z`, `SUN_1200 = 2026-11-08T11:00:00Z`.

Precedence (rules without schedules):
- `C5-F1 bottoms out` — primary `bianche`, no rows: dine-in → available/projectDefault; delivery → unavailable/category `pizza` (`inheritedFromAncestor: true`).
- `C5-F2 most specific wins` — `food` available, `pizza` unavailable → `pizza`.
- `C5-F3 item rule` — item `{delivery: available}` → available/item; `inherited` = complete rule from category pizza.
- `C5-F4 format rule` — format B `{takeaway: unavailable}` → B unavailable/format; A available/projectDefault; item-level takeaway available.
- `C5-F5 additional categories inert` — additional `[drinks]` → takeaway stays available.
- `C5-F6 no primary` — L0 only. `C5-F7 broken path` — primary `ghost` → L0 + `availability.primaryCategoryBroken`.
- `C5-F8 inactive` — `room` → unavailable/channelInactive, `nextTransition: null`.
- `C5-F9 no channels` — `general` available/noChannels, `nextTransition: null`.
- `C5-F10 general with channels` — available on dine-in only → general available/anyChannel `['dine-in']`.

Schedules (D-6):
- `C5-S1 breakfast 07–11` — item rule dine-in baseline unavailable + every day 07:00–11:00 available: `MON_0800` → available, `activeOverride.endsAt = MON_1100`, `nextTransition = MON_1100`; at `MON_1100` → unavailable (half-open), `nextTransition = 2026-11-03T06:00:00Z`.
- `C5-S2 Dinner category` — primary `dinner`, no item rule: `MON_1759` unavailable/category `dinner`, `nextTransition = MON_1800`; `MON_1800` available, `nextTransition = MON_2300`; `MON_2300` unavailable.
- `C5-S3 delivery evening only` — channel default `delivery` baseline unavailable + every day 18:00–23:00 available, item with no rows: `MON_1100` unavailable/projectDefault; `MON_1800` available/projectDefault.
- `C5-S4 unavailable on Sundays` — item rule dine-in baseline available + override `days:[sun]` all day unavailable: `SUN_1200` unavailable; `SAT_0100` available with `nextTransition(SAT_0100) = 2026-11-07T23:00:00Z` (Sun 00:00 local); `nextTransition(SUN_1200) = 2026-11-08T23:00:00Z` (Mon 00:00 local).
- `C5-S5 overnight Fri 22:00–02:00` — baseline unavailable + `days:[fri] 22:00–02:00` available: `FRI_2200` available; `SAT_0100` available (Saturday 01:00 belongs to Friday's interval, A1); `SAT_0200` unavailable; `nextTransition(FRI_2200) = SAT_0200`.
- `C5-S6 DST spring-forward` — override every day 01:00–02:30 available, baseline unavailable, at `2027-03-28T00:30:00Z` (01:30 CET) → available; `nextTransition` = the first instant at which wall-clock evaluation turns unavailable (`2027-03-28T01:00:00Z`, 03:00 CEST, because 02:00–02:59 local does not exist); oracle = minute scan.
- `C5-S7 DST fall-back` — same rule, `2026-10-25T00:30:00Z` (02:30 CEST) → unavailable at 02:30; the repeated hour 02:00–02:59 CET (`2026-10-25T01:00:00Z`–`01:59Z`) evaluates by wall clock → available 02:00–02:29 a second time: `nextTransition(2026-10-25T00:30:00Z) = 2026-10-25T01:00:00Z`, then `nextTransition(2026-10-25T01:00:00Z) = 2026-10-25T01:30:00Z`; both equal the minute-scan oracle (proves the definition, not a guess).
- `C5-S8 item "Available" replaces a category schedule` — primary `dinner`, item rule dine-in `{state: available}` no schedule → `MON_1100` available/item, `nextTransition: null` (available all week, D-6.1).
- `C5-S9 format replaces item` — item rule dine-in breakfast schedule (S1), format B rule `{state: unavailable}` → B unavailable all week/format; format A follows the item schedule; other channels unaffected.
- `C5-S10 "Use category default"` — remove S8's item row → result equals S2 exactly (complete upstream rule and schedule restored).
- `C5-S11 overlap refusal` — overrides 07:00–11:00 and 10:00–12:00 in one rule → `availability.scheduleOverlap` (keys of both); 07:00–11:00 + 11:00–12:00 → valid (half-open); overlap across different levels → valid (never merged).
- `C5-S12 standard price unchanged across availability changes` — S2 item with one standard price €18: `resolveOffering` at `MON_1759` → unavailable (price not consulted); at `MON_1800` → available, €18 standard; `displayPrices` identical at both instants.
- `C5-S13 available + no price` — S2 item with no prices at `MON_1800` → `available` + `price.missing`; never `unavailable`.
- `C5-S14 price window does not gate availability` — S2 item with price €12 window 19:00–20:00 and no standard price: at `MON_1800` → available + `noPrice{outsideWindows}` + `price.missing`; at 19:30 → available €12.
- `C5-S15 no zone` — `availableNow(..., timeZone: null)` → `scheduleOnly{timeZoneMissing}`.

Impact:
- `C5-F12 impact` — flip `pizza.delivery` to inherit over {bianche-no-rows, bianche-with-item-delivery-unavailable} → 1 change (whole week to available), `shieldedByOverride: 1`.
- `C5-F13 activation impact` — activate `room` with default available over 3 items × 2 formats → `formatsChanged: 6`, `byChannel.room.gainAvailability: 6`.
- `C5-F14 schedule edit impact` — `dinner` 18:00–23:00 → 18:30–23:00 over 2 items with no rows and 1 with an item rule → `formatsChanged: 2`, each `minutesToUnavailable: 210` (30 min × 7 days), `shieldedByOverride: 1`.

### C5-10 Validation errors

| Code | Level |
|---|---|
| `availability.keyMismatch` (`_key !== channel`) · `availability.duplicateChannel` · `availability.stateInvalid` · `availability.unknownChannel` | error |
| `availability.inactiveChannel` | warning |
| `availability.conflictingRows` | readiness error (C6), D-21 |
| `availability.primaryCategoryBroken` | readiness (C6 → `primaryCategoryMissing`) |
| `availability.scheduleOverlap` (two overrides of one rule share a minute; payload: both keys) | error |
| `availability.scheduleInvalidTime` · `availability.scheduleIncomplete` · `availability.scheduleZeroLength` · `availability.scheduleUnknownDay` | error (same checks as `windowIssues`) |
| `availability.scheduleUnknownKind` (stored member type this code does not know) | error on save; ignored with readiness error on read |
| `availability.scheduleLimitExceeded` (> 14 overrides) | error |
| `availability.scheduleRedundant` (override state = baseline) | warning |
| `availability.scheduleOnImplicitFormat` | error (I-C3-4) |

---

## C10 — Migration

### C10-1 What changes in storage

| Old | New |
|---|---|
| `catalogueItem.offers[]` (`catalogueOffer`: `channel?`, `price`, `priceNote?`, `availability[]`, reserved `currency`, `locationKey`) | `catalogueItem.formats[0]` = implicit format `_key: 'default'` with `prices[]` (`cataloguePrice`) |
| `offer._key` | `price._key` (same value — D14 identity preserved) |
| `offer.channel` absent | `price.channel` absent (standard) |
| `offer.channel = c` | `price.channel = c` |
| `offer.price` / `priceNote` / `availability[]` | `amount` / `note` / `windows[]` (each window keeps its `_key`) |
| `offer.currency`, `offer.locationKey` | **not copied.** Pre-flight lists every document carrying either and refuses (REVIEW X-14; matches C6 `integrity.currencyStored`). Production: none. |
| implied availability ("sold where an offer exists") | explicit availability: project defaults + item rules, computed below — **baseline only, no schedule** |
| offer `availability[]` windows | **price** windows (`cataloguePrice.windows`) — never availability schedules (D-6 independence; the old site never let windows hide anything, C10-2) |
| config `serviceChannels[]` `{value,label}` | + `active: true`, `defaultAvailability` computed below |

### C10-2 Where old public behaviour depended on windows — answer: nowhere observable
Audited 2026-11-02:
1. **Website rendering** lists every stored offer regardless of the hour (`OfferList`), so a windowed offer was always visible with its price. Windows never hid a price or an item.
2. **JSON-LD** emits every offer as `InStock`; windows are explicitly not mapped (structured.ts header).
3. **Item presence** (collections, item pages, sitemap, `llms.txt`) never depended on offers or windows — only lifecycle and visibility. Items with no offers (5 published books) are public today.
4. **`resolveOffer` / `channelState` / `isSoldOn`** — the only place where windows gate selling ("notSold"/"outOfHours") — have **no production caller**. `CatalogueOfferDTO.state` is computed and never rendered.
5. Dashboard: windows only appear in the offer editor; `noPrice` counts offers, not windows.

Consequence: K-3's change of meaning (windows choose a price, never availability) changes **no observable public output**. It changes the *point-in-time resolver API* in one class of data, defined in C10-5 as the expected divergence class `W`.

### C10-3 Mapping (pure, `legacy-commerce.ts` — the single implementation used by BOTH the dual-read and the migration)

```ts
/** Legacy offers → formats. Deterministic; same input → byte-identical output (stable keys, stored order). */
export function legacyOffersToFormats(offers: readonly RawLegacyOffer[] | null | undefined): CatalogueFormatDoc[]
//  [] or null → []   (no write needed: formatsOf() synthesises the implicit format)
//  else → [{ _key:'default', _type:'catalogueFormat', prices: offers.filter(valid).map(toPrice) }]
//  "valid" = exactly what resolveOffers keeps today (_key string, finite price ≥ 0); invalid rows are
//  NOT dropped silently: the pre-flight report lists them and the migration refuses (C10-6 step P).
//  An offer carrying `currency` or `locationKey` is refused the same way (REVIEW X-14).

/** Legacy implied availability → explicit project defaults + item overrides, per project.
 *  Decided — Tom 2026-11-02, D-10: "Project default unavailable + explicit available rules for everything the old model
 *  considered sold. A migration must never make a new or existing item available through an additional channel." */
export function legacyAvailability(channelKeys: readonly ChannelKey[], items: readonly { id: string; offers: RawLegacyOffer[] }[]):
  { defaults: Record<ChannelKey, ChannelAvailabilityState>; itemRules: Record<string, Record<ChannelKey, ChannelAvailabilityState>> }
//  old(item, c) = isSoldOn(offers, c)  ≡  ∃ offer with scope c or scope null           (time ignored — see C10-2)
//  defaults[c]  = 'unavailable' for every channel
//  itemRules[i][c] = { state: 'available', overrides: [] } for every item with old(i, c) === true (no row where old is false)
//  No schedules are ever written by the migration (baseline only).
//  No category rules are written (none exist; categories become 'inherit' everywhere).
//  No format rules are written.
```

Why a conservative default rather than a majority default (Rev 1): both are exact for **existing** items (each resolves to `old(i,c)`), but a majority `available` default would make **future** items available on `c` with no price, which the old model never did — brief §27 "defaults must never silently make items available through new channels" (REVIEW C-1). The cost is one explicit item override per sold (item, channel), which shields those items from later category rules; Setup's "Use category default" (bulk, with `availabilityImpact`) is how a tenant hands them back to inheritance. No production impact either way (no channels).

**Projects with no channels (all of production today):** no availability is written at all; `general` context applies; the mapping is "one implicit format, one standard price per offer, no channels" exactly as K-3 states.

**Items with no offers in a channel project:** `old = notSold` everywhere → unavailable on every channel. They stay on the website (presence is lifecycle-only, C10-2 item 3; Issue T-1).

### C10-4 Dual-read (reader-first)

```ts
/** The ONLY function that reads an item's commerce fields. */
export function commerceOf(raw: { formats?: unknown; offers?: unknown; channelAvailability?: unknown }): {
  formats: readonly Format[]; itemRules: ReadonlyMap<ChannelKey, ChannelAvailabilityRule>; source: 'formats' | 'legacy' | 'empty'
  issues: readonly ('legacy.offersShadowed')[]
}
//  formats present (non-empty) → formats win; non-empty legacy offers alongside → ignored + 'legacy.offersShadowed'
//  else legacy offers present → legacyOffersToFormats(offers), and item rules derived from them ONLY when the
//       project has channels and no migrated defaults yet (i.e. before the config is migrated): old(i,c) used directly
//  else → implicit empty format
```
Channel read default during transition: a project whose `serviceChannels` entries lack `defaultAvailability` is **unmigrated**; for it, `commerceOf` derives item rules from legacy offers so that behaviour is the old one even before the data migration runs. Once the config carries explicit values, legacy derivation stops.

### C10-5 Equivalence test (`commerce-equivalence.test.ts` + live script `scripts/catalogue/verify-commerce-equivalence.mjs`, read-only)

Population: every `catalogueItem` document of every project — published, `drafts.*` and `versions.*` — read in the raw perspective, before and after migration (snapshot files), plus synthetic fixtures F-E1…F-E9 below. The script **asserts and prints the counts per id class** (production 2026-11-02: 10 published, 6 drafts, 0 versions) and fails when `versions.*` is non-zero unless that class is mapped explicitly (REVIEW C-6).
*Decided — Tom 2026-11-02, D-7:* "Compare old and new **public, visitor-visible outcomes** by item, context, channel and fixed instant; report price-window gap cases separately. Production has none, so its diff must be empty. Do not require two intentionally different internal resolvers to return identical internal objects." The relation below therefore compares outcomes (obtainable on channel c at t? at which price key and amount? what the page, JSON-LD and listings show), never internal result objects; E9 is an internal sanity check, not part of the pass criterion.
Contexts: every configured channel of the project, active or not, **plus** `general`.
Instants (zone = site zone; `Europe/Rome` for the synthetic set): every 30 minutes across one reference week starting `2026-11-02T00:00` local (336), plus for each stored window `from−1min`, `from`, `to−1min`, `to` on each of its days, plus `2027-03-28T01:30:00Z` and `2026-10-25T00:30:00Z` (DST).

Compared, per document:

| # | Old | New | Relation |
|---|---|---|---|
| E1 | obtainable on c: `isSoldOn(offers, c)` | `explainAvailability(…, t, zone).state === 'available'` for the implicit format, at **every** instant t of the set (migrated rules have no schedule, so this is constant) | equal, every channel, every t |
| E2 | `resolveOffer(offers, c, t)` kind `offer` → (offer `_key`, price) | `resolveOffering(...)` `available` + `price` → (price key, amount) | equal |
| E3 | `resolveOffer` `ambiguous` (scope, key set) | `price.kind === 'ambiguous'` (scope, key set) | equal |
| E4 | `resolveOffer` `notSold` with `isSoldOn = false` | `unavailable` | equal |
| E5 | `resolveOffer` `notSold` with `isSoldOn = true` (window gap) | `available` + `noPrice`/standard fallback | **class W — expected divergence; listed, must be empty for the run to pass unless Tom accepts each listed case** |
| E6 | website DTO `offers[]` (key, amount, formatted, note, channelLabel, order) | DTO display prices (same fields, same order) | equal |
| E7 | `catalogueItemJsonLd` / `catalogueCollectionJsonLd` per page and locale | same functions on new DTO | deep-equal |
| E8 | `general` (no channels): the full old offer list | `displayPrices` in `general` | equal |
| E9 | dashboard list `offerCount`, `prices` (internal, not visitor-visible) | `formats[].prices` count and amounts | equal — sanity check only |
| E10 | no availability label, schedule or "available now" on any public page (none existed) | R1 renders none (migrated rules are constant; schedule display ships later as an approved change) | equal |

Production expectation: all four priced documents have one unscoped, window-less offer → E1–E10 equal, class W empty. The run's report (counts, diffs, W list) is committed with the migration slice and summarised in the project doc.

Synthetic fixtures (must all pass before the live run):
- `F-E1` no offers, no channels → implicit empty format; E8 empty list both sides.
- `F-E2` one unscoped offer, no channels → one standard price, key kept.
- `F-E3` unscoped + takeaway offer, channels dine-in/takeaway → dine-in: standard, takeaway: channel price; defaults both `unavailable`; item rows dine-in `available`, takeaway `available` (D-10).
- `F-E4` channels dine-in/takeaway, item A takeaway-only offer, item B unscoped offer → defaults `{dine-in: unavailable, takeaway: unavailable}`; rows A `{takeaway: available}`, B `{dine-in: available, takeaway: available}`; a new item C with no rows → unavailable on both.
- `F-E5` lunch/dinner unscoped windows → E5 class W at 16:00 (proves the detector works); E6/E7 equal.
- `F-E6` overnight Friday window → E2 equal at Sat 01:30.
- `F-E7` two overlapping unscoped offers (legacy) → E3 ambiguous both sides.
- `F-E8` priceNote present → note carried, E6 equal.
- `F-E9` offer on an unknown channel → pre-flight refuses (C10-6 step P).
- `F-E10` offer with `currency: 'USD'` → pre-flight refuses (REVIEW X-14).

### C10-6 The single rollout plan for all Catalogue data changes (owned here — REVIEW E-1)

C1 (taxonomy), C7 (pack history), C11 (public name), C6/C9/C12 (gate, Studio posture, audit) **reference this section instead of their own orders**. A change to the order is a change to this contract.

**Governing rule.** Sanity is one dataset for dev, preview and production (no development dataset; `staging` is empty), so "dev then production" cannot apply to data: a data change is visible to every deployed code stage at once. Therefore **no stored shape changes until the reader that accepts both shapes runs in production** (2026-08-14 outage rule; K-9 step 3), every data step is **additive** until R3, and every writer that switches shape does so on **the same document it rewrites** (never two truths on one document). 

*Decided — Tom 2026-11-02, D-11 (verbatim):* "Rehearsal — Yes, in this order: (1) deploy readers that accept both shapes; (2) export production Catalogue data; (3) rehearse the complete migration on `staging`; (4) produce equivalence and migration reports; (5) stop for approval; (6) run the production migration; (7) keep the export as rollback artefact. The staging rehearsal must not write to production."

How the table below realises it: (1) = **R1**; (2) = **P** (export); (3) = **S** (complete migration — D1–D4 and the R2 writer behaviour — on `staging`); (4) = the reports of P and S; (5) = **Stop**; (6) = **R2**, then **P′** and **D1–D4** on production; (7) = the P export (rehearsal) and the P′ export (production data steps, REVIEW C-19) are kept, untouched, until R3 is accepted.

**Staging never writes to production (D-11), enforced in the scripts:** every migration script takes an explicit `--dataset` (no default) and writes only there; in rehearsal mode the environment holds a write token scoped to `staging` only and a read-only token for the production export; a write to `production` requires `--dataset production --approval <ref>` and refuses when the referenced S report is missing or not green; the S run asserts before its first mutation that the client's dataset is `staging`. Reading production for the export is the only production access in steps P and S.

**Reserved Supabase migration numbers (REVIEW E-15).** The two Catalogue migrations are numbered here and nowhere else, in this order: **`061_catalogue_audit_log.sql`** (C12) then **`062_studio_break_glass.sql`** (C9). Latest on disk 2026-11-02 is `060_billing_profile_contact_taxcode.sql`; if a billing migration takes 061/062 before M0 lands, both shift to the next two free numbers *together* and this line is updated in the same commit.

**Per-project migration markers.** Each data step, after its verification passes, writes one timestamp into module config `catalogueMigrations: { taxonomy?, commerce?, packHistory?, publicName? }` (ISO strings, module-written, hidden in every editor). These are the **only** runtime-readable migration facts; they gate rule activation (step 7) by data presence, never by date (REVIEW C-16). They say nothing about which pack was applied (D-1 guard intact).

| Step | What ships / runs | Owner of the content | Precondition | Verification (all read-only) |
|---|---|---|---|---|
| **M0 — audit store** | (a) C12 writer with "table missing ⇒ log and continue"; (b) then migration `061_catalogue_audit_log.sql` applied on Abluo Sandbox, Tom approves, applied on Abluo. | C12 | — | writer test with and without the table; `select` on the new table |
| **R1 — readers + schema** (one release; **writers unchanged**, still legacy) | Schema types registered: `catalogueFormat`, `cataloguePrice`, `catalogueWeeklyWindow` (price windows), `catalogueChannelRule` with optional `schedule[]` of `catalogueWeeklyOverride` (availability schedules, C5a), `catalogueTaxonomy`, `cataloguePackHistory`, `cataloguePublicationStandards`, module-config fields `publicName`, `formatTemplates`, `catalogueMigrations`, channel attributes `active`/`defaultAvailability`/`defaultSchedule`. Schedule evaluation (`evaluateRule`, `nextAvailabilityTransition`) ships in R1 even though migrated data has no schedule, so the first schedule a tenant saves is read correctly everywhere. **Item fields:** `primaryCategory`, `additionalCategories`, `formats`, `channelAvailability`, `readinessOverrides` (readOnly, hidden), `complianceTasks[]` (readOnly) and the C13 declaration fields `review`, `invalidation`, `declarationVersion` (readOnly). **Module-config fields:** `setupCompletedAt`, `setupSource`, `publicName`. **Readers:** tolerant `allergens.ts` (C13.7) and the C13 shape in `allergenDeclarationIssues`. All registered in R1 so that no later writer writes an undeclared field; none is written before its owning slice (REVIEW C-3). **C10:** `commerceOf`, `formatsOf`, `resolvePrice`, `explainAvailability`, `publicCommerce` and **every** switched caller in C5-5, including `CURRENCY_ITEM_PRICES_QUERY`. **C1:** triple dual-read of the vocabulary (taxonomy document → `taxonomyTerm` → `config.categories`) and `legacyCategoriesToAssignment` for items; `primaryPath`/`categoryChannelRule`. **C11 R-A1:** dashboard always "Catalogue", `publicName` reader, **no** public consumer; every `navLabel` reader removed. **C7:** history reader (`appliedPreset{bookshop,1}` read virtually as `bookshop@1`) and `setupCompletedAt` reader. **C6:** steps 1–2 (readiness adapter, gate extraction — behaviour-preserving). **C9:** Catalogue **documents** read-only in Studio (layers 1–3); the **config lock does not ship here**. Windows carried but not rendered (C-2). | each contract for its part; this plan for the release boundary | M0 done | synthetic suites (C10-5 F-E*, C1 fixtures, C11 fixtures) green; after promotion to production: E6/E7 against the live tmz site and C11 `website-output.unchanged` byte-equal |
| **P — pre-flight** | One export of every Catalogue-relevant document (`catalogueItem`, `catalogueCollection`, `catalogueOptionList`, `cataloguePage`, Catalogue `taxonomyTerm`, the `project` documents with a Catalogue installation) — **the rollback artefact for every data step**. Dry runs of D1–D4 in memory: invalid offers, unknown-channel offers, offers with reserved fields, class W, taxonomy cycles/duplicates, multi-category items, `navLabel`/`publicName` plans. Any refusal → stop, Tom decides. | this plan | R1 in production | dry-run report committed with the migration slice |
| **S — staging rehearsal** | Import the export into `staging`; run D1–D4 there in order; run each step's verification (before = export, after = staging). R2 writer behaviour is rehearsed from a **dedicated preview deployment whose Sanity dataset is set to `staging`** with the staging-only token; the shared preview deployment is not used (REVIEW C-30). | this plan | P clean | every diff empty (class W listed separately) |
| **— Stop: Tom approves —** | | | | |
| **R2 — writers + Setup** | Dashboard writes `formats` and **unsets `offers` on the same document**; writes `primaryCategory`/`additionalCategories` and **unsets `categories` on the same document**; import (when it exists) the same. `CatalogueTaxonomyService` becomes the only term writer and, on its first write for a project, **seeds `catalogue-taxonomy.<slug>` from that project's term records with the same pure function D1 uses** (so no term edit is lost between R2 and D1 — REVIEW X-13b). Categories & Tags loses its Catalogue tab. Catalogue → Setup shell and the Catalogue config editors exist; **Studio config lock** (`moduleInstallations[].config` read-only for the Catalogue, Modules pane read-only) ships **here, with Setup**, never earlier (REVIEW X-13e, C-18). `dashboard-queries.ts` / `list-model.ts` image shape is read from `defaultItemProfile` instead of the legacy `presetId` (D-13 part 4); fixture `image-shape/tmz-fallback` (C7.11) green, so R3 can remove the guard exceptions (REVIEW C-28). | C1 (taxonomy writer), C10 (commerce writer), C9 (config lock), ADR-042/Setup | Tom's approval | writer tests: each switched writer leaves exactly one shape on the document it wrote; K-4 "only Setup writes Catalogue terms" test |
| **P′ — refresh before production data steps** | Immediately before D1 on production: a second export (same scope as P) and the same dry runs. Any new refusal stops the run. **P′ is the rollback artefact for D1–D4**; P stays the artefact for the rehearsal. Each D-script re-runs its own pre-flight on live data before its first mutation (REVIEW C-19). | this plan | R2 in production | dry-run report identical in kind to P (new refusals listed) |
| **D1 — taxonomy** (data) | `scripts/catalogue/migrate-taxonomy.mjs`: create `catalogue-taxonomy.<slug>` if absent (`createIfNotExists`; skipped where R2 already seeded it), copy categories/tags verbatim (keys immutable, incl. `illustrated_boos`); for every item document (published and draft, same pure function) set `primaryCategory`/`additionalCategories` from `categories` — **keep `categories`** (additive). Marker `catalogueMigrations.taxonomy`. Audit `migration.taxonomy`. | C1 (mapping, C1.9 verify) | R2 in production | C1.9 step-3 verification: assignment = legacy set, `primary == categories[0]`, labels per locale equal |
| **D2 — commerce** (data) | `scripts/catalogue/migrate-commerce.mjs`, idempotent (guard: `formats` present → skip): for every item document with non-empty `offers`: set `formats = legacyOffersToFormats(offers)` and `channelAvailability` from `legacyAvailability`; **keep `offers`**; patch `drafts.X` and `X` with the same function so draft/published difference is preserved; then project config: add `active: true` and `defaultAvailability` (C10-3) to each channel entry. Marker `catalogueMigrations.commerce`. Audit `migration.commerce` (per project: documents, prices, rows written). | C10 | D1 done for the project (R1's `publicCommerce` already reads C1 inputs, so D2 never runs against an unreadable tree) | C10-5 E1–E9, before = export, after = production |
| **D3 — pack history** (data) | Convert `appliedPreset{bookshop,1}` (tmz) into `cataloguePackHistory` entry `bookshop@1` (`added.settings = ['publicSegment','defaultItemProfile']`); keep `appliedPreset` (inert); and, in the same transaction, module config `setupCompletedAt = appliedAt`, `setupSource = 'pack'` where unset (D-14). Marker `catalogueMigrations.packHistory`. Audit `migration.pack_history`. | C7 (mapping) | R2 in production | C7 `guard/legacy-preset` fixture against the real record; tmz `isSetupComplete === true` |
| **D4 — public name** (data) | C11 R-A2: `scripts/catalogue/migrate-public-name.mjs` copies `navLabel` → `publicName` (every locale) when no `publicName` exists, else drops; **unsets `navLabel`** — the only non-additive data step, safe because R1 removed every reader. Audit `public_name.migrated { action: 'copy'|'drop', old, new, discarded, migrationId }` (the `old` value is the rollback source). Marker `catalogueMigrations.publicName`. Runs **last**. | C11 | D1–D3 verified | C11 `website-output.unchanged` + "preserved word" check |
| **7 — rule activation** | C6 required rules that need the new model (`primaryCategoryMissing`, price rules, `integrity.*`) activate **per project** when `catalogueMigrations.taxonomy` **and** `catalogueMigrations.commerce` are set for it — not by date, not globally (REVIEW C-16). Projects created after R2 are born migrated (the install flow writes the markers). | C6 | D1, D2 verified for that project | C6 activation fixtures (marker present/absent) |
| **R3 — cleanup** (Tom's call, after a soak) | Unset legacy `offers`, `categories`, `config.categories`; delete Catalogue `taxonomyTerm`s; remove `appliedPreset`, the `navLabel` schema field, legacy readers (`commerceOf` legacy branch, vocabulary fallbacks, preset fallbacks in `dashboard-queries.ts`/`list-model.ts` once replaced — C7 Issue 8), the `catalogueOffer` type and `offers.ts`, the deprecated window aliases. Tests change in the same commits (K-13). | each owner | Tom | full suites; a scan test that no legacy identifier is read |

**Writer identity and payload limit for every script in this plan.**
- Every migration mutation sets `transactionId = 'abluo-migr-<migrationId>-<n>'`. The accepted prefixes are the single exported constant `CATALOGUE_WRITER_PREFIXES` in C9 `catalogue-posture.ts` (`abluo-dash-`, `abluo-gate-`, `abluo-pack-`, `abluo-setup-`, `abluo-migr-`); this plan defines no second list, so migration writes are never reported as `studio.write_outside_gate` (REVIEW C-4).
- Every script batches its mutations against the one named constant `SANITY_MUTATION_MAX_BYTES` in `src/lib/sanity/limits.ts` (shared with C6 `publishManyTogether` and C7 `PACK_MAX_TX_BYTES = min(1_000_000, SANITY_MUTATION_MAX_BYTES)`), estimating the payload before sending, with the same 20 % margin; a draft/published pair is never split across two transactions (REVIEW C-13).

**Gates outside the data steps** (REVIEW C-20):
1. **Access register** (D-18, C9 9.5a): before R1 is promoted, this checklist is completed and dated here — seats limited to named staff; the only write token is the server token; the migration token is issued per run (`--dataset` scoped) and revoked after it; MCP/CLI/personal tokens read-only. *Completed: 2026-11-03, Tom (project 3n7t84j3). Members: Tom only. Tokens: "Abluo API" Editor = the website's server write token (`SANITY_API_WRITE_TOKEN`); "Local dev" and "Website read" Viewer; "CLI deploy" deploy-studio robot; "Media library" Viewer. "Abluo setup" Editor = standing script token (`SANITY_API_TOKEN`/`SANITY_AUTH_TOKEN`, used only by scripts/migrations, not the website) — kept for the C10-6 data steps as the per-run migration token, **revoked after D4**. Webhooks: "Abluo deleted events" and "Abluo content activity" enabled.*
2. **Allergen evidence retention** (D-20, C13 13.6): the allergen slice (`reviewAllergens` writers) is **not enabled in production** until the privacy/legal retention decision is recorded here with its date and reference. Until then: five years as platform audit default; longer allergen retention pending legal/privacy approval. *Recorded: — (decision, date, reference).*
3. C9's `062_studio_break_glass.sql` and break-glass routes ship after C6 step 2–3 exists (C9.7), at any point after M0. ADR-042 navigation foundation is independent of the data shape.

### C10-7 Rollback

Code rollbacks are always one release at a time; data reverts use the step's `--revert` mode or **the P′ export** (P is the rehearsal artefact only).

| From state | Code rollback | Data revert |
|---|---|---|
| R1 live, no data step run | safe (writers unchanged, nothing new stored) | none needed |
| R2 live, before D1–D4 | R2 → R1 safe (R1 reads both shapes). R1 → pre-R1 **unsafe once R2 has written**: documents it touched no longer carry `offers`/`categories` | `formatsToLegacyOffers` and `assignmentToLegacyCategories` (`[primary, ...additional]`, exact) restore the legacy fields on touched documents; taxonomy edits made through the service exist only in the taxonomy document → `taxonomyToTerms` is **lossy** (hierarchy, rules, archived state); the script lists every lossy case and refuses without `--accept-lossy` + Tom's approval |
| after D1 | as above | D1 is additive: unset `primaryCategory`/`additionalCategories` on documents whose values still equal the D1 output; the taxonomy document may stay (pre-R1 code ignores it) |
| after D2 | as above | D2 is additive: unset `formats`/`channelAvailability` on documents still equal to the D2 output, and the two channel attributes; `formatsToLegacyOffers` is exact for single-format items whose rows equal the legacy implication, **lossy** for multi-format items, format overrides and availability the legacy model cannot express (e.g. "standard price but unavailable on takeaway") — listed, refused without `--accept-lossy` |
| after D3 | as above | delete the `cataloguePackHistory` document (`appliedPreset` was kept) |
| after D4 | R1 → pre-R1 would show "Catalogue" until reverted | restore `navLabel` from the `public_name.migrated.old` audit payload (or the P′ export); unset `publicName` where it was copied |
| after R3 | none without data | restore from the P′ export and re-apply edits made since (manual) — the reason R3 waits for Tom |

### C10-8 Supersedes
Brief §27 "offers → implicit default formats; channel semantics → explicit availability + price fallback" (specified here); ADR-033 D-1 `serviceChannels` preset shape (packs write `active` and `defaultAvailability`, C7).

---

## Interfaces other contracts depend on

Exported from `src/lib/modules/catalogue/` (module file in brackets); `commerce-types.ts` re-exports every type below. Other workstreams import these; none reimplements them (K-9). **Owner names win** (REVIEW X-2): C6, C7 and C1 use exactly these names.

| Name | Kind | Used by |
|---|---|---|
| `ChannelKey`, `FormatKey` | branded types [`commerce-types.ts`] | C1, C6, C7, import/export |
| `Channel`, `ChannelSet`, `readChannels`, `publicContexts`, `channelUsage`, `channelListIssues` | [`channels.ts`] — replaces C6's `ServiceChannel` and C7's `ChannelObject` | Setup, C6, C7, C1 |
| `OfferingContext` (`channel` \| `general`) | type | C6 maps its `PublicationContext` to it with its own `offeringContextOf` (REVIEW X-6), preview, PDF, export |
| **`AvailabilityRuleValue`** (`inherit` / `available` / `unavailable`) | tri-state a person sets; replaces C1's `ChannelRule` | C1 (`CategoryNode.channelRules`), C6, C7 |
| **`ChannelAvailabilityState`** (`available` / `unavailable`) | effective result — **the name is deliberately not `AvailabilityState`**, which `availability.ts` keeps for windows until R3 (C0) | C1, C6, C7 (`PackChannelSuggestion.defaultAvailability`), C12 payloads |
| **`ChannelAvailabilityRule`** (`{ state, overrides }`), **`ScheduledOverride`** (discriminated, `kind: 'weekly'` today), `WeekProfile` | types [`availability-schedule.ts`] — the stored rule at every level (category, item, format, channel default) | C1 (`CategoryNode.channelRules` values), C6, C7 (packs may propose schedules), listings |
| `evaluateRule`, `weekProfile`, `availableSometime`, **`nextAvailabilityTransition`**, `scheduleIssues`, `readChannelRule` | [`availability-schedule.ts`] | C5 only, listings, item page labels |
| **`AvailableNow`**, **`availableNow`** + the cache contract (C5a-4) and boundary test | [`availability-schedule.ts`] | the automatic-listing contract (must pass the boundary test), item page "available now" labels, preview, partner output |
| `EffectiveRule`, `effectiveRule` (instant-free) | [`channel-availability.ts`] | editor ("Use category default"), C6 (readiness is instant-free), impact |
| `AvailabilitySource`, `AvailabilityExplanation` (at an instant: `state`, `source`, `activeOverride`, `nextTransition`), `explainAvailability`, `availabilityMatrix`, `FormatAvailabilityMap`, `availabilityRowIssues` | [`channel-availability.ts`] — replaces C6's `EffectiveAvailability` / `effectiveAvailability` | editor UI, C6 (`ItemReadinessInput.formats[].availability: EffectiveRule` — instant-free; an instant-based `AvailabilityExplanation` only where C6 evaluates a dated context), listings |
| `AvailabilityInputs`, `ItemAvailabilityInput`, `availabilityImpact`, `AvailabilityImpact`, `AvailabilityChange` | | C1 (rule edits, reparent — C1's `ruleChangeImpact` is this), C7 (pack preview), bulk, C12 channel payloads |
| `catalogueChannelRule` `{ _key: <channelKey>, _type, channel, state, schedule?: catalogueWeeklyOverride[] }` | Sanity object type, one for all levels (category, item, format; same `state`/`schedule` pair on the channel default) | C1 storage of category rules (REVIEW X-1) |
| `Format`, `FormatIdentifiers`, `QuantityUnit`, `IMPLICIT_FORMAT_KEY`, `formatsOf`, `isSimple`, `effectiveIsbn`, `formatIssues` | [`formats.ts`] | creation, Add several, import/export, C6, C7 |
| `FormatTemplate` (`{key,label,quantity?}`) | type, module config | C7 packs, Setup |
| `Price`, `PriceSource`, `PriceResolution`, `resolvePrice`, `displayPrices`, **`PriceCoverage`**, `priceCoverage(format, ctx, channels, availability: WeekProfile)`, `priceIssues`, `effectiveCurrency` | [`prices.ts`] | preview, PDF, export, C6 (`priceMissing` ⇔ `none`, `pricePartial` ⇔ `partial`) |
| `EffectiveOffer`, `resolveOffering`, `PublicCommerce`, `publicCommerce` | [`offering.ts`] | website, structured data, preview, PDF, partner API |
| `WeeklyWindow`, `WindowState`, `evaluateWindows`, `windowsOverlap`, `windowIssues` | [`windows.ts`, renamed from `availability.ts`] | C4 only (and anything showing hours) |
| `commerceOf`, `legacyOffersToFormats`, `legacyAvailability`, `formatsToLegacyOffers` | [`legacy-commerce.ts`] | resolve.ts during transition, migration scripts only |
| `catalogueMigrations` markers (C10-6) | module-config object | C6 rule activation (step 7) — the only runtime reader |
| Error code unions `ChannelIssueCode`, `FormatIssueCode`, `PriceIssueCode`, `AvailabilityIssueCode` | types | C6 (owns the one table mapping them to readiness rules, REVIEW X-4), dashboard copy |

Codes this contract hands to C6's registry (C6 adds a row for each, REVIEW X-4): `price.missing`→`priceMissing`, `price.partialCoverage`→`pricePartial`, `price.ambiguous`, `price.indeterminate`, `price.inactiveChannel`, `availability.conflictingRows`, `availability.primaryCategoryBroken` (→ `primaryCategoryMissing` with `values.reason`), `format.skuDuplicateInProject`, `legacy.offersShadowed`. Availability codes (REVIEW C-7): `availability.scheduleOverlap`, `.scheduleInvalidTime`, `.scheduleIncomplete`, `.scheduleZeroLength`, `.scheduleUnknownDay`, `.scheduleUnknownKind`, `.scheduleLimitExceeded`, `.scheduleOnImplicitFormat`, `.keyMismatch`, `.duplicateChannel`, `.stateInvalid` → C6 `availability.scheduleInvalid`; `availability.unknownChannel` → `integrity.unknownChannel`; `availability.inactiveChannel` → C6 row 26 (`price.inactiveChannel`, condition widened to 'a price or availability row names an inactive or unknown channel'); `availability.scheduleRedundant` → `NOT_A_READINESS_CODE`. Option-item picker result: **`hasPrice`** (D-21; replaces `offered`).

**Imported from C1 (owner: C1; C5 uses these and defines none of them):** `CategoryKey`, `CategoryNode` (stable `key`, `parentKey | null`, `order`, localized `label`, `channelRules: Partial<Record<ChannelKey, ChannelAvailabilityRule>>` in memory, missing = inherit, `archivedAt`), `CategoryTree` (`buildTree`), `CategoryAssignment` (`primary`, `additional` on the item as `primaryCategory` / `additionalCategories`), `categoryChannelRule(tree, primary, channel) → { rule: ChannelAvailabilityRule | 'inherit', sourceKey }`, and `primaryPath(tree, key) → PrimaryPath` (added by C1 per REVIEW E-3). Requests to C1 (a)–(d) — array storage with `_key` = channel key incl. `schedule[]`, no stored `'inherit'`, imported `AvailabilityRuleValue`/`ChannelAvailabilityRule`, complete rules from `categoryChannelRule`: **met in C1 Rev 3 (C1.3, C1.4, C1.6).**

## Decisions record (replaces "Issues for Tom")

All issues raised by Rev 1–2 are decided — Tom, 2026-11-02 (`DECISIONS-step2-final-2026-11-02.md`; everything not restated there approved as recommended). Where applied:

| Issue | Decision | Applied in |
|---|---|---|
| T-1 Website presence when channels exist | **D-4** — lifecycle and visibility decide presence; availability decides where/prices/labels; opt-in hiding later | C5a-5, C5-5, C10-3 |
| T-2 Default for new items vs project default | **D-5** — one concept, `defaultAvailability`; no `defaultChannelsForNewItems` | C2-3 |
| T-3 D3's document-type trigger / storage | **D-1** — module config + taxonomy, pack-history and publication-standards documents; Setup is the only editing area | C2-3 |
| T-4 No development dataset | **D-11** — seven-step rehearsal, staging never writes production | C10-6 |
| T-5 Point-in-time vs cached pages | **D-6.3** — instant-free `publicCommerce`; any "available now" obeys the invariant and cache contract | C5a-4, C5-5 |
| T-6 Time-based availability | **D-6 changed:** built now as availability schedules, independent of price windows | C5, C5a |
| T-7 Equivalence relation | **D-7** — visitor-visible outcomes; price-window gaps reported separately | C10-5 |
| T-8 Unreachable standard price shown | **D-21** — retained until explicit cleanup | C4 `displayPrices` |
| T-9 ISBN authority, editions | **D-21** — `effectiveIsbn`; editions do not become formats in this slice | C3-5 |
| T-10 Dashboard drops `priceNote` | approved as recommended — the new price writer carries `note` | C4-8, C5-5 |
| T-11 Option links to "offered" items | **D-21** — rule kept; result renamed **`hasPrice`**; message "This item needs at least one price before it can be used as a linked choice." | C5-5 |
| T-12 `AvailabilityState` collision | resolved: `ChannelAvailabilityState`; window vocabulary renamed | C0 |
| T-13 Brief §13.1/§13.2 | **D-21** — superseded pricing sections clearly marked when K is folded in | — (ADR edit) |
| T-14 Preset channel keys | **D-21** — packs reuse `dine-in`, `takeaway` | C2 |
| T-15 Channel deletion | **D-21** — counted, previewed, audited cleanup | C2-4 |
| T-16 Implicit format overrides | **D-21** — implicit format has no explicit override | C3-4 |
| T-17 Unknown-channel / stored-currency legacy rows | **D-21** — stop pre-flight | C10-3, C10-6 P |
| T-18 Conflicting duplicate rows | **D-21** — unset + visible readiness error, never an arbitrary winner | C5-8 |
| T-19 Channel permission | **D-3** (editing split) and C8 — editing channel-availability rules requires the Setup permission | C2 (via C8) |
| T-20 Migration default | **D-10** — default unavailable + explicit available rules; never an additional channel | C10-3 |
| Limits | **D-21** — 12 channels, 24 formats per item (300 categories / 200 tags are C1's) | C2-2, C3-4 |

Notes confirmed by the final consistency review (REVIEW-step3 D(c), D(d), D(e)):
- **C1 carries schedules** — met in C1 Rev 3 (Interfaces).
- **C2 channel defaults with schedules** live in module config (`serviceChannels[].defaultSchedule[]`), which needs the `supportsChannelAttributes` declaration to allow one nested array per entry; the generic `localizedStringList` editor is not used for Catalogue channels (Setup is the editor, D-1), so no generic control is required.
- **C6 readiness stays instant-free:** it consumes `EffectiveRule`/`WeekProfile` (e.g. `priceCoverage` over available minutes), never "now".
- **Automatic-listing contract** must reference C5a-4 and pass the boundary test B-1…B-6 (B-7 optional).

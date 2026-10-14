# Catalogue module — V1 specification

**Status:** Approved for implementation (2026-10-13). Aligned with ADR-033 including Amendments A–D (2026-10-14). Pure helpers exist (`availability`, `offers`, `sections`, `slugs`); module not yet registered.
**Authority:** **ADR-033** (catalogue module — items, collections, offers, options). Where this document and the ADR disagree, the ADR wins and this is corrected.
**Also governed by:** ADR-014, ADR-020, ADR-022, ADR-023, ADR-025 + `client-dashboard/content-wizard-spec.md`, ADR-028, ADR-029, ADR-031, ADR-032; the Publicly Routable Content pattern, Schema Evolution Rules, Multilingual-First Principle, Configuration Over Hardcoding (CLAUDE.md).
**Supersedes:** `docs/engineering/menu-module/menu-module-v1-spec.md` — delete that file; it predates the rename and the D4 reversal.

---

## 1. Purpose and scope

A tenant manages **catalogue items** — a dish, a wine, a book, a service — and arranges them into **collections** that appear on their website. Each item carries one or more **offers** (price × service channel) and may carry **options** (choices that modify a line).

The first tenant is a restaurant. Nothing in the module knows that.

A tenant can:

1. Create items — name, description, images, category, and type-appropriate attributes.
2. Give each item offers — a price per service channel, channels defined by the tenant.
3. Build collections — ordered sections, nestable, items placed in reading order.
4. Attach option lists to items, with min/max per attachment.
5. Give an offer serving times — weekdays and hours.
6. Optionally give an item or a collection **its own public page**, with a localized URL.
7. Translate everything with the existing Translate module.
8. Preview, then publish. Nothing is live on save.

**Not in V1:** variants and stock, ordering, baskets, payments, pre-orders, ingredients, multi-location scoping, collection-level price overrides, partner API endpoints. ADR-033 §5 shows why none require restructuring later.

---

## 2. Architecture placement

Module + sections, per CLAUDE.md *Section Library vs Modules*. `dataStore.primary: 'content'` — Sanity only, no Supabase tables in V1.

```
Module   catalogue                items, collections, option lists, categories,
                                  channels, permissions, dashboard surfaces
Section  catalogueListingSection  renders one collection on any page
Page     cataloguePage            module singleton → /{locale}/{tenant}/{segment}
                                  (ADR-033 C1; carries the lifecycle)
Routes   /{segment}/{slug}        opt-in item AND collection pages,
                                  dispatched inside [...slug] (ADR-033 C2)
                                  (ADR-033 D4 + D11 — one configurable
                                  base-path segment per project)
```

---

## 3. Module manifest

`src/lib/modules/registry.ts`; schema in `src/lib/modules/catalogue/schema.ts`; sections in `src/lib/modules/catalogue/sections.tsx`; structured data in `src/lib/modules/catalogue/structured.ts` (pattern: `events/structured.ts`).

```ts
{
  id: 'catalogue',
  label: 'Catalogue',
  version: '1.0.0',
  status: 'released',
  category: 'commerce',

  platformContract: {
    pageType: 'cataloguePage',

    collections: [
      { id: 'catalogue-items', label: 'Items', items: [
        { id: 'items', label: 'Items', schemaType: 'catalogueItem',
          filter: `_type == "catalogueItem" && projectSlug == $slug`,
          initialValueTemplate: 'catalogueItemProjectOwned' } ] },
      { id: 'catalogue-collections', label: 'Collections', items: [
        { id: 'collections', label: 'Collections', schemaType: 'catalogueCollection',
          filter: `_type == "catalogueCollection" && projectSlug == $slug`,
          initialValueTemplate: 'catalogueCollectionProjectOwned' } ] },
      { id: 'catalogue-option-lists', label: 'Option lists', items: [
        { id: 'option-lists', label: 'Option lists', schemaType: 'catalogueOptionList',
          filter: `_type == "catalogueOptionList" && projectSlug == $slug`,
          initialValueTemplate: 'catalogueOptionListProjectOwned' } ] },
    ],

    sectionTypes: ['catalogueListingSection'],

    schemaTypes: [
      'catalogueListingSection', 'cataloguePage',
      'catalogueItem', 'catalogueCollection', 'catalogueOptionList',
      'catalogueOffer', 'catalogueItemOptionList', 'catalogueOption',
      'catalogueSection', 'catalogueAvailability',
    ],

    schemaDefinitions: () => catalogueSchemaTypes,
    permissions: [ /* §8 */ ],
    configSchema: [ /* §5 */ ],

    placement: { surfaces: [
      { kind: 'page', description: 'A catalogue landing page at the configured segment.' },
      { kind: 'sections', description: 'A Catalogue section can be placed on any page.' },
    ] },
  },

  publicContract: {},
  dependencies: { requires: [], integratesWith: ['gallery'] },
  dataStore: { primary: 'content' },
  changelog: 'V1 — items, collections, offers, options, public item and collection pages.',
}
```

---

## 4. Data model

Every document carries `projectSlug`. Field types follow the Localization Rules — decided at creation, never converted.

### 4.1 `catalogueItem` (document)

| Field | Type | Req | Notes |
|---|---|---|---|
| `projectSlug` | string | ✔ | |
| `publicId` | string | ✔ | `publicIdField` pattern from `events/schema.ts` — UUID, read-only, set once (ADR-031 D3) |
| `itemProfile` | string | ✔ | `foodOrDrink` · `product` · `service` (ADR-033 D-2) — a classification of the item, not of the tenant. Preselected in the wizard from config `defaultItemProfile`, always changeable. Drives form shape and schema.org `@type`, never business branching |
| `name` | localizedString | ✔ | |
| `description` | localizedText | | |
| `body` | localizedPortableText | | long copy; only rendered on the item's own page |
| `images` | array of `mediaAssetRef` | | Media Library; crops via `focalObjectPosition()` (ADR-022) |
| `categories` | array of string | | stable keys from config `categories` |
| `allergenDeclaration` | object | ✔ for `foodOrDrink` | ADR-033 D-3: `{ status: 'notReviewed' }` · `{ status: 'containsListedAllergens', allergens[] (≥ 1), mayContain[]?, note? }` · `{ status: 'noneDeclared', confirmed: true, note? }`. Keys are the §4.7 platform constant. New food items start `notReviewed`; changing the profile **to** food resets it. `notReviewed` **blocks publishing**. An empty array never means "none". Replaces the former `allergens[]`. Absent for `product` / `service` |
| `dietary` | array of string | | keys from config `dietaryTags`; shown for `foodOrDrink` only |
| `offers` | array of `catalogueOffer` | | §4.2 |
| `optionLists` | array of `catalogueItemOptionList` | | ordered; §4.4 |
| `hasPage` | boolean | ✔ | default `false`. Opt-in public page (ADR-033 D4) |
| `slug` | localizedSlug | | **required when `hasPage`**; never `type: 'slug'` |
| `redirectFrom` | redirectFrom | | retired slugs, per locale |
| `visibility` | string | ✔ | `public` · `websiteOnly` · `unlisted` — events vocabulary and copy |
| `publishedAt` `expiresAt` `archivedAt` `archivedBy` | | | ADR-032 D1 |

### 4.2 `catalogueOffer` (object)

The commercial terms under which this item is available on one channel.

| Field | Type | Req | Notes |
|---|---|---|---|
| `channel` | string | | stable `value` from config `serviceChannels`. **Absent = unscoped** — applies to any channel with no applicable offer of its own (ADR-033 A2) |
| `price` | number | ✔ | `Rule.min(0).precision(2)` |
| `priceNote` | localizedString | | "per 100 g", "from" — displayed, never parsed |
| `availability` | array of `catalogueAvailability` | | empty = whenever the site is live |
| `currency` | string | | **reserved** (ADR-033 D14, A6). Unset in V1, hidden, read by nothing — `effectiveCurrency = project.currency` |
| `locationKey` | string | | **reserved** (D14, A5). Hidden; validated against `siteConfig.locations[].key` when present; no resolver reads it |

No applicable offer for a channel — neither channel-specific nor unscoped — means **not supplied that way**, which is also how a tenant says "takeaway only". `price: 0` means free and renders as such.

**Precedence (ADR-033 A4):** an applicable channel-specific offer wins; failing that an applicable unscoped offer; failing that, not sold on that channel; two applicable offers at the same precedence return `ambiguous` rather than the first or the cheapest.

**Within a scope — one channel, or the unscoped bucket — availability windows must not overlap** (A3). Across scopes overlap is expected and is what precedence resolves. A consequence worth knowing: an unscoped offer makes every channel sellable whenever it applies, so "dine-in only at lunch" requires scoping the offers rather than relying on a universal one.

### 4.3 `catalogueAvailability` (object)

| Field | Type | Notes |
|---|---|---|
| `days` | array of string | `mon`…`sun`; empty = every day |
| `from` / `to` | string | `"HH:mm"`; both absent = all day. **May wrap past midnight** — `18:00`–`02:00` is legal (ADR-033 A1) |

Module-specific availability, explicitly distinct from the publication window (ADR-032 D1). An item published but outside its serving hours is live and simply not currently offered.

**`days` names the day the interval starts.** Friday `18:00`–`02:00` covers 01:00 on Saturday. Evaluation requires an explicit IANA timezone and never reads the machine's local zone; timezone and DST conversion come from `src/lib/lifecycle/time.ts`, while interval and wrap semantics belong to the catalogue (ADR-033 A8).

Availability answers one question and returns `available | outOfHours`. No rules means `available`. "Not sold" belongs to the offer resolver; publication state to ADR-032.

No location scoping in V1 — ADR-031 D6 places that in V1.2. Adding `locationKeys` later is additive, validated against `siteConfig.locations[].key` like `validateEventLocationKey`.

### 4.4 `catalogueOptionList` (document), `catalogueOption` and `catalogueItemOptionList` (objects)

`catalogueOptionList`: `projectSlug`, `name` (localizedString, required), `options` (min 1), lifecycle fields. No `publicId` in V1 — never shared until `Menu v1` exists; adding one is additive.

`catalogueOption`: `label` (localizedString, required), `kind` (`add` · `remove`, default `add`), `priceDelta` (number, default 0, may be negative), `item` (optional reference → `catalogueItem`, for a choice that is also sold alone).

`catalogueItemOptionList` — the attachment: `list` (reference, required), `min` (default 0), `max` (absent = unlimited).

**min/max live on the attachment** (ADR-033 D2). `kind` exists because *doppia mozzarella* (present), *voglio le acciughe* (absent) and *senza mozzarella* (remove) read differently even though the stored shape is one row.

### 4.5 `catalogueCollection` (document) and `catalogueSection` (object)

`catalogueCollection`: `projectSlug`, `publicId`, `collectionType` (`menu` · `list`, required, default `list` — ADR-033 B2), `name` (localizedString, required), `description` (localizedText), `sections` (array of `catalogueSection`), `hasPage`, `slug`, `redirectFrom`, `visibility`, lifecycle fields.

`catalogueSection`:

| Field | Type | Req | Notes |
|---|---|---|---|
| `_key` | string | ✔ | the section's identity |
| `name` | localizedString | ✔ | |
| `parentKey` | string | | `_key` of the parent; absent = top level |
| `items` | array of reference → `catalogueItem` | | ordered; `projectSlug` filter |

**Depth is not capped** (ADR-033 D6) — the editor guides to two levels and warns beyond three. **A section may hold any `itemProfile`.** **A parent may hold its own items.**

### 4.6 `cataloguePage` and `catalogueListingSection`

`cataloguePage` mirrors `eventsPage`: `projectSlug`, `heroTitle`, `heroSubtitle`, `seoTitle`, `seoDescription`, `sections[]` — **plus the ADR-032 lifecycle fields** (ADR-033 C1). Served at `/{segment}`; its derived status decides whether that URL is public. It never gates the item and collection pages beneath it.

`catalogueListingSection`: `background`, `eyebrow`, `title`, `subtitle` (localized), `collection` (reference), `showPrices` (`'default' | 'show' | 'hide'`, default `'default'` = follow config `showPricesByDefault` live; ADR-033 D-6), `allergenPresentation` (`'compact' | 'expanded'`), `emptyStateHeading`, `emptyStateBody`.

There is **no `showAllergens`** (ADR-033 D-3): a section chooses how the declaration is presented, never whether. No schema migration was needed for D-6 (production check 2026-10-14: 0 listing sections).

The New Section Checklist applies in full — including hydration duplicated in **both** `[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx`.

### 4.7 Allergens

The fourteen EU allergens (Reg. 1169/2011 Annex II) are a **platform constant**: `gluten · crustaceans · eggs · fish · peanuts · soybeans · milk · treeNuts · celery · mustard · sesame · sulphites · lupin · molluscs` (ADR-033 C3), defined once in `src/lib/modules/catalogue/allergens.ts`. Stable keys; labels from `messages/{locale}.json` under `catalogue.allergens.*`.

A closed legal list. No tenant may extend it and **no configuration may hide one** — hiding a declarable allergen to reduce clutter is a compliance risk, not a UX improvement.

**The declaration is shown wherever a food item is presented publicly** — item page, collection page, listing section (compact, with real text for assistive technology) — and can never be hidden. Wording for `noneDeclared` is "No allergens from the EU list declared"; no safety claim ("allergen-free", "gluten-free", vegan) is ever inferred. Labels are platform messages, so they exist in every locale even when the item is untranslated. Products and services render no allergen interface.

**Known gap (not V1):** a free-text "add" option on a food item (e.g. *add anchovies*) can introduce an allergen the base declaration does not list. An option linked to a catalogue item carries that item's declaration. Allergens on free-text options are a recorded follow-up.

---

## 5. Module configuration (`configSchema`)

| id | type | Notes |
|---|---|---|
| `categories` | `localizedStringList` | `supportsColor: true`, `supportsRouting: false`, `usage: { schemaType: 'catalogueItem', field: 'categories', noun: 'items' }` |
| `dietaryTags` | `localizedStringList` | tenant's own vocabulary |
| `serviceChannels` | `localizedStringList` | the price axis (ADR-033 D3). **No seed**: a generic installation creates no channels, and an unscoped offer applies everywhere (ADR-033 D-1). Starter presets may add some |
| `defaultItemProfile` | `select` | `foodOrDrink` · `product` · `service`; optional, **no default**. The wizard preselects it for "What are you offering?" (ADR-033 D-2). Written by a preset or an admin |
| `currency` | `select` | ISO 4217 subset, default `EUR` (ADR-033 D7). The sole persisted currency; offers resolve from it at read time. Changing it warns that prices are reinterpreted, not converted, and requires confirmation |
| `showPricesByDefault` | `boolean` | default true |
| `publicSegment` | `string` | the public base path (ADR-033 D11). **Required at install, no default** (ADR-033 C1). Validated against reserved routes, existing routes, the first segment of every page slug **and `publicSegmentHistory`** |
| `publicSegmentHistory` | `string[]` | hidden, module-written. Append-only list of every segment used; each one redirects to the current. Setting the segment back to a historic value removes it from the list |
| `navLabel` | `localizedString` | what the dashboard calls this module (ADR-033 D12). Presentation only — identifiers, routes, permissions and schema terminology stay `catalogue` |

### 5.1 Starter presets (ADR-033 D-1)

Declared generically in the manifest — `platformContract.starterPresets?: { id, version, label, description?, config }[]`, where `config` maps `configSchema` field ids to values — and validated by the manifest validator (Rule 14) and tests: every key exists in `configSchema` and every value passes that field's own rules (types, select options, `localizedStringList` shape, segment syntax). Mechanics: `src/lib/modules/presets.ts`.

| Preset | `navLabel` (en · it · de) | `publicSegment` | `serviceChannels` | `defaultItemProfile` |
|---|---|---|---|---|
| Restaurant | Menu · Menù · Speisekarte | `menu` | `dine-in` (Dine-in · Al tavolo · Vor Ort), `takeaway` (Takeaway · Da asporto · Zum Mitnehmen) | `foodOrDrink` |
| Bookshop | Books · Libri · Bücher | `books` | none | `product` |

- Offered in the Studio Modules pane **only when the module is first enabled**: "No preset" (default) or one preset. Explicit selection; never automatic.
- The pane previews exactly what will be written, runs the `publicSegment` validator on the preset's segment (a clash **blocks applying**, with the clash message), and shows the project's current currency read-only ("not changed"). **No preset sets a currency.**
- Applied once, in the same write as the installation; `publicSegmentHistory` is persisted through the validator. Localized labels are filtered to the website's locales.
- The installation records `appliedPreset: { id, version, appliedAt }`. Re-applying the same id+version (a retry) changes nothing; it is never re-applied on a later save or upgrade; everything stays editable afterwards. **Only the install flow reads `appliedPreset`** — `applied-preset-guard.test.ts` fails if any other file does.
- Demo content packs are a separate, future concept and never part of a preset.

`supportsRouting: false` on categories — blog categories were indexed URLs on a migrated site and needed pages; catalogue categories are vocabulary and must not sprout pages because they share a field type.

---

## 6. Public pages (ADR-033 D4, D11)

Both routable types satisfy all five requirements of the Publicly Routable
Content pattern. No shortcuts.

### 6.1 The base-path segment

One segment per project, configured in module config (`publicSegment`), shared
across locales in V1, used by items **and** collections:

```
/{locale}/{tenant}/{segment}/{slug}
```

A restaurant configures `menu`, a bookshop `books`, a studio `services`.

**Three consequences the implementation must handle explicitly.**

**Items and collections share one slug namespace.** `/menu/pizza-margherita` and
`/menu/menu-di-natale` sit at the same level, so a slug must be unique across
**both** types within a project and locale. Validation names the conflicting
document; it never merely refuses.

**The segment is validated at configuration time** against reserved and existing
routes — `events`, `posts`, `collections`, `catalogue`, `admin`, `api`, and every
page slug in the project. A segment that would shadow an existing route is
refused when it is typed, not discovered as a 404 weeks later.

**Every historic segment is retained and reserved.** The project carries
`publicSegmentHistory: string[]`, appended on every change, and
`/{historic}/{slug}` 301s to `/{current}/{slug}` for every document with a page.

A list rather than one previous value, because `menu` → `carta` → `menu-2026`
would otherwise drop the `menu` redirect at the second change and 404 every link
already printed or indexed.

Historic segments are reserved along with the current one, so a page slug cannot
take a name that still redirects and shadow it silently. Returning to a previous
name is the exception: setting the segment back to a historic value removes it
from the history and stops its redirect.

Separate from per-document `redirectFrom`, which covers a slug changing under an
unchanged segment. Both are required, and both are tested.

### 6.2 Route

No new route folder (ADR-033 C2). The tenant's existing
`src/app/[locale]/(website)/[tenant]/[...slug]/page.tsx` catch-all dispatches
**before** its page lookup — a sibling `[segment]/[slug]` folder is refused by
the App Router:

```
[seg]          seg == current segment        → cataloguePage (its own lifecycle)
[seg, slug]    seg == current segment        → item → collection → item redirect
                                                → collection redirect → notFound()
[seg, ...]     seg ∈ publicSegmentHistory    → 301 to the same path under the current segment
anything else                                 → the existing page lookup, unchanged
```

Without the module installed, no dispatch happens and the path falls through to
the page lookup (which 404s). The dispatch is a pure, tested function of
`(segments, publicSegment, publicSegmentHistory)`; `generateMetadata` uses the same one.

### 6.3 Queries (per type)

**Primary lookup — no locale fallback on the slug:**
```groq
*[_type == "catalogueItem" && projectSlug == $projectSlug
  && slug[$locale].current == $slug && <visibility fragment>][0] {
  "slugMap": slug, "redirectFrom": redirectFrom, ...
}
```
**Redirect lookup:** `$slug in redirectFrom[$locale]` → `"currentSlug": slug[$locale].current`
**List queries:** `"slug": slug[$locale].current` — **no fallback** (ADR-033 C6). An item or collection is linked only when it has `hasPage` and a slug in the request locale; otherwise it renders unlinked. A default-locale URL would 404 against the no-fallback primary lookup.

**Visibility by context (ADR-033 C5):** automatic listings admit `public` + `websiteOnly`; an explicit collection reference also admits `unlisted`; partner output `public` only; sitemap and indexing exclude `unlisted`. The lifecycle fragment applies first, always.

Content fields keep `coalesce(field[$locale], field[$defaultLocale], field.en)`;
the no-fallback rule applies to routing only. `<visibility fragment>` is the
shared ADR-032 D3 builder — never hand-written.

### 6.4 Route behaviour

The pattern in CLAUDE.md Requirement 3: primary lookup → redirect branch →
`notFound()`; build `slugMap`; wrap in `SlugMapProvider`. `generateMetadata`
emits canonical plus hreflang alternates from `siteConfig.supportedLocales` × the
slug map, only for locales where a slug is set.

### 6.5 Sitemap

One URL per locale, only where `hasPage` is true, `slug[locale].current` is set,
and the document passes the visibility fragment.

### 6.6 Structured data

**The type is decided by the page, not by the item** (ADR-033 B1): the same jar
of sauce is a `MenuItem` inside a menu and a `Product` on its own page, and both
are correct.

| Rendered on | `@type` | Decided by |
|---|---|---|
| Collection page, `collectionType: menu` | `Menu` → `hasMenuSection` (`MenuSection`, nested) → `hasMenuItem` (`MenuItem`) → `offers` | the collection |
| Collection page, `collectionType: list` | `ItemList`, or `OfferCatalog` when its items carry offers | the collection |
| Item's own page | `Product` with a nested `Offer`; `Service` for `itemProfile: service` (`foodOrDrink` and `product` → `Product`; ADR-033 D-2) | `itemProfile` |

A lookup table, never a conditional on tenant kind. The menu shape is the
ADR-031 D3 contract vocabulary, so `Menu v1` stays a projection of what the site
already emits.

`Product.sku` is absent in V1 — a SKU identifies a sellable unit, and units
arrive with variants (§12.3).

Hidden content emits nothing: anything excluded by the ADR-032 D3 fragment
produces no JSON-LD and no sitemap entry.

## 7. Localization

- **A localized slug may exist only where `name[locale]` is written** (ADR-033 D-7). Enforced in the dashboard, the server-side save and Studio validation. A language without a name shows "Not translated" and gets no link, no `hreflang`, no sitemap entry and no metadata claim; editorial text fallback is unchanged but never manufactures a routable page.
- Localized: `name`, `description`, `body`, section names, option labels, `priceNote`, page and section copy, `slug` (`localizedSlug`).
- Not localized: `price`, `priceDelta`, `channel`, `min`/`max`, `kind`, `itemProfile`, allergen and dietary keys, `days`, `from`/`to`, `visibility`, `hasPage`, `_key`s, references.
- Machine translation via ADR-023. **No website query may project `translationStatus`** — existing test extended.
- Dashboard and Studio strings in `messages/{en,it,de}.json` under `catalogue.*`. No hardcoded user-facing strings.

---

## 8. Permissions

| id | Label | Default roles |
|---|---|---|
| `catalogue.item.read` | View items and collections | owner, editor, viewer |
| `catalogue.item.write` | Create and edit items | owner, editor |
| `catalogue.item.delete` | Delete items | owner, editor |
| `catalogue.collection.write` | Create and edit collections | owner, editor |
| `catalogue.collection.delete` | Delete collections | owner, editor |
| `catalogue.taxonomy.write` | Manage categories, dietary tags, service channels | owner, editor |
| `catalogue.item.deletePublished` | Permanently delete previously published items and option lists | owner (+ site admin) |
| `catalogue.collection.deletePublished` | Permanently delete previously published collections and the landing page | owner (+ site admin) |

Option lists use the `catalogue.item.*` permissions; `cataloguePage` uses `catalogue.collection.*` (ADR-033 C4).

Writing includes publishing. `can()` fail-closed; every dashboard route calls `assertModuleAction` before its first read.

---

## 9. Lifecycle

Per ADR-032, `publishedAtRule: 'optional'`, status derived by `deriveStatus()`, never stored. Lifecycle descriptors registered for `catalogueItem`, `catalogueCollection`, `catalogueOptionList` and `cataloguePage` (ADR-033 C1), each `connected: false` until `Menu v1` ships.

**Archive and permanent delete are separate rules** (ADR-033 D-8, refining C7). Every refusal names and links each referrer.

| Action | Refused when |
|---|---|
| Archive item / collection | a **public** document references it |
| Archive option list | any **non-archived** item attaches it |
| Permanently delete anything | **any** reference exists — draft, published, scheduled, unpublished or **archived** |

**Draft references, enforced at publish time** (ADR-033 D-4, supersedes published-only pickers). Drafts may reference never-published items, collections and option lists; the reference is written weak and marked to strengthen on publish (`{ _ref, _weak: true, _strengthenOnPublish: { type } }`), strong when the target already has a published version. Pickers include eligible drafts, labelled as drafts.
- *Never published* = a hard publication dependency. Publishing a parent with one is **refused**, naming and linking every unresolved dependency.
- *Published but not live* (scheduled, unpublished, expired, archived) = a valid reference; publishing never changes its state. The editor is warned if it will not be live when the parent goes live.
- On every successful publish the published copy's references are strengthened explicitly in the same transaction. Abluo does not rely on server-side strengthening.
- Public queries resolve only eligible published content (unchanged). An item with `allergenDeclaration.status == 'notReviewed'` blocks publishing, including inside the action below.

**"Publish collection and dependencies"** (and "Publish item and dependencies"; ADR-033 D-5). Before confirming it shows the document, every never-published dependency (full tree, option lists included, cycles detected safely), the publication date, dependencies the editor may not publish, items whose own page becomes available, and dependencies reused elsewhere. Everything is validated and permission-checked **before** anything is written, then published or scheduled in **one atomic Sanity transaction** — any failure publishes nothing. Included dependencies take the parent's schedule; an existing schedule is never overwritten; dependencies already published are untouched. One Activity row per document; references are strengthened in the transaction. This is a generic ADR-032 lifecycle operation (`publishTogether`, ADR-032 Amendment B), not catalogue code.

**Slugs stay reserved** while a document exists, so restore + republish returns the same URL. No automatic redirect on slug change — the editor adds one explicitly via `redirectFrom`.

---

## 10. Client dashboard

### 10.1 Surfaces (`src/lib/client/surfaces.ts`)

```ts
{ kind: 'nav', id: 'catalogue', segment: 'catalogue',
  requires: { module: 'catalogue', permission: 'catalogue.item.read' } },
{ kind: 'widget', id: 'glance.catalogue', slot: 'glance',
  requires: { module: 'catalogue', permission: 'catalogue.item.read' } },
```

`add-content-sheet.ts` (renamed from `create-menu.ts`, ADR-033 D1) gains a catalogue entry, `ready` only when the wizard lands.

### 10.2 Routes

```
/{tenant}/catalogue                items list (default) + collections tab
/{tenant}/catalogue/new            item wizard
/{tenant}/catalogue/[id]           item editor (tabbed, after first publish)
/{tenant}/catalogue/collections/new|[id]   collection builder
/{tenant}/catalogue/option-lists[/new|[id]] option lists — a plain list + editor
                                   (label, kind, price change; reorder), so wizard
                                   step 7 has something to attach
```

### 10.3 Item wizard

Per `content-wizard-spec.md` — one decision per screen, cards not dropdowns, autosave with a Saved pill, sticky Back/Next, 44px targets, `durationBase`/`easingStandard`, `prefers-reduced-motion` honoured.

| # | Question | Saved to | Skippable |
|---|---|---|---|
| 1 | What are you offering? (profile cards: food or drink · product · service) | `itemProfile` | preselected from config `defaultItemProfile`, always changeable |
| 2 | What is it called? | `name[loc]`, `description[loc]` | name required |
| 3 | What kind? (category chips) | `categories[]` | yes, if none configured |
| 4 | Add a photo | `images[0]` | yes |
| 5 | What does it cost? (one price per channel) | `offers[]` | yes |
| 6 | **Food information** — allergen declaration (contains · may contain · none declared, explicit confirmation) and dietary tags | `allergenDeclaration`, `dietary[]` | shown for `foodOrDrink` only; **not skippable** — `notReviewed` blocks publishing |
| 7 | Can people change it? (option lists + min/max) | `optionLists[]` | yes |
| 8 | Give it its own page? (toggle → slug preview) | `hasPage`, `slug[loc]` | yes, default off |
| 9 | Other languages? | `translationStatus: machine` | only when > 1 locale |
| 10 | Here's how it will look | — | — |
| 11 | What now? Publish · Schedule · Keep as draft | `publishedAt` | — |

Defaults never asked: `visibility: public`, currency from config, slug derived from the name per locale and unique per project.

### 10.4 Collection builder

A direct editor, not a wizard — arranging is iterative.

- Sections with **pointer-event** drag (never HTML5 drag: `dragstart` does not fire from a finger) plus up/down buttons for keyboard.
- **Add subsection** on each top-level section, inserted after that section's existing children — not created at the bottom to be dragged up.
- Deleting a section removes its subsections with it and leaves an inline **Undo** strip in the gap. No confirmation dialog: a confirm taxes every deletion and is dismissed unread by the third time.
- Item picker: search, filter by category, multi-select.
- Quiet per-row badges for gaps (no photo, no offer). Never blocking.

### 10.5 UI states

| State | Items list | Collection builder | Website |
|---|---|---|---|
| Empty | "No items yet" + Add | "No sections yet" + Add the first | section renders nothing; page unaffected |
| Loading | 3 skeleton rows | 2 skeleton sections | RSC — none |
| Error | retry; error surfaced, not swallowed | retry; unsaved edits preserved | section omitted, page renders |
| Partial | "No price set" badge | "Empty section" | a heading with no items still prints |
| Archived / offline | badge, filterable | excluded by default | excluded by the visibility fragment |

---

## 11. Validation

| Rule | Where | Effect |
|---|---|---|
| `name` non-empty in the default locale | item, collection, option list | blocks save |
| `slug` present for the default locale when `hasPage` | item, collection | blocks save |
| slug unique per project per locale **across items AND collections** | item, collection | blocks save, names the conflicting document |
| `publicSegment` is not a reserved route, an existing route, or a page slug | module config | blocks save, names the clash |
| `publicSegment` is not a historic segment of another live redirect | module config | allowed only as a revert — removes it from history |
| `price` ≥ 0, ≤ 2 decimals | offer | blocks save |
| `channel`, when set, exists in `serviceChannels` | offer | blocks save, names the unknown key |
| within a scope (one channel, or unscoped) availability windows do not overlap | item | blocks save, names both offers and the overlapping window |
| `min` ≤ `max` when both set | attachment | blocks save |
| `max` ≤ options in the referenced list | attachment | **warns** (the list may grow) |
| ≥ 1 option | option list | blocks save |
| `parentKey` names a sibling in the same collection | section | blocks save |
| `parentKey` creates no cycle | section | blocks save |
| references share `projectSlug` | collection, option | reference filter + save-time check |
| `from` ≠ `to` | availability | blocks save — a zero-length window matches nothing. `from` > `to` is legal and wraps past midnight |
| `parentKey` names a section that exists | collection | blocks save of a **newly created** orphan; pre-existing orphans are reported, not blocked, and stay visible (ADR-033 A7) |
| a locale slug without `name[locale]` | item, collection | blocks save (dashboard, server and Studio; ADR-033 D-7) |
| `allergenDeclaration` is `notReviewed` | `foodOrDrink` item | blocks **publishing** (not saving) |
| never-published dependency | publish of any catalogue document | blocks publishing, names each dependency (D-4) |
| `containsListedAllergens` with no allergen; `noneDeclared` without `confirmed: true` | `foodOrDrink` item | blocks save |
| a starter preset's `publicSegment` clashes | Modules pane, first enable | blocks applying, names the clash (D-1) |
| no photo, or no offer on any channel | item | **warns only** |
| changing `currency` | module config | **warns and requires confirmation**, naming how many prices across how many items are reinterpreted. No amounts are converted |

The last row is the general rule: **gaps, not errors**. An item with no photograph is valid; it is a hole on a website. One shared definition, surfaced on every screen that cares, so a record cannot pass one screen and fail another with no explanation.

---

## 12. Acceptance criteria

**Module**
1. `catalogue` is in the registry; `npx vitest run` passes including `settings-structure.test.ts` and the manifest validator.
2. Installing adds Items, Collections and Option lists to the Studio structure, scoped by `projectSlug`; uninstalling removes them and leaves content untouched.
3. Without the module: no nav item, nothing in Add content, `catalogueListingSection` does not render, and `/{segment}/*` falls through to the page lookup and 404s.

**Tenancy and permissions**
4. A cross-project read returns nothing; covered by a test in the style of the ADR-031 D8.7 suite.
5. A `viewer` cannot reach `/catalogue/new` — the server refuses, it is not merely hidden.
6. Every dashboard route calls `assertModuleAction` before its first read.

**Lifecycle**
7. A new item is `draft` and appears on no public path, including its own URL.
8. A future `publishedAt` yields `scheduled` and appears on the first request after that time.
9. "Unpublish" sets `expiresAt = now`; the document stays published and keeps `_id`, `publicId`, slug and references.
10. Archiving an item referenced by a public collection is refused and names it; one referenced only by a draft collection succeeds. Permanently deleting it is refused while **any** reference exists, including archived ones (D-8).
11. `deriveStatus()` unit-tested across all five states plus `hasChanges`.
12. The ADR-032 D3 inventory test lists every catalogue delivery path — item page, collection page, listing section, catalogue page, sitemap, `generateMetadata`, JSON-LD — and fails if one omits the fragment.

**Public pages**
13. `hasPage: false` → no route, no sitemap entry, no hreflang; the item still renders inside a collection.
14. `hasPage: true` with a slug in two locales → both URLs resolve; each carries its own canonical and both hreflang alternates.
15. Changing a slug and adding the old one to `redirectFrom` → the old URL 301s to the new one, per locale.
15a. Changing the segment twice (`menu` → `carta` → `menu-2026`) → URLs under **both** `menu` and `carta` 301 to `menu-2026`; a page slug may not then be created as `menu` or `carta`; setting the segment back to `carta` removes it from history and stops its redirect.
16. An unlisted item's page resolves by direct link, is `noindex`, appears in no listing and in no sitemap.
17. JSON-LD validates by context: a `collectionType: menu` page as `Menu` → `MenuSection` → `MenuItem` with offers; a `collectionType: list` page as `ItemList`, or `OfferCatalog` once its items carry offers; an item's own page as `Product` with an `Offer`, or `Service` for a service.
17a. The same item rendered in a menu and on its own page emits `MenuItem` in the first and `Product` in the second.
17b. An item or collection hidden by the visibility fragment emits no JSON-LD and no sitemap entry.

**Content and rendering**
18. A collection with Pizza → Pizze Bianche renders parent then children in stored order, on the website and in preview.
19. A parent section with no items of its own still renders as a heading.
20. Prices render in the configured currency, formatted for the request locale, resolved from the project — no offer stores a currency, and `offer.currency` is unset on every document.
20a. Changing the project currency warns with a count of affected prices and items, requires confirmation, converts nothing, and leaves every stored amount byte-identical.
20b. An offer at 18:00–02:00 on Friday is available at 01:00 on Saturday and unavailable at 03:00, evaluated in the site's IANA timezone across a DST boundary in both directions.
20c. A channel-specific offer wins over an unscoped one at the same instant; with no applicable offer the item is not sold on that channel; two applicable offers in one scope return `ambiguous`.
20d. A collection whose section names a missing parent still renders every section — the orphan as a recovery root with its descendants beneath it, original order preserved, `parentKey` untouched on disk — and reports `missingParent` with both keys. A cycle renders every section and reports the participating keys without looping.
21. All fourteen EU allergens are selectable on a `foodOrDrink` item, and the declaration is **always shown** wherever that item is presented publicly (item page, collection page, listing section) — no section setting, config or option can hide it. `notReviewed` blocks publishing; `noneDeclared` needs explicit confirmation; products and services render no allergen interface.
22. Switching locale changes names, descriptions and option labels; missing translations fall back to the default locale, never to an empty string.
23. `translationStatus` appears in no website query.
23a. A localized slug cannot be saved for a locale without `name[locale]` (dashboard, server, Studio); that locale shows "Not translated" with no link, `hreflang` or sitemap entry (D-7).

**Starter presets (ADR-033 D-1)**
P1. A generic installation creates no service channels and sets no currency; `defaultItemProfile` is unset.
P2. The manifest validator and a test reject any preset whose key is not in `configSchema` or whose value fails the field's own validation.
P3. The Restaurant and Bookshop presets write exactly the D-1 table (labels filtered to the site's locales); neither writes a currency, and the preview shows the project's existing currency as unchanged.
P4. A preset whose `publicSegment` clashes (reserved route, page slug, history) cannot be applied and shows the clash message.
P5. Applying records `appliedPreset { id, version, appliedAt }`; re-applying the same id+version changes nothing; later saves and upgrades never re-apply; every written value remains editable.
P6. A test fails if any file other than the install flow reads `appliedPreset`.

**Draft references and publishing together (ADR-033 D-4, D-5)**
D1. A draft collection can reference a never-published item and option list; the reference is weak with `_strengthenOnPublish`. A reference to an already-published target is strong.
D2. Publishing a parent with a never-published dependency is refused, naming and linking each one; a dependency that is merely scheduled, unpublished, expired or archived does not block.
D3. After a successful publish no weak flag or marker remains on the published copy's references.
D4. "Publish collection and dependencies" is atomic: one injected failure (validation, permission, or transaction) publishes **nothing**; success publishes all, one Activity row each, existing schedules untouched, already-published dependencies not touched.
D5. The dependency walk terminates on cycles and includes option lists.

**Dashboard**
24. The wizard autosaves; closing the browser mid-step loses nothing.
25. Every wizard step and list state verified light + dark × phone + desktop per `client-dashboard/verification.md`.
26. Drag-to-reorder works with a finger on a real tablet, and every reorder is reachable by keyboard.
27. Deleting a section with subsections removes both and offers Undo in place.
28. No hardcoded user-facing string in any catalogue component.

**Connections readiness (no endpoints)**
29. `publicId` is set on creation for items and collections, is read-only, and survives edit, unpublish, archive and restore unchanged.
30. `visibility` defaults to `public` with the same three values and copy as `event.visibility`.

---

## 13. Out of scope for V1

Deferred, in priority order (ADR-033 D-10): **1.** full-page draft preview · **2.** drag-reordering items inside sections · **3.** bulk list actions.

Also out of scope: allergens on free-text options (known gap, §4.7) · demo content packs · variants and stock · ordering, baskets, payments · pre-orders · ingredients · nutritional data · multi-location scoping · collection-level price overrides · cross-item offers · partner API endpoints, OAuth, webhooks, tombstones, sync · import/export · AI description generation.

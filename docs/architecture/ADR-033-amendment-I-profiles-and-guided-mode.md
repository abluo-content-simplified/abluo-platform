# ADR-033 — Amendment I: item profiles as a registry, Book, and Guided Mode

**Status: Accepted — Tom, 2026-10-16 (answers in I-11).** Step 4 may start.
Date: 2026-10-16. Follows Amendment G (the ADR currently ends at G; H, tags, is still a draft and is not renumbered here).
Authority: `claude/catalogue-ux-redesign-proposal-2026-10-16.md` (decisions D1–D9, principles U1–U6, roadmap step 3). Tom's inputs of 16 Oct override the plan where they differ; the differences are listed in 1.3.
Convention note: earlier amendments (A–G) live inside `ADR-033-catalogue-module.md` as `## Amendment X` with numbered `X-n` sections. This draft is a separate file only so it can be reviewed on its own; once accepted it is appended to the ADR as Amendment I and this file is removed. Sections below are therefore numbered `I-1 … I-10`.

---

## I-1 Context and what is already on dev

Tom's verdict after Book 1 (14 Oct): too slow, too complicated, cannot be given to a restaurant manager. The cause in the code is that "what kind of item is this" is answered by scattered `=== 'foodOrDrink'` checks, there is no Book, the wizard has up to 11 steps in a fixed order, and the editor opens by asking "What are you offering?" on an item that already exists.

### 1.1 Already on dev (do not redo)

| Commit | What it gave us |
|---|---|
| `ed26a02` | Sidebar "Catalogue" label and groups. Type step: nothing preselected, tap advances, preset-suggested card first (`ProfileField suggested`). |
| `cb3753f` | Items list on the Posts pattern (sorting, batch actions), uncropped images, done screen, relevant options/pricing (D7), disabled actions explain why (`blocksNext` hints), publish blockers with "Fix this" links (`item-issues.ts`), issue counts on editor tabs. |
| `60e673b` | Shared `PublishChoice` (Publish now / Schedule / Keep as draft, expands in place), shared `PhotoSource` (take / phone / upload / library) and `PhotoEditSheet` with focus point; uploads survive navigation (ADR-035). |

### 1.2 Being built now (referenced, not redesigned here)

The quick-win round for the list: price column always shown, book covers portrait 2:3, author under the name. This amendment supplies the data and the registry those columns read from (I-2, I-3); it does not redesign them.

### 1.3 Where Tom's newest inputs differ from the plan

| Plan said | Now |
|---|---|
| Book details: author, ISBN, publisher, year | **Title, Author, Year, ISBN.** Publisher is not chosen (see I-3.7). Title, not "name". |
| Required fields not stated for book | **No book field is mandatory.** Only the U2 minimum applies: the title in the default language. |
| Profile change inside the content tab | The editor shows the type as a **quiet label with a small "Change type"**; the question is never repeated as a form block. |
| Price column conditional on any price existing | **Always shown** (quick-win round). |

---

## I-2 Profile registry

### I-2.1 Decision

One pure TypeScript module, `src/lib/modules/catalogue/profiles.ts` (no React, no I/O, importable by Studio schema, server, dashboard and public rendering). It is the only place that knows the four profiles. After this amendment no other file contains the string `'foodOrDrink'` or an `isFood` variable; a guard test enforces it (I-9, slice 4a). This is the ADR-031 D6 rule ("no code asks 'is this a restaurant?'") applied to profiles.

### I-2.2 Shape

```ts
export type ItemProfile = 'book' | 'foodOrDrink' | 'product' | 'service'

/** What a profile can carry. Allergens stay food-bound for legal reasons. */
export type Capability =
  | 'bookDetails' | 'foodInformation'
  | 'pricing' | 'channelPricing' | 'options' | 'links'

/** default = shown and offered; onDemand = not offered by default, switchable per item (D7); off = never. */
export type Offering = 'default' | 'onDemand' | 'off'

export type FieldGroup = 'core' | 'bookDetails' | 'foodInformation' | 'pricing' | 'options' | 'links'

export type GuidedScreen = {
  id: 'type' | 'about' | 'details' | 'publish'      // id is a stable key for deep links and issue targets
  groups: FieldGroup[]                               // in display order
  when?: (ctx: ProfileContext) => boolean            // e.g. options only when relevant (D7)
}

export type ProfileDef = {
  id: ItemProfile
  icon: string                                       // key into catalogue-ui icons
  labelKey: string                                   // i18n: "Book"
  descriptionKey: string                             // i18n: one line + example fields (U5)
  nameLabelKey: 'name' | 'title'                     // book says Title
  capabilities: Record<Capability, Offering>
  editor: { tabs: EditorTab[]; contentGroups: FieldGroup[] }   // existing editor, profile-driven
  guided: GuidedScreen[]
  list: {
    secondary: 'author' | 'byline' | 'category' | 'dietary'   // line under the name
    columns: ListColumn[]                            // price always included
  }
  image: { ratio: '2:3' | '4:3' | '1:1'; fit: 'contain' | 'focal'; required: boolean }
  presentation: { card: CardMeta[]; page: PageBlock[] }          // I-7, built in step 7
  jsonLd: { itemPage: 'Book' | 'Product' | 'Service'; needsOffer: boolean }
}

export const PROFILES: Readonly<Record<ItemProfile, ProfileDef>>
export const PROFILE_ORDER: readonly ItemProfile[]               // default order; presets reorder, never remove
export const profileOf = (v: unknown): ItemProfile              // unknown stored value -> 'product' (today's safe fallback)
export const can = (p: ItemProfile, c: Capability): boolean      // offering !== 'off'
export const profilesWith = (c: Capability): ItemProfile[]       // for GROQ filters and Studio
```

Presets keep doing what ADR-033 D-1 says: suggest and order. `defaultItemProfile` stays a module setting; its allowed values now come from `PROFILE_ORDER`.

### I-2.3 The four entries

| | **Book** | **Food or drink** | **Product** | **Service** |
|---|---|---|---|---|
| Label | Book | Food or drink | Product | Service |
| What the card says (U5) | "Title, author, year, ISBN, cover, buying links" | "Price, photo, allergens, dietary marks, options" | "Price, photos, options such as size or colour, links" | "Description, price from, add-ons, booking link" |
| Name field label | **Title** | Name | Name | Name |
| Capabilities | bookDetails **default**; pricing **onDemand**; channelPricing onDemand; options off (by default, see D7 note); links **default**; foodInformation off | foodInformation **default**; pricing **default**; channelPricing **default**; options **default**; links onDemand | pricing **default**; channelPricing onDemand; options **default**; links **default**; bookDetails/foodInformation off | pricing default ("from"); channelPricing **default**; options default (add-ons); links onDemand |
| Field groups, in order | title, author, year, ISBN, cover, short description, links, categories, collections, page, languages, (price on demand) | name, price, photo, food information, short description, options, categories, collections, page, languages | name, photo, price, short description, options, links, categories, collections, page, languages | name, short description, photo (optional), price, add-ons, categories, collections, page, languages |
| Guided screens | type -> about -> publish (3, I-5.1) | type -> dish -> food info -> publish (4, I-5.2) | type -> product -> publish (3, I-5.3) | type -> service -> publish (3, I-5.4) |
| List secondary line | author (book byline) | byline, else dietary marks | byline, else category | byline, else category |
| List columns | cover, title + author, category, price, status, changes, dates | photo, name, category, price, status, changes, dates | photo, name, category, price, status, changes, dates | name, category, price, status, changes, dates |
| Image | **cover, 2:3, whole (contain)**, recommended not required | photo, 4:3, focal crop | square, contain or focal | 4:3, optional |
| Card / page | I-7 | I-7 | I-7 | I-7 |
| JSON-LD on own page | **Book** (valid without offer) | Product (only with an Offer, F-3) | Product (only with an Offer, F-3) | Service |

D7 note: "on demand" is what `itemOptionsRelevant` already does for options (shown when attached or when the project has any option list). That function becomes the registry's generic rule: a capability that is `onDemand` appears in the editor and in Guided Mode only when the item already uses it or the person adds it with an explicit "Add price" / "Add options" action. Stored data is never deleted by hiding.

### I-2.4 Call sites that read the registry instead (full list from the code at `63e565a`)

| File : line | Today | Reads instead |
|---|---|---|
| `dashboard-form.ts:20-21` | defines `ItemProfile`, `ITEM_PROFILES`, `isItemProfile` | re-exports from `profiles.ts`; adds `'book'` |
| `dashboard-form.ts:250` `itemOptionsRelevant` | `=== 'foodOrDrink' \|\| attached \|\| project lists` | `can(p,'options')` default, else attached/project lists |
| `dashboard-form.ts:257` `itemWizardSteps` | hardcoded 11-step order, `details` for food | `PROFILES[p].guided` screens (I-5) |
| `ItemEditor.tsx:115,118` | `isFood`, tab list | `PROFILES[p].editor.tabs` |
| `ItemEditor.tsx:244` | `isFood && declarationIssues` gap badge | `can(p,'foodInformation')` |
| `ItemEditor.tsx:268` | `FieldBlock profile` + `foodHelper` | removed from the form; header label + "Change type" (I-4) |
| `ItemEditor.tsx:314`, `ItemWizard.tsx:286` | `declaration={isFood ? … : null}` | `can(p,'foodInformation')` |
| `item-issues.ts:85` | allergens publish blocker if food | `can(p,'foodInformation')`; new `advice` severity for ISBN (I-3.3) |
| `catalogue-ui.tsx:58` | `CAT_ICONS` keyed by three profiles | `PROFILES[p].icon` |
| `catalogue-drafts.ts:356` | list gap `allergensNotReviewed` if food | `can(p,'foodInformation')` |
| `catalogue-drafts.ts:475-481` | create: default profile, init allergen declaration if food | `profileOf`, `can(…)` |
| `catalogue-drafts.ts:687,691,703` | publish gate, allergen review, strip declaration if not food | `can(p,'foodInformation')` |
| `dashboard-patch.ts:137,400,516-522` | field whitelist, profile validation, `applyItemRules` | add `bookDetails`; validate against `PROFILE_ORDER`; allergen rule via `can` |
| `dto.ts:45` | `CatalogueItemProfile` union | alias of `ItemProfile` |
| `structured.ts:51` `ITEM_PAGE_TYPE` | map of three | `PROFILES[p].jsonLd.itemPage` (adds Book) |
| `resolve.ts:271,278,317,340,530` | `ITEM_PROFILES`, fallback, allergen/option resolution gated on food | `profileOf`, `can(…)` |
| `registry.ts` (module registry) `:1150-1152,1204,1214` | setting list options, preset defaults | options from `PROFILE_ORDER`; presets unchanged |
| `schema.ts:532,612,626,650` | Studio list, `hidden` / validation for food fields | list from `PROFILE_ORDER`; `hidden` via `can` |
| `schema.ts:488`, `dashboard-queries.ts:76` | GROQ `itemProfile == "foodOrDrink"` | `itemProfile in $foodProfiles`, built from `profilesWith('foodInformation')` |
| `CatalogueBrowser.tsx` + `list-model.ts` | profile-blind columns | `PROFILES[p].list` (secondary line, cover shape) |
| `CatalogueCollectionView.tsx:174`, `CatalogueItemParts.tsx` | one `h-20 w-20 object-cover` for all | `PROFILES[p].image` and `presentation` (step 7, I-7) |

Behaviour for food, product and service must not change in slice 4a: the registry is a refactor first, a feature second.

---

## I-3 Book

### I-3.1 Schema addition (additive)

`catalogueItem`:
- `itemProfile` list gains `book`.
- New optional object `bookDetails`: `{ author?: string, year?: number, isbn?: string }`. Plain values, **not localized** (a name on a cover does not translate). Studio shows the object only when `can(profile,'bookDetails')`.
- Nothing else changes. `byline` (F-1) stays generic and keeps its meaning.

### I-3.2 Fields as the person sees them

| Field | Label | Rule |
|---|---|---|
| name | **Title** (via `nameLabelKey`) | the one required value, in the default language (U2) |
| author | Author | optional; one free-text line, up to 120 characters ("Douglas Adams", or "Douglas Adams, Eoin Colfer") |
| year | Year | optional; whole number 1000 to next year; shown as typed number keypad on phone |
| isbn | ISBN | optional; text, numeric keypad with `-` and `X` allowed |

### I-3.3 Validation: all optional, ISBN only advises

- Saving never fails for a book field. Publishing never requires one. Only the title in the default language is needed to exist (U2), exactly as for every other profile.
- **Year**: a non-number or out-of-range value is a normal field error under the input (`blocksNext` is **not** used; an invalid year is simply not saved and the field says why). Blank is always fine.
- **ISBN**: normalised on read (spaces and hyphens ignored, stored without them as typed digits). If it is not a valid ISBN-10 or ISBN-13 (length and check digit), the editor and Guided Mode show a **soft warning** beside the field: "This doesn't look like a valid ISBN. You can still keep it." The value is saved and published as typed.
  - This adds a third issue severity, `advice`, to `item-issues.ts` next to `blocksNext` and `blocksPublish`. An `advice` item is shown, counted on its tab as a quiet dot (not a number), and **never disables any button and never appears in the publish blocker list**. It is not an error; it is a hint.
  - Structured data: an invalid-looking ISBN is **not** emitted as `isbn` (search engines would reject it); the visible page still shows what the person typed.

### I-3.4 Byline defaults from the author

At read time (`resolve.ts`), a book's displayed byline is `byline` if the person set one, otherwise `bookDetails.author`. Nothing is copied into `byline` on save, so there is one place to edit and no drift. Year is not folded into the byline; it appears in the card meta ("author · year") by presentation (I-7).

### I-3.5 JSON-LD

On an item's own page a book emits `Book`: `name`, `author` as `Person`, `isbn` (valid only), `datePublished` (the year), `image`, `url`, `offers` when the book has a price, and `sameAs` is not used. A `Book` is valid without an offer, so unlike Product (F-3) it is emitted even when unpriced. In a `menu` collection every item is still a `MenuItem` (B1 unchanged); in a `list` collection it is an `ItemList` entry as today. Hidden or unlisted content emits nothing (B4, C10 unchanged).

### I-3.6 Production safety (explicit)

- **Production has no Catalogue code yet (v1.0.54) and no catalogue documents**, so this change cannot affect a live site as long as the order below is kept.
- The change is **additive**: a new enum value and a new optional object. **No data is migrated, now or ever, by this amendment.**
- The standing rule from the 2026-08-14 outage applies: **no data in any production dataset is changed to a new shape ahead of the code that reads it.** Concretely: (1) the reading code (registry, DTO, `resolve.ts`, structured data, public components) ships first; (2) only then can a `book` document exist in a production dataset; (3) `profileOf` already maps an unknown stored profile to `product`, so an older deployment reading a `book` document degrades to a plain product page rather than failing. A test pins this fallback.
- The tmz pilot items on dev/preview were created as `product` (the Bookshop preset default). They stay `product` until Tom changes each one with "Change type" (I-4). No script converts them.

### I-3.7 Not now / open

Publisher (offered, not chosen) · page count · series · language of the book · structured, multiple authors · cover from ISBN lookup · duration (service) · tags (Amendment H). None is designed here; each is additive later because `bookDetails` is an object.

---

## I-4 Changing type, and the editor header

### I-4.1 Header

Every existing item's editor header shows the type as a quiet label (icon + "Book" / "Food or drink" / "Product" / "Service") next to the item name, with a small text action **Change type**. The "What are you offering?" block is removed from the Content tab. Nothing about the type is asked again on an existing item.

"Change type" opens a sheet using the same cards as Guided Mode step 1 (`ProfileField`, with each card's example fields, current type marked "Current"). Choosing another type applies the rule below; choosing the same type just closes.

### I-4.2 Rule

| From -> to | What happens | Confirmation |
|---|---|---|
| any -> any | Data of capabilities the new profile does not show is **kept, hidden, and not published** (not rendered, not in structured data). Switching back restores it. | none, unless one of the rows below applies |
| book -> other, with author/year/ISBN filled | `bookDetails` kept but hidden | "Author, year and ISBN will be hidden. They come back if you switch back." |
| food -> other | **Allergen declaration is cleared** (existing rule, ADR-033 D-3 / `applyItemRules`). Dietary marks are kept hidden. | **Warning first:** "Allergen information will be removed from this item." with Cancel / Change type |
| other -> food | Declaration starts at "not reviewed" (existing rule); publishing is blocked until reviewed, a draft is not | none; the publish blocker names it |
| a food item with dishes using it as an option | not affected | none |

The server stays the authority (`applyItemRules` in `dashboard-patch.ts`, now written with `can('foodInformation')`); the sheet only explains. The change autosaves like any other field (U6).

---

## I-5 Guided Mode: screens

Principles in force: U1 a disabled primary names what is missing, in place; U2 optional fields never block, drafts always save; U3 publish blockers listed with links to the screen that fixes them; U6 autosave ("Saving…" then "Saved"). Screens come from `PROFILES[p].guided`. Old steps `preview`, `languages`, `page`, `category` are folded into the last screen (the preview becomes a live card above the publish choice; "Translate now or later" is a row that opens the languages step and returns).

Shared reuse on every profile: `PhotoSource` for the picture then `PhotoEditSheet` for the focus point; the shared `PublishChoice` on the last screen; the done screen from `cb3753f`.

### I-5.1 Book (target: 3 screens, then done)

Phone first.

| Screen | Asks | Required | Notes |
|---|---|---|---|
| 1 Type | Cards: Book / Food or drink / Product / Service, preset's suggestion first, example fields on each. | choosing one (tap advances) | nothing preselected |
| 2 The book | **Title**, **Author**, **Year**, **ISBN** (year and ISBN side by side on phone, numeric keypads), **Cover** (`PhotoSource`: take a photo / from phone / library). | **Title only** | Primary button "Next". If Title is empty it reads "Add a title to continue" (U1). ISBN warning is quiet text beside the field (I-3.3). Cover shown portrait 2:3 whole. |
| 3 Publish | Short description (optional), buying/info link (label + address), category with inline "+ Add" (U4, if categories exist), own page switch, live card preview, then `PublishChoice`. | nothing (draft is always allowed) | Primary: "Publish" / "Schedule" / "Save draft" by choice. If publishing is blocked, the blockers are listed with "Fix this" links (U3). With more than one language: row "Translate now or later". |
| Done | View on site · Add another book · Back to Catalogue · Add to a collection | | |

Desktop: the same three screens in the centered column of `WizardFrame`; at wide widths a live preview of the card (cover 2:3, title, author · year) sits to the right of screens 2 and 3.

### I-5.2 A dish, created during service (4 screens, built for thumbs)

| Screen | Asks | Required | Notes |
|---|---|---|---|
| 1 Type | as above (the preset suggests Food or drink, shown first) | tap | |
| 2 The dish | **Name**, **Price**, **Photo** (optional; "Skip" is the visible default action) | **Name only** | Name + price share one screen because that is what a special needs. Price field is decimal-keypad; an invalid price disables Next and says "Check the price: use numbers, like 8.50" (U1). No photo is ever required. |
| 3 Food information | Allergens (list of allergens, or "None"), dietary marks, options (only if the project has option lists, D7) | nothing for the draft | If skipped, the dish saves as a draft with allergens "Not reviewed". Publishing it later is blocked until reviewed, which is the existing legal gate (D-3). |
| 4 Publish | Category (inline "+ Add"), live card, `PublishChoice` | | The blocker list names "Allergens not reviewed" with a link back to screen 3. |
| Done | View on site · Add another dish · Back | | |

Repricing an existing dish during service is **not** a Guided Mode job: it is the editor's Prices tab today and the point of Quick Edit later (D3, step 9). See open question 2.

### I-5.3 A product (3 screens)

| Screen | Asks | Required |
|---|---|---|
| 1 Type | | tap |
| 2 The product | Name, Photo, Price (optional "from"), short description | Name only |
| 3 Publish | Options (only when relevant, D7), link, category + "+ Add", own page, live card, `PublishChoice`, "Translate now or later" | nothing |

### I-5.4 A service (3 screens)

| Screen | Asks | Required |
|---|---|---|
| 1 Type | | tap |
| 2 The service | Name, short description, Price ("from", optional), Photo (optional) | Name only |
| 3 Publish | Channel/time prices and add-ons (only when relevant, D7), booking link, category + "+ Add", own page, live card, `PublishChoice`, "Translate now or later" | nothing |

Duration is recorded as later (not designed here).

### I-5.5 Where blockers show

- **Next/primary disabled** (U1): only for the three real minimums: no type chosen, no title/name in the default language, a price or option-list value that cannot be saved. The label says which.
- **Publish blocked** (U3): on the last screen, in the `PublishChoice` slot, as a list; each line links to the screen that holds the field (`issue.step` -> screen id). Choosing "Keep as draft" is never blocked.
- **Advice** (ISBN): beside the field only.

---

## I-6 Existing editor: changes in this phase (minimal)

D3: the existing editor is preserved. Quick Edit is **out of scope** here and is not an overlay or a merge of the two experiences.

1. Header: type label + "Change type" (I-4); the profile block leaves the Content tab.
2. Tabs and content fields come from `PROFILES[p].editor` instead of `isFood` and `showOptions` expressions. Book gets no new tab: author, year and ISBN sit in the Content tab directly under the Title.
3. Name field label is "Title" for books.
4. Book details fields with the soft ISBN warning (I-3.3).
5. Tab issue counts keep working; `advice` shows as a dot, not a count.
6. `bookDetails` joins the field whitelist in `dashboard-patch.ts` and the autosave payload; no other behaviour changes.

---

## I-7 Public presentation per profile (summary; built in step 7)

| | Book | Food or drink | Product | Service |
|---|---|---|---|---|
| Image | cover 2:3, whole | photo 4:3, focal crop | square, contain or focal | optional, 4:3 |
| Card meta | author · year | price · dietary marks | price | "from" price |
| Item page | cover + title, author, year, ISBN + links | photo + prices + allergens + options | gallery + price + links | text + price + links |

Mixed collections render each item by its own profile. All of this goes behind per-profile cases in `delivery-matrix.test.ts` before it ships. Until step 7 the dashboard list (quick-win round) and the dashboard preview (slice 4d) already show the book shape; the public site keeps today's presentation, with the cover shown whole (quick win 2.7).

---

## I-8 Equivalence test (D9) and acceptance scenarios

### I-8.1 Equivalence test

Definition: for each scenario below, a scripted list of user inputs (type, fields, photo, price, publish choice) is applied through **each editing experience** and the resulting `catalogueItem` document is compared. The two must be deep-equal after removing `_id`, `_rev`, `_createdAt`, `_updatedAt`, and normalising array `_key`s.

- Driver A: `ItemWizard` (Guided Mode). Driver B: `ItemEditor`. (Quick Edit joins as driver C in step 9 with no change to the test.)
- Both drivers talk to the same real pipeline: `use-item-state` -> `use-catalogue-draft` -> autosave -> `dashboard-patch` applied to an in-memory document. The test mocks only the network `send`.
- It also asserts the same refusals: an invalid price and an item without a title are rejected identically by both.
- Lives in `src/components/__tests__/catalogue-equivalence.test.tsx`. The pure half (script applied straight to `dashboard-patch`) lands with slice 4b; the two component drivers land with slice 4c (editor) and step 6 (wizard).

### I-8.2 Acceptance scenarios

| # | Scenario | Passes when |
|---|---|---|
| S1 | **tmz bookshelf.** Add a book with only a title and author, then another with title, author, year, ISBN, cover. | First: 3 screens (type, book, publish), published, no ISBN required. Second: saved fields appear in the editor; list shows 2:3 cover, author under title, price column; item page emits `Book`. A mistyped ISBN shows the soft warning and still publishes. An empty title blocks Next with "Add a title to continue". |
| S2 | **Restaurant manager during service.** On a phone, add today's special "Risotto ai funghi" at 14.00 with no photo, then reprice it. | Item exists as a draft after screen 2 without any other field; Guided Mode completes without a photo; publishing is blocked only by "Allergens not reviewed" with a link; draft is never blocked; reprice via the editor is autosaved with "Saving… / Saved" (U6). Tested with a real restaurant manager (D8). |
| S3 | **Mixed three-item catalogue** (Restaurant preset unchanged): Margherita (food, price 8.00, extra mozzarella option, allergens declared), olive oil (product, price 12.00), *The Hitchhiker's Guide to the Galaxy* (book, Douglas Adams, 1979, ISBN 9780345391803, cover, a purchase link). | All three coexist; each shows its profile's list line and image shape; JSON-LD: `Product`, `Product`, `Book`; in a `menu` collection each is a `MenuItem` (B1); changing the book to Product and back keeps its book details; changing Margherita away from food warns about allergens first. |

---

## I-9 Build plan: step 4 in reviewable slices (after Tom approves)

Each slice is one commit on dev, green on `typecheck`, `lint`, `test`, and verified on both dashboards where a shared component changes (ADR-030). No slice touches production data.

| Slice | Content | Files touched | Tests |
|---|---|---|---|
| **4a Registry (refactor, no behaviour change)** | `profiles.ts` with the three existing profiles plus the `book` type present but unused by UI; replace every call site in I-2.4 | new `profiles.ts`; `dashboard-form.ts`, `item-issues.ts`, `dashboard-patch.ts`, `dto.ts`, `structured.ts`, `resolve.ts`, `catalogue-drafts.ts`, `dashboard-queries.ts`, `schema.ts`, `registry.ts`, `ItemEditor.tsx`, `ItemWizard.tsx`, `catalogue-ui.tsx`, `CatalogueBrowser.tsx` | New `profiles.test.ts` (shape, order, `can`, `profilesWith`, unknown -> product). **Guard test:** no `'foodOrDrink'` literal or `isFood` outside `profiles.ts` and tests. All existing tests pass unchanged (this proves "no behaviour change"). |
| **4b Book data, reading side first** | `book` enum value, `bookDetails`, DTO field, `resolve.ts` (byline fallback), `Book` JSON-LD, ISBN/year validation, patch whitelist, Studio object | `schema.ts`, `dto.ts`, `resolve.ts`, `structured.ts`, `validation.ts`, `dashboard-patch.ts`, new `isbn.ts` | `isbn.test.ts` (10/13 checksums, hyphens, X, bad input); `resolve.test.ts` (byline fallback, hidden when profile changed); `structured.test.ts` (Book with/without offer, invalid ISBN omitted); `dashboard-patch.test.ts` (accepts partial details, rejects year out of range, never rejects for ISBN); `schema-rules.test.ts`; old-deployment fallback (unknown profile -> product); delivery-matrix case for book. Pure half of the equivalence test. |
| **4c Editor** | Header label + "Change type" sheet with warnings; registry-driven tabs; Title label; Book fields in Content with soft ISBN warning; `advice` severity | `ItemEditor.tsx`, `item-fields.tsx`, `item-issues.ts`, `catalogue-ui.tsx`, i18n en/de/it | `item-issues.test.ts` (advice never blocks); `dashboard-form.test.ts`; component test for header and sheet (warning appears only for food -> other and book with details); editor half of the equivalence test. |
| **4d List and dashboard preview** | List columns/secondary line/cover shape read from the registry (coordinates with the quick-win round: this slice only swaps its inputs to the registry); dashboard `ItemPreview` shows the book card | `list-model.ts`, `CatalogueBrowser.tsx`, `ItemPreview` | `list-model.test.ts` (book rows: author line, price column present, 2:3 cover). |

**Step 6 (Guided Mode build, later, own review):** 6a screen model driven by `guided` + type screen; 6b per-profile screens (I-5.1 to I-5.4); 6c publish screen (blocker list with links, languages row, live card); 6d wizard half of the equivalence test and the S1 to S3 walkthroughs with the bookshelf and a restaurant manager (D8).

---

## I-10 Open questions for Tom (with recommended answers)

1. **Show all four type cards to every project?** A Restaurant project would see Book too. *Recommend:* yes, always all four, ordered by the preset with one marked "Suggested" (D7, "presets never restrict").
2. **Repricing a dish during service.** Guided Mode is for creating. Repricing stays in the editor's Prices tab until Quick Edit (step 9). *Recommend:* accept for now; add a "Change price" action on the list row at Quick Edit time, and watch for this in the restaurant-manager test (D8) before deciding it needs to come earlier.
3. **The tmz pilot books are stored as `product`.** *Recommend:* change them by hand with "Change type" when slice 4c is on dev; no migration script (production safety, I-3.6).
4. **Author and year shape.** *Recommend:* author is one free-text line (several names allowed in one line, no structured author list), year is a whole number only (no "c. 1950"). Both can widen later because `bookDetails` is an object.
5. **A book inside a "menu" collection** is a `MenuItem` by B1, not a `Book`. *Recommend:* leave B1 as is; it is the editor's explicit choice of collection type, and bookshops use `list`.

## I-11 Tom's answers (16 Oct 2026)

1. All four type cards for every project, ordered by preset, one "Suggested" — **approved**. Each card gets an appropriate icon (book, food/drink, product, service).
2. Repricing during service stays in the editor until Quick Edit — **approved**; revisit after the restaurant-manager test.
3. tmz pilot books converted by hand with "Change type" after slice 4c — **approved**.
4. Author = one free-text line; year = whole number — **approved**.
5. A book in a "menu" collection stays a `MenuItem` (B1 unchanged) — **approved**.

Categories and tags (multilingual management, inline "+ Add" from the item) are handled in step 5 (5a categories, 5b tags / Amendment H), not in this amendment.

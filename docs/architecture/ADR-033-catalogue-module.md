# ADR-033 — Catalogue module: items, collections, offers and options

**Status:** Accepted (2026-10-13, Tom). D1–D3 and D5–D10 approved; D4 approved as amended (public item pages are in V1); D11–D14 resolve the open questions of the proposed revision. Nothing implemented.
**Builds on:** ADR-011/016/020 (modules), ADR-014 (one configuration surface), ADR-022 (gallery module — Media Library and focal points), ADR-023 (Translate), ADR-025 + `client-dashboard/content-wizard-spec.md` (client editor), ADR-028 (roles & permissions), ADR-029 (tenant dashboard), ADR-031 (Connections — reserves `Menu v1` as a later resource, §4 item 13), ADR-032 (content lifecycle — D13 already states *"Menu (new): adopts the lifecycle from day one"*), the Publicly Routable Content pattern, the Schema Evolution Rules, the Multilingual-First Principle and Configuration Over Hardcoding (CLAUDE.md).
**Implementation spec:** `docs/engineering/catalogue-module/catalogue-module-v1-spec.md` — the *what it looks like*. This ADR is the *why and what*.

---

## 1. Context

Tom is adding a restaurant offering to Abluo (ADR-031 §1). The first need is a restaurant that publishes its dishes and arranges them into menus, prices them differently for dine-in and takeaway, and later takes pre-orders.

Work on that requirement produced a prior-art analysis of a point-of-sale menu system built for a different customer, and a V1 specification written against it. Reviewing that specification surfaced two framing errors, both corrected here:

1. **The module was named for its output.** It was called the Menu module, but a menu is one *presentation* of a set of things. The module owns the things, their categories, their commercial terms and their choices; a menu is one way to show them. Naming the module after the output made every later sentence ambiguous.
2. **The offering is not restaurant-specific.** An item may be a dish, a wine, a book or a service. The first tenant is a restaurant; the module must not encode that, in line with *Platform Before Tenant* and ADR-031 D6 ("No code asks 'is this a restaurant?'. Behaviour follows data.").

A third decision changed on review: catalogue items need **optional public pages of their own** in V1, because a business promoting a single wine, book or service needs a direct link to it.

This ADR fixes the vocabulary, the model and the V1 boundary. ADR-031 §4 item 13 reserved a separate ADR for exactly this.

---

## 2. Decisions

### D1 — The module is `catalogue`; four concepts, four names

The module id is `catalogue`. It owns four distinct concepts, which must never be conflated in schema, code, UI copy or conversation:

| Concept | What it is | Sanity type | schema.org |
|---|---|---|---|
| **Item** | The thing itself — a dish, a wine, a book, a service. Identity, description, media, category, attributes. | `catalogueItem` (document) | `Product` · `MenuItem` · `Service`, by `itemType` |
| **Collection** | An ordered, sectioned, publishable curation of items. A menu is a collection; so is a wine list, a services page, a seasonal selection. | `catalogueCollection` (document) | `Menu` · `ItemList` |
| **Offer** | The commercial terms under which an item is available — price, currency, service channel, availability window. | `catalogueOffer` (object, on the item) | `Offer` |
| **Option** | A choice that modifies a line at order time, with a price delta. Never creates a new sellable thing. | `catalogueOptionList` (document) + `catalogueOption` (object) | `menuAddOn` |

Two consequences worth stating because they are the ones people get wrong:

- **An offer is not a field on an item.** Price was previously an array of `{channel, amount}` rows. Promoting it to a named concept is what lets *takeaway, €8.50, 18:00–22:00* be one object rather than a price in one place and a time in another — and it is what makes the eventual `Offer` in JSON-LD and in `Menu v1` a projection rather than an assembly.
- **An option is not a variant.** An option modifies a line (*extra mozzarella*, *no anchovies*). A variant generates a distinct sellable unit with its own stock and barcode (*Blue / L*). They look alike in a UI and are different in the data. V1 has options only; §5 shows how variants arrive without restructuring.

**Rename:** `src/lib/modules/create-menu.ts` → `add-content-sheet.ts`. It is the Add-content sheet (ADR-025 D8), not a menu, and the collision is now avoidable.

*(Spelling: `catalogue`, British, as chosen. Machine ids, permission ids and type names all use it consistently.)*

### D2 — Options are in V1

An item may carry ordered **option list attachments**, each with its own `min` and `max`.

**`min` and `max` belong to the attachment, not to the list.** "Choose 1 sauce" on a burger and "up to 3 sauces" on a platter is one list used twice; putting the numbers on the list forces a duplicate list per usage.

An option carries a `kind` (`add` · `remove`) and a `priceDelta` which may be zero or negative. Free and paid choices are therefore one concept with one field — there is nothing for the tenant to classify. A list may also hold a reference to a real catalogue item (a side salad that is also sold alone); the picker offers only items that are themselves offered.

Options are in V1 because without them the module cannot express the cases that motivated it: *doppia mozzarella*, *senza mozzarella*, and — the one that proves the `kind` distinction — *the pizza has no anchovies but I want anchovies*.

### D3 — Service channels are module configuration, not documents

A **service channel** is how or where an item is supplied: dine-in, takeaway, delivery, in-store, shipped, online. Channels are a short, ordered, localized vocabulary with stable machine values, so they are a `localizedStringList` config field on the module — ADR-014's one configuration surface, and the same mechanism as blog categories (ADR-020 Amendment B: defining a vocabulary is configuration; selecting from it while writing is content).

An offer names a channel. An item with no offer on a channel is simply not supplied that way, which is also how a tenant says "takeaway only".

This holds while a channel is a label. The moment a channel needs a second attribute — an icon, its own schedule, a fulfilment rule — it becomes a document type and this decision is revisited.

### D4 — Catalogue items may have their own public pages (amended; approved)

**Originally proposed as "no public item pages in V1"; reversed by Tom.** A business promoting one wine, one book or one service needs a direct link to it, and that is not a restaurant concern that can wait.

Item pages are **opt-in per item** and satisfy all five requirements of the Publicly Routable Content pattern. No shortcuts.

1. **Schema** — `slug: localizedSlug` and `redirectFrom: redirectFrom`, plus `hasPage: boolean` (default `false`). A slug is required when `hasPage` is true, and reserved while the document exists so restore + republish returns the same URL.
2. **GROQ** — three queries: primary lookup with **no locale fallback on the slug**, redirect lookup, and list queries that resolve the slug for display.
3. **Route** — `src/app/[locale]/(website)/[tenant]/products/[slug]/page.tsx`, with the redirect branch, `SlugMapProvider`, and `generateMetadata` carrying canonical and hreflang alternates from `siteConfig.supportedLocales` + the item's slug map.
4. **Sitemap** — one URL per locale, only where `hasPage`, the slug is set for that locale, and the item is publicly visible under the ADR-032 D3 fragment.
5. **Migration** — none; the type is new.

**Structured data follows `itemType`, by lookup, never by branching:** `dish → MenuItem`, `product → Product`, `service → Service`. Offers emit as `Offer` with `price`, `priceCurrency` and `availability`. The item page also carries its canonical URL, which ADR-031 D3 requires of every shareable resource.

**Collections are routable on the same terms** — a wine list and a lunch menu each want their own URL — under `/collections/[slug]`, with the identical five requirements and `hasPage` opt-in.

**Superseded by D11 and Amendment C (C1, C2):** the fixed `products` / `collections` segments in items 3 and the paragraph above were replaced by one configurable segment per project, served through the existing `[...slug]` catch-all.

~~**Open:** the URL segments `products` and `collections` are fixed in V1 (§6). Configuration Over Hardcoding argues for making them tenant-configurable and localized; the Next.js App Router makes that a catch-all route with its own costs. Events set the precedent of a fixed segment.~~

### D5 — No collection-level price overrides in V1

An offer belongs to an item and names a channel. "This dish costs more inside the tasting menu" is not expressible in V1 and is not needed by the first tenant. The offer object already carries the fields such an override would need, so adding a collection-scoped offer later is additive.

### D6 — Nesting: the model permits depth, the editor guides to two

A collection's sections form a tree via `parentKey`. The model places **no limit** on depth; the editor defaults to two levels and warns beyond three.

Two levels is what a menu needs (Pizza → Classiche / Bianche / Speciali). But a serious wine list is genuinely Vini → Rossi → Toscana, and the schema should not be the thing that forbids it. This follows the general rule adopted during review: **restrict in the picker, not in the model** — a default that can be overridden is help, a rule that cannot is a wall.

### D7 — One currency per project, persisted once and resolved at read time

The project's currency is a module config field and is the **sole persisted,
authoritative currency setting**. One value per project, formatted for the
request locale with `Intl.NumberFormat`. Multi-currency is a markets problem,
not a catalogue problem, and is out of scope.

**Offers never duplicate it, and never read their own field.** Public contracts,
JSON-LD and any future extraction materialise the project currency as each
offer's effective currency at read time:

```ts
effectiveCurrency = project.currency   // NOT offer.currency ?? project.currency
```

A coalesce would activate multi-currency the moment anything wrote the reserved
field — the opposite of "nothing reads it, nothing writes it" (D14). Writing the
currency onto every offer would put the same fact in two places, and the first
currency change would leave them disagreeing with no rule for which wins. (The
prior-art analysis records the same shape as a defect: `Plu.menuIds` mirrored
menu membership and needed a written tie-breaker.)

**Changing the currency does not convert prices, and must say so.** A project
switching EUR → CHF turns a stored `9.50` from €9,50 into CHF 9.50 — around a
7% change nobody authorised. The configuration surface therefore warns before
the change, naming the scale of what is reinterpreted ("147 prices across 38
items will be read as CHF. No amounts are converted."), and requires
confirmation. It does not block: changing currency is legitimate, and a tenant
who means it should not be stuck.

### D8 — This ADR governs; the spec follows it

The implementation specification is `docs/engineering/catalogue-module/catalogue-module-v1-spec.md`. Where the two disagree, this ADR wins and the spec is corrected.

### D9 — Lifecycle, visibility and publishing are inherited, not invented

- **Nothing is live on save.** Items, collections and option lists adopt ADR-032 from day one: `publishedAt`, `expiresAt`, `archivedAt`, `archivedBy`; status **derived** by `deriveStatus()`, never stored; `publishedAtRule: 'optional'`.
- Every public path uses the shared visibility fragment from `src/lib/lifecycle/` (ADR-032 D3), and joins that test's inventory of delivery paths: item pages, collection pages, the listing section, sitemap, `generateMetadata`, JSON-LD.
- **Visibility** uses the events vocabulary and copy exactly: `public` · `websiteOnly` · `unlisted`.
- Archiving or deleting an item referenced by a **public** collection is refused and names the collections; references from drafts or archived collections do not block (the Gallery rule, ADR-032 D13).

### D10 — Connections readiness, with no endpoints in V1

ADR-031 §4 item 13 admits menus as a future resource on the existing Connection model. V1 prepares three things and implements no endpoint, no OAuth, no webhook, no tombstone and no sync:

1. **`publicId`** (UUID, read-only, set once) on `catalogueItem` and `catalogueCollection` — ADR-031 D3 forbids exposing the Sanity `_id`.
2. **`visibility`**, as above — the public / website-only classification a Connection filters on.
3. **schema.org-shaped rendering** — `Menu` → `hasMenuSection` → `hasMenuItem` → `offers`, which is the contract vocabulary ADR-031 D3 already names, so `Menu v1` becomes a projection of what the website already emits rather than a second model.

---

## 3. Data model (Sanity; no Supabase tables in V1)

Every document carries `projectSlug` and every GROQ query filters by it.

```
catalogueItem          projectSlug, publicId, itemType, name, description,
                       images[], categories[], attributes, offers[],
                       optionLists[], hasPage, slug, redirectFrom,
                       visibility, lifecycle fields
  catalogueOffer       channel, price, currency?, availability[]   (object)
  catalogueItemOptionList  list→ref, min, max                      (object)

catalogueCollection    projectSlug, publicId, name, description, sections[],
                       hasPage, slug, redirectFrom, visibility, lifecycle fields
  catalogueSection     _key, name, parentKey?, items[]→ref          (object)

catalogueOptionList    projectSlug, name, options[], lifecycle fields
  catalogueOption      label, kind(add|remove), priceDelta, item?→ref (object)

cataloguePage          module singleton page
catalogueListingSection  renders one collection on any page
```

`itemType` — `dish` · `product` · `service` in V1, `digital` later. Present from day one so §5 is additive. It drives which fields the form shows and which schema.org `@type` is emitted; it never drives business branching.

`attributes` — a small, typed, optional set shown by `itemType`: allergens and dietary tags for `dish`, and nothing else in V1. The fourteen EU allergens (Reg. 1169/2011 Annex II) are a **platform constant**, not configuration: a closed legal list that no tenant may extend and no configuration may hide.

---

## 4. Permissions

Module-declared, derived by `buildModulePermissions()`, ids `{moduleId}.{noun}.{verb}`:

| id | Default roles |
|---|---|
| `catalogue.item.read` | owner, editor, viewer |
| `catalogue.item.write` | owner, editor |
| `catalogue.item.delete` | owner, editor |
| `catalogue.collection.write` | owner, editor |
| `catalogue.collection.delete` | owner, editor |
| `catalogue.taxonomy.write` | owner, editor |

Writing includes publishing — ADR-032 D5 confirms no `publish` verb exists. `can()` stays fail-closed; every dashboard route calls `assertModuleAction` before its first read.

---

## 5. Future capabilities — why V1 does not block them

Not specified, not built. Listed to show the model accommodates them additively under the Schema Evolution Rules.

- **Physical and digital items.** `itemType` gains values. Shipping, weight and dimensions arrive as optional fields, revealed by an explicit toggle rather than by type alone — a restaurant posting jars of its own sauce needs shipping on something it also puts on a menu.
- **Variants and stock.** A child `catalogueUnit` type carries `sku`, `stock`, `barcode` and the offers; the item's own `offers[]` become the single implicit unit's. Contained, and the reason offers are rows rather than scalar fields.
- **Ingredients.** An optional relation to a preloaded multilingual vocabulary. An authoring aid, not a runtime model: it pre-fills the *senza X* / *doppia X* options D2 already supports, and eventually derives allergens — marked as derived and requiring human confirmation before publishing, exactly as machine translation is (ADR-023).
- **Ordering and pre-order.** Basket, order and payment in Supabase; `dataStore.primary` becomes `hybrid`. A line references an item (later a unit) plus chosen options, and because options carry a price delta the total is computable with no catalogue change. A pre-order window is an offer's availability on a channel — already expressible.
- **TableRes.** `Menu v1` on the Connection model of ADR-031, fed by the schema.org shapes of D10.

---

## 6. Resolved — formerly open questions

### D11 — One configurable public base-path segment per project

The public base path is **one segment, configured per project**, shared across
locales in V1, and used by **both** collection pages and optional item pages.
Localized content slugs follow it:

```
/{locale}/{tenant}/{segment}/{slug}
```

A restaurant configures `menu`, a bookshop `books`, a studio `services`. Fixing
the segment in code would have hardcoded a value that varies by tenant, which
*Configuration Over Hardcoding* forbids; localizing it as well is deferred
because the cost — per-locale resolution, per-locale uniqueness, hreflang across
differing segments — buys little in V1.

Three consequences, each of which the implementation must handle explicitly:

1. **Items and collections share one slug namespace.** `/menu/pizza-margherita`
   and `/menu/menu-di-natale` sit at the same level, so a slug must be unique
   across **both** types within a project and locale. The validation names the
   conflicting document rather than merely refusing.
2. **The segment is validated against reserved and existing routes** — `events`,
   `posts`, `collections`, `catalogue`, `admin`, `api`, and any page slug in the
   project. A segment that would shadow an existing route is refused at
   configuration time, not discovered as a 404 later.
3. **Every historic segment is retained and reserved.** A project-level segment
   change is a bulk URL change, so the project keeps `publicSegmentHistory` — an
   append-only list of every segment it has used — and `/{historic}/{slug}` 301s
   to `/{current}/{slug}` for every document that has a page.

   A list, not a single previous value: `menu` → `carta` → `menu-2026` would
   otherwise lose the `menu` redirect at the second change, and every link
   printed on a card or indexed by Google would 404.

   Historic segments are **reserved** alongside the current one, so a page slug
   can never take a name that still redirects — which would shadow the redirect
   silently. The exception is returning to a previous name: setting the segment
   back to a historic value removes it from the history and stops its redirect,
   because a tenant reverting a rename is not a collision.

   This is distinct from per-document `redirectFrom`, which handles a slug
   changing underneath an unchanged segment. Both are required, and both are
   tested.

### D12 — One dashboard entry with a project-configurable label

The catalogue is **one navigation entry** in the client dashboard, with Items and
Collections as internal views. Its label is a project-level `localizedString`
config field: a restaurateur writes "Menu", a bookshop "Books", and neither is
asked to recognise the word *catalogue*.

**The label is presentation only.** Module id, permission ids, route helpers,
Sanity type names, GROQ and every internal identifier remain `catalogue`
regardless of what a tenant calls it. A renamed label must never reach a
machine-readable surface.

### D13 — One module, with internal boundaries

`catalogue` owns items, offers, options, collections and collection sections.

**A collection is structured catalogue data, not a website-presentation entity.**
This is the distinction that keeps CLAUDE.md principle 7 intact: the collection
is owned, ordered and permissioned by the module; `catalogueListingSection`
merely renders one. A collection is not a section and must never acquire
presentation fields.

Website sections and future commerce modules reference the catalogue through
module dependencies. Ownership stays here unless a demonstrated requirement
justifies extraction — two modules with one consumer would be speculation.

### D14 — Offers are embedded, with stable identity and an extraction-friendly shape

An offer is an object on its item. It belongs to exactly one item and follows
that item's lifecycle and permissions — publishing an item publishes its offers,
archiving it withdraws them, and no separate permission exists.

**Every offer carries a stable key.** The Sanity array `_key` is its identity and
is never regenerated. If offers are ever extracted into documents, `_key` becomes
the new document's `publicId`, so references made in the meantime survive.

An offer may describe: `price`, `currency`, `channel`, `locationKey` and
availability. Of these, **`currency` and `locationKey` are reserved** — the shape
exists so extraction and multi-location are additive, and neither is exposed in
the V1 editor:

- `currency` **remains unset in V1 and has no effect.** D7 holds without
  amendment: the project setting is the only persisted currency, and the offer's
  effective currency is resolved from it at read time. The field exists so that
  introducing multi-currency is additive rather than a migration; nothing reads
  it, nothing writes it, and the V1 editor does not show it.
- `locationKey` is validated against `siteConfig.locations[].key` when present,
  matching `validateEventLocationKey`. Location scoping proper is ADR-031 V1.2.

Cross-item promotions and independently managed pricing rules are a separate
future capability, not an offer.

## 7. Consequences

- The module is named for what it owns, so "menu" can go back to meaning a menu — including as the name of the future Connections resource.
- Making **Offer** a concept rather than a price field is what carries channels, availability, JSON-LD and the future partner contract on one object.
- Public item pages in V1 add the full routable checklist — slugs, redirects, sitemap, hreflang, structured data — to a module that would otherwise have had none. That is real V1 cost, taken deliberately, because direct links to a single product are the point of a catalogue that is not only a menu.
- Nothing restaurant-specific reaches the code. The first tenant is a restaurant; the second may be a bookshop, and no migration separates them.
- One base-path segment (D11) keeps URLs short and tenant-appropriate at the cost of a shared slug namespace and a segment-change redirect path — both specified rather than discovered.
- A configurable label (D12) means no tenant reads the word *catalogue* unless they choose to, while every identifier stays stable for the people and systems that need it.

---

## Amendment A — post-acceptance corrections (2026-10-13, Tom)

Eight corrections agreed after acceptance, recorded here rather than edited
silently into the decisions above. Where a decision's body text was wrong it has
been corrected and is listed below; the record of *what changed and why* lives
here.

**A1 — Overnight intervals are legal.** The V1 spec validated availability as
`from < to`, which rejects `18:00–02:00`. A bar serving until two in the morning
cannot express its hours under that rule. Availability intervals may wrap past
midnight; `days` names the day the interval **starts**, so Friday 18:00–02:00
covers 01:00 on Saturday. (The prior-art resolver modelled this by letting
minutes exceed 1440.)

**A2 — An offer's channel is optional.** An offer with no channel is
**unscoped**: it applies to any channel that has no applicable offer of its own.
A tenant with one price everywhere authors one offer, not one per channel.

**A3 — Non-overlap is per scope, not one offer per channel.** The V1 spec said
"one offer per channel", which forbids a lunch price and a dinner price on the
same channel — the ordinary case. The rule is: within a scope, availability
windows must not overlap.

```
scope = the offer's channel, or the unscoped bucket
```

Overlap **between** scopes is legitimate and expected: a channel-specific offer
and an unscoped one may both apply at the same instant, because precedence
resolves them.

**A4 — Deterministic channel precedence, with ambiguity as a result.**

1. An applicable channel-specific offer wins.
2. Otherwise an applicable unscoped offer applies.
3. Neither → the item is not sold through that channel.
4. Two or more applicable offers at the same precedence → **`ambiguous`**. Never
   the first, never the cheapest.

Static validation (A3) makes outcome 4 unreachable through the editor. The
runtime guard exists for imported and legacy data, where no save-time check ran.

**A consequence worth stating rather than discovering:** an unscoped offer makes
every channel sellable whenever that offer applies. "Dine-in is sold *only* at
lunch" is therefore inexpressible while a universal offer exists — the tenant
scopes their offers instead. This is intended.

**A5 — Location resolution stays inactive.** `locationKey` remains a reserved
field (D14). No resolver consults it in V1.

**A6 — Project currency is the sole V1 authority.** D7's body previously
specified `offer.currency ?? project.currency`. Corrected above to
`effectiveCurrency = project.currency`. The reserved field has no effect until
multi-currency is formally introduced.

### A7 — Fail-visible recovery for broken collection trees

Neither orphans nor cycles may hide content. The prior-art defect was the
opposite — subsections whose parent had been deleted rendered nowhere while
remaining in the saved document: invisible and persisted, the worst pair.

**Orphans** (a `parentKey` naming a section that does not exist):
- the orphan becomes a **recovery root** for reading purposes;
- its own descendants stay attached beneath it;
- original relative order is preserved;
- the persisted `parentKey` is **never modified or cleared** — recovery is a
  read-time behaviour, not a silent write;
- a `missingParent` issue is reported, carrying both keys;
- the editor refuses to **create** a new orphan, while content that is already
  broken stays visible until repaired.

**Cycles:** valid roots are traversed first; any unvisited nodes are then
appended flat, in source order, each as its own root, with the cycle reported
and the participating keys named. Flat rather than as reconstructed subtrees —
rebuilding a subtree from a cyclic region means re-entering the cycle, which is
the traversal being guarded against. Nothing disappears and nothing loops.

### A8 — Division of labour for time

`src/lib/lifecycle/time.ts` owns **timezone and DST** conversion (`utcToLocal`,
`localToUtc`, and the `exact | gap | overlap` resolution). The catalogue owns
**interval and wrap-around semantics** and composes it. Two implementations of
timezone arithmetic is how two of them drift.

Availability evaluation requires an explicit IANA timezone and must never read
the machine's local zone. It answers exactly one question and returns exactly
two values — `available | outOfHours`. No rules means `available`. "Not sold",
"ambiguous" and publication state belong to the offer resolver and to ADR-032
respectively, and availability must never speak for them.

---

## Amendment B — structured data: contextual mapping (2026-10-13, Tom)

Catalogue items and collections are public content, so what schema.org type
they emit is a modelling decision, not a rendering detail. Retrofitting it onto
a shipped content model is a migration; deciding it now costs a field.

### B1 — The type is contextual, decided by the page

One item has two correct answers depending on where it is rendered, and
pretending otherwise is what forces a wrong one.

| Rendered on | `@type` | Decided by |
|---|---|---|
| A collection page, `collectionType: menu` | `Menu` → `hasMenuSection` (`MenuSection`, nested) → `hasMenuItem` (`MenuItem`) → `offers` | the collection |
| A collection page, `collectionType: list` | `ItemList`, or **`OfferCatalog`** when its items carry offers | the collection |
| An item's own page | `Product` by default, with a nested `Offer` | `itemType` |

**This supersedes the item mapping in D4**, which drove `@type` from `itemType`
alone and emitted `MenuItem` for a dish everywhere. Two reasons it was wrong:

- schema.org `MenuItem` descends from `Intangible`, **not** from `Product`, and
  Google publishes no rich result for a standalone dish — the menu rich result
  is `Restaurant.hasMenu`. A dish's own page is better described as a `Product`
  with an `Offer`, which is what puts a price in search results and what an
  assistant quotes.
- The same item may sit in a menu *and* in a shop collection — the jar of sauce
  of §11.1. A per-item type cannot be right in both places; a contextual one is
  right in both by construction.

`Service` remains available for `itemType: service` on an item page.

### B2 — `collectionType` is a field on the collection

Not a per-installation setting and not inferred.

- **Per-installation fails the case we already committed to**: a restaurant that
  also sells merchandise has a menu *and* a shop collection in one project. One
  setting per tenant cannot describe both.
- **Inference fails on shared items**: the jar belongs to both collections, so
  the items cannot tell you what the collection is.

```ts
collectionType: 'menu' | 'list'   // catalogueCollection, required, default 'list'
```

A tenant who never thinks about it gets `ItemList` / `OfferCatalog`, which is
correct for a catalogue. A restaurant marks its menus `menu` and gets the
restaurant markup. The choice is visible, per collection, and revisable.

### B3 — Fields that feed structured data are first-class

Already true of the model and restated so it stays true: `price`, `availability`,
`images`, `description` and the project `currency` are typed fields, never free
text, because JSON-LD cannot be emitted reliably from prose.

**`sku` does not exist in V1** and `Product.sku` is therefore simply absent. It
arrives with `catalogueUnit` when variants do (§5), which is the correct home
for it — a SKU identifies a sellable unit, not a product.

### B4 — Hidden content emits nothing

Restated for completeness; already specified and already enforced. Items and
collections excluded by the ADR-032 D3 visibility fragment emit no JSON-LD and
appear in no sitemap, exactly as `unlisted` and `noindex` behave elsewhere. The
path-inventory test (D9) covers the structured-data path along with the rest.

### B5 — Who emits it: deliberately NOT decided here

The proposal that prompted this amendment also suggested the module **declare**
its schema.org mapping in `ModuleManifest`, with the platform emitting the
JSON-LD so that modules never hand-write it.

That is a good idea and it is **out of scope for this ADR**, because the
capability does not exist: there is no `structuredData` slot in the manifest and
no platform emitter. Today every module writes its own —
`src/lib/modules/events/structured.ts`, `src/lib/gallery/jsonld.ts` — sharing
only the rendering helpers `JsonLd.tsx` and `safe-json-ld.ts`.

Introducing a declarative registry would change events and gallery too, so it
belongs in its own ADR rather than arriving sideways through the catalogue.
Declaring a manifest field that nothing reads would be worse than either option.

**Until that decision exists, the catalogue follows the current convention:** a
module-owned `src/lib/modules/catalogue/structured.ts` of pure functions, built
to B1's mapping, written once the resolved public DTO and GROQ projection are
defined. Migrating it to a declarative registry later is mechanical, because the
mapping is already a table rather than branching code.

### B6 — A note on ADR-034

ADR-034 is *Canonical host convention (apex redirects to www)*. It is not the
companion decision for per-document canonical URLs — those are specified here in
D11 and in spec §6.4, which emit a canonical plus hreflang alternates from the
slug map.

---

## Amendment C — pre-implementation decisions (2026-10-13, Tom)

Settled while confirming ADR-032 Phase 1 and before the first line of module
code. Each one closes a gap between this ADR, the spec and the code that exists.

### C1 — The landing page lives at the segment

`cataloguePage` is served at `/{locale}/{tenant}/{segment}` — the same
project-configured segment that is the root of collection and item pages
(D11). There is no fixed `/catalogue` URL: a restaurant's landing page is
`/menu`, a bookshop's `/books`.

- **The segment is reserved when the module is installed.** Installing requires
  a valid segment (D11 validation); there is no platform default, because any
  default word would be a hardcoded value that varies by tenant.
- **`cataloguePage` carries the ADR-032 lifecycle.** Its derived status decides
  whether `/{segment}` is publicly accessible; when it is not public the route
  returns the branded unavailable page (ADR-032), exactly like any other
  unavailable content. The landing page's state **does not gate its children**:
  a published collection or item page under the segment resolves on its own
  lifecycle.
- It is a fourth lifecycle descriptor (`cataloguePage`) and joins the D3
  delivery-path inventory.

### C2 — One route: the existing catch-all

Spec §6.2 placed the route at `[tenant]/[segment]/[slug]/page.tsx`. That cannot
coexist with the tenant's existing `[...slug]` catch-all — the App Router
refuses two different dynamic names at one level. Catalogue resolution is
therefore a **dispatch inside `[...slug]`**, before the page lookup:

```
[seg]          seg == current segment            → cataloguePage
[seg, slug]    seg == current segment            → item → collection → item redirect → collection redirect → notFound()
[seg, ...]     seg ∈ publicSegmentHistory        → 301 to the same path under the current segment
anything else                                     → the existing page lookup, unchanged
```

This is also why the segment is validated against every page slug's **first
segment**: a nested page `menu/…` and a catalogue segment `menu` would otherwise
compete for the same paths.

### C3 — Allergen keys are English camelCase

The fourteen platform-constant keys (Reg. 1169/2011 Annex II, in its order):

`gluten · crustaceans · eggs · fish · peanuts · soybeans · milk · treeNuts ·
celery · mustard · sesame · sulphites · lupin · molluscs`

Stable machine values, never shown; labels come from `messages/{locale}.json`
under `catalogue.allergens.*`. Defined once in
`src/lib/modules/catalogue/allergens.ts`.

### C4 — Permissions: option lists reuse item permissions; delete-published is separate

The ADR-032 lifecycle service needs a third permission per type — deleting
**previously published** content (amended 2026-10-13: Owner / Site admin by
default). §4 is extended:

| id | Default roles |
|---|---|
| `catalogue.item.deletePublished` | owner (+ site admin) |
| `catalogue.collection.deletePublished` | owner (+ site admin) |

Option lists modify items and have no audience of their own, so they use the
`catalogue.item.*` permissions (`write`, `delete`, `deletePublished`).
`cataloguePage` uses `catalogue.collection.*`. No `catalogue.optionList.*` ids
exist.

### C5 — Visibility is resolved by context

`visibility` (`public` · `websiteOnly` · `unlisted`) never decides alone; the
**delivery context** does, from one shared definition:

| Context | Admits |
|---|---|
| Automatic listing (anything the platform assembles without an editor choosing the item) | `public`, `websiteOnly` |
| Explicit reference (an editor placed the item in a collection section) | `public`, `websiteOnly`, `unlisted` |
| Partner / Connections output | `public` only |
| Sitemap, search indexing | `public`, `websiteOnly` — and an `unlisted` item's own page is `noindex` |

The lifecycle (ADR-032 D3 fragment) is applied first and in every context:
draft, scheduled, unpublished, expired and archived items never appear, whatever
their visibility and however they are referenced.

### C6 — An item is linked only where its page is routable in that locale

A collection links an item only when the item has `hasPage` and a slug **in the
request locale**. No default-locale fallback URL is generated — the primary
lookup has no slug fallback, so such a link would 404. Without a routable page in
that locale the item still renders in the collection, unlinked.

### C7 — Every reference blocks option-list deletion, including drafts

Archiving or deleting an option list is refused while **any non-archived item**
attaches it — drafts included. Referential integrity protects editorial work,
not only published content. The refusal names and links every item using the
list. (This intentionally differs from the item and collection checks, where
only public referrers block.)

### C8 — Visibility stays in the Content tab

As on events. A platform-wide move to Publishing, if ever made, is made for
every module at once.

### C9 — `deletePublished` is Owner-only

Site admin is not a tenant role, and support access must not silently confer
destructive client permissions.

### C10 — Unlisted content never reaches an index, even through a collection

An unlisted item shown in a collection (C5) is **omitted from that collection
page's structured data** (`Menu` / `ItemList` / `OfferCatalog`) and from
`llms.txt`. An **unlisted collection's own page is `noindex`**, exactly like an
unlisted item's. Without this an indexable collection page would publish what
the item's `noindex` withholds.

### C11 — One helper decides visibility by context

`src/lib/modules/catalogue/visibility.ts` holds the C5 table
(`automaticListing`, `explicitReference`, `partner`, `sitemap`,
`structuredData`) and exposes `visibilityFilter(context, path)` for GROQ and
`admits(context, visibility)` / `isIndexable()` for TypeScript. Every catalogue
delivery path calls it; a hand-written `visibility != "unlisted"` in catalogue
code is a defect. Tested per context, with GROQ and TypeScript asserted to agree.

---

## Amendment D — correction round before the S4 commit (2026-10-14, Tom)

Agreed after reviewing S4. Where D supersedes an earlier decision it says so.

### D-1 — Starter presets; a generic installation stays business-neutral

*Supersedes the spec's "seeded on install with `dine-in`".*

A generic installation creates **no service channels**; an unscoped offer is a
price that applies everywhere. Nothing assumes the project is a restaurant.

**Starter presets** are declared in the module manifest, versioned, validated
against `configSchema` by test, and offered in the Studio Modules pane when the
module is first enabled:

| Preset | `navLabel` | `publicSegment` | `serviceChannels` | `defaultItemProfile` |
|---|---|---|---|---|
| Restaurant | — (not written) | `menu` | `dine-in` (Dine-in · Al tavolo · Vor Ort), `takeaway` (Takeaway · Da asporto · Zum Mitnehmen) | `foodOrDrink` |
| Bookshop | — (not written) | `books` | none | `product` |

> **Update 2026-10-16 (Tom, D12):** the dashboard label defaults to "Catalogue" for every project. `navLabel` is an **optional** project-specific override (e.g. "Menu") set by an admin; presets no longer write it (preset versions bumped to 2; projects that already applied v1 keep their label until it is cleared). Dashboard names and public-facing names (landing page, collections) stay separate.

Rules: explicitly selected; previewed before applying (the preview runs the D11
segment validation and shows any clash — a clash blocks applying); applied once;
idempotent on retry; never reapplied on upgrade; fully editable afterwards.
**Currency is not part of any preset** — it is where a business is, not what it
is; the preview shows the currency the project already has.

The installation records `appliedPreset: { id, version, appliedAt }` for
idempotency and audit. **Only the install flow reads it** — a test fails if any
other code does. After installation behaviour depends solely on configuration.
Demo content packs (sample items, collections, pages, media) are a separate,
future concept and never part of a preset.

### D-2 — Item profile replaces `itemType`

`itemType` (`dish | product | service`) is renamed **`itemProfile`**:
`foodOrDrink | product | service` — a classification of the item, not of the
tenant. A restaurant may sell books; a hotel may list food, treatments and
products in one catalogue. Free to rename: no catalogue document exists
(checked 2026-10-14, production dataset: 0 catalogue documents, 0 installations).

The wizard asks "What are you offering?" first, preselected from the module
setting `defaultItemProfile` (written by a preset or an admin), always
changeable per item.

**Structured data — B1 holds (confirmed by Tom 2026-10-14).** In a `menu` collection every item is a
`MenuItem`. On an item's own page the profile maps by table:
`foodOrDrink → Product`, `product → Product`, `service → Service`.

### D-3 — Allergen declaration for food and drink

When `itemProfile == 'foodOrDrink'` the item carries an explicit declaration:

```ts
type AllergenDeclaration =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[]; note?: LocalizedText }
  | { status: 'noneDeclared'; confirmed: true; note?: LocalizedText }
```

- New food items start `notReviewed`; changing an item's profile **to** food
  resets it to `notReviewed`. `notReviewed` **blocks publishing** (including
  inside "Publish collection and dependencies").
- `containsListedAllergens` requires ≥ 1 allergen; `noneDeclared` requires the
  explicit confirmation — an empty array never means "none".
- "May contain" stays separate from "contains".
- No safety claim is ever inferred ("allergen-free", "gluten-free", vegan).
  This ADR records the **semantic state** `noneDeclared`; its public wording in
  every locale is **pending legal-copy approval** and lives only in the
  message files, never here.
- The declaration is shown **wherever the food item is presented publicly**:
  item page, collection page, listing section (compact, with real text for
  assistive technology). Labels are platform messages, so they exist in every
  locale even when the item is untranslated.
- Products and services show no allergen interface and render nothing.

**`showAllergens` is removed.** A section chooses `compact` or `expanded`
presentation; there is no hidden option. (Supersedes spec §4.6.)

### D-3a — Allergen declarations on option choices (V1)

*Confirmed by Tom 2026-10-14; replaces the earlier "known gap".* An optional
extra can change what is on the plate, so each option choice carries the same
explicit-state declaration — never a bare optional array:

```ts
type OptionAllergenDeclaration =
  | { status: 'notReviewed' }
  | { status: 'containsListedAllergens'; allergens: AllergenKey[]; mayContain?: AllergenKey[] }
  | { status: 'noneDeclared'; confirmed: true }
```

- A choice **linked to a catalogue item** derives its declaration from that item.
- A **free-text `add`** choice requires its own reviewed declaration when the
  option list is used by a `foodOrDrink` item; `notReviewed` blocks publishing
  that parent item, and combined publishing validates every such choice first.
- The rule applies only where a `foodOrDrink` item uses the list; the same list
  on a product or service is unaffected.
- Shown beside the choice with real text, never icons alone — e.g.
  *Extra mozzarella — Contains: milk*, *Add anchovies — Contains: fish*.
- A `remove` or substitution choice **never** removes the item's base allergens.
- `contains` and `may contain` stay separate.

### D-4 — Draft references with publish-time enforcement

*Supersedes S4's published-only pickers.*

Drafts may reference never-published items, collections and option lists.
Such a reference is written weak, marked to strengthen on publish (the existing
posts → gallery precedent): `{ _ref, _weak: true, _strengthenOnPublish: { type } }`.
A reference to a document that has a published version is written strong.

- **Never published** (no published document) = hard publication dependency.
- **Published but not live** (scheduled, unpublished, expired, archived) = valid
  reference. Publishing never changes its lifecycle state; if it will not be
  live when the parent goes live, the editor is warned.
- Pickers include eligible drafts, labelled as drafts, never implying they are public.
- Publishing a document with a never-published dependency is **refused**,
  naming and linking every unresolved dependency — unless the editor chooses D-5.
- On every successful publish the published copy's references are
  **strengthened explicitly** in the same transaction (weak flag and marker
  removed). Abluo does not rely on any server-side strengthening behaviour.
- Public queries resolve only eligible published content (unchanged).

### D-5 — "Publish collection and dependencies" (and "Publish item and dependencies")

One explicit action for coordinated launches. Before confirming it shows: the
document being published or scheduled; every never-published dependency to be
included (the full tree, option lists included, cycles detected safely); the
publication date; any dependency the editor may not publish; items whose own
public page would become available; and dependencies reused elsewhere.

All documents are validated and permission-checked **before** anything is
written, then published or scheduled in **one atomic Sanity transaction** —
any failure publishes nothing. Included never-published dependencies take the
parent's schedule; an existing schedule is never overwritten; dependencies that
already have a published version are not touched. One Activity row per
affected document. References are strengthened as part of the transaction.

This is a **generic operation of the ADR-032 lifecycle service**
(`publishTogether`), not catalogue code — events and galleries will need it.
Recorded as ADR-032 Amendment B.

### D-6 — Three-state price visibility

`catalogueListingSection.showPrices` becomes `'default' | 'show' | 'hide'`
(default `'default'` — "Use Catalogue default"), following
`showPricesByDefault` live. Schema Evolution check run 2026-10-14 against the
production dataset: 0 listing sections, 0 `showPrices` values — no migration.

### D-7 — Localized addresses require a localized name

A slug for a locale may exist only when `name[locale]` is written. Enforced in
the dashboard, the server-side save **and** Studio validation. Missing languages
show "Not translated" in the dashboard and get no link, no `hreflang`, no
sitemap entry and no metadata claim. Editorial text fallback is unchanged but
never manufactures a routable page. (Strengthens C6.)

### D-8 — Archive and permanent delete are separate rules

| Action | Refused when |
|---|---|
| Archive item / collection | a **public** document references it |
| Archive option list | any **non-archived** item attaches it |
| Permanently delete anything | **any** reference exists — draft, published, scheduled, unpublished or **archived** |

Every refusal names and links each referrer. The delete rule matches what Sanity
enforces for strong references; Abluo's check turns it into a readable answer.
(Refines C7.)

### D-9 — Delivery matrix

One readable, table-driven test proves visibility × lifecycle × context ×
language against a sample dataset with a fixed clock, plus segment redirects
(landing, collection, item; language preserved; multiple changes; revert) and
the currency warning. Automatic listings and partner output are tested through
the C11 helper — no speculative query is created for them.

### D-10 — Deferred, in priority order

1. Full-page draft preview. 2. Drag-reordering items inside sections. 3. Bulk list actions.

---

## Amendment E — review corrections before commit (2026-10-14, Tom)

### E-1 — `noneDeclared` may carry "may contain"

"No EU-listed allergen ingredients, but cross-contamination is possible" must be
representable. `mayContain?: AllergenKey[]` is allowed on `noneDeclared`, for
items (D-3) and option choices (D-3a) alike, and rendered as a separate line:
*Allergen information reviewed: no EU-listed allergens declared. May contain: nuts.*
(Supersedes the `noneDeclared` shapes in D-3 and D-3a.)

Working public wording, **pending legal-copy review**, lives only in the message
files: en "Allergen information reviewed: no EU-listed allergens declared." ·
it "Informazioni sugli allergeni verificate: nessun allergene dell’elenco UE
dichiarato." · de "Allergenangaben geprüft: keine Allergene der EU-Liste deklariert."

### E-2 — Studio enforces the option-list rule too

No editing surface may route around food-safety validation. A
`catalogueOptionList` carries an asynchronous Studio validation that finds every
item referencing it (drafts and weak references included) and applies the same
shared rule as the dashboard: while any non-archived `foodOrDrink` item uses the
list, an unreviewed free-text `add` choice is an **error**, and Studio blocks
publishing. Together with the existing item-side check this covers both
directions, so a published item never needs re-validation. If the asynchronous
check proves unreliable, option lists become read-only in Studio and editors are
directed to the dashboard — a known gap is never shipped.

### E-3 — A stray localized address refuses publication

*Supersedes the "drop the slug on publish" behaviour of the D-7 implementation.*
Publishing never rewrites editorial data. An address in a language without a name
in that language refuses publication, naming the language and focusing its
fields; the editor adds the name or removes the address deliberately. When a
localized name is cleared in the dashboard, the editor is offered to clear that
language's address too, with Undo.

### E-4 — Referenced drafts are protected

Unchanged and restated: deleting a never-published draft that other drafts
reference is refused, naming and linking them. A future "remove references and
delete" operation would be explicit.

---

## Amendment F — generic item byline, item links, unpriced item pages (2026-10-15, Tom)

Raised by the first real use (a personal bookshelf on tmz.it). All three are
generic — nothing in the model knows about books.

### F-1 — `byline`

`catalogueItem.byline`: optional `localizedString`, a short line shown under the
item's name wherever the item is presented (card, collection page, item page).
A book's author and year, a wine's producer, a treatment's practitioner. Plain
text: never parsed, never a structured author, never used for search or
structured-data typing. Missing translation falls back like other editorial
text; it is not part of the D-7 localized-address rule.

### F-2 — `links[]`

`catalogueItem.links`: optional ordered array of `{ _key, label: localizedString,
url: url }` (http/https only, validated; `mailto:`/`tel:` not in V1). Shown on the
item page and, as a compact link, on cards. External links follow the platform
new-tab rule in `src/lib/links/link-target.ts`; never server-render an embed from
them. A link whose label is missing in the request locale falls back to the
default-locale label (it is editorial text, not a routable address). Links are
not offers and carry no price; `Offer.url` remains out of V1.

### F-3 — An item page without an offer emits no `Product`

A `Product` with no `offers`, `review` or `aggregateRating` is flagged as
invalid by search engines. When an item's page has no applicable offer,
`catalogueItemJsonLd` emits **no item node** (returns null). Collection pages
are unaffected: an `ItemList` of named, linked entries is valid without offers,
and a `menu` still emits `MenuItem` entries (B1). `Service` is unaffected — it
needs no offer to be valid and is still emitted.

---

## Amendment G — pre-release integration (landing-page template, navigation targets) (2026-10-14)

Two gaps found while integrating V1 end to end. Neither adds a capability; both
make existing decisions reachable.

### G-1 — The landing page has a Studio template

Studio opens every module page with `${mod.id}PageProjectOwned`
(`sanity.config.ts` → `buildModulePageItem`); `cataloguePageProjectOwned` was
missing, so "Catalogue page" could not be created. It now exists (projectSlug +
empty sections, no lifecycle values: like every ADR-032 type its status is
derived, and a new page is a draft until published) and is hidden from the
global "+" menu like the other singleton pages. A guard test
(`src/lib/modules/__tests__/module-page-templates.test.ts`) requires a template
for **every** registered module that declares `platformContract.pageType`.

### G-2 — Navigation links reach the catalogue

The existing navigation link (`navigationLink`, internal) widens its one
reference, `pageRef`, to `page | cataloguePage | catalogueCollection |
catalogueItem` (same picker, same `scopedRef` project filter). No parallel link
system and no new `internalPage` value: the landing page is a document with a
lifecycle, so a reference — not a fixed route name — is what can carry it.

- **URL**: `/{segment}` for the landing page, `/{segment}/{slug[locale]}` for a
  collection or item, built by `catalogueNavPath()` and prefixed by the same
  `resolveNavLink` / `toPublicNavLink` path as pages (project segment, or none
  on the site's own host).
- **Omitted** (the ADR-021 nav rule for an unpublished page — hidden, never sent
  home) when the catalogue is not installed or is switched off; the target is not
  public (ADR-032 rule via `publicFilterForAnyType`); it belongs to another
  project; a collection/item has no `hasPage` or no slug **in the request
  locale** (C6, D-7 — never another locale's slug); the landing page is not public.
- **Visibility**: a navigation link is an editor's explicit choice, so it uses the
  `explicitReference` context (C5) — an unlisted item may be linked; it stays
  `noindex`.
- **Delivery**: one shared GROQ fragment, `NAV_LINK_FIELDS`, now used by header
  links (and their children), footer links, footer columns and the footer credit.
  `pageSlug` dereferences `pageRef` only when it is a `page`; catalogue targets are
  read through a project-scoped subquery that carries the lifecycle rule. The
  public-delivery coverage test checks every `^.pageRef._ref` subquery.
- **Side effect, intended**: header links previously used an inline copy without
  `hasPageRef`, so a header link to an unpublished page pointed at the home page
  while the same footer link was hidden. Both now hide it (ADR-021).
- **Not changed**: page links keep their default-locale slug fallback; body links
  in rich text (`src/lib/links/link-target.ts`) have their own resolver and do not
  target the catalogue in V1.

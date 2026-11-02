# Catalogue module — V2 specification

**Status:** v2 — Accepted with the step-2 contracts (Tom, 2026-11-02; final consistency review `contracts/REVIEW-step3-final-consistency.md` applied). Nothing implemented. Where this spec and a contract differ, the contract wins.
**Date:** 2026-11-02
**Purpose:** the "what it looks like and how it behaves" companion to the accepted contracts. It describes concepts, surfaces and behaviour; it does **not** restate type definitions or algorithms — it points to the contract section that owns them.
**Authority (highest first):** `contracts/DECISIONS-step2-final-2026-11-02.md` (D-1 … D-21) → ADR-033 Amendment K (K-1 … K-13) → ADR-042 (navigation foundation) → the three contracts (C2-C5-C10, C1-C7-C11, C6-C8-C9-C12; C13 lives in the last) → the redesign brief (2026-11-02) → V1 spec. Where two differ, the higher one wins and the lower one is corrected.
**Also governed by:** ADR-014 (one configuration surface), ADR-028 (roles), ADR-029/030 (tenant dashboard, shared App layer), ADR-032 (lifecycle), the Multilingual-First Principle, the Component Lab rule, English Title Case for navigation labels.
**Supersedes:** `catalogue-module-v1-spec.md` wherever they differ (see §14 for the map). The V1 spec stays as the record of what exists today until each slice ships.

### Brief sections superseded or amended (read the brief with this table)

| Brief § | Status | Replaced by |
|---|---|---|
| 4.1 / 4.2 navigation | Adopted, detail moved | ADR-042; §9 below |
| 4.3 Setup sections | Adopted; Categories & Tags is the normal editing area, plus inline creation from the item through the same taxonomy service | K-4, D-3; §10 |
| **13.1 / 13.2 pricing semantics** | **Superseded** — "no effective availability = not sold even with a default price", "no applicable offer = not sold in that context", "default offer is a fallback only where available" in its old form | K-3 rules 1–15, D-4, D-6; C4, C5, C5a; §6 |
| 15 single-item creation | Amended (primary category mandatory on publish, formats/prices/channels split, contextual setup) | §11 |
| 6.2 / 7 packs "applied once" | Amended — additive, usable after installation | K-6, C7; §12 |
| **24 permissions (publish / schedule / bulk publish)** | **Superseded** — no publish capability | K-5, C8; §16 |
| 25 conceptual data model (`catalogueSettings`, `defaultChannelsForNewItems`) | Superseded — module config + three documents; no `defaultChannelsForNewItems` | D-1, D-5; §5 |
| 27 migration | Amended — equivalence of public outcomes, staging rehearsal | D-7, D-10, D-11, C10; §18 |
| 29 AC-07 / AC-16 | Amended | §21 |
| **29 AC-16 and 34 "Studio parity" definition of done** | **Superseded** | K-7, C9; §15 |
| 14 / 20 allergens | Extended | D-16, C13; §14 |

---

## 1. Purpose and scope

Catalogue is a business-neutral module for publishing and organising what a business offers — dishes and drinks, books, products, services. A manager configures the business, adds several items, organises them, sees what is missing, previews and publishes without technical knowledge. Experienced teams manage categories, formats, prices, channels, options, compliance, imports, exports and large catalogues. The complexity lives in the system (K-10).

V2 adds to V1 (V1 §1):

1. A top-level **Catalogue** sidebar group: Items · Collections · Options · Setup (ADR-042).
2. **Setup**, the single place for structure and policy.
3. Hierarchical **categories** with a primary category per item, and flat **tags**.
4. First-class **formats** (glass, bottle, paperback, 500 ml).
5. **Price and availability as separate questions**, with weekly availability schedules (D-6).
6. **Packs** (starter structures), usable after installation.
7. **Readiness** by publication context and tenant publication standards.
8. Allergen review evidence (C13).
9. Studio demoted to inspection; the dashboard is the editor (K-7).

Later slices (specified here as intent, contracts pending where noted): bulk operations, automatic listings, import/export, PDF menus, media compliance, full-page draft preview (§19).

Not Catalogue, ever in this module: cart, checkout, payments, order transmission, kitchen tickets, delivery dispatch, ingredient inventory, supplier management, nutrition calculation (brief §3).

Multilingual first: every visitor-facing string is localized with normal locale fallback; the dashboard speaks en / it / de from the interface dictionaries (`catalogue.*`). Navigation labels are English Title Case. All times are 24-hour (07:00–11:00, 18:00–23:00), in the project time zone.

---

## 2. Architecture placement

Unchanged from V1 §2 (module + `catalogueListingSection` + `cataloguePage` + opt-in item and collection routes under one configurable segment, `dataStore.primary: 'content'`). Additions:

- **One implementation per concept** (K-9): category tree (C1), channel set (C2), format rules (C3), price resolution (C4), availability resolution and schedules (C5, C5a), readiness evaluation (C6), capability mapping (C8), audit events (C12), allergen review (C13). Pure services under `src/lib/modules/catalogue/`; dashboard, website, Studio and import call them; none reimplements them.
- **Single server publication gate** (`cataloguePrepare` extended, C6 §6.7). Studio is not a gate (§15).
- **Single rollout plan** for every data change: C10-6. No other contract has its own order.

---

## 3. Module manifest

Changes to V1 §3 (details in the owning contracts):

- Permission ids: five new, one narrowed (§16, C8 §8.2). No `catalogue.*.publish` id (K-5).
- Dashboard surfaces: `nav` entry becomes a group with four sub-destinations (ADR-042 N2, N6); declared once in `src/lib/client/surfaces.ts` and the manifest.
- Dashboard label is fixed "Catalogue" (K-2); `navLabel` is removed after migration (C11.5).
- Module config schema gains `publicName`, `formatTemplates`, `setupCompletedAt`, `setupSource`, channel attributes, `catalogueMigrations` (hidden). See §5.
- Pack registry replaces the preset registry (C7); `applied-preset-guard` generalises to `applied-pack-guard` (C7.9).

---

## 4. Data model (concept level)

Types, fields and invariants are in the contracts; this section only fixes the vocabulary.

| Concept | One-line meaning | Owner |
|---|---|---|
| Item | What is offered. Carries a profile (Food or Drink · Book · Other Product · Service), name, description, images, a **primary category** plus additional categories, tags, formats, option attachments, allergen declaration, optional own page, lifecycle and visibility | V1 §4.1; C1, C3 |
| Format | Sellable form of an item (Glass 25 cl, Paperback). Has a stable key, order, optional identifiers, prices and an optional availability rule. An item with no visible choice has one implicit format (no explicit override possible) | C3 |
| Price | Standard price per format, or a channel-specific price overriding it on that channel only, optionally with weekly price windows. Never decides availability | C4 |
| Channel | How an item is obtained (dine-in, takeaway, delivery, room service, shipped…). Active/inactive, ordered, localized, with a project **default availability** | C2 |
| Availability rule | Baseline state plus optional weekly scheduled overrides, per channel, at project default / category / item / format scope | C5, C5a |
| Category | Hierarchical, localized, ordered; carries availability rules; stable immutable key. Belongs to the Catalogue taxonomy | C1 |
| Tag | Flat localized descriptor; never a publication blocker; not an allergen or dietary declaration | C1 |
| Collection / section | Presentation and placement only. Never determines availability | V1 §4.5; D-6.2 |
| Option list / choice | Customisation and extras; no cart or order | V1 §4.4 |
| Pack | Additive starter structure; history kept as installation record | C7 |
| Publication standard | Tenant rules layered on the built-in default, versioned | C6 §6.8 |
| Allergen review | Attestation with reviewer, basis, timestamp, reset rules | C13 |
| Audit event | Project-level record of structural and compliance actions | C12 |

Separations the model preserves (brief §2.3): item profile (which fields) · category (what is it) · tag (descriptor) · collection (where presented) · channel (how offered) · format (which form) · option (how customised). Classification never changes by placement.

Legacy shapes (`offers[]`, flat `categories[]`, `config.categories`, `navLabel`, `appliedPreset`) are read by dual-readers until R3 (C10-6).

---

## 5. Configuration

Three places, by rule (D-1; ADR-014: one editing surface, which is Catalogue → Setup).

**Module configuration** (`project.moduleInstallations[catalogue].config`) — short settings only: `currency` (never written by a pack), `publicSegment` (+ history), `publicName` (localized), `defaultItemProfile`, `serviceChannels[]` (key, localized label, order, active, default availability and schedule — C2), `formatTemplates[]` (C3-6), `dietaryTags[]` (controlled dietary vocabulary, not a tag set), `setupCompletedAt`, `setupSource` (`empty | pack | manual`, D-14), hidden `catalogueMigrations` markers. Limit 12 channels.

**Project documents** (one each per project):

| Document | Holds | Contract |
|---|---|---|
| Catalogue taxonomy | categories and tags as arrays; revision-guarded atomic tree operations; limits 300 categories, 200 tags | C1 (D-2) |
| Pack history | applied packs: id, version, when, by whom, keys added | C7 |
| Publication standards | tenant standards, ordered, versioned | C6 §6.8, §6.12 |

**Rules of the split**
- The item editor may read **whether** setup was completed (`setupCompletedAt`), never which pack or `setupSource`. Only Setup reads pack history (guard test, C7.9).
- Studio shows module config and these documents read-only (§15).
- No second editable surface for any of it; a test asserts that nothing but Setup writes Catalogue terms, with the single named exception of inline category creation, which calls the same taxonomy service (K-4 as amended, D-3).
- Channel deletion needs a counted, previewed, audited cleanup (D-21).

### 5.1 Public name and segment

- The **public name** (Menu, Books, Wine List…) is content localization for the website, never for the dashboard (K-2). Edited in Setup → Public Website. Resolution and fallback: C11.3 (locale → default locale → nothing; never the word "Catalogue").
- Approved public uses (D-12): landing-page title fallback after any existing `seoTitle` / `heroTitle` (tmz keeps "Between the Lines"); `llms.txt` heading per language block (tmz becomes "Books / Libri / Bücher"). Breadcrumbs and structured-data names are not yet approved (C11.4 rows 4–5).
- The public segment behaves as V1 §6.1 (validated against reserved routes and history; every historic segment 301s). A pack may suggest a segment only when none is set; the module installation asks for it (D-13).

---

## 6. Public pages and website behaviour (V1 §6, amended)

Route, segment, shared slug namespace, sitemap, hreflang and localization rules are unchanged (V1 §6.1–6.5, §7). What changes:

### 6.1 Presence = lifecycle + visibility (D-4)

Whether an item or collection appears on the general website is decided **only** by lifecycle and visibility. Channel availability decides where it can be obtained, which prices apply and which availability labels are shown. An item unavailable through every active channel still appears on the website and keeps its informational page. Hiding such items may arrive later as an explicit, opt-in website rule — never as a consequence of availability.

### 6.2 No channels configured (K-3 rule 7)

The item is shown with its standard price in the general context. Availability controls are hidden everywhere. Channels are optional; a business-neutral installation has none (C2-6).

### 6.3 Schedules are shown, never hide (D-6.3)

- An item page stays reachable at every hour. It may show its weekly schedule in plain language ("Served 07:00–11:00", "Dinner 18:00–23:00; not on Sundays") per channel.
- A live label "Available now" / "Available at this time" is shown only when evaluated with an explicit instant and the project time zone, and only while the result is guaranteed fresh. Otherwise the schedule is shown and no "now" claim is made. Missing time zone ⇒ schedule only. Cache and refresh obligations: C5a-4 (the invariant, `validUntil`, the `scheduleOnly` form).
- Automatic listings (later slice) keep a real "available now / at this time" filter — availability, not "priced now" — and must pass the boundary test (`listing-availability-boundary.test.ts`: a listing flips at the scheduled instant without waiting for a long page-cache expiry).
- **Structured data is unchanged and carries no schedule.** Every displayed price stays an `Offer` with `InStock`; nothing in JSON-LD depends on the instant (C5a-5).

### 6.4 Prices on the page

- One price: "€12.00". Several formats: one row per format with its price. A channel-specific price appears on that channel's view only; elsewhere the standard price shows.
- **Missing price never means unavailable**, and a price never makes an item available. An available item without an applicable price shows without a price (priced-on-request is legitimate for services and books) and carries a readiness note in the dashboard.
- Price windows choose which price applies at an instant; outside a channel price window the standard price applies. Overnight windows supported; ambiguity (two prices at one precedence and instant) is an error, never a pick (C4).
- Currency always comes from project configuration.

### 6.5 Landing page and titles

Landing-page title: `seoTitle` → `heroTitle` → public name → site name (C11.4 row 1). Collection and item titles are unchanged. `llms.txt` per C11.4 row 6. With no public name, output is byte-for-byte what it is today (test `website-output.unchanged`).

### 6.6 Languages

A page exists only in languages where the name is written; unchanged (V1 §7). Missing-translation readiness is checked for public locales only and never penalises a newly added locale at once (D-21).

---

## 7. Localization

V1 §7 stands. Additions: category, tag, channel, format, section, pack-provided and public-name labels are localized strings; stable keys are never localized; price amounts, schedules, `min`/`max`, keys and identifiers are not. Packs ship en / it / de for top-level labels at least (C7.10). Machine translation (ADR-023) may fill drafts; no website query projects `translationStatus`.

---

## 8. Lifecycle

V1 §9 stands (ADR-032: derived status, archive vs permanent delete, weak draft references strengthened on publish, `publishTogether` for item/collection with dependencies). V2 additions:

- **Primary category** mandatory when publishing a new version of an item. Existing public items are never silently unpublished (D-15). Legacy multi-category drafts take the first existing category as primary.
- **Re-exposure** (back online, restore, date changes) re-runs only the safety subset: allergen review; option-choice allergen review; valid declaration shape; dangling or unresolved references. Image, description and placement requirements are not re-run (D-15; C6 §6.7.2).
- **Bulk publish**: the same gate per row; ready rows publish, blocked rows are listed with every blocker; optional all-or-nothing mode via `publishManyTogether` — validate everything first, one transaction or nothing, 100-document cap, payload estimated before attempting, clear refusal when too large; larger sets use reviewed batches never described as atomic (D-19; C6 §6.11). Bulk slice only.
- A category referenced anywhere is not deletable by an Editor (§10.3).

---

## 9. Client dashboard

### 9.1 Navigation (ADR-042)

Sidebar: **Home**, then groups Content · **Catalogue** · Visitors · Library · Insights · Project, then the bottom block (Support · What's New · More You Can Add). Empty groups are not shown.

**Catalogue group:** Items · Collections · Options · Setup — real, deep-linkable routes, each with its own permission.

| Behaviour | Spec |
|---|---|
| Default | `/catalogue` redirects to Catalogue → Items |
| Expanded sidebar | the group heading opens/closes its destinations (disclosure, not a link); the group holding the current page opens automatically |
| Rail mode (collapsed sidebar) | icon rail with accessible tooltips (also on keyboard focus); activating Catalogue opens a flyout of its destinations |
| Active state | nested routes light the parent: item editor and new-item flow → Items; collection routes → Collections; option routes → Options |
| Memory | collapsed/expanded and each group's open state are per user, per layout (desktop and tablet independently), stored server-side with a client cache (no first-paint flash) |
| First use | desktop expanded; tablet collapsed to the rail; phone drawer, no permanent rail |
| Phone | the existing drawer (from the right) and bottom tab bar use the same groups; the "Content" bottom sheet is rebuilt from the groups |
| Badges | stay visible on a collapsed group (aggregated on the header) |

The Items / Collections / Option Lists `SegmentedControl` tabs are removed when the four destinations ship (K-1). Navigation is its own platform slice, delivered after the billing work touching the shared sidebar has landed (ADR-042 §5).

### 9.2 Who sees what (C8)

| Destination | Visible with |
|---|---|
| Items, Collections, Options | `catalogue.item.read` (Collections/Options by their own read rules as today) |
| Setup (entry) | any Setup section visible to the person |
| Setup → Categories & Tags | `catalogue.setup.manage` **or** `catalogue.taxonomy.write` |
| Setup → Import and Export | `catalogue.setup.manage` only (import configuration, mappings, history). Editors with `catalogue.export.use` export from the Items list actions ("Export", "Print menu") and the item editor, not from Setup (ADR-042 N2a). |
| every other Setup section | `catalogue.setup.manage` |

A person with only `taxonomy.write` sees Setup → Categories & Tags and only the operations their permission allows; structure and rule controls are shown disabled with the reason. A direct link without the needed permission is refused like any other permission failure (fail closed; refusals name the capability and leak nothing — C8 §8.6).

### 9.3 Items

Default destination. Table-only list with search, filters, "To Complete" readiness chips (§13), and selection for bulk actions (later slice). Columns: name, profile, primary category (full path), status, readiness summary. Phone: cards with the same facts. Row opens the editor. Actions: New Item, Add Several (bulk creation slice), Preview (draft preview slice).

Item editor: tabs Content · Prices · Channels · Options · Details (allergens/dietary) · Page · Languages · Activity, as V1 §10 with these changes:
- **Category** picker shows full paths ("Food › Pizza › Bianche"), search or browse, one marked primary; creating a category inline requires choosing a parent and shows the complete path (D-3).
- **Prices** tab edits formats (one implicit format hidden until "Add Another Size Or Format") with the standard price and, expandably, different prices per channel and optional price windows.
- **Channels** tab appears only when active channels exist. Each channel shows the effective state and its source ("Unavailable for this item — category default: Available, from Food › Pizza") with "Use Category Default"; item and format rules replace, never merge (§6 of C5; D-6.1). The weekly schedule editor shows the same source line.
- **Activity** merges lifecycle and compliance events (C12 §12.5).

### 9.4 Collections

Builder as V1 §10.4, with drag-and-drop everywhere ordering applies (categories, sections, items in a section, options, formats) and keyboard parity (move up/down with announcements). Collections never carry availability. Display scheduling of a collection is out of scope (§22).

### 9.5 Options

Option lists as V1 §4.4 (own destination, no longer a tab). Linked choices inherit the linked item's declaration; the picker requires the linked item to have at least one price ("This item needs at least one price before it can be used as a linked choice."); an item priced but unavailable on a channel still qualifies (D-21; internal result `hasPrice`).

### 9.6 UI states and responsiveness

States as V1 §10.5 (loading, empty, error, saved) with Component Lab components. Desktop: sidebar + wide tables; tablet: rail by default, tables with fewer columns; phone: drawer navigation, card lists, editors as full-screen steps, sticky actions, 44px targets. Dark and light verified; reduced motion honoured.

### 9.7 Home

Catalogue glance widget shows counts only (items, drafts, to-complete) and links to Items with the chip applied.

---

## 10. Catalogue Setup

Setup is where structure and policy live (brief §4.3; C8 §8.3a). One page per section; permissions per section as §9.2. Sections, in order:

### 10.1 Overview
Setup completion status; counts (items, categories, channels); applied-pack update offers; the **Activity** list (table-only) of structural and compliance events visible to `setup.manage` (C12 §12.5); a notice while an Abluo break-glass grant is active (§15).

### 10.2 Starter Structures
The seven packs (§12): choose, preview in full, apply; "Start Empty". Update offers for newer pack versions with a diff.

### 10.3 Categories & Tags
(C8 ids `categories` and `tags`; brief §4.3 lists them separately — one navigation entry with two panels or two entries is a review point.)
- Tree view with usage counts; search by label and full path; drag within and between parents; keyboard move controls.
- **Editor operations** (`taxonomy.write`): create, rename, translate, reorder siblings, delete an **unused leaf**, manage tags.
- **Setup operations** (`setup.manage`): move between parents, reassign items on delete, delete a category in use, edit category availability rules and schedules, apply packs.
- *Unused* (D-3): no assigned items (drafts included), no children, no automatic-listing references, no publication-standard or availability-policy references outside the category, no other stored reference that deletion would break. Otherwise deletion shows a counted, previewed reassignment or cleanup operation naming each blocker.
- Changing a category's availability rule shows the **impact** first: how many items and formats change, with a preview; explicit item/format overrides are preserved; confirmation required; recorded in the audit (C5-6, `category.rule_changed`).
- Concurrent edits are guarded by revision; a conflict explains what changed and offers a retry (C1.7a).
- Tags are flat, optional, never publication blockers, never allergens.

### 10.4 Service Channels
Activate/deactivate, label per language, order, default availability and optional weekly default schedule. Packs may suggest channels (dine-in, takeaway, delivery, room service); nothing is activated silently. Before activation or a default change: affected counts and preview (K-3; brief §11.4). Deactivation hides the channel from editors but keeps data; deletion needs a counted, previewed, audited cleanup (C2-5). Channel keys are stable and not renamed. Limit 12.

### 10.5 Pricing And Availability
Project defaults: currency (changed only through the existing currency flow, D7), time zone display (read from project; required for any schedule or price window — missing time zone is a visible setup error), format templates (suggested sizes for new items), default for "price recommended on website" is a publication standard (§13), not here.

### 10.6 Item Defaults
Default item profile (a pack supplies a suggestion; never restricts later profiles), the dietary-declaration vocabulary, option groups attached by default to new items in a category (explicit once attached).

### 10.7 Publication Standards
View the built-in default standard; add tenant rules (field present, text length, image present, placement, translation, collection coverage) scoped by context, profile, category subtree, collection or channel (§13). A change increments the standard version and expires dependent overrides.

### 10.8 Public Website
Public name (per language), public segment (with history and validation), landing-page defaults, affiliate disclosure (existing). Time zone is shown, edited in Settings.

### 10.9 Import And Export
Later slices: entry points to import (CSV/XLSX/pasted), data export, PDF menus, allergen register (§19, §20).

Setup copy is calm and non-technical: no key names, no JSON; stable keys are never shown to editors.

---

## 11. Item creation flow (brief §15, as amended)

One decision per screen, cards not dropdowns, autosave with a Saved pill, sticky Back/Next, 44px targets, reduced motion honoured (content-wizard spec). Phone and desktop share the same steps; desktop adds a live summary.

| # | Step | Notes |
|---|---|---|
| 1 | **What Are You Adding?** Food Or Drink · Book · Other Product · Service | Preselected from the default item profile (pack-suggested), always changeable. "A product" is renamed "Other Product". Changing into Food Or Drink later resets allergen review to Not Reviewed |
| 1a | Contextual setup (only for Food Or Drink when setup was never completed) | Large modal / focused flow built from the Setup components, opened in context, returning to the same draft with the profile still selected. Choices: Set Up Now · Start Empty · Save And Exit (records nothing). Steps: starter → channels → review proposed structure → availability by category → review and create (§12). Abandoning keeps the draft |
| 2 | **Name** | Required; optional byline and description; other languages later |
| 3 | **Categories** | Search or browse by full path; mark one **primary** (required to publish, not to save a draft); additional categories optional and inert for availability; inline "Add Category" with parent choice (needs `taxonomy.write`) |
| 4 | **Placement** | Optional: collection and section |
| 5 | **Formats, Channels And Prices** | Simple first: "Price €12.00". Expand: "Add Another Size Or Format"; "Available through" channels (only if channels are active; defaults inherited, explicit override only when the user changes one); different price per channel. A price never activates a channel |
| 6 | **Food Information** | Food Or Drink only; allergen declaration (Contains / May contain / none declared with explicit confirmation), dietary; not skippable for publication — the review is a separate attestation (needs `catalogue.allergen.update`) |
| 7 | Save Draft · Publish · Schedule | Publish runs the website readiness context |

Optional, never mandatory: description, photo, other languages, own page, options. After saving: **Add Another · Preview Product · Open Full Editor · Return To Items**.

Readiness appears inline as Required and Recommended lists with a focus link to each gap, and the contexts are separate ("Own Website: Ready · Takeaway Menu: Ready · Delivery Marketplace: Blocked — image missing").

Phone: one question per screen with sticky actions. Tablet: single column wizard with a side summary in landscape.

---

## 12. Packs (starter structures)

Contract: C7. Principles (K-6):

- A pack is an **additive** declaration: it may add missing categories, tags, collections, sections, formats, options and suggested settings; it may be previewed completely; it identifies conflicts and equivalents; it applies once per pack version; everything stays editable. It never overwrites tenant changes, deletes or replaces structures, resets the Catalogue, changes the currency, or silently renames or reorganises.
- Pack identity and equivalence are by **stable key**. Localized-label matches are shown only as proposals for the person to confirm — never auto-merged.
- Application is transactional and retry-safe: recorded as applied only after complete success; an interrupted run leaves no "applied" record and a retry never duplicates (C7.5).
- A newer version is an optional update with a diff; elements the tenant removed are not re-added; elements dropped from the pack are kept (C7.6).
- Sample content is never part of a pack. Requires `catalogue.setup.manage`.

### 12.1 The seven packs

| Pack | Intent | Suggested default profile |
|---|---|---|
| Pizzeria | Pizza-led restaurant, take-away and delivery likely | Food Or Drink |
| Traditional Restaurant | Starters, mains, desserts, drinks | Food Or Drink |
| Fine Dining | Tasting menus, wine pairing | Food Or Drink |
| Café And Bar | Coffee, breakfast, aperitivo, drinks | Food Or Drink |
| Wine Bar | Wines by kind, small plates; glass and bottle are **formats** | Food Or Drink |
| **Empty** | Seeds **nothing**; applying it only records that setup was completed intentionally | Unchanged |
| Bookshop | Existing; future default profile Book | Book |

Outlines (categories, tags, collections, formats, option groups, channel suggestions, publication suggestions) are in C7.10 and are not final copy. Each pack suggests, never forces, channels (stable keys such as `dine-in`, `takeaway`, `delivery`, `room-service`), category availability rules for accepted channels only, and optionally a "price required on the website for food" standard the tenant may accept or review (D-8). Launch packs all carry the same version.

### 12.2 Preview and apply

Preview shows the exact plan — Add / Equivalent / Conflict / Skip — with counts ("2 channels, 14 categories, 1 menu, 7 sections, 3 option groups"), the current currency read-only, and blocking conflicts (segment clash, slug collision) to resolve. The person can untick elements. Apply is one confirmation; the result summary links to what was created. Created collections and option lists are drafts.

### 12.3 Setup completion (D-14)

Starting empty, applying a pack, or deliberately marking setup complete each satisfy "setup completed". The item editor reads only that fact.

### 12.4 Existing data

tmz's `bookshop v1` record becomes pack history; the newer Bookshop pack is offered as an optional non-destructive update; tmz's existing profile is not changed (D-13).

---

## 13. Readiness and publication standards

Contract: C6. Readiness is the single engine behind the editor, the Items list chips, bulk publish, imports, exports and the server gate.

### 13.1 Contexts
`website` · `channel:<key>` · `export:<profile>` · `print:<template>` · `marketplace:<connection>@<policy>`. **A requirement blocks only its scoped action** (D-9): a marketplace-image failure blocks that marketplace export, never the website or availability; a channel failure blocks nothing automatically and gates only explicit channel actions. Only `website` runs inside the publication gate.

### 13.2 Required and recommended
- **Required** blocks the scoped action. **Recommended** warns.
- Built-in website defaults: Required — profile, name, valid prices, category with a **primary** category, allergen review for food (item and free-text choices), publishable dependencies, valid page address, valid availability schedule. Recommended — photo, description, placement, translations, price (see 13.3).
- Findings are reported separately as Required and Recommended with a fix link to the exact field or Setup surface.

### 13.3 Price (D-8)
Website: recommended warning by default. Required for channel delivery, priced export, PDF and marketplace output. Restaurant packs may propose "price required on the website for food"; the tenant reviews that standard. A missing price never changes availability.

### 13.4 Availability is not a readiness problem
"Currently unavailable by schedule" is never a finding; readiness takes no instant. Price rules apply to formats that are available at some time of the week. Only an **invalid schedule** (overlap, bad time, incomplete, zero length) is a required finding.

### 13.5 Override (D-17)
Only Owner and Site admin may override a recommended warning; who, when and why (reason required) are recorded; an override expires when the underlying meaning changes, not on any edit; required findings and non-overridable recommendations are never overridable.

### 13.6 Standards
Tenant standards add rules or raise recommended to required; they cannot lower a built-in required rule. Scopes: project website, profile, primary-category subtree, collection, channel, export profile, marketplace. External policies are versioned metadata, never described as a guarantee of acceptance.

### 13.7 Overview and chips
"To Complete" chips (needs allergen review, no photo, no description, no category, no primary category, no placement, missing dependency, missing translation, no price, channel policy failure, image policy failure) filter the Items list; a chip count equals its filtered list by construction. Counts include drafts and show Ready / Not Yet (D-21).

### 13.8 Gate coverage
The server gate runs on every path that makes a version public: publish, schedule, back online, restore, date changes (with the D-15 safety subset for re-exposure).

---

## 14. Allergens and compliance

Contract: C13 (with C6 and C12). Abluo enforces the process and preserves evidence; the food-business operator remains responsible.

- Food cannot publish while Not Reviewed; Contains and May contain are separate; "none declared" needs explicit confirmation; free-text add choices need review; linked choices inherit the linked item's declaration; remove choices never subtract base allergens.
- A review records reviewer, basis (recipe · supplier label · technical sheet · risk assessment · other), timestamp. Reviewing needs `catalogue.allergen.update` (Owner, Site admin, Editor; never in support mode).
- **Resets** to Not Reviewed when: the profile changes to Food Or Drink; an option list is attached or replaced; a free-text add choice is added or materially edited; a choice changes from remove to add; a linked choice changes target; a linked item's declaration or relevant food profile changes; Contains / May contain / none-declared status or content changes outside the review action; future recipe, ingredient, supplier or technical-sheet data used as the basis changes.
- **Does not reset** for name, description, price, images, categories, placement, translation-only edits. Removing an option or detaching a list does not reset but is audited.
- Reviewing does not invalidate itself: the review service is distinguished from uncontrolled edits.
- **Linked items:** editing the linked item's draft changes nothing live. When its declaration becomes effective by publication, dependents are invalidated; published parents stay online and keep resolving the linked item's current allergens; each affected parent gets a draft/review task marked Not Reviewed, shown clearly in the dashboard, and its next publication is blocked until renewed sign-off. A parent without a draft gets one created solely to carry the task, labelled a **system-created compliance task**. Nothing is silently unpublished.
- Retention: 5 years platform default; longer allergen retention is decided by legal/privacy review before the first production evidence record; no hard-coded duration (D-20).
- Later: printable register (PDF/CSV) with version and generation date; review reminders.

---

## 15. Studio posture (K-7, D-18; C9)

- The dashboard is the editor for all Catalogue work. **Catalogue documents are read-only in Studio** (items, collections, option lists, pages, taxonomy, pack history, standards); Catalogue module configuration is read-only in the Modules pane once Setup exists. Studio remains for inspection and diagnosis by Abluo super administrators.
- **No parity requirement:** no wizard, warnings or conveniences are rebuilt in Studio. *This replaces brief §29 AC-16 and §34 "dashboard and Studio enforce matching rules".* The definition of done is: the shared server rules are the only publication gate; Studio is read-only or enforces the critical set under break-glass.
- **Break-glass:** explicit, super-admin only, aal2, time-limited (max 4 h), reason recorded, logged, visibly marked in Studio and (as "The Abluo team maintained Catalogue data") in the client dashboard. Publishing under break-glass goes through the same gate; critical rules (referential integrity, allergen review, dependencies, price/availability validity, publication blockers) are enforced at publish on the server.
- Read-only Studio is a UI control, not a security boundary (D-18). Compensating controls: restricted seats and tokens, a detective webhook, daily reconciliation, and audit events for writes outside the authorised gate.
- ADR-032 D14 is documented as "designed, not implemented" until implemented.
- Support mode never reviews allergens or exports (§16).

---

## 16. Permissions

Contract: C8. Editing includes publishing (K-5, ADR-032 D5): no publish, schedule or bulk-publish capability. *This replaces brief §24 on those points.*

| Capability | Covers | Default roles |
|---|---|---|
| `catalogue.item.read` / `.write` / `.delete` / `.deletePublished` | items, option lists; unchanged | read: Owner, Site admin, Editor, Viewer; write/delete: Owner, Site admin, Editor; deletePublished: Owner, Site admin |
| `catalogue.collection.write` / `.delete` / `.deletePublished` | collections, landing page; unchanged | as above |
| `catalogue.taxonomy.write` (narrowed) | create inline, rename, translate, reorder siblings, delete unused leaf, manage tags | Owner, Site admin, Editor |
| `catalogue.setup.manage` (new) | packs, channels and defaults and schedules, category structure and availability rules, standards, defaults, currency, public website | Owner, Site admin |
| `catalogue.import.use` (new) | start, confirm, undo imports; also needs `item.write` | Owner, Site admin |
| `catalogue.export.use` (new) | data export, PDF menus, allergen register; also needs `item.read` | Owner, Site admin, Editor; never in support mode |
| `catalogue.allergen.update` (new) | mark a declaration reviewed; declaration content edits need it too | Owner, Site admin, Editor; never in support mode |
| `catalogue.readiness.update` (new) | override a recommended warning | Owner, Site admin |

Multi-document actions check every capability for the whole plan, then every target, before the first write; refusals name the capability only. Module permissions are not individually grantable extras today (ADR-028); separating "kitchen reviews" from "website editor" needs an ADR-028 amendment, outside this redesign.

---

## 17. Audit

Contract: C12. A dedicated Catalogue audit store (reserved migration `061_catalogue_audit_log`) records, without sensitive content: pack applied/updated/interrupted; category rule changed and restructured (with impact counts); channel activated, deactivated, removed, default changed; availability schedule changed; standards changed; allergen reviewed, invalidated, linked-invalidated, dependency removed; compliance task created; readiness override recorded/expired; imports, bulk actions, export snapshots (later); public name migrated; commerce/taxonomy/pack-history migrations; break-glass and writes outside the gate.

Visibility: item-scoped allergen, readiness and schedule events appear in the item's Activity (anyone with `item.read`); project-level events in Setup → Overview → Activity (`setup.manage`); staff see everything including refused and outside-gate events. Retention: 5 years platform default; refused/failed and outside-gate rows 12 months; allergen retention per §14.

---

## 18. Migration and rollout

Contract: C10 (mapping, equivalence, rollback); the single ordered plan is **C10-6**. This spec does not repeat the steps.

Summary of the guarantees (K-3, D-7, D-10, D-11):
- No stored shape changes until a reader accepting both shapes runs in production. Order: readers first; export production data; rehearse the **complete** migration on `staging`; produce equivalence and migration reports; stop for approval; run production; keep the export as the rollback artefact. The rehearsal never writes to production.
- **Equivalence** compares old and new **public, visitor-visible outcomes** by item, context, channel and fixed instant; price-window gap cases are reported separately. Production today (16 items, all tmz, no channel-scoped offers) must show an empty diff.
- Channel projects migrate as project default *unavailable* plus explicit *available* rules for everything the old model considered sold. A migration never makes any item available through an additional channel.
- Public name: `navLabel` is copied to `publicName` when none exists, audited; the website keeps the name it shows today.
- Category and pack-history conversions are additive until the cleanup release R3.

---

## 19. Later slices (intent only)

Contracts for these are pending; they must reuse the pure services above.

- **Add Several and bulk operations:** spreadsheet-like entry creating drafts with per-row validation and duplicate flags; bulk edit, category and primary assignment, placement, channel override, price update, option attachment, archive, schedule and publish through the same gate (§8).
- **Full-page draft preview:** real public components, language and channel selection, desktop and phone widths, private, never publishes, never leaks.
- **Automatic listings:** rule trees (profile, primary or any category with descendants, tags, collection, channel availability, price range, format, dietary, lifecycle, **available now / at a given time**, dates, translation), pins, exclusions, limits, deterministic sorting; honour the cache contract (§6.3).
- **Media compliance:** deterministic image policies, human-confirmed checks, provenance and rights; versioned external templates.
- **Import / export:** CSV, XLSX, pasted cells, mapping, matching on stable ids (never name alone), preview, drafts by default, batch undo; data export; designed PDF menus with preview and snapshots; allergen register. Export is unavailable in support mode.

---

## 20. Validation

V1 §11 stands for item, collection, option-list and page validation. V2 adds, each as stable error codes owned by the contracts: channel (C2-7), format (C3-7), price (C4-7), availability and schedule (C5-10), taxonomy and category operations (C1), public name (C11.2), pack (C7.5). Write-side validation is strict; readers are tolerant of legacy shapes. Duplicate or conflicting rows are never resolved by picking a winner: unset plus a visible readiness error (D-21).

---

## 21. Acceptance criteria

Adapted from brief §29 to the decisions. Each slice must pass its criteria before release; slices follow K-9 (decisions → contracts → model and migration → navigation and Setup → parallel streams → integration).

**Slice N — Navigation foundation (ADR-042)**
- AC-01: groups, rail, flyout, drawer, per-user per-layout memory, first-use defaults, active state for nested routes; permission filtering fail-closed; one definition consumed by every surface.

**Slice M — Model, readers and migration**
- AC-18: old and new resolvers return the same public outcomes for all items/contexts/channels at fixed instants; production diff is empty; staging rehearsal precedes production; no item gains a channel; export retained.
- AC-19: public name preserved; `website-output.unchanged`; dashboard says "Catalogue".

**Slice S — Setup, categories, channels, packs**
- AC-02: all four profiles available to every tenant; "Other Product" label.
- AC-03: contextual setup opens in place, returns to the same draft; abandoning keeps it.
- AC-04: packs show an exact preview; blocking collisions; retry creates no duplicates; currency never written; no runtime branching on a pack; Empty seeds nothing and records completion; seven packs.
- AC-05: arbitrary depth; cycles refused; published items need a primary category; ancestor filters; editor vs Setup operation split exactly as D-3; "unused" per definition; inline creation uses the same service; concurrent edits handled; no other surface writes Catalogue terms.
- AC-06: precedence project default → primary-category path → item → format; additional categories inert; source always shown; impact preview before rule or channel change; overrides preserved.

**Slice P — Formats, prices, availability**
- AC-07: single simple price; several formats each priced; standard price never creates availability; channel prices override on that channel only; overnight windows; overlapping equal-precedence windows refused. **Availability schedules:** a restaurant can express breakfast 07:00–11:00, a lunch-only category, delivery only in the evening, a dish unavailable on Sundays, with the standard price unchanged; schedules replace rather than merge per channel ("Available" on an item means all week on that channel even if the category was 18:00–23:00); overlapping overrides at one scope are invalid; DST and overnight correct; explanation of result and source. **D-6 boundary test** passes: a listing changes at the scheduled instant without waiting for a long page-cache expiry; with no time zone or no freshness guarantee, the schedule is shown instead of "available now"; structured data carries no schedule; item page reachable at all hours.

**Slice R — Readiness and standards**
- AC-10: scoped blocking (D-9); recommended overridable only by Owner/Site admin with a reason and expiring on meaning change (D-17); item and aggregate counts consistent; chips reproduce counts; missing price per D-8; scheduled unavailability never a finding; re-exposure runs the safety subset only (D-15).

**Slice C — Item creation and bulk**
- AC-08: Add Several creates drafts with per-row validation and duplicate flags.
- AC-09: drag ordering everywhere listed, with keyboard parity and announcements.
- Item creation flow per §11 returns the user correctly in all exits.

**Slice A — Allergens**
- AC-13: gates intact; reset and no-reset lists exactly as D-16; reviewing does not self-invalidate; linked-item timing and system-created compliance task; reviewer, basis, timestamp recorded; register matches its snapshot (later).

**Cross-cutting**
- AC-16: permissions validated for every target before any write; refusals name the capability and leak nothing; support mode never reviews allergens or exports.
- AC-17 *(replaces Studio parity)*: Catalogue documents read-only in Studio; no undocumented write path; any break-glass path documented, logged, marked, and tested to run the gate.
- AC-11, 12, 14, 15 (media policy, preview, automatic listings, import/export) are specified when their slices get contracts; AC-14 includes the boundary test above.
- Definition of done per slice: TypeScript clean; suites pass (unrelated failures documented); en/it/de reviewed; light/dark × phone/tablet/desktop checked; keyboard and screen-reader names; V1/V2 docs and ADRs match; nothing described as guaranteed marketplace compliance.

---

## 22. Out of scope (this release)

- **Date-based availability exceptions** (date ranges, holidays, seasonal closures, one-off dates). The schedule shape is discriminated so they can be added later without migrating weekly rules (D-6.4).
- **Collection or section display schedules** — scheduling presentation is a separate capability (D-6.2).
- **Hiding unavailable items** on the website — a possible later explicit opt-in rule (D-4).
- Ordering, baskets, payments, kitchen tickets, delivery dispatch, inventory, ingredient/supplier management, nutrition calculation.
- Editions as formats (editions stay as they are, D-21); inventory-linked availability.
- Multi-location scoping; collection-level price overrides; partner API and webhooks.
- A platform approval/author workflow (a shared future capability, K-5).
- Individually grantable module permissions (ADR-028 amendment).
- Currency per offer; tenant-defined code in standards.
- Continuous sync with external systems.

---

## 23. Documents this spec depends on

Decisions: `contracts/DECISIONS-step2-final-2026-11-02.md`. Contracts: C1 (categories & tags), C2 (channels), C3 (formats), C4 (prices), C5 / C5a (availability and schedules), C6 (readiness), C7 (packs), C8 (permissions), C9 (Studio), C10 (migration and the single rollout plan), C11 (public name), C12 (audit), C13 (allergen evidence). ADRs: 033 (Amendment K), 042, 032, 028, 014. Brief: `catalogue-redesign-brief-2026-11-02.md`.

# Abluo Catalogue — Product and implementation brief

**Status:** Ready for design and technical planning
**Date:** 2 November 2026
**Source:** Tom, pasted into the Catalogue redesign chat on 2026-11-02. Recorded verbatim in substance for the agents and future sessions.
**Governed by:** `docs/architecture/ADR-033-amendment-K-catalogue-redesign.md` and `ADR-042-dashboard-navigation-foundation.md` — **where those differ from this brief, the ADRs win** (see Amendment K §K-12).

> Expected throughout: the redesigned Catalogue must work smoothly on desktop, tablet and mobile; respect Abluo's architecture, design system, accessibility, permissions, lifecycle rules, multilingual model and established components; reuse existing components and patterns; add new ones only for genuinely new capabilities.
>
> Goal: a Catalogue that feels exceptionally easy and dependable for everyday users while supporting complex businesses underneath. A new manager can configure the business, add several items, organise them, check what is missing, preview and publish confidently without technical knowledge. Experienced teams manage categories, formats, prices, sales channels, options, compliance, imports, exports and large catalogues efficiently. The complexity lives in the system, not the user's workflow.

---

## 1. Executive summary

Business-neutral module for publishing and organising food, drinks, books, physical goods and services. The current foundation supports items, collections, option lists, lifecycle, public delivery, multilingual content, allergens and structured data. The redesign makes it fast and intuitive for a restaurant manager without turning it into a restaurant-only product. It introduces: a first-class Catalogue area in navigation; contextual first-time setup for food and drink; restaurant starter structures; hierarchical, multi-assignment categories; explicit service-channel availability with inherited rules and item overrides; first-class formats (glass, bottle, paperback, 500 ml); channel- and time-specific prices; compact single-item creation and spreadsheet-like bulk creation; full-page draft preview; drag-and-drop ordering throughout; contextual publication standards and readiness reporting; image requirements, rights and provenance; bulk edit, schedule and publish; complete rule-driven automatic listings; CSV, Excel and pasted-table import; CSV, Excel and designed PDF export; a printable allergen register and stronger allergen audit trail. Catalogue describes choices and extras but does not become an ordering, payment or kitchen system.

## 2. Product principles

2.1 One Catalogue, many kinds of offering (pizza and drinks, books, olive oil and ceramics, tastings and lessons). No starter may restrict which item profiles can be added later.

2.2 Setup creates ordinary data. After application everything is editable; runtime code does not branch on the starter; the applied starter is kept only as installation history; reapplying or adding packs never overwrites existing content silently.

2.3 Classification, presentation and commerce are separate:

| Concept | Question answered |
|---|---|
| Item profile | Which fields and rules apply? |
| Category | What is the item? |
| Tag | Which optional descriptors apply? |
| Collection and section | Where is it presented? |
| Service channel | How is it offered? |
| Format | In which sellable form? |
| Option | How may it be customised? |

2.4 Fast entry, progressive enrichment. Drafts may lack photos, descriptions, translations. Required publication data and recommended improvements are reported separately.

2.5 Safe inheritance stays visible: the effective value, where it came from, how to override it, what a parent change affects.

2.6 External-channel requirements are versioned policies (by country, partner type, date) — never a timeless hard-coded "Deliveroo rule".

## 3. Goals and non-goals

Goals: first valid menu item quickly; fast single and bulk workflows; understandable categories, placement, formats, channels, pricing; prevent accidental publication of incomplete/unsafe content; tenant-defined publication standards; external-channel media/content requirements; professional printed menus and data exchange; business neutrality; clean extension points for ordering, inventory, suppliers.

Non-goals: cart, checkout, payments, order transmission, kitchen tickets, delivery dispatch, ingredient inventory deduction, full supplier management, full nutrition calculation, retail fulfilment, affiliate purchasing, free-form desktop publishing.

## 4. Information architecture

4.1 Sidebar: Home · CONTENT (Posts, Events, Galleries, Documents) · CATALOGUE (Items, Collections, Options, Setup) · VISITORS (Contact requests, Access) · LIBRARY (Media, People, Categories & tags) · INSIGHTS (Analytics) · PROJECT (Connected apps, Settings). Installed modules decide groups; active group opens; collapsed state per user; badges visible when collapsed; Home always visible; drawer on small screens. *(Final placements and behaviour: ADR-042.)*

4.2 Remove duplicated desktop tabs; compact destination selector on mobile if needed; admin label always **Catalogue**; public labels (Menu, Books, Shop) configurable separately.

4.3 Catalogue Setup: Overview · Starter structures · Categories · Tags · Service channels · Pricing and availability · Item defaults · Publication standards · Public website · Import and export. *(Amendment K-4: Catalogue categories/tags are edited only here.)*

## 5. Item profiles

"What are you adding?" — Food or drink (allergens, dietary) · Book (author, ISBN, edition, cover, purchase links) · Other product · Service. Rename "A product" → "Other product". Starter supplies the suggested default (Restaurant → Food or drink, Bookshop → Book, generic → Other product). All profiles available to every tenant. Profile changeable later, subject to validation and intentional reset rules. Changing into Food or drink resets allergen review to `notReviewed`.

## 6. Contextual food-and-drink setup

6.1 When Food or drink is selected and food setup was never completed, open setup in context (no redirect).
6.2 Large modal / focused full-screen flow built from the Setup components: "Set up food and drink — choose a starting structure and tell us how you serve customers. You can change everything later." [Set up now] [Start empty] [Save and exit]. On completion return to the item draft with Food or drink still selected.
6.3 Steps: (1) starter — Pizzeria, Traditional restaurant, Fine dining, Café and bar, Wine bar, Empty; (2) activate channels — At the restaurant, Takeaway, Delivery, Room service, Custom; nothing silently activated, suggestions need confirmation; (3) review proposed category tree, tags, collections, sections, formats, option groups — rename/remove/add before applying; (4) category tree × active channels → runtime inheritance rules on the operational category path; (5) review and create (e.g. "2 service channels, 14 categories, 1 menu, 7 menu sections, 3 reusable option groups"). Creation idempotent, recorded with starter id, version, date.

## 7. Starter structures

7.1 Launch: Pizzeria, Traditional restaurant, Fine dining, Café and bar, Wine bar, Empty *(+ existing Bookshop — seven packs, Amendment K-6)*.
7.2 Each declares proposed: localized category tree, tags, collections and sections, channel suggestions, channel inheritance rules, common formats, reusable option groups, default item profile, publication-policy suggestions.
7.3 Declared in the manifest or a typed registry; validated against current settings and schema; segment collisions block; **currency never written** (preview shows it read-only); content editable; runtime code outside setup may not inspect starter identity.

## 8. Hierarchical categories

8.1 Arbitrary nesting in storage; stable key/ID; one parent; localized labels; explicit sibling order; multiple assignments per item; one required primary category for published items; automatic ancestor membership for filtering; search by label and full path; tree browsing; inline creation with parent selection; drag within/between parents; cycle prevention; safe deletion and reassignment; usage counts and named blockers.
8.2 Example: Food › Pizza › {Classiche, Bianche, Speciali, Calzoni}; Food › Desserts; Beverages › Alcoholic › {Liqueurs, Digestifs}.
8.3 Picker shows full paths ("Food › Pizza › Bianche"); search or browse; creating needs a parent.
8.4 Drafts may lack a category; every published item needs ≥1 category and one designated primary; additional categories affect discovery and listings, not operational inheritance.

## 9. Catalogue tags

Flat, localized, optional descriptors (Chef's choice, New, Seasonal, Local, Spicy, Limited edition, Staff favourite). Managed in Setup → Tags; never publication blockers; may drive automatic listings; must not duplicate allergens or controlled dietary declarations; separate from global tags.

## 10. Collections, sections and placement

Collections arrange items for presentation; sections/subsections have stable keys and explicit order; item order within a section explicit and draggable; items may appear in several collections/sections; placement never changes classification; a published item may exist without placement (quality warning only).
Drag-and-drop now: reorder categories; move categories between parents; reorder collections; reorder sections/subsections; move sections between parents; reorder items in a section; move items between sections; reorder options; reorder formats. Keep accessible move up/down and announce changes.

## 11. Service channels and inherited availability

11.1 Only active channels appear in editors. Each: stable key, localized label, active/inactive, sort order, default availability for new items.
11.2 Precedence: project default → primary-category ancestor rules → most specific rule on the primary-category path → item override → format override (where formats differ). Additional categories never participate.
11.3 Tri-state at category, item and format: Inherit · Available · Unavailable. UI shows effective result and source, e.g. "Delivery — Unavailable for this item. Category default: Available from Food › Pizza. [Use category default]".
11.4 Before activating a channel or changing an inherited rule: calculate affected items/formats, show counts, preview, preserve explicit overrides, require confirmation, record in activity history.

## 12. Formats

First-class. Examples: Beer — Glass 25 cl / Glass 50 cl / Bottle 33 cl; Book — Paperback / Hardcover; Olive oil — 250 ml / 500 ml / 1 litre.
12.1 Fields: stable key; localized label; explicit order; optional SKU, ISBN, GTIN/barcode; optional unit/quantity metadata; channel availability override; offers/prices; future inventory, packaging and nutrition references.
12.2 An item with no visible format choices uses one implicit default format; the manager sees a normal price field until "Add another size or format".
12.3 Bottle size and hardcover are formats; extra mozzarella and gift wrapping are options.

## 13. Pricing

13.1 Item → Format → effective channel availability → default offer → channel-specific offer → optional availability window.
13.2 Currency only from project configuration (V1); an offer never configures currency; a default/unscoped offer is a price fallback only where the format is effectively available; channel offer overrides default for that channel; no effective availability = not sold there even with a default price; no applicable offer = not priced/sold in that context *(corrected by Amendment K-3 rules 9–11: no applicable price never means unavailable)*; multiple offers per channel only with non-overlapping windows; overnight windows supported; days name the start day of an overnight interval; ambiguous imported data is an explicit error.
13.3 Simple: "Price €12.00". Expanded: "Standard price €12.00 · Available through ✓ Restaurant ✓ Takeaway — Delivery · Different prices: Takeaway €10.00".

## 14. Options, choices and extras

Options describe customisations, may be shown publicly, create no cart/order. Group capabilities: stable key; localized name; reusable; explicit order; min/max selections; add and remove choices; price delta; link to a real item; free-text choice; allergen declaration for free-text food additions; draft dependency handling. Rules: linked choices inherit the linked item's declaration; free-text food additions need allergen review; remove choices never subtract base allergens; "Double mozzarella" is an explicit choice; quantities deferred to Ordering; complex substitutions deferred (explicit substitution choices supported); category starter rules may attach default groups to new items, attachment explicit thereafter.

## 15. Single-item creation

Flow: profile → contextual setup if needed → name → categories + primary → collection placement → formats, channels, prices → allergen review when applicable → save draft or publish. Optional, never mandatory steps: description, photo, other languages, dedicated page, options, dietary. After save: Add another · Preview product · Open full editor · Return to Items.

## 16. Bulk creation and operations

16.1 Add several: spreadsheet-like entry in Items and in collection sections (Name | Category | Primary category | Section | Format | Price | Allergens); paste from spreadsheets; images optional; created items are drafts; per-row validation; duplicate candidates flagged; missing publication data summarised afterwards.
16.2 Bulk: edit, publish, schedule, archive, category assignment, primary-category assignment, collection placement, channel override, price update, option attachment, media workflow where practical. Bulk publication runs the same readiness engine; publishes/schedules ready items; separates blocked items naming each blocker; optional explicit all-or-nothing mode.

## 17. Publication standards and readiness

17.1 Scopes: project website; item profile; primary-category subtree; collection; service channel; export profile; connected marketplace.
17.2 Levels: Required (blocks publication/delivery/export in the scoped context); Recommended (warns; may be overridden with permission).
17.3 Requirement types: field present; min/max text length; primary category; placement; price; channel availability; allergen review complete; dependencies publishable; translation present; dedicated-page address valid; image present; image technical policy passed; image rights/provenance confirmed; aggregate collection coverage threshold; custom integration validator.
17.4 Item readiness — Required ✓ Name ✓ Primary category ✓ Price ✕ Allergens need review; Recommended ✕ photo ✕ description ✓ added to a menu.
17.5 Contextual — Own website Ready · Takeaway menu Ready · Delivery marketplace Blocked (image missing) · Printed menu Ready.
17.6 Overview counts (each filters Items; "To complete" chips): needs allergen review; no photo; no description; no category; no primary category; no placement; missing dependency; missing translation; channel policy failure; external image-policy failure.

## 18. Media requirements and provenance

18.1 Deterministic: width/height; aspect ratio + tolerance; format; file size; orientation; crop-safe region; required crop variants; alpha restrictions.
18.2 Human-confirmed: product fully visible; represents the sold item; no misleading ingredients/portions; no forbidden embedded text, watermark or logo; background/framing policy; rights held.
18.3 Provenance: original photo; supplier photo; licensed; AI-generated; AI-enhanced; unknown; rights confirmation; source/reference; reviewer and date.
18.4 External templates: versioned, localized, effective-dated, country/partner scoped, updatable without rewriting historical readiness, never marketed as a guarantee of acceptance. References: Deliveroo image requirements, quality review and partner image policy (help.deliveroo.com, merchants.deliveroo.com/en-IE/legal/policies).

## 19. Full-page draft preview

Uses draft data without publishing; real public components; language selection; service-channel context; desktop and mobile widths; effective formats, prices, options, allergens; standalone page when enabled; collection/menu presentation even without a dedicated page; clearly private; same visibility/resolution as public except draft authorization. Button: "Preview product".

## 20. Allergens and compliance

20.1 Keep: food cannot publish while `notReviewed`; Contains / May contain separate; "no Annex II allergens" needs explicit confirmation; free-text food add choices reviewed; linked choices inherit; remove never subtracts; combined publication validates every food dependency.
20.2 Add: reviewer identity; review timestamp; review basis (recipe, supplier label, technical sheet, risk assessment, other); reset to `notReviewed` when relevant data changes; explicit risk-assessment confirmation for May contain; change history; review reminders; printable register; PDF and CSV allergen export; version and generation date.
20.3 Abluo enforces process and preserves evidence; the food-business operator remains responsible.

## 21. Automatic listings

21.1 Filters: item profile; primary category; any assigned category; category descendants; tags; collection membership; effective channel availability; price range; format presence; dietary declaration; lifecycle/publication state; visibility; available now or at a given time; created/updated date; translation availability. Never infer "allergen-free" from absence.
21.2 Boolean: match all; match any; exclude; nested groups to a documented maximum depth.
21.3 Curation: pin; exclude; order pins; limit; empty-state behaviour; preview matches.
21.4 Sorting: manual/pinned first; category order; name; price; created; updated; explicit item order; random only when enabled and deterministic for a defined period.
21.5 Delivery: reuse shared lifecycle visibility; respect language availability; respect unlisted/website-only/public contexts; no duplicate structured data across canonical URLs; stable, testable query/projection contracts.

## 22. Import

Sources: CSV, XLSX, pasted cells. Workflow: upload/paste → detect workbook/table → map columns → normalise → match existing → resolve conflicts → preview exact plan → create/update drafts → report and undo. Requirements: detect headers and mappings; locale decimal separators; map languages, category paths, collections/sections, formats and channels, allergens (controlled values); prefer stable external ID, SKU, ISBN or barcode; never merge on similar name alone; show create/update/possible duplicate/invalid/skip; keep import-batch id and source-row identity; safe retry; drafts by default; never overwrite manual edits without explicit confirmation; downloadable error report; recoverable batch undo. Re-import: round trip through stable Abluo ids and field-level diff; continuous sync is future.

## 23. Export

23.1 Data: CSV, XLSX. Scopes: all; filtered; selected; categories and paths; tags; collections and placement; formats; channel availability; prices and windows; options; allergens and review metadata; readiness results. Round-trip exports include stable Abluo ids; media as URLs/ids.
23.2 Designed PDF templates: Classic restaurant; Contemporary; Compact pizzeria; Fine dining; Wine list; Café and bar; Allergen register. Controls: A4/A5/Letter; portrait/landscape; 1–3 columns; cover; logo; approved fonts; brand colours; section order; page breaks; images on/off and size; descriptions on/off; allergen display mode; selected channel prices; language; footer/contact; QR to live menu; last-updated date. Requirements: full preview before export; print-ready; deterministic pagination; orphan/widow handling; accessible text where feasible; versioned snapshot with timestamp and source revision; no free-form page designer.

## 24. Permissions

Capabilities: view; create/edit items; publish/schedule; delete/archive; manage collections; manage options; manage setup; manage categories and tags; manage publication standards; import; export; bulk publish; review allergen declarations; override recommended readiness warnings. Setup, starters and policy management owner/admin-equivalent. Every multi-document action checks permission for every affected document before writing. *(Amendment K-5: no separate publish capability — editing includes publishing.)*

## 25. Conceptual data model (concepts, not final syntax)

- `catalogueSettings`: publicLabel, publicSegment, publicSegmentHistory[], currency, defaultItemProfile, serviceChannels[], defaultChannelsForNewItems[], appliedStarters[], defaultPublicationStandard.
- `catalogueCategory`: key, localizedLabel, parentKey?, order, channelRules[] (inherit|available|unavailable), defaultOptionGroups[], archivedAt?.
- `catalogueTag`: key, localizedLabel, order, archivedAt?.
- `catalogueItem`: itemProfile, localizedName, localizedDescription, primaryCategory, additionalCategories[], tags[], formats[], channelOverrides[], optionGroups[], images[], allergenDeclaration?, collection references/placements, dedicatedPage, lifecycle fields, visibility.
- `catalogueFormat`: key, localizedLabel, order, identifiers {sku?, isbn?, gtin?}, quantity/unit?, channelOverrides[], offers[].
- `cataloguePublicationStandard`: key, localizedName, version, effectiveFrom?, scope, requiredRules[], recommendedRules[], aggregateRules[], externalPolicyMetadata?.
- `catalogueMediaCompliance`: assetReference, provenance, rightsConfirmed, source?, reviewedBy?, reviewedAt?, policyResults[].
- `catalogueAutomaticListing`: localizedName, ruleTree, pinnedItems[], excludedItems[], sort, limit?, emptyBehaviour.
- `catalogueImportBatch`: sourceMetadata, mapping, sourceFingerprint, rowResults[], createdDocumentIds[], updatedDocumentIds[], status, startedBy, startedAt, completedAt?.

## 26. Domain services (pure, testable)

Category tree traversal, order, ancestry, cycles; effective channel availability; format and offer resolution; price-window overlap; readiness by publication context; aggregate coverage; media-policy validation; automatic-listing evaluation; import normalisation and matching; export projection; PDF projection independent of template; allergen review invalidation. Compose existing shared lifecycle/time-zone/visibility services; never duplicate them.

## 27. Schema evolution and migration

Query production and development; record counts and shapes; reversible migrations; preserve public URLs and lifecycle state; test old documents against new readers. Expected: flat categories → hierarchical; item category arrays → primary + additional; offers → implicit default formats; channel semantics → explicit availability + price fallback; option-list labels/navigation copy; Catalogue nav label → stable `Catalogue`. Defaults must never silently make items available through new channels.

## 28. Activity and audit

Record: starter application; category rule changes with impact count; channel activation/deactivation; publication-standard changes; allergen review and invalidation; imports and undo; bulk edits and publication; PDF/menu export snapshot; external-policy validation version. Actor, timestamp, target and material before/after meaning, without copying unnecessary sensitive content.

## 29. Acceptance criteria (summary)

AC-01 navigation · AC-02 profiles · AC-03 contextual setup (returns to the same draft; abandoning keeps the draft) · AC-04 starter safety (exact preview, collisions block, retry no duplicates, no currency, no runtime branching) · AC-05 categories (arbitrary depth, cycles refused, published needs primary, ancestor filters, no inheritance ambiguity) · AC-06 availability inheritance (precedence, visible source, overrides, impact preview, additional categories inert) · AC-07 formats and prices (single simple, multi priced per format, standard price never creates availability, channel overrides, overnight, overlapping equal-precedence refused) · AC-08 bulk creation · AC-09 drag ordering with keyboard parity · AC-10 readiness (scoped blocking, overridable recommendations, item/aggregate consistent, filters reproduce counts) · AC-11 media policy · AC-12 preview (never publishes, locale/channel switch, collection preview) · AC-13 allergens (gates intact, invalidation, reviewer/date/basis, register matches snapshot) · AC-14 automatic listings (preview = public for fixed time/context, deterministic pins/exclusions, lifecycle/visibility/locale always applied) · AC-15 import/export (round trip updates, never name-only merge, retry-safe, recoverable undo, PDF preview = pagination) · AC-16 permissions (validate all targets before writing; refusals name the capability without leaking data).

## 30. Test strategy

Unit: ancestry/cycles; precedence; format availability; offer resolution and overlaps; overnight; readiness; aggregate coverage; listing DSL; import normalisation/matching; export projection; allergen invalidation. Matrix: profile × lifecycle × visibility × language × channel × category inheritance × item/format override × standard × collection/manual/automatic listing × sitemap/structured data/`llms.txt`, with a fixed current time. Integration: starters; first-item return path; bulk; preview authorization; import/undo; export/re-import; PDF snapshots; Studio/dashboard parity *(replaced by K-7)*; referential integrity. Visual/a11y: desktop/mobile; light/dark; keyboard drag; focus/modal return; announcements; long labels; PDF with long multilingual content.

## 31. Delivery slices (brief's proposal; sequencing governed by K-9)

1 Navigation and setup shell · 2 Categories and tags · 3 Channels, inheritance and formats · 4 Contextual starters · 5 Item creation, bulk and readiness · 6 Publication standards and media compliance · 7 Preview, options and drag completion · 8 Automatic listings · 9 Import and data export · 10 PDF and compliance exports · 11 Full verification.

## 32. Future roadmap and extension points

Ordering (stable item, format, option, offer ids); inventory (formats accept inventory references); suppliers and ingredients (allergen review records source, invalidates safely); nutrition and packaging (format is the extension point); commerce and fulfilment (identifiers, availability and exports channel-neutral); advanced sync (stops at explicit re-import with field-level review).

## 33–34. Documentation and definition of done

ADR-033 amendment; lifecycle docs where bulk behaviour changes; spec sections for profiles, categories, formats, channels, pricing, options, readiness, listings, exports; starter definitions and versioning; external policy sources and ownership; migration results; operator guidance for allergens and image rights. Done when all ACs pass; TypeScript clean; suites pass (unrelated failures documented); production checks and migrations recorded; publication rules enforced by the shared server gate (K-7); public queries keep shared lifecycle visibility; draft preview cannot leak; strings reviewed in en/it/de; light/dark and phone/desktop checked; PDFs inspected with long multilingual content; ADRs/spec/user docs match; no marketplace described as guaranteed compliant or accepted.

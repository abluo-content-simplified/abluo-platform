# ADR-033 — Amendment K: Catalogue redesign — settled decisions

**Status: Accepted — Tom, 2026-11-02 (decisions K-1 … K-10; clarifications of the same day applied).** Nothing implemented.
Date: 2026-11-02.
Authority: the *Abluo Catalogue — Product and implementation brief* of 2026-11-02 (the "brief"), as corrected by Tom's decisions of the same day, which win wherever they differ from the brief. Assessment that preceded it: project doc `claude/catalogue-redesign-assessment-2026-11-02.md`.
Related: **ADR-042** (dashboard navigation foundation — the platform part of K-1), ADR-032 (lifecycle), ADR-014 (one configuration surface), ADR-028 (roles & permissions).
Convention: like Amendment I, a separate file for review; appended to the ADR as `## Amendment K` once the step-2 contracts (K-11) are written, then this file is removed.

---

## K-0 What this amendment does

It records the decisions that settle the conflicts the assessment listed, names what each **supersedes**, and lists the brief sections that change. It does **not** yet fix field names or service signatures — that is step 2 (K-11), and no slice starts before it.

Scope approved in full (K-8). Delivery is sequenced (K-9).

---

## K-1 Navigation — Catalogue is a top-level sidebar group

The new sidebar structure is adopted **platform-wide** (ADR-042). Catalogue is a collapsible group with four destinations: **Items · Collections · Options · Setup**. The Items / Collections / Option lists `SegmentedControl` in `CatalogueBrowser` is removed once the four destinations exist in the sidebar.

The navigation foundation (whole-sidebar collapse, group collapse, per-user memory, tooltips in rail mode, drawer on phones) is **its own platform slice** (ADR-042), not part of a Catalogue slice.

## K-2 The dashboard module is always "Catalogue"

**Supersedes D12** (project-configurable dashboard label) and the 2026-10-16 update in D-1 (optional `navLabel` override).

- The dashboard name is fixed: **Catalogue**, translated by the interface dictionaries like every other module name. No tenant setting renames it.
- A tenant may set a separate **public name** (Menu, Books, Wine List, Services…). It is content localization: used on the website (landing page, page titles, breadcrumbs, structured data where a name is wanted) — never in the dashboard.
- Starters may *suggest* a public name; they never touch the dashboard name.
- Migration — **preserve the current public name.** When a project has a `navLabel` **and no public name yet**, the migration copies the `navLabel` (every locale) into the new localized public-name field **automatically**, and records the copy in the audit log (project, old value, new field, actor = migration, timestamp). When a public name already exists, it is left untouched and `navLabel` is dropped. Either way the website keeps the name it shows today, `navLabel` is then removed, and the dashboard always says Catalogue. The same equivalence principle as K-3 applies: a test compares the public name each website resolves before and after. Code that reads it today: `lib/client/surfaces.ts`, `catalogue/page.tsx`, `taxonomy/page.tsx`, `CatalogueBrowser`, `catalogue-drafts.ts` (`navLabel`), `CATALOGUE_NAV_LABEL_QUERY`.

## K-3 Price and availability are separate

**Supersedes A2 and A4 in their availability meaning** ("an unscoped offer applies to any channel" made a price imply availability) and the D3 sentence "an item with no offer on a channel is simply not supplied that way". The resolver's refusal to guess (ambiguity), A1 (overnight), A3 (non-overlap per scope) and D7/D14 (currency, stable keys) **stand**.

| Question | Answered by |
|---|---|
| How much does it cost? | **Price**: the standard price, or a channel-specific price that overrides it for that channel |
| Where and when can it be obtained? | **Availability**: project default → primary-category path → item → format |

Rules:

1. Entering a price never activates a channel.
2. The standard price is the fallback price **wherever the item is available**.
3. A channel-specific price overrides the standard price on that channel only.
4. Availability is tri-state at category, item and format level: **inherit · available · unavailable**. Precedence: project default → ancestor rules on the **primary-category** path → most specific rule on that path → item override → format override.
5. **Additional categories never influence availability.**
6. The interface always shows the **effective value and its source** ("Unavailable for this item — category default: Available, from Food › Pizza").
7. **No channels configured:** the item is shown on the general website with its standard price. Channels are optional; a business-neutral installation still has none (D-1 holds).
8. **One channel active** (e.g. dine-in only): the standard price applies there; no separate dine-in price is needed.
9. **Price windows choose a price; they never decide availability.** A window says *which* price applies at a given time. Outside a channel-specific price window, resolution falls back to the applicable standard price.
10. **An available item with no applicable price stays available** and carries a *missing price* readiness issue (K-11 C6). The system never interprets "no applicable price" as "unavailable" — not in resolvers, listings, structured data, exports or partner output.
11. Overlapping windows in one scope are refused; ambiguous data (two prices at the same precedence and instant) is an error, never a pick — unchanged from A3/A4.

**Migration (non-negotiable): existing public behaviour must not change.** For every item, the migrated availability must resolve, on every channel and in the no-channel website context, to exactly what the old offer resolution showed. The migration is verified by running the old and new resolvers over the same documents and fixed instants before and after (diff must be empty). Production today: 16 items, all `tmz`, no channel-scoped offers — the mapping is one implicit format, one standard price, no channels.

## K-4 Catalogue categories and tags live only in Catalogue → Setup

**Supersedes J-4 for the Catalogue** (dashboard editing of Catalogue terms in Categories & Tags) and retires the dual-read of the legacy `categories` module-config list.

- Catalogue categories (hierarchical, primary + additional, ordered, carrying availability rules) and Catalogue tags are edited **only** in Catalogue → Setup.
- The platform Categories & Tags area keeps Posts, News, Events, Media, Galleries and other editorial modules. Its Catalogue tab is removed. A future global overview may **link** to Catalogue Setup; it never edits Catalogue terms.
- There are never two editable surfaces for the same terms (ADR-014). A test enforces that no dashboard surface other than Setup writes Catalogue terms.
- Whether Catalogue terms stay `taxonomyTerm` records (with a parent and availability rules added) or become their own type is decided in K-11; either way J's guarantees hold: deterministic ids, immutable keys, labels per locale, `projectSlug` scoping, unknown key resolves to nothing.

## K-5 Editing includes publishing — no Catalogue publish permission

**Confirms ADR-032 D5 and ADR-033 §4.** No `catalogue.*.publish` permission is introduced. Bulk publish, scheduled publish and publish-with-dependencies are governed by the same write permissions as single publish.

Brief §24 changes accordingly: "Publish/schedule items" and "Bulk publish" are **not** separate capabilities. An author/approver workflow, if ever needed, is a **shared platform approval capability** for all modules, designed separately.

New capabilities that *are* needed (exact ids in K-11): manage Catalogue setup (incl. starters, channels, categories, tags, publication standards), import, export, review allergen declarations, override a recommended readiness warning. Setup, starters and standards default to owner/admin-equivalent roles.

## K-6 Starter structures are additive packs, usable after installation

**Supersedes the D-1 rules** "offered when the module is first enabled", "applied once", "never reapplied on upgrade" and "demo content packs … are a separate, future concept" *as far as structure is concerned* (sample content stays out of starters).

A pack **may**: add missing categories, tags, collections, sections, formats, options and suggested settings; be previewed completely; identify conflicts and existing equivalents; be applied once per pack version; leave everything editable.

A pack **must never**: overwrite tenant changes; delete or replace structures; reset the Catalogue; change the project currency; silently rename or reorganise existing content.

- Equivalence is decided by stable keys (and, for proposals only, by localized-label match shown to the person — never auto-merged).
- An updated version of an applied pack is offered as an **optional update with a diff**; never reapplied automatically.
- The record of applied packs (`id`, `version`, `appliedAt`, `appliedBy`, what was added) is installation history. The guard of D-1 stands: **only the setup/pack flow reads it**; no runtime code branches on which packs were applied.
- **Application is transactional and retry-safe.** A pack is recorded as applied only after the complete operation has succeeded. A failed or interrupted application leaves no "applied" record and can be retried safely; a retry never duplicates documents or structures. **Identity is the stable key** (deterministic ids), never a localized name.
- **Seven packs at launch:** six restaurant starters — Pizzeria · Traditional restaurant · Fine dining · Café and bar · Wine bar · **Empty** — plus the existing **Bookshop**. *Empty* seeds no business structure; applying it simply records that setup was completed intentionally.

## K-7 Studio becomes inspection and maintenance; the dashboard is the editor

- The Abluo dashboard is the normal environment for **all** Catalogue work: setup, editing, publishing, administration.
- **Catalogue documents are read-only in Studio by default.** Studio remains for inspection and diagnosis by Abluo super administrators.
- Shared domain and server logic is the **single authoritative source** of rules. The dashboard calls it; Studio does not reimplement conveniences or warnings.
- **Read-only Studio needs no duplicated dashboard experience** — no wizard, warnings or conveniences are rebuilt there.
- **Break-glass editing:** any Studio write path must be explicit, restricted to super administrators, logged, and visibly marked. It must **use or enforce the critical shared rules** — referential integrity, allergen review, dependencies, price/availability validity and publication blockers. "Admin-only" alone is not sufficient if invalid data can be created.
- **Direct Studio writing must never become an undocumented bypass** around the server publication gate. If a write path exists, it is documented in C9 and covered by a test.
- Catalogue module configuration moves to Catalogue → Setup; the Studio Modules pane shows it read-only (ADR-014 one surface).
- Consequence for the brief's definition of done: "Dashboard and Studio enforce matching publication rules" becomes "**the shared server rules are the only publication gate; Studio is read-only, or enforces the critical set when break-glass is enabled**".

## K-8 Scope — complete, delivered in slices

The full brief scope is approved, including: the new data model; hierarchical and primary categories; explicit channel availability and inheritance; first-class formats; Catalogue Setup; contextual food setup; all seven packs (six restaurant starters plus Bookshop); compact creation; Add several; drag-and-drop ordering; expanded bulk actions; contextual readiness and publication standards; full-page draft preview; allergen auditing, history and printable register; CSV and Excel import/export; designed PDF menus; complete automatic-listing rules; image requirements and destination policies; image rights and provenance.

It is delivered as coordinated, reviewable slices — never one simultaneous change or one merge.

## K-9 Order and parallel work

1. Record decisions (this amendment, ADR-042, spec updates).
2. **Finalise shared data contracts and domain rules (K-11).** No feature slice starts before.
3. Change the data model; migrate existing Catalogue data (K-3 equivalence proof; never migrate production data ahead of the deploy that reads it).
4. Dashboard navigation foundation (ADR-042) and Catalogue Setup.
5. Parallel workstreams where dependencies no longer overlap.
6. Integrate and verify each slice before the complete release.

Parallel once the model is stable: navigation & Setup · preview & drag-and-drop · allergen audit & register · import & export · PDF rendering · image policy & provenance · automatic listings.
Contract-dependent (start after categories, formats, channels and Setup are settled): starters · fast creation & Add several · bulk editing · readiness & publication standards.

**One implementation per concept.** Categories (tree, ancestry, cycles), availability resolution, price resolution, readiness evaluation and visibility each have exactly one pure domain service. Parallel agents import them; none reimplements them. Each workstream owns explicit files; shared contracts change only through the contract owner.

## K-10 Product expectation

A new manager can configure the business, add several items, organise them, see what is missing, preview and publish confidently without technical knowledge; experienced teams manage complex categories, formats, prices, channels, options, compliance, imports, exports and large catalogues efficiently. The system carries the complexity. Desktop, tablet and phone; existing architecture, design system (Component Lab rule), lifecycle, permissions, multilingual model and accessibility; new components only for genuinely new interactions.

---

## K-11 Step-2 contracts (to be written next; each blocks the slices listed)

| Contract | Settles | Blocks |
|---|---|---|
| C1 Category & tag model | storage type (extend `taxonomyTerm` vs own type), parent, order, primary/additional on item, cycle rule, delete/reassign, availability rules on category | model, Setup, starters, creation, import |
| C2 Channel model | channel object (key, labels, active, order, default-for-new-items), where stored, deactivation semantics | model, Setup, availability |
| C3 Format model | embedded on item, implicit default format, identifiers, order, per-format overrides; project-level format suggestions for starters | model, pricing UI, import/export |
| C4 Price model | standard + channel prices per format, windows, overlap/ambiguity, effective price service | model, preview, PDF, export |
| C5 Availability resolver | inputs, precedence, source explanation, impact calculation for rule changes | Setup, creation, readiness, listings |
| C6 Readiness engine | contexts (website, channel, export, print, marketplace), rule types, required/recommended, override, aggregate | creation, bulk, standards, media policy |
| C7 Pack format | declaration, validation, preview diff, equivalence, application record | starters |
| C8 Permissions | new capability ids and default roles (K-5) | Setup, import/export, allergen review |
| C9 Studio posture | read-only mechanism, break-glass switch, critical rule set | model rollout |
| C10 Migration | old → new mapping, equivalence test, rollback | step 3 |
| C11 Public name | field, locales, where used, `navLabel` hand-over | navigation, website |
| C12 Audit events | new activity kinds and payload shape | all |

---

## K-12 Brief sections changed by this amendment

| Brief § | Change |
|---|---|
| 4.1 / 4.2 | Adopted; navigation detail and collapse behaviour in ADR-042 |
| 4.2 "label always Catalogue" | Confirmed; public name separate (K-2) |
| 4.3 / 9 | Global project categories & tags **lose the Catalogue tab** (K-4) |
| 7.2 / 6 | Packs are additive and usable after installation (K-6) |
| 13 | Adds K-3 rules 7–11 (no channels; one channel; price windows never decide availability; missing price ≠ unavailable) and the migration equivalence requirement |
| 7.1 | Seven packs: six restaurant starters + Bookshop; Empty seeds nothing (K-6) |
| 24 | No publish capability; approval workflow is a future platform capability (K-5) |
| 29 AC-16, 34 DoD | Studio parity replaced by K-7 |
| 27 | Migration must preserve public behaviour (K-3) |

## K-13 Consequences

- D12, D-1 (install-only), A2/A4 availability semantics, D3's "no offer = not supplied", J-4 for Catalogue and the legacy `categories` config are superseded; their tests change in the same commits as the code.
- `applied-preset-guard.test.ts` generalises to applied packs.
- Studio Catalogue schema validation shrinks to the critical set (K-7) once documents are read-only; until then it stays as is.
- The sidebar's PLAT-3 grouping is replaced (ADR-042); Studio's module order is unaffected.

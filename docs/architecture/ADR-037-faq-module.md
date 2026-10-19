# ADR-037 — FAQ module: a library of reusable FAQ sets

**Status:** Accepted (2026-10-19 — all questions resolved with Tom the same day)
**Date:** 2026-10-19
**Owner:** Tom
**Relates:** ADR-020 (modules first-class), ADR-022 (Gallery — the pattern this follows), ADR-023 (Translate), ADR-025 (client content editor), ADR-026 (AI provider layer — phase 2), ADR-028 (roles and permissions), ADR-032 (content lifecycle), Sections vs Modules principle (CLAUDE.md)

---

## Context

FAQs exist on the platform today in two unconnected shapes:

1. **`faqSection`** — a platform page section with its own inline `items[]` of `faqItem` (`question`: localizedString, `answer`: localizedText). Edited only in Studio by the super admin. Not reusable: the questions live inside one section on one page. `JsonLd.tsx` emits `FAQPage` for one `faqSection` per page; answers are server-rendered (`7dc9419`).
2. **Imported post FAQs** — the Hoffmann migration (decision D5, 2026-08-28) imported a `faq[]` array of `faqItem` onto 14 of Claudia's posts. The `post` schema has **no `faq` field**, so Studio shows it as an unknown field and nothing renders it. Standing rule since 2026-10-05: never click "Remove field".

Inventory (production dataset, raw perspective, 2026-10-19):

| Where | Documents | Items |
|---|---|---|
| `faqSection` on pages | 6 pages in 5 projects: `abluo` (home-staging), `cyce` (teachers), `hoffmann` (risorse-blog), `nologo` (home, restaurant), `studiomartegani` (1 page) | 40 |
| `post.faq[]` | 14 published Hoffmann posts + 1 draft (`drafts.hoffmann-post-gratitudine-…`) | 66 |

Both shapes already use the same `faqItem` type, which makes conversion mechanical.

What Tom wants (2026-10-05, 2026-10-19):

- One FAQ module, installable per project like any module, reusable across all tenants.
- Create as many FAQ blocks as needed, give them a name, add questions and answers, then **recall them anywhere**: pages (as a section), blog posts now, events and other modules later.
- **A link, not a copy.** The super admin places an FAQ on, say, the homepage; the site's editor maintains its content from the library and the homepage follows.
- **Duplicate** a block, rename it, change it, reuse it.
- Used by Owner, Site admin and Editor (when allowed), in the client dashboard. Clients never see Studio.
- Phase 1 has **no AI**. Phase 2 adds AI generation (3 / 5 / 7 questions from a post's text) on top.

Two FAQ systems in one app (inline section + library) were considered and rejected: two ways to do the same thing, and the inline one is exactly the copy-that-drifts the library exists to remove. It also breaks Sections vs Modules: today the section owns its data.

## Decision

### D1 — The FAQ module owns FAQ sets; placements reference them

Register an `faq` module in `MODULE_REGISTRY` following the Gallery pattern (ADR-022 §2):

- `schemaTypes`: `faqSet`, `faqEntry`, `faqAnswerText`, `faqSection`, plus the legacy `faqItem` until cleanup (moved from `schema.ts` into `src/lib/modules/faq/schema.ts`; `faqItem` and `faqSection` keep their names).
- `sectionTypes`: `faqSection`.
- Studio collection *FAQ sets*, scoped by `projectSlug`, initial-value template `faqSetProjectOwned`.
- Enabled per project through `moduleInstallations`.
- `integratesWith`: `blog`, `events`, `translate`.

**User-facing name: "FAQ set"** in sentences; the side-nav label and screen title are **"FAQ Sets"** (Title Case rule for English navigation). Not "collection": the Catalogue module already uses that word in the dashboard.

### D2 — The `faqSet` document

Project-owned (`projectSlugField`, `scopedRef` references). Every visitor-facing field is localized from the start.

| Field | Type | Req. | Notes |
|---|---|---|---|
| `internalName` | `string` | ✔ | The name editors see and search ("Dental implants", "Booking & cancellation"). Never shown publicly. |
| `title` | `localizedString` | – | Optional public heading, used when a placement shows several sets with their titles (D5). |
| `note` | `string` | – | Optional internal note ("Used on event pages; keep answers short"). |
| `items` | array of `faqEntry` | – | Ordered. Unlimited. Each item keeps a stable `_key` (anchors, de-duplication, AI suggestions later). |
| Lifecycle | `archivedAt`, `archivedBy` | – | ADR-032 D1. No publication window: a set is a building block, its placements decide when it appears. |

**`faqEntry`** (new item type): `question` (`localizedString`, plain text) and `answer` (`faqAnswerText`, restricted rich text — D12).

Why a new item type instead of changing `faqItem`: `faqItem.answer` is `localizedText` and is stored in 106 live items. Changing a field's type in place breaks the published documents (Schema Evolution Rules, CLAUDE.md). `faqItem` stays untouched for the legacy inline data and is removed in the cleanup step; migration 008 builds `faqEntry` items from it.

### D3 — References, never copies; several sets per placement

- Every placement stores an **ordered array of references** to `faqSet` (`faqSets`). Editing a set updates every placement on the next request.
- A placement may hold **several sets**, reordered by drag. The same set cannot be attached twice to one placement (validation: unique references).
- **No per-placement overrides** (no "hide question 3 here", no "different answer on this page"). Same reasoning as ADR-022 §1: invisible, drifts over time. If a placement needs something different, **duplicate** the set (D4).

### D4 — Duplicate

"Duplicate" on a set (list row menu and editor) creates a **new draft set**: `internalName` = "Copy of <name>", all items copied with fresh `_key`s, `title` and `note` copied, attached nowhere. The editor lands in it, renames it, edits it, publishes it. Permission: `faq.set.write`.

### D5 — Placements

**Pages — `faqSection` (Studio, super admin).** New field `faqSets` (ordered references). Eyebrow, title, headline accent, background and anchor id stay as they are, so the section can still be placed anywhere on any page, any number of times. Placing and positioning sections stays a super-admin job (pages are admin-managed); **maintaining the questions is the editor's job, from the library**.

- New optional `subtitle` (`localizedText`) under the title, so the section offers the same heading pair as posts.
- `showSetTitles` (boolean, default on): when more than one set is attached, each set's `title` heads its group. With one set, the section's own title is the heading.
- The inline `items` field stays **read-only** (deprecated notice) until the conversion (Rollout step 4), and is rendered only when `faqSets` is empty. It is removed after a query proves no document uses it.

**Blog posts (dashboard + Studio).** Post-level field `faqSets` (ordered references), optional, **one choice for all languages** (the sets carry the translations, as with `post.gallery`). Rendered **below the article text, after the gallery** (Tom, 2026-10-19).

Heading, set by the editor per post, both optional and localized:

- `faqTitle` (`localizedString`). Empty → the website dictionary default: "Frequently Asked Questions" / "Domande frequenti" / "Häufig gestellte Fragen" / … (one key per platform locale).
- `faqSubtitle` (`localizedText`). Empty → no subtitle.

The heading belongs to the placement, not the set: the same set can sit under different headings on different posts. It renders only when the FAQ module is installed for the post's project; otherwise nothing, and it never breaks the post.

**Events (next).** The same fields on `event` (`faqSets`, `faqTitle`, `faqSubtitle`), the same renderer and default. Not in the first release (Tom, 2026-10-19: blog first, then events).

**Future modules.** One shared field helper (`faqSetsField()`) and one renderer make an integration a small, explicit change per module. Nothing is attached automatically: a module supports FAQs only when its schema adds the field and its detail route renders it.

### D6 — Rendering

- One server entry point, `FaqPlacement` (like `GalleryPlacement`), used by the section, the post route and later the event route. It renders the existing accordion presentation; answers stay in the server HTML.
- **Only public sets are dereferenced:** published and not archived (ADR-032 D3 rule, `optional` publishedAt variant). A draft-only or archived set renders nothing.
- **Languages: no fallback for items.** An item renders in a locale only if both its question and answer exist in that locale. A mixed-language FAQ is worse than a shorter one, and the same item must never appear in the JSON-LD in the wrong language. If no item renders, the whole block (heading included) is omitted. The Translate button fills gaps (D9).
- **Overlapping sets:** both render. The dashboard warns when two sets attached to the same placement share a question (normalised text), so the editor fixes it. No silent filtering on the website.
- One GROQ projection, `FAQ_SET_FIELDS` in `queries.ts`, serves every placement.
- Answers render through the shared Portable Text link renderer (D12): internal links resolve to the target's URL in the page's language; external links follow `link-target.ts`.
- All strings (default heading, aria labels, expand/collapse) come from locale dictionaries.

### D7 — Structured data: one `FAQPage` per URL

- All FAQ items **rendered on a page** — every `faqSection` plus a post's (later an event's) sets — are collected into **one** `FAQPage` JSON-LD block, in render order, de-duplicated by normalised question text. Never one block per section.
- Only items visible in that locale are included (D6). Nothing from draft or archived sets.
- `acceptedAnswer.text` is the answer as limited HTML (`p`, `ul`, `ol`, `li`, `strong`, `em`, `a`), which Google accepts for FAQPage. A link whose target is unavailable is emitted as plain text, never as a dead `<a>`.
- Replaces today's single-`faqSection` logic in `JsonLd.tsx`.
- Expectation, recorded so nobody oversells it: Google limited FAQ rich results to authoritative government and health sites in 2023. The value is the visible text and AI answer engines reading clean structured data, not a guaranteed snippet.

### D8 — Lifecycle and permissions

Lifecycle follows ADR-032 with the **Gallery rule (D13)**:

- States: Draft · Published · Archived (no schedule — D2). Editing a published set creates draft changes; **Publish** makes them live everywhere at once.
- **Archiving is refused while a set is used by public content**; the editor sees where. References from drafts or archived content don't block.
- Permanent delete: archived (or never-published) sets only, and any reference blocks it.

| Permission | Default roles | Covers |
|---|---|---|
| `faq.set.read` | owner, editor, viewer | View and list sets, see where they are used |
| `faq.set.write` | owner, editor | Create, edit, reorder, duplicate, publish, archive, restore |
| `faq.set.delete` | owner (Owner / Site admin) | Permanently delete |

- Attaching sets to a post needs `blog.post.write` + `faq.set.read`. Creating a new set from the post editor also needs `faq.set.write`.
- Placing an `faqSection` on a page is Studio-only (super admin).
- All checks server-side through `assertModuleAction` / the lifecycle guard; the UI only hides. Activity rows go to `content_audit_log` like every lifecycle type.

### D9 — Client dashboard experience

Built only from Component Lab components (`src/lab/registry.ts`); anything new becomes a shared component with a Lab entry before a second screen uses it.

**Library — side nav "FAQ Sets".** A *Content*-kind list screen, like Galleries: ListToolbar + DataTable + ContentCard grid + ViewSwitch (list first, remembered per person).

- Columns: Name · Questions (count) · Languages (a "Missing DE" marker when a site language is incomplete) · Used in (count, opens the list) · Status · Updated.
- Card: name, question count, the first two questions, Used in.
- Search matches set names **and** question text, in all languages.
- Row menu: Edit · Duplicate · Archive / Restore · Delete permanently (when allowed).

**Creating a set.** "New FAQ set" asks for the name only, then opens the editor. No multi-step wizard: a set is a name plus a list.

**Editor.**

- A reorderable list of question/answer cards: add, edit in place, drag to reorder, remove.
- Language switch for the site's languages; untranslated items marked "Not translated". Translate button when the Translate module is installed and dashboard translation exists.
- Autosave to the draft (platform rule); Publish to go live.
- **"Used in" panel** with links to every page, post and event using the set.
- **Shared-content warning:** when the set is used in more than one place, a banner in the editor and the Publish confirmation say so: "Used in 4 places: Home, Implants, 2 posts. Changes appear everywhere when you publish."
- Duplicate is available from the editor too (D4).

**Attaching to a post.** A "FAQs" panel in the post editor (ADR-025 direct editor), not a new wizard step:

1. "Add FAQs" opens a sheet with two options: **Choose existing** (search the library; a preview of each set's questions) and **Create new** (creates a set named after the post, edited inside the sheet, attached on save).
2. Attached sets are listed in order: reorder, remove, open in the library.
3. Publishing a post that references a set that has never been published offers "Publish the FAQ set too" through the shared publishing component (same pattern as Catalogue "publish with dependencies"). A disabled Publish explains why (platform UX rule).

Phase 2 adds **Generate with AI** as a third option in the same sheet (D11).

### D10 — Studio

- *FAQ sets* collection per project.
- `faqSection.faqSets` and `post.faqSets` pickers list only the project's own sets; Sanity's reference input lets the super admin create a new set without leaving the page.
- After conversion the inline `items` field is hidden.

### D11 — Phase 2: AI generation (shape reserved, not built here)

Recorded so phase 1 doesn't block it; it gets its own amendment or ADR, including the cost analysis Tom asked for before deciding how to sell it.

- "Generate with AI" in the Add FAQs sheet: choose 3, 5 or 7; the AI reads the current post; it proposes questions and answers; the editor edits, discards or accepts each; the result is saved as a **new draft set** and attached.
- Suggestions for an **existing** set arrive as draft changes and need an explicit Publish. AI never publishes, and never changes a shared set by itself.
- Runs on the ADR-026 provider layer: provider chosen in the FAQ module config (one configuration surface, ADR-014), keys in env vars only, **Grok / xAI never offered**, every call metered per project (the Translate `translation_usage` pattern), the site's tone of voice applied. Bring-your-own-key for tenants is later.

### D12 — Answer formatting and links (Tom, 2026-10-19)

**Questions** are plain text. **Answers** are restricted rich text.

| Allowed | Not allowed |
|---|---|
| Paragraphs, bold, italic, bullet and numbered lists, internal links, external links | Headings, images, video, tables, colours, font sizes |

- `faqAnswerText` is a localized Portable Text type: block style `normal` only, lists `bullet` and `number`, decorators `strong` and `em`, and the **existing `bodyLinkAnnotation`** as the only annotation. One restricted toolbar, the same everywhere a set is shown. It carries the hidden `translationStatus` like every localized type.
- No character limit; the editor's help text asks for short answers.

**Links reuse what the platform already has.** `bodyLinkAnnotation` (`schema.ts`, used in `localizedPortableText` today) already gives:

| Requirement | Already true today |
|---|---|
| Internal link = stable reference, not a URL | `internal`: a reference to a `page`, `post`, `newsArticle` or `event` of the same project (Catalogue items and collections added — see below) |
| Target renamed | Link keeps working (references point at the document id) |
| Target's URL changes | Link follows automatically (resolved at render, in the page's language) |
| Target unpublished, archived or deleted | Link renders as plain text, never a dead link |
| External link | `href`, with automatic new-tab behaviour (`link-target.ts`) and safe-href checks (`safe-href.ts`) |

So the FAQ module adds **no new link system**. It uses the shared annotation and the shared resolver, which is the platform-wide capability Tom asked for.

What the FAQ editor adds on top:

- **Catalogue targets (Tom, 2026-10-19):** `bodyLinkAnnotation.internal` also accepts `catalogueItem` and `catalogueCollection`, resolved through the Catalogue module's own route (its configured segment). This benefits post bodies too. A link to a Catalogue item renders only while the Catalogue module is installed and the item is public; otherwise plain text.
- **Link dialog (dashboard).** Two tabs: **Internal link** and **External link** (URL). Internal link must make finding the target very easy:
    - one search box matching titles in **all** the site's languages, results as you type;
    - **type filter chips** (Pages · Posts · News · Events · Catalogue), showing only types the site actually uses;
    - each result shows its title, type, status and URL path, so two similar titles are told apart;
    - with an empty search, the most recently edited content is listed first;
    - only content that can have a public URL is offered.
  One shared Lab component, reused later by the post editor.
- The set editor marks a link whose target is unavailable or has no URL in the current language ("Not available in DE"), so the editor sees it before visitors do.
- The "Used in" logic of D9 also lists **"Linked from"**: when someone archives or deletes a page, post, event or Catalogue item, Abluo shows which FAQ sets (and later post bodies) link to it.
- **Warn, never block (Tom, 2026-10-19).** Internal links stay **weak** references. Archiving or permanently deleting linked content is allowed; the confirmation lists every FAQ set that links to it ("Linked from 3 FAQ sets: …"), and those links become plain text. An FAQ answer never stops someone from removing content they're allowed to remove.
- **No automatic 301s in this ADR (Tom, 2026-10-19).** In the dashboard a published URL never changes (`post-publish.ts`: an already-published language keeps its slug), and internal links follow any change made in Studio. Only a super-admin slug edit in Studio moves a URL, and `redirectFrom` covers it by hand. Kept as a platform backlog item for all routable types.

## Rejected alternatives

- **Keep the inline section next to the library.** Two systems, duplicated content, Sections-vs-Modules violation.
- **A `faq[]` field on each module's documents** (the original D5 plan). No reuse; the same answer typed in 15 events.
- **Per-placement overrides.** See D3. Duplicate instead.
- **Picking individual questions from a set.** Same drift problem at question level. Sets are kept small and focused instead.
- **One `FAQPage` per section.** Google expects one `FAQPage` per page; one merged block (D7).

## Data and rollout safety

Every schema change is **additive** until the final cleanup. No field changes type.

Following the 2026-08-14 lesson (never migrate data ahead of the code that reads it) and the ADR-022 precedent:

1. **Ship the reading code first.** `faqSet`, the module manifest, `faqSets` on `faqSection` and `post`, `FaqPlacement`, merged JSON-LD. The section reads `faqSets`, else inline `items`. The post reads `faqSets`, else the legacy `faq` array (declared in the schema as a hidden, read-only field, so the imported data is typed and the "unknown field" disappears).
2. **Install migration `007-install-faq-module.ts` — run BEFORE the deploy that reaches production.** `faqSection` becomes a module section, and module sections render only where the module is installed. Without this step the 6 FAQ sections disappear on deploy. Installs `faq` on `abluo`, `cyce`, `hoffmann`, `nologo`, `studiomartegani` (every project with an `faqSection` or a `post.faq`, re-queried at run time). Safe before the deploy: production code ignores installation ids it doesn't know.
3. **Deploy and verify** the 6 pages render unchanged, through dev → preview → main.
4. **Conversion migration `008-faq-inline-to-sets.ts`** (dry-run report first, then apply):
   - Each inline `faqSection` → one `faqSet` (`internalName` = "<page name> — FAQ"), `faqSets` = [that set], inline `items` unset.
   - Each post `faq[]` → one `faqSet` ("<post title> — FAQ"), `post.faqSets` = [that set], `faq` unset.
   - Every `faqItem` becomes a `faqEntry` keeping its `_key`: the question is copied as is; the plain-text answer becomes Portable Text, one `normal` block per paragraph (split on blank lines), per locale, with `translationStatus` preserved. The dry run shows each converted answer next to the original.
   - A draft and its published document share **one** set, built from the published version; if the draft's FAQ differs, the report lists it for manual review instead of guessing.
   - Expected result: 20 sets (6 from sections, 14 from posts), 106 items.
5. **Cleanup (separate, later):** remove inline `faqSection.items`, the legacy `post.faq` and the `faqItem` type from the schema only after a query confirms no document uses them.

## Delivery slices

1. **Module and rendering.** Manifest, schema move, `faqSet`, `faqEntry`, `faqAnswerText`, `faqSets` + `faqTitle`/`faqSubtitle` on post, `faqSets` + `subtitle` on section, legacy reads, `FaqPlacement`, merged `FAQPage`, Studio collection, migration 007. Tests: fallback order, locale filtering, JSON-LD merge and de-duplication, draft/archived sets excluded, module-not-installed renders nothing, registry validation.
2. **Conversion.** Migration 008 with dry-run report; verify every converted page and post against the dry run.
3. **Dashboard library.** List, editor, Duplicate, Used in, shared-content warning, lifecycle actions, permissions, Activity. Verified against `docs/engineering/client-dashboard/verification.md`.
4. **Post attachment.** FAQs panel and sheet (choose existing / create new), publish-with-dependencies.
5. **Events.** `event.faqSets` and rendering on the event route.
6. **Phase 2 — AI** (separate ADR/amendment, D11).

## Resolved questions (Tom, 2026-10-19)

1. **Name:** "FAQ set"; side nav and screen title "FAQ Sets".
2. **Order on a post:** text → gallery → FAQs.
3. **Heading on a post:** editor-set title and subtitle per post; empty title → "Frequently Asked Questions" (localized default); empty subtitle → none.
4. **Answer format:** restricted rich text with internal and external links (D12). Questions plain text.
5. **Deleting linked content:** warn, don't block (D12).
6. **Automatic 301 on URL change:** not now. Dashboard URLs never move once published; Studio slug edits are rare and handled with `redirectFrom`. Platform backlog.
7. **Catalogue items and collections as link targets:** yes, with a link dialog built for fast search and type filtering (D12).
8. **Translate on answers:** answers ship as rich text now; the Translate button covers questions from day one and answers once Translate's rich-text slice lands. Revisited after the module is built.

## Implementation map (planned)

| Concern | Where |
|---|---|
| Schema, manifest, section map | `src/lib/modules/faq/`, `src/lib/modules/registry.ts` |
| Shared field helper | `src/lib/modules/faq/fields.ts` (`faqSetsField()`) |
| One GROQ projection | `FAQ_SET_FIELDS` in `src/lib/sanity/queries.ts` |
| Locale filtering, de-duplication, JSON-LD | `src/lib/faq/` |
| Placement (server) | `src/components/faq/FaqPlacement.tsx` |
| Website strings | website locale dictionaries |
| Dashboard library and editor | `src/components/client/faq/`, `src/lib/api/faq-sets.ts` |
| Migrations | `src/lib/sanity/migrations/007-install-faq-module.ts`, `008-faq-inline-to-sets.ts` |

# Architecture Decision Log

This document records architectural decisions made for the Abluo platform.
Each entry is immutable — it is a historical record of why a decision was made at the time.
If a decision is later reversed or superseded, a new ADR is created referencing the original.

For the current state of the architecture (field ownership, inheritance model, active vs legacy fields),
see [`docs/config-architecture.md`](./config-architecture.md).

---

## ADR Template

```
## ADR-NNN — Title

**Status:** Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Supersedes:** — | ADR-NNN
**Superseded By:** — | ADR-NNN

### Context
Why was this decision needed?

### Alternatives Considered
- Option A — reason rejected
- Option B — reason rejected

### Decision
What was chosen and why.

### Consequences
**Positive:**
- …

**Negative:**
- …
```

---

## ADR-001 — `projectSlug` is the universal tenant identifier

**Status:** Accepted
**Date:** 2025-01-01
**Supersedes:** —
**Superseded By:** —

### Context

Abluo is a multi-tenant platform. Every piece of content in Sanity must be scoped to the correct tenant, and queries must be impossible to cross-contaminate between tenants. A stable, human-readable key is needed that works across Sanity, Next.js routing, and Supabase.

### Alternatives Considered

- Sanity document `_id` — opaque, not stable across environments
- Supabase UUID — not present in Sanity documents
- `tenantSlug` from the `client` document — introduces an extra join for every query

### Decision

Every Sanity document that belongs to a tenant carries a `projectSlug` string field. All GROQ queries must include `&& projectSlug == $projectSlug`. `tenant_id` does not exist anywhere in the platform.

### Consequences

**Positive:**
- Every query is self-contained and tenant-safe
- `projectSlug` is readable in Studio, URLs, and logs
- No implicit scoping — misuse is visible and auditable

**Negative:**
- Every new document type must explicitly add the field
- Renaming a tenant's slug requires a data migration

---

## ADR-002 — Design System controls visual language; Site Settings controls business identity

**Status:** Accepted
**Date:** 2026-06-01
**Supersedes:** —
**Superseded By:** —

### Context

As the platform grew, visual configuration (colors, fonts, radii) and business identity (logo, site name, contact info) were mixed in both the `siteConfig` and `designSystem` documents. This caused confusion about where to put new fields and duplicated some fields across both documents.

We needed a clear, permanent rule that could be applied to every future field decision without judgment calls.

### Alternatives Considered

- Everything in `designSystem` — designers control everything, but clients can't self-serve identity changes without Sanity access
- Everything in `siteConfig` — clients control too much, design system loses its role as a locked visual contract
- Feature-based split (e.g. "header fields go here") — not principled, breaks down as features grow

### Decision

**`siteConfig` = who the client is.** Fields that describe the client's business identity: name, logo, contact info, favicon, OG image, SEO defaults, navigation, social links.

**`designSystem` = how the site looks.** Fields that describe the visual language: colors, typography, spacing, radius, motion, surfaces, forms, buttons. No identity assets.

The test: *"Would this field change if the client rebranded, moved offices, or changed their phone number?"* → `siteConfig`. *"Would this field change if the designer updated the colour palette or switched fonts?"* → `designSystem`.

### Consequences

**Positive:**
- Every new field has an unambiguous home
- Clients can update identity (logo, contact, SEO) without touching design
- Platform owners can update visual language without touching client data
- Fields in the wrong place become clearly visible as violations

**Negative:**
- Some fields (logo height) sit on the boundary and require a documented exception
- Existing duplicated fields (logo in both documents) require migration before the boundary is clean

---

## ADR-003 — Identity assets are LOCAL ONLY in Design System inheritance

**Status:** Accepted
**Date:** 2026-01-01
**Supersedes:** —
**Superseded By:** —

### Context

The `designSystem` inheritance model allows child tenants to inherit visual tokens from a parent template (e.g. Abluo Base). Without an explicit rule, a child DS with no logo set would inherit the parent DS's logo — showing Abluo's brand marks on a client site.

### Alternatives Considered

- Inherit everything including identity — simple, but causes cross-tenant identity leaks
- Never inherit anything — safe, but defeats the purpose of the inheritance system
- Inherit identity only when explicitly opted in — complex to implement and explain

### Decision

The following fields are **LOCAL ONLY** — they are never inherited from a parent design system, regardless of whether the child has a value set:

- `branding.logo`
- `branding.logoLight`
- `branding.favicon`
- `branding.openGraphImage`
- `branding.appleTouchIcon`

All other fields use INHERIT WITH OVERRIDE semantics (child wins if set, parent fills in gaps).

**Exception:** `branding.logoHeightDesktop` and `branding.logoHeightMobile` ARE inherited — they are sizing design tokens, not identity assets. A parent DS can define sensible defaults that child tenants inherit.

This rule is encoded in `mergeDesignSystems()` in `design-system-resolver.ts` and documented in that file's header comment.

### Consequences

**Positive:**
- Zero risk of cross-tenant identity leaks
- Rule is explicit in code, not implicit in data
- Exception for sizing tokens is principled and documented

**Negative:**
- Every child DS must explicitly upload its own identity assets — no shortcut inheritance
- A new developer could add a field to the LOCAL ONLY list incorrectly if not aware of the distinction

---

## ADR-004 — `DS_FIELDS_SELECTION` is the single GROQ source of truth for Design System fields

**Status:** Accepted
**Date:** 2026-01-01
**Supersedes:** —
**Superseded By:** —

### Context

Design system fields are fetched in multiple queries across the codebase. Without a single source of truth, adding a new DS field requires finding and updating every query that touches the design system — easy to miss, silent when wrong.

### Alternatives Considered

- Inline field projections per query — flexible but fragile; fields get missed
- Generated types from Sanity schema — adds build complexity; schema and queries can still drift
- A shared GROQ fragment constant — explicit, single update point, easy to audit

### Decision

`DS_FIELDS_SELECTION` in `src/lib/sanity/queries.ts` is the **only** GROQ projection for design system fields. Every query that fetches a design system uses it. Adding a new DS field to any other projection first is a bug.

The checklist for adding a new DS field (in `CLAUDE.md`) enforces this by making `DS_FIELDS_SELECTION` step 2, before any component or CSS work.

### Consequences

**Positive:**
- One change propagates to all consumers
- Audits are simple — read one constant to know what the frontend can see
- Drift between schema and query is immediately visible

**Negative:**
- All DS queries fetch all DS fields, even when a specific query only needs a subset — acceptable overhead for this data size

---

## ADR-005 — Every Design System field must have a downstream frontend consumer

**Status:** Accepted
**Date:** 2026-06-01
**Supersedes:** —
**Superseded By:** —

### Context

During the DS inheritance audit (June 2026), several fields were found fully defined in schema, projected in GROQ, resolved by the inheritance resolver, and stored in the DesignSystem TypeScript type — but never emitted as a CSS variable and never read by any component. These fields are invisible at runtime.

Fields with no consumer add schema complexity and maintenance burden with zero user value. They also create false confidence: an admin sets a value in Studio and nothing changes.

### Alternatives Considered

- Keep unused fields "for future use" — deceptive; Studio shows them as editable but they have no effect
- Mark them deprecated but leave them — acceptable temporarily, must not become permanent
- Remove them immediately — risky if content exists; requires migration check first

### Decision

Every field in the `designSystem` schema must satisfy at least one of:

1. Emits a CSS custom property via `buildCssVars()` in `layout.tsx`, **or**
2. Is read directly by a component (e.g. `ButtonDS`), **or**
3. Is explicitly marked `🚧 Planned` in `config-architecture.md` with a target phase

Fields that satisfy none of the above are classified `🗑️ Candidate for removal` and must be removed in the next available cleanup phase after confirming no documents have content in them.

The five-step checklist for new DS fields (in `CLAUDE.md`) enforces this at creation time.

### Consequences

**Positive:**
- Studio shows only fields that have real effect — no silent no-ops
- Maintenance burden stays proportional to what is actually used
- Audits are straightforward: grep for CSS var or component usage

**Negative:**
- Planned fields cannot be added to the schema until the frontend consumer is ready to ship in the same phase (or they must be explicitly marked Planned)

---

## ADR-006 — Incomplete font stubs must not shadow parent fonts in DS inheritance

**Status:** Accepted
**Date:** 2026-06-25
**Supersedes:** —
**Superseded By:** —

### Context

Sanity allows saving partial font objects — e.g. a user opens the font picker, selects `source: library`, and saves without choosing a font name. The result is `{ source: 'library' }` with no `libraryFont`. This object is truthy in JavaScript, so the naive `||` merge in `mergeDesignSystems()` treated it as a valid override, silently discarding the parent's fully-specified font.

The concrete failure: studiomartegani DS had a `{ source: 'library' }` stub, which blocked inheritance of `{ source: 'library', libraryFont: 'Geist' }` from the parent. `getFontName()` fell back to 'Barlow Condensed' (the hardcoded CSS default), while the fonts URL still loaded Geist — causing a mismatch that rendered system sans-serif.

### Alternatives Considered

- Data-only fix: delete stubs from Sanity Studio — solves the immediate case but does not prevent recurrence
- Schema validation: require `libraryFont` when `source === 'library'` — catches new documents but does not fix existing ones, and validation errors in Studio are disruptive
- Code fix: treat a font as undefined unless it has a usable name — prevents recurrence for all tenants, testable

### Decision

Added `isFontDefined(font)` to `design-system-resolver.ts`. A font is considered defined only when:
- `source === 'library'` and `libraryFont` is a non-empty string, **or**
- `source === 'google'` and `googleFont` is a non-empty string

`headingFont` and `bodyFont` in `mergeDesignSystems()` use this guard instead of `||`. An incomplete stub falls through to the parent value.

5 new tests added to `design-system-resolver.test.ts` covering: library stub, google stub, empty string, complete override, and no typography set.

### Consequences

**Positive:**
- Robust against partial saves from any tenant, now and in future
- Testable and tested
- Studio stubs become harmless rather than dangerous

**Negative:**
- A child tenant that intentionally sets `source: 'library'` with no font name expecting to "clear" the parent font will instead inherit the parent — but this is the correct semantic; clearing should be done by removing the font field entirely

---

## ADR-008 — Design System Inheritance Categories

**Status:** Accepted
**Date:** 2026-06-25
**Supersedes:** —
**Superseded By:** —

### Context

The `mergeDesignSystems()` function in `design-system-resolver.ts` had grown organically — each new field category introduced its own merge pattern without a shared model. Three different patterns were in use (`||`, `!== undefined`, `mergeShallowObject`), applied inconsistently across fields of the same semantic type. The font stub bug (ADR-006) and the typescale shadowing bug were both symptoms of the same root cause: object-typed fields using `||`, which treats any truthy object as a complete override.

The inheritance engine needed a formal model so that any developer adding a field can determine the correct merge strategy without judgment calls.

### Alternatives Considered

- Field-by-field case analysis — correct in the short term, does not scale; each new field adds a new bespoke decision
- Single generic deep-merge — over-engineered; many DS fields are intentionally NOT deeply merged (LOCAL ONLY, DISCRIMINATED)
- Categorised model with canonical helpers — requires upfront design work, but produces a stable, auditable engine

### Decision

All Design System fields are classified into one of seven inheritance categories. Each category has a canonical merge strategy:

| Category | Merge strategy | Examples |
|---|---|---|
| **LOCAL ONLY** | Never inherited — parent value is permanently ignored | `branding.logo`, `branding.favicon`, `branding.openGraphImage` |
| **PRIMITIVE STRING** | `\|\|` — child non-empty string wins, else parent | All color values, easing strings |
| **PRIMITIVE NUMBER** | `!== undefined` — child wins if not undefined (0 is a valid override) | Radius, spacing, durations, logoHeight |
| **DISCRIMINATED** | Validity guard before treating object as "set" | `typography.headingFont`, `typography.bodyFont` — guarded by `isFontDefined()` |
| **FLAT MERGE** | `mergeShallowObject<T>` — field-by-field; each primitive field inherits independently | ColorTheme, Typescale (h1–small), GlassStyle, FormInputTheme |
| **THEME PAIR** | Apply FLAT MERGE to `lightTheme` and `darkTheme` independently | `colors`, `buttons.primary`, `sectionSurfaces`, all form inputs |
| **KEYED ARRAY** | `mergeArrayByKey<T>` — parent baseline, child overrides by `.key` or appends | `backgroundAssets`, `cardVariants` |

**The overarching rule:**

> **A partial child object must not shadow a complete parent object unless the field is explicitly LOCAL ONLY.**
>
> This means: object-typed fields must never use `||` at the object level. A child object that is truthy but incomplete (e.g. a Typescale with only `size` set, a FontDefinition with only `source` set) must be merged at the field level, not treated as a whole-object replacement.

The DISCRIMINATED category is a refinement of FLAT MERGE for objects where field-level merge alone is insufficient — a partial stub can pass field-level merge but still be semantically unusable. `isFontDefined()` implements the validity guard.

### Consequences

**Positive:**
- Every field in `mergeDesignSystems()` maps to a named category and a canonical helper
- Adding a new DS field is a lookup, not a judgment call
- The typescale bug, the font stub bug, and any future partial-object shadowing bugs are all addressed by the same principle
- Redundant one-off merge functions (`mergeColorTheme`, `mergeGlassStyle`, `mergeCardStyleTheme`, `mergeFormInputTheme`) can be removed in a cleanup phase — they are all FLAT MERGE objects that `mergeShallowObject` already handles correctly

**Negative:**
- The redundant functions are correct today and removing them is a separate phase — the code has more functions than the model requires until cleanup is complete
- NESTED MERGE objects (`ButtonStyleTheme` with `hover`, `SectionSurfacesTheme` with `glass`) require dedicated functions that are not yet unified under a single `mergeNestedObject` helper

---

## ADR-007 — Each phase and each commit must leave the project in a deployable state

**Status:** Accepted
**Date:** 2026-06-01
**Supersedes:** —
**Superseded By:** —

### Context

Multi-phase architectural refactoring carries the risk of leaving the codebase in a broken intermediate state between phases. A deployment pipeline that triggers on push (as Vercel does) makes this failure visible immediately and potentially disruptive to live tenants.

### Alternatives Considered

- Long-lived feature branches merged in one shot — defers integration risk, large diff is hard to review
- Work in progress commits on feature branches — acceptable if the branch is never deployed; Vercel preview deployments make this risky
- Each commit deployable, phased — more discipline required but each checkpoint is independently verifiable

### Decision

Every commit on every branch must pass:
1. `npx tsc --noEmit` — TypeScript clean
2. `npx vitest run` — all tests passing
3. `npm run build` — production build clean (required before any promotion)

Phase boundaries are natural commit points. Each phase is designed to be a complete, self-contained improvement that does not break anything already working.

The deployment pipeline is: `feature branch → dev → preview → main`. Each stage requires explicit sign-off before promotion. No automatic continuation.

### Consequences

**Positive:**
- Any commit can be deployed safely — no broken intermediate states
- Rollback is a one-commit revert, not a multi-file surgery
- Review is meaningful — each diff represents a working state

**Negative:**
- Cannot split a refactor across commits if the intermediate state is broken — must design phases so each one is independently complete

---

## ADR-009 — Pages, Collections, and Modules

**Status:** Accepted
**Date:** 2026-06-25
**Supersedes:** —
**Superseded By:** —

### Context

The Sanity Studio navigation grew organically as new document types were added. By mid-2026, the per-project navigation mixed page-level singletons (livePage, eventsPage) with content collections (Events, Blog Posts) inside a single "Pages" section, and duplicated the word "Pages" across two nesting levels.

Concretely:
- Reaching a page required: click project → click Pages → click Pages (again) → click the document
- The `/blog` route had no editable Sanity document; its hero and SEO content was hardcoded in a TypeScript file (`news-page-messages.ts`), violating the principle that page content belongs in the CMS
- The `navigationLink` schema used a special `internalPage` enum to reference routes like `/live`, `/events`, and `/blog` precisely because those routes lacked Page documents
- Collections (Events, Blog Posts) were categorised alongside Pages, hiding the distinction between "things that are website routes" and "things that are content displayed by routes"
- Collections were listed in a flat structure with no grouping, making the Studio harder to scale as new modules are added

### Alternatives Considered

- Keep the current structure and improve labels only — reduces confusion slightly but does not fix the routing gap or eliminate the extra click layer
- Make every page a section-composed `page` document — would make `livePage`, `eventsPage` unnecessary; inconsistent with their fixed rendering contracts (a blog listing page is not section-composed)
- Enumerate page documents as individual top-level Studio nav items — only works for singletons; `page` documents are dynamic and cannot be pre-enumerated
- Group collections by document type rather than by module — flat, does not scale, and obscures the relationship between a page and the collections it displays

### Decision

**Core principle: Pages own presentation. Collections own data. Modules own capabilities.**

Four rules formalised:

**Rule 1 — Every public route has exactly one singleton Page document.**
A route that renders content but has no corresponding editable Sanity document is a gap. Every public URL (`/`, `/blog`, `/events`, `/live`, `/privacy-policy`, etc.) must have a document that controls its hero, intro text, and SEO.

**Rule 2 — Pages and Collections are different concepts.**
*Pages* are website routes — each one maps to a URL. *Collections* are reusable content that pages may display. Collections are never pages. Pages may display one or more collections.

Studio navigation reflects this separation. The per-project structure is:

```
[Project]
  Pages       → all singleton page documents
  Collections → reusable content, grouped by module
  Media
  Design System
  Settings
```

**Rule 3 — Every public page has exactly one page query.**
Hero content, intro text, and SEO fields are never sourced from hardcoded TypeScript files. Each page type has its own named GROQ query (`homePageQuery`, `blogPageQuery`, `eventsPageQuery`, `livePageQuery`). Hardcoded strings are acceptable only as a graceful fallback while a new Sanity document is being created for a tenant.

**Rule 4 — Collections are grouped by module.**
A *module* is a self-contained capability that owns its pages, collections, queries, frontend behaviour, and future permissions. Collections inside the Studio are organised under their owning module, not flattened into a single list.

Current modules:

| Module | Pages | Collections |
|---|---|---|
| Blog | Blog Page | Posts, Categories, Authors |
| Events | Events Page | Events |
| Live | Live Page | — |

Future modules follow the same pattern:

| Module | Pages | Collections |
|---|---|---|
| Shop | Shop Page | Products, Categories |
| Booking | Booking Page | Reservations |
| CRM | — | Contacts |

### Module Provisioning (future workflow)

Today, all modules are visible to every project in Studio regardless of which modules the client actually uses. The long-term provisioning model is:

1. Create Tenant (Supabase)
2. Create Project (Supabase)
3. Link Project ↔ Sanity
4. Enable Modules for the project
5. Provision only the Pages and Collections required by the enabled modules

Under this model, a project's Studio navigation is generated from its module configuration — it never shows modules the client has not enabled.

Example configurations:

| Tenant | Blog | Events | Live | Shop |
|---|---|---|---|---|
| Dentist | ✓ | ✗ | ✗ | ✗ |
| Livener | ✓ | ✓ | ✓ | ✗ |
| Future ecommerce | ✓ | ✗ | ✗ | ✓ |

This provisioning model is not yet implemented. The Studio currently shows all modules for all projects. The module grouping in the Collections section is the foundation for this future capability.

### Consequences

**Positive:**
- Every public URL is editable in Studio without special-casing
- Studio navigation reflects the semantic structure of the website rather than the order in which modules were built
- The `internalPage` special enum in `navigationLink` can eventually be removed — all routes will have Page documents reachable via `pageRef`
- New modules have a clear home in the information architecture
- Hardcoded page content is eliminated as a pattern
- Collections grouped by module scale naturally — adding a Shop module means adding a Shop sub-group, not expanding a flat list

**Negative:**
- Each new public route requires a new singleton document type (schema + query + type + initial value template), rather than just a Next.js route file
- Tenants that have not yet created a Page document for a route must rely on fallback content until they do
- The `blogPage` singleton introduced by this ADR follows the `livePage`/`eventsPage` pattern (fixed fields) rather than section composition — this is intentional given the fixed rendering contract of a listing page, but it means adding new content blocks to the blog listing requires a schema change
- Module provisioning is documented but not yet implemented — all modules are currently visible to all projects

---

## ADR-010 — Module-Driven Studio Navigation

**Status:** Accepted
**Date:** 2026-06-25
**Supersedes:** —
**Superseded By:** —

### Context

ADR-009 established the conceptual model: Pages, Collections, and Modules. The Studio implementation that followed correctly introduced the separation between Pages and Collections, and grouped Collections by module. However, two problems remained:

**Problem 1 — All modules shown to all projects.** Martegani (a dental studio using only the Blog module) saw Live Page, Events Page, and the Events collection in its Studio navigation. These belong to Livener's modules. A Martegani editor opening the Studio sees functionality that does not belong to their project.

**Problem 2 — Schema type names exposed as navigation folders.** The Pages section presented an intermediate "All Pages" folder, plus separate "Blog Page", "Events Page", and "Live Page" sub-folders. These names mirror internal Sanity document types (`blogPage`, `eventsPage`, `livePage`) — implementation details that have no meaning to a website editor. Reaching any page required at least one extra click through a folder that served no editorial purpose.

These two problems share a root cause: the Studio structure was generated from the schema, not from each project's actual configuration.

### Alternatives Considered

- **Infer enabled modules from the existence of published documents** — fragile; a project could have a lingering document from a module it no longer uses, or not yet have a document for a module it does use. Module enablement should be declared, not inferred.
- **Store module configuration in Supabase** — authoritative long-term, but the Structure Builder runs inside Sanity Studio and has no Supabase connection without additional credential wiring. Adds complexity that buys nothing at this stage. Revisit when billing or runtime gating require it.
- **Generate a separate Studio deployment per project** — complete isolation but eliminates the single-admin-sees-all-projects capability that makes the platform manageable.
- **Keep schema-type folders but rename them** — reduces confusion slightly but does not fix the extra click, does not hide schema names, and does not solve project-specific navigation.

### Decision

**Phase 1 — Studio navigation only. No Module Manager, no provisioning UI, no frontend changes.**

#### 1. `enabledModules` on the `project` document

A new `enabledModules: string[]` field is added to the Sanity `project` document. Values are drawn from a fixed set of module IDs (`blog`, `events`, `live`, …). This is the single source of truth for which modules belong to a project.

The field is managed by the Abluo platform admin directly in Studio. No client ever sees or edits it. Module management UI (install, remove, version, license) is a future ADR.

#### 2. `MODULE_REGISTRY` as the canonical source of Studio labels

A `MODULE_REGISTRY` constant in `sanity.config.ts` is the single definition of every module. Each entry declares:

- `id` — machine identifier (`'blog'`, `'events'`, `'live'`)
- `label` — canonical Studio label for the module's singleton page
- `pageType` — the Sanity document type for the singleton page
- `collectionItems` — the collection sub-list items this module contributes

Adding a new module means adding one entry to `MODULE_REGISTRY`. Nothing else changes.

#### 3. Flat Pages section

The Pages section is rebuilt as a flat list of individual document items — no intermediate folders, no schema-type labels. Two categories of items, in order:

1. **General pages** (`page` documents) — one item per published document, in creation order. The item label is the page's `title` field (see *Studio Label Concepts* below).
2. **Module singleton pages** — one item per enabled module that has a page type, in module registry order. The item label is the module's canonical Studio label from `MODULE_REGISTRY`.

Each item uses `S.document().documentId(id).schemaType(type)` to open the document directly — one click from the project nav to the document editor.

#### 4. Module-filtered Collections section

The Collections section renders only the collection groups for modules in `project.enabledModules`. Projects with no collection-bearing modules omit the Collections section entirely.

### Studio Label Concepts

The Studio uses three distinct label concepts that must never be conflated:

| Concept | What it is | Source | Example |
|---|---|---|---|
| **Studio label** | The name shown in the Admin UI navigation | `MODULE_REGISTRY` (singletons) or document `title` (general pages) | "Blog", "Home", "Contact" |
| **Navigation label** | The link text shown in the website's nav menu | `siteConfig.navLinks[].label` (localised) | "Blog", "Notizie" |
| **Page title** | The H1 / hero heading on the website | Page document content field | "Latest news from Livener" |

These are three different values and can differ independently. Changing the hero title of the Blog page does not and must not change its Studio navigation label.

#### System pages (module singletons)

System pages exist because the module exists, not because an editor named them. Their Studio label is a system fact — it comes from `MODULE_REGISTRY`, not from any content field. The Studio label for `blogPage` is always "Blog", regardless of what `heroTitle.en` contains.

#### General pages

General `page` documents are created by editors. Their Studio label is currently derived from their `title` content field. This is an implementation choice, not an architectural requirement. If Abluo later introduces an internal page label (for example `internalTitle` or `studioLabel`), the Studio should derive the label from that field instead.

The subtle but important distinction is that the Studio derives its label from the title today. The title is not inherently the Studio label. The code comment at the relevant location documents this intent.

#### Admin UI language

Studio labels belong to the Admin UI, not to website content. They are resolved using the Admin UI language, which is currently English. The structure builder resolves general page titles as `coalesce(title.en, title.it)` — English first.

Today the reference implementation resolves English first. This reflects the current implementation, not the architecture. In the future, the Admin UI language will be user-configurable (for example English, Italian, or German) and completely independent of the project's content locales. Studio labels must always be resolved using the current Admin UI language rather than the website's content language.

When the Admin UI language becomes user-configurable, the title resolution should switch to `coalesce(title[$adminLocale], title.en, title.it)`. The English-first fallback is the correct interim behaviour, not a hardcoded constraint.

Studio labels must never be resolved using the project's content locales (`siteConfig.supportedLocales`). A Livener editor switching between English and Italian content views must see the same Studio navigation labels throughout.

### Consequences

**Positive:**
- Martegani editors see only Blog Pages and Blog Collections — no Events, no Live
- Livener editors see all three modules — Blog, Events, Live — because all three are in `enabledModules`
- No schema type name (`blogPage`, `eventsPage`, `livePage`) is visible anywhere in the Studio navigation
- Adding a new module requires one entry in `MODULE_REGISTRY` — no other changes to the structure builder
- The Pages section is one click flat — no intermediate folders
- The three label concepts (Studio / Navigation / Page title) are explicitly separated and documented

**Negative:**
- The Structure Builder now makes two async Sanity fetches per structure render (client/project data + page documents). This is negligible in practice — the structure renders once on navigation, not per keystroke
- `enabledModules` is currently managed manually via Studio or MCP. There is no provisioning UI yet — adding a new project requires a manual patch to set `enabledModules`. Module management UI is a future ADR
- New projects with no `enabledModules` set show only their general `page` documents and no Collections section. This is the correct default (empty = no modules), but requires the admin to explicitly configure modules for every new project

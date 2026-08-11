# Architecture Decision Log

This document records architectural decisions made for the Abluo platform.
Each entry is immutable — it is a historical record of why a decision was made at the time.
If a decision is later reversed or superseded, a new ADR is created referencing the original.

For the current state of the architecture (field ownership, inheritance model, active vs legacy fields),
see [`docs/config-architecture.md`](../config-architecture.md).

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

---

## ADR-011 — Module Management Architecture

**Status:** Accepted
**Date:** 2026-06-26
**Supersedes:** —
**Superseded By:** —

> Full architecture: [`docs/ADR-011-module-management-architecture.md`](./ADR-011-module-management-architecture.md)
> Implementation roadmap: [`docs/ADR-011-implementation-roadmap.md`](./ADR-011-implementation-roadmap.md)

ADR-011 defines the five-layer Module Management Architecture (Definition → Manifest → Registry → Installation → Runtime) and its phased implementation plan. The full ADR is stored as a standalone document.

This entry records implementation-level decisions made during ADR-011 execution that rise to the level of architectural commitments — decisions that are not covered by the original ADR, that constrain future phases, or that a future maintainer would need to understand to work safely in this area.

---

### Sub-decision B2 — `ModuleInstallation` Persistence Model

**Date:** 2026-06-26
**Phase:** B2 — Installation Persistence Decision (V0.9.23)

#### Context

ADR-011 Phase B1 (V0.9.22) introduced `ModuleInstallation` — a first-class installation record carrying `moduleId`, `version`, `enabled`, `installedAt`, `config`, and `provenance`. Before Phase C1 builds a Project Settings UI on top of this data, the persistence model must be committed: should `ModuleInstallation` records live as an array field on the `project` document (co-located, simple) or as a first-class Sanity document type (`moduleInstallation`) related to the project (independent lifecycle, queryable across projects)?

Phase B2 is the designated pause to make and record this decision before the Phase C2 UI is built against it.

#### Alternatives Considered

**First-class `moduleInstallation` document type** — Each installation is an independent Sanity document with a `projectRef` relation. Supports cross-project queries, independent lifecycle management, and eventual billing/entitlement attachment per installation. Rejected for this stage: no cross-project installation views exist in the current roadmap; no billing or entitlement requirement is attached to individual installations; querying a project's installations would require an additional GROQ join; and B1's working implementation would need to be undone and re-migrated as a B2a phase with no present benefit.

**Array field on `project` document (chosen)** — `moduleInstallations: ModuleInstallation[]` is a field on the existing `project` document, co-located with all other project metadata. Reads require no join. Writes are atomic with the project document. Schema is already live from B1.

#### Decision

Keep `moduleInstallations` as an array field on the `project` Sanity document. Revisit at Milestone E if any of the following conditions emerge:

- Installation count per project regularly exceeds 20
- A billing or entitlement system requires per-installation record lifecycle
- The Administration UI requires listing or filtering installations across multiple projects simultaneously
- The client CMS dashboard needs installation state without fetching the full project document

**Evidence supporting this decision:** Phase B1 implemented the array model and deployed it successfully to both current projects (`livener-main` and `studiomartegani-main`) with no schema, query, or performance issues. The unified GROQ `enabledModuleIds` projection (a `select()` expression that reads `moduleInstallations` for migrated projects and falls back to legacy `enabledModules` for unmigrated ones) is clean and adds no measurable overhead.

**No B2a is required.** The B1 implementation is the correct and complete persistence layer for the current platform stage.

#### Consequences

**Positive:**
- No additional migration is required — B1's array model is already live and validated
- Project data is self-contained in a single document fetch — no cross-document joins needed by the Studio structure builder or Project Settings UI
- The `config: Record<string, unknown>` field provides an escape valve for lightweight per-installation configuration without requiring a document type change
- C1 and C2 can build directly on the B1 schema without any preparatory data work

**Negative:**
- If cross-project installation views are required in the future, a migration from array-on-project to a first-class document type will be non-trivial — C2 builds a UI over this data, so migration must be coordinated with a C2 update
- The `config` field is untyped until modules declare config schemas — type safety is deferred to a future phase

---

### Sub-decision D4 — Future-proof Permission Model

**Date:** 2026-06-27
**Phase:** D4 — Permission Derivation (V0.9.28)

#### Context

Phase D4 introduces the permission infrastructure: `MODULE_PERMISSION_MAP`, `buildModulePermissions()`, and `canPerformModuleAction()`. Before this infrastructure is committed, the relationship between module-declared permissions and platform authorization policy must be made explicit and recorded as an architectural constraint.

The immediate implementation uses three roles (`owner`, `editor`, `viewer`) with `defaultRoles` declared on each permission. Without a recorded architectural decision, a future maintainer could reasonably read `defaultRoles` as a fixed contract between a module and the role model — causing module manifests to be modified whenever authorization policy changes, or blocking the introduction of new roles.

#### Decision

**Module permissions describe capabilities. They do not represent authorization policy.**

The following principles govern all future work in this area:

**1. Separation of concerns**

- A module declares the permissions it *introduces* — what actions it makes available on the platform (`blog.post.write`, `events.event.write`, etc.).
- Roles *grant* those permissions — which role can perform which action.
- Users *receive* roles — which user has which role on a given project.

These three concerns are independent. A module has no knowledge of which roles a specific tenant has defined, and must not be modified when roles change.

**2. `defaultRoles` are platform defaults, not fixed contracts**

`defaultRoles` on each `ModulePermissionDef` is a convenience default — the platform's best-guess assignment when a module is first installed and no tenant-specific configuration exists. It is not a binding contract between the module and any role. A future multi-role system may ignore `defaultRoles` entirely, or treat it as an install-time suggestion that is immediately overridable.

**3. Tenant-defined custom roles are an explicit design goal**

The architecture must support tenants defining custom roles without requiring any changes to module manifests or module implementations. Future roles — such as:

- Blog Editor
- Event Manager
- Live Producer
- Marketing
- Support
- or any tenant-defined custom combination

— must be achievable by assigning existing module permissions to new role definitions. A module that declares `blog.post.write` need not know whether the role holding that permission is called `editor`, `content-team`, or `blog-specialist`.

**4. Module manifests must remain policy-agnostic**

A module manifest declares what permissions exist. It never declares which users, which tenants, or which custom roles hold those permissions. Authorization policy belongs to the platform's role assignment layer — not to module declarations.

**5. Future extensibility without manifest modification**

Any future work that replaces or extends the role model — adding roles, making roles configurable per tenant, implementing ABAC, or supporting role inheritance — must be achievable without modifying existing module manifests. A change to authorization policy must not require touching `blog/registry.ts`, `events/registry.ts`, or `live/registry.ts`.

#### Implementation in Phase D4

`canPerformModuleAction()` is implemented as a pure function that accepts `modulePermissionMap` as a parameter rather than importing it directly. This keeps the platform permission layer (`src/lib/permissions.ts`) decoupled from the registry. `defaultRoles` is used as the sole grant check in D4's implementation — this is the platform default, not a permanent design ceiling.

Tenant-defined custom roles are intentionally out of scope for ADR-011. They will be addressed in a later milestone. The D4 infrastructure is designed to accommodate them without requiring changes to any module declaration.

#### Consequences

**Positive:**
- Module manifests are stable under authorization policy changes — adding, removing, or reconfiguring roles requires no module-level modifications
- Custom roles for any tenant are achievable by assigning existing module permissions to new role definitions
- `canPerformModuleAction()` can be extended to accept a tenant-specific permission overrides map without changing its callers or any module manifest
- The permission model scales to arbitrarily many roles — the module layer is fully role-count-agnostic

**Negative:**
- `defaultRoles` on each permission must be maintained as sensible platform defaults even though they are not authoritative — a poorly chosen default creates extra configuration work for every new tenant installation
- A multi-role implementation (Blog Editor, Event Manager, etc.) requires a separate platform layer to define role-to-permission mappings, which does not yet exist — tenants cannot configure custom roles until that layer is built

---

## ADR-013 — Tenant tracking & verification configuration lives in siteConfig.integrations

**Status:** Accepted
**Date:** 2026-07-10
**Supersedes:** —
**Superseded By:** ADR-014, partially — the STORAGE-LOCATION section only (`siteConfig.integrations` layout, and the Studio placement of its Studio pane). This ADR's security policy (no secrets, trusted vendors, admin-only, disabled-by-default, required `description`/`consentCategory`) and consent semantics (fail-closed under `consentModeEnabled`) remain in force, relocated onto the Integration Registry model. See ADR-014's Supersession Note for the full statement.

### Context

Websites require integration with third-party analytics, site verification, and custom tracking services: Google Analytics, Google Tag Manager, Meta Pixel, Bing Site Verification, Google Search Console verification tokens, and custom script injection. These are platform-managed integrations that clients never edit — they are business configuration owned by the Abluo admin, not tenant-specific content.

The question: where does this configuration live?

### Alternatives Considered

- **Supabase** — Operational data for most auth/leads; would fragment site configuration across two stores (Sanity for identity/navigation, Supabase for integrations). Site configuration is a cohesive whole and belongs in one place.
- **Environment variables** — Scales only to a single global deployment; Abluo is multi-tenant and per-tenant integration configuration differs by tenant, which requires a data store, not env vars.
- **Sanity siteConfig.integrations** (chosen) — Part of site identity and business configuration (ADR-002). Stored as platform-managed-only fields; clients never see them. All site settings in one document, single source of truth per tenant.

### Decision

A new `integrations` object on `siteConfig` holds all third-party integrations. The structure:

```typescript
integrations: {
  analyticsEnabled?: boolean        // Master switch, initialValue false — gates all tracking below
  consentModeEnabled?: boolean      // Records tenant consent-mode opt-in, initialValue false
  googleAnalyticsId?: string        // GA4, matches regex G-[A-Z0-9]+
  googleTagManagerId?: string       // GTM-, platform-managed
  googleSiteVerification?: string   // Search Console verification token
  bingSiteVerification?: string     // Bing verification token (msvalidate.01)
  metaPixelId?: string              // Numeric Meta Pixel ID
  customScripts?: Array<{           // Client never sees this — platform-only
    label: string                   // Internal label for admin reference
    description: string             // Required — purpose of the script (admin reference)
    placement: 'head' | 'bodyEnd'   // Script placement
    code: string                    // Arbitrary JavaScript (vetted by admin)
    consentCategory: 'necessary' | 'analytics' | 'marketing' | 'functional'  // Required, no default — forces a conscious choice
    enabled: boolean                // initialValue false — disabled until an admin explicitly enables it
  }>
}
```

**Platform consumption:**

1. **Script emission** (`src/components/TrackingScripts.tsx`):
   - Emits `<script>` tags for GA4, GTM, Meta Pixel, custom scripts
   - **Production-only**: scripts are emitted only when `isProduction()` returns true
   - Verification meta tags emitted in all environments via `generateMetadata()`

2. **Verification meta tags** (Next.js `Metadata.verification`):
   - Google: `google-site-verification`
   - Bing: `msvalidate.01`
   - Emitted in all environments (dev, preview, production)

3. **Component mounting**:
   - `TrackingScripts` mounted in both tenant layout branches:
     - `src/app/[locale]/(website)/[tenant]/layout.tsx` (Livener)
     - Generic tenant layout (other projects)
   - No duplication: single component, two mount points

**Custom script hardening rules (Round 2):**

**Access**
Custom scripts are an Abluo-administrator-exclusive capability. They are never tenant-accessible — not surfaced in the client dashboard now, and not in the future without a superseding ADR. This is a platform feature, not a tenant feature.

**Execution**
New custom script items are disabled by default (`enabled` initialValue `false`) — an admin must consciously enable a script after review. Consistent with round 1: scripts execute production-only, never on dev or preview. `integrations.analyticsEnabled` is a tenant-level master switch (initialValue `false`): unless it is strictly `true`, `TrackingScripts` renders nothing — GA4, GTM, Meta Pixel, and custom scripts are all blocked, at both placements — fail-closed, and evaluated alongside the existing production-only gate. Verification meta tags are exempt from `analyticsEnabled`: they are not visitor tracking and continue to render in all environments regardless of the toggle.

**Metadata**
Each custom script item requires: `label` (internal reference), `description` (required — states the script's purpose), `placement` (`head` | `bodyEnd`), `enabled` (boolean, default `false`), and `consentCategory` (required, radio, no default — one of `necessary` | `analytics` | `marketing` | `functional`, forcing a conscious categorization choice at authoring time rather than defaulting to a permissive category). The Studio preview for each item shows category, placement, and disabled state so admins can audit the list at a glance.

**Consent**
`analytics`, `marketing`, and `functional` category scripts must never load before user consent has been collected. The data model (`consentCategory` field) and a pure filter, `filterCustomScripts(scripts, placement, consent?)` (`src/lib/tracking/custom-scripts.ts`), implement this. The consent-collection mechanism itself (cookie banner / consent UI) is not yet built; `integrations.consentModeEnabled` (initialValue `false`) is the interim, tenant-level opt-in that governs behavior until it does.

**Tom's decided rule (Round 4 — settles the question left open in Round 3):** the absence of a consent mechanism is never itself permission to load tracking — "the consent feature ships later" does not authorize loading tracking scripts before it does. Because there is no partial-consent capture today, `consentModeEnabled === true` is treated as "no valid consent exists," and every consent-gated category fails closed — not only custom scripts:

| Category | Behavior when `consentModeEnabled = true` and no valid consent exists |
|---|---|
| GA4, GTM (including its `bodyEnd` noscript iframe), Meta Pixel | **Blocked.** `builtInTrackingAllowed(consentModeEnabled)` (`src/lib/tracking/custom-scripts.ts`) returns `false`; `TrackingScripts.tsx` suppresses all three built-ins. |
| Custom script, `consentCategory: analytics` | **Blocked.** `consentStateFor(true)` returns `{ analytics: false, marketing: false, functional: false }`; `filterCustomScripts` excludes it. |
| Custom script, `consentCategory: marketing` | **Blocked** — same mechanism. |
| Custom script, `consentCategory: functional` | **Blocked** — no consent rule currently exists that permits functional scripts to load pre-consent; only a future, explicit consent rule may change this. |
| Custom script, `consentCategory: necessary` | **Loads.** Abluo-admin-approved by construction (admin-created, `enabled === true`, required `description` and `consentCategory`); never gated by `filterCustomScripts`. |

When `consentModeEnabled` is `false` or `undefined`, `consentStateFor()` returns `undefined` and `builtInTrackingAllowed()` returns `true` — the prior interim (ungated) behavior applies, subject only to the existing `analyticsEnabled` master switch and production-only emission. Independent of consent, `enabled` remains evaluated fail-closed on every custom script regardless of category or consent state: only `enabled === true` renders.

**Auditability**
Per-script-item attribution (manual `createdBy`/`createdAt`/`modifiedBy`/`modifiedAt` fields) is not implemented. Sanity's document-level `_createdAt`/`_updatedAt` fields and revision history (which records the editing user) cover auditability at the document level for now. Per-item attribution would require custom Studio input machinery and is deferred — revisit via a superseding ADR if per-item attribution becomes a requirement.

**Security**
`customScripts.code` remains arbitrary JavaScript injected into the website; it is acceptable only because Sanity is platform-managed and clients never see Sanity. No secrets or server-side API keys may be pasted into `code`. External `src`-based scripts are preferred over large inline snippets. Only trusted third-party integrations should be added (e.g. Google, Meta, LinkedIn, Hotjar) — the array-level Studio description encodes this policy directly for admins. Any future client dashboard exposure of customScripts **requires a superseding ADR** before it can be wired into the UI.

### Consequences

**Positive:**
- Site configuration is unified: all tenant identity, branding, and integrations in one siteConfig document
- Platform-managed only: clients never see or edit integration credentials
- Production-only emission: analytics and tracking have zero impact on development, preview, and testing environments
- Verification meta tags work in all environments: Search Console and Bing can verify the site before production
- Custom scripts are optional: a tenant with no custom scripts has an empty array
- Credentials are never exposed to client dashboard (only Abluo admin in Sanity)
- Disabled-by-default plus required `description` and `consentCategory` reduce the risk of an admin unintentionally shipping a live, uncategorized, or undocumented script
- `analyticsEnabled` gives every tenant a single fail-closed master switch over all tracking (built-in and custom), independent of the consent question
- The interim consent gap (see Negative, below) is now closable per-tenant: an admin can set `consentModeEnabled` to `true` to fail-close GA4/GTM/Meta Pixel and `analytics`/`marketing`/`functional` custom scripts ahead of the full consent-collection feature

**Negative:**
- `customScripts.code` remains an untyped field accepting arbitrary JavaScript; the required `description`, required `consentCategory`, disabled-by-default default, and Studio security-policy copy mitigate but do not eliminate this — admin vigilance is still required, and no static analysis or sandboxing of `code` exists
- No per-script rate-limiting or validation inside the platform (relies on admin judgment)
- No script performance monitoring — a slow or blocking custom script will affect page performance
- Verification tokens in Sanity (not env vars) means they are readable by anyone with Sanity access — acceptable today (platform-managed only) but requires review if Sanity access expands
- **Residual consent gap (narrowed, Round 4):** the gap now applies only to tenants with `consentModeEnabled` off (the default) — for those tenants, `analytics`/`marketing`/`functional` custom scripts and the built-in GA4/GTM/Meta Pixel snippets still render in production without user consent having been collected. Whether to turn `consentModeEnabled` on ahead of the full consent-collection feature is a per-tenant compliance judgment for the Abluo admin. For any tenant that sets `consentModeEnabled` to `true`, this gap is now fully closed: every consent-gated category (built-in and custom) fails closed, per the Consent section above. The residual risk is therefore tenants with both `analyticsEnabled === true` and `consentModeEnabled === false` — not consent-mode tenants, whose gap is closed
- Inline scripts remain possible despite the "prefer external `src`" guidance — it is admin guidance, not a schema constraint

### Future Considerations

- If a client dashboard ever needs integration management, custom scripts must be excluded or handled via a separate, audited system (not a direct Sanity field)
- Script performance monitoring (e.g. cumulative impact of GA + GTM + Meta + custom scripts) is not currently instrumented
- Script versioning (e.g. pinning GA to a specific version) is not supported — scripts load from their canonical CDNs

---

## ADR-014 — Integration Registry & the One-Configuration-Surface Principle

**Status:** Accepted
**Date:** 2026-07-11
**Supersedes:** ADR-013, partially — the STORAGE-LOCATION section only (see Supersession Note below)
**Superseded By:** —

### Context

ADR-013 placed all third-party integrations under `siteConfig.integrations` and gave Studio a single stub placeholder for them (`Project Settings → Integrations`, a `StubPane` per Phase C1 — `sanity.config.ts` ~L448–457). At the same time, `Website Settings` — the raw `siteConfig` document form (`sanity.config.ts` ~L334–350) — is where `integrations` fields actually live and are edited today, because they are a `siteConfig` object. Verification tokens (Google Search Console, Bing) live in the same object even though they are not tracking integrations at all — they are passive metadata.

This produces exactly the failure mode Tom's core principle exists to prevent: a single feature (e.g. "Google Analytics") would require an admin to know that its *values* are edited in Website Settings while its *category* (Integrations) is a dead stub in Project Settings — two configuration surfaces for one concept, with the split determined by Sanity document boundaries rather than by what the feature is. `Project Settings → Analytics` (`sanity.config.ts` ~L426–435) is a second, separate stub that would duplicate the Integrations → Analytics category once built — two stubs for the same concern.

The platform already has a working precedent for exactly this shape of problem: the Module Registry (ADR-010, ADR-011). `src/lib/modules/types.ts` defines `ModuleManifest` (id, label, version, `platformContract` incl. `sectionTypes`, `schemaDefinitions(): SchemaTypeDefinition[]`) and `ModuleInstallation` (per-project enable state), with `validateRegistry` guarding manifest consistency and `MODULE_REGISTRY` as the single source Studio reads from. Adding a module means writing one manifest; schema, Studio grouping, and validation all derive from it. Integrations have no equivalent — each one (GA4, GTM, Meta Pixel, Custom Scripts) is presently a hand-projected field or field-group in `siteConfig`, with no registry, no generated schema, and no shared Studio contract.

Sprint 2 must decide the information architecture and registry model *before* any implementation, because it changes where fields live in Sanity (a schema/IA decision, not a code-only refactor) and because it is the gating decision for every subsequent Sprint 2 task.

**Verified facts underpinning this ADR:**
- `sanity.config.ts` ~L334–458: `Website Settings` = raw `siteConfig` document; `Project Settings` is a flat list (`General`, `Modules`, `Locales`, `Domains` stub, `Analytics` stub, `Billing` stub, `Integrations` stub), each stub built with `StubPane` and a static message.
- `src/lib/modules/types.ts`: `ModuleManifest`, `ModuleInstallation`, `platformContract.sectionTypes`, `schemaDefinitions()`, `validateRegistry` — the pattern this ADR mirrors.
- ADR-013 (this document, immediately above): full existing shape of `siteConfig.integrations`, its consent semantics, and its security hardening — carried over, not re-litigated, by this ADR.
- No live integration data exists in either Sanity dataset as of 2026-07-10 (both datasets checked) — the relocation this ADR proposes is schema-and-code only; no content migration is required.

### Alternatives Considered

- **Status quo — keep `siteConfig.integrations` as plain fields edited in Website Settings, with the Project Settings → Integrations pane left as a permanent stub or a hand-built passthrough to those fields.** Rejected: violates the one-surface principle at scale — every new integration would again be a bespoke field group, and the split between "where you see it" (Project Settings) and "where you edit it" (Website Settings) never resolves. Storage location (Sanity object shape) leaks directly into the information architecture instead of being an implementation detail.
- **Per-integration hand-built Studio pages** — build a dedicated custom pane for each integration (one for GA4, one for GTM, one for Meta Pixel, one for Custom Scripts, and so on for every future integration), each with its own schema fields, validation, and form. Rejected: linear cost per integration with no shared contract — N integrations means N independent implementations that will drift from each other in validation strictness, consent handling, and field layout. No registry means no `validateRegistry`-equivalent guard and no single place to audit "what integrations exist and what do they store."
- **Split each integration's connection settings (Website Settings) from its behavioral settings (Project Settings)** — e.g. keep GA4's measurement ID in Website Settings but its enabled/disabled toggle in Project Settings. Rejected by Tom: unacceptable UX. A single integration must never require an admin to visit two Studio areas to fully configure it — this is precisely the failure ADR-013's stub-and-siteConfig split already produced and which this ADR exists to correct, not to re-introduce in a different shape.

### Decision

**Core principle (Tom's, verbatim in substance):** Every configurable concept in Abluo has exactly one configuration surface. Users never visit multiple locations to configure a single feature. Implementation details (Sanity vs Supabase vs env) never leak into the information architecture. Corollary: one integration = one configuration surface; one policy = one configuration surface.

#### Information architecture

All third-party integrations move out of Website Settings into **Project Settings → Integrations**, organized into six categories: **Analytics, Marketing, Forms, AI, Payments, Developers**. Of these, only **Analytics** (GA4, GTM, Meta Pixel) and **Developers** (Custom Scripts — relocated with its Round-2/Round-4 hardening from ADR-013 intact) are functional at launch. The remaining categories (Marketing, Forms, AI, Payments) render registry-derived coming-soon states — their presence in the category list is driven by the registry, not hardcoded per category, so a category becomes "live" the moment a manifest is registered under it, with no IA change required.

The standalone `Project Settings → Analytics` stub (`sanity.config.ts` ~L426–435) is **removed** — it is now redundant under the Integrations → Analytics category.

`Website Settings` keeps only genuine website-behavior fields: SEO, social, favicon, OG image, robots, sitemap, cookie-banner *appearance*, maintenance mode, header/footer. Verification tokens (Google Search Console, Bing) are **not integrations** — they carry no tracking behavior and no consent implication — and move to `siteConfig`'s `seo` field group as plain fields, alongside the site's other SEO metadata.

#### Privacy — a single surface for cross-integration policy

A new **Project Settings → Privacy** section is the one surface for policy that spans every integration: `consentModeEnabled`, and a global tracking kill switch that is the direct successor of ADR-013's `analyticsEnabled` — demoted from the day-to-day on/off control (that role passes to each integration's own `enabled` field) to an emergency override that can halt all tracking regardless of individual integration state. Privacy also owns the future consent-provider connection (the not-yet-built consent-collection mechanism ADR-013 flagged as missing).

Every integration page shows a **read-only** consent block: *"This integration is controlled by the global Privacy settings. Open Privacy →."* No integration ever carries its own independent consent configuration — consent is a policy concept, not a per-integration field, and duplicating it per integration would immediately violate the one-surface principle for the concept of "consent."

Cookie-banner *appearance* (copy, colors, position) is website behavior and stays in Website Settings; only the *policy* fields (`consentModeEnabled`, the kill switch, the future provider connection) belong to Privacy.

ADR-013's fail-closed consent semantics — consent mode on + no valid consent ⇒ only `necessary`-category scripts and no built-in trackers load; "the consent feature ships later" is never itself permission to load tracking before it does — carry over **unchanged**. This ADR relocates where those settings are configured; it does not weaken, loosen, or re-litigate what they enforce.

#### Integration Registry

Mirrors the Module Registry (ADR-011) field-for-field in spirit:

```typescript
interface IntegrationManifest {
  id: string
  label: string
  version: string
  status: 'released' | 'beta' | 'deprecated'
  category: 'analytics' | 'marketing' | 'forms' | 'ai' | 'payments' | 'developers'
  icon?: string
  docsUrl?: string
  consentCategory: 'necessary' | 'analytics' | 'marketing' | 'functional'
  fields: IntegrationFieldDef[]
  storage: 'content' | 'operational'   // 'content' = Sanity, 'operational' = Supabase — per manifest for now, per field later
  renderContract?: { component: string }
}

interface IntegrationFieldDef {
  id: string
  label: string
  type: string
  required: boolean
  validation?: { regex: string; message: string }
  secret: boolean
  description: string
}
```

Per-project state mirrors `ModuleInstallation` (ADR-011 Sub-decision B2's array-on-document model): a new `integrationConfigs` array, scoped by `projectSlug`, with entries `{ integrationId, enabled, values }`. The Sanity schema for each integration's `values` object is **generated** from its manifest's `fields` at config-build time — the same move ADR-011's `schemaDefinitions()` / `buildSchema()` already makes for modules. `validateIntegrationRegistry` guards the registry the way `validateRegistry` guards `MODULE_REGISTRY` today.

Fields marked `secret: true` are the forward hook for Supabase-backed storage (e.g. a future Stripe or OpenAI integration's API key): the manifest already declares `storage`, so the pane renders identically regardless of where the value is ultimately written — only the write path differs, and only when such an integration is actually registered.

**Studio:** the Integrations stub becomes an `IntegrationsPane`, built the way `ModuleList` is built for modules today — a category index showing status badges (Connected / Enabled / Consent-gated), with coming-soon categories derived from the registry (no registered manifest ⇒ coming-soon, automatically), and a per-integration self-contained page rendering `enabled`, the generated fields with validation, a docs link, and the read-only consent block described above.

**Success metric:** adding a new integration is registering one manifest. Schema, validation, and the Studio form all derive from it. No new Studio page and no new schema work is required per integration — exactly the leverage ADR-011 already proved for modules.

### Deferred (recorded, not scoped into this ADR)

- **Per-integration environment selection.** The platform remains production-only for every integration. A manifest field is reserved for this but no UI is built.
- **Per-field storage split.** `storage` is declared per manifest, not per field, for now — a field-level split (e.g. one field in Sanity, another in Supabase, within the same integration) is not supported until a concrete integration needs it.
- **Client-dashboard exposure of any integration.** Still requires a superseding ADR — carried over unchanged from ADR-013's equivalent restriction on Custom Scripts, now generalized to every integration in the registry.

### Supersession Note

This ADR supersedes **only** ADR-013's STORAGE-LOCATION section — the description of `siteConfig.integrations` as a flat object edited in Website Settings, and the Studio placement that followed from it. It does **not** touch, weaken, or re-decide:

- ADR-013's security policy: no secrets in `code`, trusted-vendor-only guidance, admin-only access, disabled-by-default, required `description` and `consentCategory` on every custom script.
- ADR-013's consent semantics: the fail-closed behavior under `consentModeEnabled`, and Tom's Round 4 rule that the absence of a consent-collection mechanism is never itself permission to load tracking.

Both carry forward unchanged, relocated onto the Integration Registry's `Developers → Custom Scripts` integration and the Privacy section respectively. ADR-013 is updated with a one-line `Superseded By` note pointing here (see above); no other content in ADR-013 is edited, consistent with the never-edit-ADRs-in-place rule — this document is the record of what changed and why.

### Migration

Zero live integration data exists in either Sanity dataset as of 2026-07-10 (verified, both datasets). This relocation is schema-and-code only — no content migration is required. Implementation proceeds on top of the v1.0.14 preview baseline as a new release, following the standard `dev → preview → main` STOP-gated pipeline; nothing in this ADR authorizes skipping a stage.

### Phasing

Each phase is independently deployable (ADR-007):

| Phase | Scope |
|---|---|
| **A** | Integration Registry + manifests + generated schema + `validateIntegrationRegistry` |
| **B** | Studio panes (`IntegrationsPane`, Privacy section) + IA rewire: remove `siteConfig.integrations` group, remove the `Project Settings → Analytics` stub, move verification tokens to `siteConfig.seo` |
| **C** | Frontend consumption switch: `TrackingScripts` reads `integrationConfigs` instead of `siteConfig.integrations`; `filterCustomScripts`/consent helper semantics unchanged |
| **D** | Docs, ADR-013 cross-references, `config-architecture.md` register update |

### Consequences

**Positive:**
- Every integration has exactly one configuration surface — Tom's core principle is now structurally enforced by the registry, not just followed by convention
- Adding an integration is a manifest, not a page — schema, validation, and Studio form all derive, matching the leverage already proven for modules (ADR-011)
- Consent policy has exactly one home (Privacy); no integration can drift into its own bespoke consent handling
- Storage backend (Sanity vs Supabase) is an implementation detail hidden behind `storage` and `secret` — the IA never has to change when an integration's storage needs change
- Verification tokens are correctly classified as SEO metadata rather than tracking integrations, removing a category-confusion that existed since ADR-013
- Zero content migration risk — the relocation is schema-and-code only

**Negative:**
- Building `IntegrationsPane` and the schema-generation pipeline is real upfront cost — a generated-form system is more work than the hand-built stub it replaces, and that cost is paid once, before any single integration benefits from it
- The registry adds a layer of indirection: debugging "why doesn't this field validate" now means checking the manifest, the generated schema, and the render contract, rather than reading one hardcoded field definition
- The one-time relocation (Website Settings → Project Settings → Integrations, `analyticsEnabled` → kill switch, verification tokens → `seo`) is churn for the Abluo admin's muscle memory and requires every reference to the old `siteConfig.integrations` shape (docs, any hardcoded admin bookmarks) to be updated
- `storage` being per-manifest rather than per-field today means an integration that needs a mixed Sanity/Supabase split (unlikely at Sprint 2's scope, but plausible for a future payments integration) will require a manifest-shape change when that need arrives

---

## ADR-015 — Platform Authorization & Tenant Isolation

**Status:** Accepted — Phase 1 & 2 Implemented, Phase 3 Open (see Close-out, 2026-08-10)
**Date:** 2026-07-24
**Supersedes:** —
**Superseded By:** —

> Tom has accepted this ADR and all eight Orchestrator refinements (R1–R8) on 2026-07-24. Every decision below reflects Tom's final position; implementation proceeds from this acceptance point.

### Context

The Sprint 3 tenant-isolation and `/studio`-gating evidence audit (`docs/engineering/agent-system/evaluations/2026-07-24-sprint3-tenant-isolation-audit.md`, 2026-07-24) traced all three planes of the platform — Supabase, Sanity, and the API/route layer — against a single question: can an authenticated tenant user reach another tenant's data, or reach an Abluo-admin-only surface. It found that they can, structurally, because a reliable notion of "Abluo admin" does not exist anywhere in the codebase.

**The pivotal finding (Verified fact):** `src/proxy.ts:255` reads a `user_role` claim off the session JWT (`decodeJwtClaim(session?.access_token, 'user_role')`) and gates `/admin`-prefixed routes on `role !== 'admin'`. Nothing in the platform ever sets that claim. `profiles.role` was dropped from Supabase in `supabase/migrations/004_profiles_identity_only.sql:244` (`alter table public.profiles drop column if exists role;`) as part of the move to per-tenant membership roles in `tenant_members`, and no Supabase custom access-token hook or `app_metadata` setter was put in its place. The consequence is not "the admin gate is weak" — it is that **no admin identity mechanism exists at all**, so every distinction between a trusted Abluo operator and an authenticated tenant user is currently unenforceable, not merely unenforced.

**Structural picture from the audit (Verified fact, file-referenced):**
- **Supabase RLS is well-built but bypassed.** `tenant_members` membership, `SECURITY DEFINER` helper functions keyed on `auth.uid()`, and per-table policies exist and are sound — but every application code path reads and writes through `createAdminClient()` (the service-role client), which bypasses RLS entirely. The isolation boundary exists in the schema and is unused in practice.
- **Sanity private/admin paths take tenant identity from spoofable input.** Public website content is correctly scoped via `fetchForTenant`/`projectSlug`. Admin-facing API routes do not follow the same discipline: `src/app/api/sanity/document/route.ts`, `src/app/api/media/route.ts` and `src/app/api/media/[id]/route.ts`, `src/app/api/sanity/tenants/route.ts`, `src/app/api/sanity/tenant/route.ts`, `src/app/api/sanity/projects/route.ts` take tenant/project identity from request params, body, or omit scoping outright — none independently verify the requester's membership in the tenant they claim to act on.
- **Unauthenticated P0 routes.** The audit records 8 P0-severity gaps across a 12-gap table (see the audit's handoff for the full table); confirmed present in this session: `src/app/api/sanity/document/route.ts`, `src/app/api/media/route.ts` (GET/POST), `src/app/api/media/[id]/route.ts`, `src/app/api/sanity/tenants/route.ts`, `src/app/api/sanity/tenant/route.ts`, `src/app/api/sanity/projects/route.ts`, `src/app/api/fix-colors/route.ts`, `src/app/api/inquiries/[id]/route.ts` — each reachable without the auth+ownership check the F1 hotfix (Sprint 3, `media/[id]` DELETE/PATCH) already proved as the correct per-route pattern.
- **Dashboard routes are unguarded by the proxy.** `src/proxy.ts:94` defines `PROTECTED_PREFIXES = ['/admin', '/client']`, but the live dashboards are `/en/dashboard`, `/en/media`, `/en/leads` (per-locale, no `/admin` or `/client` prefix) — they never match the matcher and are reachable by any authenticated user, admin or not, because (per the pivotal finding) the admin/tenant distinction cannot be evaluated even where the gate does run.
- **The client dashboard's tenant data layer is stubbed, not built.** There is no live per-tenant read path yet to retrofit — the authorization model must be decided before that layer is written, not after.

**The compounding effect:** any authenticated tenant user is, today, a de-facto platform admin — not through a specific exploit, but because the mechanism that would distinguish an admin from a tenant user does not exist, and every other tenant-boundary (RLS, Sanity scoping, dashboard gating) either sits unused behind service-role or takes its tenant identity from something the requester controls.

This ADR is the required prerequisite (spine §7, decision 11 below): implementation does not begin until this ADR is accepted.

### Alternatives Considered

- **Patch each P0 route individually, decide the admin-identity question later** — rejected as the sole path forward: the F1 hotfix already proved this pattern works per-route, but shipping it platform-wide without first fixing the admin-identity gap re-encodes "no admin distinction exists" into every patched route. Retained as the *immediate hardening tranche* (R7, below) run in parallel with — never in place of — the model work.
- **Admin-allowlist table (`is_admin` booleman/list keyed by user id)** — considered in the audit; rejected in favor of a JWT claim because a table lookup on every request adds a query the JWT claim avoids, and because Supabase's access-token-hook mechanism already exists to solve exactly this problem in a signed, tamper-evident way.
- **Dedicated admin tenant (treat "Abluo" as tenant zero, admins as members of it)** — rejected: conflates the platform-operator identity with the tenant-membership model, which is designed for tenant-scoped roles/permissions, not platform-wide operator status. Keeping the two identities (decision 2, below) structurally separate is simpler and matches how the routes actually need to reason about access.
- **RLS-only enforcement, no application-layer checks** — rejected: Sanity has no RLS equivalent, so application-layer ownership enforcement is mandatory there regardless of the Supabase answer (decision 6). For Supabase itself, RLS-only (no app-layer defense in depth) was considered and rejected in favor of RLS-as-primary-boundary with application-layer checks retained as a second line (decision 5, decision 9) — belt and suspenders on the platform's most consequential invariant.
- **Cache `TenantAuthorizationContext` in the JWT alongside `platform_role`** — considered for performance; rejected (Orchestrator refinement R1, Tom to adjudicate) because a cached membership/permission set cannot be revoked mid-session without a token-refresh mechanism, which reintroduces exactly the kind of unenforceable-until-refresh gap this ADR exists to close.

### Decision

The following eleven points are Tom's final, accepted decisions. They are not open for re-litigation at ADR review — only the Orchestrator refinements (below) are.

**1. Signed, server-controlled `platform_role`.** A `platform_role` claim, values `abluo_admin` | `tenant_user`, lives in Supabase `app_metadata` and is exposed as a JWT claim via a server-controlled mechanism (a Supabase custom access-token hook, or equivalent server-side claim injection). Tenant users can never assign or edit their own `platform_role` — it is set exclusively by trusted server-side operations.

**2. `abluo_admin` and `tenant_user` are separate platform identities.** Framing matters: the problem is not "the app lacks a reliable admin *role*" — it is that the app lacks a reliable platform-admin *identity*, so several routes today fail to distinguish trusted Abluo operators from authenticated tenant users. Authenticated tenant users are never described or treated as admins by default; `abluo_admin` is a distinct, narrowly-granted identity.

**3. Multi-tenant users, from the beginning.** A user maps to one-or-more tenant memberships; each membership carries its own role and permission set. A permission granted in Tenant A's membership never applies to Tenant B — there is no cross-tenant permission inheritance. Post-login routing: exactly one membership → straight to that tenant's dashboard; more than one → a tenant selector built only from the user's own verified membership records (never a free-text or URL-supplied tenant id). Switching tenants establishes a new, independently validated authorization context — it is not a client-side state flip. Changing the tenant slug in the URL never switches the authorization context by itself; the server re-validates against memberships on every request regardless of what the URL says.

**4. Roles and permissions are stored per tenant membership**, not per user. A consulting user with memberships in three tenants can hold three different roles.

**5. RLS is the primary tenant-isolation boundary for Supabase.** Ordinary tenant-scoped requests are served through an authenticated-user Supabase client (a client carrying the requesting user's JWT, subject to RLS) — not the service-role client. This reverses the audit's finding that RLS exists but is universally bypassed.

**6. Explicit application-layer tenant-ownership enforcement for Sanity.** Sanity has no RLS equivalent. Every Sanity read and write on tenant-owned content must independently verify, in application code, that the resource being accessed belongs to the tenant the requester is authorized for.

**7. `/studio` is restricted to MFA-authenticated (AAL2) Abluo administrators.** Not "any authenticated user," and not "any admin" — an admin whose session has completed the second authentication factor.

**8. Tenant accounts are invitation-only.** There is no self-service tenant signup. Every tenant user identity, membership, and initial role is created by an invitation flow, never by open registration.

**9. Server-side tenant + module + permission + ownership checks on every read and every mutation.** No route is exempt because it "only reads" or because a check happened earlier in the request chain — each of the four checks runs on every request that touches tenant-owned data.

**10. Cross-tenant isolation tests are release-blocking.** A release that fails any test in the required matrix (see Testing, below) does not ship — this joins the existing gates in the Deployment Workflow (CLAUDE.md), not alongside them as optional.

**11. This ADR precedes implementation.** The tenant-isolation audit is the evidence base; no code implementing this model lands before this ADR is Accepted.

#### Structural model

**`AuthenticatedActor`**
```ts
type AuthenticatedActor = {
  userId: string
  platformRole: 'abluo_admin' | 'tenant_user'
}
```
Resolved by exactly one central, server-side auth helper. No route interprets JWT claims independently — every route that needs to know who the requester is calls the same helper. This closes the exact failure mode the pivotal finding describes: a claim that different code paths read (or fail to read) inconsistently.

**`TenantAuthorizationContext`**
```ts
type TenantAuthorizationContext = {
  userId: string
  tenantId: string
  membershipId: string
  tenantRole: string
  enabledModules: string[]
  permissions: string[]
}
```
Tenant identity in this context comes exclusively from the user's authenticated, verified membership record. It is never trusted solely from: a URL route param, a query param, a request body field, a user-selected cookie, or a Sanity `projectSlug` supplied by the client. A requested tenant id may appear in a URL for routing purposes — the server always compares that requested id against the caller's verified memberships before treating it as authoritative, and rejects (not silently substitutes) on mismatch.

**The 7-step authorization sequence**, required on every tenant request, in this order:
1. Authenticate — resolve the `AuthenticatedActor` via the central auth helper.
2. Resolve the requested tenant against the actor's verified memberships (not against the URL alone).
3. Confirm the resolved membership is active (not revoked, not suspended).
4. Confirm the module the request touches is enabled for that tenant.
5. Confirm the membership's permissions permit the specific action.
6. Confirm the target resource actually belongs to that tenant (ownership check on the resource itself, not just on the request's claimed tenant).
7. Perform the action.

Order matters: step 4 (module enabled) is deliberately distinct from step 5 (permission to act) — having a module enabled is never treated as blanket access to that module's documents; a disabled module short-circuits at step 4 regardless of what permissions the membership otherwise holds, and an enabled module still requires the specific permission at step 5.

#### Supabase model

Default: the authenticated-user client, subject to RLS, for all ordinary tenant requests. Service-role is used **only** for explicitly trusted server operations — where authentication has already happened, ownership is independently enforced through other means, and the operation is documented and auditable (e.g. system migrations, scheduled jobs, webhook-triggered writes with their own verification). Every such use is wrapped in a narrowly-named helper (e.g. `runAsTrustedSystemOperation()`), never called ad hoc as a shortcut around RLS friction.

#### Sanity model

The sequence: authenticate → resolve the actor's authorized membership → resolve that tenant's Sanity project configuration server-side (never from a client-supplied `projectSlug`) → validate the requested module and action against the membership's permissions → scope every query and mutation to that tenant's resources only. This ownership discipline extends through references, attached media, drafts, and linked documents — a write that would attach or reference another document must also verify that referenced document's `projectSlug` matches the acting tenant. A Tenant A document must never come to reference Tenant B content or media, directly or through a shared media library.

#### Login, invitation, and MFA

All tenant-user authentication happens through Abluo — never through Sanity Studio login for tenant users. The credential model: email + password, verified email required, a password reset flow, and TOTP-based MFA as the strong second factor. Email-based OTP may be offered as a convenience or account-recovery mechanism, but is explicitly **not** treated as a strong second factor when email is also the first authentication channel (an attacker who compromises the mailbox would defeat both factors at once).

Invitation-only onboarding: an invite is sent by email → the recipient creates or links their identity → tenant membership(s) are created → role and permissions are assigned per membership → email is verified → MFA is enrolled where policy requires it for that role.

MFA policy: mandatory for `abluo_admin` (AAL2 required for all internal routes, including `/studio`); mandatory for tenant owners, or mandatory from the first rollout of the owner role; mandatory for any user who manages other users or permissions within a tenant; encouraged (not yet enforced) for ordinary editors initially, becoming tenant-enforceable later.

#### Session and revocation principles

Inactivity timeouts apply to all sessions; admin sessions carry stricter timeouts than tenant-user sessions. Sensitive actions (permission changes, user removal, `/studio` access) require periodic re-authentication and AAL2, not just an unexpired session. Sessions are revoked when a tenant membership is removed, and refreshed or revoked when a role or permission changes — a permission downgrade must take effect without waiting for natural token expiry. Sign-out-all-devices is a supported action. Multi-device session handling is a named concern, not an afterthought. Exact timeout durations are deferred to implementation; the principles above are fixed now.

### Orchestrator refinements (accepted 2026-07-24)

These are recommendations layered on the eleven accepted decisions above. Tom has accepted all eight refinements (R1–R8) on 2026-07-24. Each refinement as stated below reflects the final, adjudicated position.

**R1 — JWT carries only `platform_role`; nothing else is cached.** The full `TenantAuthorizationContext` (memberships, permissions, `enabledModules`) is resolved per-request from the database through the RLS-backed client — never embedded in or cached inside the JWT. This is what makes decision 12's revocation/permission-change principle actually immediate rather than bounded by token expiry: if memberships were cached in the token, a permission change would not take effect until the token refreshed. Hard rule proposed: no membership or permission data is ever written into the JWT payload.

**R2 — Two chokepoints, not many.** Centralize both cross-tenant-capable code paths behind single, narrowly-named entry points: the service-role helper (decision 7's discipline, generalized) and a `tenantScopedSanityClient(ctx: TenantAuthorizationContext)` that is structurally incapable of operating outside `ctx`'s project. Ban user-supplied or raw GROQ entirely — every query is server-templated with `projectSlug` sourced only from the resolved context, never from string interpolation of client input. (The audit's Sanity findings included a GROQ string-interpolation path that is injectable; this refinement is the general fix, not a patch to that one route.)

**R3 — Ownership enforcement recurses through references and media.** On any write that sets a reference field or attaches a media asset, the referenced document's `projectSlug` is validated independently of the parent document's — a parent-only check is insufficient, since a valid parent write could still attach a cross-tenant reference.

**R4 — Consider RLS-governed admin reads instead of service-role, for the admin dashboard.** A candidate RLS policy — grant read access when `auth.jwt()->>'platform_role' = 'abluo_admin'` — would let the legitimate cross-tenant admin dashboard read through the same RLS-backed client as everything else, rather than through service-role. This shrinks service-role's remaining footprint to genuinely infrastructural operations (migrations, triggers, webhooks) and keeps even the admin path RLS-governed. Proposed as a refinement to decision 7, not a replacement for it.

**R5 — Bootstrap realities to plan now, not discover at rollout.** (a) First-admin seed: a one-time, guarded server-side script or migration is needed to stamp the initial `abluo_admin` — before any admin exists, nothing can grant the first one through the normal flow (chicken-and-egg). (b) Backfill: every existing user needs a `platform_role` value (default `tenant_user`, explicitly promote Tom), and because existing issued JWTs predate the claim, a forced token refresh or re-authentication at rollout is required — an existing session's JWT will not retroactively gain the claim.

**R6 — Sequencing fix: gate `/studio` on `platform_role` immediately, layer MFA later.** Gate `/studio` on `platform_role === 'abluo_admin'` at implementation step 6 (below) — this closes the "tenant user reaches Studio" hole as soon as the identity model exists, without waiting for MFA infrastructure. Layer the AAL2/MFA requirement on top at step 10, when MFA lands. `/studio` must never be left open "temporarily" while MFA is pending — the role gate alone is a strict improvement over today's no-gate state and should ship the moment it's available.

**R7 — Split an immediate hardening tranche from the authorization-model tranche.** Auth-gate the live unauthenticated P0 routes now, each shippable independently, the same way the F1 hotfix shipped `media/[id]` DELETE/PATCH: `src/app/api/sanity/document/route.ts`, `src/app/api/media/route.ts` (GET/POST), `src/app/api/sanity/tenants/route.ts`, `src/app/api/sanity/tenant/route.ts`, `src/app/api/sanity/projects/route.ts`, `src/app/api/fix-colors/route.ts`, `src/app/api/inquiries/[id]/route.ts`. This tranche does not wait for the full authorization-context model — it applies the simplest available check (authenticated + role-appropriate) immediately, and is superseded by the full 7-step sequence once that lands. The model work must not be blocked on, or block, these locks.

**R8 — Build the client dashboard's data layer on `TenantAuthorizationContext` from day one.** The audit found the client dashboard's per-tenant read path is currently stubbed, not built. Nothing has to be retrofitted: no `fetchForTenant`-style function should be written for the dashboard without a `TenantAuthorizationContext` parameter from its first line of code. This is a rare case where the "lucky timing" of the stub being unbuilt means the correct pattern costs nothing extra to start with.

### Consequences

**Positive:**
- Closes the single largest structural exposure in the platform's history: an authenticated tenant user currently has no technical barrier preventing platform-admin-equivalent reach, because the mechanism that would distinguish the two doesn't exist
- Supabase's already-well-designed RLS and membership model (audit: "well-designed... but bypassed everywhere") is finally exercised as intended, rather than left as unused schema
- Multi-tenant membership is architected in from the start — no later migration from a single-tenant-per-user assumption
- A single central auth helper and a single `TenantAuthorizationContext` shape make every future route's authorization logic reviewable against one contract, instead of ad hoc per-route reasoning
- Cross-tenant isolation tests being release-blocking (decision 10) turns "did we break tenant isolation" from a manual-review question into a gate the pipeline enforces
- R7's immediate-hardening split means the live P0 unauthenticated routes do not have to wait for the full model to ship — real exposure closes in parallel with the careful work

**Negative:**
- This is the largest workstream in the platform's history — implementation spans multiple sprints (see Implementation Order below), not a single release
- Rollout forces re-authentication or token refresh for every existing user (R5b) — a one-time disruption that must be communicated, not silently absorbed
- Moving ordinary tenant Supabase reads from service-role to an RLS-backed client is a genuine migration risk: RLS policies that are correct in isolation can still behave differently under real request patterns than the service-role bypass did, and this needs careful staged verification, not a single flip
- Sanity's application-layer enforcement (decision 6) is structurally the weaker of the two isolation boundaries — there is no database-level backstop equivalent to RLS, so the discipline of the two chokepoints (R2) and the reference/media recursion (R3) is doing real safety work, not defense in depth on top of something already safe
- The eight P0 routes named in R7 remain exploitable until that tranche ships, even though this ADR is accepted — acceptance of the ADR is not itself a fix
- `/studio`'s current "any authenticated user" gate remains open until step 6 of the implementation order (below) actually ships — this ADR documents the fix, it does not apply it

### Implementation Order

Tom's sequencing (§14), with R6 and R7 folded in as annotations. Phase 1 is a blocking prerequisite for every subsequent phase.

1. **Draft and approve this ADR.** (This document. Blocking — nothing below starts before Accepted.)
2. **Platform-role identity model** — define `platform_role`, its values, and where it lives in `app_metadata`.
3. **Reliable admin JWT claim** — wire the Supabase custom access-token hook (or equivalent) that actually sets `platform_role` on issued tokens; this is what `proxy.ts:255` has been missing since `profiles.role` was dropped.
4. **Central auth helpers** — the one server-side helper that resolves `AuthenticatedActor`; no route reads JWT claims directly after this step.
5. **Multi-tenant membership authorization context** — implement `TenantAuthorizationContext` resolution and the 7-step sequence.
6. **Gate `/studio` and internal admin surfaces** — apply `platform_role === 'abluo_admin'` immediately (R6); do not wait for MFA to land before shipping this gate.
   - *In parallel, not sequentially blocking:* ship the R7 immediate-hardening tranche on the 8 named P0 routes, using the simplest available authenticated + role check ahead of the full context model.
7. **Move tenant Supabase requests to RLS-backed clients** — retire service-role from ordinary request paths; evaluate R4's admin-read RLS policy as part of this step.
8. **Enforce tenant ownership on all Sanity and media paths** — apply decision 6 and R2/R3 (chokepoint clients, reference/media recursion) across every private Sanity route.
9. **Enforce module entitlements and per-membership permissions** — steps 4–5 of the 7-step sequence, platform-wide.
10. **Invitation, login, and MFA** — build the invitation flow, TOTP MFA, and layer AAL2 onto `/studio` and other admin routes (completing what step 6 started with the role gate alone).
11. **Release-blocking cross-tenant tests** — land the full required matrix (below) as a CI gate before any further tenant-facing feature work ships.
12. **Audit and restrict every remaining service-role use** — sweep the codebase for any service-role call that survived steps 7–8 and either eliminate it or wrap it in the named trusted-operation helper (Supabase model, above) with justification recorded.

### Testing

The following matrix is release-blocking (decision 10) — a release does not proceed if any of these tests fail. This joins, not replaces, the existing gates in CLAUDE.md's Deployment Workflow.

**Tenant A cannot, against Tenant B's data:**
- List Tenant B's resources
- Retrieve a Tenant B resource directly by id
- Reach a Tenant B resource through search
- Update a Tenant B resource
- Delete a Tenant B resource
- Create a reference from a Tenant A document to a Tenant B document
- Attach Tenant B media to a Tenant A document
- Access Tenant B's drafts or previews
- Access a module disabled for Tenant A even if enabled for Tenant B
- Gain access by manipulating the URL slug, an id, or a request body to claim Tenant B's identity

**Additional required cases:**
- An unauthenticated request cannot reach any tenant-management route
- A `tenant_user` cannot reach `/studio`
- Changing the tenant identifier in the URL does not change the server-side authorization context
- A multi-tenant user (e.g. a consultant with memberships in several tenants) sees only their own memberships, never another user's
- Per-membership permission isolation holds: a user's permissions in Tenant A do not leak into their (possibly different) permissions in Tenant B
- The service-role client cannot be used to bypass tenant authorization from an ordinary request path
- A valid `abluo_admin` reaches only the internal surfaces intended for admins — the admin identity is not itself unbounded access to everything

### Migration and Bootstrap

Per R5:

- **First-admin seed.** Before any `abluo_admin` exists, a one-time, guarded server-side script or migration stamps the initial admin (Tom) — this cannot go through the ordinary invitation/promotion flow because that flow requires an existing admin to grant the role.
- **Backfill.** Every existing Supabase user needs an explicit `platform_role` value at rollout: default `tenant_user` for all, explicitly promote Tom (and any other intended admins) to `abluo_admin`. No user should be left with an undefined `platform_role`.
- **Forced re-authentication.** JWTs issued before this rollout do not carry the `platform_role` claim and cannot retroactively gain it. Every existing session must be forced to refresh or re-authenticate at rollout so that the claim is present before any route begins relying on it. Skipping this step means the reliable-claim work of steps 2–3 (Implementation Order) is not actually reliable for already-logged-in users.
- **Sequencing dependency.** The bootstrap steps above must complete before Implementation Order step 6 (gating `/studio`) — gating a route on a claim that most sessions don't yet carry would lock out legitimate admins, not just tenant users.

### Close-out (2026-08-10)

**What is enforced and tested today.** Every RLS-protected table named in the Supabase model (`tenant_members`, `projects`, `project_members`, `inquiries`, `profiles`, and — as of this close-out — `leads`) has a live-DB regression suite (`supabase/verify/live-rls.verify.mjs`, 37 checks) proving, against a real Postgres with the real migrations applied: the correct base-table GRANT exists, cross-tenant reads/writes are denied, no policy recurses, and the `abluo_admin` claim never widens row-level visibility. The pure authorization-decision logic — `ProjectGrant` assembly (owner-wins, cross-tenant union correctness), the Sanity chokepoint's projectSlug-override and reference/media recursion guard, and the module-installed-before-permission entitlement guard — has a parallel in-memory suite (`src/lib/api/__tests__/cross-tenant-isolation.test.ts`, 25 checks) covering every case in this ADR's required Testing matrix, including the literal "module disabled for Tenant A even if enabled for Tenant B" case. Together these two harnesses are the release-blocking cross-tenant isolation gate decision 10 calls for.

**What remains open, named explicitly (not silently deferred):**

1. **The Sanity chokepoint and entitlement guard (R2, R3, ADR-017 Decisions 4–5) are unit-tested but not wired into any route yet.** `tenantScopedSanityClient`/`assertModuleAction` are correct in isolation; no production code path calls them (only `getTenantAuthorizationContext` is consumed, by `/account`). This is the single largest gap between "the isolation model is proven correct" and "the isolation model is enforced" — closing it is route-wiring work (client-dashboard territory), not test work, and must not be read as covered by this close-out's gate-passing.
2. **`leads` has no base-table GRANT to `authenticated` today** (a gap independent of this close-out, now proven and pinned by a regression test rather than assumed). It fails closed, not open — no live route reads `leads` yet — but the RLS-primary flip for `leads` (ADR-017 Decision 6) will need to add the grant *and* rewrite the policy to the project-grain shape, since today's tenant-grain policy silently excludes project-only members from their own project's leads.
3. **Admin-read routes remain on service-role** (`createAdminClient()` in the admin dashboard and `/api/sanity/*`) — deprioritized follow-up; requires the R4 `abluo_admin`-scoped RLS policy plus shadow-read verification before it can flip.
4. **The 9 `requireAbluoAdmin()`-gated admin API routes have no automated route-level test** (pre-existing debt, named "I9" in the code). Manual verification only.
5. **`supabase/schema.sql`'s header is stale** — it claims to reflect migrations through 005; migrations 006–015 are real and applied but not reflected. A documentation-accuracy risk, not a runtime one.
6. **`inquiries` INSERT stays service-role-only by design** (migration 014's own open decision, reaffirmed) — public form submissions never go through the `authenticated` role.
7. **MFA/AAL2 (decision 7 / R6)** is unimplemented; Supabase plan-tier support is still unverified.

**Status rationale.** The identity model (`platform_role`), the `/studio`/admin-surface gate, `TenantAuthorizationContext` resolution, and tenant/project-level RLS+GRANT isolation for every table with data flowing through it today are implemented and release-blocking-tested. What blocks a fully closed state is item 1: the Sanity and module-entitlement chokepoints are proven correct but inert. ADR-015 closes for real once at least one real route is wired through `tenantScopedSanityClient`/`assertModuleAction` (client-dashboard work), moving those boundaries from "in-memory only" to "both" in the coverage matrix.

---

## ADR-016 — Composable Module Pages

**Status:** Accepted
**Date:** 2026-08-01
**Supersedes:** —
**Superseded By:** —

### Context

A 2026-08-01 read-only design pass examined the `page` document type and its rendering path to evaluate whether the fixed-schema module singleton pages (`livePage`, `eventsPage`, `blogPage`) should move to the same section-composed model.

**The existing composable model (Verified fact).** The regular `page` type already carries `sections[]`, rendered by a per-route `SectionRenderer` implemented identically in `src/app/[locale]/(website)/[tenant]/page.tsx` and the `[slug]/page.tsx` route: a module-contributed `SECTION_MAP` lookup (`src/lib/modules/sections.ts`) falls back to a platform `switch` for platform-owned section types, with per-section async hydration where a section needs server-side data (e.g. `fetchBlogListingPosts`). This is the model this ADR extends, not a new one.

**Blog already proves the pattern out (Verified fact).** `blogListingSection` (`src/lib/modules/blog/schema.ts`) supports `filterMode` (`latest`/`featured`/`byCategory`/`byEvent`/`manual`), `sortOrder`, a `category` reference, an `event` reference, a manual `posts[]` list, `layout`, `maxItems`, and `viewAllLabel`/`viewAllHref` (`src/lib/modules/blog/schema.ts:59-169`). The Blog module declares `sectionTypes: ['blogListingSection']` (`src/lib/modules/registry.ts:74`).

**Events and Live have no listing sections (Verified fact).** Both modules declare `sectionTypes: []` (`src/lib/modules/registry.ts:152,210`) — their content is reachable only through fixed-field singleton routes; nothing comparable to `blogListingSection` exists for either module yet.

**The singletons are deliberately fixed, by design comment (Verified fact).** `livePage`, `eventsPage`, and `blogPage` have fixed schemas (hero/intro/etc.) with no `sections[]`. `src/lib/modules/blog/schema.ts:177` states outright: `// Never section-composed: the page has a fixed rendering contract.` This is the exact assumption ADR-009 encoded (`docs/architecture/architecture-decisions.md:398,482`) and that this ADR revisits.

**Three hardcoded-English strings violate the Multilingual-First Principle (Verified fact).** `src/components/livener/live/LivePageContent.tsx:46` ("No live event scheduled right now."), `:49` ("Check back soon."), and `:217` ("Past Live Events"); `src/app/[locale]/(website)/[tenant]/events/page.tsx:154` ("No events yet. Check back soon."). By contrast, `blogPage`'s empty state already routes through a localized dictionary (`src/lib/i18n/news-page-messages.ts`) — the pattern this ADR generalizes.

**Per-tenant module availability is not enforced at render time (Verified fact).** `ModuleInstallation` (`project.moduleInstallations[]`, ADR-011 sub-decision B2) is resolved only for Studio navigation. Nothing in `SectionRenderer` or either page route checks a tenant's `enabledModuleIds` before rendering a module's section — a section type belonging to an uninstalled module renders anyway if present in `sections[]`. This is a real gap distinct from anything ADR-011 closed.

**Cross-module references use untyped string-refs (Verified fact).** Existing patterns such as `blogListingSection.event` (`type: 'reference', to: [{ type: 'event' }]`) show the established, if untyped, mechanism for one module's section to reference another module's content — the same mechanism this ADR's new sections reuse.

**Two copies of `SectionRenderer` are known debt (Verified fact, tracked as I5).** The renderer logic is duplicated verbatim between `[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx`. Converting three more singletons into section-composed routes without first collapsing this duplication would produce four copies instead of two — compounding, not just carrying forward, existing debt.

### Alternatives Considered

- **Option 2 — additive sections, singletons kept permanently fixed.** Add `sections[]` to the singletons alongside their fixed fields and stop there, never retiring the fixed schema. Rejected as an end state: a page type that is simultaneously described by a fixed-field content model and a sections array is two configuration surfaces for one concept, violating the platform's one-configuration-surface principle (CLAUDE.md; ADR-014's rationale for the Integration Registry rests on the same principle). Retained, however, as the *shape* of Phase A below — additive is the correct low-risk first step, just not the final destination.
- **Keep the singletons fixed indefinitely (status quo).** Rejected: ADR-009 already flagged the fixed-contract choice as a tradeoff rather than a settled position (`docs/architecture-decisions.md:482`, "this is intentional given the fixed rendering contract... but it means adding new content blocks... requires a schema change"), and the I5 duplication debt already exists independently of this decision — leaving both unaddressed compounds rather than defers the cost.
- **Convert the singletons to composable pages in a single pass, no phasing.** Rejected: touches published content (Livener's live page) in the same change as new schema and new section types, maximizing blast radius for a single release and giving Tom no intermediate verification point. Phased delivery (Phases 0–D, below) is preferred so each phase is independently gated and deployable (CLAUDE.md §Deployment Workflow; Playbook P6).

### Decision

**Singleton pages move to the composable-page model (Option 1: full conversion), phased so the riskiest step — migrating and retiring the fixed schema — is isolated and last.**

1. **Fate of the singletons:** full conversion to composable pages. Phase A is additive only — `sections[]` is added to `livePage`, `eventsPage`, and `blogPage` alongside their existing fixed fields, with no migration and no visual change until content is actually added to a section. Migrating the fixed fields into sections and retiring the special schemas is a deliberate later phase (Phase C) requiring a Tom-approved migration plan for existing live content — specifically Livener's live page.
2. **Event categories are in scope now.** Add an `eventCategory` document type mirroring `blogCategory`, add a categories reference to the `event` type, and give the new Events Listing section a `filterMode: 'byCategory'` option, matching `blogListingSection`'s existing category filter.
3. **Model:** each content module contributes its own filterable, configurable, localized listing section(s) — Blog Listing already exists; this ADR adds `eventsListingSection` and a Live section, both built on the `blogListingSection` template (filter/sort/manual-selection/layout/max-items/view-all fields as applicable to that module's content shape). The section owns selection configuration only; the module owns the data and queries — this is the Sections-vs-Modules orthogonality rule (CLAUDE.md) applied, not relaxed, by this ADR. Any page composes any of these sections through the one `SectionRenderer`; a section's actual availability on a given tenant's page follows that tenant's installed modules (decision 7, below).
4. **Localized empty states.** Add `emptyStateHeading: localizedString` and `emptyStateBody: localizedText` (optional) to every module-listing section type (`blogListingSection`, the new `eventsListingSection`, the new Live section). Zero-items with both fields unset renders null, preserving today's behavior exactly. Zero-items with either field set renders a localized empty-state block. This retires the three hardcoded strings identified above by giving editors a first-class, localized replacement rather than a second hardcoded fallback.
5. **Bookings and Forum:** reference-only, in the same spirit as ADR-009's forward-looking Shop/Booking/CRM table — future modules follow this same section/module split. No stub schema, no placeholder section type, is created for either in this ADR.
6. **I5 pulled forward as a prerequisite.** The single shared `SectionRenderer` extraction (already tracked as debt, I5) is done *before* the three singletons gain their own `sections[]` wiring — Phase 0 below. Converting singletons against two renderer copies would have produced four; extracting first keeps it at one.
7. **Runtime module-installation gating is a phase of this ADR, not deferred further.** `SectionRenderer` checks a rendered section's `_type` against the requesting tenant's `enabledModuleIds` (already resolvable via the existing `project.moduleInstallations` / `enabledModuleIds` projection, ADR-011 sub-decision B2) and renders null for a section belonging to a module the tenant does not have installed. This closes the render-time gap identified above; Studio-side gating (ADR-010/ADR-011) is unaffected and unchanged.

This ADR realizes intent already recorded in ADR-009 (Pages/Collections/Modules; specifically its Alternative Considered "make every page a section-composed page document" and its Negative "the `blogPage` singleton... follows the fixed-fields pattern... this is intentional... but means adding new content blocks requires a schema change") and ADR-011 (module-contributed platform contracts, including `sectionTypes` and `ModuleInstallation`).

### Implementation Order

Each phase is independently deployable and independently gated (CLAUDE.md Deployment Workflow; spine §8 STOP discipline applies at each `dev`→`preview`→`main` promotion regardless of phase).

- **Phase 0 (prerequisite):** Extract the single shared `SectionRenderer` from its two current copies (`[tenant]/page.tsx`, `[tenant]/[slug]/page.tsx`) into one implementation both routes call. No schema change, no content change.
- **Phase A (additive, non-breaking):** Add `sections[]` to the `livePage`, `eventsPage`, and `blogPage` schemas alongside their existing fixed fields. Wire the Phase 0 shared renderer into the three singleton routes so sections render if present, without touching or migrating the existing fixed-field content.
- **Phase B:** Add `eventsListingSection` and a Live section (both on the `blogListingSection` template); add `eventCategory` document type and `event.categories` reference; add `filterMode: 'byCategory'` to the Events Listing section; add `emptyStateHeading`/`emptyStateBody` to all module-listing section types; replace the three hardcoded strings (`LivePageContent.tsx:46,49,217`; `events/page.tsx:154`) with the new localized empty-state fields.
- **Phase C (heaviest STOP discipline — the only phase touching published content):** Migrate the singletons' fixed fields into equivalent sections; retire the fixed schemas. Requires a Tom-approved migration plan (spine §7 — migrating published content is an irreversible action, `Tom decides`) specifically for Livener's live page before any migration script runs against it.
- **Phase D:** Runtime module-installation gating — `SectionRenderer` renders null for a section whose owning module is not installed for the requesting tenant, per decision 7.

### Consequences

**Positive:**
- Events and Live gain the same filterable, localized, editor-configurable listing capability Blog already has, via a proven template rather than a new design
- Event categorization becomes possible platform-wide, matching the existing blog category model
- The three hardcoded English empty-state strings are retired, closing a live Multilingual-First Principle violation
- The render-time module-gating gap is closed as part of this work rather than left open indefinitely
- Phasing (0–D) means each step ships and is verifiable independently — no single large, high-risk release
- Extracting the shared `SectionRenderer` (Phase 0) finally resolves I5 rather than deferring it again

**Negative:**
- Pulling I5 forward is real upfront engineering work that has to land before any singleton-facing progress is visible — a cost this ADR incurs deliberately rather than one that was already scheduled
- Phase C is the first phase in this initiative that touches published content (Livener's live page); migration risk is real and requires a dedicated Tom-approved plan, not a routine schema change
- Three more section types (`eventsListingSection`, the Live section, and any category-filter variants) become part of the long-term section library to maintain, test, and keep consistent with `blogListingSection` as that template evolves
- Until Phase D ships, the render-time module-gating gap remains open exactly as documented today

---

## ADR-017 — Client Authorization & Module Enablement

**Status:** Accepted
**Date:** 2026-08-05
**Supersedes:** —
**Superseded By:** —

> Tom accepted this ADR on 2026-08-06, confirming the two items left open at drafting: tenant-owner precedence (Decision 2) and the `leads.project_id` plan (Context, Decision 6, Consequences). Every decision below reflects Tom's final position; implementation proceeds from this acceptance point, subject to the `Tom decides` gates already named for the RLS-primary flip and schema/content migrations.

### Context

This ADR **continues ADR-015** (Platform Authorization & Tenant Isolation, Accepted 2026-07-24) — it does not reopen or amend it. ADR-015's eleven decisions and eight Orchestrator refinements (R1–R8) stand as accepted. Phase 1 of its Implementation Order (steps 2–4) shipped in **v1.0.19**: the `platform_role` identity (`abluo_admin` | `tenant_user`), the custom-access-token hook, and the central `requireAbluoAdmin` guard applied to `/studio` and 7 admin API routes (**Verified fact:** `src/lib/api/auth.ts` defines `PlatformRole` and the central actor resolver; `platform-authorization` gating landed per task #60–61). What remains open from ADR-015 is Implementation Order steps 5 and 7–10 — the `TenantAuthorizationContext` model, the RLS-primary flip, Sanity/module enforcement, and client login/MFA — plus R8's client-dashboard prerequisite, which this ADR closes.

**The pivotal fork Tom has ruled on: per-project membership, not per-tenant.** ADR-015 decision 3/4 established multi-tenant membership with per-membership roles, but left the grain of "membership" as tenant-wide. A completed read-only design pass surfaced the need to support a user who manages one project of a client's account but not another (e.g. a consulting user with limited scope inside a single tenant that runs several projects). **Tom's decision, recorded here as settled:** membership is granted **per project** (`project_id`), not per tenant. This requires a new `project_members(project_id, user_id, role)` table (roles: `owner` | `editor` | `viewer`) and rewriting RLS policies from the tenant-scoped `tenant_id in get_my_tenant_ids()` shape (ADR-015 §Supabase model, `tenant_members`) to a project-scoped `project_id in get_my_project_ids()` shape.

**Design-pass findings (Verified fact, code-referenced):**
- **`TenantAuthorizationContext` does not exist yet.** ADR-015's structural model (§Structural model) defines its shape but no implementation exists in `src/lib/api/` or elsewhere; `src/lib/api/auth.ts` currently implements only the `AuthenticatedActor`/`PlatformRole` half (admin identity), not the per-project membership half.
- **Service-role remains the default Supabase client for tenant-scoped reads.** `createAdminClient()` (`src/lib/supabase/admin.ts`) is imported directly by route handlers, including `src/app/api/inquiries/[id]/route.ts` (PATCH), which performs an unauthenticated, unscoped update keyed only on request-supplied `id` — the exact bypass pattern ADR-015 decision 5 exists to retire. This route remains a live gap this ADR schedules a close for (Implementation Order step 6, below).
- **`MODULE_PERMISSION_MAP` and `canPerformModuleAction`-style logic already exist** (`src/lib/modules/permissions.ts:65`, `buildModulePermissions()`), and **`enabledModuleIdsQuery`** already exists (`src/lib/sanity/queries.ts:365`) and is consumed by the Studio-side module gating built for ADR-011/ADR-016 Phase D. Both are reusable, not net-new — this ADR's entitlement guard composes them rather than re-inventing them.
- **The `leads` table has no `project_id` column (Verified fact, schema inspected) — resolved: add `project_id` per the phased plan below.** `supabase/schema.sql:101-116` defines `public.leads` with `tenant_id uuid not null references public.tenants(id)` and no `project_id` column; `leads_tenant_id_idx` is the only tenant-facing index. Per-project RLS on `leads` (`project_id in get_my_project_ids()`) cannot be written against the current schema. **Tom's confirmed resolution (2026-08-06):** `leads` gains a `project_id` column via a phased, additive-first migration — see Decision 6 for the five-step sequence. This closes what was previously flagged as Unknown-to-resolve; the one gated step within that sequence (flipping `project_id` to `NOT NULL`) still requires `Tom decides` sign-off at execution time, per spine §7.
- **`inquiries` already carries `project_id` (Verified fact).** `supabase/migrations/005_inquiries.sql` defines `public.inquiries` with both `tenant_id` and `project_id`, nullable for platform-level inquiries — this table is already shaped correctly for per-project RLS; `leads` is the outlier.
- **The client dashboard's data layer is unbuilt (Verified fact, confirmed unchanged since ADR-015).** No dashboard read path exists to retrofit — R8 remains trivially satisfiable because there is still little to no dashboard code, which this ADR treats as a closing condition rather than leaving open indefinitely.
- **No email provider is wired** — grep of the codebase and environment configuration surfaces no transactional email integration; the invitation flow (ADR-015 §Login, invitation, and MFA) cannot send an invite today. This blocks Implementation Order step 4 (client login/invite) until an email provider is selected and configured — an **Assumption** that this is provider-selection work outside this ADR's scope, tracked as a prerequisite gap rather than resolved here.
- **MFA/AAL2 availability depends on the Supabase plan tier** — TOTP MFA enforcement (ADR-015 decision 7, R6) requires verifying the current Supabase project's plan supports AAL2 session claims before scheduling step 5 (RLS flip involving admin-read policies, R4) or step 4's MFA enrollment. **Flagged as Unknown-to-resolve before implementation**, not yet verified in this design pass.

### Alternatives Considered

- **Per-tenant membership (status quo shape from ADR-015 decision 3/4)** — rejected as the final grain: it cannot express "manages project1 but not project2 of the same client," which is a real, named use case (a consulting user with partial scope inside one tenant). Per-tenant membership remains correct for the tenant *identity* boundary (who belongs to a tenant at all) but is the wrong grain for *authorization* once a tenant runs multiple projects. Per-project membership is chosen instead, with tenant-level membership retained only as the ownership/invitation anchor (see Decision, tenant-owner precedence).
- **Big-bang RLS flip (retire `createAdminClient()` everywhere in one release)** — rejected: ADR-015's own Negative consequences already flag this as "a genuine migration risk... needs careful staged verification, not a single flip." This ADR reaffirms and operationalizes that position with an explicit phased, shadow-mode rollout (Decision, below) rather than leaving "staged verification" undefined.
- **JWT-cached `TenantAuthorizationContext` (memberships/permissions embedded in the token)** — re-rejected here for the same reason ADR-015 R1 rejected it: a cached grant set cannot be revoked mid-session without a refresh mechanism, which reopens the exact gap ADR-015's session/revocation principles (§Session and revocation principles) exist to close. Per-project membership makes this rejection stronger, not weaker — a `ProjectGrant[]` array is larger and more likely to go stale mid-session than a single tenant role would have been.

### Decision

**1. Per-project membership is the authorization grain.** A `project_members(project_id, user_id, role)` table is added, with `role` in `owner | editor | viewer`. RLS policies that currently read `tenant_id in get_my_tenant_ids()` (ADR-015 §Supabase model; `tenant_members`, migration 003) are rewritten to `project_id in get_my_project_ids()` wherever the underlying table is project-scoped. `tenant_members` is not removed — it remains the account/tenant-identity anchor (invitation target, billing/ownership boundary); `project_members` is the new authorization-grain table layered on top of it.

**2. Tenant-owner precedence — confirmed (Tom, 2026-08-06).** `owner` is a **tenant-level** role, held in `tenant_members`: owning a tenant grants access to **all** of that tenant's projects, with no `project_members` row needed per project, and a single person can own more than one tenant. `editor` and `viewer` (and any future roles) are **project-level** grants, held in `project_members`, exactly as scoped in Decision 1. Mechanically, `tenant_members` is kept for the owner relationship and `project_members` is added for editor/viewer; `TenantAuthorizationContext` (Decision 3) **unions** the two — a caller's effective `ProjectGrant[]` is the union of (a) every project belonging to a tenant the caller owns and (b) every project the caller is explicitly granted via `project_members`. This settles what was previously a recommended default pending review; it is no longer conditional.

**Identity model (confirmed, Tom, 2026-08-06).** One email is one Supabase user account, and that account can hold memberships across multiple projects — including projects under **different tenants** (e.g. a freelance editor who works across two separate clients). This is intended, first-class behavior, not an edge case requiring special-casing anywhere in the authorization model: `TenantAuthorizationContext.projects[]` (Decision 3) is scoped to the user, not to a single tenant, and its resolution logic must never assume a user belongs to at most one tenant.

**3. `TenantAuthorizationContext`, resolved per-request from the database, never from the JWT (ADR-015 R1, carried forward unchanged):**
```ts
type TenantAuthorizationContext = {
  userId: string
  platformRole: PlatformRole
  projects: ProjectGrant[]
}

type ProjectGrant = {
  projectId: string
  projectSlug: string        // resolved server-side; never client-supplied
  membershipId: string
  role: 'owner' | 'editor' | 'viewer'
  permissions: string[]      // via MODULE_PERMISSION_MAP + role
  enabledModuleIds: string[] // via existing enabledModuleIdsQuery
}
```
`ctx.projects` is the **union** of two sources, per the confirmed tenant-owner precedence (Decision 2): every project belonging to a tenant the user owns (via `tenant_members`, role `owner`), plus every project the user is explicitly granted (via `project_members`, role `editor` or `viewer`). This union spans tenants without special-casing — a user who owns one tenant and holds an `editor` grant on a project under a different tenant sees both in the same `projects[]` array, per the confirmed identity model (Decision 2).

Recommended location: a new sibling module, `src/lib/api/tenant-context.ts`, alongside the existing `src/lib/api/auth.ts` — keeping `auth.ts` single-responsibility (platform-role identity only) and the new file responsible for per-project resolution. This context is additive and inert on landing: defining and resolving it does not itself change any route's behavior until routes are migrated to consume it (Implementation Order step 1).

**4. Sanity chokepoint — `tenantScopedSanityClient(ctx, projectId)` (ADR-015 R2, specialized to per-project grants):** validates `projectId ∈ ctx.projects` and **rejects** on mismatch — never silently substitutes a different project. Every query is built by spreading caller-supplied params first, then forcing `projectSlug` from the resolved `ProjectGrant` last, so a caller-supplied `projectSlug` can never override the server-resolved value. Raw GROQ string interpolation is banned at this chokepoint, per ADR-015 R2. The reference/media recursion guard (ADR-015 R3) is shared infrastructure at this same chokepoint: any write that sets a reference or attaches media re-fetches the referenced document's `projectSlug` and rejects a cross-project reference, independent of the parent document's own check.

**5. Entitlement + permission guard — `assertModuleAction(ctx, projectId, permissionId)`:** checks module-installed (`ProjectGrant.enabledModuleIds`) **before** per-membership permission (`MODULE_PERMISSION_MAP` + `ProjectGrant.role`), preserving the distinct, ordered steps 4–5 of ADR-015's 7-step sequence. This builds directly on the existing `MODULE_PERMISSION_MAP` (`src/lib/modules/permissions.ts:65`) rather than introducing a parallel permission model.

**6. RLS-primary rollout is phased and shadow-mode — the highest-risk piece of this ADR.** An RLS-backed, user-scoped Supabase client is built **alongside** the existing `createAdminClient()` service-role client, not as an immediate replacement. Migration proceeds route-by-route, lowest blast-radius first:
   1. Admin-dashboard tenant/project reads
   2. New client-dashboard `leads` SELECT
   3. `leads` INSERT/UPDATE
   4. Last: the live, client-facing `inquiries` / `form-submissions` paths (including closing the open `inquiries/[id]` PATCH gap named above)

   Each route migrates through: **shadow-read** (the new RLS-backed path runs alongside the old service-role path, mismatches are logged, the old path keeps serving responses) → **feature-flag flip** (the new path takes over serving) → **rollback is flipping the flag** — a config change, not a redeploy. Service-role legitimately remains for migrations, webhooks, and other trusted system operations; every such use is wrapped in `runAsTrustedSystemOperation()` (ADR-015 §Supabase model, generalized per R2) with a justification comment, so the remaining service-role footprint is auditable by grep — carrying forward ADR-015 Implementation Order step 12's audit requirement.

   **`leads.project_id` — confirmed phased plan (Tom, 2026-08-06), a prerequisite before slice 5.2/5.3 above reach `leads`:**
   1. Add `project_id uuid references public.projects(id)`, **nullable**. Purely additive — no behavior change, no RLS change yet.
   2. Backfill existing rows from each lead's `tenant_id` → its project. Trivial today because every tenant is 1:1 with exactly one project (`livener` → `livener-main`, `studiomartegani` → `studiomartegani-main`); if `leads` is empty at backfill time, this step is a no-op.
   3. Populate `project_id` on all new lead captures going forward.
   4. **Gated step, `Tom decides` at execution time:** only after the backfill is verified complete, flip `project_id` to `NOT NULL`, add an index on `project_id`, and add the project-scoped RLS policy (`project_id in get_my_project_ids()`).
   5. Keep `tenant_id` alongside `project_id` — it is derivable via `projects.tenant_id` and is harmless denormalization; retire it later if desired, but nothing in this ADR requires that retirement.

   Steps 1–3 are fully reversible and carry no behavior change; step 4 is the one gated, irreversible-adjacent change (spine §7) and is not executed without explicit Tom sign-off. This resolves the ADR's earlier "leads.project_id Unknown" flag (see Context).

**7. Client login and invitation is a parallel track**, not blocked on the phases above and not blocking them: invite → set password → `project_members` (and, where applicable, `tenant_members`) row created → email verified → MFA enrolled where policy requires (ADR-015 §Login, invitation, and MFA). Two prerequisite gaps are stated, not resolved, by this ADR: no email provider is wired yet (blocks sending invites), and MFA/AAL2 availability depends on the Supabase plan tier (must be verified before scheduling MFA-dependent work).

**8. The client dashboard's data layer takes `TenantAuthorizationContext` as its first parameter, from line one.** Per ADR-015 R8, carried forward unchanged and made concrete here: no dashboard read/write function is written without this parameter, because there is still little to no dashboard code to retrofit.

**9. The cross-tenant test harness (ADR-015 decision 10) is pulled forward** to be built immediately after the context (Implementation Order step 2, below) and used as a release-blocking CI guard for every subsequent enforcement slice in this ADR — not deferred to the end of the workstream as ADR-015's original Implementation Order step 11 implied.

### Implementation Order

Each slice honors the `dev` → **STOP** → `preview` → **STOP** → `main` gates (spine §8; CLAUDE.md Deployment Workflow) independently.

0. **Membership-grain decision** — done: per-project (this ADR, Decision 1).
1. **`TenantAuthorizationContext` implementation** — additive, inert; lands first with no route depending on it yet.
2. **Cross-tenant test harness** — built immediately after step 1; becomes the guard every later slice runs against.
3a. **Sanity chokepoint** — `tenantScopedSanityClient(ctx, projectId)` + reference/media recursion guard.
3b. **Entitlement + permission guard** — `assertModuleAction(ctx, projectId, permissionId)`.
4. **Client login / invitation** — parallel track; blocked on email-provider selection (prerequisite gap, above).
5. **RLS-primary flip** — last, and itself phased per Decision 6 (admin reads → leads SELECT → leads INSERT/UPDATE → inquiries/form-submissions).
6. **Wire into the client dashboard** + close the open `inquiries/[id]` PATCH P0 (currently unauthenticated `createAdminClient()` usage, named above under Context).
7. **Cross-tenant harness becomes a permanent CI gate** + full service-role audit (generalizes ADR-015 Implementation Order step 12 to the per-project model).

### Consequences

**Positive:**
- Closes the remaining exposure ADR-015 left open (Implementation Order steps 5, 7–10) rather than leaving it as permanently deferred follow-up
- The client dashboard is authorization-correct from its first line of code (R8), avoiding a future retrofit
- The cross-tenant test harness becomes an operational CI gate early (step 2) rather than a step-11 afterthought, so every subsequent enforcement slice in this ADR ships against a working regression guard
- Per-project membership expresses a real, previously unsupported use case (partial-scope consultants) without requiring a second migration later
- The shadow-mode, route-by-route RLS rollout (Decision 6) gives explicit, reversible checkpoints instead of a single high-risk flip

**Negative:**
- The RLS migration remains genuinely risky regardless of phasing — shadow-mode reduces blast radius but does not eliminate the risk ADR-015 already flagged as its most consequential open item
- Per-project RLS cannot be written against `leads` today (no `project_id` column) — resolved via the confirmed phased plan (Decision 6), but the plan's gated step (flipping `project_id` to `NOT NULL` and adding the RLS policy) still requires backfill verification and explicit `Tom decides` sign-off before step 5 reaches `leads`
- Client login is blocked on an unselected email provider, and MFA/AAL2 scheduling is blocked on an unverified Supabase plan-tier capability — both are prerequisite gaps outside this ADR's authority to resolve
- `project_members` and `tenant_members` coexisting as two membership tables is additional relational complexity to keep consistent (e.g. an owner's implicit per-project access must stay correct as projects are added to or removed from a tenant, and a user's `projects[]` union must stay correct as tenant-ownership and project-grants are added or revoked independently)

---

**Decision ownership note (spine §4):** acceptance of this ADR is `Tom approves` — **now done** (2026-08-06). Within it, the RLS-primary flip (Decision 6) and any schema/content migration (including the confirmed `leads.project_id` addition and its gated `NOT NULL` step) remain `Tom decides` at execution time — irreversible-adjacent actions per spine §7, planned here but never executed without explicit sign-off at the moment each is run.

---


## ADR-018 — Forms Module

**Status:** Accepted
**Date:** 2026-08-11
**Supersedes:** —
**Superseded By:** —
**Related:** ADR-019 (Server-side Integration Event Consumers — V1 notification delivery for this module)

> **Accepted by Tom, 2026-08-11**, after a design pass and four rounds of correction. The settled forks are recorded in the decisions below: (1) form definitions are **tenant-owned**, reusable across a tenant's projects by reference, with cross-tenant reuse delivered by an **admin-only clone** (never live sharing) and seeded from **platform templates**; (2) **versioning** is snapshot-authoritative — a monotonic integer `version` on the live definition, with `form_version` + an immutable `definition_snapshot` **pinned at submission creation** as the authoritative historical record; (3) submissions live in a new dedicated **`form_submissions`** table; (4) the submission contract ships as **slice 1**, retiring the `#88` dual-purpose-endpoint hack; (5) Forms is **decoupled from all delivery providers** — it persists submissions and emits `form.submitted`; delivery is the Integration layer's job (ADR-019). Remaining `Tom decides` gates are named under *Open Decisions* and honored at execution time per spine §7.

### Context

Forms today are **bespoke per-site**. The only live form (Early Access) is hand-built on the generic `inquiries` table (migration 005) with a two-step modal (`EarlyAccessModal.tsx`) that POSTs a partial record then PATCHes it. That PATCH — `src/app/api/inquiries/[id]/route.ts` — is a **single endpoint serving two callers**: the anonymous public form's step-2 completion *and* the authenticated dashboard's inquiry edits. This collision (`#88`) is the recurring root cause of form breakage: every security-hardening pass that authenticates the endpoint (as the ADR-017 P0 fix did in v1.0.22) breaks the public form, because the anonymous caller has no session. Per-site construction also violates the **Sections-vs-Modules principle** (a form owns a submissions collection, multi-step/spam/GDPR/notification logic, and leads-management permissions — textbook module concerns) and defeats *build-once-deploy-many* by multiplying that `#88` fragility across every future form.

A form is a **reusable, versioned definition that is independent of the pages/CTAs/websites where it appears** (Concept Spec §2, §7, §28). This ADR makes Forms a first-class **Module** and specifies the ownership/versioning model, the placement/context model, the immutable submission contract, and the platform responsibilities (spam, validation, isolation, accessibility, i18n) the module inherits once for every form. **Notification delivery is explicitly out of this module** and specified in ADR-019.

**Terminology mapping (confirmed).** The Concept Spec's *Website* is Abluo's **Project** (`projectSlug`). The conceptual hierarchy `Tenant → Website → Placement → Definition → Version → Submission` (§3) maps to `tenant → project → formSection → form(document) → form_version → form_submission`. Every submission records **both** `tenant_id` and `project_id` (§3, §16) — never `tenant_id` alone.

**Architectural Principle #1 exception (called out deliberately, not accidentally).** CLAUDE.md Principle #1 states every tenant Sanity document carries `projectSlug` and all GROQ filters by it. Form **definitions are the first deliberate exception**: they are **tenant-owned** (keyed at the client/tenant level), not `projectSlug`-scoped, so one definition is reusable across a tenant's projects without duplication (Decision 1). Submissions remain fully project-scoped (`project_id`), so no isolation is weakened at the data layer. This exception is documented here and should be added to CLAUDE.md's principles when this ADR is implemented.

**Substrate this ADR composes rather than reinvents (Verified fact, code-referenced):**

- **Form Field Library** — 16 field-type components under `src/components/fields/` (import only via `index.ts`), `useFieldValidation` (`validateField`/`validateForm`), `FieldWrapper` chrome, `FormField` dispatcher. Leaf components read DS CSS vars directly (no `designSystem` prop). Presentation layer for fields; already exists and is DS-themed.
- **DS token pipeline for forms** — `FormTypography`/`FormGeometry` (`src/lib/sanity/types.ts`), `formTypographyType`/`formGeometryType`, `DS_FIELDS_SELECTION`, `mergeDesignSystems()`, `buildCssVars()`. Form appearance derives from the website Design System (§20/§21) with no per-tenant work.
- **Spam protection** — `src/lib/forms/spam.ts`: `runSpamChecks()` (honeypot → timing → per-IP rate-limit via a Supabase count) + `extractIp()`, with a documented Cloudflare Turnstile escalation hook.
- **Generic submissions precedent** — `inquiries` (migration 005): `tenant_id`+`project_id` (both nullable for platform-level), `data jsonb`, top-level `gdpr_consent`/`gdpr_consent_at`, `source`, `status`. Shape informs `form_submissions`; not reused as the store (Decision 5).
- **Design System template + clone precedent** — `designSystem.role` ∈ `template | active`; `ExportDesignSystemAction`/`ImportDesignSystemAction` do a **field-agnostic clone** (strip only `_id`/`_rev`/`_createdAt`/`_updatedAt`/`_type`; all content passes through). This is the exact pattern Decision 1's platform-template + admin-clone model mirrors.
- **Module registry** — `MODULE_REGISTRY` (`src/lib/modules/registry.ts`): a `ModuleManifest` per module (`platformContract`: `pageType`/`collections`/`sectionTypes`/`schemaTypes`/`schemaDefinitions()`/`permissions`; `dataStore.primary` ∈ `content|operational|hybrid`), `moduleInstallations[]` per-project on the Sanity project doc, `MODULE_PERMISSION_MAP` derived at load (`src/lib/modules/permissions.ts`), `validateRegistry()` guardrail.
- **Integration registry** — `INTEGRATION_REGISTRY` + `buildIntegrationSchemaTypes()` (`src/lib/integrations/`): the precedent for **generating Sanity schema from a manifest**. The form-definition schema follows the same "declare once, derive the Studio surface" leverage.
- **Authorization stack (ADR-015/017, shipped v1.0.22)** — `getTenantAuthorizationContext()` → `TenantAuthorizationContext.projects: ProjectGrant[]` (`src/lib/api/tenant-context.ts`, per-request from DB, never JWT); `tenantScopedSanityClient(ctx, projectId)` chokepoint (bans client-supplied `projectSlug`, bans raw GROQ interpolation, forces `$projectSlug`) + `assertSameTenantReference()` (`src/lib/api/tenant-scoped-sanity.ts`); `assertModuleAction(ctx, projectId, permissionId)` (module-installed check **before** permission check, `src/lib/api/module-action-guard.ts`); `project_members` + `get_my_project_ids()`/`get_my_tenant_ids()` SECURITY DEFINER RLS; `leads.project_id` (nullable, migration 008); `runAsTrustedSystemOperation()` wrapper; `requireAbluoAdmin` platform gate.
- **Composable Module Pages (ADR-016)** — shared `SectionRenderer`, module-owned `sectionTypes`, `isSectionTypeAvailable()` runtime install-gating (fail-open on null). A `formSection` slots straight in.
- **Multilingual** — `localizedString`/`localizedSlug`, `useProjectLocales`, `LocalizedInput`, next-intl. Everything visitor-facing is localizable today (§9 is satisfiable, not net-new).

### Alternatives Considered

- **Per-site form builds (status quo)** — rejected: violates Sections-vs-Modules, defeats build-once-deploy-many, multiplies the `#88` dual-endpoint fragility per form.
- **Definitions stored in Supabase** — rejected as the definition home: abandons the Sanity registry pattern used by every other content/config surface, and forfeits localized authoring, Studio editing, and the `moduleInstallations`/`enabledModuleIdsQuery` gating machinery. Its immutability strength is captured instead by the submission snapshot (Decision 4).
- **Project-scoped definitions** — rejected: cannot be reused across a tenant's websites without duplication, which the concept explicitly wants to avoid (§2/§7).
- **Live cross-tenant sharing of a definition** — rejected on isolation grounds: a single doc rendered on two tenants' sites makes editing rights, submission attribution, and RLS ambiguous. Cross-tenant reuse is an **admin-only clone** instead (Decision 1) — an independent copy, isolation never crossed at runtime.
- **Reuse the `inquiries` table for submissions** — rejected by Tom in favor of a dedicated `form_submissions` table with first-class `form_id`/`form_version`/`context`/`definition_snapshot` columns.
- **Version = a reference to the live definition doc; or freeze only at finish** — both rejected: a submission that dereferences mutable CMS state, or that is only pinned at completion, can complete against a definition that changed mid-session. Pin at **creation** and snapshot (Decision 4).
- **Forms calls a delivery provider directly (Resend/WhatsApp/CRM) — even just for a V1 email** — rejected: couples the module to a channel and puts recipients/secrets inside the form's domain. Forms emits `form.submitted`; the Integration layer delivers (Decision 9, ADR-019).
- **One shared submission endpoint with a role branch (patch `#88` in place)** — rejected: the shared endpoint is the collision. The contract separates the two paths structurally (Decision 6).

### Decision

**1. Forms is a Module; definitions are tenant-owned, seeded by platform templates, reused across tenants by admin clone.**
- A new `forms` entry is added to `MODULE_REGISTRY` with `dataStore.primary: 'hybrid'`. It owns definitions (content tier), submissions (operational tier), the submission/validation/spam logic, and the submissions-management permissions. It contributes a **Form Section** (presentation). Per-project enablement already works via `moduleInstallations` keyed by `projectSlug` — Forms can be on for one project and off for another with no data-model change.
- **Ownership:** a `form` definition is **tenant-owned** (keyed at the client/tenant level; e.g. a `client` reference / `tenantSlug`), reusable across that tenant's projects **by reference**. It does **not** carry `projectSlug` (the Principle-#1 exception above). This is the security/ownership boundary: a tenant's forms are its own.
- **Platform templates:** platform-owned template definitions (no tenant — analogous to `designSystem.role: 'template'` and the platform section library) provide the reusable starting library.
- **Admin cross-tenant clone:** operational "build once, reuse everywhere" is delivered by an **admin-only clone action** (`requireAbluoAdmin`), mirroring `ExportDesignSystemAction`/`ImportDesignSystemAction`: template → tenant, or tenant A → tenant B. Clone produces a **fresh definition** — new `_id`, its own `version` counter (starting at 1), owned by the **target** tenant — copies the definition only (never submissions), and strips Sanity metadata + tenant-identifying fields on the way in (field-agnostic, like the DS Import). A tenant user can never clone across tenants (that would be a cross-tenant read/write); only Abluo admins can.
- **Consequence — references are always same-tenant.** Because cross-tenant reuse is a clone, a `formSection` on a project page only ever references its own tenant's definition. The `assertSameTenantReference` guard (ADR-015 R3) therefore needs a **same-tenant** check for these references, not the cross-`projectSlug` check it does today — a small, bounded adjustment to that shared guard.

**2. Form Definition and Form Placement are separate concepts (§7).**
- **Definition** — the tenant-owned Sanity `form` document: the reusable "what the form is" (fields, steps, validations, localized copy, success behaviour, privacy requirements). No recipients/channels (Decision 9).
- **Placement** — a `formSection` (or a CTA/button that opens a form) that **references a form by id** and supplies static **Context**. The same definition is reused across pages, CTAs, and projects of the tenant; each placement differs only by its Context (§7's Appointment-Request-across-four-pages example).

**3. Definition schema (Sanity `form` document).** Fields (localized where visitor-facing, §9):
- Identity: `internalName`, `title` (localized), `formType` ∈ `single-step | multi-step | question-answer`, monotonic integer `version` (Decision 4), ownership scope (client/tenant reference; `role: template | active`).
- `steps[]` — each `{ key, title (loc), description (loc), fields[] }`. Single-step forms are one step. Step count is data, never hard-coded (§4).
- Each field extends a Field-Library `FieldConfig` (`src/components/fields/types.ts`) with: stable `internalKey` (e.g. `treatment`, `email`, `preferred_date`, `privacy_consent`), `contextMappable`, `required`, `validation`, localized `label`/`placeholder`/`help`/`options`, step assignment. The **internal key is stable across languages**; only the visible label is localized (§8).
- `successBehavior` — `inline` (localized confirmation copy) | `redirect` (path), localized (§13).
- `privacy` — configurable consent field(s) + localized privacy copy; consent state retained on the submission (§23).
- `notificationTopic` — an **abstract, provider-agnostic routing tag** (a stable internal key like `appointment-request` or `contact`; optional, defaults to the form id). It is **not** recipients or channels — it rides on the emitted event for the Integration layer to route on (Decision 9). It is the only notification-related field on the definition.

Schema **types are generated from a manifest-style declaration** (Integration Registry precedent, `buildIntegrationSchemaTypes()`), keeping field types in lockstep with the Field Library rather than hand-duplicated in Studio.

**4. Versioning — snapshot-authoritative, pinned at creation (Tom's ruling).** The live `form` document carries a **monotonic integer `version`**, incremented on each meaningful publish (bump mechanism is an Open Decision). The **authoritative historical record is the immutable snapshot pinned when the submission row is created** (step 1, not finalization): the server resolves the fully-published definition at that instant and freezes it into `form_submissions.definition_snapshot` (jsonb) alongside `form_submissions.form_version` (the integer) and `form_id`. **These never change after creation.** A visitor who starts on v3 completes v3 even if v4 publishes mid-session — one consistent version, never a mix. Every later step of a multi-step submission is validated against the **row's own pinned snapshot**, never against live Sanity state (§10).

**Snapshot boundary (Tom's ruling).** `definition_snapshot` contains **only what is needed to interpret the historical submission**: fields, steps, options, localized labels, validation rules, and consent text. It **excludes operational/secret configuration** — no recipients, channels, or (future) integration credentials, none of which live on the definition anyway (Decision 9). A `resolveDefinitionSnapshot()` projection emits exactly the interpretation subset; anything operational is resolved live, downstream, never frozen into a submission row.

**5. Submission storage — new `form_submissions` table (Tom's ruling).** Conceptual columns (final DDL in slice 1):

```
form_submissions
├── id                  uuid pk
├── tenant_id           uuid  → tenants(id)   (nullable: platform-level forms)
├── project_id          uuid  → projects(id)  (the Website, §3/§16)
├── form_id             text  (Sanity form document _id)
├── form_version        int   (monotonic; pinned at creation, Decision 4)
├── definition_snapshot jsonb (immutable, interpretation subset; pinned at creation)
├── locale              text  (retained per submission, §9)
├── source              jsonb (page / url / placement / cta / campaign, §12)
├── context             jsonb (known values passed by the placement, §6)
├── submission_data     jsonb (submitted values keyed by internalKey)
├── status              text  check in (new, processed, archived, spam)  (§22)
├── gdpr_consent        bool  + gdpr_consent_at timestamptz  (top-level, §23)
├── completion_state    text  check in (partial, complete)   (multi-step, Decision 6)
├── created_at / updated_at
```

RLS is **project-scoped from day one** (`project_id in get_my_project_ids()` for SELECT; writable roles for UPDATE), mirroring the ADR-017 model — isolation at the data layer, not UI hiding (§16). Anonymous visitors can **create** but never **read** (§16): public INSERT goes through the API route's service-role client wrapped in `runAsTrustedSystemOperation('public form submission', …)`; all dashboard reads/writes use the RLS-backed, request-scoped client under `TenantAuthorizationContext`. `source`/`context` are populated **server-side wherever possible** (§12), not via admin-authored hidden fields.

**6. Submission contract — two structurally separated write paths, rotating single-use step tokens (fixes `#88`, ships as slice 1).**
- **Anonymous public path** (no session): `POST /api/forms/{projectSlug}/{formId}/submissions` runs spam checks + server validation, then creates a submission and **pins `form_version` + `definition_snapshot`** (Decision 4). A single-step form finalizes immediately (`completion_state = complete`, `form.submitted` emitted). A multi-step form creates a `partial` submission and returns `{ submissionId, stepToken }` — an opaque, server-stored, **single-use** token **bound to that submission** with an expiry. Completing a step calls `POST /api/forms/{projectSlug}/{formId}/submissions/{id}/steps` presenting the current token; the server accepts **only whitelisted, still-incomplete fields on a still-`partial` submission**, and — on success — **spends the presented token and issues a fresh one** (`stepToken` rotates every step). A token that is missing, already spent, expired, or bound to a finalized submission is rejected. The final step flips `completion_state = complete`, invalidates all tokens for the submission, and emits `form.submitted`.
- **Authenticated dashboard path**: reads/updates go through `getTenantAuthorizationContext()` + RLS-backed client + `assertModuleAction(ctx, projectId, 'forms.submission.read' | '…update')`. It **never shares an endpoint** with the anonymous path.

The two paths are different routes with different trust models, so authenticating the dashboard can never break the public form — this removes `#88`'s root cause by construction. A **duplicate-submission guard** (idempotency on the finalize step / rotating token) prevents network-retry double entries (§24). The **Early Access modal is migrated onto this generic anonymous contract** in slice 1, retiring its bespoke `/api/inquiries/[id]` PATCH — the concrete `#88` close.

**7. Context-aware forms — first-incomplete-step from actual values (§5/§6).** A placement passes **Context** (`treatment=implantology`, `source`, `page`, `cta`, campaign values, URL params). The runtime maps Context values to fields by `internalKey`/`contextMappable`, pre-populates them, and **starts at the first step with an unsatisfied required field** — computed from known values, not a configured `startAtStep`. Homepage "Book an appointment" (no treatment) → step 1; Implantology page "Request an implantology consultation" (`treatment=implantology`) → pre-filled, opens at step 2. Context is **server-validated** (Decision 10): only `contextMappable` fields can be set from Context, and Context can **never** set `tenant_id`/`project_id` or any privileged/cross-tenant value (§18) — those are resolved server-side from the route and the placement's own project.

**8. Form Section — presentation, DS-derived (§20/§21).** A `formSection` type is registered in `SectionRenderer` (module-owned `sectionType`, gated by `isSectionTypeAvailable()` per ADR-016). It references a `form` by id (same-tenant, Decision 1) and carries the placement's Context. Appearance derives **entirely from the website Design System** via the form DS token pipeline — no imposed "Abluo form style"; typography, colours, spacing, field height, buttons, focus/error/success states, container width, and responsive behaviour all come from DS tokens. Accessibility (§19) is inherited from the Field Library (semantic labels, field associations, keyboard nav, focus management, accessible error/validation announcements, multi-step progress) — solved once.

**9. Forms is decoupled from delivery; it persists and emits `form.submitted`. Delivery is the Integration layer (ADR-019).** The Forms module's outbound boundary is exactly two things, in one transaction: **persist the submission** and **write an event** to an append-only outbox (`form_events`). It calls **no** provider — not Resend, not WhatsApp, not a CRM. The `form.submitted` event payload is provider-agnostic:

```
form.submitted  { eventId, tenantId, projectId, formId, formVersion,
                  submissionId, topic (Decision 3 notificationTopic), locale, occurredAt }
```

No recipients, addresses, channel config, or secrets appear in the event or the submission. **Persistence is the source of truth and commits first**; the Integration-layer consumer (ADR-019) reads the outbox and delivers. A delivery failure can never roll back or hide a valid submission (§14/§15/§24). This is what keeps §14's "notifications in V1" true while keeping Forms free of every provider — delivery is specified and built in **ADR-019**, this module's V1 notification dependency.

**10. Platform responsibilities, inherited once (§17/§18/§19).**
- **Spam** (§17): reuse `runSpamChecks()`; escalate to the Turnstile hook if abuse appears. Baseline protection is automatic, not per-form.
- **Server-side validation** (§18): client validation is never authoritative. The server validates every submission against the **row's pinned snapshot** — field types, required fields, permitted options, payload structure, `form_version`, the `tenant_id`/`project_id` relationship, Context legitimacy.
- **Accessibility** (§19): from the Field Library.
- **Isolation** (§16): project-scoped RLS at the data layer.
- **Admin-only builder** (§1): form creation/editing/cloning is **abluo_admin-only in V1**, via a Studio pane gated like `ModuleList`/`IntegrationsPane`. Tenant users do not build forms in V1.

**11. Permissions (declared on the `forms` manifest, wired into `MODULE_PERMISSION_MAP`).**
- `forms.submission.read` — defaultRoles `owner, editor, viewer`.
- `forms.submission.update` — defaultRoles `owner, editor` (status: new → processed → archived).
- `forms.submission.delete` — defaultRoles `owner, editor`.
- `forms.definition.manage` / `forms.definition.clone` — admin-surface capabilities. Because definitions are abluo_admin-only in V1, these are enforced by the platform admin gate (`requireAbluoAdmin`) rather than a tenant role (confirm at slice 8 — Open Decision). All submission actions are enforced through `assertModuleAction` (module-installed check precedes permission check).

### Implementation Order

Each slice honors the `dev` → **STOP** → `preview` → **STOP** → `main` gates independently (spine §8). The cross-tenant isolation harness (`src/lib/api/__tests__/cross-tenant-isolation.test.ts` + `supabase/verify`) is a release-blocking gate for every slice that touches storage or authz. The anonymous token path additionally gets dedicated token-abuse tests as a release-blocking gate.

1. **Submission contract + `form_submissions` table + `form_events` outbox + `#88` retire.** New migration (`form_submissions` + `form_events` + project-scoped RLS + indexes). Build the two separated write paths (Decision 6), rotating single-use step tokens, spam + server validation, snapshot pinned at creation, and `form.submitted` written to the outbox. **Migrate the Early Access modal onto the anonymous contract**; retire the dual-purpose `/api/inquiries/[id]` PATCH. Definition is still config-driven (`early-access-config.ts`) at this slice. *This slice is the `#88` fix.*
2. **Form definition schema + `forms` registry entry (additive, inert).** `forms` manifest, tenant-owned Sanity `form` document type generated from the manifest, `version` + `notificationTopic` + `role: template | active`, `validateRegistry()` coverage. No route depends on it yet.
3. **Server validation against the pinned snapshot.** Submission API resolves the published definition at creation, validates against it, freezes the interpretation-subset snapshot + `form_version` (Decision 4), and validates later steps against the row's snapshot.
4. **Form Section + runtime (single-step first).** `formSection` in `SectionRenderer`, DS-derived rendering, one real definition rendered on a page end-to-end; `assertSameTenantReference` same-tenant variant wired for the reference.
5. **Multi-step + context-aware first-incomplete-step.** Steps, Context mapping, first-incomplete-step resolution, anonymous multi-step completion via the slice-1 rotating-token contract.
6. **Submissions dashboard read.** Wire `form_submissions` into the `(client)` dashboard (`/[locale]/[projectSlug]/…`) on `TenantAuthorizationContext` + `assertModuleAction`, with the `status` lifecycle.
7. **Admin form builder + clone (Studio pane).** abluo_admin-only create/edit/publish of definitions, platform templates, and the cross-tenant clone action (DS Export/Import precedent); the `version`-bump mechanism.

**V1 notification delivery is ADR-019**, built in parallel against the `form.submitted` outbox this ADR emits (its own slices there). Forms does not wait on it — the dashboard inbox (slice 6) means no submission is lost before delivery exists.

V2 (Concept Spec §26, out of V1): save-and-resume, draft submissions, tenant submission inbox with per-user assignment, advanced workflow states, CRM/webhook/marketing integrations, advanced analytics (starts/completion/step-drop-off/attribution), conditional field/step logic, file uploads, advanced notification routing.

### Open Decisions (`Tom decides`)

- **`version`-bump mechanism** — automatic on publish (Studio publish action / document-action hook) vs an explicit editor-bumped field. Slice 2/7.
- **`notificationTopic` default** — default to the form id when unset (recommended), or require an explicit tag. Slice 2.
- **Clone field-stripping list** — the exact set of tenant-identifying/operational fields cleared on clone, beyond Sanity metadata (mirror the DS Import list). Slice 7.
- **`forms.definition.manage`/`clone` enforcement** — platform admin gate (`requireAbluoAdmin`) vs a real tenant permission, given definitions are admin-only in V1. Slice 7.
- **`project_id` nullability on `form_submissions`** — mirror `inquiries` (nullable for platform-level forms like Early Access, `tenant_id` NULL) vs `NOT NULL` for tenant forms with a partial index. Slice 1; any `NOT NULL`/RLS-tightening follows ADR-017 Decision 6 discipline and is itself a gated step.
- **RLS-primary vs service-role for the anonymous INSERT** — the public create path stays service-role (wrapped) because anonymous visitors have no JWT; confirm this matches the §16 "create-but-not-read" intent (it does) at slice 1.
- **Early Access migration shim** — whether the two-path modal maps cleanly onto the generic rotating-token contract or needs a short-lived compatibility shim during the slice-1 cutover.

### Consequences

**Positive:**
- One canonical, reusable form architecture — definition independent of placement (§2/§7/§28), reused across a tenant's projects by reference and across tenants by admin clone.
- Tenant ownership + admin clone preserves security/isolation (no live cross-tenant sharing) while still delivering operational reuse — and eliminates cross-tenant references at runtime (simplifying the R3 guard).
- The `#88` root cause is eliminated **by construction** (path separation + rotating single-use tokens), not patched.
- Submissions are immutable and audit-correct (§10/§23) — pinned at creation, so no historical submission is ever reinterpreted or mixed across versions; the snapshot carries only interpretation data, no secrets.
- Forms is provider-decoupled — it emits a clean `form.submitted` with an abstract topic; delivery, recipients, and channels live entirely in the Integration layer (ADR-019), which future CRM/webhook/marketing consumers reuse.
- Authorization-correct from line one (ADR-017 R8): dashboard paths take `TenantAuthorizationContext` and go through `assertModuleAction` + project-scoped RLS.
- Maximum reuse — Field Library, `spam.ts`, DS token pipeline, module + integration registry patterns, DS clone precedent, and the composable-section renderer are composed, not rebuilt.

**Negative:**
- Two new Supabase tables (`form_submissions`, `form_events`) and their RLS to keep consistent with the ADR-017 per-project model.
- Tenant-owned definitions are a **deliberate exception to Architectural Principle #1** — it must be documented in CLAUDE.md and the `assertSameTenantReference` guard extended with a same-tenant variant, or a project page's reference to a tenant-scoped form would be mis-evaluated.
- `definition_snapshot` denormalization increases row size — the deliberate cost of history-independence.
- The `version`-bump discipline is effectively manual until the builder ships (slice 7); until then definitions beyond Early Access require admin authoring.
- The anonymous rotating-token path is new public security surface — dedicated token-abuse + cross-tenant tests are a release-blocking gate.
- V1 notifications depend on ADR-019 being delivered in parallel; if ADR-019 slips, V1 forms collect into the dashboard inbox but send nothing until it lands.

---

**Decision ownership note (spine §4):** acceptance of this ADR is `Tom approves` — **done (2026-08-11)**. Within it, the `form_submissions`/`form_events` migrations and any RLS-tightening (the `project_id` `NOT NULL` step, the RLS-primary flip for submission reads) are `Tom decides` at execution time — irreversible-adjacent actions per spine §7, planned here but never executed without explicit sign-off at the moment each is run.


---

## ADR-019 — Server-side Integration Event Consumers (Form Notifications)

**Status:** Proposed
**Date:** 2026-08-11
**Supersedes:** —
**Superseded By:** —
**Extends:** ADR-014 (Integration Registry & the One-Configuration-Surface Principle)
**Depends on:** ADR-018 (Forms Module — emits `form.submitted`, owns the `form_events` outbox)

> Companion to ADR-018. ADR-018 makes the Forms Module provider-decoupled: it persists a submission and emits a `form.submitted` event to an append-only outbox, and calls no delivery provider. This ADR specifies the **other half of V1 notifications** — a server-side consumer, in the Integration layer, that reads those events and delivers them to a channel (email first, via Resend), with recipients and channel configuration owned by the Integration layer, never by Forms. Notifications are V1 (Concept Spec §14); this is where they are actually built.

### Context

ADR-018 Decision 9 fixed the Forms boundary at *persist + emit*. That leaves a real, named gap:

- **ADR-014's Integration Registry is client-side only.** `INTEGRATION_REGISTRY` (`src/lib/integrations/`) describes browser-injected tracking scripts (GA4, GTM, Meta Pixel, custom scripts); `TrackingScripts.tsx` renders them at runtime via `resolveTracking()`. There is **no server-side event-consumer or channel-dispatch mechanism** anywhere in it. An integration today has a `renderContract.component` (a frontend component) — it has no notion of "consume an event and send something."
- **Resend is wired at the wrong layer for this.** Resend is configured as Supabase custom SMTP for **auth** emails (invites/password reset, `no-reply@mail.abluo.app`). There is no application-level "send this notification" path that reads per-project recipient config and dispatches — that path does not exist yet.
- **The concept spec makes notifications V1** (§14) and demands they be **decoupled** from submission persistence (§14/§15/§24): a notification failure must never lose or hide a valid submission, and saving vs sending are separate operations. ADR-018 satisfies the "decoupled" and "persistence is source of truth" half; this ADR satisfies the "notifications actually happen" half without recoupling.

So V1 notifications require a **new server-side capability in the Integration layer** that subscribes to form events. This is an extension of ADR-014 (an integration gains a *consumer* contract alongside its *render* contract), not a new parallel system.

**Substrate to reuse (Verified fact / from ADR-018):**
- `form_events` append-only outbox (owned by ADR-018 slice 1): `{ eventId, tenantId, projectId, formId, formVersion, submissionId, topic, locale, occurredAt }` plus delivery bookkeeping columns this ADR adds.
- The Integration Registry manifest + generated-schema pattern (`buildIntegrationSchemaTypes()`) for authoring per-project config in Studio.
- Resend account/domain already verified — available as an application send transport, not only Supabase SMTP.
- `runAsTrustedSystemOperation()` for the consumer's service-role reads/writes; the ADR-014 consent/privacy carry-over (kill switch, per-integration `enabled`) for governance.

### Alternatives Considered

- **Direct provider call inside the Forms module (even a single V1 Resend email)** — rejected by ADR-018 Decision 9: couples Forms to a channel, drags recipients/secrets into the form domain, and reintroduces the failure-coupling the spec forbids.
- **Synchronous send inside the submission request** — rejected: ties submission latency and success to an external provider's availability; a Resend outage would fail or slow a valid submission. The outbox + async consumer decouples them.
- **Reuse the client-side Integration Registry render path** — rejected: it injects browser scripts; notification delivery is a server-side, post-submission concern. Wrong layer.
- **A bespoke notifications table + ad-hoc mailer, outside the Integration layer** — rejected: it would be a second integration mechanism. Tom's directive is that channels and external tools consume form events **through the Integration layer**; this ADR honors that by extending ADR-014 rather than sidestepping it.
- **Push events straight to a third-party bus (e.g. a queue service) now** — deferred: an in-database outbox + polling consumer is sufficient at current volume and keeps the transactional guarantee simple; a real broker can replace the polling loop later without changing the emit side.

### Decision

**1. Emit durably (outbox), deliver asynchronously.** The transactional boundary in ADR-018 is *persist submission + insert `form_events` row* in one commit. This ADR's consumer reads unprocessed `form_events` and delivers them — never the request handler. `form_events` gains delivery bookkeeping:

```
form_events  (append-only; owned by ADR-018, delivery columns added here)
├── event_id        uuid pk
├── event_type      text     (e.g. 'form.submitted')
├── tenant_id / project_id / form_id / form_version / submission_id
├── topic           text     (abstract routing tag from the definition)
├── locale          text
├── payload         jsonb    (provider-agnostic; no recipients/secrets)
├── status          text     check in (pending, delivering, delivered, failed, dead)
├── attempts        int      default 0
├── last_error      text
├── occurred_at / processed_at
```

**2. A server-side consumer worker.** A scheduled runtime (Vercel Cron route or Supabase Edge Function / `pg_cron` — Open Decision) picks `pending`/retry-eligible rows, marks `delivering`, resolves config (Decision 3), dispatches via the channel provider (Decision 4), and marks `delivered` or `failed` with `attempts++` and `last_error`. Retries use capped exponential backoff; after N attempts a row goes `dead` (dead-letter, visible in the dashboard). **Idempotency:** `event_id` is the idempotency key end-to-end — a redelivered event never double-sends (the provider call is keyed on it, and `delivered` rows are skipped). Consumer failure is fully isolated from the submission, which is already committed.

**3. Recipients and channels are Integration-layer config, keyed on `topic` + project.** A new **notifications integration** is registered in `INTEGRATION_REGISTRY` (extending ADR-014 with a server-side *consumer* contract alongside the existing *render* contract). Its per-project config (authored in the Studio Integrations pane, the ADR-014 one-configuration-surface) maps `topic → { channel, recipients }` — e.g. topic `appointment-request` on project `livener` → email `studio@…`. Forms never sees this config; the consumer resolves it at delivery time. This is the single place recipients/addresses/channel choices live.

**4. Channel abstraction; Resend is the first channel.** Delivery goes through a `ChannelProvider` interface (`send(event, resolvedConfig, renderedContent)`), with **email via Resend** as the first implementation. WhatsApp, CRM, and webhook are future providers behind the same interface — added without touching Forms or the emit side. Message content is rendered from the event + a localized template (using the event `locale`); V1 email content is the basic submission summary + (once the dashboard host exists) a link to the submission. No provider is hard-coded anywhere except its own provider module, selected by config.

**5. Governance carries over from ADR-013/014.** The consumer respects the per-integration `enabled` flag and the project kill switch (ADR-014 carry-over) — a disabled notifications integration means events accumulate `pending`/skipped, never delivered, with no error. No secrets ever appear in `form_events` or the event payload (ADR-018 Decision 9); provider credentials (Resend API key, etc.) live in environment/secret config read only by the provider module, never in Sanity or the outbox.

**6. Security.** The consumer runs under `runAsTrustedSystemOperation('form notification delivery', …)` (service-role, grep-auditable). `form_events` RLS: dashboard read of delivery status is project-scoped (`project_id in get_my_project_ids()`); inserts/updates are service-role (emit side + consumer). Recipient config is admin-vetted through the Integrations pane, consistent with ADR-013's custom-script security posture.

### Implementation Order

Each slice honors the `dev` → **STOP** → `preview` → **STOP** → `main` gates.

1. **Outbox delivery columns + consumer skeleton.** Extend `form_events` (Decision 1), build the polling consumer with idempotency, backoff, and dead-lettering — no live channel yet (log-only sink) so the loop is proven in isolation.
2. **Resend email channel.** `ChannelProvider` interface + Resend implementation + localized email template; wire the consumer to send. First real end-to-end `form.submitted → email`.
3. **Notifications integration manifest + config surface.** Register the notifications integration in `INTEGRATION_REGISTRY` (server-side consumer contract), generate its per-project `topic → recipients/channel` config, author it in the Studio Integrations pane.
4. **Delivery status in the dashboard.** Surface `form_events.status`/dead-letter alongside submissions (project-scoped RLS), so an operator can see and re-drive failed deliveries.

### Open Decisions (`Tom decides`)

- **Consumer runtime** — Vercel Cron route vs Supabase Edge Function / `pg_cron`. Trade-offs: Vercel Cron keeps everything in the Next.js app and env; Supabase-side keeps it closer to the data and independent of app deploys. Slice 1.
- **Emit granularity** — V1 emits on `form.submitted` (finalized submissions only). Whether partial-submission or step events are ever emitted is deferred (they are V2 analytics territory, Concept Spec §26).
- **`form_events` retention** — archival/pruning policy for delivered events (keep for audit vs prune after N days). Slice 1.
- **Template authoring** — V1 email templates are code-owned/localized; whether subject/body become admin-editable per project is a later enhancement, not V1.
- **Consumer contract shape in the manifest** — the exact `IntegrationManifest` extension for a server-side consumer (a `consumerContract` sibling to `renderContract`); designed at slice 3 to stay faithful to ADR-014's manifest-derived model.

### Consequences

**Positive:**
- Notifications are genuinely V1 (Concept Spec §14) yet fully decoupled — Forms stays provider-agnostic, and a provider outage never touches a submission.
- Establishes the **reusable server-side event-consumer pattern** the platform will need anyway for CRM, webhooks, and marketing automation (Concept Spec §15/§27) — those become new `ChannelProvider`s / consumers on the same outbox, not new bespoke systems.
- Recipients and channel config live in one governed place (the Integration layer), consistent with ADR-014's one-configuration-surface principle and ADR-013's security posture.
- The outbox gives durable, retryable, idempotent, auditable delivery with dead-lettering — no silently dropped notifications.

**Negative:**
- Introduces an operational moving part (a scheduled consumer) that must be monitored — a stuck consumer means undelivered (but never lost) notifications.
- Extends ADR-014's manifest model to a second contract type (server-side consumer), which must be designed carefully to avoid two divergent integration mechanisms.
- V1 notification delivery now spans two ADRs (018 emit, 019 deliver) that must ship in the same window for §14 to be satisfied; the mitigation is ADR-018's dashboard inbox, which guarantees no submission is lost if this ADR slips.
- Adds a channel provider's credentials/secret surface (Resend API key as an application send credential, distinct from the existing Supabase SMTP config) to manage.

---

**Decision ownership note (spine §4):** acceptance of this ADR is `Tom approves`. The `form_events` delivery-column migration and the consumer-runtime choice are `Tom decides` at execution time; no scheduled worker or migration is enabled without explicit sign-off at the moment it is run.


---

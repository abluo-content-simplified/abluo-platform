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

**Status:** Accepted
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



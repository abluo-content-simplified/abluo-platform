# ADR-011 — Implementation Roadmap

**Status:** Frozen — Revision 2  
**Date:** 2026-06-26  
**Revised:** 2026-06-26 (Revision 2 — see Roadmap Governance)  
**Author:** Technical Architect  
**Implements:** ADR-011 — Module Management Architecture (Revision 1, Accepted)  
**Baseline:** V0.9.17 (ADR-010 complete — module-driven Studio navigation)

> This document is the authoritative implementation plan for ADR-011.
> It is prescriptive about order and scope, not about code details.
> Every phase must leave the platform in a deployable state.
> Do not implement multiple phases in a single session unless they are explicitly grouped.
> This roadmap is frozen. See *Roadmap Governance* for how changes are introduced.

---

## Baseline — What Exists Today

Before the first phase begins, the platform sits here against each ADR-011 layer:

| Layer | Today's state | ADR-011 target |
|---|---|---|
| **Module Definition** | TypeScript modules scattered in `src/` — blog, events, live, sections | Owned by each module in its own vertical slice |
| **Module Manifest** | `ModuleDef` inside `sanity.config.ts` — 4 fields only (`id`, `label`, `pageType`, `collectionItems`) | Full `ModuleManifest` with all declared capabilities, contracts, stores, deps |
| **Module Registry** | `MODULE_REGISTRY` const inside `sanity.config.ts` — inaccessible outside that file | Platform-level, framework-agnostic, consumed by all surfaces |
| **Module Installation** | `enabledModules: string[]` on project document — hidden, patched via MCP | First-class Installation record with version, config, enabled state, provenance |
| **Module Runtime** | Hand-maintained: `SectionRenderer` switch, schema array, Studio structure builder | Derived projections of the registered manifests |

**Key constraints:**
- Git baseline is V0.9.17.
- Phase 0 produces a documentation commit at V0.9.18. All subsequent phases increment from V0.9.19.
- V1.0.0 marks the completion of Milestone D — the full architectural transformation.
- Milestone E (Update Management) and later work are V1.0.1+.

---

## Milestones Overview

| Milestone | Name | Phases | What it delivers |
|---|---|---|---|
| **0** | Architecture Audit | Phase 0 | Current-state inventory document; no code changes |
| **A** | Foundation | A1 – A3 | Registry at the right location; full Manifest type; build-time safety |
| **B** | Installation | B1 – B2 | Module Installation is a typed, versioned, first-class record |
| **C** | Project Settings | C1, C2 | Settings shell (C1 early); management UI + platform service (C2 after D) |
| **D** | Derivation | D1 – D4 | Platform structures are projections of manifests; no hand-wiring |
| **E** | Update Management | E1 – E2 | Version tracking and administrator-controlled update workflow |

> **Note on C2:** The Project Settings shell (C1) is built early so the destination exists before derivation begins. The management UI and platform service (C2) are built after Milestone D stabilises the architecture it will consume. C2 remains labelled as part of Milestone C because it is conceptually the Project Settings feature — its position in the implementation sequence is what changes.

---

## Phase Specifications

---

### PHASE 0 — Architecture Audit

**Version:** V0.9.18 (documentation commit — no code changes)  
**Goal:** Produce a complete, verified inventory of the current coupling surface before any refactoring begins. Every later phase relies on this document to know exactly what it is changing and what it must leave intact.

**Scope:**

Produce `docs/adr-011-current-state.md` containing the following inventories. No code is changed in this phase. The document is the deliverable.

**1. MODULE_REGISTRY consumers**
List every file that reads `MODULE_REGISTRY`, the purpose of each read, and what it produces. At minimum: `sanity.config.ts` (structure builder — pages, collections, module-enabled check). Check for any other import or re-export.

**2. `enabledModules` consumers**
List every file that reads or writes `enabledModules`, with the GROQ query or field accessor used, and what the consumer does with the value. At minimum: `sanity.config.ts` (structure query), `schema.ts` (field definition), `ProjectLinker.tsx` (display). Check `queries.ts` and all dashboard and API routes.

**3. SectionRenderer inventories**
For both `src/app/[locale]/(website)/[tenant]/page.tsx` and `src/app/[locale]/(website)/[tenant]/[slug]/page.tsx`: list every `case` in SectionRenderer with its `_type` value and the component it maps to. Flag any cases that appear in one file but not the other.

**4. Module-owned schema types**
For each of the three current modules (blog, events, live): list every Sanity document type and object type that belongs to that module. Identify any types whose ownership is ambiguous (could belong to platform or to a module).

**5. Module-owned collections**
For each module: list every collection it contributes to Studio navigation — the collection ID, label, `schemaType`, GROQ filter, and ordering. These become the inputs to `ModuleCollectionDef` in Phase D3.

**6. Module-implied permissions**
For each module: list every action a user can perform that is implicitly scoped to that module's data (e.g. "publish a blog post"). These become the `ModulePermissionDef` entries declared in Phase A2 and consumed in Phase D4. Cross-reference with `src/lib/permissions.ts`.

**7. Hidden coupling**
Identify any code that:
- references a module's document types outside that module's own files (e.g. a query in `queries.ts` that filters on `_type == "post"` without going through any module abstraction)
- embeds module-specific logic in platform-level files
- uses `enabledModules` in unexpected places
- duplicates module-related behavior between routes or surfaces

**Format:** Each inventory is a flat, factual table or list. No recommendations. No redesign. Only "what is here now."

**Files expected to change:**
- `docs/adr-011-current-state.md` — new file (the only output)

**Risks:**
- _Completeness:_ The audit is only as good as the search. Use `grep -rn` across all `src/` and config files, not just files you expect to be relevant. Hidden coupling is hidden by definition.
- _Scope creep:_ This phase produces a document, not a fix. If you discover a problem during the audit, record it in the document and move on. Do not fix anything in Phase 0.

**Testing:**
- No automated tests for this phase.
- Review: after the document is written, verify each inventory by re-running the relevant searches and confirming the document matches.

**Acceptance criteria:**
- `docs/adr-011-current-state.md` exists and contains all seven inventories.
- Each inventory was verified by a targeted search of the codebase.
- The document contains no recommendations and no code changes.
- Committed to `dev` as a documentation commit.

**Rollback strategy:**
- There is no code to revert.
- Rollback = delete `docs/adr-011-current-state.md` from git.
- `git revert` of the documentation commit is sufficient.
- No schema, no content migration, no feature flags.
- No verification needed after rollback beyond confirming the file is gone.

**Dependencies:** None. Phase 0 can begin immediately from V0.9.17.

---

### MILESTONE A — Foundation

**What it delivers:** The MODULE_REGISTRY is relocated to a platform-level location, expanded into a full `ModuleManifest` type, and protected by build-time validation. No user-visible behavior changes in any of these phases.

> **Input from Phase 0:** Before starting A1, confirm the `MODULE_REGISTRY` consumer inventory is complete and that no consumers outside `sanity.config.ts` were found. If hidden consumers were found, address them in A1 scope.

---

#### Phase A1 — Registry Relocation

**Version:** V0.9.19  
**Goal:** Move `MODULE_REGISTRY` out of `sanity.config.ts` into a dedicated, platform-level module layer accessible to all surfaces.

**Scope:**
- Create `src/lib/modules/` directory as the home for all module infrastructure.
- Create `src/lib/modules/registry.ts` exporting `MODULE_REGISTRY` and the `ModuleDef` type (identical shape to today).
- Update `sanity.config.ts` to import `MODULE_REGISTRY` from the new location.
- No other changes. Behavior is identical.

**Files expected to change:**
- `src/lib/modules/registry.ts` — new file
- `src/lib/modules/index.ts` — barrel export
- `sanity.config.ts` — remove inline definition, add import

**Risks:**
- _Regression:_ Studio structure builder imports fail if the import path is wrong. TypeScript will catch this before deploy.
- _Migration:_ None — no content, no schema changes.
- _Architectural:_ None. This is a pure relocation.

**Testing:**
- `npx tsc --noEmit` — must be clean.
- `npx vitest run` — all tests pass.
- `npm run build` — must succeed.
- Manual (Studio): open Studio, navigate all three enabled modules for at least one project. Verify Pages and Collections sections render correctly.
- Manual (Studio): create a new project, toggle enabled modules, verify navigation updates.

**Acceptance criteria:**
- `MODULE_REGISTRY` is defined only in `src/lib/modules/registry.ts`.
- `sanity.config.ts` contains no inline module definitions.
- Studio navigation is identical to V0.9.17.
- TypeScript clean; all tests pass; build succeeds.

**Rollback strategy:**
- `git revert` of the A1 commit is sufficient.
- Move the `MODULE_REGISTRY` definition back inline into `sanity.config.ts`; remove `src/lib/modules/`.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: run `npx tsc --noEmit` and `npm run build`; open Studio and verify navigation.

**Dependencies:** Phase 0 must be complete. (The audit confirms the consumer inventory is accurate before the relocation.)

---

#### Phase A2 — Full ModuleManifest Type

**Version:** V0.9.20  
**Goal:** Expand `ModuleDef` into a complete `ModuleManifest` that declares all the capabilities ADR-011 names — without wiring any of them yet.

**Scope:**
- Define `ModuleManifest` type in `src/lib/modules/types.ts`. Required fields:
  - `id: string` — machine identifier
  - `label: string` — canonical admin label
  - `version: string` — semver
  - `status: 'released' | 'deprecated' | 'archived'`
  - `category?: ModuleCategory` — non-functional; reserved
  - `platformContract.pageType?: string` — singleton page document type
  - `platformContract.collectionItems` — Studio collection builder (retained from today)
  - `platformContract.sectionTypes: string[]` — section `_type` values this module contributes to SectionRenderer
  - `platformContract.schemaTypes: string[]` — document type names this module owns
  - `platformContract.permissions: ModulePermissionDef[]` — permission definitions (inputs from Phase 0 inventory §6)
  - `publicContract: {}` — stub, empty for now
  - `dependencies.requires: ModuleDependency[]` — hard dependencies
  - `dependencies.integratesWith: string[]` — optional integrations (module IDs)
  - `dataStore.primary: 'content' | 'operational' | 'hybrid'`
  - `changelog: string` — link or inline notes
- Migrate all three existing module entries (blog, events, live) to the new shape. Use the schema type and section type inventories from Phase 0 (§3 and §4) as the authoritative input for `sectionTypes` and `schemaTypes`.
- `ModuleDef` type alias retained for backward-compatibility during transition; deprecated with a JSDoc comment.
- No derivation wired yet — all new fields are declared but not consumed by the platform.
- Add inline JSDoc to `sectionTypes` and `schemaTypes`: "Declared here; consumed by derivation machinery in Phases D1 and D2."

**Files expected to change:**
- `src/lib/modules/types.ts` — new file with `ModuleManifest`, `ModuleCategory`, `ModulePermissionDef`, `ModuleDependency`
- `src/lib/modules/registry.ts` — migrate three module entries to full `ModuleManifest` shape
- `src/lib/modules/index.ts` — export new types

**Risks:**
- _Regression:_ The `collectionItems` field signature must stay identical — `sanity.config.ts` consumes it directly. Any shape change to this field breaks Studio structure.
- _Migration:_ None — no content or schema changes.
- _Architectural:_ The `sectionTypes` and `schemaTypes` arrays are declared but not yet consumed. Document this clearly with JSDoc so a future implementer does not assume they are already being used.

**Testing:**
- `npx tsc --noEmit` — TypeScript must be satisfied with all three module entries against `ModuleManifest`.
- `npx vitest run` — all tests pass.
- `npm run build` — must succeed.
- Manual (Studio): verify Studio navigation is still identical to V0.9.19.
- Cross-check: the `sectionTypes` populated in each manifest entry must match the SectionRenderer inventory from Phase 0 (§3) exactly.

**Acceptance criteria:**
- `ModuleManifest` type is complete and documented.
- All three modules declared against it with no TypeScript errors.
- `sectionTypes` and `schemaTypes` are populated from the Phase 0 inventory — no guessing.
- No behavior change.

**Rollback strategy:**
- `git revert` of the A2 commit is sufficient.
- Restores `ModuleDef` as the only type; removes `src/lib/modules/types.ts`.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: `npx tsc --noEmit` and `npm run build`; verify Studio navigation unchanged.

**Dependencies:** A1 must be complete. Phase 0 inventory (§3 and §4) is required input.

---

#### Phase A3 — Build-time Manifest Validation

**Version:** V0.9.21  
**Goal:** Protect the registry with validation that runs at build time. A malformed manifest fails the build, not production.

**Scope:**
- Create `src/lib/modules/validate.ts` with `validateRegistry(manifests: ModuleManifest[]): void`.
- Validation rules:
  1. All `id` values are unique.
  2. All `id` values are lowercase kebab-case (no spaces, no uppercase).
  3. `version` is a valid semver string.
  4. `status` is one of the declared enum values.
  5. `platformContract.pageType`, if set, is a non-empty string.
  6. `platformContract.sectionTypes` contains no duplicates across the registry (a section type can only be owned by one module).
  7. `platformContract.schemaTypes` contains no duplicates across the registry.
  8. `dependencies.requires` references IDs that are present in the registry.
  9. `dataStore.primary` is one of the valid values.
- Call `validateRegistry(MODULE_REGISTRY)` at module load time in `registry.ts` (throws on failure).
- Add vitest tests for every validation rule: at least one passing case and one failing case per rule.
- The `npm run build` will fail if `registry.ts` throws on import.

**Files expected to change:**
- `src/lib/modules/validate.ts` — new file
- `src/lib/modules/registry.ts` — call `validateRegistry` on export
- `src/lib/modules/__tests__/validate.test.ts` — new test file

**Risks:**
- _Regression:_ If `validateRegistry` throws on a valid existing module, the build fails immediately. Run tests before pushing to `dev`.
- _Migration:_ None.
- _Architectural:_ The validator is conservative at launch — only the rules above. Do not add rules that cannot be checked statically (e.g., "the schemaType must exist in Sanity" is a runtime check, not a build-time check). Keep the boundary clean. Rule 8 (dependency resolution) will only become meaningful when modules actually declare dependencies; validate it anyway so the infrastructure is ready.

**Testing:**
- `npx vitest run` — all existing tests + new validation tests must pass.
- `npx tsc --noEmit` — clean.
- `npm run build` — must succeed with the valid registry.
- Manual: temporarily corrupt one manifest entry (duplicate ID); verify `npm run build` fails with a clear error message; revert.

**Acceptance criteria:**
- Validation covers all nine rules above.
- Test file has ≥ 18 test cases (two per rule minimum).
- Build fails with a human-readable error on any invalid manifest.
- Build passes cleanly with the current valid registry.

**Rollback strategy:**
- `git revert` of the A3 commit is sufficient.
- Removes `validate.ts` and the `validateRegistry()` call from `registry.ts`.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: run `npm run build` to confirm it still succeeds without validation. The build is weaker (malformed manifests no longer caught) but the platform functions identically.

**Dependencies:** A2 must be complete.

---

### MILESTONE B — Installation

**What it delivers:** Module Installation graduates from a flat `string[]` to a typed record that carries version, configuration, enabled state, and provenance. The platform can now reason about per-project module state, not just presence/absence.

> **Input from Phase 0:** Before starting B1, review the `enabledModules` consumer inventory (§2). Every consumer identified there must be updated in B1.

---

#### Phase B1 — Installation Type & Schema Migration

**Version:** V0.9.22  
**Goal:** Upgrade the Installation layer from `enabledModules: string[]` to `moduleInstallations: ModuleInstallation[]`.

**Scope:**
- Define `ModuleInstallation` type in `src/lib/modules/types.ts`:
  ```
  {
    moduleId: string          // references ModuleManifest.id
    version: string           // version the project's content conforms to
    enabled: boolean          // installation enabled flag
    installedAt: string       // ISO 8601 datetime
    config: Record<string, unknown>  // configuration values (empty object initially)
    provenance: 'admin' | 'auto'     // how the installation was created
  }
  ```
- **Before changing the schema:** query Sanity to inspect every project document with `enabledModules` data. Document what is found. If projects have data, the migration must handle it; if not, proceed safely.
- Update `project` schema in `schema.ts`:
  - Add `moduleInstallations` field: `array` of `object` with the above shape.
  - Keep `enabledModules` field present but fully hidden — it is a data-migration bridge, not removed.
- Update `sanity.config.ts` structure builder to read `moduleInstallations`, with a `coalesce` fallback to `enabledModules` during the transition window.
- Update every GROQ query identified in Phase 0 (§2) to read `moduleInstallations` with a `coalesce` fallback to `enabledModules`.
- Write a one-time Sanity migration script (`src/lib/sanity/migrations/002-module-installations.ts`) that converts existing `enabledModules: string[]` entries to `moduleInstallations: ModuleInstallation[]` with `version` set to the current manifest version, `enabled: true`, `installedAt` set to migration run date, and `provenance: 'auto'`.

**Files expected to change:**
- `src/lib/modules/types.ts` — add `ModuleInstallation`
- `src/lib/sanity/schema.ts` — add `moduleInstallations` field to `project` type
- `src/lib/sanity/queries.ts` — update `enabledModules` GROQ projections
- `sanity.config.ts` — structure builder reads `moduleInstallations` with fallback
- `src/lib/sanity/migrations/002-module-installations.ts` — new migration script
- `src/lib/sanity/fields/ProjectLinker.tsx` — update display to read `moduleInstallations`

**Risks:**
- _Regression:_ Studio navigation depends on reading which modules are enabled. The fallback to `enabledModules` is critical until all project documents are migrated. Test with a project that has not yet been migrated.
- _Migration risk:_ If `enabledModules` contains values not in `MODULE_REGISTRY`, the migration must handle them gracefully (skip with a log entry). The Phase 0 audit (§2) should have surfaced any such anomalies.
- _Architectural:_ `ModuleInstallation.config` is `Record<string, unknown>` initially because no module declares a config schema yet. Do not attempt to type-narrow it until manifest-declared config schemas are wired.

**Testing:**
- Query Sanity before migration: `*[_type == "project" && defined(enabledModules)]{_id, projectSlug, enabledModules}`. Record results.
- Run migration script in a dev dataset first; verify output before running on production.
- `npx tsc --noEmit` — clean.
- `npx vitest run` — all tests pass.
- `npm run build` — succeeds.
- Manual (Studio): open a migrated project; verify Pages and Collections show the same modules as before.
- Manual (Studio): if any project is unmigrated, verify the fallback to `enabledModules` works correctly.
- Manual (Studio): verify `ProjectLinker` Modules display reads from `moduleInstallations`.

**Acceptance criteria:**
- `moduleInstallations` field exists on the project document schema.
- All existing project documents have been migrated, or the fallback covers unmigrated ones.
- Studio navigation is functionally identical to V0.9.21.
- `enabledModules` field is still present in schema (as a migration bridge) but hidden.

**Rollback strategy:**
- Schema rollback: remove the `moduleInstallations` field from `schema.ts`; restore `enabledModules` as the sole hidden field; restore all GROQ queries to read `enabledModules` directly.
- `git revert` handles the code rollback.
- Content rollback: the migration script writes `moduleInstallations` data to Sanity documents. Reverting the code does not remove that data — but because `enabledModules` is still present in the documents, the reverted code falls back to it correctly. The `moduleInstallations` data becomes orphaned but harmless.
- If `moduleInstallations` data must be removed (e.g. because it was written incorrectly), run a reverse patch: `*[_type == "project" && defined(moduleInstallations)]` → unset `moduleInstallations`.
- No feature flags.
- After rollback: verify Studio navigation in both the previously-migrated and unmigrated project states. Confirm the `enabledModules` fallback is the only active path.

**Dependencies:** A1, A2 must be complete. A3 is recommended. Phase 0 (§2 consumer inventory) is required input.

---

#### Phase B2 — Installation Persistence Decision

**Version:** V0.9.23  
**Goal:** Document and commit the persistence model decision for `ModuleInstallation` before Phase C1 builds a UI on top of it.

**Scope:**
This phase is a deliberate architectural pause — not an implementation sprint. Its output is a decision record, not code.

The decision: should `ModuleInstallation` remain as an array field on the project document (simple, co-located, consistent with today) or become a first-class Sanity document type (`moduleInstallation`) related to the project (scales better, matches the Project Settings domain model ADR-011 describes)?

**Decision framework to apply:**
- How many installations per project will realistically exist? (Today: ≤ 3. Near future: possibly 10–20.)
- Does billing or entitlement data need to attach to an Installation? If yes → first-class entity.
- Does the Administration UI need to list, filter, or paginate across installations from multiple projects simultaneously? If yes → first-class entity.
- Does the client CMS dashboard need to show installation state without fetching the entire project document? If yes → first-class entity.
- Is the current array-on-project model causing any schema size or query complexity problems? If no → array field is viable for now.

**Output of this phase:**
- A short decision note appended to `docs/architecture-decisions.md` as a sub-decision under ADR-011.
- The note must state the chosen model and the reasoning.
- If the decision is "keep array on project document for now, revisit at Milestone E" — commit that decision and proceed.
- If the decision is "create first-class entity" — implement that before Phase C1 begins (treat it as B2a).

**Files expected to change:**
- `docs/architecture-decisions.md` — add sub-decision note

**Risks:**
- _Architectural:_ Choosing the array-on-project model and later needing to migrate to a first-class entity is non-trivial because Phase C2 builds a UI over it. Invest the decision time now.

**Testing:** None — this is a documentation phase. The decision note is the deliverable.

**Acceptance criteria:**
- Decision is recorded in `docs/architecture-decisions.md`.
- Persistence model is chosen and justified.
- If first-class entity is chosen: migration from B1 array is complete and verified before C1 begins.

**Rollback strategy:**
- `git revert` removes the decision note from the ADR log.
- No schema, no content migration, no feature flags.
- No verification needed beyond confirming the document is restored to its previous state.
- Note: reverting the decision note does not undo any implementation consequences. If the first-class entity path was chosen and implemented as B2a, that implementation has its own rollback.

**Dependencies:** B1 must be complete.

---

### MILESTONE C1 — Project Settings Shell

> **Note:** Milestone C is split across the implementation sequence. C1 (the shell) is built early, before Milestone D, so the destination area exists as derivation phases begin. C2 (the management UI and platform service) is built after Milestone D stabilises the architecture it consumes.

**Version:** V0.9.24  
**Goal:** Create the Project Settings destination in the Studio administration structure — a dedicated area, separate from the Project document form itself, with a Modules section and named stubs for future sections.

**Scope:**
- Extend the Studio structure builder in `sanity.config.ts` with a dedicated **Project Settings** pane per project.
- The pane has named sections, implemented only where noted:
  - **Modules** — read-only list of registered modules, indicating which are installed for this project (no install/uninstall controls yet — those arrive in C2)
  - **Locales** — stub (label only, click navigates to `siteConfig` for now)
  - **Domains** — stub (label only)
  - Others named but not clickable yet: Analytics, Billing, Integrations
- The Modules section reads from `moduleInstallations` (B1 persistence model).
- This section provides visibility into installation state; mutations are not yet supported.

**Files expected to change:**
- `sanity.config.ts` — extend structure builder with Project Settings pane
- `src/lib/sanity/studio/ModuleList.tsx` — new custom Studio component for read-only list

**Risks:**
- _Regression:_ Adding a new structure pane must not disturb existing Pages or Collections navigation. Test all existing navigation sections after adding the pane.
- _Migration:_ None.
- _Architectural:_ Do not implement Domains, Billing, or Analytics in this phase. Name the stubs so future phases know where to wire. The Locales stub navigates to the existing `siteConfig` configuration — no new structure needed.

**Testing:**
- Manual (Studio): navigate to Project Settings for each existing project; verify Modules list shows the correct installed state.
- Manual (Studio): verify all other Studio sections (Pages, Collections, Design System) are unaffected.
- `npm run build` — succeeds.

**Acceptance criteria:**
- Project Settings pane is visible in Studio per-project navigation.
- Modules section lists all registered modules with their installed/not-installed status per project.
- Locales stub is present and navigates to siteConfig.
- No regression in existing navigation.

**Rollback strategy:**
- `git revert` of the C1 commit is sufficient.
- Removes the Project Settings pane and `ModuleList.tsx` from the structure builder.
- No schema rollback needed (C1 adds no schema changes).
- No content migration rollback needed.
- No feature flags.
- After rollback: navigate Studio for all projects and confirm the Project Settings pane is gone and all other navigation sections are intact.

**Dependencies:** B1 and B2 must be complete.

---

### MILESTONE D — Derivation

**What it delivers:** The hand-maintained `SectionRenderer` switch, schema type array, and permission set are replaced by derived projections of the registered manifests. Adding a new module requires a manifest entry; the platform wires the rest automatically. V1.0.0 is tagged at the completion of this milestone.

> **Warning:** Milestone D is the most complex and highest-risk milestone. Each phase must be implemented with particular care and tested in isolation. The phases within D may be executed in parallel by different sessions once A2 and A3 are complete, but each must be deployed and verified independently before D is declared complete.

> **Input from Phase 0:** The schema inventory (§4), section inventory (§3), collection inventory (§5), and permission inventory (§6) are the authoritative inputs for D1, D2, D3, and D4 respectively. Do not proceed without them.

---

#### Phase D1 — Schema Derivation

**Version:** V0.9.25  
**Goal:** Module manifests become the source of truth for which Sanity document types belong to each module. The platform composes the schema array from manifests.

**Scope:**
- Each module that declares `platformContract.schemaTypes` is expected to have its schema definitions in a module-owned file (e.g. `src/lib/modules/blog/schema.ts`).
- Create `src/lib/modules/schema.ts` with `buildSchema(): SchemaTypeDefinition[]` that iterates `MODULE_REGISTRY`, imports each module's declared schema types, and composes them into the platform schema array alongside the platform-owned types (designSystem, siteConfig, client, project, page, etc.).
- Update `schema.ts` to call `buildSchema()` for module-owned types rather than listing them by hand.
- **This phase does not remove any existing schema definitions** — it moves them to module-owned files and wires them through `buildSchema()`. The schema output must be functionally identical to today's.
- Module-owned schema files: `src/lib/modules/blog/schema.ts`, `src/lib/modules/events/schema.ts`, `src/lib/modules/live/schema.ts`. Use the Phase 0 inventory (§4) as the authoritative list of what moves into each file.
- Establish the convention for how `buildSchema()` links to module schemas: manifests carry a direct import reference (a function returning schema types) — not a path-based lookup.

**Files expected to change:**
- `src/lib/modules/blog/schema.ts` — new file (extracted from `schema.ts`)
- `src/lib/modules/events/schema.ts` — new file (extracted from `schema.ts`)
- `src/lib/modules/live/schema.ts` — new file (extracted from `schema.ts`)
- `src/lib/modules/schema.ts` — new file with `buildSchema()`
- `src/lib/sanity/schema.ts` — remove module-owned type definitions; import and call `buildSchema()`
- `src/lib/modules/registry.ts` — manifest entries gain schema import references

**Risks:**
- _Regression:_ Any mismatched Sanity schema type name or field will break Studio validation on existing documents. The output of `buildSchema()` must produce an identical set of type definitions to today's hand-maintained array. Verify by comparing type names, field names, and validation rules before and after.
- _Migration:_ No content migration. Schema definitions are code only.
- _Architectural:_ Platform-owned types (designSystem, siteConfig, client, project, page, etc.) remain in `schema.ts` directly — only module-owned types move. The split must be clear and match the Phase 0 inventory (§4) exactly.

**Testing:**
- `npx tsc --noEmit` — clean.
- `npx vitest run` — all tests pass.
- `npm run build` — succeeds.
- Manual (Studio): open Studio; verify all document types are still present and editable. Create a new blog post; verify schema validation works identically to V0.9.24.
- Manual (Studio): open the events document type; verify all fields and validation are intact.
- If the Sanity MCP is available: dump the schema before and after and diff the type names and field counts.

**Acceptance criteria:**
- Module-owned schema types live in `src/lib/modules/{id}/schema.ts`.
- Platform `schema.ts` contains only platform-owned types.
- `buildSchema()` composes the full schema set from manifests.
- Studio type behavior is identical to V0.9.24.

**Rollback strategy:**
- `git revert` of the D1 commit is sufficient.
- Removes `src/lib/modules/{id}/schema.ts` files and `src/lib/modules/schema.ts`; restores the hand-maintained type array in `src/lib/sanity/schema.ts`.
- No schema rollback needed (no Sanity schema content changed — only the TypeScript that produces it).
- No content migration rollback needed.
- No feature flags — but consider keeping a commented-out hand-maintained list in `schema.ts` as a recovery reference during the transition period, removed once D1 is stable on production.
- After rollback: `npx tsc --noEmit`, `npm run build`, then open Studio and verify all document types are present and editable. Compare the type list against the Phase 0 inventory (§4).

**Dependencies:** A2 (Manifest type) and A3 (validation) must be complete.

---

#### Phase D2 — Section Map Derivation

**Version:** V0.9.26  
**Goal:** Replace the hand-maintained `SectionRenderer` switch statements with a derived map built from module manifests.

**Scope:**
- Add a section component reference to the manifest: `platformContract.sectionComponents: Record<string, React.ComponentType<SectionProps>>`. This is a map from `_type` string to the React component that renders it.
- Create `src/lib/modules/sections.ts` with `buildSectionMap(): SectionComponentMap`. Iterates `MODULE_REGISTRY`, merges all `sectionComponents` maps into one authoritative map. Memoize the result — compute once at module initialization, not per request.
- Update `SectionRenderer` in both `src/app/[locale]/(website)/[tenant]/page.tsx` and `src/app/[locale]/(website)/[tenant]/[slug]/page.tsx` to consume `buildSectionMap()` instead of the hand-maintained `case` list.
- **Platform-owned section types** (heroSection, contentSection, textSection, statementSection, faqSection, contactSection, etc.) must also be registered through the section map, either via a `core` platform manifest or a platform-owned registration in `sections.ts`. The goal is that neither SectionRenderer file contains a `case` statement for any section type.
- Use the Phase 0 inventory (§3) as the authoritative list of all section types and their routes, including any that appear in one route but not the other. Both routes must be fully covered by this phase.

**Files expected to change:**
- `src/lib/modules/sections.ts` — new file with `buildSectionMap()`
- `src/lib/modules/blog/sections.ts` — blog's section component map (blogListingSection)
- `src/lib/modules/events/sections.ts` — events section map (if any)
- `src/lib/modules/live/sections.ts` — live section map (heroLiveCaptureSection, heroLensSection)
- `src/lib/modules/registry.ts` — manifest entries reference their section maps
- `src/app/[locale]/(website)/[tenant]/page.tsx` — SectionRenderer uses `buildSectionMap()`
- `src/app/[locale]/(website)/[tenant]/[slug]/page.tsx` — same

**Risks:**
- _Regression:_ Any section type not in the derived map silently renders nothing — no error, just a missing section. Manual testing must cover every section type from the Phase 0 inventory (§3) for every tenant and both routes.
- _Route parity risk:_ The Phase 0 inventory (§3) may have identified section types that exist in one SectionRenderer but not the other. D2 resolves this definitively — both renderers are identical after this phase.
- _Performance:_ `buildSectionMap()` must be memoized. Call it at module initialization and cache the result. Never call it inside the render function.

**Testing:**
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.
- Manual: using the Phase 0 section inventory (§3) as a checklist, render a page containing each section type for each tenant and verify it renders correctly.
- Manual: render the same sections via the slug route (`[tenant]/[slug]/page.tsx`) and verify identical behavior.
- Manual: add a test section to a Sanity page document with a `_type` that is not registered in the section map; verify the renderer handles the unknown type gracefully — renders nothing, no crash.

**Acceptance criteria:**
- Neither `SectionRenderer` function contains a hand-maintained `case` list for any section type.
- All section types from the Phase 0 inventory (§3) render correctly for all tenants.
- Both page routes are covered.
- Unknown section types are handled gracefully.

**Rollback strategy:**
- `git revert` of the D2 commit is sufficient.
- Removes `src/lib/modules/sections.ts` and module section files; restores hand-maintained `case` lists in both SectionRenderer functions.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: using the Phase 0 section inventory (§3) as a checklist, render every section type on both routes and verify. Pay particular attention to any sections that the Phase 0 audit flagged as appearing in only one route.

**Dependencies:** A2 (Manifest type). Recommended: D1 complete (module file conventions established). D2 can run in parallel with D1 if module directory structure is agreed first.

---

#### Phase D3 — Navigation Derivation (complete)

**Version:** V0.9.27  
**Goal:** Studio navigation is a complete, automatic projection of manifests. The `collectionItems` lambda in each manifest entry is replaced by a declarative declaration that the platform turns into Studio structure.

**Scope:**
- Today: each manifest entry carries a `collectionItems: (slug: string) => ListItem[]` function — a Studio-specific implementation detail inside the manifest.
- Target: the manifest declares its collections **declaratively**; the platform derives the `collectionItems` lambda from this declaration.
- Add `platformContract.collections: ModuleCollectionDef[]` to `ModuleManifest`. Use the Phase 0 collection inventory (§5) as the authoritative input:
  ```
  ModuleCollectionDef {
    id: string
    label: string
    schemaType: string
    filter: string       // GROQ fragment — "$slug" is a placeholder for the project slug
    ordering?: { field: string; direction: 'asc' | 'desc' }[]
    initialValueTemplate?: string
  }
  ```
- Create `src/lib/modules/navigation.ts` with `buildCollectionItems(slug: string, manifest: ModuleManifest): ListItem[]` that generates Studio structure from `collections`.
- Update `sanity.config.ts` structure builder to call `buildCollectionItems()` rather than `manifest.collectionItems(slug)`.
- Deprecate and remove the `collectionItems` lambda from `ModuleDef`/`ModuleManifest`.
- The Live module (`collectionItems: () => []`) becomes a module with an empty `collections: []` array.
- If any current `collectionItems` lambda contains logic that cannot be expressed in `ModuleCollectionDef` (identified during Phase 0 inventory §5), add an escape hatch: `platformContract.customCollectionItems?: (slug: string) => ListItem[]`. Document this as technical debt to be resolved.

**Files expected to change:**
- `src/lib/modules/types.ts` — add `ModuleCollectionDef`, extend `ModuleManifest.platformContract`
- `src/lib/modules/navigation.ts` — new file with `buildCollectionItems()`
- `src/lib/modules/registry.ts` — migrate all three module entries to declarative `collections`; remove `collectionItems` lambda
- `sanity.config.ts` — call `buildCollectionItems()` in structure builder
- `src/lib/modules/validate.ts` — add validation for `collections` (no empty IDs, valid filter format)
- `src/lib/modules/__tests__/navigation.test.ts` — new test file

**Risks:**
- _Regression:_ Studio navigation is the highest-visibility surface. Any misconfigured `ModuleCollectionDef` drops a navigation item silently. Test every collection for every module using the Phase 0 inventory (§5) as the expected-result checklist.
- _Expressiveness:_ If the Phase 0 audit (§5) found any `collectionItems` lambda with nested structure, conditional logic, or Studio-specific behavior, the declarative model may not express it. The escape hatch handles this, but it is technical debt.
- _GROQ string leakage:_ The `filter` field is a GROQ fragment string — a known limitation documented in ADR-011. Do not attempt to solve this in D3.

**Testing:**
- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds.
- Manual: navigate all module Collections in Studio for all projects; verify every collection listed in the Phase 0 inventory (§5) appears with correct items.
- Manual: install a module for a new project via the C1 Modules list; verify its Collections appear.
- Unit tests: `navigation.test.ts` with mock manifests and stub Studio builder; test each `ModuleCollectionDef` field.

**Acceptance criteria:**
- No `collectionItems` lambda in any manifest entry (or, if the escape hatch was needed, it is present only for specific documented cases).
- Studio Collections navigation matches the Phase 0 inventory (§5) exactly.
- All collection navigation is intact for all projects.

**Rollback strategy:**
- `git revert` of the D3 commit is sufficient.
- Removes `src/lib/modules/navigation.ts`; restores `collectionItems` lambdas in `registry.ts`; restores `manifest.collectionItems(slug)` calls in `sanity.config.ts`.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: navigate every module's Collections in Studio for every project and compare against the Phase 0 inventory (§5). Confirm no collections are missing.

**Dependencies:** A2. Recommended: D1 complete (module file conventions established). D3 can run in parallel with D1 and D2 if file conventions are agreed first.

---

#### Phase D4 — Permission Derivation

**Version:** V0.9.28 → tagged V1.0.0 on completion  
**Goal:** Module-declared permissions integrate into the platform permission system. Module permissions are derived from manifests, not hand-maintained in `permissions.ts`. This is the final phase of the architectural transformation; V1.0.0 is tagged when this phase is verified on production.

**Scope:**
- `ModuleManifest.platformContract.permissions` (declared in A2, populated from Phase 0 inventory §6) is now consumed.
- Each `ModulePermissionDef` declares:
  ```
  {
    id: string           // e.g. "blog.publish" — format: "{moduleId}.{action}"
    label: string
    description: string
    defaultRoles: TenantRole[]  // which roles have this permission by default
  }
  ```
- Create `src/lib/modules/permissions.ts` with `buildModulePermissions(): ModulePermissionMap` that iterates the registry and produces a unified map of all module-declared permissions.
- Update `src/lib/permissions.ts`:
  - Existing role-based functions remain unchanged — `canEditContent`, `canManageMedia`, etc. are platform-level and are not touched.
  - Add `canPerformModuleAction(role: TenantRole, permissionId: string, moduleInstallations: ModuleInstallation[]): boolean` — checks (a) module is installed and enabled, and (b) role has the declared permission.
- Populate `permissions` arrays in all three module manifest entries using the Phase 0 inventory (§6) as the authoritative input.

**Files expected to change:**
- `src/lib/modules/permissions.ts` — new file
- `src/lib/modules/types.ts` — add `ModulePermissionDef`, `ModulePermissionMap`
- `src/lib/permissions.ts` — add `canPerformModuleAction()`
- `src/lib/modules/registry.ts` — fill in `permissions` arrays for each module
- `src/lib/modules/__tests__/permissions.test.ts` — new test file

**Risks:**
- _Regression:_ Existing permission functions (`canEditContent`, etc.) must not change. D4 only adds to the permission system; it does not modify existing behavior.
- _Migration:_ None — no content or schema changes.
- _Architectural:_ Module permissions are declared here and enforced at application layer call sites (API routes, dashboard UI). D4 builds the infrastructure; individual enforcement points are wired in each module's own code as subsequent work — D4 does not need to retrofit all enforcement points.

**Testing:**
- `npx vitest run` — all tests pass including new `permissions.test.ts`.
- Unit tests: verify `canPerformModuleAction` returns `true` when module is installed and enabled and role qualifies; `false` when module is not installed; `false` when module is installed but disabled; `false` when role does not qualify.
- Regression: verify all existing `canEditContent`/`canManageMedia`/etc. functions return identical results — run the existing permission tests and confirm no change.

**Acceptance criteria:**
- `ModulePermissionDef` declared in all three module manifests (populated from Phase 0 inventory §6).
- `buildModulePermissions()` produces a unified map with no duplicate IDs.
- `canPerformModuleAction()` is implemented and tested.
- No existing permission function behavior is changed.
- Verified on production → tag V1.0.0.

**Rollback strategy:**
- `git revert` of the D4 commit is sufficient.
- Removes `src/lib/modules/permissions.ts` and the `canPerformModuleAction()` addition to `src/lib/permissions.ts`.
- No schema rollback needed.
- No content migration rollback needed.
- No feature flags.
- After rollback: run the full permission test suite (`npx vitest run`) and confirm all existing permission functions return correct results. Confirm V1.0.0 tag is not applied (or is moved back) if D4 is rolled back before production verification.
- Note: if V1.0.0 had already been tagged and pushed, the revert creates V1.0.0-rollback semantically — discuss versioning convention with Tom before proceeding.

**Dependencies:** A2 (Manifest type), B1 (ModuleInstallation type — needed to check installed state). Phase 0 permission inventory (§6) is required input.

---

### MILESTONE C2 — Module Management UI + Platform Service

> **Sequencing note:** C2 is the second part of Milestone C (Project Settings). It is positioned here, after Milestone D, so the management interface is built on a stable, fully-derived architecture. All four derivation phases (D1–D4) and V1.0.0 must be complete before C2 begins.

**Version:** V1.0.1  
**Goal:** Add install/uninstall/enable/disable controls to the Modules section. Extract module management logic into a reusable platform service so the future client CMS can consume it without duplicating logic.

**Scope:**
- **Platform service** — create `src/lib/modules/service.ts` with the following methods:
  - `listInstallations(projectSlug: string): ModuleInstallation[]`
  - `install(projectSlug: string, moduleId: string): Promise<void>` — adds a `ModuleInstallation` with `version` from the current manifest
  - `uninstall(projectSlug: string, moduleId: string): Promise<void>` — removes the Installation record
  - `setEnabled(projectSlug: string, moduleId: string, enabled: boolean): Promise<void>`
  - `getInstallation(projectSlug: string, moduleId: string): ModuleInstallation | undefined`
  - The service reads from and writes to the persistence model chosen in B2.
  - Location: `src/lib/modules/service.ts` — not in `src/lib/sanity/`, because this is a module-layer concern.
- **Studio UI** — upgrade the Modules section in Project Settings (built in C1) from read-only to interactive:
  - Per module: name, version, status badge (Installed / Available / Disabled)
  - Install button for available modules; Uninstall and Enable/Disable controls for installed modules
  - Confirm dialog for uninstall
  - Optimistic UI or a documented reload behavior after mutation
- **Constraints:**
  - No configuration UI yet (config schemas are future work).
  - No version or "update available" UI (Milestone E).
  - The service makes Sanity API calls using the persistence model from B2. It does not connect to Supabase yet.

**Files expected to change:**
- `src/lib/modules/service.ts` — new file
- `src/lib/sanity/studio/ModuleManager.tsx` — replaces or extends `ModuleList.tsx` from C1
- `sanity.config.ts` — wire `ModuleManager` into Project Settings Modules section
- `src/lib/modules/__tests__/service.test.ts` — unit tests with mocked Sanity client

**Risks:**
- _Regression:_ Install/uninstall writes to the project document (or to the first-class entity if that was chosen in B2). If the write is malformed, Studio navigation breaks for that project. Validate the written shape against `ModuleInstallation` type before committing.
- _Derivation integration:_ C2 is built after D1–D4. The install operation must trigger a Studio navigation refresh so the newly installed module's Pages and Collections appear. Test the full cycle: install → navigation update → uninstall → navigation update.
- _Migration:_ None.

**Testing:**
- Unit tests: `service.test.ts` mocks the Sanity client and tests each method in isolation.
- Manual (Studio): install a module for a project; verify navigation immediately updates to show the module's Pages and Collections (or that a reload is required and documented).
- Manual (Studio): uninstall a module; verify navigation hides its sections.
- Manual (Studio): disable a module; verify it remains in the Installations list but navigation hides its sections.
- Regression: verify no other projects are affected by mutations on one project.

**Acceptance criteria:**
- Platform service is implemented, tested, and located in `src/lib/modules/`.
- Install, uninstall, and enable/disable operations work end-to-end in Studio.
- Studio navigation reflects installation state changes.
- No regression in existing module navigation for any project.

**Rollback strategy:**
- `git revert` of the C2 commit is sufficient for the code.
- Any `moduleInstallations` data written via the C2 UI remains in Sanity — reverting the code does not remove it. The C1 read-only list still displays it correctly (C1 is not rolled back).
- If a write operation produced malformed Installation data, patch it directly via the Sanity MCP before rolling back C2 code: `*[_type == "project" && projectSlug == $slug]` → patch `moduleInstallations` to the correct state.
- No schema rollback needed (B1 schema remains).
- No feature flags.
- After rollback: confirm the C1 read-only Modules list is still visible and accurate in Project Settings. Confirm Studio navigation reflects the actual `moduleInstallations` data state.

**Dependencies:** All of Milestone D complete. V1.0.0 tagged. C1 must be in place.

---

### MILESTONE E — Update Management

**What it delivers:** The platform tracks which version of each module's manifest a project's content conforms to, detects when a new manifest version is available, and supports an administrator-controlled workflow for schema-breaking updates. This milestone is platform evolution built on the completed architectural transformation.

---

#### Phase E1 — Version Tracking

**Version:** V1.0.2  
**Goal:** The platform runtime compares each Installation's recorded version against the current manifest version and surfaces an "update available" indicator.

**Scope:**
- Add version comparison logic to the platform service (`src/lib/modules/service.ts`):
  - `checkForUpdates(projectSlug: string): ModuleUpdateSummary[]`
  - Returns one entry per installed module where `installation.version !== manifest.version`.
  - Each entry carries: `moduleId`, `installedVersion`, `currentVersion`, `isBreaking: boolean`.
  - `isBreaking` is true if the semver major version differs.
- Expose update status in the Project Settings Modules UI (C2):
  - "Up to date" badge for current installations.
  - "Update available" badge with version delta for outdated installations.
  - Breaking updates flagged with a warning indicator.
- Non-breaking updates are informational — no admin action required. The badge appears but no migration is needed.

**Files expected to change:**
- `src/lib/modules/service.ts` — add `checkForUpdates()`
- `src/lib/modules/types.ts` — add `ModuleUpdateSummary`
- `src/lib/sanity/studio/ModuleManager.tsx` — add update status badges
- `src/lib/modules/__tests__/service.test.ts` — add update check tests

**Risks:**
- _Manifest version drift:_ If a manifest's `version` field is not updated when the manifest changes, `checkForUpdates()` will never flag the change. Establish and document the convention: every meaningful manifest change must bump `version`. This is an operational discipline, not enforced by code — but the Phase A3 validator could be extended to check that `version` was bumped relative to git history (complex; not required in E1).
- _Migration:_ None — E1 only reads and displays; it does not write.

**Testing:**
- Unit tests: mock a project where one module's installation `version` lags behind the manifest. Verify `checkForUpdates()` returns the correct summary with correct `isBreaking` classification.
- Manual (Studio): with a test installation at a lower version (patch a document manually), verify the "update available" badge appears in Project Settings.
- Manual (Studio): verify a current installation shows "Up to date."

**Acceptance criteria:**
- `checkForUpdates()` correctly identifies modules where `installation.version !== manifest.version`.
- Breaking vs non-breaking is correctly classified by semver major.
- Project Settings shows update status per installed module.
- Non-breaking updates show an informational badge with no required action.

**Rollback strategy:**
- `git revert` of the E1 commit is sufficient.
- Removes `checkForUpdates()` and update status badges from the UI.
- No schema rollback needed.
- No content migration rollback needed — E1 only reads; it never writes.
- No feature flags.
- After rollback: open Project Settings Modules section; confirm update badges are gone and the install/uninstall UI from C2 is intact.

**Dependencies:** All of Milestone D, C2.

---

#### Phase E2 — Update Workflow

**Version:** V1.0.3  
**Goal:** Administrator-controlled workflow for schema-breaking module updates. A breaking update never silently migrates live tenant content.

**Scope:**
- When a breaking update is available for a module:
  - The Project Settings Modules UI shows a "Migration required" badge with changelog.
  - An "Apply update" button opens a confirmation dialog explaining what will change.
  - On confirmation: the platform runs the module's declared migration function and updates the Installation's `version` to the current manifest version.
- Each module manifest gains an optional `migrations` field:
  ```
  migrations?: {
    fromVersion: string
    toVersion: string
    description: string
    migrate: (projectSlug: string, sanityClient: SanityClient) => Promise<void>
  }[]
  ```
- The platform service gains `applyUpdate(projectSlug: string, moduleId: string): Promise<void>` — looks up the migration chain and runs it in order.
- Non-breaking updates: `applyUpdate` simply writes the new version to the Installation record — no migration function needed.
- Add a `migrations` completeness check to the A3 validator: every breaking (major) version bump in `migrations` must have a corresponding migration entry.

**Files expected to change:**
- `src/lib/modules/types.ts` — add `ModuleMigration` to `ModuleManifest`
- `src/lib/modules/service.ts` — add `applyUpdate()`
- `src/lib/sanity/studio/ModuleManager.tsx` — update workflow UI
- `src/lib/modules/validate.ts` — extend with migration chain completeness check
- `src/lib/modules/__tests__/service.test.ts` — migration chain tests

**Risks:**
- _Irreversibility:_ This is the highest-risk phase in the entire roadmap. A migration function that runs successfully changes Sanity content. If the migration is incorrect, the content is changed incorrectly. Reversing it requires either a reverse migration or a Sanity dataset restore from backup.
  - Mitigation: require each migration function to be tested in isolation before it is added to a manifest. Require a pre-migration Sanity export for any project before running a breaking update in production.
- _Migration chain gaps:_ If a project is at version 1.0.0 and the current manifest is at 3.0.0, two migration steps (1→2, 2→3) must exist and run in order. The validator check above enforces this.

**Testing:**
- Unit tests: mock a migration chain and verify `applyUpdate()` runs migrations in correct version order and does not skip any intermediate version.
- Manual (Studio): run a test breaking update on a dev project; verify content is migrated correctly and Installation version is updated.
- Manual (Studio): verify a non-breaking update updates the version record with no content side-effects.
- Manual (Studio): verify that applying the same update twice is idempotent (if version already matches, `applyUpdate` is a no-op).

**Acceptance criteria:**
- Breaking updates require explicit administrator confirmation before any migration runs.
- Migration functions run in correct version order.
- Installation version is updated only after migration completes successfully — not before, not speculatively.
- Non-breaking updates update the version record with no content side-effects.
- The A3 validator rejects a manifest with a missing migration entry for a major version bump.

**Rollback strategy:**
- `git revert` of the E2 commit removes the update workflow UI and `applyUpdate()` from the service.
- **Critical:** reverting E2 code does not undo migrations that have already run. Content changes made by migration functions are permanent unless reversed manually.
- If a migration ran and produced incorrect content: (a) write and run a reverse migration against the affected project; (b) alternatively, restore the project's content from a Sanity dataset backup taken immediately before the migration. Document which option is taken.
- No feature flags in this phase — but individual migration functions may be gated behind a dry-run flag during development.
- After rollback: open Project Settings Modules section; confirm the "Migration required" badge and "Apply update" button are absent. Confirm the C2 install/uninstall UI is intact. Verify affected project content is in the expected state (either migrated correctly or restored).

**Dependencies:** E1.

---

## Dependency Graph

```
Phase 0 (Audit)
  │
  ├── A1 (Registry Relocation)
  │     └── A2 (Manifest Type)
  │           ├── A3 (Validation)
  │           │
  │           ├── B1 (Installation Schema) ── B2 (Persistence Decision)
  │           │                                      │
  │           │                               C1 (Settings Shell)
  │           │                                      │
  │           ├── D1 (Schema Derivation) ────────────┤
  │           ├── D2 (Section Map)       ────────────┤  (D1–D4 can run in parallel)
  │           ├── D3 (Navigation)        ────────────┤
  │           └── D4 (Permissions) [also needs B1] ──┘
  │                                                  │
  │                                            V1.0.0 tag
  │                                                  │
  │                                            C2 (Mgmt UI + Service)
  │                                                  │
  │                                            E1 (Version Tracking)
  │                                                  │
  │                                            E2 (Update Workflow)
```

**Phases that can run in parallel:**
- D1 / D2 / D3 can all begin once A2 and A3 are complete. They may be executed in parallel by different sessions.
- D4 can begin once A2 and B1 are complete, independently of D1–D3.
- C1 can begin once B2 is decided, independently of Milestone D.

**Hard sequential requirements:**
- Phase 0 → A1 → A2 → A3
- A2 → B1 → B2 → C1
- A2 + B1 → D4
- A2 + A3 → D1, D2, D3 (can be parallel)
- D1 + D2 + D3 + D4 → V1.0.0 → C2
- C2 → E1 → E2

---

## Recommended Implementation Order

Execute in this sequence for minimum risk and maximum deployability:

1. **Phase 0** — Architecture Audit _(1 session — document only)_
2. **A1** — Registry Relocation _(1 session, low risk)_
3. **A2** — Manifest Type _(1 session, medium effort — uses Phase 0 §3 and §4)_
4. **A3** — Validation _(1 session, low risk; adds safety net for all later phases)_
5. **B1** — Installation Schema _(1–2 sessions; query Sanity first; uses Phase 0 §2)_
6. **B2** — Persistence Decision _(1 session, documentation only)_
7. **C1** — Project Settings Shell _(1 session)_
8. **D1** — Schema Derivation _(1–2 sessions; uses Phase 0 §4)_
9. **D3** — Navigation Derivation _(1 session; uses Phase 0 §5; can parallel D1)_
10. **D2** — Section Map Derivation _(1 session; uses Phase 0 §3; test every section type)_
11. **D4** — Permission Derivation _(1 session; uses Phase 0 §6)_
12. _(V1.0.0 tagged on D4 production verification)_
13. **C2** — Management UI + Platform Service _(1–2 sessions)_
14. **E1** — Version Tracking _(1 session)_
15. **E2** — Update Workflow _(1–2 sessions; highest-risk phase; test migrations carefully)_

> Do not combine multiple phases in a single session unless the phases are trivially small or explicitly grouped above. Each phase's acceptance criteria must be met and verified before the next phase begins.

---

## Recommended Release Strategy

Every phase deploys through the standard Abluo three-stage pipeline:

```
dev → (Tom verifies on dev.abluo.app) → preview → (Tom verifies on preview.abluo.app) → main
```

No exceptions. The stop points documented in `CLAUDE.md` apply to every phase.

**Milestone gates** — at the end of each milestone, before beginning the next, Tom should:
1. Verify all phases in the milestone are stable on production.
2. Confirm the milestone is complete.
3. Explicitly approve beginning the next milestone.

Five natural checkpoints: after Phase 0, after Milestone A, after Milestone B, after C1, after Milestone D / V1.0.0.

**Version numbering:**

| Phase | Version |
|---|---|
| Phase 0 | V0.9.18 |
| A1 | V0.9.19 |
| A2 | V0.9.20 |
| A3 | V0.9.21 |
| B1 | V0.9.22 |
| B2 | V0.9.23 |
| C1 | V0.9.24 |
| D1 | V0.9.25 |
| D2 | V0.9.26 |
| D3 | V0.9.27 |
| D4 | V0.9.28 → **V1.0.0** on production verification |
| C2 | V1.0.1 |
| E1 | V1.0.2 |
| E2 | V1.0.3 |

Always run `git log --oneline -10` before committing to confirm the actual last version tag.

---

## Architectural Risks to Monitor

The following risks should be actively monitored throughout ADR-011 implementation. If any risk materialises, stop and assess before proceeding to the next phase.

**1. SectionRenderer drift between routes**
Both `[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx` must remain in sync. Phase D2 resolves this structurally, but until D2 is complete, any new section added to one route must be added to both. The Phase 0 inventory (§3) is the reference for confirming parity. The New Section Checklist in `CLAUDE.md` remains mandatory until D2 is deployed and verified on production.

**2. MODULE_REGISTRY consumers outside sanity.config.ts**
After A1, the registry is importable everywhere. Monitor for any code that imports from `sanity.config.ts` directly to read module information — this is an anti-pattern that bypasses the registry layer. Phase 0 (§1) should establish the baseline; any new such reference found during later phases is a regression.

**3. `enabledModules` / `moduleInstallations` coexistence window**
During and after B1, both fields may exist in project documents until all are migrated. The fallback logic must be tested with documents in both states. Do not remove `enabledModules` from the schema until all documents are confirmed migrated — treat this as a separate cleanup commit after B1 has been stable on production for at least one full release cycle.

**4. Manifest version drift**
After B1, every Installation records the manifest `version`. If a manifest's `version` field is not incremented when the manifest changes, `checkForUpdates()` (E1) will never surface the change. Establish the convention now: every meaningful manifest change bumps `version`. Document this as a standing rule in the module file's header comment.

**5. Cross-module store access**
As modules become more independent, the temptation arises to have one module reach directly into another module's Sanity types (e.g. a GROQ query in the events module filtering on `_type == "post"`). This violates "modules expose contracts, not storage." Monitor in code review. The Phase 0 hidden coupling inventory (§7) establishes the baseline; any new cross-module store access found during later phases is a new violation.

**6. Build function memoisation**
`buildSchema()`, `buildSectionMap()`, and `buildCollectionItems()` must be computed once at module initialisation, not per request. If any of these are called inside render paths without memoisation, performance degrades with registry size. Review each derivation function at the time of writing.

**7. `collectionItems` lambda expressiveness gap (D3)**
If any current `collectionItems` lambda contains Studio-specific logic not expressible in `ModuleCollectionDef`, D3 introduces an escape hatch (`customCollectionItems`). Any use of the escape hatch is technical debt. Track it explicitly; plan to eliminate it before the first new module beyond the three current ones is added.

**8. Migration chain gaps (E2)**
If a module goes from version 1.0.0 to 3.0.0 without intermediate migration entries, a project at 1.0.0 has no migration path. The validator extension in E2 enforces this, but only for manifests checked at build time. Monitor: every major version bump in a manifest must have a corresponding migration entry before that manifest version is committed.

**9. E2 migration irreversibility**
Content migrations applied by `applyUpdate()` are not automatically reversible. Before any breaking update workflow is tested on a dataset with real content, take a Sanity export. Document this as a standing requirement in the E2 phase notes; it is not just a testing concern.

---

## Future Work — Intentionally Outside ADR-011

The following items are explicitly deferred. They are named here so they are not accidentally started during ADR-011 implementation. If any of these are to be built, they require their own ADR or roadmap amendment.

**New modules** — CRM, Shop, Booking, Members. ADR-011 clears the path; each module is its own project, its own roadmap.

**Marketplace / external source registries** — ADR-011 describes "one authoritative registry" while leaving room for future source registries that resolve into it. The marketplace registration flow and any external module catalogue are explicitly out of scope.

**Client CMS reuse of the platform service** — Phase C2 builds `src/lib/modules/service.ts`. Wiring it into the client-facing dashboard (not Sanity Studio) is a client CMS project.

**Billing in Project Settings** — Named as a stub in C1. Not implemented in any ADR-011 phase.

**Domains management in Project Settings** — Same as above.

**Analytics in Project Settings** — Same as above.

**Per-tenant isolated runtimes** — The Deployment Topology Assumption underlying ADR-011's versioning model. If Abluo ever moves to isolated per-tenant runtimes, the versioning section of ADR-011 must be revisited. That decision is explicitly out of scope of this roadmap.

**Public Contract machinery** — Module manifests declare a `publicContract` stub in A2. The infrastructure for inter-module contract discovery and optional integration is not built in any ADR-011 phase. It becomes relevant when multiple modules have genuine integration needs.

**Module marketplace UI** — Browsing, searching, and installing modules from an external registry. Depends on marketplace source registries (above).

**Automated migration tooling** — E2 provides the migration hook. A first-class migration runner with dry-run, rollback, and audit log is future work.

**`enabledModules` field cleanup** — After B1 is stable and all project documents confirmed migrated, `enabledModules` should be removed from the schema. This is a one-line schema change + verification. Schedule it as a cleanup commit after at least one full release cycle of B1 on production. It does not appear as a numbered phase in this roadmap.

---

## Summary Table

| Phase | Milestone | Version | What it delivers | Risk |
|---|---|---|---|---|
| Phase 0 | Audit | V0.9.18 | Current-state inventory; no code | Negligible |
| A1 | Foundation | V0.9.19 | Registry in platform location | Low |
| A2 | Foundation | V0.9.20 | Full ModuleManifest type | Low |
| A3 | Foundation | V0.9.21 | Build-time validation | Low |
| B1 | Installation | V0.9.22 | ModuleInstallation schema + migration | Medium |
| B2 | Installation | V0.9.23 | Persistence decision documented | Low |
| C1 | Project Settings | V0.9.24 | Project Settings shell (read-only) | Low |
| D1 | Derivation | V0.9.25 | Schema derivation from manifests | High |
| D2 | Derivation | V0.9.26 | Section map derivation | High |
| D3 | Derivation | V0.9.27 | Navigation derivation (complete) | Medium |
| D4 | Derivation | V0.9.28 → **V1.0.0** | Permission derivation; arch. complete | Medium |
| C2 | Project Settings | V1.0.1 | Management UI + platform service | Medium |
| E1 | Update Mgmt | V1.0.2 | Version tracking + update badges | Low |
| E2 | Update Mgmt | V1.0.3 | Update workflow + migrations | High |

---

## Roadmap Governance

This roadmap is frozen. It becomes the implementation contract for ADR-011. The following rules govern how it evolves.

### This roadmap is an implementation contract

Every phase specification — goal, scope, files, risks, testing, acceptance criteria, rollback strategy — is a commitment, not a suggestion. Implementers follow it; they do not rewrite it as they go.

### Completed phases are immutable

Once a phase is verified on production and its version tag applied, its specification is a historical record. It is never edited. If the implementation deviated from the spec, the deviation is documented in an amendment — the spec is not retroactively corrected to match what was built.

### Future discoveries do not rewrite history

If implementation reveals that a phase was harder than expected, that a risk materialised, or that a decision was wrong — the response is a **Roadmap Amendment**, not an in-place edit of the phase specification.

### Changes are introduced as Roadmap Amendments

A Roadmap Amendment is a new, numbered entry appended to this document (or to a separate `docs/adr-011-amendments.md` file if amendments grow long). Each amendment:
- Receives a unique identifier: **RA-001**, **RA-002**, etc.
- States which phase or milestone it affects.
- Explains why the change is required (what was discovered, what assumption failed).
- Describes exactly what changes.
- Is approved by Tom before implementation of the affected phase proceeds.

Amendments may:
- Add a new phase.
- Split an existing phase into two.
- Defer a phase to a later milestone.
- Change the scope of a future (not yet started) phase.
- Add a risk identified during implementation.

Amendments may not:
- Change a completed phase's specification retroactively.
- Skip a phase without explanation.
- Reorder phases in ways that violate the dependency graph without a documented reason.

### Roadmap amendments must explain why

An amendment that says "changed D3 scope" is not an amendment — it is a note. An amendment must explain the cause: what was discovered, what assumption failed, and why the change is the correct response.

### The roadmap evolves like ADRs evolve

ADRs are not edited when circumstances change — a new ADR is written. This roadmap follows the same discipline. The document you are reading is the V0 specification. Amendments are the V1, V2 updates. The history of amendments is the history of the implementation.

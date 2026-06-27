# ADR-011 — Execution Progress

**Roadmap:** `docs/ADR-011-implementation-roadmap.md` (frozen — do not modify)  
**Checklist:** `docs/implementation-checklist.md`  
**Last updated:** 2026-06-27

> This document records execution progress only. It is the only ADR-011 document
> that changes during implementation. The roadmap and checklist are never edited
> to reflect progress — this file is.

---

## Current State

| Field | Value |
|---|---|
| **Current milestone** | Milestone D — Complete |
| **Current phase** | D4 Complete — awaiting production verify for V1.0.0 tag |
| **Overall status** | In Progress |
| **Baseline version** | V0.9.25 |
| **Next version** | V1.0.1 (after V1.0.0 production verify) |

---

## Phase Execution Log

| Phase | Name | Version | Status | Started | Completed | Notes |
|---|---|---|---|---|---|---|
| Phase 0 | Architecture Audit | V0.9.18 | Complete | 2026-06-26 | 2026-06-26 | 9 hidden-coupling findings; no code changed |
| A1 | Registry Relocation | V0.9.19 | Complete | 2026-06-26 | 2026-06-26 | CollectionItemsContext context object API; ProjectLinker.tsx included |
| A2 | Full ModuleManifest Type | V0.9.20 | Complete | 2026-06-26 | 2026-06-26 | TenantRole → src/lib/types/roles.ts; CollectionItemsContext moved to types.ts |
| A3 | Build-time Manifest Validation | V0.9.21 | Complete | 2026-06-26 | 2026-06-26 | 44 tests; collect-all errors; RA-001 candidate (self-dependency) |
| B1 | Installation Type & Schema Migration | V0.9.22 | Complete | 2026-06-26 | 2026-06-26 | ModuleInstallation type; schema + GROQ; migration script; queries.ts zero consumers confirmed |
| B2 | Installation Persistence Decision | V0.9.23 | Complete | 2026-06-26 | 2026-06-26 | Array-on-project confirmed; ADR-011 sub-decision in architecture-decisions.md |
| C1 | Project Settings Shell | V0.9.24 | Complete | 2026-06-26 | 2026-06-26 | General + Modules + Locales + 4 stubs; ModuleList.tsx + StubPane.tsx |
| D1 | Schema Derivation | V0.9.25 | Complete | 2026-06-27 | 2026-06-27 | 8 types moved; buildSchema(); shared.ts; platform-distributed sections principle |
| D2 | Section Map Derivation | V0.9.26 | Complete | 2026-06-27 | 2026-06-27 | RA-002 applied; 1 module section; SECTION_MAP; registry stays declarative |
| D3 | Navigation Derivation | V0.9.27 | Complete | 2026-06-27 | 2026-06-27 | RA-003 applied; declarative collections; navigation.ts; 138 tests |
| D4 | Permission Derivation | V0.9.28 → V1.0.0 | Complete | 2026-06-27 | 2026-06-27 | RA-004 applied; ModulePermissionMap; MODULE_PERMISSION_MAP; canPerformModuleAction (4-param); validator extended; tsc clean |
| C2 | Module Management UI + Service | V1.0.1 | Waiting | — | — | Begins after V1.0.0 |
| E1 | Version Tracking | V1.0.2 | Waiting | — | — | |
| E2 | Update Workflow | V1.0.3 | Waiting | — | — | Highest risk — backup before testing |

---

## Roadmap Amendment Candidates

Ideas discovered during implementation that may become Roadmap Amendments but have not yet been approved. Approved amendments move to the section below.

| ID | Phase | Status | Description |
|---|---|---|---|
| RA-001 | A3 | Proposed | Reject module self-dependencies (`requires` / `integratesWith` referencing the module itself). Consider adding as Rule 10 before B1. |

---

## Roadmap Amendments

> Only approved amendments belong here. When an amendment is approved, append it using the format below.
> Do not edit the roadmap. Do not edit completed phase entries above.

```
### RA-NNN — [Title]

**Date:** YYYY-MM-DD  
**Affects:** Phase [X]  
**Approved by:** Tom  

**Why:** [What was discovered; what assumption failed.]  
**Change:** [Exactly what is different from the roadmap specification.]  
**Impact on other phases:** [Any downstream effects.]
```

### RA-002 — D2 Scope Reduction and Manifest Declarativity

**Date:** 2026-06-27  
**Affects:** Phase D2  
**Approved by:** Tom  

**Why (RA-002a — scope):** The roadmap's acceptance criterion stated "neither SectionRenderer file contains a hand-maintained case list for any section type." This conflicts with the Sections vs Modules design principle established in D1: platform-owned sections (heroSection, contentSection, etc.) are not module-gated and must remain in the SectionRenderer switch under the platform's control. Applying the criterion literally would require reclassifying platform sections as module sections, violating the principle.

**Change (RA-002a):** Revised acceptance criterion: all module-owned sections (as declared in `platformContract.sectionTypes`) are rendered via `SECTION_MAP`. Platform-owned sections remain in explicit SectionRenderer switch cases. Both SectionRenderer files are identical in section coverage. New module sections can be added without modifying either SectionRenderer file.

**Why (RA-002b — manifest declarativity):** The roadmap specified adding `platformContract.sectionComponents: Record<string, React.ComponentType<SectionProps>>` to `ModuleManifest`. This would pull Next.js-specific React components into `registry.ts`, which is imported by `sanity.config.ts` (Sanity Studio). The Studio would transitively depend on `next/image`, `next/link`, and other Next.js rendering primitives — a potential Studio bundle failure. Tom confirmed: "Keep the registry purely declarative. Do not allow it to become a runtime dependency on frontend rendering components."

**Change (RA-002b):** `sectionComponents` is NOT added to `ModuleManifest`. The manifest declares `sectionTypes: string[]` only (already present from A2). The section component map lives entirely in `src/lib/modules/sections.ts`, which imports module section files directly and is never imported by `registry.ts` or `sanity.config.ts`. `ModuleManifest.platformContract` is unchanged.

**Impact on other phases:** None. D3 and D4 are unaffected. The `sectionTypes: string[]` declaration already on the manifest is the stable declarative surface; D2's runtime composition is a separate layer.

### RA-003 — D3 Group Wrapper Type and No Escape Hatch

**Date:** 2026-06-27  
**Affects:** Phase D3  
**Approved by:** Tom  

**Why (RA-003a — flat type inadequate):** The roadmap specified a flat `ModuleCollectionDef { id, label, schemaType, filter, ordering?, initialValueTemplate? }` as a single document-list descriptor. Both active modules (Blog, Events) use a two-level nested structure: a named group (S.listItem → S.list) containing one or more sub-lists (S.listItem → S.documentList). A flat type cannot express this. Phase 0 §5 noted this explicitly and flagged the escape hatch as a fallback.

**Why (RA-003b — no escape hatch needed):** The roadmap's proposed `customCollectionItems?: (slug: string) => ListItem[]` escape hatch would be `collectionItems` renamed — still an imperative lambda carrying Studio code into the manifest. Both Blog and Events map cleanly to a two-level group type, so the escape hatch is unnecessary and would constitute permanent technical debt with no current consumer.

**Change:** `ModuleCollectionDef` replaced by:
- `ModuleCollectionGroupDef { id, label, items: ModuleCollectionItemDef[] }` — the group wrapper  
- `ModuleCollectionItemDef { id, label, schemaType, filter, ordering?, initialValueTemplate? }` — the sub-list (fields identical to the original flat type)  
- `platformContract.collections: ModuleCollectionGroupDef[]` replaces `collectionItems()`  
- `CollectionItemsContext` removed — no longer needed; `StructureBuilder` import removed from `types.ts`  
- `buildCollectionItems(slug, S, manifest)` in `navigation.ts` is the Studio builder — not in the manifest  
- Escape hatch: not implemented  

**Impact on other phases:** D4 (Permission Derivation) is unaffected — permissions field is unchanged. `StructureBuilder` import removed from `types.ts` cleans up a latent bundler concern. No other phases touch collections.

### RA-004 — Add `modulePermissionMap` as 4th parameter to `canPerformModuleAction`

**Date:** 2026-06-27
**Affects:** Phase D4
**Approved by:** Tom

**Why:** The roadmap specified a 3-parameter signature `canPerformModuleAction(role, permissionId, moduleInstallations)`. This signature cannot check "role has the declared permission" without access to `defaultRoles`, which lives in the registry — not in `ModuleInstallation`. The function would require importing the registry directly into `src/lib/permissions.ts`, making the platform permission layer a runtime dependency of the modules layer. This contradicts the D1–D3 pattern where builders receive data rather than importing it.

**Change:** Signature amended to:
```typescript
canPerformModuleAction(
  role: TenantRole,
  permissionId: string,
  moduleInstallations: ModuleInstallation[],
  modulePermissionMap: ModulePermissionMap
): boolean
```
`src/lib/permissions.ts` imports `ModuleInstallation` and `ModulePermissionMap` as type-only from `./modules/types` — zero runtime cost, no registry coupling. `MODULE_PERMISSION_MAP` from `src/lib/modules/permissions.ts` is the standard value to pass. Callers with tenant-specific overrides may supply a custom map without changing this function.

**Impact on other phases:** None. D4 is the final derivation phase. C2 and E1/E2 do not call `canPerformModuleAction` directly.

---

## Phase D4 — Implementation Notes

> Design decisions and findings from Phase D4 — Permission Derivation (V0.9.28).

**RA-004 applied — see Roadmap Amendments section above**

The 3-parameter roadmap signature was amended to 4 parameters. The platform permission layer (`src/lib/permissions.ts`) remains independent of the modules layer at import time.

**Architectural principle — Modules declare capabilities. Roles assign permissions. Users receive roles.**

> Modules declare the permissions they introduce.
> Roles grant those permissions.
> Users receive roles.

`defaultRoles` on each `ModulePermissionDef` is a platform default — a convenience starting point when a module is first installed. It is not a fixed contract between the module and any role set.

Tenant-defined custom roles (Blog Editor, Event Manager, Live Producer, Marketing, SEO, etc.) are an explicit future design goal. Nothing implemented in D4 assumes a fixed set of roles. Future roles are achievable by assigning existing module permissions to new role definitions — no module manifest needs modification when authorization policies evolve. This principle is also recorded in `docs/architecture-decisions.md` (ADR-011 Sub-decision D4).

**Files added or changed**

| File | Change |
|---|---|
| `src/lib/modules/types.ts` | Added `ModulePermissionMap` type; expanded `defaultRoles` JSDoc |
| `src/lib/modules/permissions.ts` | **New.** `buildModulePermissions()` + `MODULE_PERMISSION_MAP` |
| `src/lib/permissions.ts` | Added `canPerformModuleAction()` (4 params) + expanded architectural doc above it |
| `src/lib/modules/validate.ts` | Extended to validate permission IDs: non-empty, module-prefixed, unique across registry |
| `src/lib/modules/index.ts` | Added `ModulePermissionMap`, `buildModulePermissions`, `MODULE_PERMISSION_MAP` exports |
| `src/lib/modules/__tests__/permissions.test.ts` | **New.** Comprehensive builder, invariant, authorization, and regression tests |
| `src/lib/modules/__tests__/validate.test.ts` | Added permission ID validation describe block |
| `docs/architecture-decisions.md` | Sub-decision D4 — Future-proof Permission Model |
| `docs/adr-011-progress.md` | This file |

**Registry unchanged**

All `permissions` arrays in `registry.ts` remain exactly as set in Phase A2. D4 only adds the consumption layer.

**Manifest validator extended — permission IDs**

Three checks, described as "extending the manifest validator" (no external rule number):
- Permission ID is non-empty.
- Permission ID starts with the declaring module's ID (ownership check). Naming semantics beyond the prefix are not validated — `blog.post.write` and `blog.posts.write` are both valid.
- Permission ID is unique across the entire registry (cross-module uniqueness, same pattern as sectionTypes and schemaTypes).

**`MODULE_PERMISSION_MAP` invariant**

`expect(Object.keys(MODULE_PERMISSION_MAP)).toHaveLength(6)` guards against accidental permission removal in future registry edits. Current breakdown: blog (3), events (2), live (1).

**`canPerformModuleAction` — pure function, extensible**

The function evaluates three conditions in order: module installed and enabled → permission in map → role in `defaultRoles`. Returning `false` at the first failing condition keeps the logic fast and explicit. The custom map parameter demonstrates future extensibility — a test verifies that a viewer can be granted `blog.post.write` by passing a custom map, without touching any module manifest.

**No enforcement call sites**

D4 is infrastructure only. No application code calls `canPerformModuleAction` yet. This is intentional and correct per the approved scope.

**tsc + vitest results**

- `tsc --noEmit` → clean (zero errors)
- Complete test suite passes locally.

---

## Milestone D — Complete

Milestone D completes the transition to a fully declarative module architecture.

The module registry is now the single source of truth for:

- Schema derivation
- Section derivation
- Studio navigation derivation
- Permission derivation

Future platform capabilities build on this foundation rather than introducing new registry concepts. Subsequent phases focus on consuming this architecture (module management, installation UI, tenant permissions, custom roles, and future modules) rather than redesigning it.

---

## Phase D3 — Implementation Notes

> Design decisions and findings from Phase D3 — Navigation Derivation (V0.9.27).

**RA-003 applied — see Roadmap Amendments section above**

The flat `ModuleCollectionDef` was replaced by a two-level group type. The escape hatch was not implemented. Both decisions were approved during the Phase Review.

**Core architectural principle**

> Module manifests are declarative descriptions of capabilities. Builder layers consume those descriptions to construct runtime structures. Runtime behaviour belongs in builders, never inside the manifest.

This principle now explains the full architectural evolution from A1 through D3:

- A1 removed imperative labels.
- A2 introduced declarative manifests.
- D1 moved schema construction into `buildSchema()`.
- D2 moved section rendering into `SECTION_MAP`.
- D3 moved Studio navigation into `buildCollectionItems()`.

The manifest now describes capabilities only.

**Builder pattern**

Builders are responsible for translating declarative module metadata into runtime structures. Current builders:

- `buildSchema()` — Sanity schema types from `schemaDefinitions`
- `SECTION_MAP` — React rendering from `sectionTypes`
- `buildCollectionItems()` — Studio navigation from `collections`

Future builders may cover pages, settings, permissions, commands, and APIs as those capabilities are introduced in later phases.

**Registry is now fully declarative**

`registry.ts` no longer contains any imperative code. The `collectionItems` lambdas (the last function fields in `platformContract`) have been replaced by plain `collections: ModuleCollectionGroupDef[]` arrays. The registry now carries only data declarations.

**Inverse isolation principle established**

Two isolation boundaries now govern the modules layer:
- `sections.ts` → Next.js page routes only (never Studio/sanity.config.ts)  
- `navigation.ts` → sanity.config.ts only (never Next.js page routes)

`sanity.config.ts` imports `buildCollectionItems` directly from `./src/lib/modules/navigation` (not through the barrel) to make this boundary explicit and prevent accidental inversion.

**`CollectionItemsContext` fully retired**

`CollectionItemsContext` is removed from `types.ts`. The `StructureBuilder` import is removed from `types.ts`. The re-export from `registry.ts` is removed. The A1/A2 debt marker (`// Remove after all import sites migrate`) is resolved. `types.ts` is now free of all Studio-specific imports.

**ID convention preserved exactly**

`buildCollectionItems()` generates IDs that match the values previously hard-coded in the `collectionItems` lambdas:
- `${slug}-${group.id}` — group list item
- `${slug}-${group.id}-list` — group inner list
- `${slug}-${item.id}` — sub-list item

Navigation tests assert these IDs for both Blog (all three collections) and Events against the live `MODULE_REGISTRY`. Sanity Studio caches state by list item ID — a mismatch resets sidebar state.

**`platformContract` evolution — future observation**

`platformContract` intentionally remains a single flat interface for now. As additional capabilities arrive after V1.0 (pages, settings, permissions, commands, APIs), watch for the natural inflection point where grouping becomes beneficial:

```ts
platformContract: {
  schema: { schemaTypes, schemaDefinitions },
  navigation: { collections },
  rendering: { sectionTypes },
  installation: { permissions },
}
```

This is not a D4 task and not a Roadmap Amendment. It is an architectural observation to prevent `platformContract` from growing indefinitely as a single flat interface.

**Manifest validator extended**

The manifest validator now covers `collections` structure (Rule 10): group id and label non-empty, no duplicate group ids within a module, item id/label/schemaType/filter non-empty. Tests expanded from 44 → 58 in `validate.test.ts`. `navigation.test.ts` adds 15 tests for `buildCollectionItems()`.

**tsc + vitest results**

- `tsc --noEmit` → clean (zero errors)
- `vitest run` → 138 tests, all passing (up from 109)

---

## Phase D2 — Implementation Notes

> Design decisions and findings from Phase D2 — Section Map Derivation (V0.9.26).

**RA-002 applied — see Roadmap Amendments section above**

Two amendments were raised and approved during the Phase Review. RA-002a reduced scope (platform sections stay in switch); RA-002b removed `sectionComponents` from the manifest to protect Studio bundle integrity.

**One module-owned section after platform principle**

After classifying sections per the Sections vs Modules principle:
- Blog: `blogListingSection` — module-owned (1)
- Events: no sections (0)
- Live: no sections (0) — heroLens/heroLiveCapture are platform sections

`SECTION_MAP` contains exactly one entry at V0.9.26. The value of D2 is the pattern, not the count: future modules add a `sections.tsx` file and their entries appear in `SECTION_MAP` automatically, without modifying either page file.

**Circular import avoided without shared type file**

`blog/sections.tsx` does not import `ModuleSectionProps` from `../sections` (avoiding a module-init cycle). Instead it defines a local `LocalSectionProps` type with the same shape. TypeScript validates compatibility at the call site in `sections.ts` where the spread is typed as `SectionComponentMap`. No shared type file needed.

**Studio bundle protection — two-layer separation**

`registry.ts` → `sanity.config.ts` (Studio). `sections.ts` → page route files only. These two import chains never intersect. The development cross-check in `sections.ts` (dynamic `import('./registry')`) is guarded behind `process.env.NODE_ENV !== 'production'` and uses a lazy import so even in development the Studio bundle is never affected.

**`blogListingSection` data hydration unchanged**

The pre-render hydration in both page files (fetching posts and mutating the section object) remains exactly as-is. `SECTION_MAP`'s `BlogListingSection` wrapper receives the already-hydrated section. No data-fetching logic was moved into module infrastructure.

**Prop name adaptation — `tenantSlug` → `tenantId`**

`ModuleSectionProps` uses `tenantSlug` (consistent with SectionRenderer's parameter name). `BlogListingSection` uses `tenantId` internally. The wrapper in `blog/sections.tsx` adapts the name. Neither the component nor the SectionRenderer needed renaming.

**Canonical section order established**

Both SectionRenderer switch bodies now have identical ordering for all 12 platform sections: hero types → content sections → contact/form/metrics. The Phase 0 §3 note about `blogListingSection`/`formSection` order discrepancy is resolved by the section's removal from the switch.

**tsc + vitest results**

- `tsc --noEmit` → clean (zero errors)
- `vitest run` → 109 tests, all passing

---

## Phase D1 — Implementation Notes

> Design decisions and findings from Phase D1 — Schema Derivation (V0.9.25).

**Platform-distributed section templates — design principle**

`heroLiveCaptureSection` and `heroLensSection` are globally available section templates. Their availability in SectionRenderer is not conditioned on Live module installation. This principle was established in D1 at Tom's direction (2026-06-27).

The Live module introduced these sections, but the platform distributes them. Consequences:
- Schema definitions remain in `src/lib/sanity/schema.ts` as platform-owned types.
- They are absent from `live.platformContract.schemaTypes` and `live.platformContract.sectionTypes`.
- `modules/live/schema.ts` exports only `livePageType`.
- D2's section map derivation must not infer that these sections are Live-module-gated.
- This principle is documented in a comment in `registry.ts` and in the module schema file.

**`types.ts` not in roadmap file list — required change**

Adding `schemaDefinitions: () => SchemaTypeDefinition[]` to `platformContract` required modifying `src/lib/modules/types.ts`, which the roadmap's D1 file list omitted. This is the implementation of the stated convention ("manifests carry a direct import reference"). Not a Roadmap Amendment.

**`shared.ts` created to prevent circular imports**

`projectSlugField` and `scopedRef` moved from `schema.ts` to `src/lib/sanity/fields/shared.ts`. Both module schema files and `schema.ts` import from this shared location. Without it:
`schema.ts → modules/schema.ts → registry.ts → modules/blog/schema.ts → schema.ts` would be a build-breaking cycle.

**8 types moved, not 10**

Phase 0 §4 listed 10 module-owned types. The two hero sections are now classified as platform-owned (see above), so only 8 moved:
- Blog: `blogListingSection`, `blogPage`, `postAuthor`, `blogCategory`, `post`
- Events: `eventsPage`, `event`
- Live: `livePage`

**`ModuleDef` deprecated alias removed**

`ModuleDef` alias removed from `types.ts` and `index.ts`. Long-deferred from B1. Zero consumers in the codebase confirmed before removal.

**`initialValueTemplates` unchanged**

7 module-related templates stay in `schema.ts`. `buildSchema()` returns `SchemaTypeDefinition[]` only. No templates are in module files. No Sanity behavior change.

**`schemaTypes` / `schemaDefinitions` sync is manual**

Both fields must stay in sync. No automated check enforces this yet. A future Rule 10 in `validate.ts` could call `schemaDefinitions()` and verify every name in `schemaTypes` appears in the output. Deferred.

**tsc + vitest results**

- `tsc --noEmit` → clean (one test fixture fix required: `makeManifest()` in `validate.test.ts` needed `schemaDefinitions: () => []`)
- `vitest run` → 109 tests, all passing

---

## Phase C1 — Implementation Notes

> These are implementation-level decisions recorded during implementation. They do not change the roadmap, architecture, sequencing, or acceptance criteria.

**Project Settings item already existed (Phase Review Finding)**

The `${slug}-project-settings` list item was already present in `sanity.config.ts` from B1's structure builder additions, pointing directly to `S.document()` for the raw project form. C1 replaced its `.child()` with the structured `S.list()` sub-pane rather than adding a new list item. No duplicate IDs introduced.

**General section added (Phase Review Finding 1)**

The roadmap did not mention preserving access to the raw `project` document form. Without a `General` sub-section, `ProjectLinker.tsx` (client link, DS assignment, Supabase link) becomes unreachable from Studio navigation. A `General` section was added as the first item in the pane, opening `S.document().documentId(project._id).schemaType('project')`. This is within C1 scope and prevents a regression.

**Flat ordering — user's preferred information architecture**

Section order: General → Modules → Locales → Domains → Analytics → Billing → Integrations. Reflects a natural progression: project config → installed functionality → website config → business/platform services. No nested groups. Adding a future section requires only appending a new `S.listItem()` to the array.

**`ModuleList.tsx` options typing — all-optional fields**

Sanity's `S.component()` types `options` as `Record<string, unknown>`. The component interface must use optional fields (`projectSlug?: string`) to satisfy the assignment, matching the `DesignSystemAssignPane` precedent. The `projectSlug` undefined case is handled in the component with a "No project selected" empty state.

**`StubPane.tsx` — shared placeholder component**

A single shared `StubPane` handles all four future sections (Domains, Analytics, Billing, Integrations). Each receives a `label` and `message` via `.options()`. Replacing a stub with a real implementation requires only swapping `S.component(StubPane)` for the new component — no structural change to the pane.

**TypeScript — tsc clean after options interface fix**

Initial `tsc` failed: `Record<string, unknown>` could not be assigned to `{ projectSlug: string }` (required field). Fixed by making all options fields optional. tsc clean on second run.

---

## Phase B1 — Implementation Notes

> These are implementation-level decisions recorded before coding began. They do not change the roadmap, architecture, sequencing, or acceptance criteria.

**Pre-flight Sanity query results**

Query run before any schema change: `*[_type == "project" && defined(enabledModules)]{_id, projectSlug, enabledModules}`

Results (2026-06-26):
- `livener-main` → `["blog", "events", "live"]`
- `studiomartegani-main` → `["blog"]`

Both sets contain only valid `MODULE_REGISTRY` IDs. No unknown modules — migration can proceed without any skip logic being exercised.

**GROQ coalesce strategy — unified `enabledModuleIds` projection (Option A)**

Rather than returning both `moduleInstallations` and `enabledModules` from the structure builder GROQ query and coalescing in TypeScript, the coalesce is done entirely in GROQ:

```groq
"enabledModuleIds": select(
  defined(moduleInstallations) && count(moduleInstallations) > 0 => moduleInstallations[enabled != false].moduleId,
  coalesce(enabledModules, [])
)
```

This returns a unified `string[]` regardless of migration state. The TypeScript structure builder code (`buildPagesItems`, `buildCollectionsItems`) receives the same type it always did — only the GROQ field name changes from `enabledModules` to `enabledModuleIds`. This contains the coalesce logic at the data boundary and leaves the structure builder unchanged in shape.

**Migration script — versions hardcoded**

Module versions in `002-module-installations.ts` are hardcoded to `'1.0.0'` for all three current modules rather than importing from `MODULE_REGISTRY`. Rationale: a migration captures state at the time it ran — importing the live registry would carry forward whatever version the registry declares at runtime rather than what was installed when the migration ran. Hardcoded values are correct and conventional for one-time migrations.

**`queries.ts` — confirmed zero consumers**

Phase 0 §2 confirmed that `src/lib/sanity/queries.ts` has zero `enabledModules` references. This was re-verified by grep on the V0.9.22 codebase: no matches found. No changes to `queries.ts` were required for B1.

**Migration script — idempotency verified**

Running `002-module-installations.ts` a second time against already-migrated projects produces zero writes. Execution path traced:

The GROQ query fetches all projects with `defined(enabledModules)` — this includes already-migrated projects because `enabledModules` is never removed (it is kept as a bridge). For each project, the guard at line 124 evaluates `project.moduleInstallations && project.moduleInstallations.length > 0`. After a successful first run, both projects have `moduleInstallations` records (length 3 and 1 respectively). Both hit `continue` before reaching `installations.push()` or `client.patch().commit()`. The `migrated` counter (incremented only after the guard, at line 166) stays 0. Expected summary on second run:

```
Projects to migrate:          0
Already migrated (skipped):   2
Unknown module IDs (skipped): 0
```

Zero Sanity API writes. Safe to re-run at any time.

**`ModuleDef` deprecation alias retained**

`ModuleDef` was not removed in B1 per the approved implementation decisions. It remains with its `@deprecated` comment. Removal is deferred to the next cleanup phase after B1.

---

## Phase A3 — Implementation Notes

> These are implementation-level decisions recorded before coding began. They do not change the roadmap, architecture, sequencing, or acceptance criteria.

**Collect-all error format with compiler-style diagnostics**

Rather than throwing on the first violation, `validateRegistry` accumulates all `ManifestError` entries — one per rule violation — and throws once at the end with a formatted multi-line message. Each error names the module (`[module-id]` prefix), the rule number, the actual invalid value, and a Fix line. Registry-level rules (6, 7, 8) omit the module prefix since multiple modules are implicated.

Example output:
```
MODULE_REGISTRY validation failed (2 errors):

  [Blog] Rule 2 — id "Blog" is not lowercase kebab-case.
                  Fix: use only lowercase letters (a–z), digits, and hyphens (e.g. "my-module").

  Rule 6 — sectionType "heroSection" is declared by both "live" and "new-module".
            Fix: each sectionType must be owned by exactly one module.
```

Fix-line indentation is computed dynamically to align with the start of the message text after the ` — ` separator. A fourth module next year produces diagnostics of identical quality — the formatter is data-driven.

**Self-dependency — deferred to Completion Review**

The user requested evaluation of whether `requires` or `integratesWith` referencing the module's own id should be rejected. Analysis: a module referencing its own id in `requires` passes Rule 8 as written (the id *is* present in the registry). `integratesWith` is not checked by Rule 8 at all. Self-dependency detection is therefore not covered by any of the nine rules — it would be Rule 10. Raising this in the Completion Review per the user's instruction rather than silently expanding scope.

---

## Phase A2 — Implementation Notes

> These are implementation-level decisions recorded before coding began. They do not change the roadmap, architecture, sequencing, or acceptance criteria.

**`TenantRole` extracted to `src/lib/types/roles.ts`**

Rather than importing `TenantRole` from `permissions.ts` into `modules/types.ts` (creating a `modules → permissions` dependency that Phase D4 would need to reverse), `TenantRole` and its type guard `isValidTenantRole` are extracted to a neutral shared file:

```
src/lib/types/roles.ts
```

Both `permissions.ts` and `modules/types.ts` import from there. `permissions.ts` re-exports `TenantRole` and `isValidTenantRole` for backward compatibility — no existing import paths break. This resolves the D4 circular dependency risk pre-emptively rather than deferring it.

**`CollectionItemsContext` moved from `registry.ts` to `types.ts`**

`CollectionItemsContext` is referenced in `ModuleManifest.platformContract.collectionItems`. Keeping it in `registry.ts` while `ModuleManifest` lives in `types.ts` would create a circular import (`types.ts` → `registry.ts` → `types.ts`). Moving `CollectionItemsContext` into `types.ts` resolves this cleanly. The barrel (`index.ts`) re-exports it — no external import paths change.

**`sanity.config.ts` included in A2 scope**

`pageType` and `collectionItems` move from top-level `ModuleDef` fields into `platformContract`. Five access sites in `sanity.config.ts` update accordingly:
- `mod.pageType` → `mod.platformContract.pageType` (×4 in `buildPagesItems`)
- `m.collectionItems({ slug, S })` → `m.platformContract.collectionItems({ slug, S })` (×1 in `buildCollectionsItems`)

Not in the roadmap file list; included per scope policy. No behavioural change.

---

## Phase A1 — Implementation Notes

> These are implementation-level decisions recorded before coding began. They do not change the roadmap, architecture, sequencing, or acceptance criteria.

**`collectionItems` context object API**

The `collectionItems` lambda cannot close over Sanity's `StructureBuilder (S)` once `MODULE_REGISTRY` is extracted from `sanity.config.ts` — `S` is only available as a callback parameter inside the `structure:` function and is not exported as a static singleton by Sanity 3.99.0.

Rather than adding `S` as a positional parameter (`collectionItems(slug, S)`), the API is designed as a context object:

```typescript
collectionItems({ slug, S })
```

The context object is preferred over positional parameters because additional values — project metadata, installation state, permissions, feature flags — can be added to the context in future phases without changing the function signature. This is an implementation detail. It does not affect the roadmap, the logical behaviour of the registry, or any downstream phase.

**`ProjectLinker.tsx` included in A1 scope**

`ProjectLinker.tsx` is included in this phase although it is not explicitly listed in the roadmap file list. Phase 0 §7 Finding 1 identified `MODULE_LABELS` in `ProjectLinker.tsx` as a parallel copy of registry labels, maintained with a "Keep in sync" comment. Updating it in A1 — at the moment the importable registry is created — eliminates the duplicate source of truth at the earliest opportunity.

---

## Notes & Decisions Log

_Record here any implementation decisions, findings, or deviations that are too small for a formal amendment but worth preserving for future sessions._

| Date | Phase | Note |
|---|---|---|
| 2026-06-27 | D4 | Future-proof Permission Model recorded in `docs/architecture-decisions.md` (ADR-011 Sub-decision D4) before implementation. Modules declare capabilities; roles grant permissions; users receive roles. `defaultRoles` are platform defaults only. Tenant-defined custom roles are an explicit future design goal — D4 infrastructure is built with this extensibility in mind. |
| 2026-06-26 | — | Roadmap frozen at Revision 2. Progress tracker initialised. |
| 2026-06-26 | Phase 0 | Audit document written: `docs/adr-011-current-state.md`. Nine hidden-coupling findings recorded (§7). Three Phase Review findings all confirmed in full. No code changed. |
| 2026-06-26 | Phase 0 | Finding noted for A1 phase lead: `ProjectLinker.tsx` must be updated in Phase A1 (imports `MODULE_LABELS` copy; cannot consume extracted registry until A1 runs). File not in A1 roadmap file-list — raise at A1 Phase Review. |
| 2026-06-26 | A1 | Phase Review approved. Context object API chosen for `collectionItems` (`{ slug, S }`). `ProjectLinker.tsx` included per §7 Finding 1. No Roadmap Amendment required. |

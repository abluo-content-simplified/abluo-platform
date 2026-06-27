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
| **Current milestone** | Milestone D |
| **Current phase** | D1 — Schema Derivation |
| **Overall status** | In Progress |
| **Baseline version** | V0.9.24 |
| **Next version** | V0.9.25 |

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
| D1 | Schema Derivation | V0.9.25 | In Progress | 2026-06-27 | — | 8 types moved; buildSchema(); shared.ts; platform-distributed sections principle |
| D2 | Section Map Derivation | V0.9.26 | Waiting | — | — | High risk — use Phase 0 §3 |
| D3 | Navigation Derivation | V0.9.27 | Waiting | — | — | Use Phase 0 §5 |
| D4 | Permission Derivation | V0.9.28 → V1.0.0 | Waiting | — | — | V1.0.0 tagged on production verify |
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

_No amendments recorded._

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
| 2026-06-26 | — | Roadmap frozen at Revision 2. Progress tracker initialised. |
| 2026-06-26 | Phase 0 | Audit document written: `docs/adr-011-current-state.md`. Nine hidden-coupling findings recorded (§7). Three Phase Review findings all confirmed in full. No code changed. |
| 2026-06-26 | Phase 0 | Finding noted for A1 phase lead: `ProjectLinker.tsx` must be updated in Phase A1 (imports `MODULE_LABELS` copy; cannot consume extracted registry until A1 runs). File not in A1 roadmap file-list — raise at A1 Phase Review. |
| 2026-06-26 | A1 | Phase Review approved. Context object API chosen for `collectionItems` (`{ slug, S }`). `ProjectLinker.tsx` included per §7 Finding 1. No Roadmap Amendment required. |

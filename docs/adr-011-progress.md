# ADR-011 — Execution Progress

**Roadmap:** `docs/ADR-011-implementation-roadmap.md` (frozen — do not modify)  
**Checklist:** `docs/implementation-checklist.md`  
**Last updated:** 2026-06-26

> This document records execution progress only. It is the only ADR-011 document
> that changes during implementation. The roadmap and checklist are never edited
> to reflect progress — this file is.

---

## Current State

| Field | Value |
|---|---|
| **Current milestone** | Milestone A |
| **Current phase** | A1 — Registry Relocation |
| **Overall status** | Waiting |
| **Baseline version** | V0.9.18 |
| **Next version** | V0.9.19 |

---

## Phase Execution Log

| Phase | Name | Version | Status | Started | Completed | Notes |
|---|---|---|---|---|---|---|
| Phase 0 | Architecture Audit | V0.9.18 | Complete | 2026-06-26 | 2026-06-26 | 9 hidden-coupling findings; no code changed |
| A1 | Registry Relocation | V0.9.19 | In Progress | 2026-06-26 | — | |
| A2 | Full ModuleManifest Type | V0.9.20 | Waiting | — | — | |
| A3 | Build-time Manifest Validation | V0.9.21 | Waiting | — | — | |
| B1 | Installation Type & Schema Migration | V0.9.22 | Waiting | — | — | Query Sanity before starting |
| B2 | Installation Persistence Decision | V0.9.23 | Waiting | — | — | Documentation only |
| C1 | Project Settings Shell | V0.9.24 | Waiting | — | — | |
| D1 | Schema Derivation | V0.9.25 | Waiting | — | — | High risk — use Phase 0 §4 |
| D2 | Section Map Derivation | V0.9.26 | Waiting | — | — | High risk — use Phase 0 §3 |
| D3 | Navigation Derivation | V0.9.27 | Waiting | — | — | Use Phase 0 §5 |
| D4 | Permission Derivation | V0.9.28 → V1.0.0 | Waiting | — | — | V1.0.0 tagged on production verify |
| C2 | Module Management UI + Service | V1.0.1 | Waiting | — | — | Begins after V1.0.0 |
| E1 | Version Tracking | V1.0.2 | Waiting | — | — | |
| E2 | Update Workflow | V1.0.3 | Waiting | — | — | Highest risk — backup before testing |

---

## Roadmap Amendments

_No amendments recorded._

> When an amendment is raised, append it here using the format below.
> Do not edit the roadmap. Do not edit completed phase entries above.

```
### RA-001 — [Title]

**Date:** YYYY-MM-DD  
**Affects:** Phase [X]  
**Approved by:** Tom  

**Why:** [What was discovered; what assumption failed.]  
**Change:** [Exactly what is different from the roadmap specification.]  
**Impact on other phases:** [Any downstream effects.]
```

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

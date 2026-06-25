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

# ADR-011 — Current State Inventory

**Phase:** Phase 0 — Architecture Audit  
**Version:** V0.9.18  
**Date:** 2026-06-26  
**Status:** Complete  
**Produced by:** Phase 0 implementation — no code was changed to produce this document.

> This document is a factual inventory of the codebase at V0.9.17.
> It contains no recommendations and no redesign.
> It is the authoritative input for Phases A1, A2, B1, D1, D2, D3, and D4.
> Findings from the Phase Review are recorded in §7.

---

## §1 — MODULE_REGISTRY Consumers

**Definition location:** `sanity.config.ts`, lines 127–248 (inline `const` inside the `structure` async function).

The `MODULE_REGISTRY` identifier exists in exactly **two files**. Only one is a true consumer.

| File | Nature | Detail |
|---|---|---|
| `sanity.config.ts` | **Defines and consumes** | Inline definition + three internal usages |
| `src/lib/sanity/fields/ProjectLinker.tsx` | **NOT a consumer** | Contains a parallel copy (`MODULE_LABELS`) with a "Keep in sync" comment — see §7, Finding 1 |

### Usages within `sanity.config.ts`

| Line | Function | What it does |
|---|---|---|
| 134 | — | Defines `MODULE_REGISTRY` as a local `const ModuleDef[]` |
| 291 | `buildPagesItems()` | `MODULE_REGISTRY.filter((m) => enabledModules.includes(m.id))` — filters to enabled modules; iterates to build Pages section items for module singleton pages |
| 330 | `buildCollectionsItems()` | Same filter — iterates to build Collections section items from each module's `collectionItems` lambda |
| 383 | Comment only | "Grouped by module — add new modules to MODULE_REGISTRY above" |

### Current `ModuleDef` shape

```typescript
type ModuleDef = {
  id: string
  label: string          // canonical Studio label — Admin UI concern
  pageType: string       // Sanity document type for the singleton page
  collectionItems: (slug: string) => ReturnType<typeof S.listItem>[]
}
```

### Registered modules

| id | label | pageType | Collections |
|---|---|---|---|
| `blog` | Blog | `blogPage` | Posts, Categories, Authors (nested) |
| `events` | Events | `eventsPage` | Events (nested) |
| `live` | Live | `livePage` | None (`collectionItems: () => []`) |

---

## §2 — `enabledModules` Consumers

`enabledModules` is a `string[]` field on the `project` Sanity document. It is the sole mechanism by which the platform knows which modules are active for a given project.

**Consumer inventory — exhaustive:**

| File | Line(s) | Nature | Detail |
|---|---|---|---|
| `src/lib/sanity/schema.ts` | 1680 | **Schema definition** | `defineField({ name: 'enabledModules', type: 'array', of: [string], hidden: true })` |
| `sanity.config.ts` | 37 | **TypeScript type annotation** | Interface for GROQ result: `enabledModules: string[]` |
| `sanity.config.ts` | 49 | **GROQ projection** | `"enabledModules": coalesce(enabledModules, [])` inside the client/project fetch query |
| `sanity.config.ts` | 264 | **Function parameter** | `buildPagesItems(slug, enabledModules, pageDocs)` — parameter declaration |
| `sanity.config.ts` | 291 | **Runtime read** | `MODULE_REGISTRY.filter((m) => enabledModules.includes(m.id))` in `buildPagesItems` |
| `sanity.config.ts` | 329 | **Function parameter** | `buildCollectionsItems(slug, enabledModules)` — parameter declaration |
| `sanity.config.ts` | 330 | **Runtime read** | `MODULE_REGISTRY.filter((m) => enabledModules.includes(m.id))` in `buildCollectionsItems` |
| `sanity.config.ts` | 353 | **Runtime read** | `const enabledModules = project.enabledModules` in the project loop |
| `sanity.config.ts` | 376 | **Pass-through** | Passed to `buildPagesItems()` |
| `src/lib/sanity/fields/ProjectLinker.tsx` | 31 | **TypeScript interface field** | `enabledModules?: string[]` in the `ProjectDocument` interface |
| `src/lib/sanity/fields/ProjectLinker.tsx` | 351 | **Display read** | `{doc.enabledModules && doc.enabledModules.length > 0 ? ...}` |
| `src/lib/sanity/fields/ProjectLinker.tsx` | 353 | **Display iteration** | `{doc.enabledModules.map((mod) => ...)}` — renders module badges using `MODULE_LABELS` |

**Confirmed zero consumers:**
- `src/lib/sanity/queries.ts` — no references
- `src/app/api/` — no references
- `src/app/[locale]/(admin)/` — no references
- `src/app/[locale]/(client)/` — no references
- `src/app/[locale]/(website)/` — no references

**Conclusion:** `enabledModules` is consumed exclusively in the Studio layer — the schema definition, the Studio structure builder (`sanity.config.ts`), and the `ProjectLinker` custom input component. It has no presence in the frontend rendering pipeline or API routes.

---

## §3 — SectionRenderer Inventories

Two `SectionRenderer` functions exist. They must be kept in sync. Both have **13 cases**.

**File A:** `src/app/[locale]/(website)/[tenant]/page.tsx` (home page and general pages)  
**File B:** `src/app/[locale]/(website)/[tenant]/[slug]/page.tsx` (slug-routed pages)

| # | `_type` | Component | File A | File B | Parity |
|---|---|---|---|---|---|
| 1 | `heroSection` | `HeroSection` | ✅ | ✅ | Matched |
| 2 | `heroLiveCaptureSection` | `HeroLiveCaptureSection` | ✅ | ✅ | Matched |
| 3 | `heroLensSection` | `HeroLensSection` | ✅ | ✅ | Matched |
| 4 | `contentSection` | `ContentSection` | ✅ | ✅ | Matched |
| 5 | `statementSection` | `StatementSection` | ✅ | ✅ | Matched |
| 6 | `treatmentsSection` | `TreatmentsSection` | ✅ | ✅ | Matched |
| 7 | `teamSection` | `TeamSection` | ✅ | ✅ | Matched |
| 8 | `textSection` | `TextSection` | ✅ | ✅ | Matched |
| 9 | `faqSection` | `FAQSection` | ✅ | ✅ | Matched |
| 10 | `contactSection` | `ContactSection` | ✅ | ✅ | Matched |
| 11 | `blogListingSection` | `BlogListingSection` | position 11 | position 12 | **Order differs** |
| 12 | `formSection` | `FormSection` | position 12 | position 11 | **Order differs** |
| 13 | `metricsSection` | `MetricsSection` | ✅ | ✅ | Matched |

**Note on order difference:** The `blogListingSection` and `formSection` cases are swapped between the two files. Switch statement evaluation is order-independent for `_type` matching; this has no functional impact. It is recorded here so Phase D2 resolves it to a canonical order.

**`default` branch:** Both files return `null` for unrecognised `_type` values. No error is thrown.

### SectionRenderer component signatures (both files — identical)

```typescript
function SectionRenderer({
  section, siteConfig, designSystem, backgroundPattern,
  sectionIndex, locale, tenantSlug, fromParam
})
```

### Extra props per section (beyond the standard `section`, `surface`, `designSystem`)

| Section | Extra props |
|---|---|
| `contactSection` | `siteConfig`, `locale` |
| `blogListingSection` | `locale`, `tenantId` (tenantSlug), `fromParam` |
| `formSection` | `locale`, `tenantSlug` |
| All others | None |

---

## §4 — Module-Owned Schema Types

All type definitions live in `src/lib/sanity/schema.ts`. The full export array (`schemaTypes`) contains **63 entries**. Classification below.

### Blog module

| Const name | Sanity `_type` name | Kind |
|---|---|---|
| `blogListingSectionType` | `blogListingSection` | Section (object) |
| `blogPageType` | `blogPage` | Singleton page (document) |
| `postAuthorType` | `postAuthor` | Collection document |
| `blogCategoryType` | `blogCategory` | Collection document |
| `postType` | `post` | Collection document |

### Events module

| Const name | Sanity `_type` name | Kind |
|---|---|---|
| `eventsPageType` | `eventsPage` | Singleton page (document) |
| `eventType` | `event` | Collection document |

### Live module

| Const name | Sanity `_type` name | Kind |
|---|---|---|
| `heroLiveCaptureSectionType` | `heroLiveCaptureSection` | Section (object) |
| `heroLensSectionType` | `heroLensSection` | Section (object) |
| `livePageType` | `livePage` | Singleton page (document) |

### Platform-owned (not module)

Primitive / localization types, platform infrastructure types, design system types, and sections with no module owner:

**Localization primitives:** `localizedString`, `localizedText`, `localizedPortableText`, `localizedSlug`, `redirectFrom`, `localizedImage`

**Shared UI atoms:** `cta`, `navigationLink`, `socialLink`, `scheduleItem`, `whatsappSubject`, `emailSubject`

**Platform sections (no module):** `heroSection`, `contentSection`, `statementSection`, `treatmentsSection` (+ `treatmentCard`), `teamSection` (+ `teamMember`), `textSection`, `faqSection` (+ `faqItem`), `contactSection`, `metricsSection` (+ `metricItem`), `formSection` (+ `form`, `formFieldItem`, `formOptionItem`)

**Platform documents:** `client`, `project`, `mediaAsset`, `siteConfig`, `page`, `homePage` (legacy — see §7)

**Design system types:** `designSystem`, `colorTheme`, `fontDefinition`, `typescale`, `buttonStyle`, `buttonStyleTheme`, `cardStyleTheme`, `cardVariant`, `motion`, `formInputTheme`, `formInput`, `formTypography`, `formGeometry`, `glassStyle`, `sectionSurfacesTheme`, `sectionSurfaces`, `backgroundAsset`

### Ambiguous ownership

| Type | Why ambiguous |
|---|---|
| `heroLiveCaptureSection`, `heroLensSection` | Logically owned by the Live module but registered in SectionRenderer for **all tenants** regardless of Live installation — see §7, Finding 4 |
| `blogListingSection` | Logically owned by the Blog module but registered in SectionRenderer for **all tenants** regardless of Blog installation — see §7, Finding 4 |
| `formSection`, `form`, `formFieldItem`, `formOptionItem` | Platform behaviour (no module registration in `MODULE_REGISTRY`) but arguably module-like — see §7, Finding 5 |
| `metricsSection`, `metricItem` | Same as above — not module-registered |

---

## §5 — Module-Owned Collections

Collections are the sub-lists contributed by each module to the Studio Collections section. They are currently defined as `collectionItems` lambdas inside `MODULE_REGISTRY` in `sanity.config.ts`.

### Blog module collections

The blog module contributes **one top-level collection group** containing three sub-lists:

```
Blog (group)
  ├── Posts
  │     schemaType:   'post'
  │     filter:       _type == "post" && projectSlug == $slug
  │     ordering:     featured desc, publishedAt desc
  │     initTemplate: postProjectOwned
  ├── Categories
  │     schemaType:   'blogCategory'
  │     filter:       _type == "blogCategory" && projectSlug == $slug
  │     initTemplate: blogCategoryProjectOwned
  └── Authors
        schemaType:   'postAuthor'
        filter:       _type == "postAuthor" && projectSlug == $slug
        initTemplate: postAuthorProjectOwned
```

**Structure note:** The blog module's `collectionItems` lambda produces a nested `S.list()` — the "Blog" label is an intermediate list wrapper, not a direct document list. This two-level nesting is more expressive than a flat `ModuleCollectionDef` can represent. Phase D3 will need the escape hatch (`customCollectionItems`) for this module unless `ModuleCollectionDef` is extended to support grouped sub-lists.

### Events module collections

```
Events (group)
  └── Events
        schemaType:   'event'
        filter:       _type == "event" && projectSlug == $slug
        ordering:     startDate desc
        initTemplate: eventProjectOwned
```

**Structure note:** Same nested `S.list()` pattern as Blog — one intermediate wrapper, one document list inside.

### Live module collections

None. `collectionItems: () => []`

### Initial value templates

All templates are registered in `schema.ts` (bottom of file). Module-related templates:

| Template ID | Schema type | Parameters |
|---|---|---|
| `postProjectOwned` | `post` | `projectSlug` |
| `postAuthorProjectOwned` | `postAuthor` | `projectSlug` |
| `blogCategoryProjectOwned` | `blogCategory` | `projectSlug` |
| `eventProjectOwned` | `event` | `projectSlug` |
| `livePageProjectOwned` | `livePage` | `projectSlug` |
| `eventsPageProjectOwned` | `eventsPage` | `projectSlug` |
| `blogPageProjectOwned` | `blogPage` | `projectSlug` |

---

## §6 — Module-Implied Permissions

`src/lib/permissions.ts` contains **10 permission functions**. All are **platform-wide role checks** — none are scoped to a module or conditioned on module installation. No module-specific permissions exist anywhere in the codebase today.

### Current permission functions

| Function | Roles granted | Platform category |
|---|---|---|
| `canEditContent` | owner, editor | Content |
| `canManageMedia` | owner, editor | Content |
| `canViewLeads` | owner, editor, viewer | Leads |
| `canUpdateLeads` | owner, editor | Leads |
| `canViewAnalytics` | owner, editor, viewer | Analytics |
| `canViewSettings` | owner | Settings |
| `canManageSettings` | owner | Settings |
| `canInviteUsers` | owner | Users |
| `canManageUsers` | owner | Users |
| `canViewBilling` | owner | Billing |

### Implicit module-action → permission mapping (today)

The following module actions are implicitly covered by existing platform permissions, with no module-scoping:

**Blog module:**
| Action | Current permission | Roles |
|---|---|---|
| Create / edit / publish post | `canEditContent` | owner, editor |
| Delete post | `canEditContent` | owner, editor |
| Manage categories | `canEditContent` | owner, editor |
| Manage authors | `canEditContent` | owner, editor |

**Events module:**
| Action | Current permission | Roles |
|---|---|---|
| Create / edit / publish event | `canEditContent` | owner, editor |
| Delete event | `canEditContent` | owner, editor |

**Live module:**
| Action | Current permission | Roles |
|---|---|---|
| Configure live page | `canEditContent` | owner, editor |
| Set featured event | `canEditContent` | owner, editor |

**Conclusion for Phase D4:** No module permissions currently exist. Every permission declared in Phase A2 manifests and wired in Phase D4 will be a net-new declaration. There is no existing permission to migrate — only new ones to add.

---

## §7 — Hidden Coupling

This section records coupling that was not documented anywhere in the codebase and was found by systematic search. Findings from the Phase Review are included and expanded.

---

### Finding 1 — `MODULE_LABELS` in `ProjectLinker.tsx` duplicates registry labels

**File:** `src/lib/sanity/fields/ProjectLinker.tsx`, lines 36–41  
**Nature:** Silent parallel registry

```typescript
// Keep in sync with MODULE_REGISTRY in sanity.config.ts.
// ADR-011 will replace this read-only display with full module management.
const MODULE_LABELS: Record<string, string> = {
  blog: 'Blog',
  events: 'Events',
  live: 'Live',
}
```

`ProjectLinker.tsx` cannot import `MODULE_REGISTRY` (it is defined inside a closure in `sanity.config.ts`). It maintains its own copy of module labels under a "Keep in sync" comment. Adding a new module requires updating both locations. Phase A1 (Registry Relocation) must also update this file — it cannot use the old label copy once the registry is extracted. `ProjectLinker.tsx` must be updated to import labels from the new `src/lib/modules/registry.ts`. The file-list in the A1 roadmap entry does not include `ProjectLinker.tsx`; this is a known gap to carry into the A1 Phase Review.

---

### Finding 2 — Module-owned dedicated routes exist outside SectionRenderer

**Nature:** Second frontend surface, not captured in SectionRenderer inventory

Each module owns one or more dedicated Next.js routes that render module content independently of the section-based page model. These routes are separate from SectionRenderer and are not gated by any module-installation check (see Finding 3).

| Module | Route | File |
|---|---|---|
| Blog | `/[locale]/[tenant]/blog` | `src/app/[locale]/(website)/[tenant]/blog/page.tsx` |
| Blog | `/[locale]/[tenant]/blog/[slug]` | `src/app/[locale]/(website)/[tenant]/blog/[slug]/page.tsx` |
| Events | `/[locale]/[tenant]/events` | `src/app/[locale]/(website)/[tenant]/events/page.tsx` |
| Events | `/[locale]/[tenant]/events/[slug]` | `src/app/[locale]/(website)/[tenant]/events/[slug]/page.tsx` |
| Live | `/[locale]/[tenant]/live` | `src/app/[locale]/(website)/[tenant]/live/page.tsx` |

These routes are part of each module's frontend Definition but are not touched by Phases D1–D4 (which address schema, section map, navigation, and permissions). They remain as-is until a future "Route Derivation" phase (outside the current roadmap).

---

### Finding 3 — Dedicated routes have no module-installation guard

**Nature:** Routes accessible regardless of `enabledModules`

Confirmed by search: **none** of the five module-owned routes in Finding 2 read `enabledModules` or perform any check that the relevant module is installed for the tenant. A tenant without the Blog module installed can still receive requests to `/[locale]/[tenant]/blog`. Today this results in an empty-state render (no posts), not a 404. This is not a blocker for any ADR-011 phase but is a runtime correctness gap to document for a future phase.

---

### Finding 4 — Module section types are registered in SectionRenderer for all tenants

**Nature:** Section types available globally; not gated by module installation

The following section types owned by specific modules are present in both SectionRenderer switch statements for every tenant:

| Section type | Owning module | Behaviour if module not installed |
|---|---|---|
| `heroLiveCaptureSection` | Live | Renders if placed on a page; no guard |
| `heroLensSection` | Live | Same |
| `blogListingSection` | Blog | Renders (with `BlogListingSection`); fetches posts — returns empty if no posts exist |

**Implication for Phase D2:** When Phase D2 builds the derived section map, all three of these types must remain available globally (matching current behaviour). Section-map entries should not be filtered by installation state at the SectionRenderer level — that would be a behaviour change requiring a Roadmap Amendment. Phase D2 derives the map; it does not add installation-state gating.

---

### Finding 5 — `formSection` and `metricsSection` have no module owner

**Nature:** Section types with no MODULE_REGISTRY entry

`formSection` (and its associated `form`, `formFieldItem`, `formOptionItem` types) and `metricsSection` (and `metricItem`) exist as fully functional section types in both SectionRenderers but are not registered in any module. They are platform sections. Phase A2 should classify them explicitly — either as entries in a reserved `core` or `platform` manifest, or documented as platform-owned sections handled separately from the module system. This decision should be made at Phase A2, not left implicit.

---

### Finding 6 — Cross-module schema reference: `blogListingSection` references `event` type

**Nature:** Schema-level cross-module coupling; first concrete instance of Risk 5

`blogListingSectionType` (Blog module) contains a field:

```typescript
defineField({
  name: 'event',
  type: 'reference',
  to: [{ type: 'event' }],       // 'event' is owned by the Events module
  hidden: ({ parent }) => parent?.filterMode !== 'byEvent',
})
```

A blog listing section can be filtered "By Event" by referencing an `event` document. This is cross-module store access at the schema level: the Blog module's schema directly references the Events module's document type. This is the first recorded instance of the risk the roadmap names as Risk 5 ("cross-module store access"). It is a pre-existing condition, not introduced by ADR-011. It should be recorded and monitored; resolution is future work.

---

### Finding 7 — `event` type is cross-referenced from the Live module's queries

**Nature:** Cross-module query coupling

`currentLiveEventQuery` (used by `live/page.tsx`) queries `_type == "event"` directly. `livePageQuery` dereferences `featuredEvents[]->` which resolves to `event` documents. The Live module's data surface depends on the Events module's document type in `queries.ts`. This is the same cross-module store access pattern as Finding 6, at the query layer.

---

### Finding 8 — Cloudflare account constant duplicated across two module routes

**Nature:** Configuration value duplicated without a shared source

```typescript
// events/page.tsx, line 17
const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'

// live/page.tsx, line 11
const CLOUDFLARE_ACCOUNT = 'customer-aayaptcudal3r1fx'
```

The Cloudflare Stream account identifier is hardcoded in both `events/page.tsx` and `live/page.tsx` independently. If it changes, both files must be updated. This is a configuration coupling issue unrelated to ADR-011 but recorded here as a pre-existing condition.

---

### Finding 9 — `homePage` legacy type is not in MODULE_REGISTRY

**Nature:** Orphaned singleton page type

`homePageType` (`_type: 'homePage'`) exists in `schema.ts` and has initial value templates, GROQ queries (`homePageQuery`, referenced as legacy in `queries.ts` line 569), and Studio wiring. It is distinct from `pageType` (`_type: 'page'`), which is the current platform-standard home page type. `homePage` is not registered in `MODULE_REGISTRY` and is not treated as a module page. It is recorded here as a legacy type that Phase D1 must explicitly classify as platform-owned (not module-owned) when schema derivation is implemented.

---

## Summary for Phase Leads

| Phase | Primary inputs from this audit |
|---|---|
| **A1** | §1 (registry location and sole consumer); §7 Finding 1 (`MODULE_LABELS` in `ProjectLinker.tsx`) |
| **A2** | §3 (section types for `sectionTypes` field); §4 (schema types for `schemaTypes` field); §6 (permission definitions for `permissions` field); §7 Finding 5 (classifying `formSection` and `metricsSection`) |
| **B1** | §2 (complete consumer list; every file that reads `enabledModules`) |
| **D1** | §4 (module-owned vs platform-owned type classification; `homePage` legacy status from §7 Finding 9) |
| **D2** | §3 (all 13 section types, components, and extra props; order discrepancy; §7 Finding 4 — global availability must be preserved) |
| **D3** | §5 (collection structure, nesting pattern, all filter strings, ordering, templates; §5 note on two-level nesting requiring escape hatch in D3) |
| **D4** | §6 (all implicit permissions mapped; confirms these are net-new declarations) |

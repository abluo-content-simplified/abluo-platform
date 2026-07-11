# Config Architecture — Field Register

This document describes the platform **as it exists today** — field ownership, inheritance model, active vs legacy fields, and known bugs.
For the history of *why* decisions were made, see [`docs/architecture-decisions.md`](./architecture/architecture-decisions.md).

---

This document is the living record of the Abluo configuration architecture.
It tracks every field in `siteConfig` and `designSystem`, how it is used,
and the migration plan for fields that are in the wrong place.

---

## Core CMS Principles

> **Pages own presentation. Collections own data. Modules own capabilities.**

These four rules govern how content is modelled in Sanity. They apply to every document type, every route, and every new module. See ADR-009 for the full rationale.

### Rule 1 — Every public route has exactly one singleton Page document

A route that renders content but has no corresponding editable Sanity document is a gap.

Every public URL must have a document that controls its hero, intro text, and SEO:

| Route | Document type |
|---|---|
| `/` | `page` (Home) |
| `/blog` | `blogPage` |
| `/events` | `eventsPage` |
| `/live` | `livePage` |
| `/privacy-policy` | `page` |
| `/terms` | `page` |
| `/about` | `page` |
| `/contact` | `page` |

When you add a new public route, create its Page document before shipping the route.

### Rule 2 — Pages and Collections are different concepts

**Pages** are website routes. Each one maps to a URL.

**Collections** are reusable content that pages display.

```
Pages
  Home, Blog, Events, Live, Privacy Policy, Terms, Contact, About

Collections
  Posts, Categories, Authors, Events, …
```

Collections are never pages. Pages may display one or more collections. The Studio navigation reflects this split directly — every project has a **Pages** section and a **Collections** section.

### Rule 3 — Every public page has exactly one page query

Hero content, intro text, and SEO fields are never sourced from hardcoded TypeScript files.

Each page type has its own named GROQ query:

| Page | Query |
|---|---|
| Home | `homePageQuery` (via `pageHomeQuery`) |
| Blog | `blogPageQuery` |
| Events | `eventsPageQuery` |
| Live | `livePageQuery` |

Hardcoded strings are acceptable **only** as a graceful fallback while a new Sanity document is being created for a tenant. They must never be the primary source of page content.

### Rule 4 — Collections are grouped by module

A *module* is a self-contained capability that owns its pages, collections, queries, frontend behaviour, and future permissions.

Collections in the Studio are organised under their owning module:

| Module | Pages | Collections |
|---|---|---|
| Blog | Blog Page | Posts, Categories, Authors |
| Events | Events Page | Events |
| Live | Live Page | — |

Future modules follow the same pattern. Adding a new module means adding a module sub-group to Collections — not expanding a flat list.

See ADR-009 for the future module provisioning workflow.

---

## Architectural Boundary

| Concern | Document | Who manages |
|---|---|---|
| Business identity | `siteConfig` | Abluo admin + client |
| Visual language | `designSystem` | Abluo admin only |

### Rule

> **If a field describes who the client is → `siteConfig`.**
> **If a field describes how the site looks → `designSystem`.**

Fields that violate this boundary are tracked in the Duplication Register below.

---

## Design System Inheritance Categories

All DS fields belong to exactly one inheritance category (ADR-008). The category determines the merge strategy in `mergeDesignSystems()`. When adding a new field, pick the correct category first — the canonical helper follows automatically.

| Category | Merge strategy | Canonical helper | Examples |
|---|---|---|---|
| **LOCAL ONLY** | Never inherited — parent value permanently ignored | None (assign child value directly) | `branding.logo`, `branding.favicon`, `branding.openGraphImage` |
| **PRIMITIVE STRING** | Child non-empty string wins; else parent | `\|\|` | Color values, easing strings, DS `name`/`role` |
| **PRIMITIVE NUMBER** | Child non-undefined wins (`0` is a valid override) | `!== undefined` ternary | Radius, spacing, durations, `logoHeightDesktop` |
| **DISCRIMINATED** | Validity guard before treating object as "set" | `isFontDefined()` | `typography.headingFont`, `typography.bodyFont` |
| **FLAT MERGE** | Field-by-field — each primitive field inherits independently | `mergeShallowObject<T>` | Typescale (h1–small), ColorTheme, GlassStyle, FormInputTheme |
| **THEME PAIR** | Apply FLAT MERGE to `lightTheme` and `darkTheme` independently | Dedicated wrapper calling `mergeShallowObject` | `colors`, `buttons.primary`, `sectionSurfaces`, all form inputs |
| **KEYED ARRAY** | Parent baseline; child overrides by `.key` or appends | `mergeArrayByKey<T>` | `backgroundAssets`, `cardVariants` |

**The overarching rule:** A partial child object must not shadow a complete parent object. Object-typed fields must never use `||` at the object level — any truthy child object (even incomplete) would discard the parent's full definition.

### Adding a new DS field — category checklist

1. Decide the category (table above)
2. Add field to `designSystem` type in `schema.ts`
3. Add field to `DS_FIELDS_SELECTION` in `queries.ts`
4. Add merge logic in `mergeDesignSystems()` using the canonical helper for the category
5. Add CSS variable output in `buildCssVars()` in `layout.tsx` (or document it as `🚧 Planned`)
6. Add inheritance test in `design-system-resolver.test.ts`

---

## siteConfig Field Register

### Branding group

| Field | Type | Status | Notes |
|---|---|---|---|
| `siteName` | string | ✅ Active | Site name, shown in nav fallback and metadata |
| `tagline` | localizedString | ✅ Active | Fallback for meta description |
| `logo` | localizedImage | ✅ Active | Header logo (dark theme) |
| `logoLight` | localizedImage | ✅ Active | Header logo (light theme) |
| `faviconSvg` | image | ✅ Active | Favicon — SVG preferred |
| `faviconPng` | image | ✅ Active | Favicon — PNG fallback |
| `openGraphImage` | image | ✅ Active | Default og:image for all pages |
| `appleTouchIcon` | image | ✅ Active | iPhone/iPad home screen icon |
| `logoHeightDesktop` | number | ✅ Active | CSS var `--logo-height-desktop` |
| `logoHeightMobile` | number | ✅ Active | CSS var `--logo-height-mobile` |
| `backgroundGraphic` | object | ✅ Active | Brand watermark behind page content |

### SEO Defaults group

| Field | Type | Status | Notes |
|---|---|---|---|
| `seoDefaultTitle` | localizedString | ✅ Active | Overrides `siteName` in `<title>` |
| `seoDefaultDescription` | localizedText | ✅ Active | Overrides `tagline` in meta description |

### Site Controls group

| Field | Type | Status | Notes |
|---|---|---|---|
| `headerAppearance` | object | ✅ Active | Sticky, scroll style, height, blur, etc. |
| `languageSwitcherPlacement` | string | ✅ Active | header / footer / both |
| `themeMode` | string | ✅ Active | lightOnly / darkOnly / toggle / system |
| `themeSwitcherPlacement` | string | ✅ Active | header / footer / both |
| `showLangSwitcherInNav` | boolean | ✅ Active | Livener-specific nav control |

### Languages group

| Field | Type | Status | Notes |
|---|---|---|---|
| `defaultLocale` | string | ✅ Active | Drives GROQ `$defaultLocale` |
| `supportedLocales` | array | ✅ Active | Drives locale switcher and hreflang |

### Navigation group

| Field | Type | Status | Notes |
|---|---|---|---|
| `navLinks` | array | ✅ Active | Top-level nav items |
| `ctaLabel` | localizedString | ✅ Active | Primary nav CTA label |
| `ctaHref` | string | ✅ Active | Primary nav CTA href |

### Contact group

| Field | Type | Status | Notes |
|---|---|---|---|
| `phone` | string | ✅ Active | Shown in header and footer |
| `email` | string | ✅ Active | Shown in footer |
| `address` | string | ✅ Active | Shown in footer |
| `legalName` | string | ✅ Active | For JSON-LD and footer |
| `legalAddress` | string | ✅ Active | For JSON-LD |
| `registrationInfo` | string | ✅ Active | Company registration number |
| `foundedYear` | number | ✅ Active | For JSON-LD |

### Footer group

| Field | Type | Status | Notes |
|---|---|---|---|
| `footerLinks` | array | ✅ Active | Footer navigation links |
| `footerCtaHeading` | localizedString | ✅ Active | Footer CTA block heading |
| `footerCtaSubtext` | localizedString | ✅ Active | Footer CTA block subtext |
| `footerCtaInputPlaceholder` | localizedString | ✅ Active | Email input placeholder |
| `footerCtaButtonLabel` | localizedString | ✅ Active | CTA button label |

### Social group

| Field | Type | Status | Notes |
|---|---|---|---|
| `socialLinks` | array | ✅ Active | `[{ platform, url }]` — replaces legacy `youtubeChannelUrl` |
| `youtubeChannelUrl` | string | ⚠️ Legacy | Replaced by `socialLinks`. Remove after migration confirmed. |

### Integrations group

| Field | Type | Status | Notes |
|---|---|---|---|
| `analyticsEnabled` | boolean | ✅ Active | Default `false` — master switch; unless strictly `true`, `TrackingScripts` renders nothing (GA4/GTM/Pixel/custom, both placements). Verification meta tags are exempt (see ADR-013). |
| `consentModeEnabled` | boolean | ✅ Active | Default `false` — when `true` and no valid consent exists, fails closed on GA4/GTM/Meta Pixel and `analytics`/`marketing`/`functional` custom scripts; only `necessary` customs still load (see ADR-013). |
| `googleAnalyticsId` | string | ✅ Active | GA4 ID (format: `G-[A-Z0-9]+`) |
| `googleTagManagerId` | string | ✅ Active | GTM ID (format: `GTM-…`) |
| `googleSiteVerification` | string | ✅ Active | Google Search Console verification token |
| `bingSiteVerification` | string | ✅ Active | Bing Site Verification token (msvalidate.01) |
| `metaPixelId` | string | ✅ Active | Meta Pixel ID (numeric) |
| `customScripts` | array | ✅ Active | `[{ label, description, placement: head\|bodyEnd, code, consentCategory, enabled }]` — platform-managed only; `enabled` defaults to `false`; `analytics`/`marketing` `consentCategory` items are consent-gated (see ADR-013) |

### Integration Registry (ADR-014, Phase A)

Per ADR-014 (Accepted), `src/lib/integrations/` is now the single source of truth for integration definitions — the table above (`siteConfig.integrations`) remains authoritative for **runtime consumption** until Phase C's frontend switchover. Sanity schema for integration values is **generated**, not hand-projected: `buildIntegrationSchemaTypes()` builds the per-integration types and `buildIntegrationConfigsField()` builds the `integrationConfigs` array field on the `project` document (hidden until Phase B's `IntegrationsPane`). `validateIntegrationRegistry` guards the registry at load time, mirroring the Module Registry pattern (ADR-011).

Phase A manifests registered in `INTEGRATION_REGISTRY`: `google-analytics`, `google-tag-manager`, `meta-pixel`, `custom-scripts`.

**Adding a new integration** is registering one manifest file under `src/lib/integrations/manifests/` and adding it to `INTEGRATION_REGISTRY` (`src/lib/integrations/registry.ts`) — schema, validation, and (from Phase B) the Studio form all derive from it.

See ADR-014 for the full design rationale, Studio IA, and phasing — not duplicated here.

---

## designSystem Field Register

### Branding

| Field | Type | Inheritance | CSS Output | Status |
|---|---|---|---|---|
| `logo` | image | LOCAL ONLY | none (layout reads directly) | ✅ Active |
| `logoLight` | image | LOCAL ONLY | none | ✅ Active |
| `logoHeightDesktop` | number | INHERIT | `--logo-height-desktop` (via siteConfig override) | ✅ Active |
| `logoHeightMobile` | number | INHERIT | `--logo-height-mobile` (via siteConfig override) | ✅ Active |
| `favicon` | image | LOCAL ONLY | none | ✅ Active |
| `openGraphImage` | image | LOCAL ONLY | none | ✅ Active |
| `appleTouchIcon` | image | LOCAL ONLY | none | ✅ Active |

### Colors

| Field | Status | CSS Output |
|---|---|---|
| `colors.lightTheme.*` | ✅ Active | `--color-*` in `html.light` |
| `colors.darkTheme.*` | ✅ Active | `--color-*` in `:root` |

### Typography

| Field | Status | CSS Output |
|---|---|---|
| `typography.headingFont` | ✅ Active | `--font-heading`, Google Fonts URL |
| `typography.bodyFont` | ✅ Active | `--font-body`, Google Fonts URL |
| `typography.h1–h4` | ✅ Active | `--typo-h1` etc. |
| `typography.bodyLarge` | ✅ Active | `--typo-body-large` |
| `typography.body` | ✅ Active | `--typo-body` |
| `typography.small` | ✅ Active | `--typo-small` |

### Shape & Spacing

| Field | Status | CSS Output |
|---|---|---|
| `radius.small/medium/large` | ✅ Active | `--radius-sm/md/lg` |
| `spacing.*` | 🚧 Planned | No CSS output yet |

### Motion

| Field | Status | CSS Output |
|---|---|---|
| `motion.durationFast/Base/Slow/Slower` | ✅ Active | `--motion-duration-*` |
| `motion.easingStandard/Decelerate/Accelerate/Emphasized` | ✅ Active | `--motion-easing-*` |

### Buttons

| Field | Status | CSS Output |
|---|---|---|
| `buttons.primary.*` | ✅ Active | Consumed by `ButtonDS` component |
| `buttons.secondary.*` | ✅ Active | Consumed by `ButtonDS` component |
| `buttons.primary.borderRadius` | ⚠️ Bug | `--radius-btn` hardcoded to `12px` — not reading this field |

### Section Surfaces

| Field | Status | CSS Output |
|---|---|---|
| `sectionSurfaces.lightTheme.*` | ✅ Active | `--color-section-*` in `html.light` |
| `sectionSurfaces.darkTheme.*` | ✅ Active | `--color-section-*` in `:root` |
| `sectionSurfaces.*.glass` | ⚠️ Partial | Requires BOTH `borderWidth` AND `borderColor` — see known bugs |

### Forms

| Field | Status | CSS Output |
|---|---|---|
| `forms.input/textarea/select/checkbox/radio` | ✅ Active | `--form-*` per element type |
| `forms.typography` | ✅ Active | `--form-label-*`, `--form-help-*` etc. |
| `forms.geometry` | ✅ Active | `--form-input-height`, `--form-padding-*` etc. |

### Dead / Unused Fields

| Field | Status | Notes |
|---|---|---|
| `shadows.card/dropdown/modal` | 🗑️ Candidate | Resolved by resolver, no CSS var emitted, no component reads |
| `navigation.*` | 🗑️ Candidate | Resolved, no CSS var, no component reads |
| `glass` (top-level) | 🗑️ Candidate | Different from `sectionSurfaces.*.glass` — no consumer |
| `cards.lightTheme/darkTheme` | ⚠️ Legacy | Single-variant; replaced by `cardVariants` |
| `cardVariants` | 🚧 Planned | Defined, no component reads it yet |

---

## Known Bugs

| Bug | Severity | Location | Status | Fix |
|---|---|---|---|---|
| Typography partial stubs shadow parent font | Medium | DS resolver `mergeDesignSystems()` | ✅ Fixed Phase 1.1 | `isFontDefined()` guard — stub `{ source: 'library' }` with no name falls through to parent |
| `--radius-btn` hardcoded to `12px` | Medium | `buildCssVars()` in `layout.tsx` | Pending Phase 1.2 | Wire to `buttons.primary.borderRadius` |
| Glass border requires both `borderWidth` + `borderColor` | Low | `getGlassStyles()` in `surfaces.ts` | ✅ Fixed Phase 1.3 | `borderWidth` alone now works — `borderColor` falls back to `currentColor` |
| OG image in parent DS not inherited by child | Medium | DS resolver `mergeDesignSystems()` | Pending Phase 1.4 | siteConfig is the correct home — upload OG image to siteConfig |

---

## Duplication Register

| Field | In siteConfig? | In designSystem? | Correct home | Action |
|---|---|---|---|---|
| `logo` | ✅ (localizedImage) | ✅ (image) | siteConfig | Migrate DS logo → siteConfig in Phase 2 |
| `logoLight` | ✅ (localizedImage) | ✅ (image) | siteConfig | Migrate DS logoLight → siteConfig in Phase 2 |
| `logoHeightDesktop` | ✅ (new) | ✅ (exists) | siteConfig (override) | siteConfig takes precedence via `buildCssVars` |
| `logoHeightMobile` | ✅ (new) | ✅ (exists) | siteConfig (override) | siteConfig takes precedence via `buildCssVars` |
| `favicon` | ✅ (faviconSvg/Png) | ✅ | siteConfig | DS favicon kept for legacy, siteConfig takes precedence |
| `openGraphImage` | ✅ | ✅ | siteConfig | DS field kept as fallback, siteConfig takes precedence |
| `appleTouchIcon` | ✅ (new) | ✅ (exists in DS) | siteConfig | DS field is unused in metadata — siteConfig is correct home |

---

## Phase Status

| Phase | Goal | Status |
|---|---|---|
| 0 | Baseline commit — siteConfig logoHeight, appleTouchIcon, SEO defaults | ✅ Complete |
| 1 | Data fixes — typography stubs ✅, glass border ✅, radius-btn, OG image upload | 🚧 In progress |
| 2 | Identity migration — logo/favicon from DS → siteConfig | Pending |
| 3 | DS visibility contract — hide unused fields, document active fields | Pending |
| 4 | Inheritance UI — show resolved values in Studio | Pending |
| 5 | Cleanup — remove dead fields, consolidate duplicates | Pending |

---

## Migration Log

| Date | Change | Files |
|---|---|---|
| 2026-06 | `youtubeChannelUrl` → `socialLinks[]` in Livener Sanity data | schema.ts, queries.ts |
| 2026-06 | `openGraphImage` added to `DS_FIELDS_SELECTION` | queries.ts |
| 2026-06 | `logoHeightDesktop/Mobile` added to DS branding | schema.ts, queries.ts, types.ts, resolver.ts |
| 2026-06 | `appleTouchIcon`, `logoHeightDesktop/Mobile`, `seoDefaultTitle/Description` added to siteConfig | schema.ts, queries.ts, types.ts, layout.tsx |
| 2026-06 | Phase 1.1: `isFontDefined()` guard in DS resolver prevents incomplete font stubs from shadowing parent fonts | design-system-resolver.ts, resolver.test.ts |
| 2026-06 | Phase 1.2: `mergeShallowObject<Typescale>` replaces object-level `\|\|` for h1–small typescale fields | design-system-resolver.ts, resolver.test.ts |
| 2026-06 | Phase 1.3: Glass border validation fixed — `borderWidth` alone now sufficient; `borderColor` falls back to `currentColor` | surfaces.ts |
| 2026-06 | Inheritance Categories Reference added to config-architecture.md (ADR-008) | docs/config-architecture.md |

---

## Rollback Notes

All Phase 0 changes are additive — new fields with no required validation.
Rollback: revert the 5 changed files. No Sanity data migration required.

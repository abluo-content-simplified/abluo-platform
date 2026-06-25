# Abluo — Configuration Architecture
**Last updated:** 2026-06-25  
**Feature branch:** `feature/config-architecture`  
**Status:** Active refactor in progress

---

## Core Rule

> **Site Settings** answers *"Who is this business?"*  
> **Design System** answers *"How does this website look?"*

---

## Field Classification Key

| Symbol | Label | Meaning |
|---|---|---|
| ✅ | **Active** | Field is consumed by code; changing it has a visible effect |
| 🚧 | **Planned** | Field exists in schema; code is not yet wired |
| ⚠️ | **Legacy** | Field kept for backwards compatibility; superseded by another field |
| 🗑️ | **Candidate for removal** | Safe to remove after explicit approval; migration complete |
| 🔁 | **Duplicated** | Same data currently exists in both siteConfig and designSystem |

Fields marked 🚧, ⚠️, or 🗑️ should eventually have a distinct visual treatment in Studio so editors know not to rely on them.

---

## Site Settings (`siteConfig`) — Field Register

### Group: Branding

| Field | Type | Classification | Notes |
|---|---|---|---|
| `siteName` | string | ✅ Active | Used in `<title>`, og:site_name, fallback display name |
| `tagline` | localizedString | ✅ Active | Used as fallback meta description |
| `logo` | localizedImage | ✅ Active | Source of truth for logo. Livener reads from here; generic layout currently reads from DS (migration pending in Phase 2) |
| `logoLight` | localizedImage | ✅ Active | Same as logo |
| `logoHeightDesktop` | number | ✅ Active | Overrides DS branding token; emitted as `--logo-height-desktop` |
| `logoHeightMobile` | number | ✅ Active | Overrides DS branding token; emitted as `--logo-height-mobile` |
| `faviconSvg` | image | ✅ Active | Highest-priority favicon source |
| `faviconPng` | image | ✅ Active | Fallback if SVG absent |
| `appleTouchIcon` | image | ✅ Active | Wired into `<link rel="apple-touch-icon">` |
| `openGraphImage` | image | ✅ Active | Default og:image for all pages without a page-specific image |
| `backgroundGraphic` | object | ✅ Active | Brand watermark overlay — position, opacity, scroll behaviour |
| `headerAppearance` | object | ✅ Active | Sticky, transparent/glass/solid, height, shadow, z-index |

### Group: SEO Defaults *(added V0.9.10)*

| Field | Type | Classification | Notes |
|---|---|---|---|
| `seoDefaultTitle` | localizedString | ✅ Active | Fallback `<title>` for pages without a page-level SEO title |
| `seoDefaultDescription` | localizedText | ✅ Active | Fallback meta description |

### Group: Site Controls

| Field | Type | Classification | Notes |
|---|---|---|---|
| `languageSwitcherPlacement` | string enum | ✅ Active | `header` / `footer` / `both` — controls LanguageSwitcher in generic layout |
| `themeMode` | string enum | ✅ Active | `lightOnly` / `darkOnly` / `toggle` / `system` |
| `themeSwitcherPlacement` | string enum | ✅ Active | Controls ThemeSwitcher placement in generic layout |
| `showLangSwitcherInNav` | boolean | ⚠️ Legacy | Only read by Livener NavClient. Superseded by `languageSwitcherPlacement` for generic layout. Remove after Livener Nav migrates. |

### Group: Languages

| Field | Type | Classification | Notes |
|---|---|---|---|
| `defaultLocale` | string | ✅ Active | Required; used as GROQ $defaultLocale in all content queries |
| `supportedLocales` | string[] | ✅ Active | Required; drives hreflang alternates, language switcher options |

### Group: Navigation

| Field | Type | Classification | Notes |
|---|---|---|---|
| `navLinks` | navigationLink[] | ✅ Active | Used by Livener NavClient; not yet wired in generic layout header |
| `ctaLabel` | localizedString | ✅ Active | Livener NavClient CTA button label |
| `ctaHref` | string | ✅ Active | Livener NavClient CTA destination |

### Group: Contact

| Field | Type | Classification | Notes |
|---|---|---|---|
| `phone` | string | ✅ Active | Shown in generic header and ContactSection |
| `email` | string | ✅ Active | Shown in footer and ContactSection |
| `address` | text | ✅ Active | Shown in footer |
| `contactEmail` | string | 🚧 Planned | Contact form recipient. Not yet wired to any form submission handler. |
| `mobileNumber` | string | 🚧 Planned | Not queried or consumed anywhere. Reserved for future click-to-call. |
| `whatsappNumber` | string | 🚧 Planned | Not queried or consumed anywhere. Reserved for WhatsApp CTA feature. |
| `whatsappSubjects` | whatsappSubject[] | 🚧 Planned | Not queried or consumed. |
| `emailSubjects` | emailSubject[] | 🚧 Planned | Not queried or consumed. |

### Group: Footer

| Field | Type | Classification | Notes |
|---|---|---|---|
| `footerLinks` | navigationLink[] | ✅ Active | Used by Livener Footer |
| `footerCtaHeading` | localizedString | ✅ Active | Livener Footer CTA |
| `footerCtaSubtext` | localizedString | ✅ Active | Livener Footer CTA |
| `footerCtaInputPlaceholder` | localizedString | ✅ Active | Livener Footer CTA |
| `footerCtaButtonLabel` | localizedString | ✅ Active | Livener Footer CTA |
| `legalName` | string | 🚧 Planned | Not yet rendered. Reserved for footer legal line. |
| `legalAddress` | text | 🚧 Planned | Not yet rendered. |
| `registrationInfo` | string | 🚧 Planned | Not yet rendered. VAT / company registration. |
| `foundedYear` | number | 🚧 Planned | Not yet rendered. |

### Group: Social

| Field | Type | Classification | Notes |
|---|---|---|---|
| `socialLinks` | socialLink[] | 🚧 Planned | Queried but not yet rendered in any component. Supports: youtube, instagram, linkedin, facebook, x, tiktok, threads. |

---

## Design System (`designSystem`) — Field Register

### Group: Info (meta)

| Field | Type | Classification | Notes |
|---|---|---|---|
| `name` | string | ✅ Active | Studio display only |
| `role` | string enum | ✅ Active | `active` / `template` — controls Studio structure pane |
| `description` | text | ✅ Active | Studio display only |
| `projectSlug` | string | ✅ Active | `readOnly` — set by platform on DS assignment |
| `parentDesignSystem` | reference | ✅ Active | Drives `resolveDesignSystemInheritance()` |

### Group: Branding *(identity assets — LOCAL ONLY, never inherited)*

| Field | Type | Classification | Notes |
|---|---|---|---|
| `branding.logo` | image | 🔁 Duplicated → 🗑️ Candidate for removal | Target home: `siteConfig.logo`. Migration: Phase 2. Generic layout currently reads from here; will be updated to read siteConfig first. |
| `branding.logoLight` | image | 🔁 Duplicated → 🗑️ Candidate for removal | Same as logo |
| `branding.logoHeightDesktop` | number | 🔁 Duplicated → 🗑️ Candidate for removal | siteConfig already wins at runtime (Phase 2 override). Removal safe after siteConfig is populated for all tenants. |
| `branding.logoHeightMobile` | number | 🔁 Duplicated → 🗑️ Candidate for removal | Same |
| `branding.favicon` | image | 🔁 Duplicated → 🗑️ Candidate for removal | Target home: `siteConfig.faviconSvg` / `siteConfig.faviconPng`. Third-level fallback in current code. |
| `branding.openGraphImage` | image | 🔁 Duplicated → 🗑️ Candidate for removal | Target home: `siteConfig.openGraphImage`. Second-level fallback in current code. |
| `branding.appleTouchIcon` | image | 🔁 Duplicated → 🗑️ Candidate for removal | Target home: `siteConfig.appleTouchIcon`. Not currently read from DS (only siteConfig path is wired). |

### Group: Branding — Background Assets

| Field | Type | Classification | Notes |
|---|---|---|---|
| `backgroundAssets` | backgroundAsset[] | ✅ Active | Light/dark variant images used as decorative section backgrounds |

### Group: Colors

| Field | Type | Classification | Notes |
|---|---|---|---|
| `colors.lightTheme` | colorTheme | ✅ Active | 13 color tokens; all emitted as CSS variables in `html.light {}` |
| `colors.darkTheme` | colorTheme | ✅ Active | Same; emitted as CSS variables in `:root {}` |

### Group: Typography

| Field | Type | Classification | Notes |
|---|---|---|---|
| `typography.headingFont` | fontDefinition | ✅ Active | Emitted as `--font-heading`. Must have `libraryFont` or `googleFont` set — a stub `{ source: 'library' }` with no name causes silent fallback to 'Barlow Condensed'. |
| `typography.bodyFont` | fontDefinition | ✅ Active | Emitted as `--font-body`. Same stub risk. |
| `typography.h1` – `typography.small` | typescale | ✅ Active | Emitted as `--typo-h1` etc. and `--font-size-h1` etc. Only emitted when fields are set. |

### Group: Shape & Spacing

| Field | Type | Classification | Notes |
|---|---|---|---|
| `radius.small` | number | ✅ Active | Emitted as `--radius-sm` |
| `radius.medium` | number | ✅ Active | Emitted as `--radius-md` |
| `radius.large` | number | ✅ Active | Emitted as `--radius-lg` |
| `spacing.*` | number (5 fields) | 🚧 Planned | Fetched and resolved; not yet emitted as CSS variables. Reserved for future spacing token system. |

### Group: Motion

| Field | Type | Classification | Notes |
|---|---|---|---|
| `motion.durationFast` | number | ✅ Active | Emitted as `--motion-duration-fast`. Used by FAQSection accordion, form field transitions. Falls back to 120ms. |
| `motion.durationBase` | number | ✅ Active | Emitted as `--motion-duration-base`. Falls back to 200ms. No JS component reads it directly yet. |
| `motion.durationSlow` | number | ✅ Active | Emitted as `--motion-duration-slow`. Used by 8+ section components via JS prop. Falls back to 350ms. |
| `motion.durationSlower` | number | ✅ Active | Emitted as `--motion-duration-slower`. Used by hero sections. Falls back to 600ms. |
| `motion.easingStandard` | string | ✅ Active | Emitted as `--motion-easing-standard`. Used by form field transitions. |
| `motion.easingDecelerate` | string | ✅ Active | Emitted as `--motion-easing-decelerate`. Passed to entrance animations. |
| `motion.easingAccelerate` | string | 🚧 Planned | Emitted as CSS var. No component currently reads it. |
| `motion.easingEmphasized` | string | 🚧 Planned | Emitted as CSS var. No component currently reads it. |

### Group: Components — Buttons

| Field | Type | Classification | Notes |
|---|---|---|---|
| `buttons.primary.lightTheme` | buttonStyleTheme | ✅ Active | Background, text, radius, hover — read directly by button components |
| `buttons.primary.darkTheme` | buttonStyleTheme | ✅ Active | Same for dark theme |
| `buttons.secondary.*` | buttonStyleTheme | ✅ Active | Same |

**Known bug:** `buildCssVars()` emits `--radius-btn: 12px` hardcoded, ignoring `buttons.primary.borderRadius`. Fix planned in Phase 1B.

### Group: Components — Section Surfaces

| Field | Type | Classification | Notes |
|---|---|---|---|
| `sectionSurfaces.lightTheme.surface1–3` | string (color) | ✅ Active | Emitted as `--color-section-surface1/2/3` in `html.light {}` |
| `sectionSurfaces.lightTheme.brandSurface` | string (color) | ✅ Active | Emitted as `--color-section-brand-surface` |
| `sectionSurfaces.lightTheme.glass` | glassStyle | ✅ Active | `backgroundOklch` → `--color-section-glass-bg`; `backdropBlur`+`borderWidth`+`borderColor` → inline styles via `getGlassStyles()` |
| `sectionSurfaces.darkTheme.*` | same | ✅ Active | Emitted into `:root {}` block |

**Known issue (studiomartegani):** `borderWidth: 1` set but `borderColor` null — `getGlassStyles()` requires both; border is silently dropped. Fix: add `borderColor` in Studio.

### Group: Components — Forms

| Field | Type | Classification | Notes |
|---|---|---|---|
| `forms.input/textarea/select/checkbox/radio` | FormInput | ✅ Active | Per-element light/dark theme colors emitted as `--form-{type}-bg` etc. |
| `forms.typography` | FormTypography | ✅ Active | Label, help, error colors + sizes emitted as `--form-label-*` etc. |
| `forms.geometry` | FormGeometry | ✅ Active | Input height, padding, radius, gap emitted as `--form-input-height` etc. |

All form token groups fall back to DS color tokens + hardcoded defaults when not set — the site renders correctly even when these are empty.

### Group: Components — Shadows

| Field | Type | Classification | Notes |
|---|---|---|---|
| `shadows.card` | string (CSS box-shadow) | 🚧 Planned | Resolved by resolver; `buildCssVars()` does not emit `--shadow-card`. No component reads it. Wire in Phase 3. |
| `shadows.dropdown` | string | 🚧 Planned | Same — `--shadow-dropdown` not yet emitted. |
| `shadows.modal` | string | 🚧 Planned | Same — `--shadow-modal` not yet emitted. |

Card components currently use hardcoded Tailwind `hover:shadow-lg`. These will be replaced with `var(--shadow-card)` in Phase 3.

### Group: Components — Navigation Appearance

| Field | Type | Classification | Notes |
|---|---|---|---|
| `navigation.menuRadius` | number | 🚧 Planned | Resolved; no CSS var emitted. Wire in Phase 3. |
| `navigation.menuGap` | number | 🚧 Planned | Same. |
| `navigation.backdropStyle` | string | 🚧 Planned | Same. |
| `navigation.dropdownStyle` | string | 🚧 Planned | Same. |

### Group: Components — Glass (top-level)

| Field | Type | Classification | Notes |
|---|---|---|---|
| `glass` | glassStyle | 🚧 Planned | Intended as a global token (header, dropdowns, modals). Currently resolved but never consumed — `getGlassStyles()` reads from `sectionSurfaces.X.glass`, not `designSystem.glass`. Wire or restructure in Phase 3. |

### Group: Components — Cards

| Field | Type | Classification | Notes |
|---|---|---|---|
| `cards.lightTheme` | cardStyleTheme | ⚠️ Legacy | Deprecated in favour of `cardVariants`. No CSS var emitted. No component reads it. |
| `cards.darkTheme` | cardStyleTheme | ⚠️ Legacy | Same. |
| `cardVariants` | CardVariant[] | 🚧 Planned | Resolved and array-merged by resolver. No section component reads `designSystem?.cardVariants`. Wire when card variant system is built. |

---

## Known Bugs (tracked here until fixed)

| ID | Description | Severity | Fix Phase |
|---|---|---|---|
| BUG-01 | `--radius-btn` hardcoded to `12px` in `buildCssVars`, ignores `buttons.primary.borderRadius` | Medium | Phase 1B |
| BUG-02 | Typography partial stubs (`{ source: 'library' }` with no font name) in studiomartegani DS shadow parent's Geist definition — site uses system sans-serif instead | High | Phase 1A (data fix in Studio) |
| BUG-03 | `sectionSurfaces.glass.borderWidth: 1` set for studiomartegani but `borderColor` null — border never renders | Low | Phase 1C (data fix in Studio) |
| BUG-04 | OG image in parent DS (`abluo-dental-design-system`) not reaching studiomartegani — LOCAL ONLY rule blocks inheritance | Medium | Phase 1D (upload to siteConfig) |

---

## Duplication Register

Fields that currently exist in both `siteConfig` and `designSystem`. Target state: siteConfig is authoritative; DS fields become fallbacks then are removed.

| Field | siteConfig | DS branding | Who wins now | Target |
|---|---|---|---|---|
| Logo | `logo` (localizedImage) | `branding.logo` (image) | DS (generic layout); siteConfig (Livener) | siteConfig always — Phase 2 |
| Logo Light | `logoLight` (localizedImage) | `branding.logoLight` (image) | Same | siteConfig always — Phase 2 |
| Logo height desktop | `logoHeightDesktop` | `branding.logoHeightDesktop` | **siteConfig wins** (Phase 2 wired) | siteConfig always — remove DS field in Phase 5 |
| Logo height mobile | `logoHeightMobile` | `branding.logoHeightMobile` | **siteConfig wins** | Same |
| Favicon | `faviconSvg` / `faviconPng` | `branding.favicon` | siteConfig SVG → PNG → DS favicon | Remove DS field after migration — Phase 5 |
| Apple Touch Icon | `appleTouchIcon` | `branding.appleTouchIcon` | **siteConfig only** (DS path not wired) | Remove DS field — Phase 5 |
| OG Image | `openGraphImage` | `branding.openGraphImage` | siteConfig → DS | Remove DS field after migration — Phase 5 |

---

## Migration Log

| Version | Date | Change | Notes |
|---|---|---|---|
| V0.9.10 | 2026-06-25 | Added `logoHeightDesktop`, `logoHeightMobile`, `appleTouchIcon`, `seoDefaultTitle`, `seoDefaultDescription` to siteConfig | siteConfig now wins for logo heights; DS branding tokens are fallback |
| — | 2026-06-25 | `DS_FIELDS_SELECTION` updated to include `openGraphImage { asset }` in branding block | Fixes GROQ not returning OG image from DS |

---

## Rollback Notes

| Tag | Branch | Description |
|---|---|---|
| `v0.9.10-baseline` | `dev` | Known-good dev state after V0.9.10 commit, before feature branch work begins |

To rollback to baseline:
```bash
git checkout dev
git reset --hard v0.9.10-baseline
git push origin dev --force-with-lease
```

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| Phase 0 | Branch setup, commit V0.9.10, tag baseline, cut feature branch | 🟡 In progress |
| Phase 1A | Fix typography stubs in Studio Martegani DS (data fix) | ⬜ Pending |
| Phase 1B | Wire `--radius-btn` from DS `buttons.primary.borderRadius` | ⬜ Pending |
| Phase 1C | Glass border — add `borderColor` in Studio | ⬜ Pending |
| Phase 1D | OG image — upload to `siteConfig.openGraphImage` for studiomartegani | ⬜ Pending |
| Phase 2 | Move logo/favicon assets from DS to siteConfig as source of truth | ⬜ Pending |
| Phase 3 | Wire/hide dead DS fields (shadows, navigation, glass top-level, cards) | ⬜ Pending |
| Phase 4 | Inheritance UI in Sanity Studio | ⬜ Pending |
| Phase 5 | Remove DS identity fields after migration verified in production | ⬜ Pending |

# ADR-036 — Brand Hub module (brand guidelines generated from the design system)

**Status:** Accepted — Tom, 2026-10-16. Slice 1 built on `dev` the same day (uncommitted at time of writing); contrast grid pulled forward from S2 into S1.
**Touches:** `src/lib/modules/registry.ts` (manifest `brand-hub`), `src/lib/modules/brand-hub/*`, `src/components/brand-hub/*`, `src/app/[locale]/(website)/[tenant]/brand/[[...page]]/page.tsx`, `src/lib/design-system/resolved-colours.ts` (NEW — the colour fallback chains, now shared by the tenant layout and the hub), `src/lib/design-system/contrast.ts` (gamut flag), `src/lib/design-system/fallback-tokens.ts` (`FALLBACK_MOTION`, `FALLBACK_LAYOUT`), `src/lib/platform/reserved-slugs.ts` (reserve `brand`), `src/lib/i18n/brand-hub-messages.ts` (hub labels, 7 locales), `src/lib/client/surfaces.ts` (admin-only), `messages/{en,it,de}.json` (module nav label).
**Related:** ADR-011/020 (module system), ADR-014 (one configuration surface), ADR-021 (consent — no embeds here), ADR-032 (content lifecycle), ADR-033 D11 (reserved segments), `fallback-tokens.ts` (platform defaults), Brand Hub Product & Functional Specification v1.0 (16 Oct 2026, Livener pilot).

## 1. Context

Livener's brand guidelines live in a Word document on Teams. They are out of date, and they disagree with the website (legacy orange `#FFA22A` vs the live `#FFA22B`). Tom wants a brand page that every Abluo project gets from data it already has, with Livener first. Abluo writes Livener's guidelines. The Word document is reference only.

The specification (v1.0) describes a full enterprise brand centre: block registry, approval workflow, immutable releases, four visibility modes, legacy-import workflow, live component previews. In the 2026-10-16 review Tom cut it to a first version that ships quickly and grows from use. This ADR records that cut.

### What already exists (evidence)

| Need | Already in Abluo | Where |
|---|---|---|
| Every design value, resolved through inheritance | `DS_FIELDS_SELECTION` + `resolveDesignSystemInheritance()` + `mergeDesignSystems()` | `src/lib/sanity/queries.ts`, `src/lib/sanity/design-system-resolver.ts` |
| Colours (13 roles × light/dark), type scale h1–h4/bodyLarge/body/small, radius, spacing, buttons, cards, forms, shadows, layout, motion, background assets | `designSystem` schema | `src/lib/sanity/schema.ts` (`colorTheme`, typography, `shadows`, `layout`, `motion`) |
| Values a site uses when the design system is silent | Platform fallbacks (deliberately brand-neutral) | `src/lib/design-system/fallback-tokens.ts` |
| Parse OKLCH / hex / rgb, WCAG contrast, compositing a transparent colour on a surface | `parseColor`, `contrastRatio`, `compositeOver`, `AA_NORMAL`, `AA_LARGE` | `src/lib/design-system/contrast.ts` |
| Logos, favicon, social image | `siteConfig.logo`, `logoLight`, `faviconSvg`, `faviconPng`, `openGraphImage` | `schema.ts` `siteConfig` |
| Site languages | `siteConfig.supportedLocales` | — |
| Live fonts on the page | Tenant layout loads the heading/body/accent fonts | `src/app/[locale]/(website)/[tenant]/layout.tsx` |
| Module install switch and gating | `project.moduleInstallations`, `isModuleEnabled()` | `src/lib/modules/config.ts` |
| Reserved URL segments | `DEFAULT_RESERVED_SEGMENTS` | `src/lib/modules/catalogue/slugs.ts` |

Livener's design system as stored in production (published, checked 2026-10-16) matches the spec's extraction. Three facts the spec had open:

- **Secondary text is opacity:** `oklch(0.9612 0 89.88deg / 0.55)` in dark mode and `oklch(0.2309 0.0292 263.75deg / 0.5)` in light mode. Contrast must therefore be measured after compositing on each background.
- **Livener has no parent design system.** "Platform defaults" means `fallback-tokens.ts` plus component defaults, not Abluo Base.
- **`layout`, `shadows` and `motion` exist in the schema but are empty for Livener.** They are not missing from Abluo.

The primary button (white on `#FFA22B`) measures **2.01:1**, and the light-mode secondary button (orange text on white) also measures **2.01:1**. Both fail WCAG AA. Navy `#161D2B` on orange measures 8.4:1. Fixing this is a Livener design-system decision, outside this ADR.

## 2. Decisions

### D1 — A module, served at `/brand` on the client's own website

- New manifest `brand-hub` (registry ids are kebab-case) in `MODULE_REGISTRY` (category `platform`, no section types, one Studio collection: the guide document).
- Route: `/[locale]/[tenant]/brand` and `/[locale]/[tenant]/brand/[page]`. The segment is fixed, following the `events` / `live` precedent. `brand` is added to `RESERVED_SLUGS` (`src/lib/platform/reserved-slugs.ts`) so a catalogue segment or page slug can never take it.
- The route returns 404 unless `isModuleEnabled(modules, 'brand-hub')`.
- Because the hub renders inside the tenant layout, it uses the client's own fonts, colours, light/dark switch and language switcher with no extra work.

*Rejected:* a central hub on abluo.app. It would need its own font loading and theming per tenant, and it would give the client no address of their own.

### D2 — Nothing is copied: the hub reads the existing owners

- **Design values:** the same resolved design system the website layout uses (one query, one resolver). No colour, size or font value is ever written into a Brand Hub document.
- **Assets:** from `siteConfig` (logos, favicon, social image) and `designSystem.backgroundAssets`. Downloads link to the original Sanity file.
- **Written content:** one `brandGuide` document per project (scoped by `projectSlug`, edited in Studio only). It holds only what the design system cannot: texts, rules, do/don't examples and the version number (D7). It holds **no colours**: every colour, including print-only ones, lives in the design system (D4).

**Consequence:** a change in the design system shows up on the hub immediately. That is intended: the design system *is* the brand.

### D3 — Fixed pages, with generated parts plus written parts

| Page | Generated from data | Written in the guide |
|---|---|---|
| Overview | Project name, logo, version, last updated, links to every page | Introduction, brand summary |
| Colour | Every role colour in light and dark, values, contrast grid, buttons | Usage rules, brand palette (D4), print note |
| Typography | Font families, live specimens of h1–h4 / body large / body / small with size, min size, weight, line height, letter spacing | Usage rules |
| Shape & spacing | Spacing scale, radii, button pill, shadows | Usage rules |
| Layout | Content/text widths, section padding | Usage rules |
| Logo & assets | Logos (both variants), favicon, social image, background graphics, with preview on light and dark, and download | Clear space, minimum size, misuse rules, do/don't |
| Motion | Durations and easings | Usage rules |

- Every page has written slots (localized rich text) and an optional **do/don't** list (image, caption, do or don't).
- There is **no block registry.** Pages are code; adding a page is a code change.
- The hub gets an **in-page navigation** (side or top) from the start, because the content will grow.
- Every displayed design value carries one of four labels:

| Label | Meaning |
|---|---|
| **Design system** | Read from the project's design system |
| **Calculated** | Derived from a design-system value, e.g. HEX from OKLCH, or a contrast ratio |
| **Platform default** | Not set by the project; the value shown is the one `fallback-tokens.ts` or the component actually renders |
| **Not set** | No value and no meaningful default; shown as a gap, never invented |

Written content needs no label: it is plainly the guide's text.

### D4 — Colour: what is shown, and how it is calculated

**Which colours.** Three groups:

1. Every role colour of the design system: background, background alt, surface, primary, secondary, accent, text primary/secondary/muted, border, success, warning, danger. Each is shown for **light and dark** side by side, from data, not from the current CSS theme.
2. Button colours (primary and secondary, both themes).
3. The **brand palette**: a new design-system field `brandPalette[]` (decided 2026-10-16, Tom: every colour comes from the design system, including colours used only on paper or merchandise). Each entry has:
   - `key`;
   - `name` (localizedString);
   - `value` (OKLCH or hex);
   - `description` (localizedText): where and how to use it;
   - `usage` (screen / print / both);
   - optional `cmyk` and `pantone`.

   The hub shows each palette colour together with the roles that use it, matched by value. For example: Orange — used as primary (light + dark), accent (dark), warning. Role fields are untouched, so no migration is needed.

   Because the palette lives in the design system, `buildCssVars()` emits `--color-brand-{key}` for every entry. A print-only colour is therefore already available to the website the day it's needed, and no "promote" step exists.

**Formats.** The stored value is shown exactly as stored, e.g. `oklch(0.7886 0.1630 66.32deg)`, and is the reference. HEX (`#FFA22B`) and RGB (`rgb(255 162 43)`) are **calculated** for copy/paste into tools that do not accept OKLCH (Figma, Canva, Office, email builders). They are never stored.

**Calculation rules** (in `contrast.ts`, extended):

- Target sRGB.
- An OKLCH value outside what a screen can show is clamped to the nearest displayable colour and marked "≈ approximate".
- Channels are rounded to integers.
- Hex and rgb inputs pass through unchanged.

**Transparent colours** (e.g. secondary text at 55%) are shown as the colour actually seen on each background, labelled "55 % of Text primary". The formula is `compositeOver`.

**Contrast grid.** Each text and brand colour is measured against each background, per theme, along with each button's text on its background:

- The ratio is shown to two decimals, with **AA normal (4.5)** and **AA large (3.0)** pass/fail.
- The method is stated (WCAG 2.x relative luminance).
- There is no generic "accessible" badge.
- A failure is shown as a failure. Livener's buttons will show **2.01:1 — fails** until the design system changes.

**Print (CMYK / Pantone).**
- **CMYK** is entered by a person. The hub may show a *calculated approximate CMYK* next to an empty field, clearly labelled "approximate — not for print approval".
- **Pantone** is never calculated. Matching needs Pantone's licensed library, so it is entered by a person who looked it up.
- A fixed note on the Colour page says screen and print colours never match exactly, and that print values must be checked on a proof.

### D5 — Visibility: public, hidden from search engines

- Every `/brand` page sends `robots: noindex, nofollow`, is excluded from `sitemap.ts`, and is not added to the site navigation. It is reachable by its URL.
- `noindex` is not privacy. The hub must not hold anything confidential.
- Password protection is **deferred** to the platform-wide protected-pages feature, the same need as CYCE's password-protected timetable. That feature must be built as a platform capability any page or module can use, so the Brand Hub adopts it without its own mechanism.

### D6 — Languages follow the website

- The guide is written in every language of `siteConfig.supportedLocales`.
- All `brandGuide` text fields are `localizedString` / `localizedText` / `localizedPortableText`, with the usual fallback: requested language, then site default, then `en`.
- Design values are language-neutral.
- The hub's own labels ("Colour", "Contrast", "Download", "Not set", "Last updated") come from the locale dictionaries (`getBrandHubMessages(locale)`), never hardcoded.
- The Translate button (ADR-023) works on the guide's fields like on any other localized field.

### D7 — Version, last updated, and history

- **Version** is a number on the `brandGuide` document (default 1), set by the Abluo admin when the guide reaches a new edition.
  - *Why not an automatic counter:* the hub changes when the design system or site settings change, outside the guide. An automatic counter on the guide would miss those changes. A counter on every source would count every typo fix.
- **Last updated** is automatic: the latest `_updatedAt` across the `brandGuide`, the design system (and its parents) and `siteConfig`. It is shown as a date in the site's time zone.
- Both appear on the Overview page and in the footer of every hub page.
- **History** is Sanity's revision history: 90 days, with who changed what.
- **Print:** a print stylesheet (hide navigation, one page per section, light theme), so "Save as PDF" in the browser gives a clean document.
- **Later (not built now):** saved versions. A "Save version" Studio action would store a `brandGuideVersion` document with:
  - date, person and note;
  - a snapshot (resolved design system JSON, guide content, asset references);
  - an optional attached PDF.

  These are kept forever, which bypasses the 90-day limit. Old snapshots keep their logos, because referenced media cannot be deleted. Nothing in v1 may block this. In particular, D2's "read live" applies only to the live hub.

### D8 — Out of scope (explicitly)

Not in scope:
- approval workflow (draft → review → publish);
- block registry;
- publishing legacy content;
- legacy-import workflow;
- live component previews (they come from Component Lab when it exists);
- kits;
- search;
- token package;
- shared-password access;
- editing from the client dashboard;
- server-generated PDF.

`tokens.css` / `tokens.json` downloads are a cheap later addition (the CSS already comes out of `buildCssVars()`).

## 3. Data model

```
brandGuide (document, one per project, projectSlug)
  projectSlug            string (hidden, set by the Studio structure)
  version                number, default 1
  intro                  localizedPortableText          — Overview
  pages                  object
    colour | typography | shape | layout | logo | motion
      body               localizedPortableText
      doDont[]           { image (Media Library asset), caption localizedString, kind: 'do' | 'dont' }

designSystem.brandPalette[]   (NEW design-system field — follows the five-step DS checklist:
                               schema, DS_FIELDS_SELECTION, mergeDesignSystems (child array replaces parent),
                               buildCssVars → --color-brand-{key}, inheritance test)
  { key string (unique, css-safe), name localizedString, value string (OKLCH or hex),
    description localizedText, usage: 'screen' | 'print' | 'both',
    cmyk string?, pantone string? }
```

- `brandPalette` values are validated like other colour strings. `key` is unique within the design system.
- Images in do/don't go through the Media Library (standing rule: every image is a Media Library asset).
- Not a routable document type: the URLs are fixed paths, not slugs, so the five-requirement checklist does not apply.
- No sitemap entries (D5).

## 4. Tests

- **No copies:** the `brandGuide` schema has no colour, size or font field.
- **Live:** given a design system, the hub view model shows its values. Changing the input changes the output (pure function, `buildBrandHubModel(ds, siteConfig, guide)`).
- **No invention:** an unset field produces "Not set" or "Platform default" with the real fallback value, never a made-up one.
- **Colour maths:** OKLCH → HEX/RGB for Livener's values; the clamp flag for an out-of-gamut value; compositing of 55% text; ratios 2.01 (white/#FFA22B) and 8.4 (#161D2B/#FFA22B).
- **No tenant literals** in `src/lib/modules/brand-hub/**` (the same style of test as `fallback-tokens.test.ts`).
- **Gating:** `/brand` returns 404 when the module is not enabled.
- **noindex** metadata on every hub page; no `/brand` URL in the sitemap.
- **Reserved segment:** `brand` is rejected as a catalogue segment.

Verification for any change to the hub: light and dark × phone and desktop, by Tom.

## 5. Slices

| Slice | Content | Size |
|---|---|---|
| **S1** | Manifest, `brandGuide` schema + Studio collection, route with in-page navigation, all seven pages generated from data with the four value labels, written slots, version + last updated, noindex, print stylesheet, tests | ~2 sessions |
| **S2** | Contrast grid and button checks, `designSystem.brandPalette` (five-step DS checklist) with print fields, role-to-palette matching, approximate CMYK, print note, do/don't lists | ~1 session |
| **S3 (later)** | Saved versions (snapshot + PDF + who/when), `tokens.css` / `tokens.json` downloads | when needed |

Then **Livener content**, written by Abluo: intro, brand palette in the design system (including offline-only colours, e.g. the legacy red/purple/green/blue/cyan if kept), logo rules, clear space, minimum sizes, misuse, do/don't, in English and Italian.

## 6. Open questions

1. ~~Installation default.~~ **Resolved 2026-10-16 (Tom):** Livener only first, to test. Roll-out to the other projects follows once it works.
2. ~~Livener buttons.~~ **Resolved 2026-10-16 (Tom):** colours stay as they are. Still open: whether the contrast results (D4) appear on the public hub or only in an internal view.
3. ~~Brand palette ↔ design system.~~ **Resolved 2026-10-16 (Tom):** every colour lives in the design system (`brandPalette`), so nothing needs promoting.
4. **Contrast on the public hub. Resolved 2026-10-16 (Tom):** public. It's used to show clients what fails so it gets fixed; the goal is that every Abluo site passes.

## 7. Consequences

- The hub costs almost nothing to maintain: it is always as current as the website, with no second copy of any value.
- The trade-off accepted for v1 is no frozen editions beyond 90 days of Sanity history. Saved versions (D7) close this when needed, without redesign.
- Every gap in a project's design system becomes visible on its hub. This is useful pressure to complete design systems, and it is honest about defaults.

## 8. Implementation notes (slice 1, 2026-10-16)

- **One source for the colour chains.** The website's fallback chains (surface → backgroundAlt → platform, light primary → dark primary, button defaults…) moved out of `buildCssVars()` into `resolveColours()`; the layout now reads the same function the hub documents. Output is unchanged (tests pin the historical chains).
- **Motion and layout defaults** are now named constants (`FALLBACK_MOTION`, `FALLBACK_LAYOUT`) so the hub shows the real platform values; a test keeps `FALLBACK_LAYOUT` equal to SectionContainer's CSS fallbacks.
- **The DS "fields read" backlog test** excludes the hub: documenting a field is not the website rendering it.
- **Model:** `buildBrandHubModel()` (pure) → `BrandHubModel` (`types.ts`); pages render only from it. Route gates on `isModuleEnabled(modules, 'brand-hub')` and sends `robots: noindex, nofollow`.
- **Enabling for a project** = adding the `brand-hub` installation in Studio → Modules (Livener first, per §6).

## 9. Amendment A — brand introduction, statuses, logo rules (2026-10-17)

Trigger: review of the Livener hub ("it documents the design system more than the brand"). Tom: everything is a module feature, usable by every project that enables the hub.

**Added to `brandGuide` (all text, all localized, additive — no migration):**
- `status`: `draft | review | published` (default `draft`). Shown next to the version on Overview and in every page footer. Replaces "Not yet versioned" when a guide exists.
- Eight **statements** on the Overview: `mission, vision, promise, audience, positioning, personality, values, story`. Each is an inline object `{ text: localizedText, status: draft | approved | needsDecision }`.
- `howToUse` (localizedPortableText). Empty → a standard platform text from the dictionary.
- `changes[]`: `{ date, note: localizedString }`. The hub shows the latest five, newest first.
- `logoRules`: four statements: `clearSpace, minimumDigital, minimumPrint, backgrounds`.

**Rules:**
- All slots are always shown. Unwritten text reads "Not written yet" (statements) with a "Needs a decision" pill. A written text without a status is a **draft** — never "approved" by default. Only "Approved" text reads as a confirmed brand rule.
- The statement and change objects are inline (not named schema types), so the module's registered `schemaTypes` are unchanged.
- D2 still holds: none of these fields is a design value. The "no design values" test is unchanged; the rule fields are named `minimumDigital` / `minimumPrint` (not `…Size…`) for that reason.
- Background graphics are always labelled "Background graphic · {design-system name}", so a background can no longer read as a logo.

**Livener content (production, 2026-10-17):** `brandGuide-livener` created (version 1, draft): mission and vision from the legacy document, marked **Draft**, English and Italian; the nine logo-misuse examples as don'ts (images in the Media Library, tagged `brand`, `logo misuse`); one change entry. Design-system background graphic renamed "Logotype" → "Symbol watermark".

**Not done, by decision:** the legacy colours (red, purple, green, blue, cyan) are not shown as a "legacy area" on the hub. D8 and Tom's 2026-10-16 decision stand: every colour comes from the design system (`brandPalette`, slice S2) and the hub only displays it; Abluo decides the palette.

### Backlog (open)
1. **S2 — `designSystem.brandPalette[]`**: named brand colours incl. print-only, CMYK/Pantone as approximate references, usage, token names; split "Brand palette" vs "UI colours" on the Colour page.
2. Token names + copyable CSS/JSON (`tokens.css` / `tokens.json`, already planned in S3).
3. Colour: approved uses, allowed/forbidden combinations, fixes suggested next to contrast failures.
4. Typography: fallback stacks, approved weights, responsive sizes, letter-spacing, UI text (buttons, labels, forms), licensing/hosting, language coverage.
5. Shape: pill button radius shown apart from the radius scale; empty shadows shown as "No shadow tokens" (or hidden).
6. Layout: grid/columns, breakpoints, gutters, examples on real pages.
7. Logo: variants (stacked, symbol, wordmark, mono), favicon/app-icon/social-avatar rules, video watermark, co-branding, download-all.
8. Motion: which duration for what, reduced-motion; say clearly when the project uses platform defaults.
9. New pages: Voice and content, Imagery, Iconography, Accessibility, Applications, Resources; Product UI (live/offline, meters, errors…) for software brands.
10. Light / Dark / Both selector for previews, separate from the hub's own theme.
11. Revision history beyond 90 days: saved versions (D7, S3); PDF versions with a log.
12. Password protection via the platform protected-pages feature (with CYCE).
13. Approval workflow (v3); live component previews (Component Lab); in-page navigation as pages grow.

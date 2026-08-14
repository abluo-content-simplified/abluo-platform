# ADR-020 — Modules as first-class per-site capabilities; Design System / Website Settings de-duplication

**Status:** Accepted
**Date:** 2026-08-13
**Owner:** Tom
**Supersedes/relates:** ADR-011 (module shell, Phase C), ADR-014 (settings surfaces), ADR-018 (Forms module), ADR-019 (notifications)

---

## Context

The platform already has a module system: a compile-time `MODULE_REGISTRY` (blog, events, live, forms), per-site install records on the Sanity `project` document (`moduleInstallations[]` with `enabled`, `version`, and an unused `config` slot), and a read-only "Modules" panel buried under Project Settings. In parallel, per-site configuration has been accumulating on the `siteConfig` document to the point where it is hard to use ("All fields" scrolls for minutes) and mixes true website properties with module/communication config.

Two problems follow:

1. **Modules are not first-class.** They cannot be enabled/disabled, configured, or placed from the Studio — the panel only displays install state. Capability config (WhatsApp, header-CTA form) has been landing on `siteConfig` instead of on the module, which is what makes that document grow without bound.
2. **Branding is duplicated.** Identity assets (logo, favicon, OG image, apple-touch icon, logo heights) exist on both `designSystem.branding` and `siteConfig`, with two of the Design System fields already dead (never queried). A cloned Design System would incorrectly carry one site's identity to another.

A project is one website in this codebase (one `siteConfig` per `projectSlug`), so "per website" and "per project" are the same unit today; no new website entity is required.

## Decision

### 1. Modules become first-class, per-site, with a uniform contract

Every module, when opened in the Studio, exposes the same four-part shape:

- **Status** — active / inactive per site (backed by the existing `moduleInstallations` records; the read-only panel becomes interactive; the legacy `enabledModules` dual-source is retired).
- **Placement** — where the module surfaces (pages/sections/site-wide), declared per site.
- **Configuration** — module-owned settings, defined by a per-module config schema (the currently-undeclared `config` slot gains a real, typed shape per module).
- **Data** — what the module produces (content in Sanity, operational data in Supabase), following the existing `dataStore.primary` boundary.

Modules carry a **version**; capabilities are gated by version so a module can evolve without breaking sites already running an older version. New modules appear in every site's list as available-but-inactive.

### 2. Communications config moves out of Website Settings into modules

WhatsApp (number, floating toggle, form reference, subjects) and the header-CTA form reference move off `siteConfig` into module configuration. WhatsApp becomes a real module; Forms are managed in the Forms module; the site document only retains a thin per-page/section *placement* switch where genuinely per-surface. Orphan `siteConfig` fields (`contactEmail`, `mobileNumber`, `whatsappSubjects`, `emailSubjects`, and their object types) are deleted.

### 3. Design System = reusable look; identity assets live in the site

The **Design System** holds only the reusable, cloneable visual language: colors, typography, motion/spacing. **Brand identity assets** (logo, light logo, favicon, OG image, apple-touch icon, logo heights) are per-site and live in **Website Settings → Branding** as the single source of truth. The duplicated/dead Design System branding image fields are removed; the generic-tenant header and email templates are repointed to the site Branding source. Colors and typography are untouched (already single-sourced in the Design System).

### 4. Studio information architecture, grouped by concern

Per site: **Content** (Pages, Collections, Media) · **Design System** (single entry — the redundant "Change Design System" menu item is merged in) · **Modules** (first-class list: Forms, WhatsApp, News, Blog, Events, Live Streaming…) · **Website Settings** (slimmed to true website properties). Tenant-level **Project Settings** keeps account infra (General, Domains, Billing, Integrations, Privacy, Notifications).

## Consequences

- The `siteConfig` document stops growing, because module config no longer lands there.
- Adding a future module is a uniform motion: it appears in every site's module list and brings its own status/placement/config/data/version — no changes to navigation or to the site document.
- Most of this work is **Sanity** (schema + content migration), not database: module enable/config, News content, and WhatsApp config need **no Supabase migration**. New SQL is required only if a module later captures visitor-generated data (e.g. event RSVPs).
- Delivery is phased; each phase is a reviewed, push-ready increment (build + Security + Accessibility + Testing review) rather than one untested drop.

## Migration & sequencing

1. Stand up Security, Accessibility, Testing review agents.
2. Interactive Modules panel + merge the Design System desk entries.
3. Move communications config into module config; delete orphans.
4. De-duplicate branding (identity → site Branding; remove dead Design System fields).
5. Build the News module (mirrors Blog).
6. Full review pass + verification; package increments + runbook.

Content migrations (Sanity) move existing WhatsApp/CTA values into module config and identity assets into the single Branding source, so no live site loses configuration during the transition. The two gates that remain Tom's: running the build/test suite, and pushing (dev → preview → main).

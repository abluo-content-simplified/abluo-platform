# Abluo Engineering System — Phase 1: Repository Orientation & Discovery
**Date:** 2026-07-10
**Scope:** Read-only discovery of `abluo-platform` (source of truth) and the `Abluo` documentation folder. Foundation for the Phase 2 architectural audit and the future orchestrator/specialist-agent workflow. No evaluation, no recommendations, no changes.
**Status:** Complete — reviewed; findings absorbed into [Engineering Playbook v1.0](./engineering-playbook.md)
**Naming note:** This document originally followed the `abluo-<topic>-<type>.md` convention in the `Abluo/` folder; relocated and renamed to `docs/engineering/phase-1-discovery.md` on adoption of the Playbook (2026-07-10). See §7 for the original convention analysis.

---

## 1. Discovery Metadata

| Item | Value | Confidence |
|---|---|---|
| Discovery date | 2026-07-10 | Confirmed |
| Method | Read-only shell + file inspection; no files in either repo modified | Confirmed |
| Active repository | `/Users/tmz/Abluo/abluo-platform` | Confirmed |
| Documentation folder | `/Users/tmz/Abluo/Abluo` (audits, manuals, backups, logs, historical) | Confirmed |

## 2. Repository Overview (Step 1)

| Item | Value | Evidence | Confidence |
|---|---|---|---|
| Repo root | `/Users/tmz/Abluo/abluo-platform` | `git rev-parse --show-toplevel` | Confirmed |
| Git repository | Yes; remote `origin = github.com/abluo-content-simplified/abluo-platform.git` | `git remote -v` | Confirmed |
| Current branch | `dev` | `git branch --show-current` | Confirmed |
| Current commit | `136358a414b135e63432b1e82b9e69d2db4326b8` (2026-06-30) — "V1.0.13: Fix FeaturedPostCard image width…" | `git log -1` | Confirmed |
| Tag at HEAD | `V1.0.13` | `git tag --points-at HEAD` | Confirmed |
| Working tree | Clean (`git status --porcelain` empty). A read-only mount prevented deleting a stale `.git/index.lock`; status itself reported no changes | `git --no-optional-locks status` | Confirmed |
| Platform version | **Ambiguous** — tag at HEAD is `V1.0.13`; `package.json` says `1.0.2`; `release.json` says `v1.0.2`; `next.config.ts` derives version from lowercase `v*` tags only, so builds report `v1.0.2` | `package.json`, `release.json`, `next.config.ts` | Confirmed (the ambiguity itself) |
| Branches | `dev` (current), `main`, `preview` implied by workflow docs (not listed locally), plus `dashboard-shell`, `feature/config-architecture`, 2× `fix/navlient-tailwind-v4*`, 4× `backup/*` | `git branch -a` | Partially confirmed — `preview` not in local branch list; requires verification |
| Package manager | npm (`package-lock.json`; `.npmrc` sets `legacy-peer-deps=true`) | repo root | Confirmed |
| Framework | Next.js **16.2.6** (App Router, RSC), React **19.2.4**, TypeScript 5, Tailwind CSS v4, Sanity v3, Supabase (`@supabase/ssr`, `supabase-js` v2), next-intl v4, motion v12, vitest v4 | `package.json` | Confirmed |
| Build commands | `npm run build` (`next build`), `npm run dev`, `npm run lint`, `npm run test` (`vitest run`) | `package.json` scripts | Confirmed |
| Release tooling | `scripts/release.sh` (Release Automation v2) + `scripts/doctor.sh` health checks; annotated lowercase `v*` git tag is the declared single source of truth | `scripts/release.sh`, `docs/release-automation.md` | Confirmed |
| Environment | Local dev checkout; `.env.local` present with Sanity (`3n7t84j3`/production), Supabase, Google Maps keys (key names inspected only) | `.env.local` key names | Confirmed |

**Tag inventory (full):** mixed conventions — lowercase checkpoints (`v0.1-checkpoint`…`v0.9.14`, `v1.0.1`, `v1.0.2`), uppercase releases (`V0.8.0`…`V1.0.13`), and `checkpoint-client-project-refactor`. Commits labelled V1.0.6–V1.0.12 exist in history but have **no corresponding tags**. Confidence: Confirmed.

## 3. Repository Inventory (Step 2)

| Path | Responsibility | Confidence |
|---|---|---|
| `src/app/` | Next.js App Router: `[locale]/(website)/[tenant]` tenant sites, `[locale]/(admin)` admin dashboard, `[locale]/(client)` client dashboard, `api/*` API routes, `studio/` embedded Sanity Studio, `login/`, `sitemap.ts`, `robots.ts` | Confirmed |
| `src/proxy.ts` | Middleware (Next 16 convention): hostname→tenant resolution, next-intl, Supabase session | Confirmed |
| `src/lib/sanity/` | **Canonical** Sanity layer: `schema.ts` (~135 KB, 60 `defineType`), `queries.ts` (GROQ + `DS_FIELDS_SELECTION`), `types.ts`, `design-system-resolver.ts`, `surfaces.ts`, `client.ts`, `fields/` (Studio inputs), `studio/`, `migrations/`, `__tests__/` | Confirmed |
| `src/sanity/` | Secondary Sanity dir: Studio document actions (`ExportDesignSystemAction`, `ImportDesignSystemAction`, `AutoCreateSiteConfigAction`, `DuplicateDesignSystemAction`), Studio components; `queries.ts`/`types.ts` are re-export shims to `@/lib/sanity/*` | Confirmed |
| `src/lib/modules/` | Module system (ADR-009/010/011): `registry.ts` (declarative `MODULE_REGISTRY`), `navigation.ts`, `permissions.ts`, `validate.ts`, `types.ts`, per-module `blog/`, `events/`, `live/`, `__tests__/` | Confirmed |
| `src/lib/supabase/` | Supabase clients: `client.ts`, `server.ts`, `admin.ts` | Confirmed |
| `src/lib/` (top) | `permissions.ts` (tenant roles), `tenant.ts` (`x-tenant-id` header), `deployment.ts` (build metadata), `forms/`, `i18n/` (locale registry + message dictionaries), `maps/`, `embed.ts`, `image-presentation.ts`, `types/` | Confirmed |
| `src/components/` | `sections/` (15 section components), `livener/` (Nav/Footer/live — tenant-named), `animation/` (SlideUp, FadeIn, StaggerChildren, ParallaxImage), `fields/` + `form/` + `forms/` (form field library, EarlyAccess), `media/`, `admin/`, `blog/`, `events/`, `layout/`, `ui/`, `SiteControls/`, `JsonLd.tsx`, `SlugMapContext.tsx` | Confirmed |
| `src/i18n/` | next-intl `routing.ts` (derives from Platform Locale Registry), `request.ts`, `navigation.ts` | Confirmed |
| `src/themes/livener/` | Livener theme assets (tokens.css, tailwind config, logos, preview.html) — tenant-specific static assets | Confirmed |
| `sanity.config.ts` | Studio config (~31 KB): `structureTool` with project-scoped panes, projectId `3n7t84j3` fallback | Confirmed |
| `supabase/` | `schema.sql` (canonical, post-005) + `migrations/001–005` (leads status, projects, tenant_members, profiles identity-only, inquiries) | Confirmed |
| `messages/` | Admin-UI translations: `en.json`, `it.json`, `de.json` (locale registry lists 7 platform locales — 4 have no message file) | Confirmed |
| `docs/` | ADR log + ADR-011 document set, config architecture, implementation checklist, release docs, `releases/` | Confirmed |
| `scripts/` | `release.sh`, `doctor.sh`, `lib/common.sh`, `create-clients.{js,ts}`, `setup-clients-and-projects.js` | Confirmed |
| Root loose files | `convert-colors.js`, `migrate-martegani.js`, `test-template.js`, `VERIFY_OWNERSHIP.sh`, 10 historical `.md` docs, 10 `build-log-*` files | Confirmed |
| `dist/static/*.json` | Generated Sanity schema manifests (gitignored pattern `dist/static/*.json`) | Confirmed |
| `.next/`, `node_modules/`, `tsconfig.tsbuildinfo`, `.DS_Store` | Build/dependency/OS artifacts | Confirmed |

## 4. Architecture Map (Step 3)

| Area | Primary Location | Supporting Locations | Key Files / Symbols | Notes | Confidence |
|---|---|---|---|---|---|
| Frontend application | `src/app/[locale]/(website)/` | `src/components/` | `[tenant]/page.tsx`, `[tenant]/[slug]/page.tsx`, `[tenant]/layout.tsx` | Route groups: `(website)`, `(admin)`, `(client)` | Confirmed |
| Routing / middleware | `src/proxy.ts` | `src/i18n/routing.ts`, `src/lib/tenant.ts` | `resolveTenant()`, `resolveSanityProjectSlug()`, `x-tenant-id` header | Contains inline `domainMap` and `projectMap` lookup tables (livener, studiomartegani, abluo-the-tiny-cms) | Confirmed |
| Pages (tenant sites) | `src/app/[locale]/(website)/[tenant]/` | — | `page.tsx`, `[slug]/page.tsx`, `blog/`, `events/`, `live/` | `SectionRenderer` duplicated in `page.tsx` and `[slug]/page.tsx` (per CLAUDE.md New Section Checklist) | Confirmed |
| Sections | `src/components/sections/` | schema in `src/lib/sanity/schema.ts` | 15 components incl. `HeroSection`, `MediaContentSection`, `PhotoGallerySection`, `FormSection`, `BlogListingSection` | 13 `*Section` schema types found in schema.ts | Confirmed |
| Modules | `src/lib/modules/` | `sanity.config.ts` (consumes registry) | `MODULE_REGISTRY`, `ModuleManifest`, `navigation.ts`, `validate.ts` | blog / events / live modules; fully declarative per ADR-011 D3 | Confirmed |
| Shared UI | `src/components/ui/`, `layout/`, `animation/` | `src/components/fields/` | `button.tsx`, `CtaButton.tsx`, `SlideUp`, `FadeIn` | `livener/` Nav+Footer are tenant-named but serve as site chrome | Confirmed |
| Design System | `src/lib/sanity/design-system-resolver.ts` | `schema.ts` (designSystem type), `queries.ts` | `resolveDesignSystemInheritance()`, `mergeDesignSystems()`, `DS_FIELDS_SELECTION` | 5-step new-field checklist in CLAUDE.md | Confirmed |
| DS inheritance / roles | same | `src/lib/sanity/fields/DesignSystemPicker.tsx`, `src/sanity/actions/*` | template vs active roles, `parentDesignSystem`, max depth 5 | Export/Import actions field-agnostic | Confirmed |
| Themes / CSS vars | `src/app/[locale]/(website)/[tenant]/layout.tsx` | `src/themes/livener/` | `buildCssVars()`, `--motion-*` vars | Livener theme assets are static, outside DS pipeline | Confirmed |
| Tenant config | Sanity `siteConfig` + `project` docs | `src/proxy.ts`, `supabase/schema.sql` (`tenants` table) | `projectSlug` universal key; `tenantSlug` on client | Tenant identity spans Sanity + Supabase + proxy maps | Confirmed |
| Sanity Studio | `sanity.config.ts`, `src/app/studio/` | `src/lib/sanity/studio/`, `src/sanity/components/`, `src/sanity/actions/` | `structureTool` project panes, `ModuleList`, `DesignSystemAssignPane` | Studio mounted at `/studio`, no auth guard (per Abluo/CLAUDE.md map) | Confirmed |
| Sanity schemas | `src/lib/sanity/schema.ts` | `src/lib/modules/*/schema.ts` | 60 `defineType` calls; single ~135 KB file + module schema files | Platform sections vs module schema split per ADR-011 | Confirmed |
| GROQ queries | `src/lib/sanity/queries.ts` (~38 KB) | `src/sanity/queries.ts` (re-export shim) | `DS_FIELDS_SELECTION`, `homePageQuery`, `pageBySlugQuery`, redirect queries | All tenant queries filter `projectSlug == $projectSlug` (per convention) | Confirmed |
| Types | `src/lib/sanity/types.ts` (~35 KB, hand-written) | `src/sanity/types.ts` (shim), `src/lib/types/` | `PageSection` union, `MotionTokens`, `SupportedLocale` | **No codegen found** — types are manually maintained; `dist/static/*.json` are Studio deploy manifests, not TS codegen | Confirmed |
| Supabase client | `src/lib/supabase/` | `src/proxy.ts` (`createServerClient`) | `client.ts` / `server.ts` / `admin.ts` | | Confirmed |
| Database / migrations | `supabase/migrations/001–005` | `supabase/schema.sql` | tenants, profiles, projects, leads, tenant_members, inquiries; RLS + `SECURITY DEFINER` helpers | Migrations applied manually via SQL editor (per schema.sql header) | Confirmed |
| Authentication | `src/proxy.ts` + `src/app/login/` | `src/lib/supabase/` | Supabase auth session in middleware | | Confirmed |
| Authorization | `src/lib/permissions.ts` | `src/lib/types/roles.ts`, `src/lib/modules/permissions.ts` | `canEditContent()` etc.; owner/editor/viewer | Role helpers centralised by design | Confirmed |
| Tenant membership | `supabase/migrations/003_tenant_members.sql` | `004_profiles_identity_only.sql`, `src/lib/permissions.ts` | `tenant_members`, `get_my_owned_tenant_ids()` | v0.9.1-membership-phase1 | Confirmed |
| Forms | `src/components/fields/` (16-type field library), `src/components/forms/` | `src/lib/forms/` (spam.ts, validation-messages), `FormSection.tsx`, `api/form-submissions`, `api/inquiries` | `FormRenderer`, `EarlyAccessModal` | | Confirmed |
| API routes | `src/app/api/` | — | `inquiries`, `form-submissions`, `media/*`, `sanity/*` (document/tenant/projects/fill-tenant), `version`, `fix-colors` | `fix-colors` appears utility/one-off — Requires verification | Partially confirmed |
| Localization (interface) | `src/i18n/` + `messages/` | `src/lib/i18n/locales.ts` (Platform Locale Registry) | `PLATFORM_LOCALES` (7), `LOCALE_CODES`, next-intl | Only en/it/de message files exist for 7 registry locales — Requires verification whether intentional | Confirmed |
| Localization (content) | Sanity `localizedString/Text/PortableText/Slug` | `src/lib/sanity/fields/LocalizedInput.tsx`, `useProjectLocales.ts` | `siteConfig.supportedLocales`, `coalesce(field[$locale], …)` | Two-system separation documented in CLAUDE.md | Confirmed |
| Language switching | `src/components/SiteControls/LanguageSwitcher.tsx` | `SlugMapContext.tsx` | `SlugMapProvider` | | Confirmed |
| SEO | route `generateMetadata` + `src/app/sitemap.ts`, `robots.ts` | `src/components/JsonLd.tsx` | hreflang alternates from slugMap; JSON-LD on all tenant routes | | Confirmed |
| Analytics | `src/app/[locale]/(website)/layout.tsx` | `(client)/analytics/page.tsx` (dashboard page) | `@vercel/analytics`, `@vercel/speed-insights` | Depth of dashboard analytics — Requires verification | Partially confirmed |
| Media | `src/app/api/media/*` | `src/components/media/`, `(admin)/media/page.tsx`, `mediaAsset` schema | UploadDialog, EditSheet, tags API | | Confirmed |
| Images | `src/lib/sanity/image.ts`, `src/lib/image-presentation.ts` | `@sanity/image-url` | `IMAGE_HOVER_CLASSES` (V1.0.10) | | Confirmed |
| Accessibility | No dedicated utilities found | `aria-*` attributes inline in section components, `button.tsx` | — | No a11y lib, tests, or docs discovered | Confirmed (absence) |
| Testing | `vitest.config.ts` | `src/lib/sanity/__tests__/design-system-resolver.test.ts`, `src/lib/modules/__tests__/` (navigation, permissions, validate) | 4 test files total; node environment; no component/E2E tests found | Test counts in docs (46/53) vs current — Requires verification by running vitest | Confirmed (file inventory) |
| Release workflow | `scripts/release.sh`, `scripts/doctor.sh` | `docs/release-workflow.md`, `docs/release-automation.md`, `release.json` | Annotated lowercase `v*` tag = source of truth; dev→preview→main with literal Stop gates (CLAUDE.md) | Recent tags V1.0.3–V1.0.13 are uppercase, diverging from v2 tooling | Confirmed |
| Versioning | `next.config.ts` (git describe `v[0-9]*`) | `src/lib/deployment.ts`, `api/version` | `NEXT_PUBLIC_PLATFORM_VERSION` | See version ambiguity in §2 | Confirmed |
| Deployment | Vercel (per docs); `next.config.ts` headers (CDN no-store) | `Abluo/DEPLOYMENT.md`, CLAUDE.md branch table | dev/preview/main → dev.abluo.app / preview.abluo.app / abluo.app | No `vercel.json` in repo; Vercel project config external — Requires verification | Partially confirmed |
| Rollback / recovery | `Abluo/backups/2026-06-18-v0.9.0-foundation/` | `docs/releases/v0.9.0-foundation-backup-guide.md`, `backup/*-pre-recovery` branches | Supabase backup guide; git backup branches | No automated rollback mechanism found | Confirmed (inventory) |
| Documentation | `docs/` + root `.md` files (repo) | `/Users/tmz/Abluo/Abluo/` (audits, manuals) | See §5 | Split across three locations | Confirmed |

## 5. Documentation Inventory (Step 4)

### 5.1 Repository — `abluo-platform/docs/`

| Document | Purpose | Scope | Status | Last Updated (mtime/header) | Related | Notes |
|---|---|---|---|---|---|---|
| `architecture-decisions.md` | ADR log (ADR-001…ADR-011) with template | Platform-wide | Current | 2026-06-28 | All ADR-011 files | Single-file log; ADR-008 appears before ADR-007 in file order |
| `ADR-011-module-management-architecture.md` | ADR-011 Rev 1 (Proposed, acceptance-ready) | Module system | Current | 2026-06-26 | roadmap, review, progress | |
| `ADR-011-architecture-review.md` | Critical review of ADR-011 draft | Module system | Current (input doc) | 2026-06-26 | ADR-011 | |
| `ADR-011-implementation-roadmap.md` | Frozen Rev 2 roadmap (72 KB) | Module system | Current, frozen | 2026-06-26 | progress, checklist | Baseline V0.9.17 |
| `adr-011-current-state.md` | Phase 0 inventory at V0.9.18 | Module system | Historical snapshot | 2026-06-26 | ADR-011 set | Lowercase filename vs uppercase siblings |
| `adr-011-progress.md` | Execution progress (only mutable ADR-011 doc) | Module system | Current | 2026-06-27 | roadmap | Lowercase filename |
| `config-architecture.md` | Living field register "as it exists today" | siteConfig + designSystem | Declares itself current | 2026-06-28 | architecture-decisions.md | Overlaps `Abluo/abluo-configuration-audit.md` |
| `implementation-checklist.md` | Phase-agnostic completion procedure v1.0 | Process | Current | 2026-06-28 | ADR-011, ADR-012 (referenced; ADR-012 not found in log) | |
| `release-automation.md` | How release tooling works | Release | Current | 2026-06-30 | release-workflow.md | |
| `release-workflow.md` | Release runbook | Release | Current | 2026-06-30 | release-automation.md, DEPLOYMENT.md | |
| `releases/v0.9.0-foundation.md` + `-backup-guide.md` | Checkpoint + Supabase backup/recovery | Release checkpoint | Historical | 2026-06-18 | Abluo/backups | |

### 5.2 Repository — root-level `.md` (outside `docs/`)

| Document | Purpose | Status |
|---|---|---|
| `CLAUDE.md` (30 KB) | Project intelligence: principles, DS checklist, motion pipeline, routable-content pattern, deployment workflow, incident post-mortems | Current — richest single architecture document |
| `ABLUO.md` | Older platform overview | Partially current — says isolation key is `tenantSlug`; CLAUDE.md/ADR-001 say `projectSlug`. **Superseded/conflicting** |
| `CHANGELOG.md` | Milestones (V0.9.16, V0.9.17) | Partially current — stops before V1.0.x |
| `README.md` | create-next-app boilerplate | Not project-specific |
| `IMPLEMENTATION_SUMMARY.md`, `PHASE1_IMPLEMENTATION_SUMMARY.md`, `OWNERSHIP_IMPLEMENTATION.md`, `FINAL_VERIFICATION_CHECKLIST.md`, `COMMIT_SUMMARY_TEMPLATE_FIX.md`, `TEMPLATE_ID_RULE.md`, `MIGRATION_v0.7_THEME_AWARE_SCHEMA.md`, `BUILD_LOG_2026-06-06.md`, `BUILD_LOG_v0.6.0.md` | June 2026 session/implementation notes (ownership templates, theme-aware schema v0.7) | Historical; TEMPLATE_ID_RULE.md content may still be a live rule — Requires verification |
| `build-log-v0.6.0.txt` … `build-log-V0.9.1.txt` (10 files) | Per-release build logs | Historical; naming migrated lowercase→uppercase V |

### 5.3 Documentation folder — `/Users/tmz/Abluo/Abluo/`

| Document | Purpose | Status |
|---|---|---|
| `CLAUDE.md` | URL map: local + production routes | Current |
| `DEPLOYMENT.md` | Deployment manual (three-stage pipeline, 🧑/🤖 legend) | Current — overlaps repo `docs/release-workflow.md`; relationship undeclared |
| `abluo-configuration-audit.md` | siteConfig/designSystem field audit (2026-06-24) | Historical audit; overlaps repo `docs/config-architecture.md` |
| `abluo-ds-inheritance-audit.md` | Martegani DS inheritance runtime audit (2026-06-25) | Historical audit |
| `abluo-ds-refactor-plan.md` | DS/site-settings refactor plan (2026-06-25, "Planning only") | Implementation status unknown — Phase 2 item |
| `user-management-audit.md` | Auth architecture audit + migration plan (2026-06-18) | Largely executed per v0.9.1 memory — Requires verification in Phase 2 |
| `project-overview-2026-06-04.md` | Platform overview snapshot | Historical |
| `build-log-2026-05-21.md` | Foundation build log | Historical |
| `IMPLEMENTATION_SUMMARY.md`, `IMPLEMENTATION_VERIFICATION.md` | June 11 ownership implementation notes | Historical; duplicate topic of repo root docs |
| `livener-design-system-*.json` (3) | DS export/import data files | Data exports, not docs |
| `backups/2026-06-18-v0.9.0-foundation/` | Supabase snapshot (README + schema.sql) | Backup artifact |
| `logs/2026-06-07-session.md`, `2026-06-08-session.md` | Session logs | Historical |

## 6. Previous Audit Inventory (Step 5)

| Audit | Location | Date | Purpose | Main Topics | Referenced Version/Commit | Still Relevant? | Notes |
|---|---|---|---|---|---|---|---|
| Configuration Audit | `Abluo/abluo-configuration-audit.md` | 2026-06-24 | Field inventory + duplication + refactor plan for siteConfig/designSystem | Field ownership, runtime usage | ~V0.9.x era | Partially — repo `docs/config-architecture.md` is the declared living successor | Phase 2: verify which findings were implemented |
| DS Inheritance Audit | `Abluo/abluo-ds-inheritance-audit.md` | 2026-06-25 | Why DS fields appear empty in Studio; runtime resolution | DS inheritance, Martegani | Martegani docs `803e84d4` | Partially | Tenant-specific investigation |
| DS Refactor Plan | `Abluo/abluo-ds-refactor-plan.md` | 2026-06-25 | DS/Site-Settings refactor implementation plan | DS, siteConfig | Notes work on `main` + uncommitted Phase 2 | Unknown | Explicitly "Planning only"; execution status unassessed |
| User Management Audit | `Abluo/user-management-audit.md` | 2026-06-18 | Auth architecture audit + tenant-membership migration plan | auth.users, profiles, RLS, roles | Pre-v0.9.1 | Largely executed (per migrations 003–004) | Verify in Phase 2 |
| ADR-011 Architecture Review | `docs/ADR-011-architecture-review.md` | 2026-06-26 | Pre-acceptance critical review of module architecture | Modules, five-layer backbone | ADR-011 draft | Yes | |
| ADR-011 Current State Inventory | `docs/adr-011-current-state.md` | 2026-06-26 | Phase 0 audit of module-relevant code | Registry, Studio nav, schema | V0.9.18 | Yes (best baseline inventory) | Closest precedent to this Phase 1 doc |
| Ownership Implementation Verification | `Abluo/IMPLEMENTATION_VERIFICATION.md` + repo root `FINAL_VERIFICATION_CHECKLIST.md` | 2026-06-11 | Verify projectSlug auto-assignment | Sanity templates | commit 03cbf72 referenced | Historical | Duplicated across both locations |
| Deployment incident post-mortems | repo `CLAUDE.md` (V0.8.2 bypass), `BUILD_LOG_2026-06-06.md` (data loss) | 2026-06 | Incident records | Release process, data safety | V0.8.2 | Yes — encoded as process rules | Not standalone audit files |

No accessibility or security audits were found in either location. Confidence: Confirmed (absence).

## 7. Documentation Conventions (Step 6)

**Observed conventions:**

| Aspect | Dominant convention | Evidence |
|---|---|---|
| ADRs | Single-file log `docs/architecture-decisions.md`, `## ADR-NNN — Title`, statuses (Proposed/Accepted/Frozen), template included; large ADRs get satellite files `ADR-011-*.md` | docs/ |
| Audits | `Abluo/` folder root, kebab-case `abluo-<topic>-audit.md`, header `# Title` + `**Date:**` + `**Scope:**` | 4 audit files |
| Release notes | `CHANGELOG.md` (milestones) + `build-log-V{version}.txt` in repo root (capital V, per CLAUDE.md and feedback memory) + `docs/releases/` for checkpoint docs | repo root, docs/releases |
| Progress tracking | Dedicated mutable progress doc (`adr-011-progress.md`); roadmap and checklist frozen | docs/ |
| Cross-referencing | Relative markdown links between paired docs (release-automation ↔ release-workflow; config-architecture ↔ architecture-decisions) | docs/ |
| Metadata headers | Bold key-value block after H1: `**Status:**`, `**Date:**`, `**Version:**`, `**Author:**`, `**Supersedes:**` | ADR-011 set |
| Versioning of docs | "Revision N" within ADR headers; no per-doc semver elsewhere | ADR-011 |
| Archival | None formal — historical docs remain in place (repo root, Abluo folder); `backups/` and `logs/` subfolders exist in Abluo folder only | both locations |

**Inconsistencies observed (reported, not resolved):**

1. **ADR-011 casing:** `ADR-011-*.md` (3 files) vs `adr-011-*.md` (2 files) in the same directory.
2. **ADR ordering:** ADR-008 precedes ADR-007 inside `architecture-decisions.md`.
3. **ADR-012 referenced** by `implementation-checklist.md` but absent from the ADR log.
4. **Tag/version conventions conflict:** repo CLAUDE.md mandates capital `V{version}` tags; Release Automation v2 (`release.sh`, `next.config.ts`) mandates lowercase `v*` and ignores uppercase tags. Both styles coexist in the tag list; V1.0.3–V1.0.13 are invisible to the version pipeline.
5. **Build-log naming drift:** `BUILD_LOG_v0.6.0.md`, `build-log-v0.6.0.txt`, `build-log-V0.8.0.txt` — three patterns.
6. **"Current state" duplication:** `Abluo/abluo-configuration-audit.md` vs repo `docs/config-architecture.md`; `Abluo/DEPLOYMENT.md` vs `docs/release-workflow.md` + CLAUDE.md deployment section; `ABLUO.md` vs CLAUDE.md (with a factual conflict: `tenantSlug` vs `projectSlug` as isolation key).
7. **Implementation notes split** between repo root, `docs/`, and the Abluo folder with duplicated topics (ownership implementation appears in ≥4 files across both locations).
8. **Two Sanity source directories** (`src/sanity/` and `src/lib/sanity/`) with re-export shims marking `lib` as canonical — a code-layout convention inconsistency relevant to doc references.

## 8. Repository Exclusions (Step 7)

| Path / Pattern | Type | Exclude from Active-Code Audit? | Reason | May Still Be Useful For |
|---|---|---|---|---|
| `node_modules/` | Dependencies | Yes | Third-party | Dependency review |
| `.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts` | Build output | Yes | Generated | Build diagnostics |
| `dist/static/*.json` | Generated Sanity manifests | Yes | Generated (gitignored pattern) | Schema-deploy history |
| `.DS_Store` (repo root, src, scripts, supabase, Abluo folder) | OS artifact | Yes | Noise | — |
| `.env.local` | Secrets | Yes (content) | Credentials | Env-var inventory (names only) |
| `public/livener/` + `src/themes/livener/` | Tenant static assets | Partially | Assets, not logic | Tenant-asset architecture question |
| Repo root historical `.md` + `build-log-*` files | Historical docs | Yes (as code); keep as evidence | Session notes, superseded | Phase 2 recommendation-status checks |
| `convert-colors.js`, `migrate-martegani.js`, `test-template.js`, `VERIFY_OWNERSHIP.sh`, `scripts/create-clients.*`, `scripts/setup-clients-and-projects.js` | One-off scripts | Yes (as architecture) | Ad-hoc utilities | Understanding past migrations |
| `Abluo/backups/`, `Abluo/logs/`, `Abluo/livener-design-system-*.json` | Backups/exports/logs | Yes | Historical snapshots | Recovery, DS field history |
| `backup/*` git branches | Branch snapshots | Yes | Recovery branches | Incident forensics |
| `src/lib/sanity/migrations/`, `supabase/migrations/` | Migrations | No — include | Part of active architecture | — |
| `src/sanity/queries.ts`, `src/sanity/types.ts` | Re-export shims | Include (flag as shims) | Compatibility layer | Import-path consolidation question |

## 9. Responsibility and Boundary Map (Step 8)

| Domain | Main Responsibilities | Primary Files | Shared Dependencies | Areas of Overlap | Confidence |
|---|---|---|---|---|---|
| Frontend rendering | Tenant routes, SectionRenderer, layout, CSS-var emission | `(website)/[tenant]/*.tsx` | DS resolver, queries, types | SectionRenderer + hydration duplicated across two route files | Confirmed |
| Section implementation | 15 presentation components, animation choreography | `src/components/sections/`, `src/components/animation/` | designSystem.motion tokens, surfaces, types | Section schema lives in Sanity domain; component in frontend domain — every new section crosses 6 locations (New Section Checklist) | Confirmed |
| Module lifecycle | Registry, manifests, validation, Studio nav derivation, module permissions | `src/lib/modules/` | Sanity schema types, Studio structure, `src/lib/permissions.ts` | Module sections (blog/sections.tsx) vs platform sections; permissions split between two files | Confirmed |
| Sanity schema & Studio | 60 document/object types, structure tool, Studio inputs/actions | `src/lib/sanity/schema.ts`, `sanity.config.ts`, `src/lib/sanity/fields/`, `src/sanity/` | Module registry, locale registry | Two Sanity directories; schema.ts is a single 135 KB file spanning all domains | Confirmed |
| GROQ & content contracts | Queries, projections, `DS_FIELDS_SELECTION`, slug/redirect patterns | `src/lib/sanity/queries.ts`, `src/lib/sanity/types.ts` | schema.ts shapes, routes | Hand-maintained types must track schema manually (no codegen) | Confirmed |
| Design System | Inheritance, merge, tokens, motion pipeline, import/export | `design-system-resolver.ts`, `buildCssVars()` in tenant layout, `src/sanity/actions/*` | queries (DS_FIELDS_SELECTION), schema, tests | CSS-var emission lives inside a frontend route file | Confirmed |
| Supabase data & security | Schema, RLS, migrations, service clients | `supabase/`, `src/lib/supabase/` | proxy.ts (session), API routes | `tenants` table mirrors Sanity client/project docs — cross-system consistency is manual | Confirmed |
| Auth & membership | Login, session middleware, roles, tenant_members | `src/app/login/`, `proxy.ts`, `src/lib/permissions.ts`, migrations 003–004 | Supabase clients, module permissions | Role logic in `lib/permissions.ts` + `lib/modules/permissions.ts` | Confirmed |
| Localization | Platform locale registry, next-intl, localized field types, per-tenant locales | `src/lib/i18n/locales.ts`, `src/i18n/`, `messages/`, `LocalizedInput.tsx` | routing, schema, queries, every component (no hardcoded strings rule) | Message dictionaries also in `src/lib/i18n/*-messages.ts` (two mechanisms) | Confirmed |
| SEO | Metadata, hreflang, sitemap, robots, JSON-LD, redirects | route `generateMetadata`, `sitemap.ts`, `robots.ts`, `JsonLd.tsx` | slugMap, siteConfig | Spread across every routable page file | Confirmed |
| Forms & leads | Field library, renderer, spam, submissions, inquiries | `src/components/fields|forms/`, `src/lib/forms/`, `api/form-submissions`, `api/inquiries`, migration 005 | DS form tokens, localization, Supabase | Three component dirs: `fields/`, `form/`, `forms/` | Confirmed |
| Media | Upload/edit/tags APIs, admin UI, mediaAsset schema | `api/media/*`, `src/components/media/`, `(admin)/media/` | Sanity assets, image utils | | Confirmed |
| Admin & client dashboards | Abluo admin pages; client content/leads/analytics pages | `(admin)/*`, `(client)/*`, `src/components/admin/` | Supabase, Sanity APIs, permissions | Client dashboard maturity unassessed | Partially confirmed |
| Analytics | Vercel Analytics/SpeedInsights injection; client analytics page | `(website)/layout.tsx`, `(client)/analytics/` | — | Thin layer | Confirmed |
| Accessibility | Inline aria attributes only | section components | — | No dedicated owner/boundary exists today | Confirmed (absence) |
| Testing & review | vitest unit tests (DS resolver, module navigation/permissions/validation) | `vitest.config.ts`, 4 `__tests__` files | DS resolver, modules | No route/component/E2E coverage found | Confirmed |
| Release & deployment | release.sh/doctor.sh, tag pipeline, three-stage branch flow, Vercel | `scripts/`, `next.config.ts`, `release.json`, docs | git tags, CLAUDE.md rules | Version source-of-truth conflict (§7.4); Vercel config external to repo | Confirmed |
| Documentation | ADR log, living registers, runbooks, audits | `docs/`, repo root, `Abluo/` folder | all domains | Three storage locations, duplicated current-state docs | Confirmed |

## 10. Audit-Readiness Assessment (Step 9)

| Issue | Evidence | Impact on Phase 2 | Severity | Requires Clarification Before Audit? |
|---|---|---|---|---|
| Platform version ambiguity | Tag `V1.0.13` at HEAD vs `v1.0.2` in release.json/package.json; `next.config.ts` matches lowercase only; V1.0.6–V1.0.12 untagged | Audit must fix a definitive baseline version | High | Yes — which version string is authoritative for the baseline? |
| Conflicting tag/version conventions in docs | CLAUDE.md `V{version}` vs release-automation `v*` | Confuses release-workflow audit | Medium | Yes |
| `preview` branch not present locally | `git branch -a` lists no `preview` | Deployment-pipeline audit may need remote state | Medium | Yes — confirm remote branch set (sandbox cannot authenticate to GitHub) |
| Duplicated current-state docs | config-architecture.md vs abluo-configuration-audit.md; DEPLOYMENT.md vs release-workflow.md; ABLUO.md vs CLAUDE.md | Phase 2 must pick authoritative doc per area | Medium | No — Phase 2 can resolve with declared-successor evidence |
| Factual conflict on tenant key | ABLUO.md says `tenantSlug` isolates content; ADR-001/CLAUDE.md say `projectSlug` | Could mislead tenant-architecture audit if ABLUO.md is trusted | Medium | No — code evidence (queries) settles it |
| Two Sanity source directories | `src/sanity/` vs `src/lib/sanity/` + shims | Ownership mapping needs care | Low | No |
| Unclear status of DS refactor plan and older audit recommendations | `abluo-ds-refactor-plan.md` "Planning only"; audits from 2026-06 | Phase 2 must diff plans vs implementation | Medium | No — this is Phase 2 work |
| No codegen for Sanity types; manual sync | `src/lib/sanity/types.ts` hand-written | Content-contract audit must check schema↔type↔query drift manually | Medium | No |
| Test-count claims outdated | CLAUDE.md says 46 DS tests; memory says 53 forms tests; 4 test files exist | Testing audit should run vitest for ground truth | Low | No |
| Locale registry (7) vs message files (3) | `locales.ts` vs `messages/` | Localization audit question | Low | No |
| Hardcoded tenant maps in proxy.ts | `domainMap`, `projectMap` literals | Noted as fact; contradicts documented configuration-over-hardcoding principle — assessment deferred to Phase 2 | Medium | No |
| One-off scripts and historical docs mixed into repo root | §8 inventory | Noise for audit scoping; exclusions list mitigates | Low | No |
| Vercel/Supabase project configuration lives outside the repo | No vercel.json; Supabase migrations applied manually | Deployment/recovery audit partially blind from repo alone | Medium | Yes — decide whether Phase 2 may inspect Vercel/Supabase/Sanity live state via connected tools |

**Overall:** the repository is well-documented and ready for Phase 2, with three clarifications requested (baseline version, remote branch state, permission to inspect live Vercel/Supabase/Sanity state).

## 11. Proposed Phase 2 Audit Plan (Step 10)

| Audit Area | Repository Locations | Relevant Documentation | Previous Audits | Complexity | Suggested Depth | Key Questions |
|---|---|---|---|---|---|---|
| Overall architecture | `src/`, `sanity.config.ts`, `supabase/` | CLAUDE.md, architecture-decisions.md | adr-011-current-state | High | Deep | Do the seven non-negotiable principles hold in code? Where are the exceptions? |
| Tenant architecture | `proxy.ts`, `lib/tenant.ts`, schema (client/project), `tenants` table | ADR-001, ABLUO.md (conflicting) | — | High | Deep | Is projectSlug filtering universal in queries? How consistent is Sanity↔Supabase tenant identity? What is hardcoded per tenant (proxy maps, `livener/` components, `themes/livener/`)? |
| Frontend & components | `src/components/`, `(website)/` | CLAUDE.md motion/section rules | — | Medium | Medium | Component-signature consistency; duplication between route files; tenant-named vs platform components |
| Sections | `components/sections/`, schema section types | New Section Checklist | — | Medium | Medium | Are all 15 sections wired in all six checklist locations? Inline vs module-content split respected? |
| Modules | `lib/modules/` | ADR-009/010/011 set | ADR-011 review, current-state | High | Deep | Roadmap phase status vs adr-011-progress.md; registry validation coverage; section/module orthogonality in practice |
| Design System | `design-system-resolver.ts`, schema, buildCssVars | ADR-002–006/008, config-architecture.md | configuration + DS-inheritance audits, DS refactor plan | High | Deep | 5-step field checklist compliance; refactor-plan implementation status; token→CSS-var→component coverage |
| Sanity & Studio | `schema.ts` (135 KB), `sanity.config.ts`, fields/actions | TEMPLATE_ID_RULE.md, ownership docs | ownership verification docs | High | Deep | Schema modularity; template-ID rule adherence; Studio auth (studio route bypasses guard — confirm and assess) |
| GROQ & content contracts | `queries.ts`, `types.ts` | Routable Content Pattern | — | High | Deep | Schema↔type↔query drift (no codegen); locale-fallback rules; redirect queries complete per routable type (post route noted incomplete in CLAUDE.md) |
| Supabase | `supabase/`, `lib/supabase/`, API routes | schema.sql header, backup guide | user-management audit | Medium | Deep | RLS coverage per table; migration/schema.sql parity; service-role usage in API routes |
| AuthN/AuthZ & membership | `login/`, `proxy.ts`, `permissions.ts`, migrations 003–004 | user-management audit | user-management audit | Medium | Deep | Audit-plan execution status; role-helper usage vs direct role comparisons |
| Accessibility | sections, forms, nav components | none | none | Medium | Medium | Baseline WCAG state; keyboard/focus handling in interactive sections (FAQ, gallery, modal) |
| Editorial accessibility | Studio structure, dashboards | ADR-010, CHANGELOG V0.9.17 | — | Low | Light | Does the editor experience match the "no CMS complexity" promise? |
| Localization | `lib/i18n/`, `messages/`, localized field types | Localization sections of CLAUDE.md | — | Medium | Deep | 7-locale registry vs 3 message files; hardcoded-string rule compliance; two message-dictionary mechanisms |
| SEO | generateMetadata, sitemap.ts, robots.ts, JsonLd | Routable Content Pattern | — | Medium | Medium | hreflang completeness; sitemap per-locale correctness; canonical handling |
| Analytics | `(website)/layout.tsx`, `(client)/analytics/` | roadmap (Phase 5) | — | Low | Light | What exists vs planned; tenant-level data separation |
| Performance | next.config headers (`no-store` global), images, motion | — | — | Medium | Medium | Impact of global CDN no-store; image pipeline; bundle size |
| Testing | 4 test files, vitest config | CLAUDE.md testing section | — | Medium | Medium | Actual test counts; coverage gaps (routes, proxy, forms, GROQ); CI absence |
| Documentation | docs/, repo root, Abluo folder | §5–§7 of this report | all | Medium | Medium | Authoritative-doc designation per area; ADR casing/numbering cleanup scope; ADR-012 whereabouts |
| Release workflow & versioning | scripts/, next.config.ts, tags | release-automation/-workflow, CLAUDE.md | V0.8.2 post-mortem | Medium | Deep | Resolve V vs v; untagged V1.0.6–V1.0.12; doctor.sh check coverage |
| Deployment | Vercel (external), proxy domain maps | DEPLOYMENT.md, CLAUDE.md branch table | — | Medium | Medium | Repo-vs-Vercel config split; env parity dev/preview/prod |
| Recovery & rollback | backups/, backup branches, backup guide | v0.9.0 backup guide | — | Medium | Medium | Is recovery documented and rehearsed for Sanity, Supabase, and deploys independently? |
| Architectural debt | tenant hardcoding, dual sanity dirs, root scripts, legacy homePage type | CLAUDE.md "technical debt" mentions | all audits | Medium | Deep | Consolidated debt register with evidence |
| **Future orchestrator/agent workflow (evidence only)** | all of the above | this report §9 | — | — | Evidence-gathering | Which boundaries have clean file ownership vs cross-cutting checklists (new section = 6 locations; new DS field = 5 steps)? Which recurring task types exist (release, new section, new DS field, new module, new tenant, new locale)? Where do incidents cluster (release process, schema evolution, routing gaps)? What context does each domain minimally need? |

**Suggested Phase 2 sequencing:** (1) baseline fixing (version, branch state, live-state access) → (2) previous-audit implementation-status pass → (3) domain audits in dependency order: tenant architecture → Sanity/GROQ contracts → DS → modules → frontend/sections → Supabase/auth → localization/SEO → testing/release/deployment → cross-cutting (a11y, performance, debt) → (4) agent-workflow evidence synthesis.

## 12. Open Questions Requiring Clarification

1. **Authoritative platform version:** Is the baseline `V1.0.13` (HEAD tag) or `v1.0.2` (release-automation pipeline)? Should uppercase V1.0.3–V1.0.13 tags be treated as releases despite being invisible to the version pipeline?
2. **Remote branch state:** The local checkout has no `preview` branch. Confirm dev/preview/main all exist on origin and whether dev is ahead of preview/main (sandbox cannot authenticate to GitHub to check).
3. **Live-state access for Phase 2:** May the audit query live Sanity (MCP available), Supabase, and Vercel state, or must it remain repo-only?
4. **Authoritative doc per duplicated pair:** Confirm intended successors — `docs/config-architecture.md` over `abluo-configuration-audit.md`; `docs/release-workflow.md` over `Abluo/DEPLOYMENT.md`; `CLAUDE.md` over `ABLUO.md`.
5. **ADR-012:** referenced by `implementation-checklist.md` but not present in the ADR log — does it exist elsewhere?
6. **Message-file gap:** Are the 4 registry locales without `messages/*.json` files (fr, es, pt, nl) intentionally deferred?
7. **Report conventions going forward:** This report was saved to the `Abluo/` folder using the existing audit convention. Should Phase 2+ deliverables live here or in repo `docs/`?
   **Resolved (2026-07-10, Engineering Playbook v1.0 adoption):** Repo `docs/`. This report and its successors were relocated to `docs/engineering/`; architecture decisions live in `docs/architecture/`. See the Playbook's Documentation Strategy (§9).

---

**Compliance statement:** No files in `abluo-platform` or existing files in `Abluo/` were created, modified, deleted, moved, or renamed. No branches were switched, nothing was installed, committed, or deployed. The only file written is this report. No architectural recommendations or agent designs have been made.

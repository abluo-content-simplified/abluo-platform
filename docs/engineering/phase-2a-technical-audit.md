# Abluo Engineering System — Phase 2A: Technical Platform Audit
**Date:** 2026-07-10
**Scope:** Read-only technical assessment of `abluo-platform` at `dev` @ `136358a` (tag `V1.0.13`). Facts, evidence, assessment only. No roadmap, no agent design (Phase 2B).
**Baseline:** [Phase 1 report](./phase-1-discovery.md)
**Status:** Complete — reviewed; findings absorbed into [Engineering Playbook v1.0](./engineering-playbook.md)

**Audit baseline facts:** commit `136358a414b135e63432b1e82b9e69d2db4326b8`; tag at HEAD `V1.0.13`; release pipeline exposes `v1.0.2` (`release.json`, `package.json`, `next.config.ts` matches lowercase `v*` only). The inconsistency is recorded as finding T-01 and not resolved here.

**Live verification performed:** Sanity content queried read-only (project `3n7t84j3`/production). Deployed-site fetches (`abluo.app`, `livener.net`) timed out from this session; Vercel MCP rate-limited. Vercel/deployed-state findings are repo-evidence only.

**Verification runs:** `npx tsc --noEmit` → clean (exit 0). `npx vitest run` → **194 tests, 192 pass, 2 fail** (both 5 s timeouts on dynamic `import('../registry')` in `navigation.test.ts:231` and `validate.test.ts:581`; import phase took 6.28 s in sandbox — likely environment-induced; re-run locally to confirm).

---

## 1. Technical Platform Assessment

### 1.1 Architecture & repository organisation

**A-1 · Declarative core layers are strong.** Module registry (`src/lib/modules/registry.ts`, fully declarative per ADR-011 D3, validated by `validateRegistry` + tests), DS inheritance (`design-system-resolver.ts`, single `DS_FIELDS_SELECTION` projection), locale registry (`src/lib/i18n/locales.ts`), centralized role helpers (`src/lib/permissions.ts`). Why it matters: these are the platform's reuse backbone and they follow their own ADRs. Action: none — preserve. Confidence: High.

**A-2 · `schema.ts` is a 135 KB monolith.** 60 `defineType` calls in one file (`src/lib/sanity/schema.ts`); module schemas already extracted (`lib/modules/*/schema.ts`) prove the split pattern works. Why: single file is the highest-traffic merge/context hotspot; every section, DS field, and page change touches it. Action: continue the module-style extraction for platform types. Confidence: High.

**A-3 · Dual Sanity directories.** `src/sanity/` holds Studio actions/components plus re-export shims (`src/sanity/queries.ts`, `types.ts` → "use @/lib/sanity in new files"). Why: two import paths for one layer; shims invite drift. Action: fold `src/sanity/` into `src/lib/sanity/` (or document why not). Confidence: High.

**A-4 · SectionRenderer + hydration duplicated across two route files.** `(website)/[tenant]/page.tsx` and `[tenant]/[slug]/page.tsx` each contain the full switch (13 `case` labels + MediaContentSection + blogListingSection hydration). Verified in parity today; the June 2026 routing gap (CLAUDE.md post-mortem) was exactly this duplication failing. Why: parity is maintained by checklist, not by code. Action: extract one shared SectionRenderer + hydration module. Confidence: High.

**A-5 · One-off scripts and historical docs in repo root.** `convert-colors.js`, `migrate-martegani.js`, `test-template.js`, `VERIFY_OWNERSHIP.sh`, 9 historical `.md`, 10 build logs (Phase 1 §8). Why: noise, unclear active surface. Action: archive directory or delete. Confidence: High.

### 1.2 Multi-tenancy

**MT-1 · Content isolation holds in practice.** 29 of 31 GROQ blocks in `queries.ts` filter `projectSlug == $projectSlug` (the others are locale/domain lookups). Live Sanity check: **0 published tenant-scoped documents missing `projectSlug`** (pages 6, posts 8, events 4, siteConfigs 3, designSystems 5/1 template, projects 4, clients 5). Why: ADR-001 is enforced. Confidence: High.

**MT-2 · Tenant identity maps are hardcoded in ≥3 places.** `proxy.ts` (`domainMap` + `projectMap`), `src/lib/sanity/client.ts:17` (`livener: 'livener-main', studiomartegani: …`, "add a new entry when onboarding"), `src/app/sitemap.ts:6` (reverse map). Why: violates the repo's own "never hardcode project slugs/domains" rule (CLAUDE.md Configuration Over Hardcoding); onboarding a tenant = code deploy touching 3+ files. Action: single tenant-resolution source (Sanity `project`/`client` docs or config). Confidence: High.

**MT-3 · Tenant-specific code path in the shared layout.** `(website)/[tenant]/layout.tsx:473` — `if (tenantId === 'livener') { …~55-line special branch… }` with its own CSS-var build, nav, background graphic; generic path is "studiomartegani and future tenants" (line 528). Also `nav-links.ts:87` hardcodes `['livener']`, `live/page.tsx` imports `components/livener/live/LivePageContent`, and `components/livener/{Nav,Footer}` serve as the platform chrome under a tenant name. Why: direct violation of Platform Before Tenant; the 11th tenant inherits Livener's branch logic. Action: merge the Livener branch into the generic path behind siteConfig flags; rename `components/livener/` to platform names. Confidence: High.

**MT-4 · Sanity data completeness gaps.** 4 projects but 3 siteConfigs; 5 clients but 4 projects. Why: at least one project has no siteConfig (routes depending on it will fall back or 404). Action: verify intent per project (may be pre-onboarding stubs). Confidence: High (counts); Low (whether it's a defect).

### 1.3 Modules

**M-1 · Registry architecture is the best-documented subsystem.** Manifests declare pageType/collections/sectionTypes/permissions; `validate.ts` enforces structural rules (67 assertions grep-counted); navigation derives Studio structure declaratively. Evidence: `lib/modules/*`, ADR-009/010/011 chain. Confidence: High.

**M-2 · Two module tests fail in this environment** (timeouts, see header). Why: if reproducible locally, the release gate (`npx vitest run` per CLAUDE.md pre-commit checklist) is red at HEAD; if not, tests are environment-fragile. Action: re-run locally; either fix or raise `testTimeout` for the registry-import tests. Confidence: High that they fail here; Medium on root cause.

**M-3 · Module lifecycle is registry-complete but installation-partial.** `migrations/002-module-installations.ts` exists; `moduleInstallation` handling in Studio present; no per-tenant install/uninstall UI beyond Studio `ModuleList`/`StubPane`. Why: matches ADR-011 roadmap position, not a defect. Action: none for audit. Confidence: Medium.

### 1.4 Sections

**S-1 · All 15 section components are wired in both routes** (13 switch cases + `mediaContentSection` + hydrated `blogListingSection` — identical lists in both files). The New Section Checklist is being followed post-incident. Confidence: High. Weakness = structural (see A-4).

**S-2 · Editor previews incomplete.** 40 `preview:` blocks for 60 schema types. Why: types without `preview.prepare` show raw IDs/undefined in Studio lists — editor-experience gap contra "no CMS complexity". Action: inventory which 20 lack previews; add where editor-visible. Confidence: Medium (count is coarse).

**S-3 · Sections respect the animation rule.** No timing/easing found in Sanity content; durations/easings read from `designSystem.motion` with hardcoded choreography (spot-checked HeroSection, FAQSection, MediaContentSection). Confidence: Medium (spot check).

### 1.5 Design System

**DS-1 · Inheritance pipeline is coherent and tested.** `resolveDesignSystemInheritance` (depth ≤5) → `mergeDesignSystems` → `buildCssVars`; export/import actions are field-agnostic; DS resolver test file is the largest suite. Confidence: High.

**DS-2 · `buildCssVars()` lives inside a route file** (`[tenant]/layout.tsx`) and is invoked twice there (Livener branch + generic branch). Why: DS runtime output coupled to routing; the 5-step checklist sends every DS field change into a page file. Action: extract to `lib/sanity/` or `lib/design-system/`. Confidence: High.

**DS-3 · The 5-step DS checklist is manual with no drift guard.** Schema field ↔ `DS_FIELDS_SELECTION` ↔ merge logic ↔ CSS var ↔ test are synchronized by discipline; nothing fails automatically if step 2 or 3 is skipped (a missed merge silently falls back to parent). Why: same failure class as the MetricsSection incident. Action: a consistency test (enumerate schema DS fields vs projection keys) would close the loop — noted as observation, design belongs to Phase 2B. Confidence: High.

### 1.6 Sanity Studio & schemas

**SA-1 · Studio is publicly reachable with no auth.** `proxy.ts:120` explicitly skips the auth guard for `/studio`; `Abluo/CLAUDE.md` confirms production `admin.abluo.app/studio` requires no login. Sanity's own login applies inside Studio, but the route (and its JS bundle incl. schema/structure) is world-readable. Why: exposure of admin surface + relies solely on Sanity session for content of all tenants. Action: decide deliberately — gate `/studio` behind Supabase auth or record the accepted risk. Confidence: High.

**SA-2 · Schema validation exists but alt text is not required.** Single `alt` field definition (`schema.ts:103`) with no `validation` requiring it. See accessibility A11y-P2. Confidence: Medium.

**SA-3 · Legacy `homePage` type still active** (`schema.ts:3217`, template `homePageProjectOwned`, exported). CLAUDE.md marks it legacy; the New Section Checklist still requires adding sections to it. Why: every section costs double schema wiring for a deprecated type. Action: complete `homePage` → `page` migration and remove. Confidence: High.

### 1.7 Content contracts (GROQ / types)

**CC-1 · Types are hand-maintained with no codegen; currently consistent.** `types.ts` (35 KB) mirrors schema manually; `tsc --noEmit` clean. Why: consistency is unverified at the schema↔GROQ boundary (GROQ results are cast, not checked). Action: consider `sanity typegen` extraction as a candidate; evaluation belongs to Phase 2B. Confidence: High (state), Medium (risk level).

**CC-2 · Routable-content pattern is implemented beyond its documentation.** `post` has full routes (`blog/page.tsx`, `blog/[slug]/page.tsx`, `postBySlugQuery`, `postByOldSlugQuery`), but CLAUDE.md's routable table still says "⚠️ Schema done, no route yet". Documentation drift — see D-2. Confidence: High.

### 1.8 Frontend

**F-1 · Form component sprawl: three directories.** `components/fields/` (16-type field library), `components/form/` (2 localized Studio inputs), `components/forms/` (EarlyAccess + FormRenderer). Why: unclear ownership; new contributors guess wrong. Action: consolidate or document the split. Confidence: High.

**F-2 · shadcn/ui is a dependency but barely present.** `components/ui/` contains only `button.tsx` + `CtaButton.tsx`; `shadcn` and `radix-ui` are in `package.json`. Why: stack docs promise shadcn/ui; actual UI is mostly bespoke — dependency weight without usage. Action: either adopt or remove. Confidence: Medium (admin dashboard may use radix directly — not exhaustively checked).

**F-3 · Global CDN `no-store`.** `next.config.ts` sets `Cache-Control: no-store` on `/(.*)` to fix a middleware/404 caching issue. Why: disables CDN caching for all tenant sites — a performance tax accepted as a workaround; comment documents why. Action: revisit with route-scoped caching. Confidence: High (config), Medium (real-world impact unmeasured).

### 1.9 Supabase

**SB-1 · RLS is enabled on all 6 tables with a coherent policy model** — membership-scoped policies for tenants/profiles/tenant_members/leads/projects (schema.sql:151–330, `SECURITY DEFINER` helpers). `inquiries` has RLS enabled with **no policies** (deny-all; admin-client only; explicitly documented as "Future policy model", migration 005:138–150). Assessment: deliberate lockdown, acceptable. Confidence: High.

**SB-2 · CRITICAL — API routes are unauthenticated, and middleware never sees them.** `proxy.ts` matcher excludes `/api` entirely (`matcher: ['/((?!api|_next/static|…).*)']`). Route files contain no session checks:
- `api/media/route.ts` GET/POST and `api/media/[id]/route.ts` PATCH/DELETE create/patch/delete Sanity documents using `SANITY_API_WRITE_TOKEN` (lines 8, 162, 54, 134) — unauthenticated write/delete of media for any tenant.
- `api/media/migrate/route.ts` POST patches assets (line 75) — unauthenticated bulk mutation.
- `api/fix-colors/route.ts` GET issues Sanity patches (line 89) — unauthenticated mutation via a simple GET.
- `api/media/verify-token/route.ts` returns `tokenPreview: token.substring(0,10)` (line 31) — leaks write-token prefix + validity to any caller.
- `api/inquiries/[id]/route.ts` PATCH updates inquiry status via admin client with no auth (POST on `api/inquiries` is a public form endpoint with spam checks — that one is fine).
- `api/sanity/document/route.ts` GET exposes arbitrary document reads (no tenant scoping check found).
Why: anyone who can reach the admin deployment origin can mutate content and enumerate documents. Live exploitability not verified (site fetches timed out; Vercel protection settings unknown), but repo evidence is unambiguous. Action: add auth (Supabase session + role check) to every mutating route; delete `fix-colors` and `verify-token` if they are finished utilities; scope `sanity/document`. Confidence: High (code), Medium (live exposure).

**SB-3 · Migrations vs schema.sql parity is manual.** `schema.sql` header instructs "run migrations in order" for existing DBs and claims to reflect 001–005. Not machine-checked. Action: note only. Confidence: Medium.

### 1.10 Localization

**L-1 · Locale registry (7) vs message files (3) is a latent runtime error, not a clean intentional gap.** `routing.ts` derives `locales` from all 7 registry codes; `src/i18n/request.ts` does `await import(\`../../messages/${locale}.json\`)` with no fallback — a request under `/fr`, `/es`, `/pt`, `/nl` throws at import time. The registry's own header says adding a language requires the messages file (locales.ts step 2), so the 4 file-less locales violate the registry's own contract. Determination requested by Phase 2A inputs: **partially intentional** (registry pre-seeded for content locales) but **currently unsafe as implemented**. Action: add a fallback in `request.ts` (e.g. default-locale messages) or trim `LOCALE_CODES` used by routing. Confidence: High (code path), Medium (runtime behavior unverified live).

**L-2 · Hardcoded user-facing strings exist on the public website path.** `[tenant]/layout.tsx:493` — `locale === 'it' ? 'Richiedi accesso anticipato' : 'Get Early Access'` fallback CTA. Violates the repo's own "no hardcoded user-facing strings" rule (websites are not an allowed exception). Admin-only hardcoded strings (`components/media/UploadDialog.tsx` placeholders etc.) fall under the documented exception — acceptable. Action: move fallback to locale dictionary or siteConfig. Confidence: High.

**L-3 · Two parallel dictionary mechanisms.** next-intl `messages/*.json` (admin UI) + custom `src/lib/i18n/*-messages.ts` modules (website components: contact/form/event/news/theme-switcher). Both are documented patterns, but the boundary is implicit. Action: document the rule (or converge). Confidence: High.

### 1.11 SEO

**SEO-1 · Solid per-route implementation.** `generateMetadata` + `JsonLd` on all 8 tenant route files; `sitemap.ts` + `robots.ts` present; localizedSlug + redirect queries per Routable Content Pattern; hreflang built from slugMap. Confidence: High (presence), Medium (correctness — hreflang/canonical output not verified live due to fetch timeouts).

**SEO-2 · `<html lang="en">` is hardcoded** (`src/app/layout.tsx:40`) for every locale and every tenant site. Why: wrong document language on `/it`, `/de` pages — SEO signal and screen-reader pronunciation defect in one line. Action: set `lang` from the active locale (next-intl standard pattern). Confidence: High.

**SEO-3 · Sitemap depends on its own hardcoded tenant map** (`sitemap.ts:6`) — new tenants silently absent from sitemaps until code changes. Same root cause as MT-2. Confidence: High.

---

## 2. Accessibility Assessment

No WCAG compliance claim is made. Split by verification method.

### 2.1 Current implementation — automatically verifiable (code inspection)

| Check | State | Evidence | Assessment |
|---|---|---|---|
| Document language | ✗ | `layout.tsx:40` `lang="en"` hardcoded for all locales | Defect (SEO-2) |
| Headings | ~ | `<h1>` only in hero sections + page titles; sections use h2/h3 | Reasonable default; multiple heroes on one page ⇒ multiple h1s possible (editor-dependent) |
| FAQ accordion | ~ | `FAQSection.tsx:30-33` real `<button>` + `aria-expanded`; no `aria-controls`/region id found | Partial |
| Modal (EarlyAccess) | ✓ | `EarlyAccessModal.tsx:23-83, 750-752` — focus trap, Tab cycling, Escape close, `role="alert"` errors, `role="radiogroup/listbox/option"` | Strong |
| Form labels | ✓ | `FieldWrapper.tsx:51-52` `<label htmlFor={id}>`; validation messages localized (`lib/forms/validation-messages.ts`) | Good; `aria-invalid`/`aria-describedby` not found — gap |
| Image alt | ~ | Sections use fallback chains `alt={coverImage?.alt ?? title ?? ''}` (`BlogListingSection.tsx:104` etc.) | Alt plumbed through; falls back to title (suboptimal) or `''` |
| Reduced motion | ✗/~ | `useReducedMotion` only in `HeroLensSection`, `HeroLiveCaptureSection`; **no** reduced-motion handling in `SlideUp`/`FadeIn`/`StaggerChildren`/`ParallaxImage` (grep empty) | All standard section entrance animation ignores `prefers-reduced-motion` |
| Skip link | ✗ | No skip-to-content found in layouts | Missing |
| Decorative elements | ✓ | `aria-hidden="true"` on background graphics (`[tenant]/layout.tsx:485`) | Good |

### 2.2 Current implementation — requires manual verification
Colour contrast (tenant-controlled via DS tokens — no automated check exists anywhere in the pipeline), keyboard traversal of nav drawer and gallery, focus-visible styling under each tenant DS, live-region behavior of form success/error states, screen-reader order of section layouts, video/live-capture hero behavior.

### 2.3 Platform perspective — does Abluo encourage accessible sites?
- **Positive:** DS centralisation means a contrast fix propagates to all tenants; animation primitives are the single place to implement reduced-motion globally; semantic section components mean editors cannot produce broken markup.
- **Negative:** no contrast validation on DS colour tokens (a tenant can publish an inaccessible palette without warning); alt not required at schema level (`schema.ts:103`, no validation rule); no a11y testing, linting (`eslint-config-next` includes some jsx-a11y rules — coverage not assessed), or documentation anywhere in repo or docs folder (Phase 1 confirmed absence).
- Net: architecture is *well-positioned* for accessibility-by-default but does not yet *enforce* it. Confidence: High.

### 2.4 Editorial workflow perspective
- **Positive:** media upload/edit dialogs prompt "Describe the image for accessibility" (`UploadDialog.tsx:246`, `EditSheet.tsx:260`) — an explicit editorial nudge. Planned AI alt-text generation (CLAUDE.md) would strengthen this.
- **Negative:** alt is skippable; no guidance on heading structure, link text, or contrast anywhere in the editor surface; Studio previews (S-2) don't surface a11y state. Confidence: Medium.

---

## 3. Documentation Assessment

Authority order applied: `CLAUDE.md` → `docs/config-architecture.md` → `docs/release-workflow.md` → `docs/release-automation.md`.

**D-1 · Completeness is unusually high for a solo project.** ADR log with 11 decisions, incident post-mortems encoded as process rules, paired runbook/tooling docs, living field register. Confidence: High.

**D-2 · Drift in the top-authority document.** CLAUDE.md errors found this audit: routable-content table says `post` has "no route yet" (routes exist — CC-2); testing section says "46 tests / 1 test file" (194 tests / 4 files); prescribes capital `V{version}` tags while Release Automation v2 (`release.sh`, `next.config.ts`) requires lowercase and ignores capital tags. Why: the #1 authority feeding every future session contains stale facts. Action: correct these three sections. Confidence: High.

**D-3 · Duplicated current-state documents persist** (Phase 1 §7): `config-architecture.md` vs `Abluo/abluo-configuration-audit.md`; `docs/release-workflow.md` vs `Abluo/DEPLOYMENT.md`; `CLAUDE.md` vs `ABLUO.md` (which still names `tenantSlug` as the isolation key — factually superseded by ADR-001). Action: mark historical docs as superseded in-file. Confidence: High.

**D-4 · ADR-012 does not exist.** Searched once as instructed: only reference is `docs/implementation-checklist.md:5` ("Applies to: ADR-011, ADR-012, and all future…"). Recorded as a **missing architecture reference** — the checklist anticipates an ADR that was never written. Confidence: High.

**D-5 · Convention inconsistencies** (carried from Phase 1, unchanged): ADR file casing (`ADR-011-*` vs `adr-011-*`), ADR-008 ordered before ADR-007 in the log, three build-log naming patterns, historical implementation notes in repo root. Confidence: High.

---

## 4. Technical Debt Register

| # | Item | Evidence | Classification |
|---|---|---|---|
| TD-1 | Unauthenticated mutating API routes + token-prefix leak | SB-2; `proxy.ts:385` matcher excludes `/api` | **Blocking** |
| TD-2 | Version pipeline split-brain (uppercase tags invisible; V1.0.6–V1.0.12 untagged; package.json/release.json at 1.0.2) | header facts; `next.config.ts` | **Blocking** (releases currently misreport version) |
| TD-3 | `/fr`,`/es`,`/pt`,`/nl` routes throw (missing message files, no fallback) | L-1; `request.ts` | **Address Soon** |
| TD-4 | Livener special-case branch in shared tenant layout + `components/livener/*` as platform chrome + `nav-links.ts:87` | MT-3 | **Address Soon** |
| TD-5 | Tenant maps hardcoded in `proxy.ts`, `client.ts`, `sitemap.ts` | MT-2, SEO-3 | **Address Soon** |
| TD-6 | `<html lang>` hardcoded `en` | SEO-2 | **Address Soon** (1-line class of fix) |
| TD-7 | SectionRenderer + hydration duplicated across 2 route files | A-4 | **Address Soon** |
| TD-8 | 2 failing tests at HEAD (env-sensitivity unresolved) | M-2 | **Address Soon** |
| TD-9 | Legacy `homePage` type doubles section wiring | SA-3 | **Address Soon** |
| TD-10 | `schema.ts` monolith (135 KB / 60 types) | A-2 | **Address Soon** |
| TD-11 | Reduced motion ignored by core animation primitives | A11y §2.1 | **Address Soon** |
| TD-12 | Hardcoded CTA fallback strings on public site | L-2 | **Address Soon** |
| TD-13 | `/studio` publicly reachable, Supabase guard bypassed by design | SA-1 | **Address Soon** (or record accepted risk) |
| TD-14 | Global CDN `no-store` workaround | F-3 | **Acceptable** (documented; revisit) |
| TD-15 | Dual Sanity directories + re-export shims | A-3 | **Acceptable** |
| TD-16 | Three form component directories | F-1 | **Acceptable** |
| TD-17 | shadcn/radix dependencies vs 2-file `ui/` | F-2 | **Acceptable** |
| TD-18 | Hand-maintained Sanity types (no codegen/drift guard) | CC-1, DS-3 | **Acceptable** (until schema volume grows) |
| TD-19 | Root-level one-off scripts + historical docs | A-5 | **Acceptable** |
| TD-20 | CLAUDE.md stale facts (post route, test counts, tag case) | D-2 | **Address Soon** (cheap, high leverage) |
| TD-21 | ADR-012 referenced but missing | D-4 | **Acceptable** (record) |
| TD-22 | `inquiries` RLS deny-all (documented future model) | SB-1 | **Acceptable** |

---

## 5. Platform-Principles Alignment (evidence-referenced)

| Principle | Verdict | Key evidence |
|---|---|---|
| Simplicity over complexity | Largely met | Declarative registry, tiny dashboards; counter: schema monolith (A-2) |
| Reusable modules | Met in architecture | M-1; lifecycle partially built (M-3) |
| Editor-first design | Partially met | ADR-009/010 Studio IA; gaps: 20 types without previews (S-2), no editorial a11y guidance (§2.4) |
| Multi-tenant by design | Met in data, violated in code | MT-1 (isolation holds) vs MT-2/MT-3 (hardcoded tenants, Livener branch) |
| Accessibility by default | Not yet met | §2 — good primitives (modal, labels), missing enforcement (lang, reduced motion, contrast, required alt) |
| Consistent Design System | Met | DS-1; risk: manual 5-step sync (DS-3) |
| Incremental evolution | Met | Checkpoint tags, migrations, phased ADR roadmaps |
| Strong documentation | Met with drift | D-1 vs D-2/D-3/D-4 |
| Predictable releases | Not currently met | TD-2: pipeline reports v1.0.2 at a V1.0.13 HEAD; 7 releases untagged; 2 failing tests at HEAD (M-2) |

---

## 6. Master Assessment Table

| Area | Current State | Evidence | Strengths | Weaknesses | Suggested Action | Expected Benefit | Category | Priority | Effort | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| API security | Mutating routes without auth; middleware skips `/api` | SB-2 | Admin client pattern exists | Unauthenticated Sanity write/delete, token-prefix leak, mutating GET | Auth every mutating route; remove `fix-colors`, `verify-token`; scope `sanity/document` | Closes content-integrity hole across all tenants | Fix | P0 | M | High (code) / Medium (live) |
| Versioning & release | Split-brain: tag `V1.0.13` vs pipeline `v1.0.2`; V1.0.6–12 untagged | header; `next.config.ts`; tag list | Automation v2 well designed (doctor+release.sh) | Tooling abandoned after v1.0.2; CLAUDE.md prescribes conflicting case | Re-adopt release.sh (or update its convention); backfill/declare tags | Deployed version truthful; rollback targets exist | Fix | P0 | S | High |
| Testing | 194 tests / 4 files; 2 fail (timeout) at HEAD; tsc clean | M-2; vitest run | DS resolver + module suites are real | No route/API/component/E2E tests; failing gate; docs claim 46 tests | Fix/timeout the 2 tests; add API-route auth tests first | Trustworthy release gate | Fix | P0 | S–M | High |
| Localization runtime | 7 routing locales, 3 message files, no import fallback | L-1 | Registry design is right | `/fr` etc. throw; gap violates registry's own contract | Fallback in `request.ts` or constrain routing locales | No 500s on enabled locales | Fix | P1 | S | High |
| Tenant hardcoding | Maps in 3 files; Livener branch in shared layout; `livener` chrome components | MT-2, MT-3, SEO-3 | Isolation itself is sound (MT-1) | Own architecture rules violated; onboarding = multi-file code change | Config-driven tenant resolution; fold Livener branch into generic path | "New tenant without deploy" success metric becomes reachable | Fix | P1 | M–L | High |
| Frontend duplication | SectionRenderer ×2; three form dirs; shims | A-4, F-1, A-3 | Currently in parity | Checklist-maintained parity already failed once | Shared renderer module | Removes a whole incident class | Optimise | P1 | S | High |
| Accessibility | Good modal/labels; missing lang, reduced-motion, skip link, contrast/alt enforcement | §2 | Central primitives = cheap global fixes | Defaults don't enforce a11y; no checks anywhere | `lang` from locale; reduced-motion in SlideUp/FadeIn; require alt or default decorative; jsx-a11y lint | Platform-level a11y for every tenant at once | Fix+Build | P1 | S–M | High |
| Design System | Inherited, tested, single projection | DS-1 | Best-engineered subsystem | `buildCssVars` in route file; manual 5-step sync | Extract builder; add field-parity test | DS changes stop touching routes | Optimise | P2 | S | High |
| Sanity schema/Studio | 60 types, one file; Studio public; legacy homePage; 20 types w/o preview | A-2, SA-1, SA-3, S-2 | Structure tool per-project scoping works | Monolith, public admin surface, double wiring | Split schema; gate /studio; retire homePage; add previews | Maintainability + editor UX + reduced surface | Fix+Optimise | P2 | M | High |
| Content contracts | Manual types, tsc clean, live data consistent | CC-1, MT-1 | Zero live isolation violations | No schema↔type↔query drift guard | Evaluate typegen (Phase 2B) | Drift caught by CI not incidents | Optimise | P2 | M | Medium |
| Supabase | RLS complete; inquiries deny-all documented | SB-1 | Coherent membership policy model | Parity schema.sql↔migrations manual | none urgent (API auth is the P0, tracked above) | — | Optimise | P3 | S | High |
| SEO | Metadata/hreflang/JSON-LD/sitemap implemented | SEO-1 | Routable pattern followed | `lang="en"`; sitemap tenant map hardcoded; live output unverified | Fix lang; config-driven sitemap; verify live once reachable | Correct signals per locale | Fix | P2 | S | High/Medium |
| Documentation | Extensive; authority doc has 3 stale facts; ADR-012 missing | D-1–D-5 | ADRs + post-mortems exceptional | Drift in CLAUDE.md misleads every future session | Correct CLAUDE.md; mark superseded docs; write or unreference ADR-012 | Reliable single source | Fix | P1 | S | High |
| Modules | Declarative, validated, tested | M-1–M-3 | Cleanest subsystem | Lifecycle incomplete (by roadmap) | Continue ADR-011 phases | — | Build | P3 | — | High |
| Performance | Global `no-store`; images via Sanity CDN | F-3 | Documented tradeoff | No CDN caching for any tenant page | Route-scoped caching revisit | TTFB/cost improvement | Optimise | P3 | M | Medium |

Priority = ordering signal within this audit's findings only (implementation planning is Phase 2B).

---

**Compliance:** No repository, Sanity, Supabase, or Vercel state was modified. Sanity access was one read-only GROQ count query. The only file written is this report.

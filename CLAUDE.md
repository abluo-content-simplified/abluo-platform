# Abluo — Project Intelligence

## Authority

This file is the **implementation handbook** — the *how*, within the Playbook's *why/what*. It is not the highest authority. `docs/engineering/engineering-playbook.md` (v1.0) is the highest engineering authority. Governed engineering work runs through the Engineering Agent System — orchestrator + specialist agents + context packs + Standard Handoff — entry point `docs/engineering/agent-system/README.md`. Where this file conflicts with the Playbook or an accepted ADR, the Playbook/ADR wins and this file is corrected. See `docs/engineering/agent-system/context-spine.md` §1 for the full authority order.

## Session conventions

- `next-env.d.ts` build churn is restored, never committed: `git checkout -- next-env.d.ts`.
- Sandboxed sessions use `git --no-optional-locks <cmd>` for all git reads (the sandbox FUSE mount cannot unlink its own lock files); stale-lock cleanup on Tom's machine follows the guarded procedure in `docs/engineering/agent-system/packs/release-engineering.pack.md` ("Phase-end repository cleanup & handoff readiness", item 4) — never delete a lock or kill a process without first confirming a git process actually owns it.
- Before giving Tom any stage/commit/push/tag/deploy guidance, the phase-end readiness procedure in `docs/engineering/agent-system/packs/release-engineering.pack.md` runs first.
- Terminal guidance to Tom is one command at a time; evaluate the actual output before giving the next (`.claude/agents/orchestrator.md`).
- Every configurable concept has exactly one configuration surface (ADR-014); enforced by `src/lib/sanity/__tests__/settings-structure.test.ts`.
- Notifications fire at workflow boundaries only — completion, blocked-on-Tom, long-run finish — never per handoff (`.claude/agents/orchestrator.md`).

## What Abluo Is

Abluo is a multi-tenant website management platform for small professional practices — dentists, therapists, consultants, studios. It provides premium websites with a minimal editorial interface, AI-assisted publishing, and zero CMS complexity for clients.

Abluo is NOT trying to be WordPress, HubSpot, Webflow, or a full marketing suite. It is focused.

---

## Configuration Over Hardcoding

Abluo is a reusable multi-tenant platform. Avoid hardcoded values whenever a value may vary by client, project, locale, environment, design system, or deployment.

Prefer: configuration, schema fields, design system tokens, environment variables, and reusable abstractions.

Never hardcode: project slugs, tenant names, domains, locales, navigation structures, design system values, or feature availability by tenant.

If a value may reasonably change in the future, it should be configurable. Hardcoding is acceptable only when the value is truly platform-wide, introducing configuration would add unnecessary complexity, or there is a documented architectural reason.

**Correct**
- Reading supported locales from configuration
- Reading design tokens from the design system
- Using project metadata to determine routing
- Using environment variables for environment-specific behavior

**Incorrect**
- Hardcoding `"livener"` or `"studiomartegani"` inside application logic
- Hardcoding locale lists inside reusable components
- Hardcoding domains inside routing logic
- Creating tenant-specific code paths when a reusable solution is possible

---

## Platform Before Tenant

Abluo is a platform, not a collection of custom websites. When implementing a feature: (1) design the platform solution, (2) verify it works for the current tenant, (3) avoid tenant-specific implementations whenever a reusable solution is practical.

Always ask: *"How would this work for the next ten tenants?"* before finalizing an implementation.

Prefer: reusable abstractions, configuration-driven behavior, shared components, shared content models, and design system inheritance.

Avoid: tenant-specific conditionals, duplicated components for individual tenants, custom routing logic for individual tenants, and special-case implementations that cannot scale across projects.

If a tenant-specific solution is temporarily required, document it clearly and treat it as technical debt to be removed later.

---

## Architectural Principles

These are non-negotiable. A future session that violates any of these is building something wrong.

1. **`projectSlug` is the universal tenant key.** Every Sanity document that belongs to a tenant carries `projectSlug`. All GROQ queries must filter by it. `tenant_id` does not exist.
2. **`DS_FIELDS_SELECTION` is the single GROQ source of truth for design system fields.** Adding a DS field anywhere else first is wrong.
3. **Animations belong to components, never to content.** No timing, easing, or animation logic lives in Sanity documents.
4. **Clients never see Sanity.** The client dashboard is their only interface.
5. **Content Localization ≠ Interface Localization.** They are separate systems. Never derive one from the other.
6. **Routable document types obey the five-requirement checklist.** No shortcuts. See *Publicly Routable Content Pattern*.
7. **Sections and Modules are orthogonal. Never couple them.** A section is a presentation component. A module owns content, business logic, filtering, permissions, and management UI. A section may render inline content or module-managed content — it never owns business data itself. Proposing a new "section that stores its own managed data" is the wrong abstraction: split it into a section (presentation) + module (data). See *Section Library vs Modules* below.

---

## Who Uses It

**Abluo Admin (Tom)** — manages all clients, websites, design systems, schemas, and infrastructure. Has full Sanity access.

**Client** — never sees Sanity. Uses a minimal dashboard to write blog posts, manage leads, and view analytics. The experience must work on a phone.

---

## Infrastructure

| Layer | Tool | Purpose |
|---|---|---|
| CMS | Sanity | All website content — pages, blog posts, design systems, media |
| Auth + Leads | Supabase | Authentication, lead storage, operational data |
| Frontend | Next.js 16 | Website rendering + both dashboards |
| Styling | Tailwind CSS v4 + shadcn/ui | UI components |
| Hosting | Vercel | Deployments per client domain |

---

## Tech Stack

- **Next.js 16.2.6** — App Router, RSC, TypeScript
- **Tailwind CSS v4**
- **shadcn/ui** — component library
- **Sanity** — headless CMS
- **Supabase** — auth and leads
- **Vercel** — hosting
- **motion/react** — animation (via `SlideUp`, `FadeIn`, `AnimatePresence`)
- **Lucide** — icons
- **vitest** — unit testing

---

## Client / Project Data Model

The Sanity data hierarchy is:

```
client
  └── project (projectSlug)
        ├── designSystem     (scoped by projectSlug)
        ├── siteConfig       (scoped by projectSlug)
        ├── page             (scoped by projectSlug)
        ├── event            (scoped by projectSlug)
        └── post             (scoped by projectSlug)
```

- `client` has a `tenantSlug` used in URLs and subdomain routing.
- `project` has a `projectSlug` — this is the universal tenant identifier for all content.
- Every GROQ query for tenant content must include `&& projectSlug == $projectSlug`.
- The Studio structure enforces scoping: each project pane lists only documents for that `projectSlug`.
- Non-routable types that are never URL-addressable: `client`, `project`, `designSystem`, `siteConfig`, `mediaAsset`.

---

## Design System Inheritance

### Roles

Every `designSystem` document has a `role` field:
- `template` — not assigned to any project (e.g. Abluo Base). Acts as the platform default.
- `active` — assigned to a project via `projectSlug`. Inherits from a template via `parentDesignSystem`.

### Inheritance chain

```
Abluo Base (template, no projectSlug)
  └── Tenant DS (active, projectSlug = "livener", parentDesignSystem → Abluo Base)
```

`resolveDesignSystemInheritance()` walks the parent chain recursively (max depth 5). `mergeDesignSystems(parent, child)` applies child values over parent — child wins on any field that is set; unset child fields fall back to parent.

### Single source of truth

`DS_FIELDS_SELECTION` in `src/lib/sanity/queries.ts` is the only GROQ projection for design system fields. Every query that fetches a design system uses it. **Do not project DS fields anywhere else.**

### Checklist for adding a new DS field

All five steps are required. Skipping any breaks inheritance or CSS output.

1. Add field to `designSystem` type in `src/lib/sanity/schema.ts`
2. Add field to `DS_FIELDS_SELECTION` in `src/lib/sanity/queries.ts`
3. Add merge logic in `mergeDesignSystems()` in `src/lib/sanity/design-system-resolver.ts`
4. Add CSS variable output in `buildCssVars()` in `src/app/[locale]/(website)/[tenant]/layout.tsx`
5. Add inheritance test in `src/lib/sanity/__tests__/design-system-resolver.test.ts`

### Export / Import

`ExportDesignSystemAction` and `ImportDesignSystemAction` are field-agnostic. They strip only the five Sanity metadata keys (`_id`, `_rev`, `_createdAt`, `_updatedAt`, `_type`). All content fields — including new ones — pass through automatically. Adding a new DS field requires **zero changes** to Export/Import code.

---

## Motion Token Pipeline

### Tokens

`MotionTokens` (in `types.ts`) contains:
- 4 durations as **millisecond integers**: `durationFast`, `durationBase`, `durationSlow`, `durationSlower`
- 4 easings as **CSS cubic-bezier strings**: `easingStandard`, `easingDecelerate`, `easingAccelerate`, `easingEmphasized`

Stored in `designSystem.motion`, inherited through the DS chain like all other fields.

### Pipeline

```
Sanity → resolveDesignSystemInheritance() → buildCssVars() → CSS vars → section components
```

CSS variables emitted: `--motion-duration-{fast,base,slow,slower}`, `--motion-easing-{standard,decelerate,accelerate,emphasized}`.

### Usage in components

```ts
const m = designSystem?.motion
const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35  // ms → seconds
const ease: string | number[] = m?.easingDecelerate ?? [0.0, 0.0, 0.2, 1]
```

Pass `ease` directly to `SlideUp`/`FadeIn` — motion/react accepts CSS cubic-bezier strings natively.

### Conventions

| Token | Use case |
|---|---|
| `durationSlower` | Hero section entrance |
| `durationSlow` | Content section entrances (ContentSection, TextSection, etc.) |
| `durationFast` | UI interactions — accordion open/close, icon rotation, toggles |
| `easingDecelerate` | All entrance animations (elements entering the viewport) |

### Animation primitives

**Only use these. Never write raw CSS keyframes.**

- `SlideUp` — scroll-triggered, slides up + fades in (`whileInView`)
- `FadeIn` — scroll-triggered, fades in only (`whileInView`)
- `AnimatePresence` + `motion.div` — for show/hide interactions (accordion, conditional content)

Stagger delays between elements in a section are hardcoded in the component (choreography). Duration and easing always come from `designSystem.motion`.

---

## Section / Pages Architecture

Pages are assembled from an ordered array of typed sections stored in Sanity.

### SectionRenderer

Lives in `src/app/[locale]/(website)/[tenant]/page.tsx`. For each section it:
1. Computes `surface` via `computeSectionSurface(section.background, backgroundPattern, sectionIndex)`
2. Passes `section`, `surface`, and `designSystem` to the matching section component

All section components share this signature: `({ section, surface, designSystem })`.

### Available section types

`HeroSection`, `ContentSection`, `TextSection`, `TreatmentsSection`, `TeamSection`, `FAQSection`, `ContactSection`

### Surfaces

Derived from `siteConfig.backgroundPattern` + optional per-section `background` override. Values: `transparent`, `solid`, `glass`.

### Rule

Animations belong to section components. Sanity stores content — not timing, easing, motion, or animation logic.

---

## Section Library vs Modules

Sections and Modules are orthogonal layers. **Never couple them.**

### Sections — presentation layer

A section is a presentation component. It decides how and where content is displayed. A section may contain:
- **Inline content** — fields stored directly on the section object in Sanity (suitable for small or one-off content)
- **Module-managed content** — rendered from data owned by a module (posts, events, FAQs, team members, etc.)

A section never owns business data, manages collections, or enforces permissions.

### Modules — content and business layer

A module owns: document types, editorial collections, filtering logic, permissions, categories, Studio management UI, and APIs. It does not decide where its content appears on a page — that is the section's job.

### Examples

| Section | What it does |
|---|---|
| Hero Section | Inline content — platform section template |
| Blog Listing Section | Renders content from the Blog Module |
| Events Section | Renders content from the Events Module |
| FAQ Section | Inline FAQs or content from a future FAQ Module |
| Team Section | Inline team members or content from a future Team Module |
| Gallery Section | Inline images or content from a future Media Library Module |

### Platform Section Library

Some sections are platform assets — available to every tenant regardless of which modules are installed:
- `heroLensSection`
- `heroLiveCaptureSection`

These live in `src/lib/sanity/schema.ts` as platform-owned types. Their availability is never gated by any module's installation state. Installing or uninstalling a module must not affect which platform sections are available to SectionRenderer.

Module `platformContract.sectionTypes` declares sections that belong to the module. Platform sections are not listed in any module manifest.

### When proposing new features

If a proposed "section" would also own and manage a collection of documents, it is the wrong abstraction. Split it:
1. A **Module** to own the data (documents, collections, filtering, permissions, Studio UI)
2. A **Section** to present that data on a page

---

## Multilingual-First Principle

Abluo is multilingual by default.

**Never assume a website, page, form, component, CTA, modal, email, notification, success message, validation message, or content type is single-language unless explicitly documented otherwise.**

### When implementing new functionality

- Keep all user-facing text localization-ready.
- Do not hardcode English strings directly into components.
- Store text in locale dictionaries, configuration objects, or Sanity content.
- Do not hide, disable, or alter locale switching based on tenant-specific assumptions.
- Do not assume a tenant currently using one language will remain single-language.
- Any new content model must be evaluated for multilingual requirements before implementation.

### Examples

**Correct**
- CTA labels are localized.
- Form field labels are localized.
- Validation messages are localized.
- Success and error messages are localized.
- Blog categories support localization.
- Navigation labels support localization.

**Incorrect**
- Hardcoded English strings inside React components.
- Hiding the language switcher because one tenant currently uses one language.
- Creating form schemas that cannot be translated later.
- Building content structures that require migrations to become multilingual.

**When in doubt, choose the multilingual-ready solution.**

### Rule: No hardcoded user-facing strings in components

User-facing strings must never be hardcoded inside React components.

All user-facing text must come from:
1. Sanity content
2. Locale dictionaries
3. Configuration objects specifically designed for localization

**Exceptions** (hardcoding is acceptable):
- Developer-only debug messages
- Internal logging
- Database status values (`'new'`, `'contacted'`, `'archived'`, etc.)
- API field names

### Rule: Reusable components must be language-agnostic

New reusable components may not contain hardcoded user-facing text.

User-facing text must come from:
- Localized dictionaries
- Sanity content
- Explicitly injected configuration objects

Reusable components should be language-agnostic.

### Localization Requirements — complete checklist

Abluo is multilingual by default. All user-facing text must be localizable.

Reusable components must not contain hardcoded:
- Labels
- Placeholders
- Button text
- Validation messages
- Success messages
- Error messages
- Helper text
- Empty states
- Aria labels

Text must come from:
- Locale dictionaries (`getXMessages(locale)` pattern)
- Sanity content
- Configuration objects

**Exceptions** — hardcoding is acceptable in:
- Admin-only interfaces
- Sanity Studio utilities
- Developer tooling
- Test fixtures

When building new features, multilingual support is the **default assumption** unless explicitly documented otherwise.

---

## Localization Architecture

There are two completely separate localization concerns. They must never be conflated.

### 1. Interface Localization

**What it is:** The language of the Abluo platform UI — admin dashboard labels, buttons, error messages.

**Mechanism:** `next-intl` translation files in `/messages/` (e.g. `en.json`, `it.json`). Locale determined by URL prefix, controlled by `src/i18n/routing.ts`.

**TypeScript type:** `SupportedLocale` — the union of all UI-translated locales.

### 2. Content Localization

**What it is:** The language(s) of a tenant's website content.

**Mechanism:** `siteConfig.supportedLocales` per tenant. GROQ queries receive `$locale` and `$defaultLocale` and resolve content via `coalesce(field[$locale], field[$defaultLocale], field.en)`.

**Schema:** `localizedString`, `localizedText`, `localizedPortableText` store one value per platform locale. Tenants fill only the locales they use.

### The Rule

> **Interface Localization = platform-wide, next-intl, `routing.ts`**
> **Content Localization = per-tenant, Sanity, `siteConfig.supportedLocales`**

The set of locales in `routing.ts` must cover every content locale any tenant might use — next-intl parses the URL prefix before the tenant config is fetched. A locale in `siteConfig.supportedLocales` that is absent from `routing.ts` will 404.

---

## Publicly Routable Content Pattern

Any Sanity document type that generates a public URL **must** satisfy all five requirements. This is a closed checklist — not a set of guidelines.

| Type | Route | Status |
|---|---|---|
| `page` | `/[locale]/[tenant]/[slug]` | ✅ Complete |
| `event` | `/[locale]/[tenant]/events/[slug]` | ✅ Complete |
| `post` | `/[locale]/[tenant]/posts/[slug]` | ⚠️ Schema done, no route yet |
| `homePage` | `/[locale]/[tenant]` | N/A — always at root, no slug |

Non-routable types: `client`, `project`, `designSystem`, `siteConfig`, `mediaAsset`, all embedded section and object types.

### Requirement 1 — Schema

```ts
defineField({ name: 'slug', type: 'localizedSlug', ... })
defineField({ name: 'redirectFrom', type: 'redirectFrom', ... })
```

Never use `type: 'slug'` for a routable document. `localizedSlug` stores one slug per locale: `{ en: { _type: 'slug', current: '...' }, it: { _type: 'slug', current: '...' } }`.

### Requirement 2 — GROQ Queries

Three queries required per routable type:

**Primary lookup** — no locale fallback on the slug:
```groq
*[_type == "thing" && projectSlug == $projectSlug && slug[$locale].current == $slug][0] {
  "slugMap": slug,
  "redirectFrom": redirectFrom,
  ...other fields...
}
```

**Redirect lookup:**
```groq
*[_type == "thing" && projectSlug == $projectSlug && $slug in redirectFrom[$locale]][0] {
  "currentSlug": slug[$locale].current
}
```

**List queries** — resolved slug for display (locale fallback is fine here):
```groq
"slug": { "current": coalesce(slug[$locale].current, slug[$defaultLocale].current) }
```

Content fields still use `coalesce(field[$locale], field[$defaultLocale], field.en)` — the no-fallback rule applies only to URL routing.

### Requirement 3 — Route (Next.js page.tsx)

```ts
const thing = await fetchForTenant(thingBySlugQuery, { slug, locale, defaultLocale })

if (!thing) {
  const r = await fetchForTenant(thingByOldSlugQuery, { slug, locale })
  if (r?.currentSlug) redirect(`/${locale}/${tenantId}/things/${r.currentSlug}`)
  notFound()
}

const slugMap: SlugMap = {}
if (thing.slugMap) {
  for (const [loc, slugObj] of Object.entries(thing.slugMap)) {
    if (slugObj?.current) slugMap[loc as SupportedLocale] = slugObj.current
  }
}
return <SlugMapProvider slugMap={slugMap}>...</SlugMapProvider>
```

`generateMetadata` must include hreflang alternates from `siteConfig.supportedLocales` + `thing.slugMap`. Only include locales where a slug is set.

### Requirement 4 — Sitemap

Add entries to `src/app/sitemap.ts`. One URL per locale, only where `slug[locale].current` is set.

### Requirement 5 — Migration

If existing documents have the old flat `slug.current` format, extend `src/lib/sanity/migrations/001-localize-slugs.ts`. The migration uses `siteConfig.defaultLocale` — never a hardcoded locale.

---

## Testing

- **Runner:** vitest
- **Test file:** `src/lib/sanity/__tests__/design-system-resolver.test.ts`
- **Current count:** 46 tests

```bash
npx vitest run
```

Any change to `design-system-resolver.ts` requires a corresponding test. Any new DS field requires tests for: (a) child overrides parent, (b) child inherits parent when field is unset.

---

## Deployment Workflow

Abluo uses a three-stage deployment pipeline. **Never push unreviewed changes directly to `main`.**

### Branches

| Branch | Environment | Domain |
|---|---|---|
| `dev` | Developer testing | `dev.abluo.app` |
| `preview` | Client / tenant review | `preview.abluo.app` |
| `main` | Production | `abluo.app` |

### Release Process

1. Implement and test changes on `dev` — ordinary descriptive commits, no version prefix.
2. Run `npx tsc --noEmit`, `npx vitest run`, and `npm run build` — all must pass.
3. Push `dev`. Not every commit is a release — cut a release only when shipping through to production: `./scripts/release.sh <version> "<title>"` (tags `dev` at that point; see "Versioning and Deployment" below).
4. **Stop. Wait for Tom to verify on `https://dev.abluo.app`.**
5. Only after explicit approval: promote `dev → preview` (`--ff-only`) and push.
6. **Stop. Wait for Tom to verify on `https://preview.abluo.app`.**
7. Only after explicit approval: promote `preview → main` (`--ff-only`) and push.
8. Verify production on `https://abluo.app`, including the `/api/version` truth-check.

**The word "Stop" above is literal.** Do not proceed to the next stage without confirmation, even if the changes seem trivially safe. Full command sequences: `docs/release-workflow.md`.

### Git Commands (default pattern)

Ordinary commits are **descriptive, no version prefix** (e.g. `git commit -m "fix: ..."`, `"feat: ..."`) — verified against commit history since `b78dccc`. Versioned releases are cut with `./scripts/release.sh <version> "<title>"` (lowercase annotated tag `vX.Y.Z`), never a hand-written `git tag`. Promotions between stage branches are `--ff-only`.

The full command sequences, STOP gates, hotfix workflow, and rollback procedure are authoritative in **`docs/release-workflow.md`** — do not duplicate them here; follow that runbook. Summary only:

```bash
# Daily work on dev — descriptive commits, no version prefix
git commit -m "feat: ..."
git push origin dev

# Cut a release on dev (see docs/release-workflow.md §2)
./scripts/release.sh v1.0.2 "Release Title"

# Promote — ff-only, after each STOP is cleared (see docs/release-workflow.md §3–4)
git checkout preview && git merge --ff-only dev && git push origin preview
git checkout main && git merge --ff-only preview && git push origin main
git checkout dev   # always return to dev after a promotion
```

When suggesting git commands, always default to the `dev → preview → main` flow unless explicitly instructed otherwise.

### What Caused V0.8.2 to Bypass the Workflow

In session on 2026-06-17, the merge sequence became tangled during a context-limited conversation:

- `dev` had uncommitted V0.8.2 changes
- A `git stash` failed silently, so changes carried through a branch switch
- The session then ran `git checkout preview && git merge dev` without pausing for dev verification
- This triggered Vercel to build `preview`, which then got merged to `main` — skipping the explicit hold points
- Result: a broken build (middleware conflict) landed on production

**Lessons encoded here:**

1. Each stage now has an explicit **Stop** instruction — no implicit continuation.
2. `--no-edit` is added to all merge commands to prevent vim/editor prompts from disrupting the flow.
3. The pre-commit build check (`npm run build`) is now part of the release process, not just tsc + vitest.
4. If `git stash` fails for any reason, stop and diagnose before switching branches.

### Middleware Convention (Next.js 16)

Next.js 16 uses **`src/proxy.ts`** as the middleware entrypoint — not `middleware.ts`. This is a Next.js 16 convention change. `proxy.ts` must export:

```ts
export async function proxy(request: NextRequest) { ... }
export const config = { matcher: [...] }
```

**Never create `src/middleware.ts`.** If both files exist, Next.js 16 will refuse to build with:
> "Both middleware file and proxy file are detected. Please use proxy.ts only."

---

## Versioning and Deployment

There is **one version concept — the Platform Version** — carried by a lowercase annotated git tag `vX.Y.Z` (no capital `V`; four-segment forms are rejected). It is the single source of truth; there is no separate "engineering version." A release is cut on `dev` with `./scripts/release.sh <version> "<title>"`, which regenerates `release.json` + `package.json`, runs the deterministic build gate, creates the release-marker commit (`release: vX.Y.Z - Title`), tags, and pushes `dev` + the tag. Ordinary commits between releases stay descriptive with no version prefix.

Authoritative runbook: **`docs/release-workflow.md`** (command sequences, STOP gates, hotfix, rollback). Do not duplicate its content here.

- **Post-deploy truth-check:** `https://abluo.app/api/version` must report `platformVersion` equal to the tag just promoted.
- **Pre-commit checklist:** `npx tsc --noEmit` clean, `npx vitest run` passing, `npm run build` passing (the release gate enforces the build; run it before any release-cutting commit).
- **Git push:** must be done from the local terminal. The sandbox cannot authenticate to GitHub over HTTPS.

---

## Design Principles

- Calm, elegant, minimal
- Premium but not corporate
- Mobile-first for the client dashboard
- No complexity exposed to clients
- Animations and motion belong to components, not content
- Strong design system foundation — all visual tokens flow from `designSystem`

---

## What NOT to Build (Yet)

- Advanced role management
- Complex billing
- CI/CD pipelines
- Full marketing analytics suite

Keep asking: *"What is the simplest version that proves the concept?"*

---

## Static Page Content

Static pages (About, Services, Contact, etc.) are managed by the Abluo admin in Sanity. Clients do not manage static content — this keeps the client interface minimal.

---

## Analytics & Site Verification

Third-party integrations (GA4, GTM, Meta Pixel, custom scripts) are registry-driven — `src/lib/integrations/` (manifests + `INTEGRATION_REGISTRY`) is the single source of truth; adding one is registering one manifest, never a bespoke schema field. Admins configure them in Studio **Project Settings → Integrations**, which writes `project.integrationConfigs`; each integration is independently switched on via its own `enabled` field — there is no single "all tracking" flag.

Privacy policy is a separate, cross-integration surface: **Project Settings → Privacy** edits `project.privacy` — `consentModeEnabled` and a `trackingKillSwitch` (an emergency override that blanks all tracking regardless of individual integration state).

At runtime, `TrackingScripts.tsx` reads `project.integrationConfigs` + `project.privacy` (fetched via `projectIntegrationsQuery`, `src/lib/sanity/queries.ts`) and resolves what renders through the pure `resolveTracking()` helper (`src/lib/tracking/resolve.ts`): kill switch first, then per-integration `enabled === true`. Scripts emit in production only. ADR-013's consent semantics (fail-closed under `consentModeEnabled`, `necessary`-category custom scripts never gated) carry over unchanged.

Verification tokens (`googleSiteVerification`, `bingSiteVerification`) are not tracking — they live in `siteConfig`'s SEO group (**Website Settings → SEO**) and always render, in every environment.

Custom-script security rules are unchanged: admin-vetted only, disabled by default, no secrets in `code`, and a required `description` + `consentCategory` per script.

Authority: ADR-014 (Integration Registry & Studio IA) plus ADR-013's carried-over policy sections (security, consent).

---

## AI Features (Planned)

- Generate excerpt / abstract from article
- Generate FAQ from article content (for SEO and AEO)
- Generate SEO metadata (title, description, keywords)
- AI writing assistant for blog posts
- Auto-translation for multilingual sites
- Alt-text generation for images

---

## GitHub

Organization: `abluo-content-simplified`
- `abluo-platform` — main platform codebase
- `abluo-playground` — experiments and UI prototypes (never deployed)

---

## Schema Evolution Rules

Before changing the type of an existing Sanity field, you must check whether documents already exist with that field populated. Changing a field type without migrating existing content causes Studio validation errors and may silently break GROQ queries.

**Required steps before any field type change:**

1. Query Sanity to check whether documents exist: `*[defined(field)][0..5]`
2. Inspect the actual stored data shape — not what you expect, what is actually there.
3. If no documents exist with that field, the change is safe.
4. If documents exist, you must either write a migration or create a new field and deprecate the old one.
5. Document the migration strategy before implementing the change.

**Field type changes that always require migration planning:**

- `string` → `localizedString`
- `string` → `reference`
- `reference` → `array(reference)`
- `number` → `string`
- `localizedString` → `string`
- Any object type → a different object type

**What a type mismatch causes:**

- Studio shows validation errors ("Expected type X, got Y") on documents with the old format.
- GROQ queries may silently return `null` if the accessor pattern does not match the stored shape.
- Published documents are never automatically migrated — they retain the old format until republished.

**Migration pattern for `string` → `localizedString`:**

Check the stored data first:
```
*[_type == "myType" && defined(myField) && _type(myField) == "string"] { _id, myField }
```
If any documents are found, patch them to convert the string value into a localizedString object before deploying the schema change.

**Root cause of the June 2026 MetricsSection incident:**

The `value` field in `metricItem` was initially created as `type: 'string'`. Content was entered and published. The field was then changed to `type: 'localizedString'` without checking whether published documents existed. The published document retained the old string format, causing a Studio type mismatch. The draft was already correct (the user had re-entered values in the new format), so the fix was to publish the draft rather than run a migration. This could have been avoided by querying Sanity before changing the type.

---

## Localization Rules

Abluo is multilingual-first. Any user-visible content field should be assumed to require localization unless there is a documented specific reason it does not.

**Decide at field creation time** whether a field should be:
- `localizedString` — short text that may differ by locale (labels, titles, headlines, values, CTAs)
- `localizedText` — longer text (descriptions, intros, body copy)
- `localizedPortableText` — rich text
- Non-localized — only for fields that are inherently language-neutral

**Non-localized fields are those that are genuinely locale-independent:**
- Numeric settings (grid columns, animation duration, z-index)
- Boolean flags (animateNumber, featured, required)
- Enum selectors (background surface, layout, imagePosition)
- Internal identifiers and keys
- URLs and slugs (slugs use the `localizedSlug` type — not a plain string)
- Technical references

**Do not create a field as `string` and convert it to `localizedString` later.** Content entered in the string format will be invalid against the new schema and will require migration. The cost of deciding at creation time is zero; the cost of migrating after content exists is non-trivial.

**Examples of fields that must be localized:**

- Section eyebrow, headline, description
- Card labels, values, captions
- Button labels and CTA text
- Form field labels, placeholders, validation messages
- Navigation labels
- Any metric value that could differ by region (e.g. `£10bn+` vs `€10bn+`)
- Any string that could be translated

**Examples of fields that must NOT be localized:**

- `animateNumber` (boolean)
- `background` (surface selector)
- `imagePosition` (enum)
- `maxItems` (number)
- `filterMode` (enum)

---

## New Section Checklist

Every new Sanity section type must be verified across all six locations before it is considered complete. A section that renders in one route but not the other is incomplete.

| Location | What to check |
|---|---|
| `schema.ts` — type definition | `defineType` with all fields, validation, preview |
| `schema.ts` — sections arrays | Added to both the `page` type and the legacy `homePage` type |
| `schema.ts` — type export | Added to the `export default` types array |
| `types.ts` | Interface defined, added to `PageSection` union |
| `queries.ts` | Fields projected in `homePageQuery`, `pageHomeQuery`, and `pageBySlugQuery` |
| `[tenant]/page.tsx` | Component imported, `case` added to `SectionRenderer` |
| `[tenant]/[slug]/page.tsx` | Component imported, `case` added to `SectionRenderer` |
| Studio preview | `preview.prepare` returns a meaningful title and subtitle |

**If a section requires server-side data hydration** (e.g. `blogListingSection` fetches posts), the hydration logic must be duplicated in both `page.tsx` and `[slug]/page.tsx`. A hydration function in only one route is a bug.

**Root cause of the June 2026 routing gap:**

`MetricsSection` and `BlogListingSection` were both wired into `[tenant]/page.tsx` but not into `[tenant]/[slug]/page.tsx`. The Investors page renders via the slug route, so neither section appeared. The GROQ query already included the fields — only the SectionRenderer cases were missing. This would have been caught immediately by the checklist.

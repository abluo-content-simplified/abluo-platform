# Abluo — Project Intelligence

## What Abluo Is

Abluo is a multi-tenant website management platform for small professional practices — dentists, therapists, consultants, studios. It provides premium websites with a minimal editorial interface, AI-assisted publishing, and zero CMS complexity for clients.

Abluo is NOT trying to be WordPress, HubSpot, Webflow, or a full marketing suite. It is focused.

---

## Architectural Principles

These are non-negotiable. A future session that violates any of these is building something wrong.

1. **`projectSlug` is the universal tenant key.** Every Sanity document that belongs to a tenant carries `projectSlug`. All GROQ queries must filter by it. `tenant_id` does not exist.
2. **`DS_FIELDS_SELECTION` is the single GROQ source of truth for design system fields.** Adding a DS field anywhere else first is wrong.
3. **Animations belong to components, never to content.** No timing, easing, or animation logic lives in Sanity documents.
4. **Clients never see Sanity.** The client dashboard is their only interface.
5. **Content Localization ≠ Interface Localization.** They are separate systems. Never derive one from the other.
6. **Routable document types obey the five-requirement checklist.** No shortcuts. See *Publicly Routable Content Pattern*.

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

1. Implement and test changes on `dev`.
2. Run `npx tsc --noEmit`, `npx vitest run`, and `npm run build` — all must pass.
3. Commit to `dev` and push.
4. **Stop. Wait for Tom to verify on `https://dev.abluo.app`.**
5. Only after explicit approval: merge `dev → preview` and push.
6. **Stop. Wait for Tom to verify on `https://preview.abluo.app`.**
7. Only after explicit approval: merge `preview → main`, tag the release, push.
8. Verify production on `https://abluo.app`.

**The word "Stop" above is literal.** Do not proceed to the next stage without confirmation, even if the changes seem trivially safe.

### Git Commands (default pattern)

```bash
# Commit to dev
git checkout dev
git add <files>
git commit -m "V{version}: description"
git push origin dev

# Promote to preview — only after Tom confirms dev.abluo.app is working
git checkout preview && git merge dev --no-edit && git push origin preview

# Promote to production — only after Tom confirms preview.abluo.app is working
git checkout main && git merge preview --no-edit
git tag V{version}
git push origin main --tags

# Always return to dev after a promotion
git checkout dev
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

- **Versioning:** semver. Tag format: `V{major}.{minor}.{patch}` (capital V)
- **Build logs:** one file per release — `build-log-V{version}.txt` in the repo root. Never overwrite an existing log.
- **Pre-commit checklist:**
  1. `npx tsc --noEmit` — must be clean
  2. `npx vitest run` — all tests must pass
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

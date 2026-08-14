# ADR-020 Module Rework — Status

## Done

- [x] Code written, all gates green — `tsc` clean, 646 tests, build passing
- [x] Committed: `6dbb90b` + `ac2bd1e` (37 files)
- [x] Pushed to `origin/dev`
- [x] Sanity production content migrated (see below)

## Not done

- [ ] Verify on `localhost:3000/studio`
- [ ] Promote `dev` → `preview` → `main`
- [ ] Post-production cleanup (see Later)

---

## Sanity content — already live, nothing for you to run

Applied and verified in the `production` dataset:

- `moduleInstallations` backfilled — was `null` on every project.
  `livener-main` → blog, events, live, forms · `studiomartegani-main` → blog
- Martegani's WhatsApp number + form moved into `whatsapp` module config
- Livener's header-CTA form + attribution moved into `forms` module config
- `enabledModules` left in place as a rollback bridge — deliberately not unset

Record of what ran: `src/lib/sanity/migrations/004-typed-module-installations.ts`

---

## What changed in the code

**Modules pane is interactive**, at the top level of each website. Status /
Placement / Configuration / Data per module. Writes single array entries by
`moduleId`, so concurrent edits don't clobber.

**Studio IA:** Content (Pages · Collections · Media) · Design System · Modules ·
Website Settings. "Change Design System" merged into the Design System pane as a
third view.

**WhatsApp is a module.** Header-CTA form moved to Forms module config.
`ctaLabel` / `ctaHref` stay in Website Settings — they're navigation, not form
config. Runtime dual-reads: module config first, deprecated `siteConfig` fields
as fallback, so nothing breaks before production is promoted.

**News module** — `newsArticle` / `newsCategory` / `newsPage` /
`newsListingSection`, with `/news` and `/news/[slug]`.

**`enabledModules` no longer read** anywhere. Field still declared for rollback.

---

## Verify (localhost)

```bash
npm run dev
```

- `localhost:3000/studio` → pick a website → **Modules** is a top-level item.
  Open WhatsApp on Studio Martegani: number `+39 335 207 211` and its message
  form should already be filled in. Toggle a module off and on; it should save.
- Design System → the pane should have **Edit / Preview / Change** views.
- `studiomartegani.localhost:3000` → contact section WhatsApp button still works.
- `livener.localhost:3000` → header CTA still opens the Early Access overlay.

## Later — only after production is promoted and healthy

- Remove `whatsappNumber` / `whatsappForm` / `whatsappFloating` / `ctaForm` /
  `ctaInternalName` from `siteConfig`; drop the fallback branches in
  `src/lib/modules/config.ts`; remove the `enabledModules` field; unset the
  legacy data.
- Client-dashboard pages for News / Events / Live — i18n labels exist, but no
  `MODULE_DASHBOARD_ROUTES` entry, so no nav item appears.
- `BlogListingSection` formats dates with a hardcoded `'en'` and hardcodes
  `"min read"` — Italian and German sites render English there.
  `NewsListingSection` already handles this correctly.

## Open decision

Two published `project` docs share `projectSlug: "abluo"` (`38cf9381-…`,
`5bae4e91-…`), plus three unpublished `abluo` drafts. Neither has modules, so
nothing was written to either — but any per-project write keyed on slug is
ambiguous until this is resolved.

## Blocked

Vercel has no build for either commit; latest deployment is still `da5e90f`.
Dev-branch deploys stopped firing before this work, so it's pre-existing.
Check **Vercel → abluo-platform → Settings → Git**.

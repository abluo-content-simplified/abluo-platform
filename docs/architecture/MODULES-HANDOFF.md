# Module System Rework — Handoff

Read with **ADR-020**. This note is current status + what remains.

## Status: all phases implemented, gates green, ONE commit landed

`npx tsc --noEmit` clean · `npx vitest run` 646 passing (was 546) · `npm run build` passing.

| Phase | State |
|---|---|
| Review agents, orphan cleanup, branding de-dup | committed `da5e90f` (previous session) |
| Module config contract + generated Sanity shape | **committed `6dbb90b`** |
| Interactive Modules pane + Studio IA | implemented, **uncommitted** |
| Communications config → modules | implemented, **uncommitted** |
| News module | implemented, **uncommitted** |

---

## ⚠️ Blocked: stale git lock (needs one command from Tom)

The sandbox FUSE mount cannot `unlink()`, so `git commit` succeeds but leaves
`.git/HEAD.lock` behind. That stale lock then blocks every later commit — which
is why only the first phase landed.

**Verified before recommending this** (per the release-engineering guarded
procedure): `.git/HEAD.lock` is 0 bytes, and `ps aux | grep git` shows no git
process running. It is an orphaned artifact, not an in-flight operation.

```bash
cd ~/Abluo/abluo-platform
rm -f .git/HEAD.lock
rm -rf .tmptest                 # empty dir left by the sandbox; not deletable from it
rm -f .git/objects/*/tmp_obj_*  # orphaned loose-object temp files, same cause
git status
```

Then commit the remaining work in three commits (messages below), or as one if
you prefer.

---

## Commit 2 — Interactive Modules pane + Studio IA

```
sanity.config.ts
src/lib/sanity/studio/ModuleList.tsx
src/lib/sanity/fields/ProjectLinker.tsx
src/lib/sanity/queries.ts        (enabledModuleIdsQuery only)
src/lib/sanity/schema.ts         (enabledModules comment)
src/lib/sanity/migrations/004-typed-module-installations.ts
```

The Modules pane is no longer read-only. Every module opens with the same four
parts — Status (writes `moduleInstallations[].enabled`), Placement (derived from
the manifest, read-only), Configuration (generated from `configSchema`), Data.

Writes target one array entry by `moduleId` (`insert('replace', …)` / `append`),
never the whole array, so two admins editing two modules cannot clobber each
other. Config validation runs only while a module is enabled — blocking
deactivation on an incomplete field would trap you in the state you're leaving.
Installed version is preserved on save rather than bumped to the registry
version; divergence is surfaced instead, which is the point of versioning.

Studio IA per website: **Content** (Pages · Collections · Media) · **Design
System** · **Modules** · **Website Settings**. Project Settings keeps account
infra only. The redundant "Change Design System" item is merged into the Design
System pane as a third view (Edit / Preview / Change).

Legacy `enabledModules` reads are gone from `sanity.config.ts`,
`enabledModuleIdsQuery`, and `ProjectLinker`. The field stays **declared but
unread** as a rollback bridge — the dataset is shared across dev/preview/prod,
so production runs older code until `main` is promoted.

## Commit 3 — Communications config into modules

```
src/lib/modules/registry.ts      (whatsapp module; forms configSchema)
src/lib/modules/config.ts        (new — runtime resolvers)
src/lib/modules/index.ts
src/lib/modules/sections.ts
src/lib/modules/__tests__/config.test.ts    (new)
src/lib/modules/__tests__/permissions.test.ts
src/lib/sanity/queries.ts        (FORM_DEFINITION_PROJECTION, projectModuleConfigQuery)
src/lib/sanity/schema.ts         (siteConfig deprecations)
src/components/sections/{SectionRenderer,ContactSection}.tsx
src/app/[locale]/(website)/[tenant]/{layout,page,[slug]/page,blog/page,events/page,live/page}.tsx
messages/{en,it,de}.json
```

WhatsApp is a real module owning number / message form / floating button.
The header-CTA form + attribution name move to **Forms** module config;
`ctaLabel` and `ctaHref` stay on `siteConfig` because they are navigation
properties, not form config.

**Dual-read, per your call.** `resolveWhatsAppConfig` / `resolveHeaderCtaConfig`
read module config first and fall back to the deprecated `siteConfig` fields.
Those fields are now `hidden: true` with deprecation descriptions, so nothing new
can be authored into them. Removing the fallback is a follow-up **after
production is promoted** — see "Remaining" below.

Two incidental improvements the work forced:

- `FORM_DEFINITION_PROJECTION` extracted in `queries.ts`. The form projection
  existed as **six byte-identical inline copies**; module config would have been
  the seventh. Verified safe by rendering all 38 exported query strings before
  and after and diffing — zero differences.
- Page routes now issue **one** query (`projectModuleConfigQuery`) where they
  previously issued `enabledModuleIdsQuery` separately; `getEnabledModuleIds()`
  derives gating from the same result, preserving the load-bearing null-vs-`[]`
  distinction (unresolved fails open, resolved-empty gates).

## Commit 4 — News module

```
src/lib/modules/news/{schema.ts,sections.tsx}      (new)
src/lib/modules/registry.ts
src/lib/modules/sections.ts
src/lib/modules/__tests__/news-module.test.ts      (new)
src/lib/i18n/news-module-messages.ts               (new)
src/components/sections/NewsListingSection.tsx     (new)
src/components/portable-text/article-components.tsx (new)
src/app/[locale]/(website)/[tenant]/news/{page.tsx,[slug]/page.tsx}  (new)
src/app/[locale]/(website)/[tenant]/blog/[slug]/page.tsx
src/app/sitemap.ts
src/lib/sanity/{schema,types,queries}.ts
messages/{en,it,de}.json
```

`newsArticle` / `newsCategory` / `newsPage` / `newsListingSection`, registered
v1.0.0, with `/news` and `/news/[slug]` routes. Satisfies all five requirements
of the Publicly Routable Content Pattern — `localizedSlug`, `redirectFrom`, the
three GROQ queries (primary lookup with **no** locale fallback), the route with
301 redirect + hreflang + `SlugMapProvider`, sitemap entries. No migration
needed: the type is new, so no documents carry an old flat slug.

Deliberate differences from Blog, not oversights: no author (news is published
by the organisation), no `byEvent` filter (News integrates with nothing), and
**localized dates and reading-time strings** — `BlogListingSection` formats with
a hardcoded `'en'` and a hardcoded `"min read"`, which renders Italian and German
sites in English. That bug is not reproduced in News; it is still present in
Blog (see Remaining).

Also extracted `articlePortableTextComponents` — ~75 lines of presentational JSX
that would otherwise have been duplicated between the two detail routes.

---

## Sanity content — already applied to `production`

Both migrations were run and verified live (published, not left as drafts).

1. **Typed module installations.** `moduleInstallations` was `null` on *every*
   project — migration 002 was never applied. It also could not be reused: array
   members now need a `_type` discriminator, and 002's hardcoded module map
   predates the Forms module. `004-typed-module-installations.ts` is the
   replacement and is the record of what ran.
   - `livener-main` → blog, events, live, forms
   - `studiomartegani-main` → blog
2. **Communications config.** `studiomartegani-main` gained a `whatsapp`
   installation carrying its number `+39 335 207 211` and message form;
   `livener-main`'s `forms` config gained `ctaForm` → early-access and
   `ctaInternalName` → `header-cta`.

`enabledModules` was **not** unset anywhere — deliberate, so rollback is possible.

---

## Remaining

**Needs a decision from you**

- **Duplicate project documents.** Two published `project` docs share
  `projectSlug: "abluo"` (`38cf9381-…`, `5bae4e91-…`), plus three unpublished
  `abluo` drafts. Neither published doc has modules, so nothing was written to
  either — but any per-project write keyed on slug rather than `_id` is ambiguous
  for that slug until this is resolved.

**Follow-ups, in order**

1. Verify on `dev.abluo.app`: the Modules pane (toggle a module, set WhatsApp
   config on Martegani), the merged Design System "Change" view, and that
   Martegani's WhatsApp button + Livener's header CTA still work.
2. Promote dev → preview → main with the usual STOP gates.
3. **After production is promoted and healthy**, land the deferred cleanup:
   remove `whatsappNumber` / `whatsappForm` / `whatsappFloating` / `ctaForm` /
   `ctaInternalName` from `siteConfig`, drop the fallback branches in
   `src/lib/modules/config.ts`, remove the `enabledModules` field, and unset the
   legacy data.
4. Client-dashboard pages for News (and Events/Live) — they carry i18n labels but
   have no `MODULE_DASHBOARD_ROUTES` entry yet, so no nav item appears.
5. Backport the localization fix to `BlogListingSection` (hardcoded `'en'` date
   locale and `"min read"`), matching what News now does.

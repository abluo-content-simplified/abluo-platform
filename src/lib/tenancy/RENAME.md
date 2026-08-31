# One name per project — simplification runbook

**Goal, in one line:** every project has exactly ONE name, everywhere, and that name comes
from Supabase.

**Status:** written 2026-08-31, nothing executed. Companion to `./MIGRATION.md` (tenant
identity, Stages 1/2/4/5 done, Stage 3 pending) and `./host-scope.ts` (host resolver, built,
wired to nothing).

---

## 0. The problem, stated plainly

One project currently has up to three names:

| project | Supabase `projects.slug` | Sanity `projectSlug` | URL segment |
|---|---|---|---|
| Livener | `livener` | **`livener-main`** | `livener` |
| Studio Martegani | `studiomartegani` | **`studiomartegani-main`** | `studiomartegani` |
| No!Logo | `nologo` | `nologo` | `nologo` |
| Abluo (platform) | `abluo` | `abluo` | **`abluo-the-tiny-cms`** |
| Amélie | `amelie` | `amelie` | `amelie` |
| Hoffmann | `hoffmann` | *(no docs yet)* | *(absent from every map)* |

Only two rows are actually broken, and they are broken in two different places. Everything
else already agrees.

Two hand-written maps exist solely to translate between these names:
`TENANT_TO_PROJECT` (`src/lib/sanity/client.ts`) and `resolveSanityProjectSlug`
(`src/proxy.ts`). Both disappear once the names agree — they become identity maps.

### Why this is not cosmetic
The `livener` / `livener-main` gap is the direct cause of four live defects recorded in
`f669ab9`: the client dashboard's Posts list is empty for Livener and Studio Martegani;
`assertSameTenantReference` would reject every legitimate reference; the platform project
reports zero enabled modules; a form on `abluo.app` POSTs to a 404. All four are the same
bug — two names for one thing. **Making the name singular deletes all four; there is nothing
else to fix.**

### Where the names came from (`git blame`, for the record)
`domainMap` was created 2026-05-27 with two entries and grew one line per onboarding —
`abluo-the-tiny-cms` on 2026-06-17, `nologo` on 2026-08-28. `livener-main` first appears
2026-06-07 in "fix: projectSlug model". Nothing here was designed; each line was the cheapest
thing to type at the time. Hoffmann and Amélie are missing from all three maps because by the
time they were onboarded nobody remembered the maps existed. **That is the actual argument for
generating the table instead of typing it** — not elegance, but that hand-maintained lists
provably stop being maintained.

---

## 1. What is FREE, and what needs care

**Free — no live traffic, change at will:**
- `abluo-the-tiny-cms` → `abluo`. This name is an internal Next.js **rewrite** target, never a
  redirect. A visitor sees `abluo.app/en`; the browser URL never contains it. Renaming breaks
  no link, no bookmark, no search result. Three files, five lines.
- **No!Logo** — Tom confirmed 2026-08-31 the new site is NOT live (the old site still is;
  `nologo.cloud` 404s today). Every No!Logo change, including `MIGRATION.md` Stage 3, can be
  done immediately with no window and no coordination.
- **Amélie** — draft-only project, no published documents.
- **Hoffmann** — no Sanity content yet.

**Needs care — two live sites:**
- `livener.net` and `studiomartegani.com` are live and serving customers. Their rename is an
  **in-place overwrite of the exact field every query filters on**. If the data moves before
  the code, every page on both sites returns nothing. This is precisely the failure mode of
  the 2026-08-14 outage (see `feedback_never_migrate_prod_data_ahead_of_deploy`).

---

## 2. Order of operations

Steps 1 and 2 are independent of each other. Steps 3→5 are strictly ordered.

### Step 1 — rename the URL segment (code only, no data, invisible)
Replace `abluo-the-tiny-cms` with `abluo` in:
- `src/proxy.ts:35` `'abluo.app'`, `:36` `'dev.abluo.app'`, `:77` locale map key
- `src/app/sitemap.ts:8`
- `src/lib/sanity/client.ts:99` (`TENANT_TO_PROJECT` key)
- three test files reference it; update with the code

**Verify:** `abluo.app/en` and `dev.abluo.app/en` still render the platform homepage; the
browser URL is unchanged (it was never visible). `rg abluo-the-tiny-cms` returns nothing.

### Step 2 — No!Logo, free of charge
Execute `MIGRATION.md` Stage 3 now: patch `form-nologo-demo.tenantSlug` `nologo` → `freeriders`
(check for a `drafts.form-nologo-demo` and patch both if present). The runbook's caution about
a short window no longer applies — the site is not live.

**Verify:** Studio → No!Logo → Modules → Forms lists 1 active form.

### Step 3 — deploy DUAL-READ for the two live sites
Teach the code to accept BOTH names before any document moves. The read path is
`tenantClient(segment).fetchForTenant`, which binds `$projectSlug`; queries filter
`projectSlug == $projectSlug`. Change that to match either name, e.g. bind a
`$projectSlugs` array and filter `projectSlug in $projectSlugs`, where the array is
`[<supabase slug>, <legacy -main slug>]` while both exist.

⚠️ Do NOT skip this step by trying to flip the map and the data "at the same time". They are a
deploy and a data write; they cannot be atomic, and between them both live sites are blank.

**Verify before proceeding:** `livener.net` and `studiomartegani.com` fully render — homepage,
a blog post, an event, the header CTA form. Nothing has moved yet, so anything broken here is
the dual-read itself.

### Step 4 — rename the 38 documents
Take an export first: `npx sanity dataset export production ./backup-pre-rename-$(date +%Y%m%d).tar.gz`

`livener-main` → `livener` (25 documents, 3 of them drafts):

| type | `_id` |
|---|---|
| blogPage | `529122f3-f574-4aa0-acd2-caa16cf31ac4` |
| blogPage | `drafts.529122f3-f574-4aa0-acd2-caa16cf31ac4` |
| designSystem | `4e46e990-9b26-4788-bc37-00ba2cd2ca99` |
| event | `16696946-5e86-4028-842b-3a93a61dec5e` |
| event | `604d533e-c528-4e2a-96fa-fa1bef6e37be` |
| event | `916f9ccf-8699-44e4-ada5-ab3c6cdff979` |
| event | `b50b693b-4fed-43d0-972d-ca0d68ba9451` |
| eventsPage | `12fbccec-65cc-488c-824a-56ca81967996` |
| livePage | `9f0b493d-d3b4-49a8-a913-117e83782e1a` |
| mediaAsset | `Pn6oyV4Ks5AcNbecjb7Gdy` |
| page | `560de643-94e2-4d6b-9140-375774d88076` |
| page | `d1474a89-cda7-4d52-8084-59ebb752c5f0` |
| page | `test-overlay-button-page` |
| post | `2dc440fd-2666-4eb2-ba91-1cf4434978ef` |
| post | `684a9b57-70d0-4aae-9dac-a4e32e6fc2ca` |
| post | `71b769ab-8dc8-4f5e-8703-b440204a3db9` |
| post | `835fa993-7b06-4814-9464-98a78132409d` |
| post | `a6dcd0fd-e933-47cb-98a0-9097f1d2ae2c` |
| post | `bef3bef5-bb05-47bc-bd03-d316be63b856` |
| post | `d6880c0c-2201-499c-9ad8-90fc71c08f13` |
| post | `drafts.c2fa33c2-dce7-4c00-a8ff-012d445a4e04` |
| postAuthor | `drafts.9d719f80-3621-42fa-ba91-63688da45039` |
| project | `088e16f6-0288-47b9-af2b-4ef28f90c6a8` |
| siteConfig | `01ab0be5-d7c7-4e78-be91-2e9b75ac7a8b` |

`studiomartegani-main` → `studiomartegani` (13 documents, 0 drafts):

| type | `_id` |
|---|---|
| blogPage | `e77b1360-df05-49b6-96fa-09ac14f256c9` |
| designSystem | `803e84d4-54c8-4926-814c-5a784a3eee28` |
| formDefinition | `formDefinition-studiomartegani-contact` |
| formDefinition | `formDefinition-studiomartegani-whatsapp` |
| gallery | `049b47e6-94b0-489f-a374-9c489ccd9364` |
| page | `1cba7277-0413-4b8c-92cb-cd8b1dd480b2` |
| page | `8856db48-8120-4282-81be-19f9ecb118b6` |
| page | `uNP2AoiXY2s5gkIvhb0Tqg` |
| post | `45254273-a20d-4177-889f-b48febb1505e` |
| post | `fc248466-9590-458c-85af-bcff18cfdaa9` |
| post | `ffa01a77-24b8-463e-b9b0-93e70450f701` |
| postAuthor | `0684bcdc-f510-43f6-9315-cfd3efd97955` |
| project | `90b7cb26-b192-4e8c-8378-d16c085540fd` |
| siteConfig | `69842beb-193a-4552-b68c-da34b9296f8f` |

⚠️ **Rename by explicit `_id` from these lists — do NOT sweep every document with a
`projectSlug` field.** `designSystem` documents use `projectSlug` to hold values that are not
projects at all: `abluo-base` and `abluo-dental` are shared/template design systems. A blanket
rename would corrupt them. (That misuse is the same disease as everything else here — a field
named `projectSlug` holding a non-project — and is worth its own cleanup later.)

⚠️ Patching a published `_id` creates a draft; publish it afterwards. Check first whether a
published document already has an unrelated pending draft, or publishing will push someone's
unfinished edit live.

**Verify:** `count(*[projectSlug match "*-main"])` returns 0. Both live sites still render
(they are on dual-read, so this should be a no-op).

### Step 5 — contract: delete the translation maps
Now that Supabase and Sanity agree, these are identity maps:
- `TENANT_TO_PROJECT` — `src/lib/sanity/client.ts`, with `lookupSanityProjectSlugByUrlSegment`
  and `tryLookupSanityProjectSlugByUrlSegment`
- `resolveSanityProjectSlug` — `src/proxy.ts:55-61`
- the dual-read from step 3 (drop back to `projectSlug == $projectSlug`)
- `SanityProjectSlug` and `SupabaseProjectSlug` in `src/lib/tenancy/ids.ts` collapse into one
  brand — keep `UrlProjectSegment` separate until step 6 is done

Then fix the four live defects, which are now one-line changes because the cast is no longer
needed: `tenant-scoped-sanity.ts:205` and `~:285`, `tenant-context.ts:380`,
`render-mapping.ts` `projectScopeSlugFromUrlSegment`.

**Verify:** the client dashboard's Posts list is NON-EMPTY for Livener and Studio Martegani.
That is the acceptance test for this whole document.

### Step 6 — point the proxy at the generated table
Replace `domainMap` and `resolveDefaultLocale` (`src/proxy.ts`) and `PROJECT_TO_TENANT`
(`src/app/sitemap.ts:4`) with `resolveScopeFromHost()` from `./host-scope.ts`, regenerating
`generated/route-config.ts` via `node scripts/generate-route-config.mjs`. Put
`--check` in the deploy pipeline so the table can never silently drift from Supabase again.

⚠️ This step CHANGES LIVE BEHAVIOUR for two hosts that are broken today:
`ch-psicoterapeuta.com` (Hoffmann) and Amélie resolve to `null` in the current maps and get
platform routes. The resolver serves them correctly. That is a fix, but it is a behaviour
change — put both in the test plan rather than discovering it in production.

**After this step, adding `starter.freeriders.app` is:** one Supabase row (tenant `freeriders`,
slug `starter`, `custom_domain` `starter.freeriders.app`), regenerate, add DNS. **No code.**

### Step 7 — schema cleanup (independent, do any time)
- **Drop `tenants.domain`.** No routing code reads it; it is `not null unique`, so it forces an
  invented value per tenant. `freeriders.app` currently serves nothing. The domain that matters
  is `projects.custom_domain`, one per project.
- **Make `projects.slug` unique per tenant** — replace the global unique with
  `unique (tenant_id, slug)`. The global constraint is what made tenant-prefixed names like
  `livener-main` look necessary in the first place. Check first for anything looking a project
  up by slug alone; after step 6 the host is the lookup key, so this should be clear.

---

## 3. Rollback

| step | rollback |
|---|---|
| 1 | revert the deploy — no data changed |
| 2 | patch `form-nologo-demo.tenantSlug` back to `nologo` |
| 3 | revert the deploy — dual-read is additive, nothing moved |
| 4 | re-patch the 38 `_id`s back to the `-main` values; dual-read code still serves both, so this is not urgent. Worst case restore the export. |
| 5 | revert the deploy — but only back to a dual-read build, never to one that expects `-main` |
| 6 | revert the deploy |
| 7 | `tenants.domain` needs a restore to undo; the unique constraint can be swapped back |

**The one irreversible-ish moment is step 4**, and dual-read is exactly what makes it safe: with
step 3 deployed, the data can sit in either state indefinitely.

---

## 4. Checklist

- [ ] Step 1 — `abluo-the-tiny-cms` gone; `rg abluo-the-tiny-cms` returns nothing
- [ ] Step 2 — No!Logo Stage 3 done; Forms pane shows 1 form
- [ ] Step 3 — dual-read deployed; both live sites verified rendering
- [ ] Export taken
- [ ] Step 4 — 38 documents renamed (25 + 13); `*[projectSlug match "*-main"]` returns 0
- [ ] Step 4 — drafts republished; no unrelated pending draft pushed live
- [ ] Step 5 — both maps deleted; dual-read removed; the 4 defects fixed
- [ ] Step 5 — **client dashboard Posts list non-empty for Livener + Studio Martegani**
- [ ] Step 6 — proxy on the generated table; Hoffmann + Amélie hosts verified
- [ ] Step 6 — `--check` in the deploy pipeline
- [ ] Step 7 — `tenants.domain` dropped; `projects.slug` unique per tenant

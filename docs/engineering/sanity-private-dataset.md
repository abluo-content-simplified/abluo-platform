# Runbook — switching the Sanity datasets from PUBLIC to PRIVATE

**Status:** code prepared, **not yet executed**. Nothing in this document has been run.
**Sanity project:** `3n7t84j3` — datasets `production` and `staging`, both currently `aclMode: public`.
**Audience:** whoever performs the flip. Read the whole document first. Steps 1–8 are ordered and the
order is the entire safety argument.

---

## 0. What is wrong today

Both datasets are `public`. That means anyone who knows the project id — which is shipped to the
browser as `NEXT_PUBLIC_SANITY_PROJECT_ID` and is therefore effectively public — can read **every
tenant's content with no credentials at all**, including unpublished drafts, across all tenants.
There is no per-tenant boundary at the Sanity layer; the multi-tenant scoping in
`tenantClient().fetchForTenant` is an application-level convention that an outsider simply skips.

Making the datasets private closes that. It also means every read our app performs stops working
unless it carries a token — which is why the ordering below matters more than anything else here.

## 1. The rule that governs this document

> **Deploy the token everywhere first. Flip the ACL second. Never the other way round.**

The code now supports an optional server-side `SANITY_API_READ_TOKEN`. When that variable is
**absent**, `src/lib/sanity/client.ts` constructs the client with **no `token` key at all** — byte
-for-byte the anonymous client we ship today. That no-op property is pinned by
`src/lib/sanity/__tests__/client-read-token.test.ts` and is what makes it safe to ship and deploy
the token-aware code long before anyone touches a dataset setting.

**If you flip the ACL first,** every tenant website goes down at once: every GROQ read returns
401, and because most read paths are inside `try/catch` the failure is *not* a loud error — the
tenant layout falls through to `notFound()` or renders empty, and `src/app/sitemap.ts` silently
returns an empty sitemap. You get white pages and no alarm.

## 2. Prerequisites

- Access to <https://sanity.io/manage> for project `3n7t84j3` (Administrator, to mint a token and
  change dataset visibility).
- Access to the Vercel project settings (Environment Variables) for the Abluo platform.
- The token-aware code (this change) merged to `dev` and on its way to production.

---

## 3. The ordered procedure

### Step 1 — Mint a read token

sanity.io/manage → project `3n7t84j3` → **API** → **Tokens** → *Add API token*.

- Name: `abluo-platform read (vercel)`
- Permission: **Viewer** — read-only. Do **not** mint an Editor/Deploy Studio token; nothing in the
  website read path writes.

Copy the value once; it is not shown again.

> A **Viewer** token can read drafts. Our datasets are public today, so drafts are *already*
> readable and no query behaviour changes when the token appears. The client deliberately sets no
> `perspective`, so what comes back is identical before and after. Do not add a `perspective`
> override as part of this change — that would be a separate, non-no-op behaviour change.

### Step 2 — Add the variable to **all three** Vercel environments

Vercel → Project → Settings → Environment Variables → add `SANITY_API_READ_TOKEN`:

| Environment | Required | Why |
|---|---|---|
| **Production** | yes | live tenant websites and the root sitemap |
| **Preview** | yes | every PR preview reads the same dataset; missing here = broken previews after the flip |
| **Development** | yes | `next dev` and local `vercel env pull` |

- The name is **`SANITY_API_READ_TOKEN`** — **never** `NEXT_PUBLIC_SANITY_API_READ_TOKEN`. A
  `NEXT_PUBLIC_` name is inlined into the browser bundle by Next's DefinePlugin and would hand
  every visitor read access to every tenant, which is strictly worse than the public dataset we
  are closing.
- Do not set it to an empty string as a placeholder. Empty is treated as absent (also pinned by
  test), so a blank value looks configured but is not.

### Step 3 — Deploy

Redeploy Production **and** confirm the deployment finished. Environment variables in Vercel are
baked in at build/runtime start; **an existing deployment does not pick up a new variable**. If you
skip the redeploy, Step 6 will take the site down even though the variable is "set".

### Step 4 — Verify the token is live *while both datasets are still public*

This is the free rehearsal — the datasets are still public, so a broken token cannot break anything
yet, but a working one proves itself.

1. Load two tenant sites in production and confirm normal rendering.
2. Load `https://<production-domain>/sitemap.xml` and confirm it is **non-empty**.
3. Confirm the token actually works against Sanity from a shell:

   ```sh
   curl -s -H "Authorization: Bearer $SANITY_API_READ_TOKEN" \
     "https://3n7t84j3.api.sanity.io/v2026-05-21/data/query/production?query=count(*\[_type=='project'\])"
   ```

   A non-zero `result` means the token is valid and has read access. A `401`/`403` means stop —
   re-mint the token before going further.
4. Confirm the token is **not** in the browser bundle. In DevTools → Network, search the loaded JS
   for the token's first 8 characters. Expect zero hits. (See §5 for why.)

### Step 5 — Flip `staging` first

sanity.io/manage → **Datasets** → `staging` → visibility → **Private**.

Equivalent CLI: `npx sanity dataset visibility set staging private`.

`staging` is the lower-consequence dataset; flipping it first exercises the whole mechanism against
real infrastructure.

### Step 6 — Verify `staging`

- Deploy or open a preview/branch pointed at `staging` and confirm content renders.
- Confirm the anonymous read is now actually refused:

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://3n7t84j3.api.sanity.io/v2026-05-21/data/query/staging?query=count(*\[_type=='project'\])"
  ```

  Expect **401**. If this still returns 200, the ACL did not change — stop.
- Re-run the same curl **with** the `Authorization` header and expect 200. Both halves matter: one
  proves the door is shut, the other proves we have the key.

### Step 7 — Flip `production`

Only after Step 6 is fully green. Same path: **Datasets** → `production` → **Private**
(`npx sanity dataset visibility set production private`).

Do this in a low-traffic window with the rollback in §6 open in another tab.

### Step 8 — Verify `production`

- Load **every** tenant website (all entries in `TENANT_TO_PROJECT` in
  `src/lib/sanity/client.ts`) and confirm pages, blog, events, news and images all render.
  Images matter specifically: they are served by Sanity's CDN via
  `src/lib/sanity/image.ts` and are a separate asset-ACL path from the query API.
- Load `/sitemap.xml` and confirm it is still **non-empty** — an empty sitemap is the quietest
  symptom of a failed read and will not raise any other alarm.
- Confirm the anonymous 401 / authenticated 200 pair from Step 6, against `production`.
- Check Vercel runtime logs for `401` from `api.sanity.io`.

---

## 4. What breaks if the order is wrong

| Mistake | Symptom |
|---|---|
| ACL flipped before the token is deployed | **All tenant websites break at once.** Reads 401. Most call sites catch and degrade quietly: tenant routes `notFound()` or render empty, the sitemap returns `[]`. Low-noise, high-impact. |
| Token added to Production only | Production survives; **every PR preview and local dev breaks** after the flip, and the breakage is quiet in exactly the same way. |
| Variable added but not redeployed | Identical to "no token" — Vercel does not retro-apply env vars to existing deployments. |
| Token named `NEXT_PUBLIC_SANITY_API_READ_TOKEN` | Token is inlined into the browser bundle. Every visitor gains full cross-tenant read, drafts included. **Strictly worse than the public dataset.** Revoke the token immediately and re-mint. |
| Editor/Deploy token used instead of Viewer | A read-only surface now holds write credentials. Revoke and re-mint as Viewer. |
| Assets ACL overlooked | Pages render but every image 404s/403s. Verify images explicitly in Step 8. |

## 5. Browser-bundle exposure — read before touching `image.ts`

`src/lib/sanity/image.ts` imports `sanityClient` from `src/lib/sanity/client.ts`, and `image.ts` is
imported by several `'use client'` components (`HeroSection`, `HeroLensSection`,
`HeroLiveCaptureSection`, `MediaFeatureSection`, `MediaContentSection`, `EventCard`,
`FeaturedEventBlock`). **`client.ts` is therefore currently reachable from the browser bundle.**

The token value is still not shipped: Next substitutes only `NEXT_PUBLIC_*` reads on the client, and
any other `process.env.X` resolves against an empty shim — `undefined`, never the literal. Verify
this yourself in Step 4.4 rather than trusting the paragraph.

That is a **bundler guarantee, not a structural one**. The structural fix is one line in
`image.ts` — configure the URL builder from the token-free `src/lib/sanity/config.ts` instead of
from the client:

```ts
// src/lib/sanity/image.ts
import imageUrlBuilder from '@sanity/image-url'
import { SANITY_PROJECT_ID, SANITY_DATASET } from '@/lib/sanity/config'

const builder = imageUrlBuilder({ projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET })
```

(`@sanity/image-url` accepts a plain `{projectId, dataset}` config as well as a client instance, and
the builder only ever composes CDN URLs — it never authenticates, so it has no use for a token.)

Once that lands, uncomment `import 'server-only'` in `client.ts` so the boundary is enforced by the
compiler instead of assumed. `src/lib/sanity/__tests__/client-bundle-boundary.test.ts` is written to
flip its expectation automatically at that point and will fail until the guard is added.

## 6. Rollback — one click

**Set the dataset's visibility back to `public`.**

sanity.io/manage → **Datasets** → the dataset → visibility → **Public**, or:

```sh
npx sanity dataset visibility set production public
```

It takes effect immediately and needs **no deploy and no code change** — the token-aware client
works identically against a public dataset, so the deployed code does not have to be reverted or
rolled back. This is the entire reason the token ships first: it makes the ACL a single, instantly
reversible switch.

Roll back the dataset that is broken; there is no need to revert `staging` if only `production`
misbehaves. Do **not** delete the `SANITY_API_READ_TOKEN` variable as part of a rollback — leaving
it in place costs nothing and keeps you ready to retry.

## 7. After the flip

- Revoking the token becomes a site-down event. Note it wherever tokens are rotated.
- CORS origins in sanity.io/manage govern browser-side access only; server-side reads from Vercel
  are unaffected by them. Do not "fix" a 401 by widening CORS.

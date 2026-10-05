# Client dashboard: launch inventory and env checklist

_Snapshot taken 2026-10-05 with read-only queries (Sanity: published docs plus `drafts.*` counts; Supabase: `projects`, `tenants` and the auth admin user list). Nothing was written._

## 1. Sites

The wizard needs four things for a site:
- **Blog** installed and enabled (it gates `blog.post.write`).
- A published `siteConfig` with languages.
- Blog categories. Without them the Category step has nothing to offer.
- At least one client user with a grant (owner via `tenant_members`, or editor/viewer via `project_members`).

| projectSlug | Sanity tenantSlug | Custom domain | Modules enabled | Blog? | Categories (blog) | Posts published / drafts | siteConfig: default · languages | Tone set | Client users (invite metadata) | Wizard status |
|---|---|---|---|---|---|---|---|---|---|---|
| abluo | abluo | abluo.app | translate, news, gallery, forms, blog | yes | **0** (the 4 categories are on `news`) | 0 / 1 | en · en, it, de | no | 2 owners (gmail.com, sevenpm.com) | ⚠ works, but the Category step is empty |
| amelie | amelie | ameliez.com | gallery | **no** | – | 0 / 0 | en · en | no | **none** | ✖ no blog, no users |
| cyce | cyce | cyce.info | events, translate | **no** | – | 0 / 0 | en · en, fr | no | **none** | ✖ no blog, no users |
| hoffmann | hoffmann | ch-psicoterapeuta.com | blog, forms, whatsapp, gallery (+1 **empty** `moduleInstallations` entry with no moduleId) | yes | 5 | 14 / 0 | it · it, de | no | **none** | ⚠ ready except **no client user**; clean up the empty module entry |
| livener | livener | livener.net | blog, events, live, forms | yes | 5 | 7 / 1 | en · en, it | no | 1 owner (gmail.com) | ✔ ready |
| nologo | **freeriders** (Supabase tenant `freeriders`) | nologo.cloud | forms | **no** | – | 0 / 0 | en · en, it, de, fr, es, nl, pt | no | **none** | ✖ no blog, no users |
| studiomartegani | studiomartegani | studiomartegani.com | blog, whatsapp, forms, gallery | yes | 3 | 5 / 0 | it · it, en | no | **none** | ⚠ ready except **no client user** |
| tmz | **null** | **none** | gallery | **no** | – | 0 / 0 | en · en, de, it, fr | no | **none** | ✖ no blog, no users, no tenantSlug or domain |

Every Sanity `project` has a Supabase `projects` row with the same slug. There are no orphan siteConfigs or posts. Supabase also has project `t42` (an isolation fixture under tenant `freeriders`, with no Sanity project) and tenant `noemi`, which has no project.

### Caveat about users
Migration 028 revoked `service_role` SELECT on `tenant_members` and `project_members`, so this audit **cannot read the membership rows** without an authenticated admin session. The "client users" column comes from the auth user list instead: there are 4 users. 3 of them were invited with `user_metadata.tenant_id` and `role=owner`, and `handle_user_invited` turns that into the `tenant_members` row. All 3 are confirmed. Tom (tmz.it) is `abluo_admin`. `abluo_admin` gets **no** automatic project grants in `getTenantAuthorizationContext`, so he only sees projects where he is a member himself.
To confirm the actual rows, an abluo_admin can run this in the Supabase SQL editor: `select t.slug, m.role, count(*) from tenant_members m join tenants t on t.id = m.tenant_id group by 1, 2;` (and the same for `project_members`).

### Before launch
1. **hoffmann, studiomartegani:** invite the client (`scripts/invite-test-client.mjs` flow). Otherwise nobody can log in.
2. **abluo:** add blog categories in the Blog module config, or accept an empty Category step.
3. **amelie, cyce, nologo, tmz:** no Blog module, so the dashboard has no Posts. Install Blog (with categories) only where wanted.
4. **hoffmann:** remove the empty `moduleInstallations` entry (moduleId null).
5. **No site has `toneOfVoice` set.** That is fine while `AI_FEATURES` is off; set it before turning Improve on.

## 2. Env checklist (dashboard features)

| Variable | Required? | Read by | When missing |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **required** | `src/lib/supabase/*` (login, grants) | Dashboard can't authenticate |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** | `src/lib/supabase/admin.ts`; also the shared-slug guard in `getTenantAuthorizationContext` | Admin/server reads fail. The dashboard **fails closed**: no project grants at all |
| `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET` | **required** | `src/lib/sanity/config.ts` | Nothing renders |
| `SANITY_API_WRITE_TOKEN` | **required** for the dashboard | `src/lib/sanity/server-clients.ts` (drafts, publish, media, siteConfig/tone reads) | Every draft save and publish fails |
| `SANITY_API_READ_TOKEN` | optional (needed once the dataset goes private) | `client.ts`, `server-clients.ts` (fallback for reads) | Public-dataset reads still work today |
| `TINIFY_API_KEY` | optional (recommended) | `src/lib/media/optimize-image.ts` (cover uploads) | Originals are uploaded without optimisation; never blocks |
| `PREVIEW_SECRET` | **required for launch** (≥ 32 random chars; same value on every deployment that mints or renders previews) | `src/lib/preview/draft-preview-token.ts` (signs/verifies the private draft-preview links, 15 min) | Falls back to a key derived from `SUPABASE_SERVICE_ROLE_KEY` (works, but rotating the service key then breaks open preview links, and the two secrets are coupled). With neither, Preview shows "not available" and every preview URL 404s |
| `ABLUO_CONTACT_EMAIL` | optional | `(client)/[tenant]/layout.tsx` ("contact us" in the shell) | Contact link hidden |
| `RESEND_API_KEY` | optional for the dashboard (required for e-mail notifications) | `src/lib/notifications/resend.ts` | Notification e-mails are not sent |
| `NOTIFY_FROM_EMAIL` | optional | same | Default sender |
| `AI_FEATURES` | optional, **default OFF** | `src/lib/ai/features.ts` → write page and `improvePostBody` | AI shows "Coming soon"; server refuses with `ai_unavailable` |
| `ANTHROPIC_API_KEY` | required only when `AI_FEATURES` includes `improve` | `src/lib/ai/registry.ts` (also Translate's Claude adapter) | Improve returns `ai_unavailable` |
| `AI_PROVIDER` | optional (`anthropic`) | `src/lib/ai/registry.ts` | – |
| `AI_MODEL` | optional (`claude-sonnet-5-5`) | `src/lib/ai/registry.ts` | – |
| `AI_TIMEOUT_MS` | optional (60000) | `src/lib/ai/registry.ts` | – |
| `GOOGLE_TRANSLATE_API_KEY` / `DEEPL_API_KEY` / `TRANSLATE_CLAUDE_MODEL` | optional | Translate module (Studio, ADR-023) | That provider reports "not configured" |
| `VERCEL_ENV` | set by Vercel | notifications, translate usage | – |

**Launch configuration:** leave `AI_FEATURES` unset. `ANTHROPIC_API_KEY` is not needed for launch.

## 3. Project slugs must be globally unique (cross-tenant isolation)

Sanity scopes every document (posts, media, siteConfig, the `project` doc) by `projectSlug` alone. There is no tenant in that namespace. Migration 023 (applied) made `public.projects.slug` unique **per tenant** only. If two tenants ever own a project with the same slug, they share all of that slug's Sanity content: an editor of one could read, edit, publish over and delete the other's posts and media through the client dashboard.

**What the code does now (fail closed):**
- `getTenantAuthorizationContext` counts `projects` rows per granted slug with the service role (`fetchProjectSlugUsage`; slugs in, counts out) and drops any grant whose slug is used by more than one row (`dropAmbiguousSlugGrants`, `src/lib/api/tenant-context.ts`). If the count can't be read, it drops every grant.
- Every client-dashboard write (drafts, publish, lifecycle, cover, upload) first checks that exactly ONE Sanity `project` document carries the slug (`assertSingleSanityProject`, `src/lib/api/sanity-project-guard.ts`), and `uploadPostImage` requires exactly one `project` doc.

**Durable fix (recommended, NOT applied):** restore a platform-wide unique index on the slug until the Sanity namespace carries a tenant. Run the tripwire first. It must return 0 rows:

```sql
select slug, count(*) from public.projects group by slug having count(*) > 1;

-- then
create unique index if not exists projects_slug_global_key on public.projects (slug);
```

The per-tenant constraint `projects_tenant_id_slug_key` can stay. The global index only narrows it. Record the outcome in `supabase/APPLIED.md`.


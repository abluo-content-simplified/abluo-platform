# Migration ledger — which migrations have actually been applied?

**Status of this file: a scaffold, not an answer.** Almost every row below says
`UNKNOWN`. That is deliberate and it is the honest state — see below.

## Why this file exists

This project has **no Supabase CLI and no `supabase/config.toml`** (stated in
the header of `006_custom_access_token_hook.sql`). Migrations are applied by
hand, in the Supabase dashboard SQL editor, one at a time. Consequently:

- There is no `supabase_migrations.schema_migrations` ledger table — the
  mechanism Supabase CLI projects use to record what ran.
- The files in `supabase/migrations/` are a record of *intent and of SQL text*,
  **not** a record of execution. A file existing here does not mean it ran.
- File order does not imply application order, and a gap does not imply a skip.

So there is currently no way to know, from the repo alone, which of these ran
against dev/preview/production. This file is the place to write that down once
it has been checked. Fill in the `Applied?` column from a real check against the
live database — **do not infer it from file order or from the fact that a later
migration exists.**

## How to verify against the live database

Two things are often confused. Be clear which one you are doing.

### 1. The local harness — does NOT answer this question

`supabase/verify/` is a live-DB *RLS/grant* harness. It boots a **disposable
local PostgreSQL 18** instance (via the `embedded-postgres` npm package),
applies `schema.sql` + the migrations verbatim, and asserts that GRANTs and RLS
policies behave. It never touches any Supabase project.

```bash
cd supabase/verify
npm install     # first time only
npm run verify
```

It proves the migrations are *correct*. It cannot tell you whether they were
*applied* to dev/preview/prod. See `supabase/verify/README.md`.

### 2. The real check — Supabase dashboard SQL editor

Every migration file ends with its own `Verification` section — a set of
queries whose results tell you whether that migration's objects exist. Open the
Supabase dashboard → SQL editor for the project you care about, run that
migration's verification block, and record the outcome here with the date and
the environment.

Generic starting points:

```sql
-- Does a table/column from a given migration exist?
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- Which RLS policies exist, and what is their qual?
select schemaname, tablename, policyname, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Which table-level grants exist (migrations 011/012/015/018)?
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
order by table_name, grantee, privilege_type;

-- Which functions exist (migrations 004/006/007/013)?
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth')
order by p.proname;
```

Note: dev, preview and production **share one Supabase project** (stated in the
header of `019_form_events_env_and_status.sql`), so in practice there is one
database to check, not three — but confirm that is still true before relying
on it.

## Ledger

`Applied?` values: `UNKNOWN — verify against live DB` (the default; nothing in
the repo settles it) or a value taken from an explicit claim in the file's own
header, marked as such. No row below was determined by querying a database.

| # | File | Purpose (from its own header) | Applied? |
|---|------|-------------------------------|----------|
| 001 | `001_leads_add_lead_status.sql` | Adds `leads.lead_status` (sales-pipeline stage), distinct from `status` (inbox read/archived state). | UNKNOWN — verify against live DB |
| 002 | `002_projects.sql` | Creates `public.projects` — the project as the core deployable unit; a tenant can have many, each with slug, preview URL and optional custom domain. | UNKNOWN — verify against live DB |
| 003 | `003_tenant_members.sql` | Introduces `tenant_members` (multi-tenant membership, one identity → many tenants, role per membership). Header says: additive only, nothing dropped or altered. | UNKNOWN — verify against live DB |
| 004 | `004_profiles_identity_only.sql` | Completes the move to the membership model: adds `get_my_tenant_ids()` / `get_my_writable_tenant_ids()`, drops profiles-based RLS on tenants/leads/projects and replaces it with `tenant_members`-based policies, rewrites `handle_new_user()`. | UNKNOWN — verify against live DB |
| 005 | `005_inquiries.sql` | Creates the platform-wide `inquiries` table for form submissions (first use case `inquiry_type = 'early_access'`); distinct from `leads`. | UNKNOWN — verify against live DB |
| 006 | `006_custom_access_token_hook.sql` | ADR-015 phase 1: the Supabase Auth custom-access-token hook that puts a top-level `platform_role` claim (`abluo_admin` \| `tenant_user`, fail-safe default `tenant_user`) into every JWT. | UNKNOWN — verify against live DB. **Header claims** it was applied manually via the SQL editor + Dashboard → Authentication → Hooks on **2026-07-29** and verified live, and that the file exists to capture the already-applied SQL. Not independently confirmed here. |
| 007 | `007_project_members.sql` | ADR-017 slice 1: adds `project_members` (per-project authorization grain) on top of `tenant_members`. Header says additive only and inert until `TenantAuthorizationContext` is wired into a route. | UNKNOWN — verify against live DB |
| 008 | `008_leads_project_id.sql` | ADR-017 Decision 6, step 1 of 5: adds a **nullable** `leads.project_id` FK to `projects`. Header says purely additive — no behaviour or RLS change. | UNKNOWN — verify against live DB |
| 009 | `009_projects_select_project_members.sql` | ADR-017 slice 2: widens the `projects` SELECT policy so a user holding only a `project_members` grant (no `tenant_members` row) can read that project. | UNKNOWN — verify against live DB. Migration 013's header describes 009 as having introduced a live recursion bug, which implies 009 reached a real database — but that is an inference, not a check. |
| 010 | `010_project_member_invite_trigger.sql.draft` | **DRAFT** — would extend `handle_new_user()` to create `project_members` rows on invite acceptance. | **NO — not applied.** Header states: "NOT APPLIED. NOT RENAMED TO .sql." The `.sql.draft` extension is deliberate so no runner picks it up. ⚠️ **CONTRADICTED BY THE LIVE DATABASE, 2026-09-02:** the live `handle_new_user()` body DOES contain this draft's `project_id` / `project_members` branch, so this SQL (or SQL equal to it) was applied by hand and the file's own "NOT APPLIED" header is stale. Superseded by migration 024 — do **not** apply this draft after 024. |
| 011 | `011_authz_read_grants.sql` | Fixes a live bug: adds missing table-level `GRANT`s on `tenant_members`, `project_members`, `projects` (the "permission denied for table tenant_members" error in `getTenantAuthorizationContext`). | UNKNOWN — verify against live DB |
| 012 | `012_profiles_update_own.sql` | Grants `authenticated` UPDATE on `public.profiles` (`full_name` only), for the invite-acceptance "Your name" write done with the user's own session. | UNKNOWN — verify against live DB |
| 013 | `013_fix_projects_policy_recursion.sql` | Fixes infinite recursion in the `projects` SELECT policy introduced by 009 (009 broke the SECURITY DEFINER convention). Recursion-only surgery, not a visibility change. | UNKNOWN — verify against live DB. Header's own step 1 is "Apply this migration via the Supabase dashboard SQL editor", i.e. it was written as not-yet-applied. |
| 014 | `014_inquiries_authz.sql` | Closes the `inquiries` P0: adds the grants/RLS the `PATCH /api/inquiries/[id]` route needs so it stops relying on the service-role client. | **NO — header states it was never applied.** Verbatim: "⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK. This is a FILE ONLY, handed to Tom to review and apply manually via the Supabase SQL editor." Proven only against the local `supabase/verify` harness. **Re-check the live DB before acting on this — someone may have applied it since the file was written.** |
| 015 | `015_profiles_select_grant.sql` | Completes 012: adds the `authenticated` SELECT grant on `profiles` that Postgres requires for columns referenced in an UPDATE's WHERE clause. | UNKNOWN — verify against live DB. Header instructs: "Apply this in the Supabase SQL editor immediately after migration 014" — which, given 014's own header, implies 015 was not applied either. Inference only; check. |
| 016 | `016_form_submissions.sql` | ADR-018 slice 1: creates `form_submissions`, the canonical store for form submissions, scoped by both `tenant_id` and `project_id` (both nullable this slice), with pinned `form_version` + `definition_snapshot`. | UNKNOWN — verify against live DB |
| 017 | `017_form_events.sql` | ADR-018 Decision 9: creates the append-only `form_events` outbox (status/attempts/last_error/processed_at) read by the ADR-019 consumer. Payload is provider-agnostic and carries no recipients or secrets. | UNKNOWN — verify against live DB |
| 018 | `018_form_tables_service_role_grants.sql` | Fixes a live 500 (Postgres 42501, "permission denied for table form_submissions"): grants `service_role` full privileges on both forms tables, which 016/017 omitted. | UNKNOWN — verify against live DB |
| 019 | `019_form_events_env_and_status.sql` | ADR-019: adds `environment` and `project_slug` to `form_events` plus a `'skipped'` status, so the single production webhook consumer delivers only `environment = 'production'` events and non-prod submissions are recorded but not emailed. | UNKNOWN — verify against live DB |
| 020 | `020_leads_project_grain.sql` | Moves `leads` RLS from tenant grain to project grain (`get_my_project_ids()` / `get_my_writable_project_ids()`, the migration-016 shape), backfills `project_id` for single-project tenants, and keeps an owner-scoped `project_id is null` branch for legacy rows that cannot be attributed. | **NO — written 2026-08-31, NOT APPLIED.** Header states it explicitly. Proven only against `supabase/verify` (blocks (g) and (i)). See "Written but not applied" below for the exact dashboard queries. |
| 021 | `021_tenants_read_grant.sql` | `grant select on public.tenants to authenticated` — the one table migration 011 did not audit. Grant only; `schema.sql`'s "Members can read their tenants" policy is already correct and is untouched. | **NO — written 2026-08-31, NOT APPLIED.** Header states it explicitly. Proven only against `supabase/verify` (block (i)). See below. |
| 022 | `022_tenants_drop_domain.sql` | Drops `public.tenants.domain` (`not null unique`, wrong grain — hosts are per-PROJECT via `projects.custom_domain`; nothing consumes the value). RENAME.md Step 7, bullet 1. | **NO — written 2026-09-01, NOT APPLIED.** Header states it explicitly. Proven only against `supabase/verify` (block (j)). ⚠️ **Has an application-deploy prerequisite and is NOT reversible** — see below. |
| 023 | `023_projects_slug_unique_per_tenant.sql` | Replaces the GLOBAL `unique (slug)` on `public.projects` with `unique (tenant_id, slug)` (named `projects_tenant_id_slug_key`). The global unique is what made tenant-prefixed slugs like `livener-main` look necessary. RENAME.md Step 7, bullet 2. | **NO — written 2026-09-01, NOT APPLIED.** Header states it explicitly. Proven only against `supabase/verify` (block (j)). |
| 024 | `024_handle_new_user_invite_only.sql` | **SECURITY (P0).** Splits the `auth.users` trigger so membership rows (`tenant_members` / `project_members`) are created ONLY for users GoTrue actually invited, and removes the `role` default of `'owner'`. `profiles` is still created for everyone. Closes the client-supplied `raw_user_meta_data` escalation described below. | **NO — written 2026-09-02, NOT APPLIED.** Header states it explicitly. Proven only against `supabase/verify` (block (k), 20 tests). See "Written but not applied — 2026-09-02" below. ⚠️ **Disabling self-signup in the dashboard is the PRIMARY control; this migration is the second layer.** |

## When you fill this in

Replace the `Applied?` cell with, e.g.:

```
YES — verified 2026-09-02 against <project ref>, dev/preview/prod (shared project),
      via migration 011's own verification block
```

and leave the header-claim note in place. Record the date, the environment and
what you actually ran — a bare "YES" is how this file rots back into guesswork.


## Written but not applied — 2026-08-31 (migrations 020, 021)

Both files were written in the same session and **neither was executed
against the Supabase project**. No DDL was run anywhere except the local
disposable Postgres in `supabase/verify/` (`npm run verify`, 81 tests green,
up from 76 — `lib/harness.mjs` now applies 020 and 021 in its base list).
Tom applies both by hand in the dashboard SQL editor, then fills in the
`Applied?` cells above using the queries below.

Suggested order: **021 first** (a pure grant, no behaviour change, trivially
reversible with `revoke`), then **020**.

### 020 — `leads` project grain

What to run: the whole file, top to bottom. It is idempotent (every policy is
`drop policy if exists`-ed first; the backfill is a no-op on a second run).

Confirm it took effect:

```sql
-- (a) Exactly three policies, all project-grain, none named "… for their tenants".
select policyname, cmd, qual, with_check
from   pg_policies
where  schemaname = 'public' and tablename = 'leads'
order  by cmd, policyname;
-- Expect exactly 3 rows:
--   INSERT  Writable roles insert leads for their projects
--   SELECT  Members read leads for their projects
--   UPDATE  Writable roles update leads for their projects
-- Every qual/with_check must mention get_my_project_ids or
-- get_my_writable_project_ids. get_my_tenant_ids / get_my_writable_tenant_ids
-- must appear NOWHERE. get_my_owned_tenant_ids may appear only inside the
-- `project_id IS NULL` branch of the SELECT and UPDATE policies.

-- (b) Backfill outcome — this is the number that gates the later NOT NULL flip.
select count(*)                                   as total_leads,
       count(project_id)                          as with_project_id,
       count(*) filter (where project_id is null) as still_null
from   public.leads;

-- (c) Any row still null must belong to a tenant with MORE THAN ONE project.
--     If a single-project tenant appears here, the backfill missed something
--     — stop and investigate before applying anything else.
select t.slug,
       count(*) filter (where l.project_id is null) as unattributed_leads,
       (select count(*) from public.projects p where p.tenant_id = t.id) as projects
from   public.tenants t
join   public.leads   l on l.tenant_id = t.id
group  by t.id, t.slug
order  by unattributed_leads desc;

-- (d) This migration must NOT have granted anything. Expect ZERO rows.
select privilege_type
from   information_schema.role_table_grants
where  table_schema = 'public' and table_name = 'leads' and grantee = 'authenticated';
```

Note on (d): `leads` has no grant to `authenticated` and 020 does not add
one, so applying 020 changes **nothing observable today** — every live leads
access is service-role, which bypasses RLS entirely. Its value is that the
future "turn the dashboard leads read on" grant cannot ship an over-share
alongside it.

### 021 — `public.tenants` read grant

What to run: the whole file (one `grant` statement).

Confirm it took effect:

```sql
-- (a) The grant exists, and is SELECT only.
select table_name, grantee, privilege_type
from   information_schema.role_table_grants
where  table_schema = 'public' and table_name = 'tenants' and grantee = 'authenticated'
order  by privilege_type;
-- Expect exactly 1 row: tenants | authenticated | SELECT.
-- Any INSERT/UPDATE/DELETE row means something other than this migration ran.

-- (b) The policy is untouched.
select policyname, cmd, qual
from   pg_policies
where  schemaname = 'public' and tablename = 'tenants';
-- Expect 1 row: "Members can read their tenants", SELECT, qual referencing
-- get_my_tenant_ids() — identical to schema.sql.
```

The SQL editor runs as a superuser and bypasses both grants and RLS, so it
can confirm the catalog state above but **cannot** confirm the end-to-end
behaviour. For that, load a real tenant session and issue a request-scoped
`from('tenants').select('id, slug')`: it must return that user's own tenant
row(s) with no `42501`.

To roll 021 back: `revoke select on public.tenants from authenticated;`


## Written but not applied — 2026-09-01 (migrations 022, 023)

RENAME.md **Step 7** ("schema cleanup"). Both files were written in the same
session and **neither was executed against the Supabase project**. No DDL was
run anywhere except the local disposable Postgres in `supabase/verify/`
(`npm run verify`, **90 tests green, up from 81** — `lib/harness.mjs` now
applies 022 and 023 in its base list, and a new block **(j) schema cleanup**
covers both). Tom applies them by hand in the dashboard SQL editor, then fills
in the `Applied?` cells above using the queries below.

Suggested order: **023 first**, then 022.

- **023 is the safe one.** It only narrows a constraint. Flipping it creates no
  duplicate slug by itself — it merely stops the database refusing one — so no
  existing row and no existing code path changes behaviour on the day it is
  applied. It is also reversible: `alter table public.projects drop constraint
  projects_tenant_id_slug_key;` then `add constraint projects_slug_key unique
  (slug);` (the rollback succeeds as long as no duplicate slug has been created
  in the meantime).
- **022 is the one to be careful with.** It has an application-deploy
  prerequisite (below) and a dropped column cannot be un-dropped — undoing it
  means a point-in-time restore, or re-adding the column and re-typing the
  values from the capture query. Take the capture first.

### 022 — drop `tenants.domain`

⚠️ **Prerequisite — deploy application code FIRST.** Nothing *uses* the value
(routing is `projects.custom_domain` + `projects.slug`, everywhere), but three
PostgREST select-lists still **name** the column, and PostgREST fails a request
whose select-list names a column that does not exist:

| # | file:line | what breaks the moment the column goes |
|---|---|---|
| 1 | `src/app/api/sanity/tenant/route.ts:38` | `.select('… , domain')` — Studio TenantLinker stops resolving the linked tenant (404 branch). The value was returned to the client and never read. |
| 2 | `src/app/api/sanity/tenants/route.ts:33` | `.select('… , domain')` — the Studio "link a tenant" picker 500s and lists nothing. The value is fetched and discarded by the route's own `.map()`. |
| 3 | `scripts/generate-route-config.mjs:353` | `tenants?select=id,slug,domain` — regenerating / `--check`-ing `src/lib/tenancy/generated/route-config.ts` throws. `buildRows()` never references `domain`. That is RENAME.md Step 6's tooling, and `--check` is destined for the deploy pipeline. |

Each fix is deleting the word `domain` from a select-list — no logic. Deploy
that first; then this migration has no window at all (the column still exists
while the new code runs, and the new code is already correct when it goes).

**Capture before running** — the drop is not recoverable without a restore:

```sql
select id, slug, display_name, domain
from   public.tenants
order  by slug;
```

Paste the result into this file next to the `Applied?` cell. It is one short
string per tenant; keeping it turns a hypothetical "something off-repo needed
that value" into an `add column` + N `update`s instead of a restore.

What to run: the whole file. Idempotent (`drop column if exists`).

Confirm it took effect:

```sql
-- (a) The column is gone; slug survives and is still NOT NULL.
select column_name, is_nullable
from   information_schema.columns
where  table_schema = 'public' and table_name = 'tenants'
order  by ordinal_position;
-- Expect exactly: id, slug, display_name, status, plan, created_at.
-- No `domain`.

-- (b) Its index and unique constraint went with it, nothing else did.
select indexname from pg_indexes
where  schemaname = 'public' and tablename = 'tenants'
order  by indexname;
-- Expect tenants_pkey, tenants_slug_idx, tenants_slug_key.
-- NO tenants_domain_idx, NO tenants_domain_key.

-- (c) No row was lost — this is a column drop, not a row operation.
select count(*) from public.tenants;
-- Expect the same count as the capture query above returned.

-- (d) Policy and grant untouched (021's grant must still be there).
select policyname, cmd, qual from pg_policies
where  schemaname = 'public' and tablename = 'tenants';
-- Expect 1 row: "Members can read their tenants", SELECT, qual referencing
-- get_my_tenant_ids().

select privilege_type from information_schema.role_table_grants
where  table_schema = 'public' and table_name = 'tenants' and grantee = 'authenticated';
-- Expect SELECT only (1 row) if 021 has been applied; 0 rows if it has not.
```

Then, with the prerequisite deploy live: open the Studio's tenant-link pane
(the picker must list tenants and the linked tenant must resolve), and run
`node scripts/generate-route-config.mjs --check` — it must print `OK: …`
rather than throwing.

### 023 — `projects.slug` unique per tenant

What to run: the whole file. Idempotent: the drop is catalog-driven (it finds
whatever UNIQUE constraint covers exactly `(slug)`, rather than assuming the
implicit name `projects_slug_key`) and the add is existence-guarded.

Confirm it took effect:

```sql
-- (a) The constraint set is exactly right.
select con.conname, pg_get_constraintdef(con.oid) as def
from   pg_constraint con
join   pg_class     r on r.oid = con.conrelid
join   pg_namespace n on n.oid = r.relnamespace
where  n.nspname = 'public' and r.relname = 'projects' and con.contype = 'u'
order  by con.conname;
-- Expect projects_tenant_id_slug_key | UNIQUE (tenant_id, slug)
--    and a UNIQUE (custom_domain)  — custom_domain stays GLOBALLY unique,
--        correctly: a host is a global resource.
-- There must be NO constraint whose def is `UNIQUE (slug)`.

-- (b) The plain lookup index survived (the composite cannot serve a
--     slug-only predicate, and by-slug lookups still exist in src/).
select indexname, indexdef from pg_indexes
where  schemaname = 'public' and tablename = 'projects'
order  by indexname;
-- Expect projects_slug_idx (non-unique) AND projects_tenant_id_slug_key.
-- NO projects_slug_key.

-- (c) Proof, not inspection — substitute two real tenant ids.
--     ⚠️ DO NOT FORGET THE ROLLBACK: a committed insert here would create
--     real preview hosts ({slug}.preview.abluo.app).
begin;
  insert into public.projects (slug, tenant_id, name)
  values ('constraint-probe', '<tenant-A-uuid>', 'probe A'),
         ('constraint-probe', '<tenant-B-uuid>', 'probe B');   -- must SUCCEED
  insert into public.projects (slug, tenant_id, name)
  values ('constraint-probe', '<tenant-A-uuid>', 'probe A2');  -- must FAIL 23505
rollback;

-- (d) TRIPWIRE — pin this as a saved query the day 023 is applied.
select slug, count(*) as tenants_using_it
from   public.projects group by slug having count(*) > 1;
-- Must stay 0 rows until the call sites below are fixed.
```

**Why the tripwire.** Applying 023 is safe; *using* it is what needs work
first. Five sites key on a project slug without a tenant (full audit, with the
reasoning, in `023_projects_slug_unique_per_tenant.sql`'s header):

| # | site | verdict |
|---|---|---|
| 1 | `src/lib/forms/submissions.ts:103` `resolveProjectScope()` | Slug comes off the URL of `/api/forms/[projectSlug]/…` — caller-chosen. A shared slug makes `.maybeSingle()` raise ⇒ `null` scope ⇒ both call sites fail closed. **Outage, not a leak** — and the highest-priority fix. |
| 2 | `src/lib/notifications/consumer.ts:92` `resolveEventScope()` | Legacy branch only (rows with no `project_id`); slug is platform-written. Same fail-closed mechanics ⇒ a stuck notification, not a misrouted one. |
| 3 | `src/lib/modules/client-navigation.ts:109` `resolveProjectGrant()` | In-memory `find()` over the caller's grants **across all their tenants**. A user in two tenants that share a slug gets the first match — **the wrong project rendered, silently**. Cannot cross a permission boundary (every candidate is already granted), but it is the one entry that is silently wrong rather than loudly broken. |
| 4 | `scripts/generate-route-config.mjs:197,200` | Preview/localhost hosts are `{slug}.preview.abluo.app` — a flat, global namespace derived from the slug alone. A shared slug trips the generator's own host-collision check ⇒ **fails loudly**, blocks regeneration (and, with `--check`, the deploy). |
| 5 | `supabase/` itself | **Nothing.** No policy, helper, trigger or view reads `projects.slug`; the RLS helpers are all id-based. This migration is invisible to every authorization decision in the database. |

Safe sequencing: apply 023 → RENAME.md **Step 6** (host-first resolution) →
fix sites 1, 3 and 4 → *only then* create a project whose slug duplicates
another tenant's.


## Written but not applied — 2026-09-02 (migration 024)

**This is a P0 security migration. Read the whole section before applying.**

### What was actually wrong

`handle_new_user()` (`after insert on auth.users`) read `new.raw_user_meta_data`
— the **client-supplied** `data` bag from `POST /auth/v1/signup` — and created a
`tenant_members` row from it, with `coalesce(role, 'owner')`. A second branch did
the same for `project_members` at editor/viewer grain.

`GET /auth/v1/settings` on the live project returned `disable_signup: false`, and
the anon key ships in the browser bundle. So anyone could:

```
POST https://<project-ref>.supabase.co/auth/v1/signup
apikey: <anon key>
{ "email": "...", "password": "...",
  "data": { "tenant_id": "<any tenant uuid>" } }
```

and be made **owner** of that tenant — read of its projects and leads, write via
`get_my_writable_tenant_ids()`, and the ability to add further members. No role
had to be named: absent `role` defaulted to `'owner'`.

### The two controls, in order

1. **PRIMARY — self-signup disabled** in Supabase Dashboard → Authentication →
   Providers → Email → "Allow new users to sign up" = OFF (Tom, 2026-09-02).
   This is what actually closed the live hole. Verify it, separately from any
   SQL, with:

   ```bash
   curl -s "https://<project-ref>.supabase.co/auth/v1/settings" \
        -H "apikey: <anon key>" | jq '{disable_signup, external}'
   # disable_signup must be true.
   ```

   Note `external` too: any social provider left on is a second self-signup
   door, and OAuth signups also carry attacker-influenced user metadata.

2. **SECOND LAYER — migration 024.** Makes the trigger itself safe, so
   re-enabling signup (deliberately, or via a project restore or a dashboard
   misclick) does not silently reopen the escalation. Control 1 without
   control 2 is one checkbox away from the same breach.

### The discriminator, and the trap in it

`auth.users.invited_at` is set by `inviteUserByEmail` and never by a signup —
but **it is not set by the INSERT**. Verified against supabase/auth source:
`internal/api/invite.go` calls `signupNewUser()` (the INSERT, `invited_at`
NULL) and only afterwards `internal/api/mail.go`'s `sendInvite()`, which does
`u.InvitedAt = &now` followed by
`tx.UpdateOnly(u, "confirmation_token", "confirmation_sent_at", "invited_at")`
— a separate UPDATE, in the same transaction. Neither `NewUser()` nor
`NewUserWithPasswordHash()` ever sets it.

So the obvious fix — `if new.invited_at is not null then …` inside the existing
`after insert` trigger — **would block every legitimate invite too**, silently
breaking the membership model while looking fixed.

Migration 024 therefore SPLITS the trigger:

| trigger | event | creates |
|---|---|---|
| `on_auth_user_created` | `after insert on auth.users` | `profiles` only (identity; no privilege) |
| `on_auth_user_invited` | `after update of invited_at on auth.users`, `when (new.invited_at is not null and old.invited_at is distinct from new.invited_at)` | `tenant_members` / `project_members` |

A self-signup never reaches the second trigger. A real invite reaches it in the
same transaction as its insert, so membership is still created atomically with
the account.

### Also changed: `role` no longer defaults to `'owner'`

Migration 004's `coalesce(role, 'owner')` meant an ABSENT role granted the
HIGHEST privilege. 024 requires the role to be explicit and in the vocabulary
(`owner`/`editor`/`viewer` for `tenant_members`, `editor`/`viewer` only for
`project_members` — ADR-017 Decision 2) and otherwise creates no row. Both
invite routes always send `role` explicitly, so nothing regresses.

The column default `tenant_members.role default 'owner'` (migration 003) is
left in place — it is unreachable from this trigger now, since every insert
names the column. Worth revisiting separately.

### Dashboard SQL to verify 024 took effect

Run in Supabase Dashboard → SQL editor, **after** applying, and record the
outcome and date in the ledger above.

```sql
-- (a) handle_new_user() must no longer touch either membership table.
select prosrc ilike '%tenant_members%'  as mentions_tenant_members,
       prosrc ilike '%project_members%' as mentions_project_members,
       prosrc ilike '%profiles%'        as mentions_profiles
from   pg_proc
where  proname = 'handle_new_user' and pronamespace = 'public'::regnamespace;
-- Expect: false | false | true

-- (b) Both triggers exist, with the right events and the WHEN gate.
select t.tgname, pg_get_triggerdef(t.oid) as definition
from   pg_trigger t
where  t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
order  by t.tgname;
-- Expect exactly two rows:
--   on_auth_user_created  AFTER INSERT ... EXECUTE FUNCTION public.handle_new_user()
--   on_auth_user_invited  AFTER UPDATE OF invited_at ...
--                         WHEN ((new.invited_at IS NOT NULL)
--                               AND (old.invited_at IS DISTINCT FROM new.invited_at))
--                         EXECUTE FUNCTION public.handle_user_invited()

-- (c) No 'owner' fallback survives anywhere in the pair.
select proname from pg_proc
where  proname in ('handle_new_user', 'handle_user_invited')
and    pronamespace = 'public'::regnamespace
and    prosrc ilike '%coalesce%role%owner%';
-- Expect: 0 rows.

-- (d) Both functions still SECURITY DEFINER with an empty search_path.
select proname, prosecdef, proconfig
from   pg_proc
where  proname in ('handle_new_user', 'handle_user_invited')
and    pronamespace = 'public'::regnamespace
order  by proname;
-- Expect: prosecdef = true, proconfig = {"search_path=\"\""} for both.

-- (e) BEHAVIOURAL — this is the one that actually proves it. It creates and
--     then deletes a real auth.users row; the delete cascades to profiles.
--     Substitute a real tenant uuid. ⚠️ DO NOT FORGET THE ROLLBACK.
begin;
  insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-0000000000ff',
          'probe-selfsignup@verify.invalid',
          jsonb_build_object('tenant_id', '<a real tenant uuid>'))
  ;   -- simulates POST /auth/v1/signup: one INSERT, invited_at stays NULL

  select (select count(*) from public.tenant_members
          where user_id = '00000000-0000-0000-0000-0000000000ff') as memberships,  -- expect 0 (was 1 before 024)
         (select count(*) from public.profiles
          where id      = '00000000-0000-0000-0000-0000000000ff') as profiles;     -- expect 1

  update auth.users set invited_at = now()
  where id = '00000000-0000-0000-0000-0000000000ff';   -- simulates sendInvite()

  select count(*) from public.tenant_members
  where user_id = '00000000-0000-0000-0000-0000000000ff';  -- expect 0: no role in metadata
rollback;
```

If (e)'s first `memberships` count is not 0, 024 did not take effect — do not
re-enable self-signup.

### Cleanup after applying

Migration 024 does **not** remove memberships that were already created through
the hole. Audit before declaring it closed:

```sql
-- Memberships whose auth.users row was never invited: candidates for the
-- exploit, plus any legitimate rows created before the invite routes existed.
select tm.tenant_id, tm.user_id, tm.role, tm.created_at, u.email, u.invited_at
from   public.tenant_members tm
join   auth.users u on u.id = tm.user_id
where  u.invited_at is null
order  by tm.created_at desc;

-- Same at project grain.
select pm.project_id, pm.user_id, pm.role, pm.created_at, u.email, u.invited_at
from   public.project_members pm
join   auth.users u on u.id = pm.user_id
where  u.invited_at is null
order  by pm.created_at desc;
```

Expect legitimate hits: migration 003's backfill and any hand-seeded owner
predate the invite flow. Anything you cannot account for by email is the thing
to worry about.

### Known residual risk (not closed by 024)

GoTrue's re-invite path **merges** the new invite's `data` into the existing
row's `raw_user_meta_data` rather than replacing it. A self-signed-up user who
planted `tenant_id: <victim>` in their own metadata, and who is later invited
at that same address by a legitimate admin, would have the planted key survive
the merge and be read by `handle_user_invited()`. Closing it requires an
application change — replace rather than merge the metadata at invite time, or
move the grant out of user metadata entirely into a server-written
`pending_invitations` table keyed by a nonce. The precondition (an admin
invites the attacker's exact address) makes it far narrower than the hole 024
closes, but it is the reason user metadata remains the wrong home for an
authorization grant.

### Harness proof

`supabase/verify` block **(k)**, 20 tests, 3 phases:

- **Phase 1** applies `010_project_member_invite_trigger.sql.draft` first — that
  is what makes the local function byte-equivalent to the LIVE body — and then
  asserts the escalation actually happens, on both branches, including that the
  attacker lands inside `get_my_tenant_ids()` / `get_my_writable_tenant_ids()` /
  `get_my_owned_tenant_ids()` and can see the victim tenant's project row.
- **Phase 2** applies 024 and inverts every one of those outcomes, while proving
  both legitimate invite paths (the exact metadata each route sends) still
  create their membership, `profiles` is still created for everyone, and an
  already-invited user cannot self-escalate by rewriting their own metadata.
- **Phase 3** asserts the shipped object shape (function bodies, both trigger
  definitions including the WHEN clause, no `owner` coalesce, SECURITY DEFINER
  + empty `search_path`).

Suite: **90 tests → 110 tests**, 2 files, green. With 024 deliberately not
applied, 13 of the 20 new tests fail — confirming they test the migration and
not themselves. The 7 that still pass are the 3 phase-1 vulnerability
characterizations (they assert the hole) and the 4 legitimate-path/`profiles`
tests, which the old function also satisfied.

**Harness honesty note.** `supabase/verify/auth-shim.sql` now models
`auth.users.invited_at`, and block (k)'s helpers write users the way GoTrue
does — a self-signup as one INSERT, an invite as INSERT-then-UPDATE. The
database side of this fix is proven for real (real trigger definitions, real
function bodies, real RLS, real Postgres). The GoTrue side — that GoTrue really
does stamp `invited_at` in a separate UPDATE — is sourced from supabase/auth's
own source, not executed here. That is the one link verified by reading. If
invites ever stop granting membership after 024 is applied, that is the link to
re-check; the symptom would be a `profiles` row with no `tenant_members` row.

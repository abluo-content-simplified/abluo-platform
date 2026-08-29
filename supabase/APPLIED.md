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
| 010 | `010_project_member_invite_trigger.sql.draft` | **DRAFT** — would extend `handle_new_user()` to create `project_members` rows on invite acceptance. | **NO — not applied.** Header states: "NOT APPLIED. NOT RENAMED TO .sql." The `.sql.draft` extension is deliberate so no runner picks it up; Tom must decide trigger-vs-server-action before it becomes `010_….sql`. |
| 011 | `011_authz_read_grants.sql` | Fixes a live bug: adds missing table-level `GRANT`s on `tenant_members`, `project_members`, `projects` (the "permission denied for table tenant_members" error in `getTenantAuthorizationContext`). | UNKNOWN — verify against live DB |
| 012 | `012_profiles_update_own.sql` | Grants `authenticated` UPDATE on `public.profiles` (`full_name` only), for the invite-acceptance "Your name" write done with the user's own session. | UNKNOWN — verify against live DB |
| 013 | `013_fix_projects_policy_recursion.sql` | Fixes infinite recursion in the `projects` SELECT policy introduced by 009 (009 broke the SECURITY DEFINER convention). Recursion-only surgery, not a visibility change. | UNKNOWN — verify against live DB. Header's own step 1 is "Apply this migration via the Supabase dashboard SQL editor", i.e. it was written as not-yet-applied. |
| 014 | `014_inquiries_authz.sql` | Closes the `inquiries` P0: adds the grants/RLS the `PATCH /api/inquiries/[id]` route needs so it stops relying on the service-role client. | **NO — header states it was never applied.** Verbatim: "⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK. This is a FILE ONLY, handed to Tom to review and apply manually via the Supabase SQL editor." Proven only against the local `supabase/verify` harness. **Re-check the live DB before acting on this — someone may have applied it since the file was written.** |
| 015 | `015_profiles_select_grant.sql` | Completes 012: adds the `authenticated` SELECT grant on `profiles` that Postgres requires for columns referenced in an UPDATE's WHERE clause. | UNKNOWN — verify against live DB. Header instructs: "Apply this in the Supabase SQL editor immediately after migration 014" — which, given 014's own header, implies 015 was not applied either. Inference only; check. |
| 016 | `016_form_submissions.sql` | ADR-018 slice 1: creates `form_submissions`, the canonical store for form submissions, scoped by both `tenant_id` and `project_id` (both nullable this slice), with pinned `form_version` + `definition_snapshot`. | UNKNOWN — verify against live DB |
| 017 | `017_form_events.sql` | ADR-018 Decision 9: creates the append-only `form_events` outbox (status/attempts/last_error/processed_at) read by the ADR-019 consumer. Payload is provider-agnostic and carries no recipients or secrets. | UNKNOWN — verify against live DB |
| 018 | `018_form_tables_service_role_grants.sql` | Fixes a live 500 (Postgres 42501, "permission denied for table form_submissions"): grants `service_role` full privileges on both forms tables, which 016/017 omitted. | UNKNOWN — verify against live DB |
| 019 | `019_form_events_env_and_status.sql` | ADR-019: adds `environment` and `project_slug` to `form_events` plus a `'skipped'` status, so the single production webhook consumer delivers only `environment = 'production'` events and non-prod submissions are recorded but not emailed. | UNKNOWN — verify against live DB |

## When you fill this in

Replace the `Applied?` cell with, e.g.:

```
YES — verified 2026-09-02 against <project ref>, dev/preview/prod (shared project),
      via migration 011's own verification block
```

and leave the header-claim note in place. Record the date, the environment and
what you actually ran — a bare "YES" is how this file rots back into guesswork.

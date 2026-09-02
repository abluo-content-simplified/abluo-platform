# Migration ledger — which migrations have actually been applied?

**Status of this file: CORRECTED 2026-09-02 from the live database.** It was
previously a scaffold of `UNKNOWN`s plus a handful of "NO — not applied" values
copied from migration file headers. **Four of those "NO"s were wrong** (021,
022, 023, 024 are all live), on top of the already-known 010. Verdicts now come
from `supabase/verify/applied-check.mjs`, which fingerprints each migration
against the live catalog. Do not edit a verdict here by hand — change the
fingerprint and re-run the tool.

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

### 2. The real check — `supabase/verify/applied-check.mjs`

Since 2026-09-02 this is automated. See **"How to check this yourself"** below.
The manual route it replaces is still described here for context:

#### 2b. By hand — Supabase dashboard SQL editor

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

## Ledger — corrected 2026-09-02 from the live database

**This table is no longer a scaffold.** Every cell below was produced by
`supabase/verify/applied-check.mjs` reading the LIVE project
(`xsdamzirepfqlutvqfbe`), not by reading file headers. Four rows that said
"NO — not applied" on a file's own authority were wrong; see
**"Corrections — what the database actually said"** below.

Verdict vocabulary:

| Verdict | Meaning |
|---|---|
| `APPLIED` | A fingerprint unique to this migration is present in the live catalog. |
| `APPLIED (NOT VERBATIM)` | The migration's structural effect is live, but the `COMMENT` text the file writes is NOT. Something other than the literal file was executed. |
| `NOT APPLIED` | A fingerprint unique to this migration is absent, and the pre-migration state is observable instead. |
| `EFFECT PRESENT / FILE UNDETERMINABLE` | The objects exist, but nothing in the catalog can separate "this file ran" from "`schema.sql` (or the original hand-written schema) produced the same thing". |
| `UNDETERMINABLE` | A later migration overwrote the only object this one touched. There is no trace left to read. Honest dead end — do not upgrade it to a guess. |
| `NEEDS CATALOG` | Determinable, but only from `pg_catalog` / `information_schema`. Run `applied-check.mjs --sql`, paste in the dashboard, `--merge` the result. |

| # | File | Applied? (live, 2026-09-02) | Fingerprint used |
|---|------|-----------------------------|------------------|
| 001 | `001_leads_add_lead_status.sql` | **EFFECT PRESENT / FILE UNDETERMINABLE** | `leads.lead_status` exists — but `schema.sql` declares it too, and 001 writes no comment and creates no other object, so nothing separates them. |
| 002 | `002_projects.sql` | **EFFECT PRESENT / FILE UNDETERMINABLE** | `public.projects` exists, 8 columns. `schema.sql` creates the same table with a byte-identical comment. (Inference, not observation: `schema.sql` was probably never run here — see the 004 row — which would make this file the source.) |
| 003 | `003_tenant_members.sql` | **EFFECT PRESENT / FILE UNDETERMINABLE** | `tenant_members` exists **with** 003's table and `role` comments live — but `schema.sql` carries the identical text. |
| 004 | `004_profiles_identity_only.sql` | **APPLIED** | `public.profiles` has NO `tenant_id` and NO `role` column (004 drops both), and `avatar_url` carries 004's comment verbatim. |
| 005 | `005_inquiries.sql` | **APPLIED (NOT VERBATIM)** | `inquiries` exists with all its columns — but **none** of the five `COMMENT`s the 005 file writes are live. The table exists; the file as written did not run. |
| 006 | `006_custom_access_token_hook.sql` | **APPLIED** — header claim of 2026-07-29 now independently confirmed | `public.custom_access_token_hook(jsonb)` is live and exposed by PostgREST. Nothing else in the repo declares it. ⚠️ This proves the FUNCTION exists; it does **not** prove the Dashboard → Auth → Hooks wiring, which is not in the catalog at all. |
| 007 | `007_project_members.sql` | **APPLIED (NOT VERBATIM)** ⚠️ | `project_members` + `get_my_project_ids()` + `get_my_writable_project_ids()` all live (only 007 creates them) — but **neither** comment 007 writes is present, while 003's comments on `tenant_members` are. Same failure mode as 010: what ran was not the file. |
| 008 | `008_leads_project_id.sql` | **APPLIED** | `leads.project_id` exists with its FK to `projects.id`. No other file adds this column. |
| 009 | `009_projects_select_project_members.sql` | **NEEDS CATALOG** → expected `UNDETERMINABLE` | The `qual` of policy "Members can read their projects". If 013 is applied it overwrote 009's only object and no trace survives. 013 existing at all is *evidence* 009 once ran live — but that is an inference, not a reading. |
| 010 | `010_project_member_invite_trigger.sql.draft` | **WAS APPLIED** (verified 2026-09-02 by direct query) → now **UNDETERMINABLE** | Its `project_members` branch in `handle_new_user()`'s body — text that exists nowhere else in the repo. ⚠️ **024 has since rewritten `handle_new_user()`, erasing that trace.** The tool will now honestly report UNDETERMINABLE for 010; this row is the record. The file's own "NOT APPLIED" header is a lie and should be corrected in the file. Do **not** apply this draft after 024. |
| 011 | `011_authz_read_grants.sql` | **NEEDS CATALOG** | `GRANT SELECT` to `authenticated` on all three of `tenant_members`, `project_members`, `projects`. |
| 012 | `012_profiles_update_own.sql` | **NEEDS CATALOG** | Column-level `GRANT UPDATE(full_name)` on `profiles` to `authenticated`, with no table-level UPDATE. |
| 013 | `013_fix_projects_policy_recursion.sql` | **NEEDS CATALOG** | The `projects` SELECT policy `qual` calls `get_my_project_ids()` (013) rather than a raw `project_members` subquery (009). A live `NOT APPLIED` here means the recursion bug is still in production. |
| 014 | `014_inquiries_authz.sql` | **NEEDS CATALOG** — the ledger's old "NO" was a file header, never a check | Both named `inquiries` policies + `GRANT SELECT, UPDATE` on `inquiries` to `authenticated`. |
| 015 | `015_profiles_select_grant.sql` | **NEEDS CATALOG** | Table-level `GRANT SELECT` on `profiles` to `authenticated`. |
| 016 | `016_form_submissions.sql` | **APPLIED** (table half; grant + 2 policies still NEEDS CATALOG) | `form_submissions` exists with 016's table comment and its `definition_snapshot` comment, verbatim. |
| 017 | `017_form_events.sql` | **APPLIED** (table half; grant + policy still NEEDS CATALOG) | `form_events` exists with 017's "ADR-018 append-only outbox" table comment, verbatim. |
| 018 | `018_form_tables_service_role_grants.sql` | **NEEDS CATALOG** | 8 `service_role` privileges across both form tables. Weak on its own (Supabase default privileges could produce the same grants) — but the live 42501 that 018 was written to fix proves they did not here. |
| 019 | `019_form_events_env_and_status.sql` | **APPLIED (NOT VERBATIM)** ⚠️ | `form_events.environment` and `.project_slug` both live (only 019 adds them) — but 019's column comments are absent. Third instance of the "comments stripped" pattern (see 005, 007). The `'skipped'` status constraint half is NEEDS CATALOG. |
| 020 | `020_leads_project_grain.sql` | **NOT APPLIED** — confirmed, matches the header | The `leads` table comment is still `'Contact form submissions. Tenant-scoped.'`. 020 rewrites it to PROJECT-scoped text in the same file as the policy swap, so an unchanged comment means the file did not run. `leads` RLS is still at tenant grain. |
| 021 | `021_tenants_read_grant.sql` | **APPLIED** ⚠️ **ledger previously said "NO — not applied"** | `GRANT SELECT` on `public.tenants` to `authenticated`, verified 2026-09-02 by direct query. |
| 022 | `022_tenants_drop_domain.sql` | **APPLIED** ⚠️ **ledger previously said "NO — not applied"** | `tenants.domain` is gone (`schema.sql` declares it `not null unique`, so only 022 can remove it) **and** the live `tenants` table comment reads "As of migration 022 a tenant has NO domain of its own". Two independent traces agree. |
| 023 | `023_projects_slug_unique_per_tenant.sql` | **APPLIED** ⚠️ **ledger previously said "NO — not applied"** | `pg_constraint` shows `UNIQUE (tenant_id, slug)` and no `UNIQUE (slug)` (verified 2026-09-02); independently, the live comment on `projects.slug` names `projects_tenant_id_slug_key`. |
| 024 | `024_handle_new_user_invite_only.sql` | **APPLIED** ⚠️ **ledger previously said "NO — not applied"** | `pg_trigger` on `auth.users` shows both `on_auth_user_created` and `on_auth_user_invited`, and `public.handle_user_invited()` exists (verified 2026-09-02). The P0 second layer IS live. |
| 025 | `025_abluo_admin_read_access.sql` | **NOT APPLIED** — written 2026-09-02, file only | Nothing in the live catalog yet. Fingerprint once applied: `public.is_abluo_admin()` exists (nothing else in the repo declares it) **and** eight policies named `Abluo admins read all%` exist across `tenants`/`projects`/`tenant_members`/`project_members`/`leads`/`inquiries`/`form_submissions`/`form_events`. ⚠️ **Order-independent of 020** — 025 adds a NEW policy to `leads` rather than rewriting 020's, and 020's `drop policy if exists` list does not name it, so the two commute and may be applied in either order or singly (proven in harness block (l7a)). ⚠️ This migration REVERSES the documented "abluo_admin is not special-cased in RLS" decision (`src/lib/api/tenant-context.ts` module comment, harness block (d)) — read its header before applying. |

### Corrections — what the database actually said

Rows whose real state differs from what this file previously claimed. Every one
of the first four was a "NO — not applied" taken from the migration file's own
header. **Tom made decisions from these.**

| # | This file said | Live database says | Consequence of the old belief |
|---|---|---|---|
| 010 | `NO — not applied` (file header) | **was APPLIED** | The original discovery. A draft that "no runner picks up" was running in production. |
| 021 | `NO — written 2026-08-31, NOT APPLIED` | **APPLIED** | Re-applying is harmless (idempotent grant), but the "021 first, then 020" plan was built on a false starting state. |
| 022 | `NO — written 2026-09-01, NOT APPLIED` | **APPLIED** | ⚠️ The most dangerous one. This file still tells Tom to "capture `tenants.domain` before running — the drop is not recoverable". **That capture query can no longer run and the values are already gone.** It also says the application-code prerequisite must be deployed FIRST; if those three `select`-lists still name `domain`, they are broken in production *right now*. |
| 023 | `NO — written 2026-09-01, NOT APPLIED` | **APPLIED** | The tripwire query and the five slug call sites (`resolveProjectScope`, `client-navigation`, `generate-route-config`, …) are live concerns TODAY, not future ones. The doc's "safe sequencing: apply 023 → then fix sites" has already had its first step taken. |
| 024 | `NO — written 2026-09-02, NOT APPLIED` | **APPLIED** | Good news, and it inverts the risk note: the second layer IS in place. But it is also why 010 is now unverifiable — 024 overwrote the evidence. |
| 005 | `UNKNOWN` | **APPLIED (NOT VERBATIM)** | The table is live; the file's five `COMMENT`s are not. |
| 007 | `UNKNOWN` | **APPLIED (NOT VERBATIM)** | Table + both helper functions live; both of 007's `COMMENT`s missing. |
| 019 | `UNKNOWN` | **APPLIED (NOT VERBATIM)** | Both columns live; 019's column comments missing. |
| 004, 006, 008, 016, 017 | `UNKNOWN` | **APPLIED** | 006 in particular: its header claim of 2026-07-29 is now independently confirmed. |
| 020 | `NO` (header) | **NOT APPLIED** — confirmed | The one header claim that survived checking. |

**The pattern behind 005 / 007 / 019 is worth a decision.** Three migrations
are structurally live but arrived without the `COMMENT` statements their files
contain. The most likely explanation is that the DDL was pasted into the SQL
editor without the trailing comment block. It is benign in itself — but it is
the *same class of drift* as 010: **the SQL that ran was not the SQL in the
file**, and this ledger has no way to see the difference except by fingerprint.

**One structural finding, stated as inference not observation:** the live
`profiles` table comment is `'Links auth.users to a tenant + role. One profile
per user.'` — the pre-004 text, and NOT `schema.sql`'s `'Identity record for
each auth user…'`. Since `schema.sql` uses bare `create table` (which would
fail against an existing table), it appears **`schema.sql` has never been run
against this project**; the database grew from the original hand-written schema
by migration. If that holds, 001/002/003's `EFFECT PRESENT / FILE
UNDETERMINABLE` rows are in practice `APPLIED` — but the catalog cannot say so,
so the tool does not.

## How to check this yourself — `supabase/verify/applied-check.mjs`

Do not re-derive this by hand and do not trust a file header again.

```bash
cd supabase/verify

# Tier 1 — automatic. Reads the LIVE project via PostgREST's OpenAPI document
# (columns, types, defaults, FKs, exposed RPCs, and the live COMMENT text).
# One GET. Read-only. Settles 13 of the 24 migrations on its own.
node applied-check.mjs

# Tier 2 — the catalog half. PostgREST cannot see pg_catalog, so policies,
# GRANTs, function bodies, triggers and constraints need one paste.
node applied-check.mjs --sql          # writes applied-check.sql
#   → Supabase Dashboard → SQL editor → paste → Run.
#   → It is ONE read-only SELECT. No DDL, no DML, no temp objects.
#   → It returns a single JSON cell, one object per migration.
#   → Save that cell to catalog.json, then:
node applied-check.mjs --merge catalog.json

node applied-check.mjs --json         # machine-readable, for scripting
```

Adding a migration means adding its fingerprint to `REMOTE_CHECKS` (if PostgREST
can see it) or `CATALOG_CHECKS` (if it needs the catalog) in
`applied-check.mjs`, then regenerating with `--sql`. If a migration genuinely
leaves no distinguishable trace, give it the `UNDETERMINABLE` verdict and say
why in its `note` — do not invent a weak signal. That is exactly how this file
came to mislead everyone.

The generated SQL is self-tested: running it inside `supabase/verify`'s
disposable local Postgres, where the applied set is known exactly, reproduces
that set with no false positives and no false negatives.

## When you fill this in

Replace the `Applied?` cell with, e.g.:

```
YES — verified 2026-09-02 against <project ref>, dev/preview/prod (shared project),
      via migration 011's own verification block
```

and leave the header-claim note in place. Record the date, the environment and
what you actually ran — a bare "YES" is how this file rots back into guesswork.


## Written but not applied — 2026-08-31 (migrations 020, 021)

> ⚠️ **STALE — 021 IS APPLIED (live check, 2026-09-02).** Only 020 below is
> still accurate. Read 021 here as post-hoc verification queries, not as a
> to-do. Rollback if ever needed: `revoke select on public.tenants from authenticated;`


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

> ⚠️ **STALE — BOTH 022 AND 023 ARE APPLIED (live check, 2026-09-02).**
> Everything below is now verification, not instruction. In particular the
> "capture `tenants.domain` before running" step **can no longer be performed**:
> the column is already dropped and those values are gone unless they were
> captured at the time. Confirm the three `domain` select-lists named below were
> actually deployed out, because the column they name no longer exists.


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

> ⚠️ **STALE — 024 IS APPLIED (live check, 2026-09-02, via `pg_trigger`).**
> Read the section as background plus the post-application audit it prescribes.
> The "Cleanup after applying" queries at the end are the part still OUTSTANDING:
> 024 does not remove memberships created through the hole before it closed.


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

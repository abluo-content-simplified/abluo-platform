-- ============================================================
-- Migration 020 — leads: tenant grain → project grain
--
-- ⛔ SUPERSEDED BY MIGRATION 026 — DO NOT APPLY.
--    2026-09-03: `leads` was confirmed dead (0 rows since creation, 0 code
--    references in src/, no grant to `authenticated`) and 026 drops the table.
--    Applying this migration would recreate policies on a table that is going
--    away. It is kept as the written record of a real defect worth recognising
--    again: a TENANT-grain RLS policy on a PROJECT-grain table over-shares to
--    every project in the tenant AND under-shares to project-only members —
--    both halves reproduced on real PostgreSQL in the harness. If `leads` is
--    ever resurrected, or any other project-grain table gets tenant-grain
--    policies, this is the shape of the fix.
--
-- ⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK.
-- This is a FILE ONLY, handed to Tom to review and apply manually via the
-- Supabase SQL editor, per CLAUDE.md's Schema Evolution Rules ("Tom decides
-- at execution time") and this task's explicit hard stop. Proven against the
-- local disposable-Postgres harness only (supabase/verify/live-rls.verify.mjs,
-- blocks "(g) leads" and "(i) two-project tenant") — never executed against
-- the single shared Supabase project. Record the outcome in
-- supabase/APPLIED.md once it has actually been run.
--
-- This is ADR-017 Decision 6, step 4 of the 5-step plan written down in
-- migration 008's header ("GATED, Tom decides at execution time: … add the
-- project-scoped RLS policy"), minus the NOT NULL flip — see "What this
-- migration deliberately does NOT do" below.
--
-- ── The defect ───────────────────────────────────────────────────────────
-- `leads` RLS (supabase/schema.sql §8, migration-004 era, never rewritten)
-- is TENANT grain:
--
--     create policy "Members can read leads for their tenants"
--       on public.leads for select
--       using ( tenant_id in (select public.get_my_tenant_ids()) );
--
-- `leads.project_id` has existed since migration 008, but no policy has ever
-- referenced it. One tenant owns N projects (tenant C in the harness fixture
-- mirrors the real `freeriders` tenant, which owns both `nologo` and `t42`),
-- so a tenant-grain policy on a project-grain table is wrong in BOTH
-- directions at once. Both halves were reproduced on a real PostgreSQL 18 in
-- the harness before this migration was written:
--
--   OVER-SHARE — `userTenantViewerC` (tenant_members role = viewer on tenant
--     C, zero project_members rows) reads BOTH C1's and C2's leads. Any
--     tenant-grain membership sees every project's leads in the tenant,
--     because the policy never looks at project_id. A per-project viewer or
--     editor grant is, for `leads`, not a boundary at all.
--
--   UNDER-SHARE — `userEditorC1` (project_members editor on C1 only, no
--     tenant_members row anywhere) reads ZERO leads. Not just C2's (correct)
--     but not C1's own either (wrong): get_my_tenant_ids() consults
--     tenant_members only, and this user has no row there. ADR-017 says an
--     editor grant carries "content + leads" write access for that project.
--
-- Both are the same root cause pointing in opposite directions, and both are
-- closed by moving the policies onto get_my_project_ids() /
-- get_my_writable_project_ids() — the shape migration 016 already uses for
-- `form_submissions`, which this migration deliberately imitates.
--
-- ── Severity: LATENT, not live — read this before treating it as a P0 ────
-- `public.leads` has NO grant of any kind to `authenticated` (verified:
-- neither schema.sql nor any migration 001–019 issues one; migration 011
-- audited tenant_members/project_members/projects and explicitly listed
-- leads as out of scope). With no table GRANT, an `authenticated` session
-- reading leads gets `42501 permission denied for table leads` — for a
-- tenant's own owner as much as for a stranger — so NEITHER the over-share
-- NOR the under-share above is reachable by any real session today. Every
-- existing leads access in the codebase is service-role (which bypasses
-- grants and RLS both), and the client dashboard's leads page is still a
-- "coming soon" stub (src/app/[locale]/(client)/[tenant]/leads/page.tsx) —
-- no code path in src/ reads or writes public.leads at all.
--
-- The practical consequence, and the reason to apply this anyway: applying
-- this migration changes NOTHING observable today (service-role callers are
-- unaffected by RLS), and it means the eventual
-- `grant select … on public.leads to authenticated` — the one line that
-- turns the dashboard leads read on — cannot ship an over-share along with
-- it. Fixing the policy BEFORE the grant is the whole point of the ordering.
--
-- ── project_id IS NULL: what happens to those rows ───────────────────────
-- Migration 008 added project_id as NULLABLE and deliberately did NOT
-- backfill (its own header: step 2 is a later migration; its verification
-- block expects `with_project_id = 0`). Nothing in src/ writes leads, so
-- step 3 (forward-population) has not shipped either. Any lead row that
-- exists in the live database today therefore almost certainly has
-- project_id = NULL — and `null in (select …)` is NULL, i.e. NOT TRUE, so a
-- bare project-grain policy would make every one of those rows invisible to
-- every member. That is a data-access regression, not a security fix, so
-- this migration handles them in two steps:
--
--   1. BACKFILL the unambiguous ones. A lead whose tenant owns exactly one
--      project can only belong to that project; it is attributed. (This is
--      migration 008's step 2, which noted every tenant was 1:1 with one
--      project at the time it was written.)
--   2. Leads of a MULTI-project tenant cannot be attributed by SQL — there
--      is no information in the row to say which project it came from, and
--      guessing would silently mis-file client data. Those rows keep
--      project_id = NULL and stay reachable through an explicit, transitional
--      NULL branch in the SELECT/UPDATE policies, scoped to
--      get_my_owned_tenant_ids() — the TENANT OWNER only.
--
--      That branch grants an owner nothing they would not have anyway: under
--      ADR-017 Decision 2 (tenant-owner precedence, encoded in
--      get_my_project_ids()'s owned-tenant branch) an owner can already read
--      and write every project of their tenant, so however such a row were
--      eventually attributed, that same owner would see it. It re-opens
--      nothing for the tenant VIEWER/EDITOR memberships whose over-share is
--      the defect being closed here. It is scoped to owners precisely so the
--      fix cannot be undone by the compatibility branch.
--
--      It is transitional: when project_id becomes NOT NULL (migration 008's
--      step 4, still gated on Tom confirming the backfill is complete), the
--      branch becomes dead code and should be dropped with the same edit.
--
-- ── Tenant-owner access is preserved — verified, not assumed ─────────────
-- public.get_my_project_ids() (migration 007) is, verbatim:
--     select id from public.projects
--     where tenant_id in (select public.get_my_owned_tenant_ids())
--     union
--     select project_id from public.project_members where user_id = auth.uid()
-- The first branch is the owned-tenant branch, so a tenant OWNER holding no
-- project_members row at all still resolves to every project of their tenant
-- and keeps full access to all its leads after this migration.
-- get_my_writable_project_ids() has the identical first branch (its second
-- branch is narrowed to role = 'editor'), so owner WRITE access is preserved
-- too. What changes is the tenant VIEWER / tenant EDITOR case: those roles
-- appear in get_my_tenant_ids() but in neither project helper, so a
-- tenant-grain member with no project grant correctly loses leads access.
--
-- ── What this migration does ─────────────────────────────────────────────
--   1. Backfills leads.project_id for single-project tenants (above).
--   2. Replaces the three tenant-grain policies from schema.sql with
--      project-grain equivalents, reusing the EXISTING SECURITY DEFINER
--      helpers — never a raw subquery against projects/project_members
--      (migration 013's lesson about the recursion incident).
--        SELECT — project_id in get_my_project_ids(), plus the NULL/owner
--                 compatibility branch.
--        INSERT — project_id in get_my_writable_project_ids(). NO null
--                 branch: a new lead MUST carry a project_id, which is how
--                 the un-backfillable set stays finite and eventually empty.
--        UPDATE — project_id in get_my_writable_project_ids() plus the same
--                 NULL/owner branch, in BOTH using and with check so that a
--                 legacy row can be updated in place without being forced to
--                 acquire a project_id, and so a writable row can never be
--                 re-parented into a project the caller cannot write.
--   3. Refreshes the table comment.
--
-- Idempotent: every policy is dropped with `drop policy if exists` before
-- being created, and the backfill is a no-op on a second run. Safe to
-- re-run, and safe to run whether or not leads is empty.
--
-- ── What this migration deliberately does NOT do ─────────────────────────
--   - It does NOT grant anything to `authenticated`. Turning leads on for
--     real sessions is a separate, deliberate decision (the dashboard leads
--     read of ADR-017 Decision 6) and should be its own migration, applied
--     when that UI ships and not before. This file is the policy half only.
--   - It does NOT set project_id NOT NULL (migration 008 step 4's gate:
--     "only after the backfill is verified complete"). Verify the counts in
--     the verification block below first; that flip is a separate migration.
--   - It does NOT drop leads.tenant_id (migration 008 step 5 keeps it
--     indefinitely) and does NOT add a DELETE policy — deletes stay
--     service-role only, exactly as schema.sql left them.
--   - It touches no other table. `inquiries` (migration 014) keeps its
--     tenant-OR-project policy shape; that table is genuinely dual-grain by
--     design and is out of scope here.
-- ============================================================


-- ── 1. Backfill (ADR-017 Decision 6, step 2) ─────────────────────────────
--
-- Attribute only what is unambiguous: a lead whose tenant owns exactly one
-- project. Multi-project tenants are left alone on purpose — see the header.

update public.leads as l
set    project_id = p.id
from   public.projects as p
where  l.project_id is null
and    p.tenant_id  = l.tenant_id
and    (select count(*) from public.projects p2 where p2.tenant_id = l.tenant_id) = 1;


-- ── 2. Policies: tenant grain → project grain ────────────────────────────

drop policy if exists "Members can read leads for their tenants"        on public.leads;
drop policy if exists "Contributors can insert leads for their tenants" on public.leads;
drop policy if exists "Contributors can update leads for their tenants" on public.leads;

-- Also drop this migration's own policy names, so re-running is safe.
drop policy if exists "Members read leads for their projects"           on public.leads;
drop policy if exists "Writable roles insert leads for their projects"  on public.leads;
drop policy if exists "Writable roles update leads for their projects"  on public.leads;

-- SELECT — any project grant (owner via tenant precedence, editor, viewer)
-- reads that project's leads. The second branch is the transitional
-- un-backfillable-legacy-row branch, owner-only; it disappears when
-- project_id becomes NOT NULL.
create policy "Members read leads for their projects"
  on public.leads for select
  using (
    project_id in (select public.get_my_project_ids())
    or (
      project_id is null
      and tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );

-- INSERT — owner/editor of the target project only. No NULL branch: every
-- new lead must name its project.
create policy "Writable roles insert leads for their projects"
  on public.leads for insert
  with check (
    project_id in (select public.get_my_writable_project_ids())
  );

-- UPDATE — owner/editor of the project. using and with check are identical,
-- so a row can be updated in place but never walked into a project the
-- caller cannot write.
create policy "Writable roles update leads for their projects"
  on public.leads for update
  using (
    project_id in (select public.get_my_writable_project_ids())
    or (
      project_id is null
      and tenant_id in (select public.get_my_owned_tenant_ids())
    )
  )
  with check (
    project_id in (select public.get_my_writable_project_ids())
    or (
      project_id is null
      and tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );

-- No DELETE policy — unchanged from schema.sql: only the service role
-- (platform admin) deletes leads.


comment on table public.leads is
  'Contact form submissions. PROJECT-scoped as of migration 020 (ADR-017 '
  'Decision 6): RLS reads project_id via get_my_project_ids() / '
  'get_my_writable_project_ids(). tenant_id is retained (migration 008 step 5) '
  'and is used only by the transitional project_id-is-null branch, which '
  'covers legacy rows of multi-project tenants that could not be backfilled '
  'and is scoped to tenant owners. No grant to authenticated exists yet — '
  'all live access is service-role.';


-- ============================================================
-- Verification — run in the Supabase SQL editor after applying
-- ============================================================
--
-- 1. The three tenant-grain policies are gone and three project-grain ones
--    exist in their place:
--
--    select policyname, cmd, qual, with_check
--    from   pg_policies
--    where  schemaname = 'public' and tablename = 'leads'
--    order  by cmd, policyname;
--
--    Expected: exactly 3 rows —
--      "Members read leads for their projects"          | SELECT
--      "Writable roles insert leads for their projects" | INSERT
--      "Writable roles update leads for their projects" | UPDATE
--    and NO policy whose name contains 'for their tenants'. Every qual must
--    mention get_my_project_ids or get_my_writable_project_ids; the only
--    permitted mention of a tenant helper is get_my_owned_tenant_ids inside
--    the `project_id is null` branch.
--
-- 2. Nothing else about the table changed (RLS still on, no DELETE policy):
--
--    select rowsecurity from pg_tables
--    where  schemaname = 'public' and tablename = 'leads';   -- expect true
--
--    select count(*) from pg_policies
--    where  schemaname = 'public' and tablename = 'leads' and cmd = 'DELETE';
--    -- expect 0
--
-- 3. Backfill outcome — how many leads are still unattributed, and which
--    tenants they belong to. This is the number migration 008's step 4
--    (project_id NOT NULL) is gated on:
--
--    select
--      count(*)                                   as total_leads,
--      count(project_id)                          as with_project_id,
--      count(*) filter (where project_id is null) as still_null
--    from public.leads;
--
--    Expected: still_null = 0 for every single-project tenant. Any non-zero
--    remainder belongs to a multi-project tenant:
--
--    select l.tenant_id, t.slug, count(*) as unattributed_leads
--    from   public.leads l join public.tenants t on t.id = l.tenant_id
--    where  l.project_id is null
--    group  by l.tenant_id, t.slug
--    order  by unattributed_leads desc;
--
--    Every tenant listed must have >1 project (otherwise the backfill missed
--    something and should be investigated before anything else is applied):
--
--    select t.slug, count(p.id) as projects
--    from   public.tenants t left join public.projects p on p.tenant_id = t.id
--    group  by t.slug order by projects desc;
--
-- 4. Grant state is UNCHANGED — this migration must not have granted
--    anything to authenticated:
--
--    select privilege_type from information_schema.role_table_grants
--    where  table_schema = 'public' and table_name = 'leads'
--    and    grantee = 'authenticated';
--
--    Expected: 0 rows. If this returns rows, someone has already turned the
--    dashboard leads read on — which is fine, but then the behaviour change
--    in this migration is live rather than latent and should be smoke-tested
--    against a real session immediately.
--
-- 5. Behavioural proof (harness, not the dashboard): `npm run verify` in
--    supabase/verify — blocks "(g) leads" and "(i) two-project tenant"
--    assert exactly the before/after this migration claims, on a real
--    PostgreSQL with per-user JWT claims.

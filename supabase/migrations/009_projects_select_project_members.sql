-- ============================================================
-- Migration 009 — projects SELECT: widen to cover project_members
--
-- ADR-017 slice 2. Closes the "Known limitation" flagged by slice 1
-- (src/lib/api/tenant-context.ts, module comment, "Known limitation
-- surfaced, not fixed, by this slice"):
--
--   The existing `projects` SELECT policy (migration 004, "Members can
--   read their projects") is scoped to
--     tenant_id in (select public.get_my_tenant_ids())
--   i.e. tenant_members only. A user who holds ONLY a project_members
--   grant (migration 007) — no tenant_members row for that project's
--   tenant — cannot read that project's row, and therefore cannot resolve
--   its slug. getTenantAuthorizationContext() degrades gracefully today
--   (skips the grant, logs a warning) rather than fabricating a slug; this
--   migration removes the need for that degradation going forward.
--
-- PHASE — READ-WIDENING ONLY. This migration touches exactly one policy:
-- the SELECT policy on public.projects. It is additive in effect — every
-- read a tenant member could already perform remains unchanged; the only
-- new capability is a project_members-only user reading the single project
-- row(s) they hold an explicit editor/viewer grant on.
--
-- What does NOT change:
--   - The projects ALL policy ("Owners can manage their projects") —
--     INSERT/UPDATE/DELETE on projects remains owner-only, exactly as
--     migration 004 left it. This migration does not touch it.
--   - Any policy on any other table (tenants, leads, tenant_members,
--     project_members).
--   - get_my_tenant_ids() / get_my_owned_tenant_ids() — unchanged, reused
--     as-is.
--
-- Recursion check: the added branch queries public.project_members with a
-- simple `user_id = auth.uid()` predicate — no reference back to
-- public.projects, no reference to any policy on project_members. This is
-- the same non-recursive shape already used by get_my_project_ids()
-- (migration 007), just inlined directly into the projects policy instead
-- of going through a SECURITY DEFINER function. Either form is safe here
-- because project_members has its own RLS enabled independently (migration
-- 007) and a direct subquery against it from a *different* table's policy
-- does not re-enter that table's own policies in a way that recurses —
-- recursion only occurs when a table's policy queries itself. (A
-- SECURITY DEFINER wrapper, e.g. get_my_project_ids(), would also work and
-- was considered; querying project_members directly is used here to keep
-- the widened condition inline and easy to audit against the exact wording
-- ADR-017 slice 1's "Known limitation" note specified.)
-- ============================================================


-- ── Drop and recreate: projects SELECT ──────────────────────────────────────
--
-- Exact policy name from migration 004: "Members can read their projects".
-- The original tenant_members condition is preserved verbatim; only an
-- OR-ed project_members branch is added.

drop policy if exists "Members can read their projects" on public.projects;

create policy "Members can read their projects"
  on public.projects for select
  using (
    tenant_id in (select public.get_my_tenant_ids())
    or
    id in (select project_id from public.project_members where user_id = auth.uid())
  );

comment on policy "Members can read their projects" on public.projects is
  'ADR-017 slice 2 (migration 009): widened from migration 004''s '
  'tenant_members-only condition to also cover project_members-only grants. '
  'A user reads a projects row if EITHER (a) they are a member (any role) of '
  'the project''s tenant via tenant_members, OR (b) they hold an explicit '
  'editor/viewer project_members row for that specific project. Branch (a) '
  'is the original migration 004 condition, unchanged. Branch (b) is '
  'additive-only — it can never remove a read a tenant member already had.';


-- ── Verification queries ─────────────────────────────────────────────────────
--
-- Run these immediately after applying the migration.

-- 1. Confirm the policy was recreated with both branches present.
--
--    select policyname, cmd, qual
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'projects'
--    and    policyname = 'Members can read their projects';
--
--    Expected: one row, qual contains both
--      "tenant_id in (SELECT get_my_tenant_ids())"
--    and
--      "id in (SELECT project_id FROM project_members WHERE (user_id = auth.uid()))"
--    joined by OR.

-- 2. Confirm policy count on projects is unchanged (still 2: this SELECT
--    policy + migration 004's "Owners can manage their projects" ALL policy).
--
--    select tablename, count(*) as policy_count
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'projects'
--    group  by tablename;
--
--    Expected: projects → 2.

-- 3. Confirm the ALL (write) policy on projects is untouched — same
--    definition as migration 004 left it.
--
--    select policyname, cmd, qual
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'projects'
--    and    policyname = 'Owners can manage their projects';
--
--    Expected: qual = "tenant_id in (SELECT get_my_owned_tenant_ids())",
--    unchanged from migration 004.

-- 4. Confirm no other table's policies were touched by this migration.
--
--    select tablename, count(*) as policy_count
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  in ('tenants', 'leads', 'tenant_members', 'project_members')
--    group  by tablename
--    order  by tablename;
--
--    Expected (unchanged from migrations 004/007):
--      leads          → 3
--      project_members → 4
--      tenant_members  → 5
--      tenants         → 1


-- ── SEED / VERIFY — live DB check for Tom ───────────────────────────────────
--
-- Goal: demonstrate that a project-members-only user (no tenant_members row
-- for that project's tenant) can now read that single project row.
--
-- Honest limitation up front: the Supabase SQL editor runs as the
-- `postgres` superuser (or via service role), which BYPASSES RLS entirely.
-- No query run directly in the SQL editor can be used to prove "RLS now
-- lets user X read project Y" — RLS only activates for a request carrying
-- a real authenticated session (a JWT with `auth.uid()` set), which the SQL
-- editor does not have. The checks below split into what IS verifiable now
-- (the policy shape, the helper data, referential correctness) and what
-- requires a real session and is DEFERRED to slice 4 (the invite flow,
-- once a real second test user exists).
--
-- ── Verifiable now (no real session required) ───────────────────────────────
--
-- A. Policy shape — already covered by verification query 1 above.
--
-- B. Seed a throwaith test project_members row and confirm the helper
--    function + the underlying data are consistent, using the seeded IDs
--    directly (not via RLS — via a superuser read, just checking the
--    referential shape is correct). Replace the two placeholder UUIDs
--    below with a real project id (from `select id, slug from projects`)
--    and a real auth.users id (from `select id from auth.users limit 1` —
--    use a user who is NOT already a tenant_members owner/editor/viewer for
--    that project's tenant, so the test isolates the new branch).
--
--    -- Clearly-labelled test data — safe to delete, see cleanup below.
--    insert into public.project_members (project_id, user_id, role)
--    values ('00000000-0000-0000-0000-000000000000'::uuid,  -- TODO: replace with real project id
--            '00000000-0000-0000-0000-000000000000'::uuid,  -- TODO: replace with real user id, non-tenant-member of that project's tenant
--            'editor')
--    returning id, project_id, user_id, role;
--
--    -- Confirm get_my_project_ids()/get_my_writable_project_ids() would
--    -- include this project for that user — checked by re-deriving the
--    -- function body's query directly (bypasses auth.uid(), substitutes the
--    -- seeded user id explicitly, since the SQL editor has no session):
--    select id
--    from   public.projects
--    where  tenant_id in (
--             select tenant_id from public.tenant_members
--             where  user_id = '00000000-0000-0000-0000-000000000000'::uuid
--             and    role = 'owner'
--           )
--    union
--    select project_id
--    from   public.project_members
--    where  user_id = '00000000-0000-0000-0000-000000000000'::uuid;
--
--    Expected: the seeded project id appears in the result, via the second
--    branch (project_members), even though it is absent from the first
--    branch (no owned tenant) — this confirms the DATA shape the new RLS
--    branch depends on is correct. It does NOT execute the RLS policy
--    itself (that requires `auth.uid()`, i.e. a real session).
--
--    -- Cleanup — remove the seeded row once done:
--    delete from public.project_members
--    where  project_id = '00000000-0000-0000-0000-000000000000'::uuid
--    and    user_id    = '00000000-0000-0000-0000-000000000000'::uuid;
--
-- ── Requires a real authenticated session — defer to slice 4 ───────────────
--
-- C. The actual RLS enforcement check: log in as the seeded project_members
--    user (via the app, once the invite flow — slice 4 — can create such a
--    session, or manually via `supabase.auth.signInWithPassword` in a
--    script using the anon key) and confirm:
--      - `select * from projects where id = '<seeded project id>'` returns
--        exactly 1 row (proves the new OR branch fires under real RLS).
--      - `select * from projects where id != '<seeded project id>'` for any
--        project outside both their tenant_members and project_members
--        grants returns 0 rows (proves the widening did not leak reads).
--    This is the assertion that actually proves the fix under RLS; it
--    cannot be done from the SQL editor and is intentionally deferred.
--
-- D. Regression check for an EXISTING tenant member (make sure their reads
--    are unchanged): once any real session exists for a user who is a
--    tenant_members member (any role) of a tenant with N projects, confirm
--    `select count(*) from projects` returns the same N as before this
--    migration (a simple before/after count under that user's session).
--    Deferred for the same reason as C — needs a real session, not a
--    superuser SQL-editor query.

-- ============================================================
-- Migration 013 — fix infinite recursion in the projects SELECT policy
--
-- Fixes a LIVE bug hit by a real authenticated user loading /account:
--
--   getTenantAuthorizationContext: failed to read projects for owned
--   tenants — infinite recursion detected in policy for relation
--   "projects"
--   (src/lib/api/tenant-context.ts:251, the `projects` read inside
--   getTenantAuthorizationContext(), triggered by
--   `.from('projects').select(...).in('tenant_id', ownedTenantIds)`)
--
-- ── Root cause: migration 009 broke the SECURITY DEFINER convention ────────
--
-- Migrations 003/004/007 established one rule for every RLS policy in this
-- schema: if a policy on table A needs to know something about table B, and
-- B also has RLS enabled, the policy reads B through a SECURITY DEFINER
-- helper function (get_my_tenant_ids(), get_my_owned_tenant_ids(),
-- get_my_project_ids(), get_my_writable_project_ids()) — never a raw
-- subquery against B. SECURITY DEFINER functions run with the privileges
-- of their owner and bypass RLS on the tables they read internally, which
-- is exactly what prevents the policy evaluator from re-entering B's own
-- policies while evaluating A's policy.
--
-- Migration 009 widened the `projects` SELECT policy to also cover
-- project_members-only grants, but did so with a *raw* subquery against
-- `project_members` instead of the existing get_my_project_ids() helper:
--
--   id in (select project_id from public.project_members
--          where user_id = auth.uid())
--
-- Migration 009's own comment argued this was safe because the subquery
-- doesn't reference `projects` directly. That reasoning is incomplete: a
-- raw (non-SECURITY-DEFINER) subquery against project_members does not
-- bypass RLS — it still evaluates project_members' own SELECT policies,
-- exactly as if project_members had been queried directly. This matters
-- because one of project_members' four policies, "Tenant owners can read
-- members of their projects" (migration 007), itself contains a raw
-- subquery against `projects`:
--
--   project_id in (select id from public.projects
--                  where tenant_id in (select public.get_my_owned_tenant_ids()))
--
-- ── The recursion cycle ─────────────────────────────────────────────────
--
--   1. tenant-context.ts reads `projects` (line ~245:
--      `.from('projects').select(...).in('tenant_id', ownedTenantIds)`)
--   2. → evaluates the `projects` SELECT policy (migration 009), which
--      contains: `id in (select project_id from project_members
--      where user_id = auth.uid())`
--   3. → evaluating that subquery requires reading `project_members`,
--      which evaluates ALL FOUR of project_members' own RLS policies
--      (Postgres OR-combines every applicable policy for a SELECT)
--   4. → one of those policies, "Tenant owners can read members of their
--      projects" (migration 007), contains: `project_id in (select id
--      from public.projects where tenant_id in
--      (select public.get_my_owned_tenant_ids()))`
--   5. → evaluating THAT subquery requires reading `projects` again,
--      which re-evaluates the `projects` SELECT policy from step 2
--   6. → back to step 2, ad infinitum → Postgres detects the cycle and
--      raises "infinite recursion detected in policy for relation
--      projects"
--
-- The cycle exists because step 2's subquery is raw (not SECURITY
-- DEFINER), so it does not bypass project_members' RLS, and step 4's
-- subquery is also raw, so it does not bypass projects' RLS. Either one
-- alone would be enough to cause recursion; migration 009 introduced the
-- first one, completing a cycle that migration 007's pre-existing raw
-- subquery had left latent (007's policy was never reachable from a
-- `projects` read until 009 added the reverse edge).
--
-- ── The fix ──────────────────────────────────────────────────────────────
--
-- Replace migration 009's raw project_members subquery with the existing
-- get_my_project_ids() helper (migration 007) — SECURITY DEFINER, already
-- computes exactly "projects belonging to a tenant I own, UNION projects
-- I hold an explicit project_members row for". Being SECURITY DEFINER, it
-- bypasses RLS on project_members entirely, so evaluating it never
-- re-enters project_members' policies (including the migration 007 policy
-- that reads `projects`) — the cycle at step 3 above never starts.
--
-- Visibility check — does get_my_project_ids() alone cover what migration
-- 009's two branches covered?
--   Migration 009 branch (a): tenant_id in (select get_my_tenant_ids())
--     → ANY tenant_members role (owner, editor, viewer) on that tenant.
--   get_my_project_ids() covers: tenant_id in
--     (select get_my_owned_tenant_ids()) → OWNER role only, UNION
--     project_members rows.
-- get_my_project_ids() is narrower than branch (a) for tenant EDITORS and
-- VIEWERS who hold no project_members row (rare today — every tenant
-- member is currently an owner, since project_members-only access is the
-- new, not-yet-generally-used grant type from ADR-017 slice 2 — but the
-- schema permits it and migration 009 explicitly granted it). To lose
-- zero visibility versus migration 009's intent, this migration keeps
-- branch (a) — `tenant_id in (select public.get_my_tenant_ids())` — VERBATIM
-- (unchanged from migrations 004 and 009; get_my_tenant_ids() is SECURITY
-- DEFINER, reads only tenant_members, recursion-safe on its own) and ORs
-- it with `id in (select public.get_my_project_ids())` in place of the raw
-- project_members subquery. Both sides are now SECURITY DEFINER-only reads;
-- neither can trigger project_members' or projects' own RLS policies.
--
-- ── Reverse-direction check (project_members → projects) ───────────────
--
-- Migration 007's "Tenant owners can read members of their projects"
-- policy still contains its original raw subquery against `projects`.
-- Left unchanged, is it still safe? Trace a read that hits it — e.g.
-- `select * from project_members` under RLS:
--   1. → evaluates project_members' 4 SELECT policies, including
--      "Tenant owners can read members of their projects", whose raw
--      subquery reads `projects`
--   2. → evaluates the (now-fixed) `projects` SELECT policy: `tenant_id in
--      (select get_my_tenant_ids())` OR `id in (select
--      get_my_project_ids())` — BOTH are SECURITY DEFINER helper calls
--   3. → get_my_tenant_ids() reads tenant_members with RLS bypassed (it's
--      SECURITY DEFINER); get_my_project_ids() reads projects AND
--      project_members, both with RLS bypassed (also SECURITY DEFINER)
--   4. → neither helper re-invokes the `projects` policy or the
--      `project_members` policy currently being evaluated — the recursive
--      edge is gone
-- The cycle is broken at step 2: the only reason `projects`' policy used
-- to loop back into project_members was its own raw subquery (migration
-- 009), which this migration removes. Migration 007's raw subquery against
-- `projects` is no longer a problem because `projects`' policy no longer
-- reads project_members at all — there is nothing left for it to loop back
-- into. No change to migration 007 / project_members policies is required.
-- (Left as-is rather than also converting to a helper, per the minimal-fix
-- principle — introducing a new get_my_owned_project_ids() helper here
-- would be an unforced, untested change with no remaining recursion risk
-- to justify it.)
--
-- PHASE — POLICY FIX ONLY. Touches exactly one policy: the SELECT policy
-- on public.projects. No schema, table, grant, or helper-function change.
-- Additive-in-effect versus migration 009's intent (same two conditions,
-- recursion-free); no new capability, no capability removed.
-- ============================================================


-- ── Drop and recreate: projects SELECT ──────────────────────────────────────
--
-- Exact policy name from migrations 004/009: "Members can read their
-- projects". Branch (a) — tenant_members, any role — is preserved
-- verbatim. Branch (b) is rewritten from a raw project_members subquery to
-- the SECURITY DEFINER get_my_project_ids() helper.

drop policy if exists "Members can read their projects" on public.projects;

create policy "Members can read their projects"
  on public.projects for select
  using (
    tenant_id in (select public.get_my_tenant_ids())
    or
    id in (select public.get_my_project_ids())
  );

comment on policy "Members can read their projects" on public.projects is
  'Migration 013: fixes infinite recursion introduced by migration 009. '
  'Branch (a), tenant_id in (select get_my_tenant_ids()), is unchanged from '
  'migrations 004/009 — any tenant_members role (owner/editor/viewer) on '
  'the project''s tenant. Branch (b) now calls the SECURITY DEFINER '
  'get_my_project_ids() helper (migration 007) instead of a raw '
  'project_members subquery — get_my_project_ids() itself already unions '
  'owned-tenant projects with explicit project_members grants, and being '
  'SECURITY DEFINER it bypasses RLS on both projects and project_members, '
  'so evaluating this policy can never re-enter project_members'' policies '
  '(one of which read projects, closing the recursive cycle migration 009 '
  'introduced). No visibility change versus migration 009''s intent.';


-- ── Verification queries ─────────────────────────────────────────────────────
--
-- Run these immediately after applying the migration.

-- 1. Confirm the policy was recreated and both branches call only SECURITY
--    DEFINER helpers — no raw project_members or projects subquery.
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
--      "id in (SELECT get_my_project_ids())"
--    joined by OR — and MUST NOT contain the literal text
--    "project_members" (that would indicate the raw subquery is still
--    present).

-- 2. Confirm policy count on projects is unchanged (still 2: this SELECT
--    policy + migration 004's "Owners can manage their projects" ALL
--    policy).
--
--    select tablename, count(*) as policy_count
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'projects'
--    group  by tablename;
--
--    Expected: projects → 2.

-- 3. Confirm the ALL (write) policy on projects is untouched.
--
--    select policyname, cmd, qual
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'projects'
--    and    policyname = 'Owners can manage their projects';
--
--    Expected: qual = "tenant_id in (SELECT get_my_owned_tenant_ids())",
--    unchanged from migration 004.

-- 4. Confirm project_members' policies (migration 007) are untouched —
--    this migration does not modify them (see "Reverse-direction check"
--    above for why they no longer need to be).
--
--    select policyname, cmd, qual
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'project_members'
--    order  by policyname;
--
--    Expected: 4 rows, identical to migration 007's definitions.

-- 5. Confirm no other table's policies were touched by this migration.
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


-- ── How Tom confirms the resolver read now succeeds ─────────────────────────
--
-- The Supabase SQL editor runs as `postgres`/service_role, which bypasses
-- RLS — it cannot reproduce or disprove the recursion (same limitation
-- noted in migration 009). The only real proof is the application path
-- that originally failed:
--
--   1. Apply this migration via the Supabase dashboard SQL editor.
--   2. Run verification query 1 above — confirm no "project_members" text
--      appears in the recreated policy's qual.
--   3. As a real logged-in tenant owner, reload https://dev.abluo.app/account
--      (or the equivalent preview/local URL for the environment this was
--      applied to).
--   4. Expected: the page loads without the
--      "getTenantAuthorizationContext: failed to read projects for owned
--      tenants — infinite recursion detected in policy for relation
--      projects" error. If any server-side error logging is available for
--      that request, confirm it is now absent.
--   5. Regression check: the same user's visible projects/tenants on
--      /account should be unchanged from before migration 009 was ever
--      applied (this migration is recursion-only surgery, not a
--      visibility change).

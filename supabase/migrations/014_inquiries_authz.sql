-- ============================================================
-- Migration 014 — inquiries authz (closes the live P0)
--
-- ⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK.
-- This is a FILE ONLY, handed to Tom to review and apply manually via the
-- Supabase SQL editor, per CLAUDE.md's Schema Evolution Rules ("Tom decides
-- at execution time" category) and this task's explicit hard stop. Proven
-- against the local live-DB verification harness only
-- (supabase/verify/live-rls.verify.mjs, describe block "(e) inquiries
-- authz — migration 014") — see that file and the handoff for the isolation
-- proof this migration was checked against before being handed over.
--
-- ── The P0 this closes ───────────────────────────────────────────────────
-- `PATCH /api/inquiries/[id]` (src/app/api/inquiries/[id]/route.ts) uses
-- `createAdminClient()` (service_role — bypasses RLS AND grants entirely)
-- with NO authentication check, keyed only on the request-supplied `id`.
-- Any unauthenticated caller who can guess/enumerate a UUID can read and
-- modify any tenant's inquiry data. This migration is the DATABASE half of
-- the fix — the route itself is fixed separately (route.ts, this same
-- handoff) to require an authenticated actor and to use the RLS-scoped
-- client instead of the admin client, so this migration's grants + policies
-- are what actually enforce the scoping once the route stops bypassing them.
--
-- ── Schema check performed first, per CLAUDE.md Schema Evolution Rules ────
-- `public.inquiries` (migration 005) already carries BOTH `tenant_id uuid`
-- (nullable, references public.tenants, on delete set null) and
-- `project_id uuid` (nullable, references public.projects, on delete set
-- null) — no schema change is required here, only grants + policies.
-- Platform-level inquiries (Abluo's own early-access form) have
-- tenant_id = NULL and project_id = NULL by design (migration 005 header)
-- — those rows fall outside both RLS branches below, which is correct: no
-- tenant/project member should ever see a platform-level inquiry, only the
-- Abluo admin dashboard (service role) does.
--
-- ── What this migration does ─────────────────────────────────────────────
-- 1. `grant select, update on public.inquiries to authenticated` — a plain
--    table-level SELECT + UPDATE grant (not column-scoped — unlike
--    migration 012's profiles grant, whose column-scoping is exactly what
--    surfaced a "WHERE-clause needs SELECT too" gap the live-DB harness
--    caught; granting full-table SELECT here avoids repeating that class of
--    mistake for a WHERE id = $1 UPDATE, which is the exact shape the
--    fixed route uses).
-- 2. Two RLS policies, reusing the EXISTING SECURITY DEFINER helpers —
--    never a raw subquery against tenant_members/project_members/projects
--    (migration 013's lesson: a raw subquery against a table that itself
--    reads back into the policy under evaluation is how the projects/
--    project_members recursion incident happened):
--      SELECT — any tenant member (owner/editor/viewer, get_my_tenant_ids())
--        OR any project grant holder (get_my_project_ids(), migration 007)
--        can read an inquiry scoped to their tenant/project. Mirrors the
--        existing `leads` SELECT policy shape (migration 004) exactly, plus
--        the project_id OR-branch ADR-017's project grain adds.
--      UPDATE — owner/editor only (get_my_writable_tenant_ids() OR
--        get_my_writable_project_ids(), migration 004/007) — viewer stays
--        read-only, same convention as leads' write policies. This is what
--        lets the fixed PATCH route (step-2 qualification data completion)
--        work for a legitimate tenant/project contributor while a tenant
--        member of a DIFFERENT tenant, or an anonymous caller, is denied.
--
-- ── What this migration deliberately does NOT do ─────────────────────────
-- - No INSERT policy for `authenticated`. Public submitters (the actual
--   writers of new inquiries — POST /api/inquiries, POST
--   /api/form-submissions) are anonymous website visitors, never an
--   authenticated tenant/project member — that path correctly stays
--   service-role-only (wrapped in `runAsTrustedSystemOperation`, see
--   route.ts changes in this same handoff). Flagged as an OPEN DECISION
--   below, not assumed.
-- - No DELETE policy — matches migration 005's original stated intent
--   ("DELETE: service role only") and is unchanged by this migration.
-- - No column-scoping on the UPDATE grant (see point 1 above) — the route
--   only ever sets `data`, `gdpr_consent`, `gdpr_consent_at` in practice,
--   but a column-scoped grant here would need every one of those columns
--   listed AND would still need the plain (non-column-scoped) SELECT grant
--   for the WHERE clause — column-scoping the UPDATE grant buys no
--   additional safety once SELECT is already table-wide, so it is not
--   done, keeping this migration simpler than migration 012's shape.
--
-- ── OPEN DECISION for Tom (not resolved by this migration) ───────────────
-- Should a project/tenant CONTRIBUTOR (owner/editor) be able to manually
-- INSERT an inquiry row from the future dashboard (e.g. logging a phone
-- inquiry taken outside the web form)? Today that capability does not
-- exist in the UI at all, so this migration takes the minimal, reversible
-- position of adding NO authenticated INSERT policy — only extending
-- INSERT policy is required later, additively, if/when that UI is built.
-- Flagged per this task's instructions rather than decided here.
-- ============================================================


-- ── Grants ────────────────────────────────────────────────────────────────

grant select, update on public.inquiries to authenticated;


-- ── Policies ──────────────────────────────────────────────────────────────

create policy "Members can read inquiries for their tenants and projects"
  on public.inquiries for select
  using (
    (tenant_id is not null and tenant_id in (select public.get_my_tenant_ids()))
    or
    (project_id is not null and project_id in (select public.get_my_project_ids()))
  );

comment on policy "Members can read inquiries for their tenants and projects" on public.inquiries is
  'Migration 014. Any tenant member (owner/editor/viewer, get_my_tenant_ids()) '
  'can read inquiries scoped to their tenant_id; any project grant holder '
  '(get_my_project_ids(), migration 007 — covers project_members-only users '
  'too) can read inquiries scoped to their project_id. Both helpers are '
  'SECURITY DEFINER (recursion-safe, migration 013 convention). '
  'Platform-level inquiries (tenant_id AND project_id both null) are '
  'visible to neither branch — by design, only the service-role admin '
  'surface reads those.';

create policy "Contributors can update inquiries for their tenants and projects"
  on public.inquiries for update
  using (
    (tenant_id is not null and tenant_id in (select public.get_my_writable_tenant_ids()))
    or
    (project_id is not null and project_id in (select public.get_my_writable_project_ids()))
  );

comment on policy "Contributors can update inquiries for their tenants and projects" on public.inquiries is
  'Migration 014. Owner/editor only (viewer excluded, same convention as '
  'the leads UPDATE policy, migration 004) — via get_my_writable_tenant_ids() '
  'for tenant-level contributors or get_my_writable_project_ids() '
  '(migration 007) for project-level editors. This is the policy that '
  'lets the fixed PATCH /api/inquiries/[id] route (RLS-scoped client, '
  'authenticated actor required) succeed for a legitimate contributor and '
  'fail closed for a cross-tenant caller or an anonymous request.';


-- ============================================================
-- Verification — run after applying (Supabase SQL editor)
-- ============================================================

-- 1. Confirm the grants now exist for authenticated.
--
--    select table_name, grantee, privilege_type
--    from   information_schema.role_table_grants
--    where  table_schema = 'public'
--    and    table_name   = 'inquiries'
--    and    grantee      = 'authenticated'
--    order  by privilege_type;
--
--    Expected: 2 rows — SELECT, UPDATE.

-- 2. Confirm exactly two policies exist on inquiries (this migration adds
--    both of them; there were zero before).
--
--    select policyname, cmd, qual
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'inquiries'
--    order  by policyname;
--
--    Expected: 2 rows, matching the policy bodies above. Neither qual
--    should contain a raw reference to tenant_members/project_members —
--    only get_my_tenant_ids()/get_my_project_ids()/
--    get_my_writable_tenant_ids()/get_my_writable_project_ids() calls.

-- 3. Confirm no INSERT or DELETE policy exists (unchanged from migration
--    005 — service role only for both).
--
--    select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'inquiries' and cmd in ('INSERT', 'DELETE');
--
--    Expected: 0.

-- 4. Live end-to-end check, once the route fix (this same handoff) is also
--    deployed: as a real logged-in tenant owner/editor, PATCH an inquiry
--    belonging to THEIR project/tenant — expect success. PATCH an inquiry
--    belonging to a DIFFERENT tenant — expect 403/404 from the route (RLS
--    filters it to a 0-row UPDATE, which the route must treat as "not
--    found/not authorized", not silently report success).

-- 5. Regression check — confirm this did not change what the anonymous
--    POST paths (POST /api/inquiries, POST /api/form-submissions) do; they
--    are unauthenticated service-role INSERTs, never touched by this
--    migration's SELECT/UPDATE-only grants and policies.

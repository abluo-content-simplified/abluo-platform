-- ============================================================
-- Migration 007 — project_members
--
-- ADR-017 slice 1: adds per-project membership authorization,
-- the grain ADR-017 Decision 1 settles on top of the existing
-- per-tenant `tenant_members` (migration 003/004).
--
-- PHASE — ADDITIVE ONLY. This migration does not remove, alter,
-- or repoint any existing table, column, RLS policy, or trigger.
-- `tenant_members` is unchanged and remains the account/tenant
-- identity anchor (ADR-017 Decision 1). Nothing in the application
-- reads project_members yet — this migration is inert until
-- `TenantAuthorizationContext` (src/lib/api/tenant-context.ts) is
-- wired into a route, which is a later ADR-017 slice.
--
-- What changes:
--   - New table:    public.project_members
--   - New function: public.get_my_project_ids()          [SECURITY DEFINER]
--   - New function: public.get_my_writable_project_ids()  [SECURITY DEFINER]
--   - RLS enabled on project_members with four policies
--
-- What does NOT change:
--   - public.tenant_members, public.profiles, public.projects, public.leads
--   - Any existing RLS policy on any existing table
--   - handle_new_user() trigger
--
-- Role model (ADR-017 Decision 1 + Decision 2 — tenant-owner precedence):
--   owner  — a TENANT-level role, held in tenant_members. Owning a tenant
--            grants implicit access to ALL of that tenant's projects; no
--            project_members row is needed or created for an owner.
--   editor — a PROJECT-level role, held in project_members. Content +
--            leads write access for that project only.
--   viewer — a PROJECT-level role, held in project_members. Read-only
--            access for that project only.
--
-- 'owner' is intentionally NOT a valid role value in project_members.role —
-- ownership is expressed exclusively through tenant_members, per ADR-017
-- Decision 2. project_members.role is deliberately extensible (a check
-- constraint, not an enum) for a future project-level role beyond
-- editor/viewer, but only editor/viewer are valid today.
--
-- RLS design note (same pattern as migration 003/004): a policy that reads
-- project_members from within a project_members policy self-references and
-- raises "infinite recursion detected in policy for relation project_members".
-- The fix is the same SECURITY DEFINER helper-function pattern used by
-- get_my_owned_tenant_ids() / get_my_tenant_ids() — the table is created
-- before the helper functions so PostgreSQL can validate the LANGUAGE SQL
-- function bodies at creation time.
-- ============================================================


-- ── Table ─────────────────────────────────────────────────────────────────────

create table public.project_members (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references public.projects (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  role        text        not null
                check (role in ('editor', 'viewer')),
  created_at  timestamptz not null default now(),

  unique (project_id, user_id)
);

comment on table public.project_members is
  'One row per user–project membership (ADR-017 Decision 1). '
  'A user can hold a distinct editor/viewer role on any number of projects, '
  'including projects belonging to different tenants. Tenant ownership '
  '(the ''owner'' role) is NOT stored here — it lives exclusively in '
  'tenant_members and implicitly grants access to all of that tenant''s '
  'projects (ADR-017 Decision 2, tenant-owner precedence).';

comment on column public.project_members.role is
  'editor — content + media + leads write access, scoped to this project only. '
  'viewer — read-only access, scoped to this project only. '
  '''owner'' is deliberately not a valid value here: ownership is tenant-level '
  '(see tenant_members) and is never expressed as a project_members row. '
  'The check constraint intentionally lists only current roles — extend it '
  'if a future project-level role beyond editor/viewer is introduced.';


-- ── Indexes ───────────────────────────────────────────────────────────────────

create index project_members_user_id_idx    on public.project_members (user_id);
create index project_members_project_id_idx on public.project_members (project_id);


-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.project_members enable row level security;


-- ── Helper functions ───────────────────────────────────────────────────────────
--
-- Must be created after the table so PostgreSQL can validate the body.
-- Both are SECURITY DEFINER so the inner query bypasses RLS, preventing the
-- infinite recursion that would occur if a project_members policy directly
-- queried project_members. set search_path = '' forces fully-qualified names,
-- preventing search_path injection attacks — same convention as migration 004.
--
-- Both helpers reuse the existing tenant_members helpers (get_my_owned_tenant_ids()
-- / migration 003) rather than re-deriving tenant ownership, per ADR-017
-- Decision 2: "a tenant owner implicitly gets all that tenant's projects."

-- Returns the project_ids the current user can act in at all (any role):
-- every project belonging to a tenant they own, UNION every project they
-- hold an explicit project_members row for (editor or viewer).
create or replace function public.get_my_project_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from   public.projects
  where  tenant_id in (select public.get_my_owned_tenant_ids())

  union

  select project_id
  from   public.project_members
  where  user_id = auth.uid()
$$;

comment on function public.get_my_project_ids() is
  'Returns project_ids the current user can act in with any role: the union '
  'of (a) every project belonging to a tenant they own (tenant_members, '
  'role = owner) and (b) every project they hold an explicit project_members '
  'row for (editor or viewer). SECURITY DEFINER so it bypasses RLS on '
  'project_members, preventing infinite recursion in self-referential policies.';


-- Returns the project_ids the current user can WRITE to: every project
-- belonging to a tenant they own, UNION every project they hold an
-- editor grant on via project_members. Viewer is intentionally excluded —
-- viewer is read-only at the database layer, same convention as
-- get_my_writable_tenant_ids() (migration 004).
create or replace function public.get_my_writable_project_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from   public.projects
  where  tenant_id in (select public.get_my_owned_tenant_ids())

  union

  select project_id
  from   public.project_members
  where  user_id = auth.uid()
  and    role    = 'editor'
$$;

comment on function public.get_my_writable_project_ids() is
  'Returns project_ids the current user can write to: every project '
  'belonging to a tenant they own, plus every project_members row with '
  'role = editor. Viewer is excluded — viewer is read-only at the database '
  'layer. SECURITY DEFINER so it bypasses RLS on project_members.';


-- ── Policies ──────────────────────────────────────────────────────────────────
--
-- Read: a user can always see their own membership rows.
-- Write (insert/update/delete): gated to tenant owners of the project's
-- tenant — owners manage who else can edit their projects, mirroring how
-- migration 004 gates tenant_members writes via the owner helper. This is
-- deliberately narrower than "project owner manages project members" because
-- ADR-017 Decision 2 keeps ownership tenant-level: there is no project-level
-- owner to delegate from.

-- Any user can see their own membership rows.
-- Simple equality check — no subquery, no recursion risk.
create policy "Users can read their own project memberships"
  on public.project_members for select
  using (user_id = auth.uid());

-- Tenant owners can see all project_members rows for projects under
-- tenants they own (for a future project-members-list UI).
create policy "Tenant owners can read members of their projects"
  on public.project_members for select
  using (
    project_id in (
      select id from public.projects
      where tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );

-- Tenant owners can grant editor/viewer access to projects under
-- tenants they own. WITH CHECK (not USING) because this is an INSERT policy.
create policy "Tenant owners can add members to their projects"
  on public.project_members for insert
  with check (
    project_id in (
      select id from public.projects
      where tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );

-- Tenant owners can change member roles on projects under tenants they own.
create policy "Tenant owners can update members of their projects"
  on public.project_members for update
  using (
    project_id in (
      select id from public.projects
      where tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );

-- Tenant owners can remove members from projects under tenants they own.
create policy "Tenant owners can remove members from their projects"
  on public.project_members for delete
  using (
    project_id in (
      select id from public.projects
      where tenant_id in (select public.get_my_owned_tenant_ids())
    )
  );


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Run these queries after applying the migration to confirm correctness.
-- No backfill is expected — this table starts empty; project_members rows
-- are created going forward via the (not-yet-built) invite flow.
--
-- 1. Table exists with the expected columns and constraint:
--
--    select column_name, data_type, is_nullable
--    from   information_schema.columns
--    where  table_schema = 'public'
--    and    table_name   = 'project_members'
--    order  by ordinal_position;
--
--    Expected columns: id, project_id, user_id, role, created_at
--
-- 2. Role check constraint only allows editor/viewer (owner must fail):
--
--    select conname, pg_get_constraintdef(oid)
--    from   pg_constraint
--    where  conrelid = 'public.project_members'::regclass
--    and    contype  = 'c';
--
--    Expected: role = ANY (ARRAY['editor'::text, 'viewer'::text])
--
-- 3. Both helper functions exist, SECURITY DEFINER, stable:
--
--    select proname, prosecdef, provolatile
--    from   pg_proc
--    where  proname in ('get_my_project_ids', 'get_my_writable_project_ids')
--    and    pronamespace = 'public'::regnamespace;
--
--    Expected: 2 rows. prosecdef = true, provolatile = 's' for both.
--
-- 4. Policy count on project_members:
--
--    select tablename, count(*) as policy_count
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  = 'project_members'
--    group  by tablename;
--
--    Expected: project_members → 4
--
-- 5. Table starts empty (no backfill in this migration):
--
--    select count(*) from public.project_members;
--
--    Expected: 0

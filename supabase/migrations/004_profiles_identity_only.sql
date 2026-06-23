-- ============================================================
-- Migration 004 — Profiles: identity only
--
-- Completes the transition from the single-tenant profile model
-- to the multi-tenant membership model introduced in Migration 003.
--
-- What this migration does:
--   1. Adds two new SECURITY DEFINER helper functions:
--        get_my_tenant_ids()         — all roles (owner, editor, viewer)
--        get_my_writable_tenant_ids() — owner and editor only
--   2. Drops all RLS policies on tenants, leads, and projects that
--      reference the profiles table
--   3. Creates new RLS policies using tenant_members helper functions
--   4. Replaces handle_new_user() so it writes identity data to profiles
--      and membership data to tenant_members
--   5. Adds profiles.avatar_url (text, nullable)
--   6. Drops profiles.tenant_id and profiles.role
--
-- After this migration profiles contains only:
--   id, full_name, avatar_url, created_at
--
-- Helper function inventory after this migration:
--   get_my_tenant_ids()          → owner, editor, viewer  (new)
--   get_my_writable_tenant_ids() → owner, editor          (new)
--   get_my_owned_tenant_ids()    → owner only             (from 003)
--
-- Pre-execution audit result (2026-06-18):
--   Zero references to profiles.tenant_id or profiles.role found in
--   application code. proxy.ts line 254 reads user_role from JWT —
--   this is a separate known issue, not a database column read.
--   No application code changes required before or after this migration.
--
-- RLS permission model enforced at the database layer:
--   tenants  SELECT  → any tenant member
--   leads    SELECT  → any tenant member
--   leads    INSERT  → owner, editor only (viewer is read-only)
--   leads    UPDATE  → owner, editor only (viewer is read-only)
--   projects SELECT  → any tenant member
--   projects ALL     → owner only
-- ============================================================


-- ── Helper functions ──────────────────────────────────────────────────────────
--
-- Both functions are SECURITY DEFINER so they query tenant_members without
-- triggering RLS on that table. This is the same pattern used by
-- get_my_owned_tenant_ids() in Migration 003 to avoid self-referential
-- recursion. All three functions must come before the policies that use them.
--
-- Execution note: get_my_owned_tenant_ids() already exists from Migration 003.
-- It is not redefined here.

-- Returns tenant_ids where the current user has any membership role.
-- Used by: tenants SELECT, leads SELECT, projects SELECT.
create or replace function public.get_my_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tenant_id
  from   public.tenant_members
  where  user_id = auth.uid()
$$;

comment on function public.get_my_tenant_ids() is
  'Returns tenant_ids where auth.uid() has any membership (owner, editor, or viewer). '
  'SECURITY DEFINER so it bypasses RLS on tenant_members, preventing '
  'infinite recursion in self-referential policies.';


-- Returns tenant_ids where the current user has a role that permits writes.
-- Owner and editor can create and update content and leads.
-- Viewer is intentionally excluded — viewer is read-only at the database layer.
-- Used by: leads INSERT, leads UPDATE.
create or replace function public.get_my_writable_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tenant_id
  from   public.tenant_members
  where  user_id = auth.uid()
  and    role    in ('owner', 'editor')
$$;

comment on function public.get_my_writable_tenant_ids() is
  'Returns tenant_ids where auth.uid() has role owner or editor. '
  'Viewer is excluded — viewer is read-only at the database layer. '
  'SECURITY DEFINER so it bypasses RLS on tenant_members.';


-- ── Drop old policies (profiles-dependent) ────────────────────────────────────
--
-- All six policies below query public.profiles to resolve the current user's
-- tenant_id or role. They must be dropped before profiles.tenant_id and
-- profiles.role are removed. Dropping a policy never affects table data.

-- tenants
drop policy if exists "Users can read their own tenant"   on public.tenants;

-- leads
drop policy if exists "Users can read leads for their tenant"   on public.leads;
drop policy if exists "Users can insert leads for their tenant" on public.leads;
drop policy if exists "Users can update leads for their tenant" on public.leads;

-- projects
drop policy if exists "Users can read their own projects"    on public.projects;
drop policy if exists "Admins can manage their own projects" on public.projects;


-- ── New policies: tenants ──────────────────────────────────────────────────────
--
-- Any authenticated member of a tenant can read that tenant's row.
-- Write access to tenants is reserved for platform admins using the service
-- role client (which bypasses RLS). No write policy is required here.

create policy "Members can read their tenants"
  on public.tenants for select
  using (
    id in (select public.get_my_tenant_ids())
  );


-- ── New policies: leads ───────────────────────────────────────────────────────
--
-- Read: any tenant member (owner, editor, viewer).
-- Write: owner and editor only. Viewer must be read-only at the database layer
--        because Supabase exposes the PostgREST API directly — a viewer with a
--        valid JWT could otherwise bypass the frontend and write leads.

create policy "Members can read leads for their tenants"
  on public.leads for select
  using (
    tenant_id in (select public.get_my_tenant_ids())
  );

create policy "Contributors can insert leads for their tenants"
  on public.leads for insert
  with check (
    tenant_id in (select public.get_my_writable_tenant_ids())
  );

create policy "Contributors can update leads for their tenants"
  on public.leads for update
  using (
    tenant_id in (select public.get_my_writable_tenant_ids())
  );


-- ── New policies: projects ────────────────────────────────────────────────────
--
-- Read: any tenant member can see their projects.
-- Write (ALL): owners only. Project creation and configuration is
--              owner-level — equivalent to site settings, not content editing.
-- Note: FOR ALL covers INSERT, UPDATE, DELETE. The USING clause also gates
--       SELECT, but the first policy (SELECT) already permits that for all roles
--       via an OR combination. The net effect is correct.

create policy "Members can read their projects"
  on public.projects for select
  using (
    tenant_id in (select public.get_my_tenant_ids())
  );

create policy "Owners can manage their projects"
  on public.projects for all
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );


-- ── Replace handle_new_user() trigger ─────────────────────────────────────────
--
-- Old behaviour: inserts into profiles with tenant_id and role from metadata.
-- New behaviour:
--   1. Always insert identity data into profiles (id, full_name).
--      Unlike the old trigger, we no longer gate on tenant_id being present —
--      every authenticated user gets a profile row for their identity data.
--   2. If raw_user_meta_data contains tenant_id, also insert into tenant_members
--      with the provided role (defaulting to 'owner').
--
-- ON CONFLICT DO NOTHING on both inserts makes this idempotent if the trigger
-- fires more than once (e.g. during testing or manual re-runs).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Always create a profile row for identity data.
  -- The profile is now purely an identity record: id, full_name, avatar_url.
  -- No tenant or role data belongs here.
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  -- If tenant_id is provided in signup metadata, create the tenant membership.
  -- The first user for a tenant is always the account owner.
  -- Subsequent invitations pass role explicitly; default is 'owner' as a safe
  -- fallback so no user is accidentally locked out.
  if new.raw_user_meta_data->>'tenant_id' is not null then
    insert into public.tenant_members (tenant_id, user_id, role)
    values (
      (new.raw_user_meta_data->>'tenant_id')::uuid,
      new.id,
      coalesce(new.raw_user_meta_data->>'role', 'owner')
    )
    on conflict (tenant_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger function: runs after INSERT on auth.users. '
  'Always creates a profiles row for identity data. '
  'Creates a tenant_members row if tenant_id is present in signup metadata.';


-- ── profiles table changes ────────────────────────────────────────────────────
--
-- Add avatar_url first so the table is in its final shape before the DROP
-- operations. IF NOT EXISTS prevents failure if the column was added manually.
--
-- Drop tenant_id and role last — only safe once all policies that reference
-- them have been dropped (done above).

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Optional profile picture URL. Set by the user via the dashboard settings.';

alter table public.profiles drop column if exists tenant_id;
alter table public.profiles drop column if exists role;


-- ── Verification queries ──────────────────────────────────────────────────────
--
-- Run these immediately after applying the migration to confirm correctness.
-- All checks should pass before proceeding to application testing.

-- 1. Confirm profiles columns: tenant_id and role must be absent, avatar_url present.
--
--    select column_name, data_type, is_nullable
--    from   information_schema.columns
--    where  table_schema = 'public'
--    and    table_name   = 'profiles'
--    order  by ordinal_position;
--
--    Expected columns: id, full_name, created_at, avatar_url
--    tenant_id and role must NOT appear.

-- 2. Confirm no active policy on tenants/leads/projects references profiles.
--
--    select tablename, policyname, qual, with_check
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  in ('tenants', 'leads', 'projects')
--    and    (qual ilike '%profiles%' or with_check ilike '%profiles%');
--
--    Expected: 0 rows.

-- 3. Confirm handle_new_user() no longer references profiles.tenant_id or role.
--
--    select prosrc
--    from   pg_proc
--    where  proname = 'handle_new_user'
--    and    pronamespace = 'public'::regnamespace;
--
--    Expected: body references tenant_members, not profiles.tenant_id or profiles.role.

-- 4. Confirm all three helper functions exist with the correct signatures.
--
--    select proname, prosecdef, provolatile
--    from   pg_proc
--    where  proname in (
--             'get_my_tenant_ids',
--             'get_my_writable_tenant_ids',
--             'get_my_owned_tenant_ids'
--           )
--    and    pronamespace = 'public'::regnamespace;
--
--    Expected: 3 rows. prosecdef = true for all. provolatile = 's' (stable) for all.

-- 5. Confirm policy count per table is correct.
--
--    select tablename, count(*) as policy_count
--    from   pg_policies
--    where  schemaname = 'public'
--    and    tablename  in ('tenants', 'leads', 'projects', 'profiles', 'tenant_members')
--    group  by tablename
--    order  by tablename;
--
--    Expected:
--      leads          → 3  (read, insert, update)
--      profiles       → 2  (read own, update own — unchanged from schema.sql)
--      projects       → 2  (read members, manage owners)
--      tenant_members → 5  (from migration 003)
--      tenants        → 1  (read members)

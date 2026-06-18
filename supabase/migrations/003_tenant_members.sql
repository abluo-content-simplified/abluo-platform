-- ============================================================
-- Migration 003 — tenant_members
--
-- Introduces the membership model for multi-tenant user management.
-- A single auth.users identity can now belong to multiple tenants,
-- with a distinct role per membership.
--
-- PHASE 1 — ADDITIVE ONLY.
-- This migration does NOT remove or alter any existing tables,
-- columns, RLS policies, or triggers. The profiles table keeps
-- its tenant_id and role columns unchanged. Existing RLS policies
-- continue to work exactly as before.
--
-- What changes:
--   - New table:    public.tenant_members
--   - New function: public.get_my_owned_tenant_ids() [SECURITY DEFINER]
--   - Existing profiles are backfilled into tenant_members
--     with role = 'owner'
--   - RLS is enabled on tenant_members with five policies
--
-- What does NOT change:
--   - public.profiles (tenant_id and role columns intact)
--   - All existing RLS policies on tenants, profiles, leads, projects
--   - handle_new_user() trigger
--   - Dashboard code, auth flows, invitation flows
--
-- Next phase (Migration 004) will:
--   - Drop tenant_id and role from profiles
--   - Rewrite RLS policies on tenants, leads, projects to
--     use tenant_members instead of profiles
--   - Update handle_new_user() trigger
--
-- RLS design note:
--   Policies that need to check "which tenants does the current user
--   own?" cannot directly query tenant_members from within a
--   tenant_members policy — PostgreSQL detects the self-reference and
--   raises: ERROR: infinite recursion detected in policy for relation
--   "tenant_members". The fix is a SECURITY DEFINER helper function.
--   Because the function runs under the owner's privileges (bypassrls),
--   the inner query skips RLS entirely, breaking the recursion.
--   The table must be created before the helper function because
--   PostgreSQL validates LANGUAGE SQL function bodies at creation time.
-- ============================================================


-- ── Table ─────────────────────────────────────────────────────────────────────
-- Created first so the SECURITY DEFINER helper function below can
-- reference it (PostgreSQL validates LANGUAGE SQL bodies at creation time).

create table public.tenant_members (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  role        text        not null default 'owner'
                check (role in ('owner', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),

  unique (tenant_id, user_id)
);

comment on table public.tenant_members is
  'One row per user–tenant membership. '
  'A user can belong to multiple tenants with a distinct role per tenant. '
  'Roles: owner (full control), editor (content + leads), viewer (read-only).';

comment on column public.tenant_members.role is
  'owner  — full control: content, settings, users, billing. '
  'editor — content, media, leads. Cannot manage users or settings. '
  'viewer — read-only: leads and analytics.';


-- ── Indexes ───────────────────────────────────────────────────────────────────

create index tenant_members_user_id_idx   on public.tenant_members (user_id);
create index tenant_members_tenant_id_idx on public.tenant_members (tenant_id);


-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.tenant_members enable row level security;


-- ── Helper function ───────────────────────────────────────────────────────────
--
-- Must be created after the table so PostgreSQL can validate the body.
--
-- Returns the set of tenant_ids where the current user is an owner.
-- Declared SECURITY DEFINER so the inner query bypasses RLS, preventing
-- the infinite recursion that would occur if a tenant_members policy
-- directly queried tenant_members.
--
-- set search_path = '' forces fully-qualified names inside the function,
-- preventing search_path injection attacks.

create or replace function public.get_my_owned_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tenant_id
  from   public.tenant_members
  where  user_id = auth.uid()
  and    role    = 'owner'
$$;

comment on function public.get_my_owned_tenant_ids() is
  'Returns tenant_ids where auth.uid() has role = ''owner''. '
  'SECURITY DEFINER so it bypasses RLS on tenant_members, preventing '
  'infinite recursion in self-referential policies.';


-- ── Policies ──────────────────────────────────────────────────────────────────

-- Any user can see their own membership rows.
-- Simple equality check — no subquery, no recursion risk.
create policy "Users can read their own memberships"
  on public.tenant_members for select
  using (user_id = auth.uid());

-- Owners can see all members of their tenants (for a future members list UI).
-- Uses the SECURITY DEFINER helper to avoid self-referential recursion.
create policy "Owners can read members of their tenants"
  on public.tenant_members for select
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

-- Owners can invite new members into their tenants.
-- WITH CHECK (not USING) because this is an INSERT policy.
create policy "Owners can add members to their tenants"
  on public.tenant_members for insert
  with check (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

-- Owners can change member roles within their tenants.
create policy "Owners can update members of their tenants"
  on public.tenant_members for update
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

-- Owners can remove members from their tenants.
create policy "Owners can remove members from their tenants"
  on public.tenant_members for delete
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );


-- ── Backfill from profiles ────────────────────────────────────────────────────
--
-- Every existing profile maps to exactly one tenant_members row.
-- All existing users are account holders → role = 'owner'.
-- ON CONFLICT is included as a safety net if this migration is
-- re-run or partially applied.

insert into public.tenant_members (tenant_id, user_id, role, created_at)
select
  tenant_id,
  id        as user_id,
  'owner'   as role,
  created_at
from public.profiles
on conflict (tenant_id, user_id) do nothing;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Run these queries after applying the migration to confirm correctness.
-- All three should pass before proceeding to Migration 004.
--
-- 1. Total rows in tenant_members should equal total rows in profiles:
--
--    select
--      (select count(*) from public.profiles)       as profiles_count,
--      (select count(*) from public.tenant_members) as members_count,
--      (select count(*) from public.profiles) =
--      (select count(*) from public.tenant_members) as counts_match;
--
-- 2. Every tenant_members row should have role = 'owner' (all backfilled):
--
--    select role, count(*)
--    from   public.tenant_members
--    group  by role;
--    -- Expected: one row → owner | N
--
-- 3. No duplicate (tenant_id, user_id) pairs exist:
--
--    select tenant_id, user_id, count(*) as occurrences
--    from   public.tenant_members
--    group  by tenant_id, user_id
--    having count(*) > 1;
--    -- Expected: 0 rows

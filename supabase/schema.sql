-- ============================================================
-- Abluo Platform — Canonical Database Schema
-- Run this in Supabase SQL Editor (project: xsdamzirepfqlutvqfbe)
--
-- This file reflects the schema after all migrations have been applied:
--   001  initial schema (tenants, profiles, leads, RLS, handle_new_user)
--   002  projects table
--   003  tenant_members table + get_my_owned_tenant_ids()
--   004  profiles identity-only, new helper functions, updated RLS
--
-- For an existing database, run the numbered migration files in order
-- rather than re-applying this file.
-- ============================================================


-- ============================================================
-- 1. TENANTS
-- Mirrors the Sanity tenant document.
-- Single source of truth for operational/auth data.
-- ============================================================

create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,
  domain       text not null unique,
  status       text not null default 'draft' check (status in ('active', 'inactive', 'draft')),
  plan         text not null default 'starter' check (plan in ('starter', 'pro', 'enterprise')),
  created_at   timestamptz not null default now()
);

comment on table public.tenants is 'One row per client. Mirrors the Sanity tenant document.';

create index tenants_domain_idx on public.tenants (domain);
create index tenants_slug_idx   on public.tenants (slug);


-- ============================================================
-- 2. PROFILES
-- Identity record for each Supabase auth user.
-- Created automatically on signup via handle_new_user().
--
-- This table holds identity data only. Tenant membership and role
-- are stored in tenant_members. A user can belong to multiple
-- tenants with different roles.
-- ============================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Identity record for each auth user. '
  'Tenant membership and role live in tenant_members, not here.';

comment on column public.profiles.avatar_url is
  'Optional profile picture URL. Set by the user via the dashboard settings.';


-- ============================================================
-- 3. TENANT_MEMBERS
-- Links a user to a tenant with a specific role.
-- A user can belong to multiple tenants with different roles.
-- Roles: owner (full control), editor (content + leads), viewer (read-only).
-- ============================================================

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

create index tenant_members_user_id_idx   on public.tenant_members (user_id);
create index tenant_members_tenant_id_idx on public.tenant_members (tenant_id);


-- ============================================================
-- 4. LEADS
-- Contact form submissions per tenant.
-- ============================================================

create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null,
  email       text not null,
  message     text,
  source      text,
  status      text not null default 'new' check (status in ('new', 'read', 'archived')),
  lead_status text not null default 'new' check (lead_status in ('new', 'contacted', 'qualified', 'converted', 'closed', 'spam')),
  created_at  timestamptz not null default now()
);

comment on table public.leads is 'Contact form submissions. Tenant-scoped.';

create index leads_tenant_id_idx  on public.leads (tenant_id);
create index leads_created_at_idx on public.leads (created_at desc);


-- ============================================================
-- 5. PROJECTS
-- One row per deployable website. A tenant can own multiple projects.
-- Preview URL: {slug}.preview.abluo.app
-- Production:  custom_domain
-- ============================================================

create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  name           text not null,
  custom_domain  text unique,
  default_locale text not null default 'it',
  status         text not null default 'draft'
                   check (status in ('draft', 'preview', 'active', 'inactive')),
  created_at     timestamptz not null default now()
);

comment on table public.projects is
  'One row per deployable website. A tenant can own multiple projects. '
  'Preview URL: {slug}.preview.abluo.app. Production: custom_domain.';

create index projects_slug_idx          on public.projects (slug);
create index projects_tenant_id_idx     on public.projects (tenant_id);
create index projects_custom_domain_idx on public.projects (custom_domain);


-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

alter table public.tenants        enable row level security;
alter table public.profiles       enable row level security;
alter table public.tenant_members enable row level security;
alter table public.leads          enable row level security;
alter table public.projects       enable row level security;


-- ============================================================
-- 7. SECURITY DEFINER HELPER FUNCTIONS
--
-- All three functions are SECURITY DEFINER so their inner queries
-- bypass RLS on tenant_members, preventing infinite recursion in
-- self-referential policies.
--
-- All three are declared STABLE so the planner can cache the result
-- within a single query.
--
-- set search_path = '' prevents search_path injection attacks.
-- ============================================================

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
  'SECURITY DEFINER to bypass RLS on tenant_members.';


-- Returns tenant_ids where the current user can write (owner or editor).
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
  'SECURITY DEFINER to bypass RLS on tenant_members.';


-- Returns tenant_ids where the current user is an owner.
-- Used by: projects ALL, tenant_members write policies.
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
  'SECURITY DEFINER to bypass RLS on tenant_members.';


-- ============================================================
-- 8. RLS POLICIES
-- ============================================================

-- ── tenants ───────────────────────────────────────────────────────────────────
-- Any tenant member can read their tenant row.
-- Write access is reserved for platform admin via service role (bypasses RLS).

create policy "Members can read their tenants"
  on public.tenants for select
  using (
    id in (select public.get_my_tenant_ids())
  );


-- ── profiles ──────────────────────────────────────────────────────────────────
-- Users can only read and update their own profile row.

create policy "Users can read their own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());


-- ── tenant_members ────────────────────────────────────────────────────────────
-- Any user can see their own membership rows (which tenants they belong to).
-- Owners can read, add, update, and remove members in their tenants.

create policy "Users can read their own memberships"
  on public.tenant_members for select
  using (user_id = auth.uid());

create policy "Owners can read members of their tenants"
  on public.tenant_members for select
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

create policy "Owners can add members to their tenants"
  on public.tenant_members for insert
  with check (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

create policy "Owners can update members of their tenants"
  on public.tenant_members for update
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );

create policy "Owners can remove members from their tenants"
  on public.tenant_members for delete
  using (
    tenant_id in (select public.get_my_owned_tenant_ids())
  );


-- ── leads ─────────────────────────────────────────────────────────────────────
-- Read:   any tenant member (owner, editor, viewer).
-- Insert: owner and editor only — viewer is read-only at the database layer.
-- Update: owner and editor only — viewer is read-only at the database layer.
-- Delete: no policy — only service role (platform admin) can delete leads.

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


-- ── projects ──────────────────────────────────────────────────────────────────
-- Read:  any tenant member can see their projects.
-- Write: owners only — project creation and configuration is owner-level.
--        FOR ALL covers INSERT, UPDATE, DELETE for owners.

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


-- ============================================================
-- 9. AUTO-CREATE PROFILE AND MEMBERSHIP ON SIGNUP
--
-- Runs after INSERT on auth.users.
-- Always creates a profiles row (identity data only).
-- Creates a tenant_members row if tenant_id is in signup metadata.
-- ON CONFLICT DO NOTHING on both inserts makes this idempotent.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Always create a profile row for identity data.
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  -- If tenant_id is provided in signup metadata, create the tenant membership.
  -- The first user for a tenant is always the account owner.
  -- Invitations pass role explicitly; 'owner' is the safe fallback.
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 10. SEED — TENANTS AND PROJECTS
-- ============================================================

insert into public.tenants (slug, display_name, domain, status, plan)
values ('livener', 'Livener', 'livener.net', 'draft', 'starter');

insert into public.tenants (slug, display_name, domain, status, plan)
values ('studiomartegani', 'Studio Dentistico Martegani', 'studiomartegani.com', 'active', 'starter');

insert into public.projects (slug, tenant_id, name, custom_domain, default_locale, status)
select
  'studiomartegani',
  id,
  'Studio Dentistico Martegani',
  'studiomartegani.com',
  'it',
  'active'
from public.tenants where slug = 'studiomartegani';

insert into public.projects (slug, tenant_id, name, custom_domain, default_locale, status)
select
  'livener',
  id,
  'Livener',
  'livener.net',
  'it',
  'draft'
from public.tenants where slug = 'livener';

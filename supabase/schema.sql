-- ============================================================
-- Abluo Platform — Database Schema
-- Run this in Supabase SQL Editor (project: xsdamzirepfqlutvqfbe)
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

-- Index for domain-based tenant resolution
create index tenants_domain_idx on public.tenants (domain);
create index tenants_slug_idx on public.tenants (slug);


-- ============================================================
-- 2. PROFILES
-- Links a Supabase auth user to a tenant and role.
-- Created automatically when a user signs up via trigger.
-- ============================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  role        text not null default 'client' check (role in ('admin', 'client')),
  full_name   text,
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Links auth.users to a tenant + role. One profile per user.';

create index profiles_tenant_id_idx on public.profiles (tenant_id);


-- ============================================================
-- 3. LEADS
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

create index leads_tenant_id_idx on public.leads (tenant_id);
create index leads_created_at_idx on public.leads (created_at desc);


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- All tables locked by tenant_id from the JWT claim.
-- ============================================================

alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;
alter table public.leads    enable row level security;


-- tenants: users can only read their own tenant row
create policy "Users can read their own tenant"
  on public.tenants for select
  using (id = (
    select tenant_id from public.profiles where id = auth.uid()
  ));


-- profiles: users can only read/update their own profile
create policy "Users can read their own profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());


-- leads: users can only see leads for their own tenant
create policy "Users can read leads for their tenant"
  on public.leads for select
  using (tenant_id = (
    select tenant_id from public.profiles where id = auth.uid()
  ));

create policy "Users can insert leads for their tenant"
  on public.leads for insert
  with check (tenant_id = (
    select tenant_id from public.profiles where id = auth.uid()
  ));

create policy "Users can update leads for their tenant"
  on public.leads for update
  using (tenant_id = (
    select tenant_id from public.profiles where id = auth.uid()
  ));


-- ============================================================
-- 5. AUTO-CREATE PROFILE ON SIGNUP
-- When a new user signs up, create their profile row.
-- tenant_id and role are passed as user metadata at signup.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  -- Only auto-create profile when tenant_id is present in metadata.
  -- Users created without metadata (e.g. via the Supabase dashboard) are
  -- skipped here and must have their profile inserted manually afterwards.
  if new.raw_user_meta_data->>'tenant_id' is not null then
    insert into public.profiles (id, tenant_id, role, full_name)
    values (
      new.id,
      (new.raw_user_meta_data->>'tenant_id')::uuid,
      coalesce(new.raw_user_meta_data->>'role', 'client'),
      coalesce(new.raw_user_meta_data->>'full_name', '')
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ============================================================
-- 6. SEED — LIVENER (TENANT #001)
-- ============================================================

insert into public.tenants (slug, display_name, domain, status, plan)
values ('livener', 'Livener', 'livener.net', 'draft', 'starter');

insert into public.tenants (slug, display_name, domain, status, plan)
values ('studiomartegani', 'Studio Dentistico Martegani', 'studiomartegani.com', 'active', 'starter');

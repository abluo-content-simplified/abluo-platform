-- ============================================================
-- Migration 002 — Projects table
--
-- Introduces the project as the core deployable unit.
-- A tenant (account owner) can have multiple projects.
-- Each project has its own slug, preview URL, and optional
-- custom production domain.
--
-- Preview URL pattern: {slug}.preview.abluo.app (no DNS per project)
-- Production URL:      custom_domain (set when client goes live)
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

create index projects_slug_idx        on public.projects (slug);
create index projects_tenant_id_idx   on public.projects (tenant_id);
create index projects_custom_domain_idx on public.projects (custom_domain);


-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.projects enable row level security;

-- Users can read projects that belong to their tenant
create policy "Users can read their own projects"
  on public.projects for select
  using (tenant_id = (
    select tenant_id from public.profiles where id = auth.uid()
  ));

-- Admins can insert/update projects for their tenant
create policy "Admins can manage their own projects"
  on public.projects for all
  using (
    tenant_id = (select tenant_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) = 'admin'
  );


-- ── Seed — existing projects ──────────────────────────────────────────────────

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

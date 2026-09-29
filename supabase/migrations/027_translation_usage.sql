-- ============================================================
-- Migration 027 — translation_usage (ADR-023 §7)
--
-- Metering for the Translate module: one row per target language per
-- Translate click, with the characters the provider billed. The numbers that
-- make a monthly quota — and billing later — possible.
--
-- Additive. Nothing reads this table until the ADR-023 code is deployed, so it
-- is safe to apply before the deploy.
--
-- Contains no text, no secrets: only counts, locales and ids.
-- ============================================================


create table public.translation_usage (
  id                  uuid        primary key default gen_random_uuid(),
  project_id          uuid        not null references public.projects (id) on delete cascade,

  provider            text        not null check (provider in ('google','deepl','claude')),
  source_locale       text        not null,
  target_locale       text        not null,
  characters          integer     not null check (characters >= 0),
  text_count          integer     not null default 1 check (text_count >= 0),
  format              text        not null default 'text' check (format in ('text','html')),

  sanity_document_id  text,                                              -- which document, for the usage view
  actor_id            uuid        references auth.users (id) on delete set null,
  environment         text        not null default 'production',         -- VERCEL_ENV; dev/preview spend real credit too

  created_at          timestamptz not null default now()
);

comment on table public.translation_usage is
  'ADR-023 metering. One row per target language per Translate click. Service-role '
  'writes only; members read their own projects, Abluo admins read all.';


-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Monthly sum per project (quota check on every click).
create index translation_usage_project_month_idx
  on public.translation_usage (project_id, created_at);


-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.translation_usage enable row level security;

grant select on public.translation_usage to authenticated;
grant all privileges on table public.translation_usage to service_role;

-- A tenant member may see their own project's usage (future dashboard view).
create policy "Members read their project translation usage"
  on public.translation_usage for select
  using (project_id in (select public.get_my_project_ids()));

-- Abluo admins read every project's usage (Tom's usage view). READ ONLY —
-- see the comment on public.is_abluo_admin() (migration 025).
create policy "Abluo admins read all translation usage"
  on public.translation_usage for select
  using (public.is_abluo_admin());

-- Inserts/updates/deletes: service role only (POST /api/translate). No policy,
-- so no browser session can forge or erase usage.


-- ── Monthly total ─────────────────────────────────────────────────────────────
-- The quota check sums in SQL: PostgREST caps a row select at 1,000 rows, so
-- summing rows in application code would silently under-count a busy site.
-- Service role only — it is called by POST /api/translate, never by a browser.
create or replace function public.translation_usage_month_total(
  p_project_id uuid,
  p_since      timestamptz
)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(characters), 0)::bigint
  from public.translation_usage
  where project_id = p_project_id
    and created_at >= p_since
$$;

revoke all on function public.translation_usage_month_total(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.translation_usage_month_total(uuid, timestamptz) to service_role;


-- ── Verification ──────────────────────────────────────────────────────────────
-- 1. select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='translation_usage' order by ordinal_position;
-- 2. select policyname, cmd from pg_policies where tablename='translation_usage';  -- expect 2 (select)
-- 3. select public.translation_usage_month_total(gen_random_uuid(), now());       -- expect 0 (as service_role)

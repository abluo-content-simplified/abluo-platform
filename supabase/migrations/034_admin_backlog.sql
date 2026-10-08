-- ============================================================
-- Migration 034 — admin backlog (ADR-030 §5.5, Tom 2026-10-08)
--
-- NOT APPLIED. Additive (one new table, two trigger functions). Safe to
-- apply before or after the code: the admin Backlog page shows a calm
-- "apply migration 034" state while the table is missing.
-- Requires 005 (public.set_updated_at()).
-- Rollback: drop table public.admin_backlog_items;
--           drop function public.tg_admin_backlog_done_at();
--
-- A detailed, technical backlog for the Abluo team, kept in the admin
-- dashboard (admin.abluo.app/backlog): bugs, improvements, ideas and tasks
-- for the platform, modules, the client dashboard, client websites …
-- Internal only — never shown to clients.
--
-- Server-only: RLS on, no grants to anon/authenticated, no policies; read and
-- written with the service role behind requireAbluoAdmin().
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '034: public.set_updated_at() missing — apply 005 first';
  end if;
  if to_regclass('public.admin_backlog_items') is not null then
    raise exception '034: already applied — stop';
  end if;
end $$;

create table public.admin_backlog_items (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null check (length(btrim(title)) between 1 and 200),
  body        text        not null default '' check (length(body) <= 20000),
  area        text        not null default 'other'
                check (area in ('client_dashboard', 'admin', 'module', 'website', 'platform', 'infrastructure', 'other')),
  type        text        not null default 'task'
                check (type in ('bug', 'improvement', 'idea', 'task')),
  priority    text        not null default 'p2'
                check (priority in ('p0', 'p1', 'p2', 'p3')),
  status      text        not null default 'inbox'
                check (status in ('inbox', 'planned', 'in_progress', 'blocked', 'done', 'wont_do')),
  -- Which client it is about (optional). Deleting the project keeps the item.
  project_id  uuid        references public.projects (id) on delete set null,
  -- Which module it is about (optional), e.g. 'forms', 'gallery'.
  module_id   text        check (module_id is null or module_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  -- [{ "label": "ADR-030", "url": "https://…" }, …]
  links       jsonb       not null default '[]'::jsonb
                check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 20),
  created_by  uuid        references auth.users (id) on delete set null,
  updated_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Set by trigger when status becomes 'done'; cleared when it leaves 'done'.
  done_at     timestamptz,
  -- Manual order within a status (lower first). Fractional so an item can be
  -- placed between two others without renumbering.
  sort_order  numeric     not null default 0
);

comment on table public.admin_backlog_items is
  'ADR-030 — internal Abluo platform backlog (bugs, improvements, ideas, tasks) managed in the admin dashboard. '
  'Server-only (service role behind requireAbluoAdmin). Never shown to clients.';

create index admin_backlog_items_status_sort on public.admin_backlog_items (status, sort_order, updated_at desc);
create index admin_backlog_items_priority    on public.admin_backlog_items (priority, updated_at desc);
create index admin_backlog_items_updated     on public.admin_backlog_items (updated_at desc);
create index admin_backlog_items_project     on public.admin_backlog_items (project_id) where project_id is not null;

-- updated_at (shared helper from 005)
create trigger admin_backlog_items_updated_at
  before update on public.admin_backlog_items
  for each row execute function public.set_updated_at();

-- done_at follows status
create function public.tg_admin_backlog_done_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' or new.done_at is null then
      new.done_at := coalesce(case when tg_op = 'UPDATE' and old.status = 'done' then old.done_at end, now());
    end if;
  else
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger admin_backlog_items_done_at
  before insert or update of status on public.admin_backlog_items
  for each row execute function public.tg_admin_backlog_done_at();

revoke all on function public.tg_admin_backlog_done_at() from public, anon, authenticated;

alter table public.admin_backlog_items enable row level security;
revoke all on table public.admin_backlog_items from anon, authenticated, public;
grant all privileges on table public.admin_backlog_items to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.admin_backlog_items'::regclass) then
    raise exception '034 self-check: RLS disabled on admin_backlog_items';
  end if;
  if has_table_privilege('authenticated', 'public.admin_backlog_items', 'SELECT')
     or has_table_privilege('anon', 'public.admin_backlog_items', 'SELECT') then
    raise exception '034 self-check: admin_backlog_items readable by API roles';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_backlog_items') then
    raise exception '034 self-check: admin_backlog_items must have no policies';
  end if;
  raise notice '034 self-check passed';
end $$;

commit;

-- ============================================================
-- Migration 039 — dashboard dismissals: things a person hid on their dashboard
-- (ADR-029 Home, Tom 2026-10-08)
--
-- NOT APPLIED. Safe before or after the code: the client dashboard treats a
-- missing table (42P01 / PGRST205) as "not available" and simply offers no
-- "Hide checklist" button (src/lib/api/dashboard/dismissals.ts).
--
-- ── What ───────────────────────────────────────────────────────────────────
-- One row per (person, project, key) = "this person hid <key> on this
-- project's dashboard". First key: `setupChecklist` (the "Get your site
-- ready" card on Home). Keys are code constants, checked by pattern.
-- A per-user, per-project UI preference — deliberately NOT on `profiles`,
-- which stays identity-only (migration 004).
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   authenticated: SELECT their OWN rows (user_id = auth.uid());
--                  INSERT only for themselves AND only for a project they
--                  belong to (get_my_project_ids(), migration 007).
--                  No UPDATE / DELETE.
--   anon:          nothing.
--   service_role:  everything (maintenance).
-- Rows follow the person and the project (on delete cascade).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception '039: public.projects missing';
  end if;
  if to_regprocedure('public.get_my_project_ids()') is null then
    raise exception '039: public.get_my_project_ids() missing — migration 007 is not applied';
  end if;
  if to_regclass('public.dashboard_dismissals') is not null then
    raise exception '039: already applied — stop';
  end if;
end $$;


create table public.dashboard_dismissals (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  project_id    uuid        not null references public.projects (id) on delete cascade,
  key           text        not null check (key ~ '^[a-z][a-zA-Z0-9.-]{0,63}$'),
  dismissed_at  timestamptz not null default now(),
  primary key (user_id, project_id, key)
);

comment on table public.dashboard_dismissals is
  'ADR-029 — dashboard blocks a person hid, per project (e.g. key = setupChecklist). '
  'Each person reads and inserts only their own rows, only for projects they belong to (RLS).';

create index dashboard_dismissals_project on public.dashboard_dismissals (project_id);

alter table public.dashboard_dismissals enable row level security;
revoke all on table public.dashboard_dismissals from anon, authenticated, public;
grant select, insert on table public.dashboard_dismissals to authenticated;
grant all privileges on table public.dashboard_dismissals to service_role;

create policy "People read their own dismissals"
  on public.dashboard_dismissals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "People hide things for themselves on their own projects"
  on public.dashboard_dismissals
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and project_id in (select public.get_my_project_ids())
  );


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.dashboard_dismissals'::regclass) then
    raise exception '039 self-check: RLS disabled on dashboard_dismissals';
  end if;
  if has_table_privilege('anon', 'public.dashboard_dismissals', 'SELECT')
     or has_table_privilege('anon', 'public.dashboard_dismissals', 'INSERT') then
    raise exception '039 self-check: reachable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.dashboard_dismissals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.dashboard_dismissals', 'DELETE') then
    raise exception '039 self-check: updatable/deletable by authenticated';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'dashboard_dismissals') <> 2 then
    raise exception '039 self-check: dashboard_dismissals must have exactly two policies (own select, own insert)';
  end if;
  raise notice '039 self-check passed';
end $$;

commit;

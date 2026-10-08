-- ============================================================
-- Migration 036 — website analytics snapshots (ADR-029 §3.4, ADR-030 §5.2)
--
-- APPLIED 2026-10-08 to production by Tom (SQL editor) — see supabase/APPLIED.md.
-- Requires 030 (get_my_project_ids_with). Additive.
-- Apply BEFORE the first cron run writes (the job only logs failures until
-- then) — reading code treats a missing table as "not connected yet".
--
-- ── What ─────────────────────────────────────────────────────────────────
-- 1. analytics_snapshots — one row per project, source ('ga4' | 'gsc') and
--    window end date, written once a day by /api/cron/analytics (service
--    role) from the Google Analytics Data API and the Search Console API.
--    The dashboards read the latest row; they never call Google.
--
--    Each row carries the CURRENT 28-day window (ending yesterday, UTC) AND
--    the totals of the previous 28 days, the last 7 days and the 7 days
--    before, all in `metrics`. Why stored, not computed from older rows:
--    GA4 "users" are not additive (28 daily user counts do not sum to the
--    28-day users), one GA4 request returns all four ranges at once, and a
--    comparison never depends on yesterday's job having run.
--
-- 2. analytics.read joins the grantable extras (ADR-028 §3): Owner and Site
--    admin hold it by role (src/lib/authz/permissions.ts); an Editor only
--    with the extra.
--
-- 3. get_my_project_ids_with() also answers for 'analytics.read', with the
--    same rule as contact requests: tenant Owner · Site admin · the extra on
--    the project or tenant membership.
--
-- ── Read access ──────────────────────────────────────────────────────────
-- Same pattern as contact requests (030): the client dashboard reads with
-- the person's own session (RLS) after the code has checked analytics.read;
-- the policy below is the database's copy of that check. Abluo admins read
-- with the service role behind requireAbluoAdmin (admin pages are also
-- audited, migration 033). Nobody but the service role writes.
-- ============================================================

begin;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.get_my_project_ids_with(text)') is null then
    raise exception '036: migration 030 is not applied — apply 030 first';
  end if;
  if to_regclass('public.analytics_snapshots') is not null then
    raise exception '036: already applied — stop';
  end if;
end $$;


-- ── 1. analytics_snapshots ───────────────────────────────────────────────────
create table public.analytics_snapshots (
  id           bigint generated always as identity primary key,
  project_id   uuid        not null references public.projects (id) on delete cascade,
  source       text        not null check (source in ('ga4', 'gsc')),
  period_start date        not null,
  period_end   date        not null,
  status       text        not null check (status in ('ok', 'error', 'not_connected')),
  metrics      jsonb       not null default '{}'::jsonb,
  error        text,
  fetched_at   timestamptz not null default now(),
  constraint analytics_snapshots_period check (period_start <= period_end),
  constraint analytics_snapshots_error_only_on_error check (status = 'error' or error is null),
  constraint analytics_snapshots_one_per_day unique (project_id, source, period_end)
);

comment on table public.analytics_snapshots is
  'ADR-029 §3.4 — daily GA4 / Search Console snapshot per project (28-day window ending yesterday, '
  'with the previous window and 7-day totals inside metrics). Written by /api/cron/analytics with the '
  'service role. Read: members holding analytics.read (RLS, get_my_project_ids_with) and Abluo admins '
  'via the service role.';

create index analytics_snapshots_latest on public.analytics_snapshots (project_id, source, period_end desc);

alter table public.analytics_snapshots enable row level security;
revoke all on table public.analytics_snapshots from anon, authenticated, public;
grant select on table public.analytics_snapshots to authenticated;
grant all privileges on table public.analytics_snapshots to service_role;


-- ── 2. analytics.read becomes a grantable extra ──────────────────────────────
insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('analytics.read', 'project', null, 'See website traffic and search performance.');


-- ── 3. The permission helper also answers for analytics.read ─────────────────
create or replace function public.get_my_project_ids_with(p_permission text)
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from   public.projects p
  where  p_permission in ('forms.submission.read', 'forms.submission.update', 'analytics.read')
  and (
         p.tenant_id in (
           select m.tenant_id from public.tenant_members m
           where  m.user_id = auth.uid()
           and   (m.role = 'owner' or p_permission = any (m.extra_permissions)))
      or p.id in (
           select pm.project_id from public.project_members pm
           where  pm.user_id = auth.uid()
           and   (pm.role = 'admin' or p_permission = any (pm.extra_permissions)))
  )
$$;

comment on function public.get_my_project_ids_with(text) is
  'ADR-028 — projects where auth.uid() holds a permission the database enforces (forms.submission.read, '
  'forms.submission.update, analytics.read): tenant Owner, Site admin, or the permission as an extra on '
  'the project or tenant membership. Mirrors src/lib/authz. Any other permission → empty (fail closed).';

revoke all on function public.get_my_project_ids_with(text) from public, anon;
grant execute on function public.get_my_project_ids_with(text) to authenticated;


-- ── 4. Policy ────────────────────────────────────────────────────────────────
create policy "Members with analytics.read read their snapshots" on public.analytics_snapshots
  for select to authenticated
  using (project_id in (select public.get_my_project_ids_with('analytics.read')));


-- ── 5. Self-check ────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.analytics_snapshots'::regclass) then
    raise exception '036 self-check: RLS disabled on analytics_snapshots';
  end if;
  if has_table_privilege('anon', 'public.analytics_snapshots', 'SELECT') then
    raise exception '036 self-check: anon can read analytics_snapshots';
  end if;
  if has_table_privilege('authenticated', 'public.analytics_snapshots', 'INSERT')
     or has_table_privilege('authenticated', 'public.analytics_snapshots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.analytics_snapshots', 'DELETE') then
    raise exception '036 self-check: authenticated can write analytics_snapshots';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'analytics_snapshots') <> 1 then
    raise exception '036 self-check: expected exactly one policy on analytics_snapshots';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analytics_snapshots'
                 and cmd = 'SELECT' and qual ilike '%get_my_project_ids_with%analytics.read%') then
    raise exception '036 self-check: analytics_snapshots policy is not on the permission helper';
  end if;
  if not exists (select 1 from public.grantable_permissions where id = 'analytics.read' and applies_to = 'project') then
    raise exception '036 self-check: analytics.read is not grantable';
  end if;
  if has_function_privilege('anon', 'public.get_my_project_ids_with(text)', 'EXECUTE') then
    raise exception '036 self-check: anon can execute get_my_project_ids_with';
  end if;
  raise notice '036 self-check passed';
end $$;

commit;

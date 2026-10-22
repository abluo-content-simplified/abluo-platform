-- ============================================================
-- Migration 045 — Announcements banner + "What's new" pop-up (ADR-030 follow-up, Tom 2026-10-22)
--
-- NOT APPLIED. Additive only: nothing existing is changed except one new
-- column on product_updates. The dashboards are written to work before this is
-- applied: the client layout and the admin screen catch "table / column
-- missing" (42P01 / PGRST205 / 42703) and the feature is simply absent.
--
-- ── What ───────────────────────────────────────────────────────────────────
--   1. product_updates.show_as_popup (boolean, default false): an update with
--      this flag is shown ONCE in a dialog the next time a client in its
--      audience opens the dashboard (the app marks it read when it is shown).
--   2. product_notices: announcements Abluo writes in the admin (planned
--      maintenance, a known issue). Message per language ({en,it,de}), tone
--      (info | warning), a window (starts_at → ends_at) and an audience (same
--      shape as product_updates: audience.modules, empty = everyone). Active
--      notices show as a banner on top of the client dashboard between
--      starts_at and ends_at.
--   3. product_notice_dismissals: which person closed which INFO notice.
--      Warnings cannot be dismissed (enforced in the server action; the table
--      only records).
--
-- A separate table (not a `kind` column on product_updates) on purpose: the
-- What's new feed, its unread count and its read marks stay exactly as they
-- are, and the notices' window/tone/dismissal rules do not leak into them.
--
-- ── Who can do what (mirrors 035) ──────────────────────────────────────────
--   product_notices              authenticated: SELECT published rows only.
--                                No writes for API roles — the admin writes
--                                with the service role behind requireAbluoAdmin().
--   product_notice_dismissals    authenticated: SELECT / INSERT their OWN rows
--                                only (user_id = auth.uid()), and only for a
--                                published notice. No update/delete.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.product_updates') is null then
    raise exception '045: public.product_updates missing — migration 035 is not applied';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '045: public.set_updated_at() missing — migration 005 is not applied';
  end if;
  if to_regclass('public.product_notices') is not null then
    raise exception '045: already applied — stop';
  end if;
end $$;


-- ── 1. Pop-up flag on product updates ────────────────────────────────────────
alter table public.product_updates
  add column if not exists show_as_popup boolean not null default false;

comment on column public.product_updates.show_as_popup is
  'Show this update once in a dialog when a client in its audience opens the dashboard (the newest unread flagged one).';


-- ── 2. product_notices ───────────────────────────────────────────────────────
create table public.product_notices (
  id          uuid        primary key default gen_random_uuid(),
  status      text        not null default 'draft' check (status in ('draft', 'published', 'archived')),
  message     jsonb       not null default '{}'::jsonb check (jsonb_typeof(message) = 'object'),
  tone        text        not null default 'info' check (tone in ('info', 'warning')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  audience    jsonb       not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  created_by  uuid        references auth.users (id) on delete set null,
  updated_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_notices_window check (ends_at > starts_at)
);

comment on table public.product_notices is
  'Announcements (planned maintenance, known issues) shown as a banner on top of the client dashboard between starts_at and ends_at. '
  'message is {en,it,de}. tone: info (dismissible per person) | warning (not dismissible). audience.modules: only projects with one of these modules (empty = everyone). '
  'Clients read published rows under RLS; written by the admin with the service role only.';

create index product_notices_published_window on public.product_notices (ends_at desc) where status = 'published';

create trigger product_notices_set_updated_at
  before update on public.product_notices
  for each row execute function public.set_updated_at();

alter table public.product_notices enable row level security;
revoke all on table public.product_notices from anon, authenticated, public;
grant select on table public.product_notices to authenticated;
grant all privileges on table public.product_notices to service_role;

create policy "Signed-in people read published notices"
  on public.product_notices
  for select
  to authenticated
  using (status = 'published');


-- ── 3. product_notice_dismissals ─────────────────────────────────────────────
create table public.product_notice_dismissals (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  notice_id     uuid        not null references public.product_notices (id) on delete cascade,
  dismissed_at  timestamptz not null default now(),
  primary key (user_id, notice_id)
);

comment on table public.product_notice_dismissals is
  'Which person closed which info notice. Each person reads and inserts only their own rows (RLS).';

create index product_notice_dismissals_notice on public.product_notice_dismissals (notice_id);

alter table public.product_notice_dismissals enable row level security;
revoke all on table public.product_notice_dismissals from anon, authenticated, public;
grant select, insert on table public.product_notice_dismissals to authenticated;
grant all privileges on table public.product_notice_dismissals to service_role;

create policy "People read their own notice dismissals"
  on public.product_notice_dismissals
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The EXISTS runs under the caller's RLS on product_notices, so only a
-- published notice can be dismissed.
create policy "People dismiss notices for themselves"
  on public.product_notice_dismissals
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.product_notices n where n.id = notice_id and n.status = 'published')
  );


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_updates' and column_name = 'show_as_popup'
  ) then
    raise exception '045 self-check: product_updates.show_as_popup missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.product_notices'::regclass) then
    raise exception '045 self-check: RLS disabled on product_notices';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.product_notice_dismissals'::regclass) then
    raise exception '045 self-check: RLS disabled on product_notice_dismissals';
  end if;
  if has_table_privilege('anon', 'public.product_notices', 'SELECT')
     or has_table_privilege('anon', 'public.product_notice_dismissals', 'SELECT') then
    raise exception '045 self-check: readable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.product_notices', 'INSERT')
     or has_table_privilege('authenticated', 'public.product_notices', 'UPDATE')
     or has_table_privilege('authenticated', 'public.product_notices', 'DELETE') then
    raise exception '045 self-check: product_notices writable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.product_notice_dismissals', 'UPDATE')
     or has_table_privilege('authenticated', 'public.product_notice_dismissals', 'DELETE') then
    raise exception '045 self-check: product_notice_dismissals updatable/deletable by authenticated';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_notices') <> 1 then
    raise exception '045 self-check: product_notices must have exactly one policy (published read)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_notice_dismissals') <> 2 then
    raise exception '045 self-check: product_notice_dismissals must have exactly two policies (own select, own insert)';
  end if;
  raise notice '045 self-check passed';
end $$;

commit;

-- ============================================================
-- Migration 049 — Admin Users: "last seen" + access history
-- (ADR-030 amendment A1, Tom 2026-10-23)
--
-- Additive. Apply BEFORE pushing the Users code. Until it is applied the
-- Users page still works: "Active now" / "Last active" fall back to the last
-- sign-in and access history reads as empty.
--
--   1. profiles.last_seen_at — when the person last had a dashboard open.
--      Written ONLY through touch_last_seen() (own row, at most once every
--      2 minutes; the column has no update grant). Read by the admin Users
--      page with the service role; RLS keeps profiles own-row-only.
--   2. access_audit_log — who changed someone's access to a site: role or
--      extras changed, archived, restored. Invitations are already a history
--      of their own (invitations.created/accepted/revoked_*), so they are read
--      from there, not copied here. Server-only (service role), like 033.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.access_audit_log') is not null then
    raise exception '049: already applied — stop';
  end if;
end $$;

-- ── 1. Last seen ─────────────────────────────────────────────────────────────
alter table public.profiles add column last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'ADR-030 A1 — last time this person had an Abluo dashboard open (heartbeat, ~2 min precision). '
  'Written only by public.touch_last_seen().';

create function public.touch_last_seen() returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '2 minutes');
$$;

revoke all on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- ── 2. Access history ────────────────────────────────────────────────────────
create table public.access_audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid        references auth.users (id) on delete set null,
  subject_user_id uuid        references auth.users (id) on delete set null,
  project_id      uuid        references public.projects (id) on delete set null,
  action          text        not null check (action in ('member.change', 'member.archive', 'member.restore')),
  detail          jsonb       not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

comment on table public.access_audit_log is
  'ADR-030 A1 — changes to a person''s access to a site (role/extras changed, archived, restored). '
  'detail holds roles and extras before/after only — never emails, tokens or content. Server-only (service role).';

create index access_audit_log_subject_time on public.access_audit_log (subject_user_id, occurred_at desc);
create index access_audit_log_actor_time   on public.access_audit_log (actor_id, occurred_at desc);
create index access_audit_log_project_time on public.access_audit_log (project_id, occurred_at desc);

alter table public.access_audit_log enable row level security;
revoke all on public.access_audit_log from anon, authenticated;

commit;

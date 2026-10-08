-- ============================================================
-- Migration 038 — support sessions (ADR-028 §8 support mode, Tom 2026-10-08)
--
-- NOT APPLIED. Apply after the code that reads it is deployed (2026-08-14
-- rule) — the code treats a missing table as "support mode unavailable":
-- the admin's "View as client" button reports it, the client dashboard shows
-- no support notice, and nobody's normal access changes.
--
-- ── What ───────────────────────────────────────────────────────────────────
-- One row = one support visit: an Abluo admin opening ONE project's client
-- dashboard as the client sees it (role perspective Owner / Site admin /
-- Editor). The visit is view-only. The admin may ask the client for edit
-- access; the client's Owner or Site admin allows or declines it inside their
-- own dashboard. Edit access is time-limited and the client can end it at
-- any time.
--
--   status (the visit's edit-access state)
--     viewing    open, view only, nothing asked yet
--     requested  open, the admin asked for edit access, waiting for the client
--     allowed    open, edit access until expires_at (expired once past it —
--                the app treats an `allowed` row past expires_at as expired
--                and records it lazily)
--     declined   open, the client said no → view only
--     expired    open, edit access ran out → view only
--     revoked    open, the client ended edit access early → view only
--     ended      closed: the admin exited (ended_at set). Terminal.
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   service_role   everything (the admin's start / request / exit / reveal,
--                  behind requireAbluoAdmin() = abluo_admin + two-factor)
--   authenticated  SELECT rows of projects they manage — the tenant's Owner
--                  or the project's Site admin (the holders of users.manage,
--                  ADR-028) — and nothing else. The decision fields change
--                  only through public.support_session_decide(), SECURITY
--                  DEFINER, which re-checks that the caller manages the
--                  project, that the caller is NOT the admin who asked, and
--                  that the transition is valid.
--   anon           nothing.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.projects') is null or to_regclass('public.tenant_members') is null
     or to_regclass('public.project_members') is null then
    raise exception '038: projects / tenant_members / project_members missing — base schema not applied';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_members_role_check'
      and pg_get_constraintdef(oid) like '%admin%'
  ) then
    raise exception '038: project_members has no Site admin role — apply 029/030 first';
  end if;
  if to_regclass('public.support_sessions') is not null then
    raise exception '038: already applied — stop';
  end if;
end $$;


-- ── support_sessions ─────────────────────────────────────────────────────────
create table public.support_sessions (
  id                        uuid        primary key default gen_random_uuid(),
  project_id                uuid        not null references public.projects (id) on delete cascade,
  admin_user_id             uuid        not null references auth.users (id) on delete cascade,
  -- The perspective the admin looks through. Never grants anything by itself.
  role                      text        not null default 'owner' check (role in ('owner', 'admin', 'editor')),
  status                    text        not null default 'viewing'
                                        check (status in ('viewing', 'requested', 'allowed', 'declined', 'expired', 'revoked', 'ended')),
  started_at                timestamptz not null default now(),
  requested_at              timestamptz,
  decided_at                timestamptz,
  decided_by                uuid        references auth.users (id) on delete set null,
  expires_at                timestamptz,
  revoked_at                timestamptz,
  revoked_by                uuid        references auth.users (id) on delete set null,
  contact_requests_shown_at timestamptz,
  ended_at                  timestamptz,
  constraint support_sessions_requested_has_time check (status not in ('requested', 'allowed', 'declined') or requested_at is not null),
  constraint support_sessions_decided_has_who    check (status not in ('allowed', 'declined') or (decided_at is not null and decided_by is not null)),
  constraint support_sessions_allowed_has_expiry check (status <> 'allowed' or expires_at is not null),
  constraint support_sessions_ended_consistent   check ((status = 'ended') = (ended_at is not null)),
  constraint support_sessions_revoked_consistent check (status <> 'revoked' or revoked_at is not null),
  constraint support_sessions_not_self_decided   check (decided_by is null or decided_by <> admin_user_id)
);

comment on table public.support_sessions is
  'ADR-028 §8 — Abluo support visits to a client dashboard. View-only by default; edit access only after the '
  'client''s Owner / Site admin allows it (support_session_decide), time-limited, revocable. Written by the '
  'service role behind requireAbluoAdmin; clients read their projects'' rows under RLS.';

-- One open visit per admin and project (the app also closes an admin's other open visits on start).
create unique index support_sessions_one_open on public.support_sessions (admin_user_id, project_id) where ended_at is null;
create index support_sessions_project_open on public.support_sessions (project_id) where ended_at is null;


-- ── Who manages a project (Owner of its tenant, or its Site admin) ────────────
create function public.get_my_support_project_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from   public.projects p
  where  p.tenant_id in (
           select m.tenant_id from public.tenant_members m
           where  m.user_id = auth.uid() and m.role = 'owner')
     or  p.id in (
           select pm.project_id from public.project_members pm
           where  pm.user_id = auth.uid() and pm.role = 'admin')
$$;

comment on function public.get_my_support_project_ids() is
  'ADR-028 §8 — projects where auth.uid() decides on Abluo support access: the tenant''s Owner or the '
  'project''s Site admin (the users.manage holders). Mirrors src/lib/authz.';

revoke all on function public.get_my_support_project_ids() from public, anon;
grant execute on function public.get_my_support_project_ids() to authenticated;


-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.support_sessions enable row level security;
revoke all on table public.support_sessions from anon, authenticated, public;
grant select on table public.support_sessions to authenticated;
grant all privileges on table public.support_sessions to service_role;

create policy "Owners and Site admins read support visits to their sites"
  on public.support_sessions
  for select
  to authenticated
  using (project_id in (select public.get_my_support_project_ids()));


-- ── The client's decision: allow / decline / revoke ─────────────────────────
-- p_minutes: edit-access duration — passed by the app from its one constant
-- (SUPPORT_EDIT_MINUTES, src/lib/support/constants.ts); only bounded here.
create function public.support_session_decide(p_session_id uuid, p_decision text, p_minutes integer)
returns public.support_sessions
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.support_sessions;
begin
  if v_uid is null then
    raise exception 'support_session_decide: not signed in' using errcode = '42501';
  end if;
  if p_decision not in ('allow', 'decline', 'revoke') then
    raise exception 'support_session_decide: unknown decision %', p_decision using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 1440 then
    raise exception 'support_session_decide: duration out of range' using errcode = '22023';
  end if;

  select * into v_row from public.support_sessions where id = p_session_id for update;
  if not found or v_row.project_id not in (select public.get_my_support_project_ids()) then
    -- Same answer for "no such visit" and "not yours": nothing leaks.
    raise exception 'support_session_decide: not found' using errcode = '42501';
  end if;
  if v_row.admin_user_id = v_uid then
    raise exception 'support_session_decide: the admin who asked cannot decide' using errcode = '42501';
  end if;
  if v_row.ended_at is not null then
    raise exception 'support_session_decide: visit has ended' using errcode = '55000';
  end if;

  if p_decision = 'allow' then
    if v_row.status <> 'requested' then
      raise exception 'support_session_decide: nothing to allow' using errcode = '55000';
    end if;
    update public.support_sessions
       set status = 'allowed', decided_at = now(), decided_by = v_uid,
           expires_at = now() + make_interval(mins => p_minutes)
     where id = p_session_id
     returning * into v_row;
  elsif p_decision = 'decline' then
    if v_row.status <> 'requested' then
      raise exception 'support_session_decide: nothing to decline' using errcode = '55000';
    end if;
    update public.support_sessions
       set status = 'declined', decided_at = now(), decided_by = v_uid, expires_at = null
     where id = p_session_id
     returning * into v_row;
  else -- revoke
    if v_row.status <> 'allowed' or v_row.expires_at <= now() then
      raise exception 'support_session_decide: no edit access to end' using errcode = '55000';
    end if;
    update public.support_sessions
       set status = 'revoked', revoked_at = now(), revoked_by = v_uid, expires_at = now()
     where id = p_session_id
     returning * into v_row;
  end if;

  return v_row;
end
$$;

comment on function public.support_session_decide(uuid, text, integer) is
  'ADR-028 §8 — the client''s Owner / Site admin allows (for p_minutes), declines or ends Abluo support edit '
  'access on a visit to their site. Re-checks management, refuses the requesting admin, validates the transition.';

revoke all on function public.support_session_decide(uuid, text, integer) from public, anon;
grant execute on function public.support_session_decide(uuid, text, integer) to authenticated;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.support_sessions'::regclass) then
    raise exception '038 self-check: RLS disabled on support_sessions';
  end if;
  if has_table_privilege('anon', 'public.support_sessions', 'SELECT') then
    raise exception '038 self-check: support_sessions readable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.support_sessions', 'INSERT')
     or has_table_privilege('authenticated', 'public.support_sessions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.support_sessions', 'DELETE') then
    raise exception '038 self-check: support_sessions writable by authenticated';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'support_sessions') <> 1 then
    raise exception '038 self-check: support_sessions must have exactly one policy (managers read)';
  end if;
  if has_function_privilege('anon', 'public.support_session_decide(uuid, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_my_support_project_ids()', 'EXECUTE') then
    raise exception '038 self-check: support functions executable by anon';
  end if;
  raise notice '038 self-check passed';
end $$;

commit;

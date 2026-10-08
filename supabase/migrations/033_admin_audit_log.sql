-- ============================================================
-- Migration 033 — internal admin audit log (ADR-030, Tom 2026-10-08)
--
-- APPLIED 2026-10-08 to production by Tom (SQL editor) — see supabase/APPLIED.md.
-- (writes are best-effort: a missing table never breaks a page).
--
-- Every time an Abluo admin looks at a client's data in the admin dashboard
-- (project page, analytics, media of one project …) one row is written.
-- Internal only: what (if anything) the client is shown is decided later.
-- Server-only: RLS on, no grants to anon/authenticated, no policies; written
-- and read with the service role behind requireAbluoAdmin.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.admin_audit_log') is not null then
    raise exception '033: already applied — stop';
  end if;
end $$;

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid        references auth.users (id) on delete set null,
  action      text        not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  project_id  uuid        references public.projects (id) on delete set null,
  detail      jsonb       not null default '{}'::jsonb
);

comment on table public.admin_audit_log is
  'ADR-030 — internal log of Abluo admins viewing or acting on client data from the admin dashboard. '
  'Server-only (service role). Never shown to clients unless decided later.';

create index admin_audit_log_project_time on public.admin_audit_log (project_id, occurred_at desc);
create index admin_audit_log_actor_time   on public.admin_audit_log (actor_id, occurred_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;

commit;

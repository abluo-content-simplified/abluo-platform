-- ============================================================
-- Migration 041 — content audit log (ADR-032 D9, slice 3a — Tom, 2026-10-13)
--
-- APPLIED 2026-10-13 to production by Tom (SQL editor) — see supabase/APPLIED.md.
-- (writes are best-effort: a missing table never breaks a dashboard action).
--
-- One row per editorial lifecycle action (created, published, scheduled,
-- schedule_changed, unpublished, archived, restored, deleted, delete_refused)
-- on a Sanity document of a project — by a dashboard user, Abluo support,
-- Abluo staff in Studio (slice 3b) or the system. Non-personal data only:
-- ids, dates and the lifecycle state after the change; never content.
--
-- Separate from admin_audit_log (033): different audience (clients see their
-- own Activity), actors and retention.
--
-- Server-only: RLS on, no grants to anon/authenticated, no policies; written
-- and read with the service role behind the dashboard's permission checks.
--
-- Correlation (slice 3b): `sanity_transaction_id` is the id of the Sanity
-- transaction that made the change. The dashboard chooses it before writing
-- (prefix `abluo-dash-`), so a Studio/webhook record and a dashboard record of
-- the same change meet on (sanity_transaction_id, content_id) and can never
-- both be stored. NULLs are distinct, so refusals (no transaction) are not
-- constrained.
--
-- Retention (PROVISIONAL, ADR-032 D9 amendment 2026-10-13): ok rows 5 years,
-- refused/failed rows 12 months. Enforced by the slice 3b daily job.
-- Rows survive content deletion (no Sanity link) and project deletion (project_id
-- set null, never cascaded); actor_id is nulled
-- when the user account is deleted.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.content_audit_log') is not null then
    raise exception '041: already applied — stop';
  end if;
end $$;

create table public.content_audit_log (
  id                    bigint generated always as identity primary key,
  occurred_at           timestamptz not null default now(),
  project_id            uuid references public.projects (id) on delete set null,
  content_type          text not null check (content_type ~ '^[a-zA-Z][a-zA-Z0-9]{1,63}$'),
  content_id            text not null check (length(content_id) between 1 and 128),
  action                text not null check (action in (
                          'created', 'published', 'scheduled', 'schedule_changed', 'unpublished',
                          'archived', 'restored', 'deleted', 'delete_refused')),
  actor_kind            text not null check (actor_kind in ('user', 'studio', 'system')),
  actor_id              uuid references auth.users (id) on delete set null,
  outcome               text not null check (outcome in ('ok', 'refused', 'failed')),
  sanity_transaction_id text check (sanity_transaction_id is null or length(sanity_transaction_id) between 1 and 128),
  detail                jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

comment on table public.content_audit_log is
  'ADR-032 D9 — editorial lifecycle actions per content item (Activity). Server-only (service role). '
  'Non-personal data only: ids, dates, lifecycle state. Retention provisional: ok 5 years, refused/failed 12 months.';

-- Per-item Activity, newest first.
create index content_audit_log_item_time
  on public.content_audit_log (project_id, content_type, content_id, occurred_at desc);
-- Retention sweeps and reconciliation windows.
create index content_audit_log_time on public.content_audit_log (occurred_at);
-- One record per Sanity transaction per item (dashboard and webhook meet here).
create unique index content_audit_log_transaction
  on public.content_audit_log (sanity_transaction_id, content_id);

alter table public.content_audit_log enable row level security;
revoke all on public.content_audit_log from anon, authenticated;
grant select, insert, delete on public.content_audit_log to service_role;

commit;

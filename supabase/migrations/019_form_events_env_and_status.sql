-- ============================================================
-- Migration 019 — form_events: environment tag + project_slug + 'skipped' status
--
-- ADR-019: dev/preview/production share ONE Supabase project, so a Database
-- Webhook on form_events fires once per insert to a single (production) URL.
-- To keep dev/preview test submissions from sending real emails, each event is
-- tagged with the environment of the app instance that created it, and the
-- production consumer delivers ONLY environment='production' events. Non-prod
-- events are recorded (audit) and marked 'skipped' so the recovery sweep never
-- re-picks them.
--
--   environment   — 'production' | 'preview' | 'development' (from VERCEL_ENV);
--                   null is treated as non-production (fail safe).
--   project_slug  — the tenant/URL slug (e.g. 'livener') captured at emit time,
--                   used by the consumer to resolve Studio-managed recipients
--                   (maps to the Sanity projectSlug via TENANT_TO_PROJECT).
--   status        — add 'skipped' (intentional non-delivery: non-prod, or no
--                   recipients configured) as a terminal state.
-- ============================================================

alter table public.form_events add column if not exists environment  text;
alter table public.form_events add column if not exists project_slug  text;

comment on column public.form_events.environment is
  'App environment that created the originating submission (VERCEL_ENV: production|preview|development). '
  'The production consumer delivers ONLY environment=''production''; null/other are treated as non-production.';
comment on column public.form_events.project_slug is
  'Tenant/URL slug (e.g. ''livener'') captured at emit time; the consumer maps it to the Sanity '
  'projectSlug to read Studio-managed notification recipients.';

-- Extend the status check to allow 'skipped' (terminal, intentional non-delivery).
alter table public.form_events drop constraint if exists form_events_status_check;
alter table public.form_events
  add constraint form_events_status_check
  check (status in ('pending','delivering','delivered','failed','dead','skipped'));

-- Consumer/sweep scan by environment + status.
create index if not exists form_events_env_status_idx
  on public.form_events (environment, status, occurred_at)
  where status in ('pending','failed');

-- Verification:
--   select column_name from information_schema.columns
--   where table_name='form_events' and column_name in ('environment','project_slug');
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.form_events'::regclass and contype='c';

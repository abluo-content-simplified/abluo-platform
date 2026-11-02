-- ============================================================
-- Migration 061 — Catalogue audit log (C12, step M0 of the C10-6 rollout plan)
--
-- ⚠️ NOT APPLIED. Order (C10-6 M0): (a) the writer ships first with
-- "table missing ⇒ log and continue" (src/lib/modules/catalogue/audit/writer.ts);
-- (b) rehearse this file on the Abluo Sandbox; (c) Tom approves; (d) Tom
-- applies it in the SQL Editor and records it in supabase/APPLIED.md.
-- Purely additive: one new table, no change to any existing object.
-- Number reserved by C10-6 (REVIEW E-15): 061 = catalogue_audit_log, then
-- 062 = studio_break_glass (C9, not in R1).
--
-- What it stores (contracts/C6-C8-C9-C12 §12): Catalogue events that are not
-- document lifecycle events — packs applied, category/channel rules changed,
-- allergen reviews, imports, bulk actions, exports, readiness overrides,
-- migrations, Studio break-glass and out-of-gate writes. Lifecycle rows
-- (published, unpublished …) stay in content_audit_log (041).
--
-- Why not content_audit_log: its `action` CHECK is a closed list that the
-- TS union ContentAction mirrors, and it needs a non-null content_id; setup
-- events have no document.
--
-- Content-free by contract: ids, keys, codes, counts, hashes, versions only.
-- Never names, descriptions, prices, free-text notes, override reasons,
-- import cell values, file names. (Exception, K-2: the tenant's own
-- navigation label in public_name.migrated.) Validated in TS before insert;
-- the CHECK below only caps the size.
--
-- `kind` is an OPEN set validated in TS (CatalogueAuditKind); the CHECK is the
-- shape `<word>(_<word>)*` joined by 1–2 dots, so `public_name.migrated` and
-- `studio.break_glass_enabled` insert (REVIEW-step3 C-1).
--
-- Correlation: `transaction_id` is the Sanity transaction id of the change
-- (prefixes CATALOGUE_WRITER_PREFIXES); a unique index on
-- (transaction_id, kind, target_id) makes writer retries, the detective
-- webhook and the daily reconciliation idempotent (23505 = already recorded).
--
-- Server-only: RLS on, no grants to anon/authenticated, no policies; written
-- and read with the service role behind the dashboard's permission checks.
--
-- Retention (D-20): ok rows 5 years (platform audit default; longer allergen
-- retention pending legal/privacy review — never a hard-coded literal);
-- refused/failed and studio.write_outside_gate 12 months. Enforced by the
-- daily purge job, not here. Rows survive content deletion (no Sanity link)
-- and project deletion (project_id set null, never cascaded); actor_id is
-- nulled when the user account is deleted.
--
-- Rollback (only before any producer is enabled; refuses once rows exist):
--   begin;
--   do $$ begin
--     if exists (select 1 from public.catalogue_audit_log) then
--       raise exception 'rollback-061: catalogue_audit_log holds rows — refusing';
--     end if;
--   end $$;
--   drop table public.catalogue_audit_log;
--   commit;
-- The writer treats the missing table as "log and continue", so rolling back
-- never breaks a dashboard action.
--
-- Verify after apply (read-only):
--   select to_regclass('public.catalogue_audit_log');            -- not null
--   select count(*) from public.catalogue_audit_log;              -- 0
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.catalogue_audit_log') is not null then
    raise exception '061: already applied — stop';
  end if;
  if to_regclass('public.projects') is null then
    raise exception '061: public.projects is missing — wrong database?';
  end if;
end $$;

create table public.catalogue_audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  project_id     uuid references public.projects (id) on delete set null,
  kind           text not null check (kind ~ '^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*){1,2}$'),
  scope          text not null check (scope in ('project', 'item', 'collection', 'category', 'channel', 'standard', 'import', 'export')),
  target_id      text check (target_id is null or length(target_id) between 1 and 128),
  actor_kind     text not null check (actor_kind in ('user', 'studio', 'system')),
  actor_id       uuid references auth.users (id) on delete set null,
  outcome        text not null default 'ok' check (outcome in ('ok', 'refused', 'failed')),
  transaction_id text check (transaction_id is null or length(transaction_id) between 1 and 128),
  correlation_id text check (correlation_id is null or length(correlation_id) between 1 and 128),
  detail         jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) < 8192)
);

comment on table public.catalogue_audit_log is
  'C12 — Catalogue events that are not document lifecycle events (packs, rules, channels, allergen reviews, imports, bulk, exports, overrides, migrations, break-glass). '
  'Server-only (service role). Content-free: ids, keys, codes, counts, hashes. Retention: ok 5 years (D-20), refused/failed and outside-gate 12 months.';

-- Project activity (Setup → Overview → Activity), newest first; retention sweeps.
create index catalogue_audit_project_time on public.catalogue_audit_log (project_id, occurred_at desc);
-- Per-target activity (item Activity merges scope = 'item').
create index catalogue_audit_target_time on public.catalogue_audit_log (project_id, scope, target_id, occurred_at desc);
-- A cascade / bulk / import / grant shares one correlation id.
create index catalogue_audit_correlation on public.catalogue_audit_log (correlation_id) where correlation_id is not null;
-- One row per (Sanity transaction, kind, target): writer retry, webhook and reconciliation meet here.
create unique index catalogue_audit_txn on public.catalogue_audit_log (transaction_id, kind, coalesce(target_id, '')) where transaction_id is not null;

alter table public.catalogue_audit_log enable row level security;
revoke all on public.catalogue_audit_log from anon, authenticated;
grant select, insert, delete on public.catalogue_audit_log to service_role;

commit;

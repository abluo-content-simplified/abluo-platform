-- ============================================================
-- Migration 017 — form_events (append-only outbox)
--
-- ADR-018 Decision 9: the Forms Module's outbound boundary is
-- (persist submission) + (write a form_events row) in one transaction,
-- then emit nothing else. It calls NO delivery provider.
--
-- ADR-019 (Server-side Integration Event Consumers) reads this outbox and
-- delivers notifications. The delivery-bookkeeping columns (status, attempts,
-- last_error, processed_at) are created here so ADR-019 needs no ALTER.
--
-- The payload is provider-agnostic and MUST NEVER contain recipients,
-- addresses, channel config, or secrets.
-- ============================================================


create table public.form_events (
  event_id       uuid        primary key default gen_random_uuid(),
  event_type     text        not null default 'form.submitted',

  tenant_id      uuid        references public.tenants  (id) on delete set null,
  project_id     uuid        references public.projects (id) on delete set null,
  form_id        text        not null,
  form_version   integer     not null,
  submission_id  uuid        not null references public.form_submissions (id) on delete cascade,

  topic          text,                                  -- abstract routing tag (Decision 3); null → default downstream
  locale         text        not null default 'en',
  payload        jsonb       not null default '{}',      -- provider-agnostic; NEVER recipients/secrets

  -- Delivery bookkeeping — semantically owned by ADR-019; present now to avoid a 2nd migration.
  status         text        not null default 'pending'
                             check (status in ('pending','delivering','delivered','failed','dead')),
  attempts       integer     not null default 0,
  last_error     text,

  occurred_at    timestamptz not null default now(),
  processed_at   timestamptz
);

comment on table public.form_events is
  'ADR-018 append-only outbox. One row is written in the same transaction that finalizes a '
  'submission. ADR-019 consumer reads pending rows and delivers them. Payload is '
  'provider-agnostic and contains no recipients or secrets.';


-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Consumer scan for work (ADR-019).
create index form_events_status_idx     on public.form_events (status, occurred_at)
  where status in ('pending','failed');
create index form_events_submission_idx on public.form_events (submission_id);
create index form_events_project_idx    on public.form_events (project_id);


-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.form_events enable row level security;

-- Dashboard may read delivery status for its own projects (ADR-019 slice 4).
grant select on public.form_events to authenticated;

create policy "Members read their project form events"
  on public.form_events for select
  using (project_id in (select public.get_my_project_ids()));

-- Inserts/updates are service-role only (emit side + ADR-019 consumer). No policy.


-- ── Verification ──────────────────────────────────────────────────────────────
-- 1. select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='form_events' order by ordinal_position;
-- 2. select policyname, cmd from pg_policies where tablename='form_events';  -- expect 1 (select)

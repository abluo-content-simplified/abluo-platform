-- 070 — Messages: "Recently deleted" (ADR-050 follow-up, Tom 2026-11-11).
--
-- Abluo can select several conversations and delete them. A deleted
-- conversation disappears for the client at once and waits 30 days in the
-- admin's "Recently deleted" (restore or delete now); the daily
-- notifications sweep then removes it for good, with its files.
--
-- Additive and safe to re-run. The code already runs without it (it reads
-- `deleted_at` only once the column exists).

alter table public.message_conversations
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null;

comment on column public.message_conversations.deleted_at is
  'When Abluo moved the conversation to Recently deleted (hidden from the client). Purged 30 days later by /api/cron/notifications-sweep.';

create index if not exists message_conversations_deleted
  on public.message_conversations (deleted_at) where deleted_at is not null;

-- The event log learns the two new steps.
alter table public.message_events drop constraint if exists message_events_kind_check;
alter table public.message_events add constraint message_events_kind_check
  check (kind in ('created', 'message_redacted', 'attachment_deleted', 'archived', 'unarchived', 'deleted', 'restored'));

-- ============================================================
-- Migration 069 — Messages, Notification Center, Announcements upgrade
-- (ADR-050, Tom 2026-11-10)
--
-- NOT APPLIED. Additive only. Apply AFTER the code that reads it is deployed
-- (2026-08-14 rule): the code treats a missing table / column / function
-- (42P01 / PGRST205 / 42703 / PGRST204 / 42883 / PGRST202) as "not available
-- yet" — Messages stay hidden, the bell stays empty, announcements work as
-- before (migration 045).
--
-- ── What ───────────────────────────────────────────────────────────────────
--   1. Messages (ADR-050 D1–D7) — service role only, like the tickets (046):
--      message_conversations   one conversation, always inside ONE project
--      message_participants    who is in it; side client | abluo; read marks
--      messages                what was written (author kind client | abluo)
--      message_attachments     images + PDFs in the PRIVATE bucket
--      message_events          append-only audit (redaction, archive …)
--      storage bucket          message-attachments (PRIVATE)
--   2. Notification Center (D9, D11) — service role only:
--      notifications           one row per recipient; one UNREAD row per source
--      notification_emails     the digest log (at most one every 4 hours)
--      profiles.interface_locale + set_interface_locale() (own row only)
--   3. Announcements (D8) — product_notices gains a "Read more" body,
--      requires_ack and audience by site / person; product_notice_acks.
--      The read policy now hides a notice aimed at other sites / people.
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   1 + 2: RLS on, NO grants and NO policies for anon / authenticated. All
--   access is server code with the service role after the ADR-050 checks
--   (participant for clients, requireAbluoAdmin for Abluo).
--   3: as in 045 — clients read through their own session and RLS.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception '069: public.projects missing';
  end if;
  if to_regclass('public.product_notices') is null then
    raise exception '069: public.product_notices missing — migration 045 is not applied';
  end if;
  if to_regprocedure('public.get_my_project_ids()') is null then
    raise exception '069: public.get_my_project_ids() missing — migration 007 is not applied';
  end if;
end $$;


-- ══ 1. Messages ═══════════════════════════════════════════════════════════

create table public.message_conversations (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references public.projects (id) on delete cascade,
  subject           text        not null check (char_length(btrim(subject)) between 1 and 120),
  mode              text        not null default 'individual' check (mode in ('individual', 'shared')),
  created_by        uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  archived_at       timestamptz
);
comment on table public.message_conversations is
  'ADR-050 — a conversation Abluo started with one person (individual) or a few people of ONE project (shared). Service role only.';
create index message_conversations_project_activity on public.message_conversations (project_id, last_activity_at desc);
create index message_conversations_activity on public.message_conversations (last_activity_at desc);

create table public.message_participants (
  conversation_id  uuid        not null references public.message_conversations (id) on delete cascade,
  user_id          uuid        not null references auth.users (id) on delete cascade,
  side             text        not null check (side in ('client', 'abluo')),
  added_at         timestamptz not null default now(),
  last_read_at     timestamptz,
  primary key (conversation_id, user_id, side)
);
comment on table public.message_participants is
  'ADR-050 D2/D6 — client recipients (added when sent, fixed afterwards) and Abluo admins (added when they first open it: per-admin read marks, D1).';
create index message_participants_user on public.message_participants (user_id, side);

create table public.messages (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.message_conversations (id) on delete cascade,
  author_id        uuid        references auth.users (id) on delete set null,
  author_kind      text        not null check (author_kind in ('client', 'abluo')),
  body             text        not null check (char_length(body) <= 10000),
  links            jsonb       not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3),
  created_at       timestamptz not null default now(),
  redacted_at      timestamptz,
  constraint messages_body check (redacted_at is not null or char_length(btrim(body)) >= 1)
);
create index messages_conversation on public.messages (conversation_id, created_at);
create index messages_author_time on public.messages (author_id, created_at desc);

create table public.message_attachments (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.message_conversations (id) on delete cascade,
  message_id       uuid        not null references public.messages (id) on delete cascade,
  storage_path     text        not null unique,
  file_name        text        not null default '' check (char_length(file_name) <= 200),
  mime             text        not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  bytes            integer     not null check (bytes > 0 and bytes <= 5242880),
  width            integer,
  height           integer,
  uploaded_by      uuid        references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_reason   text        check (deleted_reason in ('retention', 'redacted', 'project_deleted', 'removed_by_client')),
  constraint message_attachments_deleted check ((deleted_at is null) = (deleted_reason is null))
);
create index message_attachments_conversation on public.message_attachments (conversation_id);
create index message_attachments_live on public.message_attachments (conversation_id) where deleted_at is null;

create table public.message_events (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.message_conversations (id) on delete cascade,
  actor_id         uuid        references auth.users (id) on delete set null,
  kind             text        not null check (kind in ('created', 'message_redacted', 'attachment_deleted', 'archived', 'unarchived')),
  detail           jsonb       not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at       timestamptz not null default now()
);
create index message_events_conversation on public.message_events (conversation_id, created_at);


-- ══ 2. Notification Center ════════════════════════════════════════════════

create table public.notifications (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  project_id   uuid        references public.projects (id) on delete cascade,
  side         text        not null default 'client' check (side in ('client', 'abluo')),
  kind         text        not null check (kind in (
                 'message.received', 'message.replied',
                 'ticket.created', 'ticket.client_replied', 'ticket.support_replied', 'ticket.waiting_for_user', 'ticket.resolved',
                 'announcement.ack_requested')),
  source_type  text        not null check (source_type in ('conversation', 'ticket', 'notice')),
  source_id    uuid        not null,
  href         text        not null check (href ~ '^/[A-Za-z0-9/_.~%?=&-]*$' and char_length(href) <= 300),
  params       jsonb       not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  count        integer     not null default 1 check (count >= 1),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  emailed_at   timestamptz
);
comment on table public.notifications is
  'ADR-050 D9 — the bell. One row per recipient; at most one UNREAD row per (person, side, source): a new event updates it (count + 1). '
  'Never holds message text, ticket titles or screenshots — a kind + small params, worded at render time. Service role only.';
create unique index notifications_one_unread_per_source on public.notifications (user_id, side, source_type, source_id) where read_at is null;
create index notifications_user_time on public.notifications (user_id, side, created_at desc);
create index notifications_digest on public.notifications (created_at) where read_at is null and emailed_at is null;

create table public.notification_emails (
  id        bigint      generated always as identity primary key,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  sent_at   timestamptz not null default now(),
  items     integer     not null check (items >= 1),
  environment text
);
comment on table public.notification_emails is 'ADR-050 D11 — one row per digest email sent (throttle: one per person every 4 hours). Service role only.';
create index notification_emails_user_time on public.notification_emails (user_id, sent_at desc);

alter table public.profiles add column if not exists interface_locale text check (interface_locale in ('en', 'it', 'de'));
comment on column public.profiles.interface_locale is
  'ADR-050 D11 — the dashboard language the person last used (Preferences → Language), for emails. Written only by set_interface_locale().';

create or replace function public.set_interface_locale(p_locale text) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set interface_locale = p_locale
   where id = auth.uid()
     and p_locale in ('en', 'it', 'de')
     and interface_locale is distinct from p_locale;
$$;
revoke all on function public.set_interface_locale(text) from public, anon;
grant execute on function public.set_interface_locale(text) to authenticated;


-- ── RLS: service role only for every new table in 1 + 2 ─────────────────────
do $$
declare t text;
begin
  foreach t in array array['message_conversations', 'message_participants', 'messages', 'message_attachments',
                           'message_events', 'notifications', 'notification_emails']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.notification_emails_id_seq to service_role;


-- ── Private bucket for message files (service role only; signed links to read) ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('message-attachments', 'message-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ══ 3. Announcements ══════════════════════════════════════════════════════

alter table public.product_notices
  add column if not exists body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object'),
  add column if not exists requires_ack boolean not null default false;
comment on column public.product_notices.body is 'ADR-050 D8 — optional "Read more" text, one value per language (max 4,000 characters each, checked by the app).';
comment on column public.product_notices.requires_ack is 'ADR-050 D8 — the banner asks "OK, understood" instead of a close button; acknowledgements in product_notice_acks.';

-- Is this notice aimed at the current person? No `projects` / `users` in the
-- audience = everyone (the module filter is applied by the app, as in 045).
create or replace function public.product_notice_targets_me(p_audience jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(jsonb_typeof(p_audience -> 'projects'), '') <> 'array' and coalesce(jsonb_typeof(p_audience -> 'users'), '') <> 'array' then true
    when coalesce(jsonb_array_length(case when jsonb_typeof(p_audience -> 'projects') = 'array' then p_audience -> 'projects' else '[]'::jsonb end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(p_audience -> 'users') = 'array' then p_audience -> 'users' else '[]'::jsonb end), 0) = 0 then true
    else (
      (jsonb_typeof(p_audience -> 'users') = 'array' and (p_audience -> 'users') ? (auth.uid())::text)
      or exists (
        select 1
        from jsonb_array_elements_text(case when jsonb_typeof(p_audience -> 'projects') = 'array' then p_audience -> 'projects' else '[]'::jsonb end) as p(id)
        where p.id ~ '^[0-9a-fA-F-]{36}$' and p.id::uuid in (select public.get_my_project_ids())
      )
    )
  end
$$;
revoke all on function public.product_notice_targets_me(jsonb) from public, anon;
grant execute on function public.product_notice_targets_me(jsonb) to authenticated;

drop policy if exists "Signed-in people read published notices" on public.product_notices;
create policy "Signed-in people read published notices aimed at them"
  on public.product_notices
  for select
  to authenticated
  using (status = 'published' and public.product_notice_targets_me(audience));

create table public.product_notice_acks (
  user_id          uuid        not null references auth.users (id) on delete cascade,
  notice_id        uuid        not null references public.product_notices (id) on delete cascade,
  acknowledged_at  timestamptz not null default now(),
  primary key (user_id, notice_id)
);
comment on table public.product_notice_acks is
  'ADR-050 D8 — who pressed "OK, understood" on which notice. Each person reads and inserts only their own rows (RLS); Abluo reads all with the service role.';
create index product_notice_acks_notice on public.product_notice_acks (notice_id);

alter table public.product_notice_acks enable row level security;
revoke all on table public.product_notice_acks from anon, authenticated, public;
grant select, insert on table public.product_notice_acks to authenticated;
grant all privileges on table public.product_notice_acks to service_role;

create policy "People read their own acknowledgements"
  on public.product_notice_acks
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The EXISTS runs under the caller's RLS on product_notices: only a published
-- notice aimed at them that asks for an acknowledgement.
create policy "People acknowledge notices for themselves"
  on public.product_notice_acks
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.product_notices n where n.id = notice_id and n.status = 'published' and n.requires_ack)
  );


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['message_conversations', 'message_participants', 'messages', 'message_attachments',
                           'message_events', 'notifications', 'notification_emails']
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '069 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT') then
      raise exception '069 self-check: % reachable by anon/authenticated', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '069 self-check: % must have no policies', t;
    end if;
  end loop;
  if not exists (select 1 from storage.buckets where id = 'message-attachments' and not public) then
    raise exception '069 self-check: bucket message-attachments missing or public';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_notices'
                 and policyname = 'Signed-in people read published notices aimed at them') then
    raise exception '069 self-check: product_notices read policy missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'product_notices'
             and policyname = 'Signed-in people read published notices') then
    raise exception '069 self-check: the old open read policy on product_notices is still there';
  end if;
  raise notice '069 self-check passed';
end $$;

commit;

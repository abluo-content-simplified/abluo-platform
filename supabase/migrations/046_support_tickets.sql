-- ============================================================
-- Migration 046 — Support Tickets V1 (ADR-039, Tom 2026-10-22)
--
-- NOT APPLIED. Additive only. Apply AFTER the code that reads it is deployed
-- (2026-08-14 rule): the code treats a missing table (42P01 / PGRST205 /
-- 42883) as "support tickets not available yet" and keeps showing the
-- coming-soon Support pages.
--
-- ── What ───────────────────────────────────────────────────────────────────
--   support_tickets             one row per request (number ABL-000124 from a
--                               sequence, status, internal severity, context)
--   support_ticket_messages     the conversation the client sees (the request's
--                               description is the first message)
--   support_ticket_notes        Abluo-internal notes. A SEPARATE table so no
--                               client query can ever reach one (ADR-039 D7)
--   support_ticket_attachments  screenshots in the private bucket
--   support_ticket_events       append-only audit + the status lines the
--                               client sees (visibility public | internal)
--   support_ticket_reads        per person "read up to" marks (unread badges)
--   support_ticket_outbox       email notifications (ADR-019 mechanics)
--   storage bucket              support-attachments (PRIVATE)
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   Every table: RLS on, NO grants and NO policies for anon / authenticated.
--   All access is server code with the service role, after the ADR-039 D3
--   checks (the 038 pattern). The write paths that must be atomic (create,
--   reply, status, severity, redaction) are SECURITY INVOKER functions
--   executable by service_role only.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception '046: public.projects missing';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '046: public.set_updated_at() missing — migration 005 is not applied';
  end if;
  if to_regclass('public.support_tickets') is not null then
    raise exception '046: already applied — stop';
  end if;
end $$;


-- ── Tables ───────────────────────────────────────────────────────────────────
create sequence public.support_ticket_number_seq as bigint start with 1;

create table public.support_tickets (
  id                       uuid        primary key default gen_random_uuid(),
  number                   bigint      not null unique default nextval('public.support_ticket_number_seq'),
  project_id               uuid        not null references public.projects (id) on delete cascade,
  created_by               uuid        references auth.users (id) on delete set null,
  title                    text        not null check (char_length(btrim(title)) between 1 and 120),
  status                   text        not null default 'open'
                                       check (status in ('open', 'in_progress', 'waiting_for_user', 'resolved')),
  severity                 text        not null default 'normal' check (severity in ('low', 'normal', 'high')),
  context                  jsonb       not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  submit_token             uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  last_activity_at         timestamptz not null default now(),
  last_public_activity_at  timestamptz not null default now(),
  resolved_at              timestamptz,
  constraint support_tickets_resolved_at check ((status = 'resolved') = (resolved_at is not null))
);
alter sequence public.support_ticket_number_seq owned by public.support_tickets.number;
create unique index support_tickets_submit_token on public.support_tickets (created_by, submit_token) where submit_token is not null;
create index support_tickets_project_activity on public.support_tickets (project_id, last_activity_at desc);
create index support_tickets_activity on public.support_tickets (last_activity_at desc);
create index support_tickets_created_by on public.support_tickets (created_by, created_at desc);
create trigger support_tickets_set_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

comment on table public.support_tickets is
  'ADR-039 — one support request from a client project. number is shown as ABL-000124. severity is internal (never shown to the client). '
  'context (admin-only): page, platform version, browser, screen, interface language, role. Service role only.';

create table public.support_ticket_messages (
  id           uuid        primary key default gen_random_uuid(),
  ticket_id    uuid        not null references public.support_tickets (id) on delete cascade,
  author_id    uuid        references auth.users (id) on delete set null,
  author_kind  text        not null check (author_kind in ('client', 'support')),
  body         text        not null check (char_length(body) <= 10000),
  created_at   timestamptz not null default now(),
  redacted_at  timestamptz,
  redacted_by  uuid        references auth.users (id) on delete set null,
  constraint support_ticket_messages_body check (redacted_at is not null or char_length(btrim(body)) >= 1)
);
create index support_ticket_messages_ticket on public.support_ticket_messages (ticket_id, created_at);

create table public.support_ticket_notes (
  id          uuid        primary key default gen_random_uuid(),
  ticket_id   uuid        not null references public.support_tickets (id) on delete cascade,
  author_id   uuid        references auth.users (id) on delete set null,
  body        text        not null check (char_length(btrim(body)) between 1 and 10000),
  created_at  timestamptz not null default now()
);
create index support_ticket_notes_ticket on public.support_ticket_notes (ticket_id, created_at);
comment on table public.support_ticket_notes is
  'ADR-039 D7 — Abluo-internal notes. Never read by any client code path. Service role only.';

create table public.support_ticket_attachments (
  id              uuid        primary key default gen_random_uuid(),
  ticket_id       uuid        not null references public.support_tickets (id) on delete cascade,
  message_id      uuid        references public.support_ticket_messages (id) on delete set null,
  storage_path    text        not null unique,
  mime            text        not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes           integer     not null check (bytes > 0 and bytes <= 5242880),
  width           integer,
  height          integer,
  uploaded_by     uuid        references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  deleted_at      timestamptz,
  deleted_reason  text        check (deleted_reason in ('retention', 'redacted', 'project_deleted')),
  constraint support_ticket_attachments_deleted check ((deleted_at is null) = (deleted_reason is null))
);
create index support_ticket_attachments_ticket on public.support_ticket_attachments (ticket_id);
create index support_ticket_attachments_expiry on public.support_ticket_attachments (expires_at) where deleted_at is null and expires_at is not null;

create table public.support_ticket_events (
  id          uuid        primary key default gen_random_uuid(),
  ticket_id   uuid        not null references public.support_tickets (id) on delete cascade,
  actor_id    uuid        references auth.users (id) on delete set null,
  kind        text        not null check (kind in ('created', 'status_changed', 'severity_changed', 'reopened_by_reply',
                                                   'message_redacted', 'attachment_deleted', 'support_visit_started')),
  from_value  text,
  to_value    text,
  visibility  text        not null check (visibility in ('public', 'internal')),
  created_at  timestamptz not null default now()
);
create index support_ticket_events_ticket on public.support_ticket_events (ticket_id, created_at);

create table public.support_ticket_reads (
  ticket_id     uuid        not null references public.support_tickets (id) on delete cascade,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
create index support_ticket_reads_user on public.support_ticket_reads (user_id);

create table public.support_ticket_outbox (
  event_id      uuid        primary key default gen_random_uuid(),
  ticket_id     uuid        not null references public.support_tickets (id) on delete cascade,
  event_type    text        not null check (event_type in ('ticket.created', 'ticket.client_replied', 'ticket.support_replied', 'ticket.resolved')),
  environment   text        not null default 'production',
  status        text        not null default 'pending' check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead', 'skipped')),
  attempts      integer     not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);
create index support_ticket_outbox_pending on public.support_ticket_outbox (created_at) where status in ('pending', 'failed');


-- ── Lock every table to the service role ─────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['support_tickets', 'support_ticket_messages', 'support_ticket_notes', 'support_ticket_attachments',
                           'support_ticket_events', 'support_ticket_reads', 'support_ticket_outbox']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.support_ticket_number_seq from anon, authenticated, public;
grant usage, select on sequence public.support_ticket_number_seq to service_role;


-- ── Write paths (atomic; service role only) ──────────────────────────────────
-- Errors are raised with a stable code in the message ('support_ticket:<code>')
-- that src/lib/support-tickets/service.ts maps to a user-facing reason.

-- Create a ticket with its first message. Idempotent on (created_by, submit_token):
-- a second call with the same token returns the first ticket (created = false).
create function public.support_ticket_create(
  p_project_id uuid, p_user_id uuid, p_title text, p_body text, p_context jsonb,
  p_submit_token uuid, p_environment text, p_max_per_hour integer default 5
) returns table (id uuid, number bigint, created boolean)
language plpgsql
set search_path = public, pg_temp
as $$
declare v_ticket public.support_tickets%rowtype;
begin
  if p_submit_token is not null then
    select * into v_ticket from public.support_tickets t where t.created_by = p_user_id and t.submit_token = p_submit_token;
    if found then
      return query select v_ticket.id, v_ticket.number, false;
      return;
    end if;
  end if;
  if (select count(*) from public.support_tickets t
      where t.created_by = p_user_id and t.created_at > now() - interval '1 hour') >= p_max_per_hour then
    raise exception 'support_ticket:rate_limited';
  end if;
  insert into public.support_tickets (project_id, created_by, title, context, submit_token)
  values (p_project_id, p_user_id, btrim(p_title), coalesce(p_context, '{}'::jsonb), p_submit_token)
  returning * into v_ticket;
  insert into public.support_ticket_messages (ticket_id, author_id, author_kind, body)
  values (v_ticket.id, p_user_id, 'client', p_body);
  insert into public.support_ticket_events (ticket_id, actor_id, kind, to_value, visibility)
  values (v_ticket.id, p_user_id, 'created', 'open', 'internal');
  insert into public.support_ticket_outbox (ticket_id, event_type, environment)
  values (v_ticket.id, 'ticket.created', coalesce(p_environment, 'production'));
  return query select v_ticket.id, v_ticket.number, true;
end $$;

-- Reply. Client replies move waiting_for_user → open, and reopen a resolved
-- ticket within p_reopen_days of resolved_at (refused after: 'closed').
create function public.support_ticket_reply(
  p_ticket_id uuid, p_author_id uuid, p_author_kind text, p_body text, p_environment text,
  p_reopen_days integer default 14, p_max_per_hour integer default 30
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_message_id uuid;
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'support_ticket:not_found'; end if;
  if p_author_kind not in ('client', 'support') then raise exception 'support_ticket:invalid'; end if;
  if p_author_kind = 'client' and (select count(*) from public.support_ticket_messages m
      where m.author_id = p_author_id and m.created_at > now() - interval '1 hour') >= p_max_per_hour then
    raise exception 'support_ticket:rate_limited';
  end if;

  if p_author_kind = 'client' then
    if v_ticket.status = 'resolved' then
      if v_ticket.resolved_at < now() - make_interval(days => p_reopen_days) then
        raise exception 'support_ticket:closed';
      end if;
      update public.support_tickets set status = 'open', resolved_at = null where id = p_ticket_id;
      update public.support_ticket_attachments set expires_at = null where ticket_id = p_ticket_id and deleted_at is null;
      insert into public.support_ticket_events (ticket_id, actor_id, kind, from_value, to_value, visibility)
      values (p_ticket_id, null, 'reopened_by_reply', 'resolved', 'open', 'public');
    elsif v_ticket.status = 'waiting_for_user' then
      update public.support_tickets set status = 'open' where id = p_ticket_id;
      insert into public.support_ticket_events (ticket_id, actor_id, kind, from_value, to_value, visibility)
      values (p_ticket_id, null, 'status_changed', 'waiting_for_user', 'open', 'public');
    end if;
  end if;

  insert into public.support_ticket_messages (ticket_id, author_id, author_kind, body)
  values (p_ticket_id, p_author_id, p_author_kind, p_body)
  returning id into v_message_id;
  update public.support_tickets set last_activity_at = now(), last_public_activity_at = now() where id = p_ticket_id;
  insert into public.support_ticket_outbox (ticket_id, event_type, environment)
  values (p_ticket_id, case when p_author_kind = 'client' then 'ticket.client_replied' else 'ticket.support_replied' end,
          coalesce(p_environment, 'production'));
  return v_message_id;
end $$;

-- Admin status change (any of the four, incl. reopening). Resolving starts the
-- screenshot retention clock; reopening stops it.
create function public.support_ticket_set_status(
  p_ticket_id uuid, p_actor_id uuid, p_status text, p_environment text, p_retention_days integer default 90
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_ticket public.support_tickets%rowtype;
begin
  if p_status not in ('open', 'in_progress', 'waiting_for_user', 'resolved') then raise exception 'support_ticket:invalid'; end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'support_ticket:not_found'; end if;
  if v_ticket.status = p_status then return; end if;
  update public.support_tickets
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end,
         last_activity_at = now(), last_public_activity_at = now()
   where id = p_ticket_id;
  update public.support_ticket_attachments
     set expires_at = case when p_status = 'resolved' then now() + make_interval(days => p_retention_days) else null end
   where ticket_id = p_ticket_id and deleted_at is null;
  insert into public.support_ticket_events (ticket_id, actor_id, kind, from_value, to_value, visibility)
  values (p_ticket_id, p_actor_id, 'status_changed', v_ticket.status, p_status, 'public');
  if p_status = 'resolved' then
    insert into public.support_ticket_outbox (ticket_id, event_type, environment)
    values (p_ticket_id, 'ticket.resolved', coalesce(p_environment, 'production'));
  end if;
end $$;

create function public.support_ticket_set_severity(p_ticket_id uuid, p_actor_id uuid, p_severity text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_old text;
begin
  if p_severity not in ('low', 'normal', 'high') then raise exception 'support_ticket:invalid'; end if;
  select severity into v_old from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'support_ticket:not_found'; end if;
  if v_old = p_severity then return; end if;
  update public.support_tickets set severity = p_severity where id = p_ticket_id;
  insert into public.support_ticket_events (ticket_id, actor_id, kind, from_value, to_value, visibility)
  values (p_ticket_id, p_actor_id, 'severity_changed', v_old, p_severity, 'internal');
end $$;

-- Redaction: the text is really removed (not kept anywhere), the event logged.
create function public.support_ticket_redact_message(p_message_id uuid, p_actor_id uuid) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_ticket uuid;
begin
  update public.support_ticket_messages
     set body = '', redacted_at = now(), redacted_by = p_actor_id
   where id = p_message_id and redacted_at is null
   returning ticket_id into v_ticket;
  if v_ticket is null then return; end if;
  insert into public.support_ticket_events (ticket_id, actor_id, kind, to_value, visibility)
  values (v_ticket, p_actor_id, 'message_redacted', p_message_id::text, 'internal');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.support_ticket_create(uuid, uuid, text, text, jsonb, uuid, text, integer)',
    'public.support_ticket_reply(uuid, uuid, text, text, text, integer, integer)',
    'public.support_ticket_set_status(uuid, uuid, text, text, integer)',
    'public.support_ticket_set_severity(uuid, uuid, text)',
    'public.support_ticket_redact_message(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ── Grantable extra: an Owner may let an Editor see all the site's tickets ──
insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('support.tickets.read', 'project', null, 'See all of the site’s support requests, not only your own.');


-- ── Private bucket for screenshots (service role only; signed links to read) ─
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['support_tickets', 'support_ticket_messages', 'support_ticket_notes', 'support_ticket_attachments',
                           'support_ticket_events', 'support_ticket_reads', 'support_ticket_outbox']
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '046 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT') then
      raise exception '046 self-check: % reachable by anon/authenticated', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '046 self-check: % must have no policies', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.support_ticket_reply(uuid, uuid, text, text, text, integer, integer)', 'EXECUTE') then
    raise exception '046 self-check: authenticated can execute support_ticket_reply';
  end if;
  if not exists (select 1 from storage.buckets where id = 'support-attachments' and not public) then
    raise exception '046 self-check: bucket support-attachments missing or public';
  end if;
  raise notice '046 self-check passed';
end $$;

commit;

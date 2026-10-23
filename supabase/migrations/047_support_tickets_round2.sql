-- ============================================================
-- Migration 047 — Support Tickets round 2 (ADR-039 amendment, Tom 2026-10-22)
--
-- Additive. Safe to apply before or after the code that uses it: the code
-- falls back to the 046 behaviour when the `side` column is missing.
--
--   1. support_ticket_reads.side ('client' | 'support'): read marks are kept
--      per side, so a person who is both a client Owner and an Abluo admin
--      (Tom) sees unread news on each side independently. Existing marks
--      become 'client' marks.
--   2. Email when the admin sets "Waiting for User" without writing a reply:
--      outbox event 'ticket.waiting_for_user'. Never two emails for one
--      action: it is not queued when Abluo replied in the last 10 minutes, and
--      a reply within 10 minutes of it skips the still-pending one.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.support_ticket_reads') is null then
    raise exception '047: migration 046 is not applied';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'support_ticket_reads' and column_name = 'side') then
    raise exception '047: already applied — stop';
  end if;
end $$;

-- ── 1. Read marks per side ───────────────────────────────────────────────────
alter table public.support_ticket_reads
  add column side text not null default 'client' check (side in ('client', 'support'));
alter table public.support_ticket_reads drop constraint support_ticket_reads_pkey;
alter table public.support_ticket_reads add primary key (ticket_id, user_id, side);

-- ── 2. Waiting-for-user email ────────────────────────────────────────────────
alter table public.support_ticket_outbox drop constraint support_ticket_outbox_event_type_check;
alter table public.support_ticket_outbox add constraint support_ticket_outbox_event_type_check
  check (event_type in ('ticket.created', 'ticket.client_replied', 'ticket.support_replied', 'ticket.resolved', 'ticket.waiting_for_user'));

create or replace function public.support_ticket_set_status(
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
  elsif p_status = 'waiting_for_user' and not exists (
    select 1 from public.support_ticket_messages m
     where m.ticket_id = p_ticket_id and m.author_kind = 'support' and m.created_at > now() - interval '10 minutes'
  ) then
    insert into public.support_ticket_outbox (ticket_id, event_type, environment)
    values (p_ticket_id, 'ticket.waiting_for_user', coalesce(p_environment, 'production'));
  end if;
end $$;

create or replace function public.support_ticket_reply(
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
  else
    -- A reply supersedes a "waiting for you" email queued in the last 10 minutes.
    update public.support_ticket_outbox
       set status = 'skipped', last_error = 'superseded by a reply'
     where ticket_id = p_ticket_id and event_type = 'ticket.waiting_for_user'
       and status = 'pending' and created_at > now() - interval '10 minutes';
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

-- create or replace keeps grants, but restate them so a re-created function is never open.
revoke all on function public.support_ticket_set_status(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.support_ticket_set_status(uuid, uuid, text, text, integer) to service_role;
revoke all on function public.support_ticket_reply(uuid, uuid, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.support_ticket_reply(uuid, uuid, text, text, text, integer, integer) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.support_ticket_reply(uuid, uuid, text, text, text, integer, integer)', 'EXECUTE') then
    raise exception '047 self-check: authenticated can execute support_ticket_reply';
  end if;
  if (select count(*) from information_schema.key_column_usage
      where table_schema = 'public' and table_name = 'support_ticket_reads' and constraint_name = 'support_ticket_reads_pkey') <> 3 then
    raise exception '047 self-check: support_ticket_reads primary key is not (ticket_id, user_id, side)';
  end if;
  raise notice '047 self-check passed';
end $$;

commit;

-- ============================================================
-- Migration 048 — Support Tickets round 3 (ADR-039 amendment, Tom 2026-10-23)
--
-- Additive. Apply BEFORE pushing the round-3 code (the new admin/client
-- actions call what this adds; without it they report "not available").
--
--   1. Partial redaction: support_ticket_redact_parts() replaces chosen parts
--      of a message with the mask character U+2588 (█), keeping the length.
--      The database checks the new text differs from the old ONLY by masked
--      characters, so this path can never rewrite what someone wrote. The
--      original characters are not kept anywhere; the event records how many
--      were removed, never which.
--   2. A client may delete screenshots they uploaded themselves:
--      deleted_reason 'removed_by_client'; the event is public so both sides
--      see "Screenshot removed by the client".
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.support_ticket_messages') is null then
    raise exception '048: migration 046 is not applied';
  end if;
  if to_regprocedure('public.support_ticket_redact_parts(uuid, uuid, text)') is not null then
    raise exception '048: already applied — stop';
  end if;
end $$;

-- ── 1. Partial redaction ─────────────────────────────────────────────────────
create function public.support_ticket_redact_parts(p_message_id uuid, p_actor_id uuid, p_masked_body text) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_ticket uuid;
  v_removed integer := 0;
  i integer;
  a text;
  b text;
begin
  select body, ticket_id into v_old, v_ticket from public.support_ticket_messages
   where id = p_message_id and redacted_at is null for update;
  if not found then raise exception 'support_ticket:not_found'; end if;
  if p_masked_body is null or char_length(p_masked_body) <> char_length(v_old) then
    raise exception 'support_ticket:invalid';
  end if;
  for i in 1 .. char_length(v_old) loop
    a := substr(v_old, i, 1);
    b := substr(p_masked_body, i, 1);
    if a <> b then
      if b <> U&'\2588' then raise exception 'support_ticket:invalid'; end if;
      v_removed := v_removed + 1;
    end if;
  end loop;
  if v_removed = 0 then return 0; end if;
  update public.support_ticket_messages set body = p_masked_body where id = p_message_id;
  insert into public.support_ticket_events (ticket_id, actor_id, kind, to_value, visibility)
  values (v_ticket, p_actor_id, 'message_redacted', 'partial:' || v_removed, 'internal');
  return v_removed;
end $$;

revoke all on function public.support_ticket_redact_parts(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.support_ticket_redact_parts(uuid, uuid, text) to service_role;

-- ── 2. Client removes their own screenshot ───────────────────────────────────
alter table public.support_ticket_attachments drop constraint support_ticket_attachments_deleted_reason_check;
alter table public.support_ticket_attachments add constraint support_ticket_attachments_deleted_reason_check
  check (deleted_reason in ('retention', 'redacted', 'project_deleted', 'removed_by_client'));

do $$
begin
  if has_function_privilege('authenticated', 'public.support_ticket_redact_parts(uuid, uuid, text)', 'EXECUTE') then
    raise exception '048 self-check: authenticated can execute support_ticket_redact_parts';
  end if;
  raise notice '048 self-check passed';
end $$;

commit;

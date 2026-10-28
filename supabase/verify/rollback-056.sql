-- ============================================================================
-- Rollback of migration 056 (transfer ownership of a client) — ONE transaction.
-- Proven by supabase/verify/hardening-056.verify.mjs.
--
-- Refuses (nothing changes) once an ownership transfer was recorded: those
-- access-history rows only make sense with 056. Memberships changed by a
-- transfer are NOT reverted — they are ordinary rows any later change keeps.
-- Leaves 049 exactly as it was (three access-history actions, no function).
-- ============================================================================
begin;

do $$
begin
  if to_regprocedure('public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)') is null then
    raise exception 'rollback-056: 056 is not applied';
  end if;
  if exists (select 1 from public.access_audit_log where action in ('owner.transfer', 'owner.step_down')) then
    raise exception 'rollback-056: ownership was transferred with 056 — rollback would drop that history';
  end if;
end $$;

drop function public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean);

alter table public.access_audit_log drop constraint access_audit_log_action_check;
alter table public.access_audit_log
  add constraint access_audit_log_action_check
  check (action in ('member.change', 'member.archive', 'member.restore'));

commit;

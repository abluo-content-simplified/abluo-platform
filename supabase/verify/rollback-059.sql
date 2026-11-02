-- ============================================================================
-- Rollback of migration 059 (billing alerts, ADR-041 D15) — ONE transaction.
-- Proven by supabase/verify/hardening-059.verify.mjs.
-- Refuses (nothing changes) while ANY live-mode alert exists: those are
-- business records. Test-mode rows are rehearsal data and go with the table.
-- Run this BEFORE rollback-058 / rollback-057 (the table references
-- billing_subscriptions).
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.billing_alerts') is null then
    raise exception 'rollback-059: 059 is not applied';
  end if;
  if exists (select 1 from public.billing_alerts where livemode) then
    raise exception 'rollback-059: live billing alerts exist — refusing (resolve and archive, never drop)';
  end if;
end $$;

drop table public.billing_alerts;

-- Restore 058's billing_sync_subscription (no relink after an ended subscription).
create or replace function public.billing_sync_subscription(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sub_id  text    := p ->> 'stripe_subscription_id';
  v_live    boolean := (p ->> 'livemode')::boolean;
  v_tenant  uuid    := (p ->> 'tenant_id')::uuid;
  v_issuer  uuid    := (p ->> 'issuer_id')::uuid;
  v_project uuid    := nullif(p ->> 'project_id', '')::uuid;
  v_id      uuid;
begin
  if v_sub_id is null or v_live is null or v_tenant is null or v_issuer is null then
    raise exception 'billing:invalid_snapshot' using errcode = '22023';
  end if;

  insert into public.billing_subscriptions as s (
    tenant_id, issuer_id, livemode, stripe_subscription_id, status, current_period_start, current_period_end,
    cancel_at_period_end, canceled_at, ended_at, latest_invoice_id, synced_at)
  values (
    v_tenant, v_issuer, v_live, v_sub_id, p ->> 'status',
    (p ->> 'current_period_start')::timestamptz, (p ->> 'current_period_end')::timestamptz,
    coalesce((p ->> 'cancel_at_period_end')::boolean, false),
    (p ->> 'canceled_at')::timestamptz, (p ->> 'ended_at')::timestamptz,
    p ->> 'latest_invoice_id', now())
  on conflict (stripe_subscription_id) do update set
    status               = excluded.status,
    current_period_start = excluded.current_period_start,
    current_period_end   = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at          = excluded.canceled_at,
    ended_at             = excluded.ended_at,
    latest_invoice_id    = excluded.latest_invoice_id,
    synced_at            = now()
  returning s.id into v_id;
  -- tenant/mode changes are refused by billing_subscriptions_immutable

  if v_project is not null then
    update public.project_billing pb
       set billing_subscription_id = v_id
     where pb.project_id = v_project and pb.livemode = v_live and pb.arrangement = 'stripe'
       and (pb.billing_subscription_id is null or pb.billing_subscription_id = v_id);
    if not found then
      raise exception 'billing:project_not_linkable' using errcode = '23514';
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.billing_sync_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(jsonb) to service_role;

commit;

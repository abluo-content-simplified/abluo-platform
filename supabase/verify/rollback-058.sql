-- ============================================================================
-- Rollback of migration 058 (billing issuers and profiles) — ONE transaction.
-- Returns the billing tables to the 057 shape. Proven by hardening-057.verify.mjs.
-- Refuses (nothing changes) while ANY billing customer, subscription, profile
-- or issuer row exists — those are records, not schema.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.billing_issuers') is null then
    raise exception 'rollback-058: 058 is not applied';
  end if;
  if exists (select 1 from public.billing_customers) or exists (select 1 from public.billing_subscriptions)
     or exists (select 1 from public.billing_profiles) or exists (select 1 from public.billing_issuers) then
    raise exception 'rollback-058: billing data exists — refusing';
  end if;
end $$;

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
  v_project uuid    := nullif(p ->> 'project_id', '')::uuid;
  v_id      uuid;
begin
  if v_sub_id is null or v_live is null or v_tenant is null then
    raise exception 'billing:invalid_snapshot' using errcode = '22023';
  end if;

  insert into public.billing_subscriptions as s (
    tenant_id, livemode, stripe_subscription_id, status, current_period_start, current_period_end,
    cancel_at_period_end, canceled_at, ended_at, latest_invoice_id, synced_at)
  values (
    v_tenant, v_live, v_sub_id, p ->> 'status',
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


create or replace function public.billing_subscriptions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.livemode is distinct from old.livemode
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id then
    raise exception 'billing:immutable' using errcode = '23514';
  end if;
  return new;
end $$;

drop index public.billing_subscriptions_tenant;
alter table public.billing_subscriptions drop constraint billing_subscriptions_customer_fkey;
alter table public.billing_subscriptions drop column issuer_id;

alter table public.billing_customers drop constraint billing_customers_pkey;
alter table public.billing_customers drop column issuer_id;
alter table public.billing_customers alter column stripe_customer_id drop not null;
alter table public.billing_customers add column billing_email text check (billing_email is null or (length(billing_email) <= 320 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
alter table public.billing_customers add constraint billing_customers_pkey primary key (tenant_id, livemode);
alter table public.billing_subscriptions
  add constraint billing_subscriptions_tenant_id_livemode_fkey
  foreign key (tenant_id, livemode) references public.billing_customers (tenant_id, livemode) on delete restrict;
create index billing_subscriptions_tenant on public.billing_subscriptions (tenant_id, livemode);
comment on table public.billing_customers is
  'ADR-041 — the Stripe customer of a client (tenant), one per mode. Shared by all of the client''s project subscriptions. Server-only.';

drop table public.billing_profiles;
drop table public.billing_issuers;

commit;

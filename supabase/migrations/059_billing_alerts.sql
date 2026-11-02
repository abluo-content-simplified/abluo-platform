-- ============================================================
-- Migration 059 — billing risk alerts (ADR-041 D15) + re-subscribe relink
--
-- ⚠️ NOT APPLIED. File only. Rehearse on the Abluo Sandbox, then Tom applies it
-- ONLY after explicit approval, and records it in supabase/APPLIED.md.
-- Additive, plus one function change: billing_sync_subscription may relink a
-- project whose subscription has ended (see the section below). The webhook and the admin screens treat a missing table as
-- "no alerts", so it can be applied before or after the code (the 2026-08-14
-- rule holds).
-- Requires: 057 + 058 (billing_subscriptions, tenants, projects).
-- Proof:    supabase/verify/hardening-059.verify.mjs
-- Rollback: supabase/verify/rollback-059.sql (refuses once live alerts exist)
--
-- ── What ─────────────────────────────────────────────────────────────────────
-- One row per risk event Stripe reports about a client's payment:
--   dispute | refund | early_fraud_warning
-- They are shown to billing admins as actionable alerts (Admin Home, project
-- Billing card) and NEVER change project access. An alert stays `open` until a
-- billing admin acknowledges it, then resolves it with a note.
-- `stripe_object_id` (dispute id, refund id, warning id) is unique per kind, so
-- a re-delivered webhook can never create a second alert.
--
-- ── Access ───────────────────────────────────────────────────────────────────
-- Server-only, exactly like 057: RLS on, no policies, nothing granted to
-- anon/authenticated; reached only by the service role behind
-- requireBillingAdmin() / the webhook.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.billing_subscriptions') is null or to_regclass('public.billing_issuers') is null then
    raise exception '059: 057 + 058 are not applied — apply them first';
  end if;
  if to_regclass('public.billing_alerts') is not null then
    raise exception '059: already applied — stop';
  end if;
end $$;

create table public.billing_alerts (
  id                uuid        primary key default gen_random_uuid(),
  livemode          boolean     not null,
  kind              text        not null check (kind in ('dispute', 'refund', 'early_fraud_warning')),
  -- du_… / re_… / issfr_… — unique per kind: webhook re-deliveries are idempotent.
  stripe_object_id  text        not null check (length(stripe_object_id) between 3 and 255),
  tenant_id         uuid        not null references public.tenants (id) on delete restrict,
  -- Null when the subscription covers several projects (bundle) or none could be resolved.
  project_id        uuid        references public.projects (id) on delete restrict,
  subscription_id   uuid,
  amount_cents      integer     check (amount_cents is null or amount_cents >= 0),
  currency          text        check (currency is null or currency ~ '^[a-z]{3}$'),
  status            text        not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid        references auth.users (id) on delete set null,
  resolved_at       timestamptz,
  resolved_by       uuid        references auth.users (id) on delete set null,
  resolution_note   text        check (resolution_note is null or length(resolution_note) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (kind, stripe_object_id),
  foreign key (subscription_id, livemode) references public.billing_subscriptions (id, livemode) on delete restrict,
  check (status <> 'open'         or (acknowledged_at is null and resolved_at is null)),
  check (status <> 'acknowledged' or (acknowledged_at is not null and resolved_at is null)),
  -- Resolving needs a real note.
  check (status <> 'resolved'     or (resolved_at is not null and resolution_note is not null and length(btrim(resolution_note)) > 0))
);
comment on table public.billing_alerts is
  'ADR-041 D15 — risk events (dispute, refund, early fraud warning) awaiting a billing admin. Never changes access. Server-only.';
create index billing_alerts_open_project on public.billing_alerts (project_id) where status <> 'resolved';
create index billing_alerts_open_subscription on public.billing_alerts (subscription_id) where status <> 'resolved';
create index billing_alerts_open on public.billing_alerts (created_at) where status = 'open';

create trigger billing_alerts_updated_at before update on public.billing_alerts
  for each row execute function public.set_updated_at();

alter table public.billing_alerts enable row level security;
revoke all on table public.billing_alerts from anon, authenticated, public;
grant all privileges on table public.billing_alerts to service_role;

-- ── Re-subscribing after an ended subscription (review 2026-11-02) ──────────
-- 058's billing_sync_subscription links a project only while it has no
-- subscription or already has this one. After a cancellation (or an expired
-- first attempt) the client can start a new Checkout, but the new, paid
-- subscription could then never be linked. Same function, one extra case.
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
       and (pb.billing_subscription_id is null
            or pb.billing_subscription_id = v_id
            -- Re-subscribing (059): a project whose linked subscription has ended
            -- may take a new, live one. An ended snapshot never takes over.
            or (coalesce(p ->> 'status', '') not in ('canceled', 'incomplete_expired')
                and exists (select 1 from public.billing_subscriptions old
                             where old.id = pb.billing_subscription_id
                               and old.status in ('canceled', 'incomplete_expired'))));
    if not found then
      raise exception 'billing:project_not_linkable' using errcode = '23514';
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.billing_sync_subscription(jsonb) from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(jsonb) to service_role;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.billing_alerts'::regclass) then
    raise exception '059 self-check: RLS disabled on billing_alerts';
  end if;
  if has_table_privilege('authenticated', 'public.billing_alerts', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.billing_alerts', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception '059 self-check: billing_alerts reachable by API roles';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'billing_alerts') then
    raise exception '059 self-check: billing_alerts must have no policies';
  end if;
  if not has_table_privilege('service_role', 'public.billing_alerts', 'SELECT,INSERT,UPDATE') then
    raise exception '059 self-check: service_role cannot use billing_alerts';
  end if;
  if has_function_privilege('authenticated', 'public.billing_sync_subscription(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.billing_sync_subscription(jsonb)', 'EXECUTE') then
    raise exception '059 self-check: billing_sync_subscription executable by API roles';
  end if;
  raise notice '059 self-check passed';
end $$;

commit;

-- ── Read-only checks after apply (run by hand) ───────────────────────────────
-- select count(*) from public.billing_alerts;  -- 0

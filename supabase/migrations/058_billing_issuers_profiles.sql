-- ============================================================
-- Migration 058 — billing issuers and client billing profiles (ADR-041 D13/D14)
--
-- ⚠️ NOT APPLIED. File only. Rehearse on the Abluo Sandbox, then Tom applies
-- it to the Abluo project after 057, and records it in supabase/APPLIED.md.
-- Requires: 057 (the version applied to production on 2026-10-30/11-02,
-- sha256 ed9fabc79a98…). Refuses while any Stripe customer or subscription
-- row exists, so it can only reshape EMPTY tables. Nothing reads these
-- tables yet, so it is independent of code releases.
-- Proof:    supabase/verify/hardening-057.verify.mjs (applies 057 → 058)
-- Rollback: supabase/verify/rollback-058.sql (back to the 057 shape)
--
-- ── What ─────────────────────────────────────────────────────────────────────
--  + billing_issuers   the invoicing legal entity (TMZ Germany today), as data
--  + billing_profiles  the client's billing email + legal/tax details, per mode
--  ~ billing_customers keyed per (tenant, issuer, mode); stripe_customer_id
--                      required again; billing_email moves to billing_profiles
--  ~ billing_subscriptions  + issuer_id (never changes); FK to the customer
--                      now includes the issuer
--  ~ billing_subscriptions_immutable / billing_sync_subscription: issuer-aware
-- Destructive only on the empty billing tables (one column dropped, keys
-- rebuilt); no existing non-billing object is touched.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.billing_customers') is null then
    raise exception '058: 057 is not applied — apply 057 first';
  end if;
  if to_regclass('public.billing_issuers') is not null then
    raise exception '058: already applied — stop';
  end if;
  if exists (select 1 from public.billing_customers) or exists (select 1 from public.billing_subscriptions) then
    raise exception '058: billing_customers / billing_subscriptions are not empty — stop (needs a data migration)';
  end if;
end $$;


-- ── 1a. billing_issuers — who invoices (ADR-041 D13) ─────────────────────────
-- The issuing legal entity (name, country, VAT id, Stripe account) is data,
-- not code: TMZ (Germany) today, possibly an Italian entity later. Exactly
-- one issuer is `active` for new subscriptions; a retired issuer stays, so
-- every customer/subscription keeps the issuer it was created under.
-- Tax registrations themselves live in that issuer's Stripe account (Stripe Tax).
create table public.billing_issuers (
  id                 uuid        primary key default gen_random_uuid(),
  key                text        not null unique check (key ~ '^[a-z][a-z0-9-]{1,39}$'),
  legal_name         text        not null check (length(btrim(legal_name)) between 1 and 200),
  country            text        not null check (country ~ '^[A-Z]{2}$'),
  vat_id             text        check (vat_id is null or vat_id ~ '^[A-Z]{2}[A-Za-z0-9+*.]{2,14}$'),
  -- Live Stripe account of this entity (acct_…); null until known. Sandboxes are per developer and not stored.
  stripe_account_id  text        unique check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,}$'),
  -- Configurable invoice wording, per language: { "reverse_charge": { "de": "…", "it": "…", "en": "…" } }
  invoice_texts      jsonb       not null default '{}'::jsonb check (jsonb_typeof(invoice_texts) = 'object'),
  status             text        not null default 'draft' check (status in ('draft', 'active', 'retired')),
  active_from        date,
  retired_on         date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (status <> 'active' or active_from is not null),
  check ((status = 'retired') = (retired_on is not null))
);
comment on table public.billing_issuers is
  'ADR-041 D13 — legal entities that issue Abluo invoices. One active at a time; retired ones are kept for history. Server-only.';
create unique index billing_issuers_one_active on public.billing_issuers ((true)) where status = 'active';


-- ── 1b. billing_profiles — the client's billing identity (ADR-041 D9, D14) ────
-- One per client and mode, shared by all of the client's projects and by
-- every issuer. Abluo is the source of truth (D9); Stripe receives a copy.
create table public.billing_profiles (
  tenant_id          uuid        not null references public.tenants (id) on delete restrict,
  livemode           boolean     not null,
  billing_email      text        check (billing_email is null or (length(billing_email) <= 320 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  customer_type      text        check (customer_type in ('business', 'individual')),
  legal_name         text        check (legal_name is null or length(btrim(legal_name)) between 1 and 200),
  address_line1      text        check (address_line1 is null or length(address_line1) <= 200),
  address_line2      text        check (address_line2 is null or length(address_line2) <= 200),
  postal_code        text        check (postal_code is null or length(postal_code) <= 20),
  city               text        check (city is null or length(city) <= 100),
  region             text        check (region is null or length(region) <= 100),
  country            text        check (country is null or country ~ '^[A-Z]{2}$'),
  -- EU VAT number, with its country prefix (EL for Greece, XI for Northern Ireland).
  vat_id             text        check (vat_id is null or vat_id ~ '^[A-Z]{2}[A-Za-z0-9+*.]{2,14}$'),
  -- VIES result as reported by Stripe (tax_id.verification.status) or recorded manually.
  vat_verification   text        not null default 'none' check (vat_verification in ('none', 'pending', 'verified', 'unverified', 'unavailable')),
  vat_verified_at    timestamptz,
  vat_verified_name  text        check (vat_verified_name is null or length(vat_verified_name) <= 300),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, livemode),
  check (customer_type is distinct from 'business' or legal_name is not null),
  check (vat_id is not null or vat_verification = 'none'),
  check ((vat_verification = 'verified') = (vat_verified_at is not null))
);
comment on table public.billing_profiles is
  'ADR-041 D9/D14 — a client''s billing contact and legal/tax details, per mode, shared by all its projects. Abluo is the source of truth. Server-only.';


-- ── 2. billing_customers — one Stripe customer per client, issuer and mode ──
alter table public.billing_subscriptions drop constraint billing_subscriptions_tenant_id_livemode_fkey;
alter table public.billing_customers drop constraint billing_customers_pkey;
alter table public.billing_customers drop column billing_email;
alter table public.billing_customers add column issuer_id uuid not null references public.billing_issuers (id) on delete restrict;
alter table public.billing_customers alter column stripe_customer_id set not null;
alter table public.billing_customers add primary key (tenant_id, issuer_id, livemode);
comment on table public.billing_customers is
  'ADR-041 — the Stripe customer of a client under one issuer (Stripe account), per mode. Server-only.';


-- ── 3. billing_subscriptions — the issuer it was created under ───────────────
alter table public.billing_subscriptions add column issuer_id uuid not null;
alter table public.billing_subscriptions
  add constraint billing_subscriptions_customer_fkey
  foreign key (tenant_id, issuer_id, livemode) references public.billing_customers (tenant_id, issuer_id, livemode) on delete restrict;
drop index public.billing_subscriptions_tenant;
create index billing_subscriptions_tenant on public.billing_subscriptions (tenant_id, issuer_id, livemode);


-- ── 4. Triggers and functions ────────────────────────────────────────────────
create trigger billing_issuers_updated_at  before update on public.billing_issuers  for each row execute function public.set_updated_at();
create trigger billing_profiles_updated_at before update on public.billing_profiles for each row execute function public.set_updated_at();

-- tenant, issuer, mode and Stripe id never change
create or replace function public.billing_subscriptions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.livemode is distinct from old.livemode
     or new.issuer_id is distinct from old.issuer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id then
    raise exception 'billing:immutable' using errcode = '23514';
  end if;
  return new;
end $$;

-- Upsert a subscription snapshot RE-FETCHED from Stripe (now with its issuer).
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



-- ── 5. Lock down the new tables ─────────────────────────────────────────────
alter table public.billing_issuers  enable row level security;
alter table public.billing_profiles enable row level security;
revoke all on table public.billing_issuers, public.billing_profiles from anon, authenticated, public;
grant all privileges on table public.billing_issuers, public.billing_profiles to service_role;
-- create or replace keeps grants; re-assert anyway
revoke all on function public.billing_sync_subscription(jsonb)  from public, anon, authenticated;
revoke all on function public.billing_subscriptions_immutable() from public, anon, authenticated;
grant execute on function public.billing_sync_subscription(jsonb) to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['billing_issuers', 'billing_profiles', 'billing_customers', 'billing_subscriptions', 'project_billing',
                           'billing_checkout_sessions', 'stripe_webhook_events'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '058 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '058 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '058 self-check: % must have no policies', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.billing_sync_subscription(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.billing_sync_subscription(jsonb)', 'EXECUTE') then
    raise exception '058 self-check: billing_sync_subscription executable by API roles';
  end if;
  raise notice '058 self-check passed';
end $$;

commit;

-- ── Read-only checks after apply (run by hand) ───────────────────────────────
-- select count(*) from pg_tables where schemaname = 'public' and tablename like any (array['billing\_%','project\_billing','stripe\_webhook\_events']); -- 7
-- select count(*) from public.billing_issuers; -- 0 (TMZ Germany is entered from the admin later)

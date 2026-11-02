-- ============================================================
-- Migration 057 — subscription billing foundation (ADR-041)
--
-- ⚠️ NOT APPLIED. File only. Rehearse on the Abluo Sandbox
-- (supabase/verify/sandbox-apply.mjs), then Tom applies it to the Abluo
-- project ONLY after explicit approval, and records it in supabase/APPLIED.md.
-- Purely additive: nothing reads these tables until the billing code ships,
-- so it can be applied before or after that code (the 2026-08-14 rule holds).
-- Requires: schema.sql (tenants, projects, set_updated_at()).
-- Proof:    supabase/verify/hardening-057.verify.mjs
-- Rollback: supabase/verify/rollback-057.sql (refuses once live billing data exists)
--
-- ── What ─────────────────────────────────────────────────────────────────────
-- Per-PROJECT billing with one Stripe customer per TENANT (ADR-041 D1):
--   billing_customers      one Stripe customer per (tenant, mode)
--   billing_subscriptions  snapshot of each Stripe subscription (re-fetched, never event-applied)
--   project_billing        what Abluo agreed per (project, mode) + the lifecycle inputs
--   billing_checkout_sessions  open/complete/expired Checkout sessions per (project, mode)
--   stripe_webhook_events  idempotency ledger for Stripe webhooks
--
-- ── Test vs live (ADR-041 D6) ────────────────────────────────────────────────
-- dev, preview and production share this database. Every row carries
-- `livemode`, and every link between billing rows is a COMPOSITE foreign key
-- that includes it, so a test-mode object can never attach to a live-mode one.
-- The same project can hold a test record and a live record side by side;
-- production reads only livemode = true, every other environment only false.
-- No row → the project is not billed (ADR-041 D4: existing projects untouched).
--
-- ── Access ───────────────────────────────────────────────────────────────────
-- Server-only (the 033/037 pattern): RLS on, no policies, nothing granted to
-- anon/authenticated; tables and functions are reached only by the service
-- role, behind requireAbluoAdmin() or a billing.* permission check in the app.
-- Clients can never write billing data, not even through the REST API.
--
-- ── Deletion ─────────────────────────────────────────────────────────────────
-- Billing rows reference tenants/projects ON DELETE RESTRICT: a client or
-- project with billing history cannot be deleted by accident (incl. the
-- tenants → projects cascade). Archive instead.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '057: public.set_updated_at() missing — apply 005 first';
  end if;
  if to_regclass('public.tenants') is null or to_regclass('public.projects') is null then
    raise exception '057: tenants/projects missing';
  end if;
  if to_regclass('public.project_billing') is not null then
    raise exception '057: already applied — stop';
  end if;
end $$;


-- ── 1. billing_customers — one Stripe customer per tenant and mode ───────────
create table public.billing_customers (
  tenant_id          uuid        not null references public.tenants (id) on delete restrict,
  livemode           boolean     not null,
  -- Null until the Stripe customer is created (Phase 3). The billing contact
  -- can be recorded before that (ADR-041 D9: stored per client, shared by
  -- all of its projects).
  stripe_customer_id text        unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,}$'),
  billing_email      text        check (billing_email is null or (length(billing_email) <= 320 and billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (tenant_id, livemode)
);
comment on table public.billing_customers is
  'ADR-041 — the Stripe customer of a client (tenant), one per mode. Shared by all of the client''s project subscriptions. Server-only.';


-- ── 2. billing_subscriptions — Stripe snapshot ───────────────────────────────
create table public.billing_subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  tenant_id                uuid        not null,
  livemode                 boolean     not null,
  stripe_subscription_id   text        not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{6,}$'),
  status                   text        not null check (status in
                             ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean     not null default false,
  canceled_at              timestamptz,
  ended_at                 timestamptz,
  latest_invoice_id        text        check (latest_invoice_id is null or latest_invoice_id ~ '^in_[A-Za-z0-9]{6,}$'),
  -- First CONFIRMED payment (invoice.paid). Activation is this, never `status`:
  -- delayed methods can show `active` before money arrives (ADR-041 D7).
  first_paid_at            timestamptz,
  -- First confirmed failure of the open episode, and the invoice it belongs to.
  payment_failed_at        timestamptz,
  failed_invoice_id        text        check (failed_invoice_id is null or failed_invoice_id ~ '^in_[A-Za-z0-9]{6,}$'),
  -- Last invoice seen settled (paid, voided or marked uncollectible): a late
  -- `failed` for it is ignored (out-of-order safety).
  last_settled_invoice_id  text        check (last_settled_invoice_id is null or last_settled_invoice_id ~ '^in_[A-Za-z0-9]{6,}$'),
  synced_at                timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (tenant_id, livemode) references public.billing_customers (tenant_id, livemode) on delete restrict,
  unique (id, livemode),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start),
  check ((payment_failed_at is null) = (failed_invoice_id is null))
);
comment on table public.billing_subscriptions is
  'ADR-041 — snapshot of a Stripe subscription, written only by billing_sync_subscription / billing_record_invoice after re-fetching from Stripe. Server-only.';
create index billing_subscriptions_tenant on public.billing_subscriptions (tenant_id, livemode);


-- ── 3. project_billing — Abluo''s agreement per project and mode ─────────────
create table public.project_billing (
  project_id               uuid        not null references public.projects (id) on delete restrict,
  livemode                 boolean     not null,
  arrangement              text        not null check (arrangement in ('stripe', 'manual', 'complimentary')),
  amount_cents             integer     check (amount_cents is null or (amount_cents > 0 and amount_cents <= 100000000)),
  currency                 text        not null default 'eur' check (currency ~ '^[a-z]{3}$'),
  billing_interval         text        check (billing_interval in ('month', 'year')),
  interval_count           smallint    not null default 1 check (interval_count between 1 and 12),
  starts_on                date,
  -- When payment becomes due. Before it: full access (trial / provisioned
  -- early). From it, until the first confirmed payment: the 14/28-day
  -- lifecycle runs (ADR-041 D7). Required for stripe; optional for manual.
  activation_due_at        timestamptz,
  -- Required when activation_due_at is set more than 30 days ahead (Tom,
  -- 2026-10-30: Super Admin override for longer periods, reason mandatory).
  activation_extension_reason text     check (activation_extension_reason is null or length(activation_extension_reason) <= 1000),
  -- manual (bank transfer) only: paid up to and including this date.
  manual_paid_through      date,
  -- Bumped by the app whenever the agreed terms change (Checkout idempotency key).
  terms_version            integer     not null default 1 check (terms_version >= 1),
  stripe_price_id          text        check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]{6,}$'),
  -- Several projects of one tenant may share a subscription (future bundles).
  billing_subscription_id  uuid,
  -- Super Admin override (ADR-041 D9)
  override                 text        not null default 'none' check (override in ('none', 'allow', 'restrict')),
  override_until           timestamptz,
  override_reason          text        check (override_reason is null or length(override_reason) <= 1000),
  override_by              uuid        references auth.users (id) on delete set null,
  override_set_at          timestamptz,
  -- Day-29 review queue (no automatic website suspension)
  review_acknowledged_at   timestamptz,
  review_note              text        check (review_note is null or length(review_note) <= 2000),
  created_by               uuid        references auth.users (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (project_id, livemode),
  foreign key (billing_subscription_id, livemode) references public.billing_subscriptions (id, livemode) on delete restrict,
  check (arrangement = 'complimentary' or (amount_cents is not null and billing_interval is not null)),
  check (arrangement <> 'stripe' or activation_due_at is not null),
  check (arrangement = 'manual' or manual_paid_through is null),
  check (arrangement = 'stripe' or (billing_subscription_id is null and stripe_price_id is null)),
  check (override = 'none' or (override_reason is not null and length(btrim(override_reason)) > 0 and override_set_at is not null)),
  check (override <> 'none' or (override_until is null and override_reason is null))
);
comment on table public.project_billing is
  'ADR-041 — per project and mode: the agreed terms (price, interval, start, payment due), the link to its Stripe subscription, '
  'the Super Admin override and the day-29 review acknowledgement. No row = not billed. Server-only.';
create index project_billing_subscription on public.project_billing (billing_subscription_id) where billing_subscription_id is not null;


-- ── 4. billing_checkout_sessions ─────────────────────────────────────────────
create table public.billing_checkout_sessions (
  stripe_session_id  text        primary key check (stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{6,}$'),
  project_id         uuid        not null,
  livemode           boolean     not null,
  terms_version      integer     not null check (terms_version >= 1),
  status             text        not null default 'open' check (status in ('open', 'complete', 'expired')),
  url                text        check (url is null or url ~ '^https://checkout\.stripe\.com/'),
  expires_at         timestamptz not null,
  created_by         uuid        references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  foreign key (project_id, livemode) references public.project_billing (project_id, livemode) on delete restrict,
  check ((status = 'complete') = (completed_at is not null)),
  check (expires_at > created_at),
  -- A session id says its own mode (cs_test_… / cs_live_…); it must match the row.
  check (livemode = (stripe_session_id like 'cs\_live\_%'))
);
comment on table public.billing_checkout_sessions is
  'ADR-041 — Checkout sessions Abluo created; at most one open per (project, mode). Server-only.';
create unique index billing_checkout_sessions_one_open
  on public.billing_checkout_sessions (project_id, livemode) where status = 'open';


-- ── 5. stripe_webhook_events — idempotency ledger ────────────────────────────
create table public.stripe_webhook_events (
  event_id        text        primary key check (event_id ~ '^evt_[A-Za-z0-9]{6,}$'),
  livemode        boolean     not null,
  type            text        not null check (type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  object_id       text        check (object_id is null or length(object_id) <= 255),
  stripe_created  timestamptz not null,
  status          text        not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts        integer     not null default 0 check (attempts >= 0),
  last_error      text        check (last_error is null or length(last_error) <= 2000),
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  check ((status in ('processed', 'ignored')) = (processed_at is not null))
);
comment on table public.stripe_webhook_events is
  'ADR-041 — every Stripe webhook event received, once. Server-only.';
create index stripe_webhook_events_retry on public.stripe_webhook_events (status, received_at) where status in ('received', 'failed');


-- ── updated_at triggers ──────────────────────────────────────────────────────
create trigger billing_customers_updated_at     before update on public.billing_customers     for each row execute function public.set_updated_at();
create trigger billing_subscriptions_updated_at before update on public.billing_subscriptions for each row execute function public.set_updated_at();
create trigger project_billing_updated_at       before update on public.project_billing       for each row execute function public.set_updated_at();


-- ── Integrity triggers ───────────────────────────────────────────────────────
-- A project may only point at a subscription of its OWN tenant.
-- SECURITY DEFINER: reads projects/billing_subscriptions whatever the
-- caller's grants; it only compares two tenant ids and returns nothing.
create function public.project_billing_check_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_tenant uuid;
  v_sub_tenant     uuid;
begin
  if new.billing_subscription_id is null then
    return new;
  end if;
  select p.tenant_id into v_project_tenant from public.projects p where p.id = new.project_id;
  select s.tenant_id into v_sub_tenant from public.billing_subscriptions s where s.id = new.billing_subscription_id;
  if v_project_tenant is distinct from v_sub_tenant then
    raise exception 'billing:tenant_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger project_billing_check_tenant
  before insert or update of billing_subscription_id, project_id on public.project_billing
  for each row execute function public.project_billing_check_tenant();

-- A subscription never changes tenant or mode.
create function public.billing_subscriptions_immutable()
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
create trigger billing_subscriptions_immutable
  before update on public.billing_subscriptions
  for each row execute function public.billing_subscriptions_immutable();

-- A payment due date more than 30 days ahead needs a recorded reason
-- (ADR-041 D7). Checked whenever the due date is set or moved; the window is
-- measured from that moment. Same constant as ACTIVATION_MAX_DAYS in
-- src/lib/billing/lifecycle.ts (a test keeps them equal).
create function public.project_billing_activation_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.activation_due_at is not null
     and (tg_op = 'INSERT' or new.activation_due_at is distinct from old.activation_due_at)
     and new.activation_due_at > now() + interval '30 days'
     and coalesce(btrim(new.activation_extension_reason), '') = '' then
    raise exception 'billing:activation_window' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger project_billing_activation_window
  before insert or update of activation_due_at, activation_extension_reason on public.project_billing
  for each row execute function public.project_billing_activation_window();


-- ── Functions (service_role only) ────────────────────────────────────────────

-- Claim a webhook event for processing. true = process it now; false = it is
-- already processed/ignored (duplicate delivery). Every call counts an attempt.
create function public.stripe_event_claim(
  p_event_id text, p_livemode boolean, p_type text, p_object_id text, p_created timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  insert into public.stripe_webhook_events (event_id, livemode, type, object_id, stripe_created, attempts)
  values (p_event_id, p_livemode, p_type, p_object_id, p_created, 1)
  on conflict (event_id) do update set attempts = public.stripe_webhook_events.attempts + 1
  returning status into v_status;
  return v_status in ('received', 'failed');
end $$;

create function public.stripe_event_finish(p_event_id text, p_status text, p_error text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'billing:invalid_status' using errcode = '22023';
  end if;
  update public.stripe_webhook_events
     set status = p_status,
         processed_at = case when p_status in ('processed', 'ignored') then now() else null end,
         last_error = case when p_status = 'failed' then left(coalesce(p_error, 'unknown'), 2000) else null end
   where event_id = p_event_id;
  if not found then
    raise exception 'billing:event_not_found' using errcode = 'P0002';
  end if;
end $$;

-- Upsert a subscription snapshot RE-FETCHED from Stripe, and optionally link
-- it to a project (the project id comes from Abluo-set metadata, never the
-- client). Concurrent calls for one subscription serialise on its row
-- (INSERT … ON CONFLICT takes the row lock; proven in hardening-057).
-- Returns the subscription's uuid.
create function public.billing_sync_subscription(p jsonb)
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

-- Record an invoice outcome RE-FETCHED from Stripe. Order-independent:
--  paid   → first_paid_at = earliest paid; clears the failure if it was for
--           this invoice (or no other invoice failed); remembers it as settled.
--  voided → the invoice was voided or marked uncollectible (e.g. forgiven by a
--           Super Admin in Stripe): clears the failure if it was for this
--           invoice and remembers it as settled. Never sets first_paid_at.
--  failed → ignored when this invoice is already settled; otherwise starts
--           (or moves EARLIER, never later) the failure clock for this invoice.
create function public.billing_record_invoice(
  p_stripe_subscription_id text, p_livemode boolean, p_invoice_id text, p_outcome text, p_at timestamptz
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.billing_subscriptions%rowtype;
begin
  if p_outcome not in ('paid', 'voided', 'failed') or p_invoice_id is null or p_at is null then
    raise exception 'billing:invalid_invoice_event' using errcode = '22023';
  end if;
  select * into s from public.billing_subscriptions
   where stripe_subscription_id = p_stripe_subscription_id and livemode = p_livemode
   for update;
  if not found then
    raise exception 'billing:subscription_not_found' using errcode = 'P0002';
  end if;

  if p_outcome in ('paid', 'voided') then
    update public.billing_subscriptions
       set first_paid_at           = case when p_outcome = 'paid' then least(coalesce(first_paid_at, p_at), p_at) else first_paid_at end,
           last_settled_invoice_id = p_invoice_id,
           payment_failed_at       = case when failed_invoice_id is null or failed_invoice_id = p_invoice_id then null else payment_failed_at end,
           failed_invoice_id       = case when failed_invoice_id is null or failed_invoice_id = p_invoice_id then null else failed_invoice_id end
     where id = s.id;
  else
    if s.last_settled_invoice_id = p_invoice_id then
      return; -- late failure of an invoice already settled
    end if;
    update public.billing_subscriptions
       set payment_failed_at = case
             when failed_invoice_id = p_invoice_id then least(payment_failed_at, p_at)
             when failed_invoice_id is null then p_at
             else payment_failed_at end,           -- an older unresolved failure keeps its clock
           failed_invoice_id = coalesce(failed_invoice_id, p_invoice_id)
     where id = s.id;
  end if;
end $$;


-- ── Lock everything down ─────────────────────────────────────────────────────
alter table public.billing_customers         enable row level security;
alter table public.billing_subscriptions     enable row level security;
alter table public.project_billing           enable row level security;
alter table public.billing_checkout_sessions enable row level security;
alter table public.stripe_webhook_events     enable row level security;

revoke all on table public.billing_customers, public.billing_subscriptions, public.project_billing,
                    public.billing_checkout_sessions, public.stripe_webhook_events
  from anon, authenticated, public;
grant all privileges on table public.billing_customers, public.billing_subscriptions, public.project_billing,
                              public.billing_checkout_sessions, public.stripe_webhook_events
  to service_role;

revoke all on function public.stripe_event_claim(text, boolean, text, text, timestamptz)              from public, anon, authenticated;
revoke all on function public.stripe_event_finish(text, text, text)                                   from public, anon, authenticated;
revoke all on function public.billing_sync_subscription(jsonb)                                        from public, anon, authenticated;
revoke all on function public.billing_record_invoice(text, boolean, text, text, timestamptz)          from public, anon, authenticated;
revoke all on function public.project_billing_check_tenant()                                          from public, anon, authenticated;
revoke all on function public.billing_subscriptions_immutable()                                       from public, anon, authenticated;
revoke all on function public.project_billing_activation_window()                                     from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, boolean, text, text, timestamptz)           to service_role;
grant execute on function public.stripe_event_finish(text, text, text)                                to service_role;
grant execute on function public.billing_sync_subscription(jsonb)                                     to service_role;
grant execute on function public.billing_record_invoice(text, boolean, text, text, timestamptz)       to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['billing_customers', 'billing_subscriptions', 'project_billing',
                           'billing_checkout_sessions', 'stripe_webhook_events'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '057 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')
       or has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception '057 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '057 self-check: % must have no policies', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.billing_sync_subscription(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.stripe_event_claim(text, boolean, text, text, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.billing_record_invoice(text, boolean, text, text, timestamptz)', 'EXECUTE') then
    raise exception '057 self-check: billing functions executable by API roles';
  end if;
  raise notice '057 self-check passed';
end $$;

commit;

-- ── Read-only checks after apply (run by hand) ───────────────────────────────
-- select count(*) from pg_tables where schemaname = 'public'
--   and tablename in ('billing_customers','billing_subscriptions','project_billing','billing_checkout_sessions','stripe_webhook_events'); -- 5
-- select count(*) from public.project_billing;  -- 0 (no project is billed until migrated explicitly)

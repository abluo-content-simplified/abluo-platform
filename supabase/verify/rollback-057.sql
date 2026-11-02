-- ============================================================================
-- Rollback of migration 057 (subscription billing foundation, ADR-041) — ONE
-- transaction. Proven by supabase/verify/hardening-057.verify.mjs.
--
-- Refuses (nothing changes) while ANY live-mode billing data exists: live
-- customers, subscriptions, project agreements, checkout sessions or webhook
-- events are business records and must never be dropped by a rollback.
-- Test-mode rows (livemode = false) are rehearsal data and are dropped with
-- the tables. After this, 057 can be applied again.
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.project_billing') is null then
    raise exception 'rollback-057: 057 is not applied';
  end if;
  if exists (select 1 from public.billing_customers         where livemode)
     or exists (select 1 from public.billing_subscriptions  where livemode)
     or exists (select 1 from public.project_billing        where livemode)
     or exists (select 1 from public.billing_checkout_sessions where livemode)
     or exists (select 1 from public.stripe_webhook_events  where livemode) then
    raise exception 'rollback-057: live billing data exists — refusing (archive, never drop)';
  end if;
end $$;

drop function public.billing_record_invoice(text, boolean, text, text, timestamptz);
drop function public.billing_sync_subscription(jsonb);
drop function public.stripe_event_finish(text, text, text);
drop function public.stripe_event_claim(text, boolean, text, text, timestamptz);

drop table public.billing_checkout_sessions;
drop table public.project_billing;
drop table public.billing_subscriptions;
drop table public.billing_customers;

drop table public.stripe_webhook_events;

-- Trigger functions (their triggers went with the tables).
drop function public.project_billing_check_tenant();
drop function public.billing_subscriptions_immutable();
drop function if exists public.project_billing_activation_window();  -- if exists: also undoes a pre-review 057 draft (Sandbox only)

commit;

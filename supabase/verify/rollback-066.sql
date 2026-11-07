-- Rollback of migration 066 (Reservations core, ADR-044).
-- Refuses once any booking, pass or setting exists — real data is never dropped.
-- Run in ONE transaction (the file has its own begin/commit).
begin;

do $$
begin
  if to_regclass('public.bookings') is null then
    raise exception 'rollback-066: 066 is not applied — nothing to do';
  end if;
  if exists (select 1 from public.bookings) or exists (select 1 from public.booking_passes)
     or exists (select 1 from public.reservation_settings) or exists (select 1 from public.reservable_targets)
     or exists (select 1 from public.price_categories) or exists (select 1 from public.booking_options)
     or exists (select 1 from public.session_capacity) or exists (select 1 from public.reservation_outbox)
     or exists (select 1 from public.booking_activity) then
    raise exception 'rollback-066: refusing — reservation data exists';
  end if;
  if exists (select 1 from public.tenant_members where extra_permissions && array['reservations.booking.read', 'reservations.payment.update'])
     or exists (select 1 from public.project_members where extra_permissions && array['reservations.booking.read', 'reservations.payment.update']) then
    raise exception 'rollback-066: refusing — someone holds a reservations permission';
  end if;
end $$;

drop function public.reservations_finish_link_attempt(bigint, boolean);
drop function public.reservations_reserve_link_attempt(uuid, text, integer, integer);
drop function public.reservations_anonymise_booking(uuid, uuid, jsonb);
drop function public.reservations_expire_holds(timestamptz);
drop function public.reservations_set_places(uuid, uuid, integer, boolean, jsonb, boolean);
drop function public.reservations_record_payment(uuid, uuid, text, integer, date, text, text, jsonb);
drop function public.reservations_payment_status(uuid);
drop function public.reservations_extend_hold(uuid, uuid, timestamptz, jsonb);
drop function public.reservations_confirm(uuid, uuid, jsonb);
drop function public.reservations_release(uuid, uuid, text, uuid[], boolean, jsonb, text);
drop function public.reservations_pass_withdraw(uuid, uuid, uuid, boolean, jsonb);
drop function public.reservations_pass_attend(uuid, uuid, uuid, jsonb, boolean);
drop function public.reservations_book(uuid, jsonb);
drop function public.reservations_pass_covers(public.booking_passes, uuid);
drop function public.reservations_log(uuid, uuid, uuid, jsonb, text, jsonb);
drop function public.reservations_lock_and_check(uuid, uuid[], integer[], uuid);
drop function public.reservations_places_of(uuid);
drop function public.reservations_ensure_capacity(uuid, uuid);
drop function public.reservations_active_count(uuid, uuid);

drop table public.booking_link_attempts;
drop table public.reservation_outbox;
drop table public.booking_activity;
drop table public.booking_refunds;
drop table public.booking_payments;
drop table public.booking_lines;
drop table public.booking_allocations;
drop table public.booking_passes;
drop table public.booking_attendees;
drop table public.bookings;
drop table public.booking_option_session_prices;
drop table public.booking_option_prices;
drop table public.booking_options;
drop table public.price_categories;
drop table public.session_capacity;
drop table public.reservable_targets;
drop function public.reservable_targets_check_edition();
drop table public.reservation_settings;

alter table public.event_occurrences drop constraint event_occurrences_owner_key;

delete from public.grantable_permissions where id in ('reservations.payment.update', 'reservations.booking.read');

commit;

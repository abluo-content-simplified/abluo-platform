-- ============================================================
-- Migration 066 — Reservations core (ADR-044, Accepted 2026-11-07)
--
-- NOT APPLIED. Order: rehearse on the Abluo Sandbox (supabase/verify/rehearse-066.mjs),
-- then Tom applies it on Abluo (production) by hand in the SQL editor.
-- Additive: no existing table changes except ONE new unique constraint on
-- event_occurrences (id, project_id, owner_type, owner_public_id) — it only makes
-- the composite foreign key from session_capacity possible (id is already unique).
-- Nothing in the running app reads these tables until the Reservations code ships.
--
-- What it holds (ADR-044 D2): booking rules, bookable targets, places per
-- session, price categories, booking options + prices, bookings, attendees,
-- allocations (one per attendee × session: hold / confirmed / pass_attendance),
-- passes (the right to attend, never a place — D9), lines, payments, refunds,
-- an append-only activity log, a notification outbox and link rate limiting.
--
-- Places (D3): every write that takes places goes through one plpgsql function
-- that locks the session_capacity rows IN ID ORDER (FOR UPDATE), counts active
-- allocations and inserts all or nothing. A session_capacity row is created on
-- first use (places = the target's default, null = unlimited), so the lock
-- always has a row (D16.1). Expired holds stop counting at once (logical expiry,
-- D5); the sweep only tidies them up.
--
-- Server-only: RLS on, no policies, nothing granted to anon/authenticated.
-- service_role gets select/insert/update only — no DELETE anywhere: rows are
-- cancelled, released or anonymised, never deleted. booking_activity is
-- append-only (select/insert). Every table carries project_id; children use
-- composite (id, project_id) keys so a row can never point into another project.
--
-- Error codes: AB409 = no place / changed elsewhere, AB422 = refused by a rule,
-- P0002 = not found. The message starts with 'reservations:' + a code.
-- Rollback: supabase/verify/rollback-066.sql (refuses once real bookings exist).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.bookings') is not null or to_regclass('public.reservable_targets') is not null then
    raise exception '066: already applied — stop';
  end if;
  if to_regclass('public.event_occurrences') is null or to_regclass('public.schedule_editions') is null then
    raise exception '066: needs 043 + 064 (scheduling) first';
  end if;
  if to_regclass('public.grantable_permissions') is null then
    raise exception '066: needs 029 (grantable_permissions) first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'event_occurrences' and column_name = 'owner_type') then
    raise exception '066: needs 064 (owner columns on event_occurrences) first';
  end if;
end $$;

-- ── 0. Composite key on sessions (for the place rows' foreign key) ───────────
alter table public.event_occurrences
  add constraint event_occurrences_owner_key unique (id, project_id, owner_type, owner_public_id);

-- ── 1. Booking rules (one row per project) ───────────────────────────────────
-- rules: the project defaults (self-cancel, absence notice, organiser-cancel
-- outcome, bank transfer, hold days, cutoff, pass sign-up, windows, reminders).
-- Shape validated in TypeScript (src/lib/reservations/rules.ts); here only size.
create table public.reservation_settings (
  project_id            uuid primary key references public.projects (id) on delete restrict,
  rules                 jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object' and length(rules::text) <= 8000),
  -- Localized per site language: {"en": "...", "fr": "..."}.
  bank_details          jsonb check (bank_details is null or (jsonb_typeof(bank_details) = 'object' and length(bank_details::text) <= 4000)),
  payment_instructions  jsonb check (payment_instructions is null or (jsonb_typeof(payment_instructions) = 'object' and length(payment_instructions::text) <= 8000)),
  terms_note            jsonb check (terms_note is null or (jsonb_typeof(terms_note) = 'object' and length(terms_note::text) <= 8000)),
  -- Short project code used as the booking-reference prefix (e.g. CYCE-4F7K).
  reference_prefix      text check (reference_prefix is null or reference_prefix ~ '^[A-Z0-9]{1,6}$'),
  -- D16.16: support sees bookings only after the tenant grants access.
  support_access_until  timestamptz,
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ── 2. Bookable targets ──────────────────────────────────────────────────────
-- An event, a course (optionally one edition = term) or the whole project
-- (owner_type 'project', e.g. a pass that covers every course).
create table public.reservable_targets (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete restrict,
  owner_type            text not null check (owner_type in ('event', 'course', 'project')),
  owner_public_id       uuid,
  edition_id            uuid,
  registration_status   text not null default 'closed' check (registration_status in ('closed', 'open')),
  opens_at              timestamptz,
  closes_at             timestamptz,
  min_participants      integer check (min_participants is null or min_participants between 1 and 100000),
  min_decision_at       timestamptz,
  -- Places per session unless a session says otherwise. null = unlimited.
  default_places        integer check (default_places is null or default_places between 0 and 100000),
  -- Optional cap on passes sold for this target (never tied to class sizes).
  max_passes            integer check (max_passes is null or max_passes between 0 and 1000000),
  include_new_sessions  boolean not null default false,
  rules_override        jsonb check (rules_override is null or (jsonb_typeof(rules_override) = 'object' and length(rules_override::text) <= 8000)),
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  removed_at            timestamptz,
  check ((owner_type = 'project') = (owner_public_id is null)),
  check (owner_type <> 'project' or edition_id is null),
  check (closes_at is null or opens_at is null or closes_at > opens_at),
  unique (id, project_id),
  foreign key (edition_id, project_id) references public.schedule_editions (id, project_id) on delete restrict
);
create unique index reservable_targets_one_per_owner
  on public.reservable_targets (project_id, owner_type,
     coalesce(owner_public_id, '00000000-0000-0000-0000-000000000000'::uuid),
     coalesce(edition_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where removed_at is null;

-- D16.11: an edition must belong to the same owner (or be the site-wide timetable).
create function public.reservable_targets_check_edition() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.edition_id is not null and not exists (
    select 1 from public.schedule_editions e
     where e.id = new.edition_id and e.project_id = new.project_id
       and (e.owner_type is null or (e.owner_type = new.owner_type and e.owner_public_id = new.owner_public_id))
  ) then
    raise exception 'reservations: edition_owner_mismatch' using errcode = 'AB422';
  end if;
  return new;
end $$;
create trigger reservable_targets_check_edition before insert or update of edition_id, owner_type, owner_public_id
  on public.reservable_targets for each row execute function public.reservable_targets_check_edition();

-- ── 3. Places per session ────────────────────────────────────────────────────
-- Exactly one row per session (created on first use). places = this date's own
-- limit; null = inherit the target's default_places (resolved at lock time, so a
-- later change of the default applies at once); unlimited = this date has no
-- limit whatever the default says.
-- rules_override: per-date override (e.g. pass sign-up for this date only).
create table public.session_capacity (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete restrict,
  occurrence_id     uuid not null,
  owner_type        text not null,
  owner_public_id   uuid not null,
  target_id         uuid,
  places            integer check (places is null or places between 0 and 100000),
  unlimited         boolean not null default false,
  rules_override    jsonb check (rules_override is null or (jsonb_typeof(rules_override) = 'object' and length(rules_override::text) <= 4000)),
  version           integer not null default 1 check (version >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (not (unlimited and places is not null)),
  unique (occurrence_id),
  unique (id, project_id),
  unique (id, occurrence_id),
  foreign key (occurrence_id, project_id, owner_type, owner_public_id)
    references public.event_occurrences (id, project_id, owner_type, owner_public_id) on delete restrict,
  foreign key (target_id, project_id) references public.reservable_targets (id, project_id) on delete restrict
);

-- ── 4. Price categories (project vocabulary) ─────────────────────────────────
create table public.price_categories (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete restrict,
  key                  text not null check (key ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  label                jsonb not null default '{}'::jsonb check (jsonb_typeof(label) = 'object' and length(label::text) <= 2000),
  requires_membership  boolean not null default false,
  sort                 integer not null default 0,
  archived_at          timestamptz,
  version              integer not null default 1 check (version >= 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, key),
  unique (id, project_id)
);

-- ── 5. Booking options + prices ──────────────────────────────────────────────
create table public.booking_options (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete restrict,
  target_id             uuid not null,
  kind                  text not null check (kind in ('full_edition', 'sessions', 'drop_in', 'pass')),
  label                 jsonb not null default '{}'::jsonb check (jsonb_typeof(label) = 'object' and length(label::text) <= 2000),
  description           jsonb check (description is null or (jsonb_typeof(description) = 'object' and length(description::text) <= 8000)),
  status                text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  -- kind 'sessions': which sessions the option covers (null = all of the target).
  session_ids           uuid[] check (session_ids is null or cardinality(session_ids) <= 1000),
  -- kind 'pass' (D9).
  pass_scope            text check (pass_scope is null or pass_scope in ('target', 'courses', 'all_courses')),
  pass_scope_owner_ids  uuid[] check (pass_scope_owner_ids is null or cardinality(pass_scope_owner_ids) <= 500),
  pass_validity         text check (pass_validity is null or pass_validity in ('fixed_end', 'duration')),
  pass_valid_to         date,
  pass_duration_months  integer check (pass_duration_months is null or pass_duration_months between 1 and 120),
  pass_entries          integer check (pass_entries is null or pass_entries between 1 and 10000),
  requires_membership   boolean not null default false,
  min_age               integer check (min_age is null or min_age between 0 and 120),
  max_age               integer check (max_age is null or max_age between 0 and 120),
  sort                  integer not null default 0,
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((kind = 'pass') = (pass_scope is not null)),
  check ((kind = 'pass') = (pass_validity is not null)),
  check (pass_validity is distinct from 'fixed_end' or pass_valid_to is not null),
  check (pass_validity is distinct from 'duration' or pass_duration_months is not null),
  check ((pass_scope = 'courses') = (pass_scope_owner_ids is not null and cardinality(pass_scope_owner_ids) > 0) or pass_scope is null),
  check (kind = 'pass' or pass_entries is null),
  check (min_age is null or max_age is null or max_age >= min_age),
  unique (id, project_id),
  foreign key (target_id, project_id) references public.reservable_targets (id, project_id) on delete restrict
);
create index booking_options_target on public.booking_options (project_id, target_id);

create table public.booking_option_prices (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  option_id          uuid not null,
  -- null = the price for everyone (no category).
  price_category_id  uuid,
  amount_cents       integer not null check (amount_cents between 0 and 100000000),
  currency           text not null default 'EUR' check (currency = 'EUR'),
  -- Dated rules (price by booking date, e.g. joining mid-term). null = always.
  valid_from         date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (option_id, project_id) references public.booking_options (id, project_id) on delete restrict,
  foreign key (price_category_id, project_id) references public.price_categories (id, project_id) on delete restrict
);
create unique index booking_option_prices_unique on public.booking_option_prices (option_id,
  coalesce(price_category_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(valid_from, '-infinity'::date));

-- D16.2: per-session price overrides.
create table public.booking_option_session_prices (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  option_id          uuid not null,
  occurrence_id      uuid not null,
  price_category_id  uuid,
  amount_cents       integer not null check (amount_cents between 0 and 100000000),
  currency           text not null default 'EUR' check (currency = 'EUR'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (option_id, project_id) references public.booking_options (id, project_id) on delete restrict,
  foreign key (price_category_id, project_id) references public.price_categories (id, project_id) on delete restrict
);
create unique index booking_option_session_prices_unique on public.booking_option_session_prices (option_id, occurrence_id,
  coalesce(price_category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── 6. Bookings, attendees ───────────────────────────────────────────────────
create table public.bookings (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  target_id              uuid not null,
  option_id              uuid,
  reference              text not null check (reference ~ '^[A-Z0-9]{1,6}-[A-Z0-9]{4,8}$'),
  status                 text not null check (status in ('pending', 'held', 'awaiting_payment', 'confirmed', 'cancelled', 'expired')),
  payment_status         text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded')),
  payment_review         boolean not null default false,
  eligibility_review     boolean not null default false,
  locale                 text not null check (locale ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),
  source                 text not null check (source in ('website', 'dashboard')),
  purchaser_name         text check (purchaser_name is null or length(purchaser_name) <= 200),
  purchaser_email        text check (purchaser_email is null or length(purchaser_email) <= 320),
  purchaser_phone        text check (purchaser_phone is null or length(purchaser_phone) <= 40),
  -- Channel consent: {"email": {...}, "whatsapp": {"granted": true, "wording": "v1", "at": "..."}}
  channel_consent        jsonb check (channel_consent is null or (jsonb_typeof(channel_consent) = 'object' and length(channel_consent::text) <= 4000)),
  total_cents            integer not null check (total_cents between 0 and 100000000),
  currency               text not null default 'EUR' check (currency = 'EUR'),
  -- Titles, option, prices, terms, rules and sessions as shown at booking time.
  snapshot               jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object' and length(snapshot::text) <= 200000),
  hold_expires_at        timestamptz,
  management_token_hash  text check (management_token_hash is null or management_token_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key        text not null check (length(idempotency_key) between 8 and 200),
  contact_id             uuid,
  form_submission_id     uuid,
  confirmed_at           timestamptz,
  cancelled_at           timestamptz,
  cancel_reason          text check (cancel_reason is null or length(cancel_reason) <= 2000),
  anonymised_at          timestamptz,
  version                integer not null default 1 check (version >= 1),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (status not in ('awaiting_payment', 'held') or hold_expires_at is not null),
  unique (id, project_id),
  unique (project_id, reference),
  unique (project_id, idempotency_key),
  foreign key (target_id, project_id) references public.reservable_targets (id, project_id) on delete restrict,
  foreign key (option_id, project_id) references public.booking_options (id, project_id) on delete restrict
);
create unique index bookings_management_token on public.bookings (management_token_hash) where management_token_hash is not null;
create index bookings_project_created on public.bookings (project_id, created_at desc);
create index bookings_target on public.bookings (project_id, target_id, status);
create index bookings_hold_expiry on public.bookings (hold_expires_at) where status in ('held', 'awaiting_payment');

create table public.booking_attendees (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete restrict,
  booking_id          uuid not null,
  name                text check (name is null or length(name) <= 200),
  email               text check (email is null or length(email) <= 320),
  -- D16.6: date of birth is never stored, only "under 18 — guardian".
  is_minor            boolean not null default false,
  guardian            jsonb check (guardian is null or (jsonb_typeof(guardian) = 'object' and length(guardian::text) <= 2000)),
  price_category_id   uuid,
  declared_eligible   boolean,
  eligibility_result  text check (eligibility_result is null or eligibility_result in ('pending', 'verified', 'rejected')),
  eligibility_rule    jsonb check (eligibility_rule is null or (jsonb_typeof(eligibility_rule) = 'object' and length(eligibility_rule::text) <= 2000)),
  form_submission_id  uuid,
  sort                integer not null default 0,
  anonymised_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (not is_minor or guardian is not null or anonymised_at is not null),
  unique (id, project_id),
  unique (id, booking_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (price_category_id, project_id) references public.price_categories (id, project_id) on delete restrict
);
create index booking_attendees_booking on public.booking_attendees (booking_id);

-- ── 7. Passes (D9) ───────────────────────────────────────────────────────────
create table public.booking_passes (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  booking_id             uuid not null,
  attendee_id            uuid not null,
  option_id              uuid not null,
  target_id              uuid not null,
  scope                  text not null check (scope in ('target', 'courses', 'all_courses')),
  scope_owner_ids        uuid[] check (scope_owner_ids is null or cardinality(scope_owner_ids) <= 500),
  valid_from             date not null,
  valid_to               date not null,
  -- null = unlimited entries.
  entries_total          integer check (entries_total is null or entries_total between 1 and 10000),
  status                 text not null default 'active' check (status in ('active', 'cancelled')),
  management_token_hash  text check (management_token_hash is null or management_token_hash ~ '^[0-9a-f]{64}$'),
  anonymised_at          timestamptz,
  version                integer not null default 1 check (version >= 1),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (valid_to >= valid_from),
  check ((scope = 'courses') = (scope_owner_ids is not null and cardinality(scope_owner_ids) > 0)),
  unique (id, project_id),
  unique (id, attendee_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (attendee_id, project_id) references public.booking_attendees (id, project_id) on delete restrict,
  foreign key (attendee_id, booking_id) references public.booking_attendees (id, booking_id) on delete restrict,
  foreign key (option_id, project_id) references public.booking_options (id, project_id) on delete restrict,
  foreign key (target_id, project_id) references public.reservable_targets (id, project_id) on delete restrict
);
create unique index booking_passes_token on public.booking_passes (management_token_hash) where management_token_hash is not null;
create index booking_passes_target on public.booking_passes (project_id, target_id, status);
create index booking_passes_attendee on public.booking_passes (attendee_id);

-- ── 8. Allocations: one per attendee × session ──────────────────────────────
create table public.booking_allocations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete restrict,
  booking_id      uuid not null,
  attendee_id     uuid not null,
  occurrence_id   uuid not null,
  capacity_id     uuid not null,
  kind            text not null check (kind in ('hold', 'confirmed', 'pass_attendance')),
  pass_id         uuid,
  expires_at      timestamptz,
  -- Pass attendance with an entry-count pass: uses one entry unless given back.
  uses_entry      boolean not null default false,
  entry_returned  boolean not null default false,
  released_at     timestamptz,
  release_reason  text check (release_reason is null or release_reason in
                    ('cancelled', 'expired', 'absence', 'withdrawn', 'organiser_cancelled', 'session_removed', 'replaced')),
  -- D9a (later): attendance tracking.
  attended_at     timestamptz,
  no_show         boolean,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((kind = 'pass_attendance') = (pass_id is not null)),
  check (kind <> 'hold' or expires_at is not null),
  check ((released_at is null) = (release_reason is null)),
  check (uses_entry or not entry_returned),
  unique (id, project_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (attendee_id, project_id) references public.booking_attendees (id, project_id) on delete restrict,
  foreign key (capacity_id, project_id) references public.session_capacity (id, project_id) on delete restrict,
  foreign key (pass_id, project_id) references public.booking_passes (id, project_id) on delete restrict,
  -- The row cannot contradict itself: the attendee is of this booking, the
  -- place row is of this session, the pass is of this attendee.
  foreign key (attendee_id, booking_id) references public.booking_attendees (id, booking_id) on delete restrict,
  foreign key (capacity_id, occurrence_id) references public.session_capacity (id, occurrence_id) on delete restrict,
  foreign key (pass_id, attendee_id) references public.booking_passes (id, attendee_id) on delete restrict
);
-- One active place per attendee per session.
create unique index booking_allocations_one_active on public.booking_allocations (attendee_id, occurrence_id) where released_at is null;
create index booking_allocations_session on public.booking_allocations (occurrence_id) where released_at is null;
create index booking_allocations_booking on public.booking_allocations (booking_id);
create index booking_allocations_pass on public.booking_allocations (pass_id) where pass_id is not null;

-- ── 9. Lines, payments, refunds ──────────────────────────────────────────────
create table public.booking_lines (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  booking_id    uuid not null,
  attendee_id   uuid,
  -- Adjustments (e.g. price difference after the eligibility check) are new
  -- lines, never edits.
  kind          text not null check (kind in ('item', 'adjustment')),
  label         jsonb not null default '{}'::jsonb check (jsonb_typeof(label) = 'object' and length(label::text) <= 2000),
  quantity      integer not null default 1 check (quantity between 1 and 10000),
  unit_cents    integer not null check (unit_cents between -100000000 and 100000000),
  amount_cents  integer not null check (amount_cents between -100000000 and 100000000),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  check (kind = 'adjustment' or amount_cents >= 0),
  check (kind = 'adjustment' or amount_cents = quantity * unit_cents),
  unique (id, project_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (attendee_id, project_id) references public.booking_attendees (id, project_id) on delete restrict,
  foreign key (attendee_id, booking_id) references public.booking_attendees (id, booking_id) on delete restrict
);
create index booking_lines_booking on public.booking_lines (booking_id);

create table public.booking_payments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  booking_id    uuid not null,
  method        text not null check (method in ('free', 'bank_transfer', 'cash', 'other', 'stripe')),
  amount_cents  integer not null check (amount_cents between 0 and 100000000),
  currency      text not null default 'EUR' check (currency = 'EUR'),
  status        text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'void')),
  paid_on       date,
  -- The bank's / provider's own reference, as the club admin typed it.
  reference     text check (reference is null or length(reference) <= 200),
  note          text check (note is null or length(note) <= 2000),
  recorded_by   uuid,
  provider      text check (provider is null or provider in ('stripe')),
  provider_ref  text check (provider_ref is null or length(provider_ref) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, project_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict
);
create index booking_payments_booking on public.booking_payments (booking_id);

create table public.booking_refunds (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  booking_id    uuid not null,
  payment_id    uuid,
  kind          text not null check (kind in ('refund', 'manual_return', 'credit')),
  amount_cents  integer not null check (amount_cents between 0 and 100000000),
  currency      text not null default 'EUR' check (currency = 'EUR'),
  reason        text check (reason is null or length(reason) <= 2000),
  status        text not null default 'requested' check (status in ('requested', 'approved', 'done', 'rejected', 'failed')),
  requested_by  uuid,
  approved_by   uuid,
  provider_ref  text check (provider_ref is null or length(provider_ref) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, project_id),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (payment_id, project_id) references public.booking_payments (id, project_id) on delete restrict
);
create index booking_refunds_booking on public.booking_refunds (booking_id);

-- ── 10. Activity (append-only), outbox, link attempts ────────────────────────
create table public.booking_activity (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete restrict,
  booking_id  uuid,
  pass_id     uuid,
  actor_kind  text not null check (actor_kind in ('user', 'participant', 'system', 'support')),
  actor_id    uuid,
  action      text not null check (action ~ '^[a-z][a-z0-9_.]{1,63}$'),
  detail      jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and length(detail::text) <= 8192),
  created_at  timestamptz not null default now(),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (pass_id, project_id) references public.booking_passes (id, project_id) on delete restrict
);
create index booking_activity_booking on public.booking_activity (booking_id, created_at);
create index booking_activity_project on public.booking_activity (project_id, created_at desc);

create table public.reservation_outbox (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete restrict,
  booking_id           uuid,
  pass_id              uuid,
  intent               text not null check (intent ~ '^[a-z][a-z0-9_.]{1,63}$'),
  dedupe_key           text not null check (length(dedupe_key) between 3 and 300),
  recipients           jsonb not null check (jsonb_typeof(recipients) = 'array' and length(recipients::text) <= 20000),
  locale               text not null check (locale ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),
  payload              jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 50000),
  environment          text not null check (environment in ('production', 'preview', 'development')),
  status               text not null default 'pending' check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead', 'skipped')),
  attempts             integer not null default 0 check (attempts between 0 and 100),
  last_error           text check (last_error is null or length(last_error) <= 2000),
  provider_message_id  text check (provider_message_id is null or length(provider_message_id) <= 200),
  claimed_at           timestamptz,
  next_attempt_at      timestamptz not null default now(),
  delivered_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (dedupe_key),
  foreign key (booking_id, project_id) references public.bookings (id, project_id) on delete restrict,
  foreign key (pass_id, project_id) references public.booking_passes (id, project_id) on delete restrict
);
create index reservation_outbox_due on public.reservation_outbox (next_attempt_at) where status in ('pending', 'failed', 'delivering');

create table public.booking_link_attempts (
  id           bigint generated always as identity primary key,
  project_id   uuid references public.projects (id) on delete restrict,
  ip_hash      text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  succeeded    boolean,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index booking_link_attempts_ip on public.booking_link_attempts (ip_hash, created_at);

-- ── 11. Access: server-only ──────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['reservation_settings', 'reservable_targets', 'session_capacity', 'price_categories',
    'booking_options', 'booking_option_prices', 'booking_option_session_prices', 'bookings', 'booking_attendees',
    'booking_passes', 'booking_allocations', 'booking_lines', 'booking_payments', 'booking_refunds',
    'booking_activity', 'reservation_outbox', 'booking_link_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    if t = 'booking_activity' then
      execute format('grant select, insert on public.%I to service_role', t);
    else
      execute format('grant select, insert, update on public.%I to service_role', t);
    end if;
  end loop;
end $$;
revoke all on sequence public.booking_activity_id_seq, public.booking_link_attempts_id_seq from public, anon, authenticated;
grant usage on sequence public.booking_activity_id_seq, public.booking_link_attempts_id_seq to service_role;

-- ── 12. Functions ────────────────────────────────────────────────────────────

-- Active = not released and (not a hold, or a hold that has not expired).
-- clock_timestamp(), not now(): a long transaction must not see a hold as
-- active after it has expired for everyone else.
create function public.reservations_active_count(p_occurrence_id uuid, p_exclude_booking uuid default null)
returns integer language sql volatile set search_path = public, pg_temp as $$
  select count(*)::integer from public.booking_allocations a
   where a.occurrence_id = p_occurrence_id and a.released_at is null
     and (a.kind <> 'hold' or a.expires_at > clock_timestamp())
     and (p_exclude_booking is null or a.booking_id <> p_exclude_booking)
$$;

-- The place row of a session, created on first use (places null = inherit).
create function public.reservations_ensure_capacity(p_project_id uuid, p_occurrence_id uuid)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare
  o record; v_target uuid; v_id uuid;
begin
  select id into v_id from public.session_capacity where occurrence_id = p_occurrence_id and project_id = p_project_id;
  if v_id is not null then return v_id; end if;

  select oc.id, oc.project_id, oc.owner_type, oc.owner_public_id, s.edition_id
    into o
    from public.event_occurrences oc join public.event_series s on s.id = oc.series_id
   where oc.id = p_occurrence_id and oc.project_id = p_project_id;
  if not found then
    raise exception 'reservations: session_not_found' using errcode = 'P0002';
  end if;

  select t.id into v_target
    from public.reservable_targets t
   where t.project_id = p_project_id and t.removed_at is null
     and t.owner_type = o.owner_type and t.owner_public_id = o.owner_public_id
     and (t.edition_id is null or t.edition_id = o.edition_id)
   order by (t.edition_id is not null) desc
   limit 1;

  insert into public.session_capacity (project_id, occurrence_id, owner_type, owner_public_id, target_id)
  values (p_project_id, p_occurrence_id, o.owner_type, o.owner_public_id, v_target)
  on conflict (occurrence_id) do nothing;

  select id into v_id from public.session_capacity where occurrence_id = p_occurrence_id and project_id = p_project_id;
  if v_id is null then
    raise exception 'reservations: session_not_found' using errcode = 'P0002';
  end if;
  return v_id;
end $$;

-- Places that apply to a session now: unlimited → null; its own number; else
-- the default of its target (same owner, the session's edition or no edition,
-- edition-specific first); else null (unlimited).
create function public.reservations_places_of(p_capacity_id uuid)
returns integer language sql stable set search_path = public, pg_temp as $$
  select case when c.unlimited then null
              when c.places is not null then c.places
              else (select t.default_places from public.reservable_targets t
                     where t.project_id = c.project_id and t.removed_at is null
                       and t.owner_type = c.owner_type and t.owner_public_id = c.owner_public_id
                       and (t.edition_id is null or t.edition_id = s.edition_id)
                     order by (t.edition_id is not null) desc limit 1) end
    from public.session_capacity c
    join public.event_occurrences oc on oc.id = c.occurrence_id
    join public.event_series s on s.id = oc.series_id
   where c.id = p_capacity_id
$$;

-- Lock the place rows of these sessions in id order and check there is room for
-- p_needed[i] more at each. Returns the sessions that are full (empty = all fit).
create function public.reservations_lock_and_check(
  p_project_id uuid, p_occurrences uuid[], p_needed integer[], p_exclude_booking uuid default null
) returns uuid[] language plpgsql set search_path = public, pg_temp as $$
declare
  r record; v_full uuid[] := '{}'; v_need integer; v_occ uuid; v_places integer;
begin
  -- Rows created in one global order (by session id) so two bookings creating
  -- rows for the same new sessions cannot deadlock; then locked in row-id order.
  for v_occ in select distinct x from unnest(p_occurrences) x order by 1 loop
    perform public.reservations_ensure_capacity(p_project_id, v_occ);
  end loop;
  for r in
    select c.id, c.occurrence_id from public.session_capacity c
     where c.project_id = p_project_id and c.occurrence_id = any (p_occurrences)
     order by c.id for update
  loop
    v_places := public.reservations_places_of(r.id);
    if v_places is not null then
      v_need := 0;
      for i in 1 .. array_length(p_occurrences, 1) loop
        if p_occurrences[i] = r.occurrence_id then v_need := v_need + p_needed[i]; end if;
      end loop;
      if public.reservations_active_count(r.occurrence_id, p_exclude_booking) + v_need > v_places then
        v_full := v_full || r.occurrence_id;
      end if;
    end if;
  end loop;
  return v_full;
end $$;

create function public.reservations_log(
  p_project_id uuid, p_booking_id uuid, p_pass_id uuid, p_actor jsonb, p_action text, p_detail jsonb default '{}'::jsonb
) returns void language sql set search_path = public, pg_temp as $$
  insert into public.booking_activity (project_id, booking_id, pass_id, actor_kind, actor_id, action, detail)
  values (p_project_id, p_booking_id, p_pass_id,
          coalesce(p_actor ->> 'kind', 'system'), nullif(p_actor ->> 'id', '')::uuid, p_action, coalesce(p_detail, '{}'::jsonb))
$$;

-- Does this session fall under the pass (scope + validity, local date)?
create function public.reservations_pass_covers(p_pass public.booking_passes, p_occurrence_id uuid)
returns boolean language plpgsql stable set search_path = public, pg_temp as $$
declare o record; t record;
begin
  select oc.owner_type, oc.owner_public_id, oc.start_local, oc.status, oc.removed_at, s.edition_id
    into o
    from public.event_occurrences oc join public.event_series s on s.id = oc.series_id
   where oc.id = p_occurrence_id and oc.project_id = p_pass.project_id;
  if not found or o.removed_at is not null or o.status <> 'scheduled' then return false; end if;
  if o.start_local::date < p_pass.valid_from or o.start_local::date > p_pass.valid_to then return false; end if;
  if p_pass.scope = 'all_courses' then return o.owner_type = 'course'; end if;
  if p_pass.scope = 'courses' then return o.owner_type = 'course' and o.owner_public_id = any (p_pass.scope_owner_ids); end if;
  select owner_type, owner_public_id, edition_id into t from public.reservable_targets where id = p_pass.target_id;
  if t.owner_type = 'project' then return o.owner_type = 'course'; end if;
  return o.owner_type = t.owner_type and o.owner_public_id = t.owner_public_id
     and (t.edition_id is null or t.edition_id = o.edition_id);
end $$;

-- ── Book: all or nothing (D3) ────────────────────────────────────────────────
-- p_payload (validated in TypeScript first; checked again here for what keeps
-- data consistent): target_id, option_id, idempotency_key, reference, status
-- ('confirmed' | 'awaiting_payment' | 'held'), locale, source,
-- purchaser {name,email,phone,consent}, total_cents, snapshot, hold_expires_at,
-- management_token_hash, flags {payment_review, eligibility_review},
-- allow_over_capacity, actor {kind,id},
-- attendees [{key,name,email,is_minor,guardian,price_category_id,declared_eligible,eligibility_result,eligibility_rule,form_submission_id}],
-- allocations [{attendee_key, occurrence_id}],
-- passes [{attendee_key, option_id, valid_from, valid_to, management_token_hash}] — scope, scope owners
--   and entries are copied from the option; fixed_end passes end on the option's date; a duration
--   pass may not run longer than its months,
-- lines [{attendee_key, kind, label, quantity, unit_cents, amount_cents}],
-- outbox [{intent, dedupe_key, recipients, locale, payload, environment}].
-- Returns {booking_id, reference, replayed}. Full sessions → AB409 with the
-- full session ids in the DETAIL as JSON.
create function public.reservations_book(p_project_id uuid, p_payload jsonb)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_existing record; v_target record; v_status text; v_key text; v_booking uuid;
  v_hold timestamptz; v_kind text; v_occ uuid[] := '{}'; v_need integer[] := '{}'; v_full uuid[];
  v_att jsonb; v_alloc jsonb; v_pass jsonb; v_line jsonb; v_ob jsonb; v_cap uuid; v_att_id uuid;
  v_attendees jsonb := '{}'::jsonb; v_sum bigint := 0; v_actor jsonb := coalesce(p_payload -> 'actor', '{"kind":"participant"}'::jsonb);
  v_source text := p_payload ->> 'source'; v_over boolean := coalesce((p_payload ->> 'allow_over_capacity')::boolean, false);
  v_passes_sold integer; v_new_passes integer; v_sort integer := 0; v_opt public.booking_options; v_vf date; v_vt date;
begin
  v_key := p_payload ->> 'idempotency_key';
  if v_key is null then raise exception 'reservations: idempotency_key_required' using errcode = 'AB422'; end if;

  -- Retries return the same booking.
  select id, reference into v_existing from public.bookings where project_id = p_project_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'reference', v_existing.reference, 'replayed', true);
  end if;
  -- Two identical requests at the same moment: the second waits here.
  perform pg_advisory_xact_lock(hashtextextended('reservations_book:' || p_project_id::text || ':' || v_key, 0));
  select id, reference into v_existing from public.bookings where project_id = p_project_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object('booking_id', v_existing.id, 'reference', v_existing.reference, 'replayed', true);
  end if;

  select * into v_target from public.reservable_targets
   where id = (p_payload ->> 'target_id')::uuid and project_id = p_project_id and removed_at is null;
  if not found then raise exception 'reservations: target_not_found' using errcode = 'P0002'; end if;
  if v_source = 'website' and (v_target.registration_status <> 'open'
       or (v_target.opens_at is not null and now() < v_target.opens_at)
       or (v_target.closes_at is not null and now() >= v_target.closes_at)) then
    raise exception 'reservations: registration_closed' using errcode = 'AB422';
  end if;
  if v_over and v_source <> 'dashboard' then
    raise exception 'reservations: over_capacity_dashboard_only' using errcode = 'AB422';
  end if;
  if p_payload ? 'option_id' and nullif(p_payload ->> 'option_id', '') is not null and not exists (
    select 1 from public.booking_options where id = (p_payload ->> 'option_id')::uuid and project_id = p_project_id
       and target_id = v_target.id and (status = 'active' or v_source = 'dashboard')) then
    raise exception 'reservations: option_not_available' using errcode = 'AB422';
  end if;

  v_status := p_payload ->> 'status';
  if v_status is null or v_status not in ('held', 'awaiting_payment', 'confirmed') then
    raise exception 'reservations: invalid_status' using errcode = 'AB422';
  end if;
  v_hold := nullif(p_payload ->> 'hold_expires_at', '')::timestamptz;
  if v_status in ('held', 'awaiting_payment') and (v_hold is null or v_hold <= now()) then
    raise exception 'reservations: hold_expiry_required' using errcode = 'AB422';
  end if;
  v_kind := case when v_status = 'confirmed' then 'confirmed' else 'hold' end;

  if jsonb_array_length(coalesce(p_payload -> 'attendees', '[]'::jsonb)) = 0 then
    raise exception 'reservations: attendees_required' using errcode = 'AB422';
  end if;
  if jsonb_array_length(coalesce(p_payload -> 'allocations', '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_payload -> 'passes', '[]'::jsonb)) = 0 then
    raise exception 'reservations: nothing_to_book' using errcode = 'AB422';
  end if;

  -- Sessions: of this target's owner (and edition), scheduled, not removed.
  for v_alloc in select * from jsonb_array_elements(coalesce(p_payload -> 'allocations', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.event_occurrences oc join public.event_series s on s.id = oc.series_id
       where oc.id = (v_alloc ->> 'occurrence_id')::uuid and oc.project_id = p_project_id
         and oc.removed_at is null and oc.status = 'scheduled'
         and oc.owner_type = v_target.owner_type and oc.owner_public_id = v_target.owner_public_id
         and (v_target.edition_id is null or s.edition_id = v_target.edition_id)) then
      raise exception 'reservations: session_not_bookable' using errcode = 'AB422',
        detail = jsonb_build_object('occurrence_id', v_alloc ->> 'occurrence_id')::text;
    end if;
    if nullif(p_payload ->> 'option_id', '') is not null and exists (
      select 1 from public.booking_options bo where bo.id = (p_payload ->> 'option_id')::uuid
         and bo.session_ids is not null and not ((v_alloc ->> 'occurrence_id')::uuid = any (bo.session_ids))) then
      raise exception 'reservations: session_not_in_option' using errcode = 'AB422';
    end if;
    v_occ := v_occ || (v_alloc ->> 'occurrence_id')::uuid;
    v_need := v_need || 1;
  end loop;
  if nullif(p_payload ->> 'form_submission_id', '') is not null and not exists (
    select 1 from public.form_submissions where id = (p_payload ->> 'form_submission_id')::uuid and project_id = p_project_id) then
    raise exception 'reservations: form_submission_invalid' using errcode = 'AB422';
  end if;

  v_full := public.reservations_lock_and_check(p_project_id, v_occ, v_need);
  if cardinality(v_full) > 0 and not v_over then
    raise exception 'reservations: full' using errcode = 'AB409', detail = to_jsonb(v_full)::text;
  end if;

  -- Pass sales cap (locked through the target row).
  v_new_passes := jsonb_array_length(coalesce(p_payload -> 'passes', '[]'::jsonb));
  if v_new_passes > 0 and v_target.max_passes is not null then
    perform 1 from public.reservable_targets where id = v_target.id for update;
    select count(*) into v_passes_sold from public.booking_passes p join public.bookings b on b.id = p.booking_id
     where p.target_id = v_target.id and p.status = 'active' and b.status not in ('cancelled', 'expired');
    if v_passes_sold + v_new_passes > v_target.max_passes and not v_over then
      raise exception 'reservations: passes_sold_out' using errcode = 'AB409';
    end if;
  end if;

  begin
    insert into public.bookings (project_id, target_id, option_id, reference, status, payment_review, eligibility_review,
      locale, source, purchaser_name, purchaser_email, purchaser_phone, channel_consent, total_cents, snapshot,
      hold_expires_at, management_token_hash, idempotency_key, contact_id, form_submission_id, confirmed_at)
    values (p_project_id, v_target.id, nullif(p_payload ->> 'option_id', '')::uuid, p_payload ->> 'reference', v_status,
      coalesce((p_payload #>> '{flags,payment_review}')::boolean, false),
      coalesce((p_payload #>> '{flags,eligibility_review}')::boolean, false),
      p_payload ->> 'locale', v_source,
      p_payload #>> '{purchaser,name}', p_payload #>> '{purchaser,email}', p_payload #>> '{purchaser,phone}',
      p_payload #> '{purchaser,consent}', (p_payload ->> 'total_cents')::integer, coalesce(p_payload -> 'snapshot', '{}'::jsonb),
      case when v_status in ('held', 'awaiting_payment') then v_hold end,
      nullif(p_payload ->> 'management_token_hash', ''), v_key,
      null, nullif(p_payload ->> 'form_submission_id', '')::uuid,
      case when v_status = 'confirmed' then now() end)
    returning id into v_booking;
  exception when unique_violation then
    if exists (select 1 from public.bookings where project_id = p_project_id and reference = p_payload ->> 'reference') then
      raise exception 'reservations: reference_taken' using errcode = 'AB409';
    end if;
    raise;
  end;

  for v_att in select * from jsonb_array_elements(p_payload -> 'attendees') loop
    if v_att ->> 'key' is null or v_attendees ? (v_att ->> 'key') then
      raise exception 'reservations: attendee_key_invalid' using errcode = 'AB422';
    end if;
    if nullif(v_att ->> 'form_submission_id', '') is not null and not exists (
      select 1 from public.form_submissions where id = (v_att ->> 'form_submission_id')::uuid and project_id = p_project_id) then
      raise exception 'reservations: form_submission_invalid' using errcode = 'AB422';
    end if;
    insert into public.booking_attendees (project_id, booking_id, name, email, is_minor, guardian, price_category_id,
      declared_eligible, eligibility_result, eligibility_rule, form_submission_id, sort)
    values (p_project_id, v_booking, v_att ->> 'name', v_att ->> 'email', coalesce((v_att ->> 'is_minor')::boolean, false),
      v_att -> 'guardian', nullif(v_att ->> 'price_category_id', '')::uuid, (v_att ->> 'declared_eligible')::boolean,
      v_att ->> 'eligibility_result', v_att -> 'eligibility_rule', nullif(v_att ->> 'form_submission_id', '')::uuid,
      v_sort)
    returning id into v_att_id;
    v_sort := v_sort + 1;
    v_attendees := v_attendees || jsonb_build_object(v_att ->> 'key', v_att_id);
  end loop;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_payload -> 'allocations', '[]'::jsonb)) loop
    if not v_attendees ? (v_alloc ->> 'attendee_key') then
      raise exception 'reservations: attendee_key_invalid' using errcode = 'AB422';
    end if;
    select id into v_cap from public.session_capacity where occurrence_id = (v_alloc ->> 'occurrence_id')::uuid;
    insert into public.booking_allocations (project_id, booking_id, attendee_id, occurrence_id, capacity_id, kind, expires_at)
    values (p_project_id, v_booking, (v_attendees ->> (v_alloc ->> 'attendee_key'))::uuid, (v_alloc ->> 'occurrence_id')::uuid,
      v_cap, v_kind, case when v_kind = 'hold' then v_hold end);
  end loop;

  for v_pass in select * from jsonb_array_elements(coalesce(p_payload -> 'passes', '[]'::jsonb)) loop
    if not v_attendees ? (v_pass ->> 'attendee_key') then
      raise exception 'reservations: attendee_key_invalid' using errcode = 'AB422';
    end if;
    select * into v_opt from public.booking_options
     where id = (v_pass ->> 'option_id')::uuid and project_id = p_project_id and target_id = v_target.id and kind = 'pass';
    if not found then
      raise exception 'reservations: pass_option_invalid' using errcode = 'AB422';
    end if;
    v_vf := (v_pass ->> 'valid_from')::date;
    v_vt := case when v_opt.pass_validity = 'fixed_end' then v_opt.pass_valid_to else (v_pass ->> 'valid_to')::date end;
    if v_vf is null or v_vt is null or v_vt < v_vf
       or (v_opt.pass_validity = 'duration' and v_vt >= (v_vf + make_interval(months => v_opt.pass_duration_months))::date) then
      raise exception 'reservations: pass_dates_invalid' using errcode = 'AB422';
    end if;
    insert into public.booking_passes (project_id, booking_id, attendee_id, option_id, target_id, scope, scope_owner_ids,
      valid_from, valid_to, entries_total, management_token_hash)
    values (p_project_id, v_booking, (v_attendees ->> (v_pass ->> 'attendee_key'))::uuid, v_opt.id,
      v_target.id, v_opt.pass_scope, v_opt.pass_scope_owner_ids, v_vf, v_vt, v_opt.pass_entries,
      nullif(v_pass ->> 'management_token_hash', ''));
  end loop;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    if v_line ? 'attendee_key' and v_line ->> 'attendee_key' is not null and not v_attendees ? (v_line ->> 'attendee_key') then
      raise exception 'reservations: attendee_key_invalid' using errcode = 'AB422';
    end if;
    insert into public.booking_lines (project_id, booking_id, attendee_id, kind, label, quantity, unit_cents, amount_cents, created_by)
    values (p_project_id, v_booking, (v_attendees ->> (v_line ->> 'attendee_key'))::uuid, coalesce(v_line ->> 'kind', 'item'),
      coalesce(v_line -> 'label', '{}'::jsonb), coalesce((v_line ->> 'quantity')::integer, 1),
      (v_line ->> 'unit_cents')::integer, (v_line ->> 'amount_cents')::integer, nullif(v_actor ->> 'id', '')::uuid);
    v_sum := v_sum + (v_line ->> 'amount_cents')::integer;
  end loop;
  if v_sum <> (p_payload ->> 'total_cents')::bigint then
    raise exception 'reservations: total_mismatch' using errcode = 'AB422';
  end if;

  for v_ob in select * from jsonb_array_elements(coalesce(p_payload -> 'outbox', '[]'::jsonb)) loop
    insert into public.reservation_outbox (project_id, booking_id, intent, dedupe_key, recipients, locale, payload, environment)
    values (p_project_id, v_booking, v_ob ->> 'intent', v_ob ->> 'dedupe_key', v_ob -> 'recipients', v_ob ->> 'locale',
      coalesce(v_ob -> 'payload', '{}'::jsonb), v_ob ->> 'environment')
    on conflict (dedupe_key) do nothing;
  end loop;

  perform public.reservations_log(p_project_id, v_booking, null, v_actor, 'booking.created',
    jsonb_build_object('status', v_status, 'sessions', cardinality(v_occ), 'passes', v_new_passes,
                       'over_capacity', case when cardinality(v_full) > 0 then to_jsonb(v_full) end));
  return jsonb_build_object('booking_id', v_booking, 'reference', p_payload ->> 'reference', 'replayed', false);
end $$;

-- ── Pass attendance: "I'm coming" (D9) ───────────────────────────────────────
-- The sign-up window and the per-class sign-up mode are checked in TypeScript
-- (rules); here: pass valid + covers the session + entries left + room.
create function public.reservations_pass_attend(
  p_project_id uuid, p_pass_id uuid, p_occurrence_id uuid, p_actor jsonb default null, p_allow_over_capacity boolean default false
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_pass public.booking_passes; v_booking record; v_existing uuid; v_used integer; v_full uuid[]; v_cap uuid; v_id uuid;
begin
  select * into v_pass from public.booking_passes where id = p_pass_id and project_id = p_project_id for update;
  if not found then raise exception 'reservations: pass_not_found' using errcode = 'P0002'; end if;
  select status into v_booking from public.bookings where id = v_pass.booking_id;
  if v_pass.status <> 'active' or v_pass.anonymised_at is not null or v_booking.status <> 'confirmed' then
    raise exception 'reservations: pass_not_active' using errcode = 'AB422';
  end if;
  if not public.reservations_pass_covers(v_pass, p_occurrence_id) then
    raise exception 'reservations: pass_does_not_cover' using errcode = 'AB422';
  end if;

  select id into v_existing from public.booking_allocations
   where pass_id = p_pass_id and occurrence_id = p_occurrence_id and released_at is null;
  if v_existing is not null then
    return jsonb_build_object('allocation_id', v_existing, 'replayed', true);
  end if;

  if v_pass.entries_total is not null then
    select count(*) into v_used from public.booking_allocations
     where pass_id = p_pass_id and uses_entry and not entry_returned;
    if v_used >= v_pass.entries_total then
      raise exception 'reservations: no_entries_left' using errcode = 'AB422';
    end if;
  end if;

  v_full := public.reservations_lock_and_check(p_project_id, array[p_occurrence_id], array[1]);
  if cardinality(v_full) > 0 and not p_allow_over_capacity then
    raise exception 'reservations: full' using errcode = 'AB409', detail = to_jsonb(v_full)::text;
  end if;
  select id into v_cap from public.session_capacity where occurrence_id = p_occurrence_id;

  insert into public.booking_allocations (project_id, booking_id, attendee_id, occurrence_id, capacity_id, kind, pass_id, uses_entry)
  values (p_project_id, v_pass.booking_id, v_pass.attendee_id, p_occurrence_id, v_cap, 'pass_attendance', p_pass_id,
          v_pass.entries_total is not null)
  returning id into v_id;
  perform public.reservations_log(p_project_id, v_pass.booking_id, p_pass_id, coalesce(p_actor, '{"kind":"participant"}'::jsonb),
    'pass.attending', jsonb_build_object('occurrence_id', p_occurrence_id, 'over_capacity', cardinality(v_full) > 0));
  return jsonb_build_object('allocation_id', v_id, 'replayed', false);
end $$;

-- "I'm not coming": releases the place; the entry comes back only when asked
-- (TypeScript decides from the change deadline).
create function public.reservations_pass_withdraw(
  p_project_id uuid, p_pass_id uuid, p_occurrence_id uuid, p_return_entry boolean, p_actor jsonb default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_a record;
begin
  select a.id, a.booking_id, a.uses_entry into v_a from public.booking_allocations a
   where a.pass_id = p_pass_id and a.project_id = p_project_id and a.occurrence_id = p_occurrence_id and a.released_at is null
   for update;
  if not found then
    return jsonb_build_object('released', false);
  end if;
  update public.booking_allocations
     set released_at = now(), release_reason = 'withdrawn', entry_returned = (uses_entry and p_return_entry), updated_at = now()
   where id = v_a.id;
  perform public.reservations_log(p_project_id, v_a.booking_id, p_pass_id, coalesce(p_actor, '{"kind":"participant"}'::jsonb),
    'pass.withdrawn', jsonb_build_object('occurrence_id', p_occurrence_id, 'entry_returned', v_a.uses_entry and p_return_entry));
  return jsonb_build_object('released', true, 'entry_returned', v_a.uses_entry and p_return_entry);
end $$;

-- ── Release places: cancel a booking, absence notice, organiser cancellation ─
-- p_occurrence_ids null = every active allocation of the booking.
-- p_cancel_booking = also mark the booking (and its passes) cancelled.
create function public.reservations_release(
  p_project_id uuid, p_booking_id uuid, p_reason text, p_occurrence_ids uuid[] default null,
  p_cancel_booking boolean default false, p_actor jsonb default null, p_note text default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_b record; v_n integer;
begin
  if p_reason not in ('cancelled', 'absence', 'organiser_cancelled', 'session_removed', 'replaced') then
    raise exception 'reservations: invalid_reason' using errcode = 'AB422';
  end if;
  select id, status into v_b from public.bookings where id = p_booking_id and project_id = p_project_id for update;
  if not found then raise exception 'reservations: booking_not_found' using errcode = 'P0002'; end if;

  update public.booking_allocations
     set released_at = now(), release_reason = p_reason,
         entry_returned = case when uses_entry and p_reason in ('organiser_cancelled', 'session_removed') then true else entry_returned end,
         updated_at = now()
   where booking_id = p_booking_id and project_id = p_project_id and released_at is null
     and (p_occurrence_ids is null or occurrence_id = any (p_occurrence_ids));
  get diagnostics v_n = row_count;

  if p_cancel_booking and v_b.status not in ('cancelled', 'expired') then
    update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = p_note,
           version = version + 1, updated_at = now() where id = p_booking_id;
    update public.booking_passes set status = 'cancelled', version = version + 1, updated_at = now()
     where booking_id = p_booking_id and status = 'active';
  end if;
  perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
    case when p_cancel_booking then 'booking.cancelled' else 'booking.released' end,
    jsonb_build_object('reason', p_reason, 'released', v_n, 'sessions', to_jsonb(p_occurrence_ids)));
  return jsonb_build_object('released', v_n, 'cancelled', p_cancel_booking and v_b.status not in ('cancelled', 'expired'));
end $$;

-- ── Confirm (payment arrived / tenant confirms) ──────────────────────────────
-- Holds become confirmed places. Expired holds (also after the sweep) come
-- back only if there is still room; otherwise nothing changes and the booking
-- gets payment_review (D5: tenant decides — return or credit).
create function public.reservations_confirm(p_project_id uuid, p_booking_id uuid, p_actor jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_b record; v_occ uuid[]; v_need integer[]; v_full uuid[];
begin
  select id, status into v_b from public.bookings where id = p_booking_id and project_id = p_project_id for update;
  if not found then raise exception 'reservations: booking_not_found' using errcode = 'P0002'; end if;
  if v_b.status = 'confirmed' then return jsonb_build_object('confirmed', true, 'replayed', true); end if;
  if v_b.status not in ('pending', 'held', 'awaiting_payment', 'expired') then
    raise exception 'reservations: cannot_confirm' using errcode = 'AB422';
  end if;

  -- Every hold of the booking (active or lapsed) is checked under the place-row
  -- lock, counting everyone else: no window at the expiry boundary.
  select coalesce(array_agg(occurrence_id), '{}'), coalesce(array_agg(1), '{}') into v_occ, v_need
    from public.booking_allocations
   where booking_id = p_booking_id and kind = 'hold'
     and (released_at is null or release_reason = 'expired');
  v_full := public.reservations_lock_and_check(p_project_id, v_occ, v_need, p_booking_id);
  if cardinality(v_full) > 0 then
    update public.bookings set payment_review = true, version = version + 1, updated_at = now() where id = p_booking_id;
    perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
      'booking.confirm_refused_full', jsonb_build_object('full', to_jsonb(v_full)));
    return jsonb_build_object('confirmed', false, 'full', to_jsonb(v_full));
  end if;

  update public.booking_allocations
     set kind = 'confirmed', expires_at = null, released_at = null, release_reason = null, updated_at = now()
   where booking_id = p_booking_id and kind = 'hold' and (released_at is null or release_reason = 'expired');
  update public.bookings
     set status = 'confirmed', confirmed_at = now(), hold_expires_at = null, version = version + 1, updated_at = now()
   where id = p_booking_id;
  perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
    'booking.confirmed', jsonb_build_object('from', v_b.status));
  return jsonb_build_object('confirmed', true, 'replayed', false);
end $$;

-- ── Extend a hold (tenant) ───────────────────────────────────────────────────
-- A hold that has already lapsed comes back only if there is still room.
create function public.reservations_extend_hold(p_project_id uuid, p_booking_id uuid, p_until timestamptz, p_actor jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_b record; v_occ uuid[]; v_need integer[]; v_full uuid[];
begin
  select id, status into v_b from public.bookings where id = p_booking_id and project_id = p_project_id for update;
  if not found then raise exception 'reservations: booking_not_found' using errcode = 'P0002'; end if;
  if v_b.status not in ('held', 'awaiting_payment') or p_until <= now() then
    raise exception 'reservations: cannot_extend' using errcode = 'AB422';
  end if;
  select coalesce(array_agg(occurrence_id), '{}'), coalesce(array_agg(1), '{}') into v_occ, v_need
    from public.booking_allocations where booking_id = p_booking_id and kind = 'hold' and released_at is null;
  v_full := public.reservations_lock_and_check(p_project_id, v_occ, v_need, p_booking_id);
  if cardinality(v_full) > 0 then
    raise exception 'reservations: full' using errcode = 'AB409', detail = to_jsonb(v_full)::text;
  end if;
  update public.booking_allocations set expires_at = p_until, updated_at = now()
   where booking_id = p_booking_id and kind = 'hold' and released_at is null;
  update public.bookings set hold_expires_at = p_until, version = version + 1, updated_at = now() where id = p_booking_id;
  perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
    'booking.hold_extended', jsonb_build_object('until', p_until));
  return jsonb_build_object('extended', true);
end $$;

-- Payment status from the money actually received and returned (credits are
-- not money returned). Used by every payment / refund writer.
create function public.reservations_payment_status(p_booking_id uuid)
returns text language sql stable set search_path = public, pg_temp as $$
  with m as (
    select b.total_cents,
           (select coalesce(sum(amount_cents), 0) from public.booking_payments where booking_id = b.id and status = 'succeeded') as paid,
           (select coalesce(sum(amount_cents), 0) from public.booking_refunds
             where booking_id = b.id and status = 'done' and kind in ('refund', 'manual_return')) as refunded
      from public.bookings b where b.id = p_booking_id)
  select case when refunded > 0 and refunded >= paid then 'refunded'
              when refunded > 0 then 'partially_refunded'
              when paid >= total_cents and total_cents > 0 then 'paid'
              when paid > 0 then 'partially_paid'
              else 'unpaid' end from m
$$;

-- ── Record a payment (D6, D16.18) ────────────────────────────────────────────
-- Several payments per booking, any method. Recomputes payment_status; when
-- the booking is paid in full and still waiting, tries to confirm it.
create function public.reservations_record_payment(
  p_project_id uuid, p_booking_id uuid, p_method text, p_amount_cents integer, p_paid_on date,
  p_reference text default null, p_note text default null, p_actor jsonb default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_b record; v_ps text; v_pid uuid; v_conf jsonb;
begin
  select id, status, total_cents into v_b from public.bookings where id = p_booking_id and project_id = p_project_id for update;
  if not found then raise exception 'reservations: booking_not_found' using errcode = 'P0002'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'reservations: invalid_amount' using errcode = 'AB422'; end if;

  insert into public.booking_payments (project_id, booking_id, method, amount_cents, status, paid_on, reference, note, recorded_by)
  values (p_project_id, p_booking_id, p_method, p_amount_cents, 'succeeded', p_paid_on, p_reference, p_note,
          nullif(p_actor ->> 'id', '')::uuid)
  returning id into v_pid;

  v_ps := public.reservations_payment_status(p_booking_id);
  update public.bookings set payment_status = v_ps, version = version + 1, updated_at = now() where id = p_booking_id;
  perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
    'payment.recorded', jsonb_build_object('payment_id', v_pid, 'method', p_method, 'amount_cents', p_amount_cents, 'payment_status', v_ps));

  if v_ps = 'paid' and v_b.status in ('pending', 'held', 'awaiting_payment', 'expired') then
    v_conf := public.reservations_confirm(p_project_id, p_booking_id, p_actor);
  end if;
  return jsonb_build_object('payment_id', v_pid, 'payment_status', v_ps, 'confirm', v_conf);
end $$;

-- ── Places of a session (D3: never below active places without force) ───────
-- p_places null = inherit the target's default; p_unlimited = no limit on this date.
create function public.reservations_set_places(
  p_project_id uuid, p_occurrence_id uuid, p_places integer, p_force boolean default false, p_actor jsonb default null,
  p_unlimited boolean default false
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v_cap uuid; v_active integer; v_eff integer;
begin
  if p_places is not null and (p_places < 0 or p_places > 100000) or (p_unlimited and p_places is not null) then
    raise exception 'reservations: invalid_places' using errcode = 'AB422';
  end if;
  v_cap := public.reservations_ensure_capacity(p_project_id, p_occurrence_id);
  perform 1 from public.session_capacity where id = v_cap for update;
  update public.session_capacity set places = p_places, unlimited = p_unlimited, version = version + 1, updated_at = now() where id = v_cap;
  v_eff := public.reservations_places_of(v_cap);
  v_active := public.reservations_active_count(p_occurrence_id);
  if v_eff is not null and v_active > v_eff then
    if not p_force then
      raise exception 'reservations: places_below_active' using errcode = 'AB409', detail = v_active::text;
    end if;
    perform public.reservations_log(p_project_id, null, null, coalesce(p_actor, '{"kind":"user"}'::jsonb),
      'capacity.forced_below_active', jsonb_build_object('occurrence_id', p_occurrence_id, 'places', v_eff, 'active', v_active));
  end if;
  return jsonb_build_object('capacity_id', v_cap, 'places', v_eff, 'active', v_active);
end $$;

-- ── Sweep: expired holds (daily/hourly via pg_cron; correctness never needs it) ─
create function public.reservations_expire_holds(p_now timestamptz default now())
returns table (booking_id uuid, project_id uuid) language plpgsql set search_path = public, pg_temp as $$
begin
  return query
  with due as (
    update public.bookings b set status = 'expired', version = b.version + 1, updated_at = p_now
     where b.status in ('held', 'awaiting_payment') and b.hold_expires_at <= p_now
    returning b.id, b.project_id
  ), rel as (
    update public.booking_allocations a set released_at = p_now, release_reason = 'expired', updated_at = p_now
      from due where a.booking_id = due.id and a.kind = 'hold' and a.released_at is null
    returning a.id
  ), logged as (
    insert into public.booking_activity (project_id, booking_id, actor_kind, action, detail)
    select due.project_id, due.id, 'system', 'booking.expired', '{}'::jsonb from due
    returning 1
  )
  select due.id, due.project_id from due;
end $$;

-- ── Retention / erasure (D14): keep amounts and references, wipe people ─────
create function public.reservations_anonymise_booking(p_project_id uuid, p_booking_id uuid, p_actor jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin
  update public.bookings set purchaser_name = null, purchaser_email = null, purchaser_phone = null, channel_consent = null,
         management_token_hash = null, contact_id = null, form_submission_id = null,
         snapshot = snapshot - 'purchaser' - 'attendees', anonymised_at = coalesce(anonymised_at, now()),
         version = version + 1, updated_at = now()
   where id = p_booking_id and project_id = p_project_id;
  if not found then raise exception 'reservations: booking_not_found' using errcode = 'P0002'; end if;
  update public.booking_attendees set name = null, email = null, guardian = null, form_submission_id = null,
         eligibility_rule = null, anonymised_at = coalesce(anonymised_at, now()), updated_at = now()
   where booking_id = p_booking_id;
  update public.booking_passes set management_token_hash = null, anonymised_at = coalesce(anonymised_at, now()), updated_at = now()
   where booking_id = p_booking_id;
  update public.reservation_outbox set recipients = '[]'::jsonb, payload = '{}'::jsonb, updated_at = now()
   where booking_id = p_booking_id and status in ('delivered', 'dead', 'skipped');
  perform public.reservations_log(p_project_id, p_booking_id, null, coalesce(p_actor, '{"kind":"system"}'::jsonb), 'booking.anonymised');
  return jsonb_build_object('anonymised', true);
end $$;

-- ── Link rate limit (D11, pattern of site_access_reserve_attempt) ───────────
create function public.reservations_reserve_link_attempt(
  p_project_id uuid, p_ip_hash text, p_window_seconds integer, p_per_ip integer
) returns table (allowed boolean, attempt_id bigint, retry_after_seconds integer)
language plpgsql set search_path = public, pg_temp as $$
declare v_since timestamptz := now() - make_interval(secs => p_window_seconds); v_n integer; v_id bigint;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_window_seconds < 60 or p_per_ip < 1 then
    raise exception 'reservations: invalid_rate_limit' using errcode = 'AB422';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reservations_link_attempt:' || p_ip_hash, 0));
  select count(*) into v_n from public.booking_link_attempts
   where ip_hash = p_ip_hash and succeeded is not true and created_at > v_since;
  if v_n >= p_per_ip then
    return query select false, null::bigint, p_window_seconds; return;
  end if;
  insert into public.booking_link_attempts (project_id, ip_hash) values (p_project_id, p_ip_hash) returning id into v_id;
  return query select true, v_id, 0;
end $$;

create function public.reservations_finish_link_attempt(p_attempt_id bigint, p_succeeded boolean)
returns void language sql set search_path = public, pg_temp as $$
  update public.booking_link_attempts set succeeded = p_succeeded, finished_at = now() where id = p_attempt_id and finished_at is null
$$;

-- Only the service role may call any of them.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'reservations\_%' or p.proname = 'reservable_targets_check_edition') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.sig::text not like 'reservable_targets_check_edition%' then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $$;

-- ── 12b. Grantable extras (ADR-044 D12, ADR-028) ────────────────────────────
-- A treasurer can be given "confirm payments" without editor rights.
insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('reservations.booking.read',   'project', null,                        'See the website''s bookings, passes and rosters.'),
  ('reservations.payment.update', 'project', 'reservations.booking.read', 'Record payments and confirm bookings that were paid.');

-- ── 13. Self-check ───────────────────────────────────────────────────────────
do $$
declare t text; f record;
begin
  foreach t in array array['reservation_settings', 'reservable_targets', 'session_capacity', 'price_categories',
    'booking_options', 'booking_option_prices', 'booking_option_session_prices', 'bookings', 'booking_attendees',
    'booking_passes', 'booking_allocations', 'booking_lines', 'booking_payments', 'booking_refunds',
    'booking_activity', 'reservation_outbox', 'booking_link_attempts'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '066 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception '066 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '066 self-check: % must have no policies', t;
    end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then
      raise exception '066 self-check: service_role cannot read %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception '066 self-check: % must not be deletable', t;
    end if;
  end loop;
  if (select count(*) from public.grantable_permissions where id in ('reservations.booking.read', 'reservations.payment.update')) <> 2 then
    raise exception '066 self-check: grantable rows missing';
  end if;
  if has_table_privilege('service_role', 'public.booking_activity', 'update') then
    raise exception '066 self-check: booking_activity must be append-only';
  end if;
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'reservations\_%' loop
    if has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute') then
      raise exception '066 self-check: % callable by API roles', f.sig;
    end if;
  end loop;
end $$;

commit;

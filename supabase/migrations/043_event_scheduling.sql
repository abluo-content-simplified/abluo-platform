-- ============================================================
-- Migration 043 — event scheduling (Events 2.0, ADR-038 — Tom, 2026-10-20)
--
-- APPLIED 2026-10-20 to production by Tom (SQL editor) — see supabase/APPLIED.md.
-- Rehearsed on Abluo Sandbox first; applied to the
-- Abluo project only after Tom's explicit approval (ADR-038 D10.5).
--
-- Sanity owns what an event SAYS (title, texts, images, venues, hosts).
-- These tables own WHEN, WHERE and WHO for each session:
--   event_series      — a scheduled run of one Sanity event (every event has at
--                       least one; a one-off event is a series with no rule)
--   event_occurrences — one row per session, with a PERMANENT opaque id
-- Linked to Sanity by (project_id, event_public_id) — the event's immutable
-- `publicId` UUID, never its Sanity `_id`. Venues and hosts are referenced by
-- their publicId too, so editing a venue in Sanity updates every session.
--
-- Time: the local date-time + IANA zone is the truth (20:00 stays 20:00 across
-- DST); starts_at/ends_at (UTC) are written by the scheduling layer for range
-- queries. DST rules as ADR-032 (gap → next valid minute, overlap → first).
--
-- Additive and unused until the code that reads it ships: safe for the code
-- that runs today. Phase 2 columns (rule, until, count, original_start_local,
-- is_modified, split_from_series_id) exist now and stay unused in Phase 1.
--
-- No capacity, bookings, participants or payments — those belong to the future
-- Reservations module (ADR-038 D9).
--
-- Server-only: RLS on, no grants to anon/authenticated, no policies; written
-- and read with the service role behind the dashboard's permission checks.
-- Rows are tombstoned (removed_at), never deleted, so ids stay permanent.
-- Rollback: supabase/verify/rollback-043.sql (refuses once real data exists).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.event_series') is not null or to_regclass('public.event_occurrences') is not null then
    raise exception '043: already applied — stop';
  end if;
end $$;

-- ── 1. Series ────────────────────────────────────────────────────────────────
create table public.event_series (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects (id) on delete restrict,
  event_public_id       uuid not null,
  time_zone             text not null check (length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'),
  start_local           timestamp not null,
  end_local             timestamp,
  -- Phase 2 (repeating): RFC 5545 RRULE subset without DTSTART; null = one-off.
  rule                  text check (rule is null or (length(rule) <= 512 and rule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)')),
  rule_until            date,
  rule_count            integer check (rule_count is null or rule_count between 1 and 1000),
  -- Where / how / who — defaults for every session (a session may override).
  place                 jsonb check (place is null or (
                          jsonb_typeof(place) = 'object'
                          and (
                            (place->>'kind' = 'location' and coalesce(place->>'key', '') ~ '^[a-z0-9_-]{1,64}$')
                            or (place->>'kind' = 'venue' and coalesce(place->>'venuePublicId', '') ~ '^[0-9a-f-]{36}$')
                          ))),
  attendance_mode       text not null default 'inPerson' check (attendance_mode in ('inPerson', 'online', 'mixed')),
  instructor_public_ids uuid[] not null default '{}' check (cardinality(instructor_public_ids) <= 50),
  status                text not null default 'active' check (status in ('active', 'ended')),
  split_from_series_id  uuid references public.event_series (id) on delete set null,
  origin                text not null default 'dashboard' check (origin in ('dashboard', 'migrated')),
  version               integer not null default 1 check (version >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  removed_at            timestamptz,
  check (end_local is null or end_local >= start_local),
  check (rule is not null or (rule_until is null and rule_count is null)),
  -- Lets sessions prove they belong to the same project and event as their series.
  unique (id, project_id, event_public_id)
);

comment on table public.event_series is
  'ADR-038 — a scheduled run of one Sanity event, keyed by (project_id, event_public_id = Sanity publicId). '
  'Server-only (service role). One-off events have one series with rule = null. Tombstoned, never deleted.';

-- At most one live ONE-OFF series per event (repeating series come in Phase 2).
create unique index event_series_one_off
  on public.event_series (project_id, event_public_id)
  where rule is null and removed_at is null;
create index event_series_event on public.event_series (project_id, event_public_id) where removed_at is null;

-- ── 2. Occurrences (sessions) ────────────────────────────────────────────────
create table public.event_occurrences (
  id                     uuid primary key default gen_random_uuid(),
  series_id              uuid not null,
  project_id             uuid not null references public.projects (id) on delete restrict,
  event_public_id        uuid not null,
  -- iCal RECURRENCE-ID: the date-time the rule generated (null = added by hand / one-off).
  original_start_local   timestamp,
  start_local            timestamp not null,
  end_local              timestamp,
  time_zone              text not null check (length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'),
  starts_at              timestamptz not null,
  ends_at                timestamptz,
  status                 text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  -- Phase 2: edited individually → never overwritten by regenerating the rule.
  is_modified            boolean not null default false,
  place_override         jsonb check (place_override is null or jsonb_typeof(place_override) = 'object'),
  attendance_override    text check (attendance_override is null or attendance_override in ('inPerson', 'online', 'mixed')),
  instructor_override    uuid[] check (instructor_override is null or cardinality(instructor_override) <= 50),
  -- Short operational note per language, e.g. {"en":"Moved to room 2"}.
  note                   jsonb check (note is null or (jsonb_typeof(note) = 'object' and length(note::text) <= 4000)),
  version                integer not null default 1 check (version >= 1),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  removed_at             timestamptz,
  removed_reason         text check (removed_reason is null or removed_reason in ('rule_changed', 'event_removed', 'series_removed')),
  check (end_local is null or end_local >= start_local),
  check (ends_at is null or ends_at >= starts_at),
  check ((removed_at is null) = (removed_reason is null)),
  foreign key (series_id, project_id, event_public_id)
    references public.event_series (id, project_id, event_public_id) on delete restrict
);

comment on table public.event_occurrences is
  'ADR-038 — one session of an event series. The id is permanent: moving a session changes its times, never its id. '
  'Server-only (service role). Tombstoned (removed_at), never deleted.';

-- A rule never produces the same session twice.
create unique index event_occurrences_original
  on public.event_occurrences (series_id, original_start_local)
  where original_start_local is not null and removed_at is null;
-- Calendars and listings: sessions of a project in a time window.
create index event_occurrences_window on public.event_occurrences (project_id, starts_at) where removed_at is null;
create index event_occurrences_event on public.event_occurrences (project_id, event_public_id, starts_at) where removed_at is null;
create index event_occurrences_series on public.event_occurrences (series_id);

-- ── 3. Access: server-only ───────────────────────────────────────────────────
alter table public.event_series enable row level security;
alter table public.event_occurrences enable row level security;
-- 028's default privileges grant ALL to service_role; take it back first, then grant only what is needed.
revoke all on public.event_series, public.event_occurrences from public, anon, authenticated, service_role;
grant select, insert, update on public.event_series, public.event_occurrences to service_role;
-- No DELETE grant: rows are tombstoned, never deleted (permanent ids).

-- ── 4. Writes: one transaction per change (ADR-038 D5) ───────────────────────
-- Phase 1: the schedule of a ONE-OFF event (one series, one session).
-- Creates it, or updates it when `p_expected_version` matches (optimistic
-- concurrency). Keeps both ids. Returns the ids and the new version.
create function public.event_schedule_save_one_off(
  p_project_id          uuid,
  p_event_public_id     uuid,
  p_time_zone           text,
  p_start_local         timestamp,
  p_end_local           timestamp,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_place               jsonb,
  p_attendance_mode     text,
  p_instructors         uuid[],
  p_expected_version    integer,   -- null = create (fails if one exists)
  p_actor               uuid,
  p_origin              text default 'dashboard'
)
returns table (series_id uuid, occurrence_id uuid, version integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  s public.event_series%rowtype;
  o_id uuid;
begin
  select * into s from public.event_series es
   where es.project_id = p_project_id and es.event_public_id = p_event_public_id
     and es.rule is null and es.removed_at is null
   for update;

  if not found then
    if p_expected_version is not null then
      raise exception 'event_schedule: not_found' using errcode = 'P0002';
    end if;
    insert into public.event_series (project_id, event_public_id, time_zone, start_local, end_local, place, attendance_mode, instructor_public_ids, origin, created_by)
    values (p_project_id, p_event_public_id, p_time_zone, p_start_local, p_end_local, p_place, coalesce(p_attendance_mode, 'inPerson'), coalesce(p_instructors, '{}'), coalesce(p_origin, 'dashboard'), p_actor)
    returning * into s;
    insert into public.event_occurrences (series_id, project_id, event_public_id, start_local, end_local, time_zone, starts_at, ends_at)
    values (s.id, s.project_id, s.event_public_id, p_start_local, p_end_local, p_time_zone, p_starts_at, p_ends_at)
    returning id into o_id;
    return query select s.id, o_id, s.version;
    return;
  end if;

  if p_expected_version is null or p_expected_version <> s.version then
    raise exception 'event_schedule: version_conflict' using errcode = '40001';
  end if;

  update public.event_series es
     set time_zone = p_time_zone, start_local = p_start_local, end_local = p_end_local,
         place = p_place, attendance_mode = coalesce(p_attendance_mode, es.attendance_mode),
         instructor_public_ids = coalesce(p_instructors, es.instructor_public_ids),
         origin = case when coalesce(p_origin, 'dashboard') = 'dashboard' then 'dashboard' else es.origin end,
         version = es.version + 1, updated_at = now()
   where es.id = s.id
   returning * into s;

  update public.event_occurrences eo
     set start_local = p_start_local, end_local = p_end_local, time_zone = p_time_zone,
         starts_at = p_starts_at, ends_at = p_ends_at, version = eo.version + 1, updated_at = now()
   where eo.series_id = s.id and eo.removed_at is null
   returning eo.id into o_id;

  if o_id is null then
    insert into public.event_occurrences (series_id, project_id, event_public_id, start_local, end_local, time_zone, starts_at, ends_at)
    values (s.id, s.project_id, s.event_public_id, p_start_local, p_end_local, p_time_zone, p_starts_at, p_ends_at)
    returning id into o_id;
  end if;

  return query select s.id, o_id, s.version;
end $$;

-- Cancel or restore the session of a one-off event (status only; ids kept).
create function public.event_occurrence_set_status(
  p_project_id uuid, p_occurrence_id uuid, p_status text, p_expected_version integer
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v integer;
begin
  if p_status not in ('scheduled', 'cancelled') then
    raise exception 'event_schedule: invalid_status' using errcode = '22023';
  end if;
  update public.event_occurrences eo
     set status = p_status, version = eo.version + 1, updated_at = now()
   where eo.id = p_occurrence_id and eo.project_id = p_project_id and eo.removed_at is null
     and eo.version = p_expected_version
   returning eo.version into v;
  if v is null then
    raise exception 'event_schedule: version_conflict' using errcode = '40001';
  end if;
  return v;
end $$;

-- Tombstone every schedule of an event (the Sanity event was deleted).
create function public.event_schedule_remove(p_project_id uuid, p_event_public_id uuid)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.event_occurrences eo
     set removed_at = now(), removed_reason = 'event_removed', updated_at = now()
   where eo.project_id = p_project_id and eo.event_public_id = p_event_public_id and eo.removed_at is null;
  get diagnostics n = row_count;
  update public.event_series es
     set removed_at = now(), updated_at = now()
   where es.project_id = p_project_id and es.event_public_id = p_event_public_id and es.removed_at is null;
  return n;
end $$;

revoke all on function public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text) from public, anon, authenticated;
revoke all on function public.event_occurrence_set_status(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.event_schedule_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text) to service_role;
grant execute on function public.event_occurrence_set_status(uuid, uuid, text, integer) to service_role;
grant execute on function public.event_schedule_remove(uuid, uuid) to service_role;

-- ── 5. Self-check (any failure rolls the whole migration back) ───────────────
do $$
declare t text; f text;
begin
  foreach t in array array['event_series', 'event_occurrences'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '043 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
       or has_table_privilege('anon', format('public.%I', t), 'INSERT') then
      raise exception '043 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '043 self-check: % must have no policies', t;
    end if;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT') then
      raise exception '043 self-check: service_role cannot read %', t;
    end if;
    if has_table_privilege('service_role', format('public.%I', t), 'DELETE') then
      raise exception '043 self-check: % must not be deletable (permanent ids)', t;
    end if;
  end loop;
  foreach f in array array[
    'public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text)',
    'public.event_occurrence_set_status(uuid, uuid, text, integer)',
    'public.event_schedule_remove(uuid, uuid)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '043 self-check: % callable by API roles', f;
    end if;
  end loop;
  raise notice '043 self-check passed';
end $$;

commit;

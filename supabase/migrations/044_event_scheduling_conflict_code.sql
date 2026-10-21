-- ============================================================
-- Migration 044 — scheduling conflict error code (Events 2.0, ADR-038 — 2026-10-21)
--
-- NOT APPLIED to production. Rehearsed on Abluo Sandbox first.
--
-- Fixes 043: a stale save raised SQLSTATE 40001 (serialization_failure). The
-- Supabase Data API (PostgREST) treats 40001 as a retryable transaction error
-- and keeps the request hanging instead of answering — found by the scheduling
-- live suite on the sandbox. The two functions now raise the custom SQLSTATE
-- AB409 ("changed elsewhere"), which the API returns at once.
--
-- Same signatures (create or replace), so grants and callers are unchanged.
-- Nothing in production calls these functions yet.
-- Rollback: re-run the two function bodies from 043 (errcode 40001).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.event_series') is null then
    raise exception '044: needs 043 — stop';
  end if;
end $$;

create or replace function public.event_schedule_save_one_off(
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
    raise exception 'event_schedule: version_conflict' using errcode = 'AB409';
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
create or replace function public.event_occurrence_set_status(
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
    raise exception 'event_schedule: version_conflict' using errcode = 'AB409';
  end if;
  return v;
end $$;

-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text)',
    'public.event_occurrence_set_status(uuid, uuid, text, integer)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '044 self-check: % callable by API roles', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '044 self-check: service_role cannot call %', f;
    end if;
    if position('40001' in pg_get_functiondef(f::regprocedure)) > 0 then
      raise exception '044 self-check: % still raises 40001', f;
    end if;
  end loop;
  raise notice '044 self-check passed';
end $$;

commit;

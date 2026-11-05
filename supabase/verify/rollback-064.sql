-- Rollback of migration 064 (course schedules). Refuses once any course data
-- exists (course series/sessions, editions, closures, meeting rooms) — only the
-- empty additive schema may be removed. Restores the 044 body of
-- event_schedule_save_one_off (without owner columns). Run in the SQL editor;
-- one transaction.
begin;
do $$
begin
  if to_regclass('public.schedule_editions') is null then
    raise exception 'rollback-064: 064 is not applied';
  end if;
  if exists (select 1 from public.event_series where owner_type <> 'event')
     or exists (select 1 from public.event_occurrences where owner_type <> 'event')
     or exists (select 1 from public.schedule_editions)
     or exists (select 1 from public.schedule_closures)
     or exists (select 1 from public.schedule_meeting_rooms) then
    raise exception 'rollback-064: refusing — course schedule data exists (real data)';
  end if;
  if exists (select 1 from public.event_occurrences where removed_reason in ('closure', 'series_ended')) then
    raise exception 'rollback-064: refusing — sessions removed for course reasons exist';
  end if;
end $$;

drop function public.schedule_series_end(uuid, uuid, integer);
drop function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean);
drop function public.schedule_occurrences_sync(uuid, uuid, timestamptz, jsonb, jsonb);
drop function public.schedule_series_save(uuid, uuid, text, uuid, uuid, text, timestamp, timestamp, text, integer, date, date, jsonb, text, uuid[], text[], uuid, integer, uuid);

alter table public.event_series
  drop constraint event_series_edition_fk,
  drop constraint event_series_meeting_room_fk,
  drop constraint event_series_languages_check,
  drop constraint event_series_rule_weekday_check,
  drop constraint event_series_span_check;
alter table public.event_series
  drop column edition_id, drop column languages, drop column meeting_room_id,
  drop column rule_weekday, drop column starts_on, drop column ends_on;

drop table public.schedule_closures;
drop table public.schedule_editions;
drop table public.schedule_meeting_rooms;

alter table public.event_occurrences drop constraint event_occurrences_owner_fk;
alter table public.event_series drop constraint event_series_owner_key;
drop index public.event_series_owner;
drop index public.event_occurrences_owner;
alter table public.event_occurrences
  drop constraint event_occurrences_owner_event_check,
  drop constraint event_occurrences_owner_course_check,
  drop constraint event_occurrences_owner_type_check;
alter table public.event_series
  drop constraint event_series_owner_event_check,
  drop constraint event_series_owner_course_check,
  drop constraint event_series_owner_type_check;
alter table public.event_series alter column event_public_id set not null;
alter table public.event_occurrences alter column event_public_id set not null;
alter table public.event_series drop column owner_type, drop column owner_public_id;
alter table public.event_occurrences drop column owner_type, drop column owner_public_id;

alter table public.event_occurrences drop constraint event_occurrences_removed_reason_check;
alter table public.event_occurrences
  add constraint event_occurrences_removed_reason_check
  check (removed_reason is null or removed_reason in ('rule_changed', 'event_removed', 'series_removed'));

-- 044 body of the one-off save (owner columns gone again).
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
  p_expected_version    integer,
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
commit;

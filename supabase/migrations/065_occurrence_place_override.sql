-- ============================================================
-- 065 — Per-date location change for course sessions (ADR-045)   [APPLIED 2026-11-07, Sandbox + production]
--
-- event_occurrences.place_override has existed since 043 and is already read
-- everywhere, but schedule_occurrence_update (064) cannot set it. This recreates
-- the function with two more parameters:
--   p_place        jsonb    null = leave; object = set the place for this session
--   p_clear_place  boolean  true = back to "same as the class"
-- A place change counts as a modification (is_modified), so the rule never
-- overwrites it. Everything else is the 064 body unchanged.
--
-- Additive in effect: the old 12-arg function is dropped and replaced in one
-- transaction; the only caller is the app (service role). The two new
-- parameters have defaults (no change), so the app's existing 12-argument call
-- keeps working: this can be applied at any time, before or after the app code
-- that passes p_place/p_clear_place (which must still not ship before it).
-- Needs 064. Rollback: supabase/verify/rollback-065.sql.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean)') is null then
    raise exception '065: needs 064 (or already applied) — stop';
  end if;
end $$;

drop function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean);

create function public.schedule_occurrence_update(
  p_project_id           uuid,
  p_occurrence_id        uuid,
  p_expected_version     integer,
  p_status               text,
  p_instructor_override  uuid[],
  p_clear_instructor     boolean,
  p_start_local          timestamp,
  p_end_local            timestamp,
  p_starts_at            timestamptz,
  p_ends_at              timestamptz,
  p_note                 jsonb,
  p_clear_note           boolean,
  p_place                jsonb   default null,
  p_clear_place          boolean default false
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare v integer;
begin
  if p_status is not null and p_status not in ('scheduled', 'cancelled') then
    raise exception 'schedule: invalid_status' using errcode = '22023';
  end if;
  if (p_start_local is null) <> (p_starts_at is null) then
    raise exception 'schedule: invalid_times' using errcode = '22023';
  end if;
  if p_place is not null and jsonb_typeof(p_place) <> 'object' then
    raise exception 'schedule: invalid_place' using errcode = '22023';
  end if;

  update public.event_occurrences eo
     set status = coalesce(p_status, eo.status),
         instructor_override = case
           when coalesce(p_clear_instructor, false) then null
           when p_instructor_override is not null then p_instructor_override
           else eo.instructor_override end,
         place_override = case
           when coalesce(p_clear_place, false) then null
           when p_place is not null then p_place
           else eo.place_override end,
         start_local = coalesce(p_start_local, eo.start_local),
         end_local = case when p_start_local is not null then p_end_local else eo.end_local end,
         starts_at = coalesce(p_starts_at, eo.starts_at),
         ends_at = case when p_starts_at is not null then p_ends_at else eo.ends_at end,
         note = case
           when coalesce(p_clear_note, false) then null
           when p_note is not null then p_note
           else eo.note end,
         is_modified = eo.is_modified or p_start_local is not null or p_instructor_override is not null or coalesce(p_clear_instructor, false)
                       or p_place is not null or coalesce(p_clear_place, false),
         version = eo.version + 1, updated_at = now()
   where eo.id = p_occurrence_id and eo.project_id = p_project_id and eo.removed_at is null
     and eo.version = p_expected_version
   returning eo.version into v;

  if v is null then
    raise exception 'schedule: version_conflict' using errcode = 'AB409';
  end if;
  return v;
end $$;

revoke all on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean, jsonb, boolean) to service_role;

commit;

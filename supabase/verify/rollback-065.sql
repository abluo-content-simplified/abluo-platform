-- Rollback of migration 065 (per-date place override). Restores the 064
-- 12-argument schedule_occurrence_update. Refuses while any session carries a
-- place override (that data would silently stop being settable/clearable).
-- Run in the SQL editor; one transaction.
begin;
do $$
begin
  if to_regprocedure('public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean, jsonb, boolean)') is null then
    raise exception 'rollback-065: 065 is not applied';
  end if;
  if exists (select 1 from public.event_occurrences where owner_type = 'course' and place_override is not null) then
    raise exception 'rollback-065: refusing — course sessions with a place override exist';
  end if;
end $$;

drop function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean, jsonb, boolean);

create function public.schedule_occurrence_update(
  p_project_id uuid, p_occurrence_id uuid, p_expected_version integer, p_status text,
  p_instructor_override uuid[], p_clear_instructor boolean,
  p_start_local timestamp, p_end_local timestamp, p_starts_at timestamptz, p_ends_at timestamptz,
  p_note jsonb, p_clear_note boolean
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
  update public.event_occurrences eo
     set status = coalesce(p_status, eo.status),
         instructor_override = case
           when coalesce(p_clear_instructor, false) then null
           when p_instructor_override is not null then p_instructor_override
           else eo.instructor_override end,
         start_local = coalesce(p_start_local, eo.start_local),
         end_local = case when p_start_local is not null then p_end_local else eo.end_local end,
         starts_at = coalesce(p_starts_at, eo.starts_at),
         ends_at = case when p_starts_at is not null then p_ends_at else eo.ends_at end,
         note = case
           when coalesce(p_clear_note, false) then null
           when p_note is not null then p_note
           else eo.note end,
         is_modified = eo.is_modified or p_start_local is not null or p_instructor_override is not null or coalesce(p_clear_instructor, false),
         version = eo.version + 1, updated_at = now()
   where eo.id = p_occurrence_id and eo.project_id = p_project_id and eo.removed_at is null
     and eo.version = p_expected_version
   returning eo.version into v;
  if v is null then
    raise exception 'schedule: version_conflict' using errcode = 'AB409';
  end if;
  return v;
end $$;

revoke all on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean) to service_role;

commit;

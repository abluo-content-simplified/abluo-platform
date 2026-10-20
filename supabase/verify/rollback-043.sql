-- Rollback of migration 043 (event scheduling). Refuses once a schedule exists
-- that was written by the dashboard (real data) — only an empty schema or rows
-- created by the migration script (origin = 'migrated', re-creatable from
-- Sanity) may be dropped. Run in the SQL editor; one transaction.
begin;
do $$
begin
  if to_regclass('public.event_series') is null then
    raise exception 'rollback-043: 043 is not applied';
  end if;
  if exists (select 1 from public.event_series where origin <> 'migrated') then
    raise exception 'rollback-043: refusing — dashboard-written schedules exist (real data)';
  end if;
end $$;
drop function public.event_schedule_remove(uuid, uuid);
drop function public.event_occurrence_set_status(uuid, uuid, text, integer);
drop function public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text);
drop table public.event_occurrences;
drop table public.event_series;
commit;

-- ============================================================
-- Migration 064 — course schedules: owners, editions, closures, meeting rooms
-- (ADR-038 Amendment A, ADR-045 Courses — Tom, 2026-11-04)
--
-- NOT APPLIED to production. Rehearse on Abluo Sandbox first
-- (supabase/verify/rehearse-064.mjs); apply to Abluo only after Tom's approval.
--
-- Builds on 043/044 (event scheduling). Additive:
--   1. event_series / event_occurrences gain an OWNER (owner_type 'event' | 'course',
--      owner_public_id = the Sanity publicId of the event or course). Existing rows
--      are backfilled as events; event_public_id becomes a nullable mirror that is
--      only set for events. Old code keeps working (it only reads event rows).
--   2. event_series gains the repeating-class fields (edition, languages, meeting
--      room, weekday preset, first/last date).
--   3. New server-only tables: schedule_editions (terms), schedule_closures
--      (holidays), schedule_meeting_rooms (private Zoom details).
--   4. New functions: schedule_series_save, schedule_occurrences_sync,
--      schedule_occurrence_update, schedule_series_end. Conflicts raise AB409.
--   5. event_schedule_save_one_off is recreated (same signature, 044 behaviour) so
--      it also fills the owner columns.
--
-- Same access pattern as 043: RLS on, no policies, no grants to anon/authenticated,
-- service role only, no DELETE (tombstones keep ids permanent).
-- Meeting-room rows hold join links and passcodes: never selected by public queries.
-- Rollback: supabase/verify/rollback-064.sql (refuses once course data exists).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.event_series') is null or to_regclass('public.event_occurrences') is null then
    raise exception '064: needs 043 — stop';
  end if;
  if to_regclass('public.schedule_editions') is not null then
    raise exception '064: already applied — stop';
  end if;
end $$;

-- ── 1. New tables (the series will reference two of them) ────────────────────
create table public.schedule_editions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects (id) on delete restrict,
  -- null/null = the whole site's timetable; otherwise one course (or event).
  owner_type        text check (owner_type is null or owner_type in ('event', 'course')),
  owner_public_id   uuid,
  label             jsonb not null default '{}'::jsonb check (jsonb_typeof(label) = 'object' and length(label::text) <= 2000),
  starts_on         date not null,
  ends_on           date not null,
  time_zone         text not null check (length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'),
  version           integer not null default 1 check (version >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  removed_at        timestamptz,
  check (ends_on >= starts_on),
  check ((owner_type is null) = (owner_public_id is null)),
  unique (id, project_id)
);

comment on table public.schedule_editions is
  'ADR-038 A2 — a term / edition: the dates a timetable (or one course) runs. Server-only (service role). Tombstoned.';

create table public.schedule_closures (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  -- null = every series of the project; otherwise only series of that edition.
  edition_id    uuid,
  starts_on     date not null,
  ends_on       date not null,
  label         jsonb not null default '{}'::jsonb check (jsonb_typeof(label) = 'object' and length(label::text) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  removed_at    timestamptz,
  check (ends_on >= starts_on),
  unique (id, project_id),
  foreign key (edition_id, project_id) references public.schedule_editions (id, project_id) on delete restrict
);

comment on table public.schedule_closures is
  'ADR-038 A2 — holidays: dates on which no generated session takes place. Server-only (service role). Tombstoned.';

create table public.schedule_meeting_rooms (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete restrict,
  label         text not null check (length(label) between 1 and 80),
  join_url      text check (join_url is null or (join_url ~ '^https://' and length(join_url) <= 2000)),
  meeting_id    text check (meeting_id is null or length(meeting_id) <= 40),
  passcode      text check (passcode is null or length(passcode) <= 40),
  note          jsonb check (note is null or (jsonb_typeof(note) = 'object' and length(note::text) <= 4000)),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  removed_at    timestamptz,
  unique (id, project_id)
);

comment on table public.schedule_meeting_rooms is
  'ADR-045 — private online meeting details (join link, id, passcode). Server-only; read only by server code for '
  'authenticated dashboard users or Access-protected pages. Never returned by a public query.';

create index schedule_editions_project on public.schedule_editions (project_id) where removed_at is null;
create index schedule_closures_project on public.schedule_closures (project_id, starts_on) where removed_at is null;
create index schedule_meeting_rooms_project on public.schedule_meeting_rooms (project_id) where removed_at is null;

-- ── 2. Owners on series and occurrences (ADR-038 A1) ─────────────────────────
alter table public.event_series
  add column owner_type text not null default 'event',
  add column owner_public_id uuid;
alter table public.event_occurrences
  add column owner_type text not null default 'event',
  add column owner_public_id uuid;

update public.event_series set owner_public_id = event_public_id where owner_public_id is null;
update public.event_occurrences set owner_public_id = event_public_id where owner_public_id is null;

alter table public.event_series alter column owner_public_id set not null;
alter table public.event_occurrences alter column owner_public_id set not null;
alter table public.event_series alter column event_public_id drop not null;
alter table public.event_occurrences alter column event_public_id drop not null;

alter table public.event_series
  add constraint event_series_owner_type_check check (owner_type in ('event', 'course')),
  add constraint event_series_owner_event_check check (owner_type <> 'event' or (event_public_id is not null and event_public_id = owner_public_id)),
  add constraint event_series_owner_course_check check (owner_type <> 'course' or event_public_id is null);
alter table public.event_occurrences
  add constraint event_occurrences_owner_type_check check (owner_type in ('event', 'course')),
  add constraint event_occurrences_owner_event_check check (owner_type <> 'event' or (event_public_id is not null and event_public_id = owner_public_id)),
  add constraint event_occurrences_owner_course_check check (owner_type <> 'course' or event_public_id is null);

-- A session proves it belongs to the same project AND owner as its series.
-- (The 043 FK on event_public_id stays; a NULL column skips it for course rows.)
alter table public.event_series
  add constraint event_series_owner_key unique (id, project_id, owner_type, owner_public_id);
alter table public.event_occurrences
  add constraint event_occurrences_owner_fk foreign key (series_id, project_id, owner_type, owner_public_id)
    references public.event_series (id, project_id, owner_type, owner_public_id) on delete restrict;

create index event_series_owner on public.event_series (project_id, owner_type, owner_public_id) where removed_at is null;
create index event_occurrences_owner on public.event_occurrences (project_id, owner_type, owner_public_id, starts_at) where removed_at is null;

-- removed_reason gains 'closure' and 'series_ended' (the 043 check is replaced; found by definition, not by name).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.event_occurrences'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%rule_changed%'
  loop
    execute format('alter table public.event_occurrences drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.event_occurrences
  add constraint event_occurrences_removed_reason_check
  check (removed_reason is null or removed_reason in ('rule_changed', 'event_removed', 'series_removed', 'closure', 'series_ended'));

-- ── 3. New columns on series (repeating classes) ─────────────────────────────
alter table public.event_series
  add column edition_id uuid,
  add column languages text[] not null default '{}',
  add column meeting_room_id uuid,
  add column rule_weekday smallint,
  add column starts_on date,
  add column ends_on date;

alter table public.event_series
  add constraint event_series_edition_fk foreign key (edition_id, project_id)
    references public.schedule_editions (id, project_id) on delete restrict,
  add constraint event_series_meeting_room_fk foreign key (meeting_room_id, project_id)
    references public.schedule_meeting_rooms (id, project_id) on delete restrict,
  add constraint event_series_languages_check
    check (cardinality(languages) <= 6 and array_to_string(languages, ',') ~ '^([a-z]{2}(,[a-z]{2}){0,5})?$'),
  add constraint event_series_rule_weekday_check check (rule_weekday is null or rule_weekday between 1 and 7),
  add constraint event_series_span_check check (starts_on is null or ends_on is null or ends_on >= starts_on);

-- ── 4. Access: server-only ───────────────────────────────────────────────────
alter table public.schedule_editions enable row level security;
alter table public.schedule_closures enable row level security;
alter table public.schedule_meeting_rooms enable row level security;
revoke all on public.schedule_editions, public.schedule_closures, public.schedule_meeting_rooms from public, anon, authenticated, service_role;
grant select, insert, update on public.schedule_editions, public.schedule_closures, public.schedule_meeting_rooms to service_role;
-- No DELETE grant: rows are tombstoned (removed_at).

-- ── 5. Event one-off save: same as 044, also fills the owner columns ─────────
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
    insert into public.event_series (project_id, event_public_id, owner_type, owner_public_id, time_zone, start_local, end_local, place, attendance_mode, instructor_public_ids, origin, created_by)
    values (p_project_id, p_event_public_id, 'event', p_event_public_id, p_time_zone, p_start_local, p_end_local, p_place, coalesce(p_attendance_mode, 'inPerson'), coalesce(p_instructors, '{}'), coalesce(p_origin, 'dashboard'), p_actor)
    returning * into s;
    insert into public.event_occurrences (series_id, project_id, event_public_id, owner_type, owner_public_id, start_local, end_local, time_zone, starts_at, ends_at)
    values (s.id, s.project_id, s.event_public_id, 'event', s.event_public_id, p_start_local, p_end_local, p_time_zone, p_starts_at, p_ends_at)
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
    insert into public.event_occurrences (series_id, project_id, event_public_id, owner_type, owner_public_id, start_local, end_local, time_zone, starts_at, ends_at)
    values (s.id, s.project_id, s.event_public_id, 'event', s.event_public_id, p_start_local, p_end_local, p_time_zone, p_starts_at, p_ends_at)
    returning id into o_id;
  end if;

  return query select s.id, o_id, s.version;
end $$;

-- ── 6. Course schedule functions (one transaction per change) ────────────────
-- Create (p_series_id null) or update (version-checked) a series of an event or
-- a course. The owner of an existing series cannot change. A weekly class has
-- rule = 'FREQ=WEEKLY;INTERVAL=n;BYDAY=XX' and rule_weekday 1..7.
create function public.schedule_series_save(
  p_project_id        uuid,
  p_series_id         uuid,
  p_owner_type        text,
  p_owner_public_id   uuid,
  p_edition_id        uuid,
  p_time_zone         text,
  p_start_local       timestamp,
  p_end_local         timestamp,
  p_rule              text,
  p_rule_weekday      integer,
  p_starts_on         date,
  p_ends_on           date,
  p_place             jsonb,
  p_attendance_mode   text,
  p_instructors       uuid[],
  p_languages         text[],
  p_meeting_room_id   uuid,
  p_expected_version  integer,
  p_actor             uuid
)
returns table (series_id uuid, version integer)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  s public.event_series%rowtype;
begin
  if p_owner_type is null or p_owner_type not in ('event', 'course') or p_owner_public_id is null then
    raise exception 'schedule: invalid_owner' using errcode = '22023';
  end if;
  if p_edition_id is not null and not exists (
    select 1 from public.schedule_editions e where e.id = p_edition_id and e.project_id = p_project_id and e.removed_at is null
  ) then
    raise exception 'schedule: invalid_edition' using errcode = '22023';
  end if;
  if p_meeting_room_id is not null and not exists (
    select 1 from public.schedule_meeting_rooms m where m.id = p_meeting_room_id and m.project_id = p_project_id and m.removed_at is null
  ) then
    raise exception 'schedule: invalid_meeting_room' using errcode = '22023';
  end if;

  if p_series_id is null then
    if p_expected_version is not null then
      raise exception 'schedule: not_found' using errcode = 'P0002';
    end if;
    insert into public.event_series as es (
      project_id, event_public_id, owner_type, owner_public_id, edition_id, time_zone, start_local, end_local,
      rule, rule_weekday, starts_on, ends_on, place, attendance_mode, instructor_public_ids, languages, meeting_room_id, created_by)
    values (
      p_project_id, case when p_owner_type = 'event' then p_owner_public_id else null end, p_owner_type, p_owner_public_id,
      p_edition_id, p_time_zone, p_start_local, p_end_local,
      p_rule, p_rule_weekday::smallint, p_starts_on, p_ends_on, p_place, coalesce(p_attendance_mode, 'inPerson'),
      coalesce(p_instructors, '{}'), coalesce(p_languages, '{}'), p_meeting_room_id, p_actor)
    returning * into s;
    return query select s.id, s.version;
    return;
  end if;

  select * into s from public.event_series es
   where es.id = p_series_id and es.project_id = p_project_id and es.removed_at is null
   for update;
  if not found then
    raise exception 'schedule: not_found' using errcode = 'P0002';
  end if;
  if s.owner_type <> p_owner_type or s.owner_public_id <> p_owner_public_id then
    raise exception 'schedule: owner_cannot_change' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version <> s.version then
    raise exception 'schedule: version_conflict' using errcode = 'AB409';
  end if;

  update public.event_series es
     set edition_id = p_edition_id, time_zone = p_time_zone, start_local = p_start_local, end_local = p_end_local,
         rule = p_rule, rule_weekday = p_rule_weekday::smallint, starts_on = p_starts_on, ends_on = p_ends_on,
         place = p_place, attendance_mode = coalesce(p_attendance_mode, es.attendance_mode),
         instructor_public_ids = coalesce(p_instructors, es.instructor_public_ids),
         languages = coalesce(p_languages, es.languages), meeting_room_id = p_meeting_room_id,
         version = es.version + 1, updated_at = now()
   where es.id = s.id
   returning * into s;

  return query select s.id, s.version;
end $$;

-- Reconcile the generated sessions of a series from `p_from` on with the full
-- set the TypeScript expander produced (p_rows). p_closed lists the
-- original_start_local values the expander dropped because of a closure.
--   insert  : set rows with no live session of the same original_start_local
--   update  : times of existing NON-modified sessions that changed
--   remove  : NON-modified sessions at/after p_from that are not in the set
--             (reason 'closure' when listed in p_closed, else 'rule_changed')
-- Sessions before p_from and is_modified sessions are never touched.
create function public.schedule_occurrences_sync(
  p_project_id  uuid,
  p_series_id   uuid,
  p_from        timestamptz,
  p_rows        jsonb,
  p_closed      jsonb default '[]'::jsonb
)
returns table (inserted integer, updated integer, removed integer)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  s public.event_series%rowtype;
  closed_list timestamp[];
  n_ins integer;
  n_upd integer;
  n_rem integer;
begin
  if p_from is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception 'schedule: invalid_rows' using errcode = '22023';
  end if;
  if p_closed is null then p_closed := '[]'::jsonb; end if;
  if jsonb_typeof(p_closed) <> 'array' or jsonb_array_length(p_closed) > 1000 then
    raise exception 'schedule: invalid_rows' using errcode = '22023';
  end if;

  select * into s from public.event_series es
   where es.id = p_series_id and es.project_id = p_project_id and es.removed_at is null
   for update;
  if not found then
    raise exception 'schedule: not_found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(x::timestamp), '{}'::timestamp[]) into closed_list
    from jsonb_array_elements_text(p_closed) as x;

  with incoming as (
    select distinct on ((r->>'original_start_local')::timestamp)
           (r->>'original_start_local')::timestamp as original_start_local,
           (r->>'start_local')::timestamp          as start_local,
           nullif(r->>'end_local', '')::timestamp  as end_local,
           (r->>'starts_at')::timestamptz          as starts_at,
           nullif(r->>'ends_at', '')::timestamptz  as ends_at
      from jsonb_array_elements(p_rows) as r
     where (r->>'starts_at')::timestamptz >= p_from
  ),
  ins as (
    insert into public.event_occurrences as eo (
      series_id, project_id, event_public_id, owner_type, owner_public_id,
      original_start_local, start_local, end_local, time_zone, starts_at, ends_at)
    select s.id, s.project_id, s.event_public_id, s.owner_type, s.owner_public_id,
           i.original_start_local, i.start_local, i.end_local, s.time_zone, i.starts_at, i.ends_at
      from incoming i
     where not exists (
       select 1 from public.event_occurrences x
        where x.series_id = s.id and x.original_start_local = i.original_start_local and x.removed_at is null)
    returning 1
  ),
  upd as (
    update public.event_occurrences eo
       set start_local = i.start_local, end_local = i.end_local, time_zone = s.time_zone,
           starts_at = i.starts_at, ends_at = i.ends_at, version = eo.version + 1, updated_at = now()
      from incoming i
     where eo.series_id = s.id and eo.project_id = s.project_id and eo.removed_at is null
       and eo.is_modified = false and eo.original_start_local = i.original_start_local
       and eo.starts_at >= p_from
       and (eo.start_local is distinct from i.start_local or eo.end_local is distinct from i.end_local
            or eo.starts_at is distinct from i.starts_at or eo.ends_at is distinct from i.ends_at
            or eo.time_zone is distinct from s.time_zone)
    returning 1
  ),
  del as (
    update public.event_occurrences eo
       set removed_at = now(),
           removed_reason = case when eo.original_start_local = any (closed_list) then 'closure' else 'rule_changed' end,
           version = eo.version + 1, updated_at = now()
     where eo.series_id = s.id and eo.project_id = s.project_id and eo.removed_at is null
       and eo.is_modified = false and eo.original_start_local is not null
       and eo.starts_at >= p_from
       and not exists (select 1 from incoming i where i.original_start_local = eo.original_start_local)
    returning 1
  )
  select (select count(*) from ins)::integer, (select count(*) from upd)::integer, (select count(*) from del)::integer
    into n_ins, n_upd, n_rem;

  return query select n_ins, n_upd, n_rem;
end $$;

-- Edit ONE session: status, hosts, times, note. Times or hosts changing marks it
-- is_modified (the rule never overwrites it again). Returns the new version.
--   p_instructor_override : null = leave; array = set (empty array = nobody)
--   p_clear_instructor    : true = back to "same as the class"
--   p_start_local/p_starts_at come together (end may be null = no end)
--   p_note                : null = leave; p_clear_note true = remove
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
  p_clear_note           boolean
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

-- End a series: tombstone it and every session that has not started yet
-- ('series_ended'); past sessions stay. Returns how many sessions were removed.
create function public.schedule_series_end(
  p_project_id        uuid,
  p_series_id         uuid,
  p_expected_version  integer
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  s public.event_series%rowtype;
  n integer;
begin
  select * into s from public.event_series es
   where es.id = p_series_id and es.project_id = p_project_id and es.removed_at is null
   for update;
  if not found then
    raise exception 'schedule: not_found' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> s.version then
    raise exception 'schedule: version_conflict' using errcode = 'AB409';
  end if;

  update public.event_occurrences eo
     set removed_at = now(), removed_reason = 'series_ended', version = eo.version + 1, updated_at = now()
   where eo.series_id = s.id and eo.removed_at is null and eo.starts_at >= now();
  get diagnostics n = row_count;

  update public.event_series es
     set status = 'ended', removed_at = now(), version = es.version + 1, updated_at = now()
   where es.id = s.id;
  return n;
end $$;

revoke all on function public.schedule_series_save(uuid, uuid, text, uuid, uuid, text, timestamp, timestamp, text, integer, date, date, jsonb, text, uuid[], text[], uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.schedule_occurrences_sync(uuid, uuid, timestamptz, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.schedule_series_end(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.schedule_series_save(uuid, uuid, text, uuid, uuid, text, timestamp, timestamp, text, integer, date, date, jsonb, text, uuid[], text[], uuid, integer, uuid) to service_role;
grant execute on function public.schedule_occurrences_sync(uuid, uuid, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean) to service_role;
grant execute on function public.schedule_series_end(uuid, uuid, integer) to service_role;

-- ── 7. Self-check (any failure rolls the whole migration back) ───────────────
do $$
declare t text; f text;
begin
  foreach t in array array['event_series', 'event_occurrences', 'schedule_editions', 'schedule_closures', 'schedule_meeting_rooms'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '064 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
       or has_table_privilege('anon', format('public.%I', t), 'INSERT') then
      raise exception '064 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '064 self-check: % must have no policies', t;
    end if;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT') then
      raise exception '064 self-check: service_role cannot read %', t;
    end if;
    if has_table_privilege('service_role', format('public.%I', t), 'DELETE') then
      raise exception '064 self-check: % must not be deletable (permanent ids)', t;
    end if;
  end loop;
  if exists (select 1 from public.event_series where owner_public_id is null)
     or exists (select 1 from public.event_occurrences where owner_public_id is null) then
    raise exception '064 self-check: owner backfill incomplete';
  end if;
  if exists (select 1 from public.event_series where owner_type = 'event' and event_public_id is distinct from owner_public_id) then
    raise exception '064 self-check: event owners must mirror event_public_id';
  end if;
  foreach f in array array[
    'public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text)',
    'public.schedule_series_save(uuid, uuid, text, uuid, uuid, text, timestamp, timestamp, text, integer, date, date, jsonb, text, uuid[], text[], uuid, integer, uuid)',
    'public.schedule_occurrences_sync(uuid, uuid, timestamptz, jsonb, jsonb)',
    'public.schedule_occurrence_update(uuid, uuid, integer, text, uuid[], boolean, timestamp, timestamp, timestamptz, timestamptz, jsonb, boolean)',
    'public.schedule_series_end(uuid, uuid, integer)'
  ] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '064 self-check: % callable by API roles', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '064 self-check: service_role cannot call %', f;
    end if;
  end loop;
  if position('40001' in pg_get_functiondef('public.event_schedule_save_one_off(uuid, uuid, text, timestamp, timestamp, timestamptz, timestamptz, jsonb, text, uuid[], integer, uuid, text)'::regprocedure)) > 0 then
    raise exception '064 self-check: event_schedule_save_one_off still raises 40001';
  end if;
  raise notice '064 self-check passed';
end $$;

commit;

-- ============================================================
-- Migration 063 — People: private person data (ADR-043 D2)
--
-- ⚠️ NOT APPLIED. Order: (a) the code ships first and treats "table missing"
-- as "private section unavailable, everything else works"
-- (src/lib/api/persons-private.ts); (b) rehearse this file on the Abluo
-- Sandbox; (c) Tom approves; (d) Tom applies it in the SQL Editor, runs the
-- CHECK block at the end, and records it in supabase/APPLIED.md.
-- Purely additive: one new table (+ its updated_at trigger function), no
-- change to any existing object. Number 062 is reserved by Catalogue.
--
-- What it stores: the PRIVATE half of a person of the People module. The
-- public profile (names, photo, bios, public contacts, groups …) is the Sanity
-- `person` document; this row holds what must never sit where a website
-- query could project it:
--   contacts        private contact methods, same shape as Sanity's
--                   personContact: [{ _key, kind, value, label, preferred }]
--   birthday        optional, empty by default (the site's privacy policy
--                   must mention it when used)
--   notes           internal notes
--   linked_user_id  reserved for person self-service login (unused in V1)
-- Linked to Sanity by (project_id, person_public_id) — the person's immutable
-- `publicId` UUID, never its Sanity `_id`.
--
-- Server-only (ADR-038 D8 pattern): RLS on, no grants to anon/authenticated,
-- no policies; written and read with the service role behind the dashboard's
-- permission checks (assertModuleAction, people.person.*), every call scoped by
-- project_id. Optimistic concurrency on `version`.
--
-- Deleting: anonymise and permanent delete remove the row. Deleting a project
-- removes its rows (cascade): personal data does not outlive the website.
--
-- Rollback (refuses once rows exist):
--   begin;
--   do $$ begin
--     if exists (select 1 from public.person_private) then
--       raise exception 'rollback-063: person_private holds rows — refusing';
--     end if;
--   end $$;
--   drop table public.person_private;
--   drop function public.person_private_touch();
--   commit;
-- The code treats the missing table as "private section unavailable", so
-- rolling back never breaks the dashboard or the website.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.person_private') is not null then
    raise exception '063: already applied — stop';
  end if;
  if to_regclass('public.projects') is null then
    raise exception '063: public.projects is missing — wrong database?';
  end if;
end $$;

create table public.person_private (
  project_id        uuid not null references public.projects (id) on delete cascade,
  person_public_id  uuid not null,
  contacts          jsonb not null default '[]'::jsonb check (
                      jsonb_typeof(contacts) = 'array'
                      and jsonb_array_length(contacts) <= 20
                      and pg_column_size(contacts) < 16384),
  birthday          date,
  notes             text check (notes is null or length(notes) <= 5000),
  linked_user_id    uuid references auth.users (id) on delete set null,
  version           integer not null default 1 check (version >= 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (project_id, person_public_id)
);

comment on table public.person_private is
  'ADR-043 D2 — private data of a People-module person (private contacts, birthday, notes), keyed by (project_id, person_public_id = Sanity person.publicId). '
  'Server-only (service role). The public profile lives in Sanity.';

-- updated_at follows every change (the code also sets it; this is the guarantee).
create function public.person_private_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger person_private_touch
  before update on public.person_private
  for each row execute function public.person_private_touch();

-- ── Access: server-only ──────────────────────────────────────────────────────
alter table public.person_private enable row level security;
-- Supabase's default privileges give service_role ALL on a new public table;
-- take everything back from everyone, then grant only what the code needs.
revoke all on public.person_private from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.person_private to service_role;
revoke all on function public.person_private_touch() from public, anon, authenticated;

commit;

-- ============================================================
-- CHECK — run after applying (read-only). Every line must say what its
-- comment says; anything else: stop and tell Claude/Tom.
--
-- 1. The table exists and RLS is on, with NO policies:
--   select relrowsecurity from pg_class where oid = 'public.person_private'::regclass;      -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'person_private';  -- 0
--
-- 2. anon and authenticated hold NO privilege on it (empty result):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'person_private' and grantee in ('anon', 'authenticated', 'PUBLIC');
--
-- 3. service_role holds exactly SELECT, INSERT, UPDATE, DELETE:
--   select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'person_private' and grantee = 'service_role';
--   -- DELETE, INSERT, SELECT, UPDATE
--
-- 4. As the API roles, the table cannot be read or written (each statement must
--    FAIL with "permission denied for table person_private"; the transaction
--    is rolled back either way):
--   begin; set local role anon;          select * from public.person_private limit 1; rollback;
--   begin; set local role authenticated; select * from public.person_private limit 1; rollback;
--   begin; set local role anon;          insert into public.person_private (project_id, person_public_id) values (gen_random_uuid(), gen_random_uuid()); rollback;
--   begin; set local role authenticated; insert into public.person_private (project_id, person_public_id) values (gen_random_uuid(), gen_random_uuid()); rollback;
--
-- 5. Same check in one statement (true, true = no access at all):
--   select has_table_privilege('anon', 'public.person_private', 'select, insert, update, delete') = false as anon_blocked,
--          has_table_privilege('authenticated', 'public.person_private', 'select, insert, update, delete') = false as authenticated_blocked;
--
-- 6. Empty to start:
--   select count(*) from public.person_private;   -- 0
-- ============================================================

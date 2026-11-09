-- ============================================================
-- Migration 067 — Testimonials: private person data (ADR-048 D3)
--
-- ⚠️ NOT APPLIED. Order: (a) the code ships first and treats "table missing"
-- as "private section unavailable, everything else works"
-- (src/lib/api/testimonials-private.ts); (b) rehearse this file on the Abluo
-- Sandbox; (c) Tom approves; (d) Tom applies it in the SQL Editor, runs the
-- CHECK block at the end, and records it in supabase/APPLIED.md.
-- Purely additive: one new table (+ its updated_at trigger function), no
-- change to any existing object. Number 063 (People) is the model; 066 is
-- Reservations.
--
-- What it stores: the PRIVATE half of a testimonial. The public text (name as
-- shown, quote, rating, tags …) is the Sanity `testimonial` document; this row
-- holds who really said it, which must never sit where a website query could
-- project it:
--   full_name              the person's real name (the public name may be a
--                          nickname, initials or "anonymous")
--   email, phone           contact details, optional
--   note                   internal note
--   submission_id          the form submission this testimonial was created
--                          from (null for a testimonial typed in by hand).
--                          ON DELETE SET NULL: deleting the submission from the
--                          inbox must not delete the testimonial's record.
--   permission_given_at    when "permission to publish" was ticked (GDPR
--                          evidence; set by the server, never by the browser)
-- Linked to Sanity by (project_id, testimonial_public_id) — the testimonial's
-- immutable `publicId` UUID, never its Sanity `_id`.
--
-- Server-only (ADR-038 D8 / 063 pattern): RLS on, no grants to anon /
-- authenticated, no policies; written and read with the service role behind the
-- dashboard's permission checks (assertModuleAction, testimonials.private.read),
-- every call scoped by project_id. Optimistic concurrency on `version`.
--
-- Deleting: permanent delete of a testimonial removes the row. Deleting a
-- project removes its rows (cascade): personal data does not outlive the website.
--
-- Rollback (refuses once rows exist):
--   begin;
--   do $$ begin
--     if exists (select 1 from public.testimonial_private) then
--       raise exception 'rollback-067: testimonial_private holds rows — refusing';
--     end if;
--   end $$;
--   drop table public.testimonial_private;
--   drop function public.testimonial_private_touch();
--   commit;
-- The code treats the missing table as "private section unavailable", so
-- rolling back never breaks the dashboard or the website.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.testimonial_private') is not null then
    raise exception '067: already applied — stop';
  end if;
  if to_regclass('public.projects') is null then
    raise exception '067: public.projects is missing — wrong database?';
  end if;
  if to_regclass('public.form_submissions') is null then
    raise exception '067: public.form_submissions is missing — wrong database?';
  end if;
end $$;

create table public.testimonial_private (
  project_id             uuid not null references public.projects (id) on delete cascade,
  testimonial_public_id  uuid not null,
  full_name              text check (full_name is null or length(full_name) <= 200),
  email                  text check (email is null or length(email) <= 320),
  phone                  text check (phone is null or length(phone) <= 60),
  note                   text check (note is null or length(note) <= 5000),
  submission_id          uuid references public.form_submissions (id) on delete set null,
  permission_given_at    timestamptz,
  version                integer not null default 1 check (version >= 1),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (project_id, testimonial_public_id)
);

comment on table public.testimonial_private is
  'ADR-048 D3 — private data of a Testimonials-module testimonial (real name, email, phone, note, source submission, when permission to publish was given), keyed by (project_id, testimonial_public_id = Sanity testimonial.publicId). '
  'Server-only (service role). The public text lives in Sanity.';

-- Which testimonials came from a given submission (create-from-submission, inbox state).
create index testimonial_private_submission on public.testimonial_private (project_id, submission_id) where submission_id is not null;

-- updated_at follows every change (the code also sets it; this is the guarantee).
create function public.testimonial_private_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger testimonial_private_touch
  before update on public.testimonial_private
  for each row execute function public.testimonial_private_touch();

-- ── Access: server-only ──────────────────────────────────────────────────────
alter table public.testimonial_private enable row level security;
-- Supabase's default privileges give service_role ALL on a new public table;
-- take everything back from everyone, then grant only what the code needs.
revoke all on public.testimonial_private from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.testimonial_private to service_role;
revoke all on function public.testimonial_private_touch() from public, anon, authenticated;

commit;

-- ============================================================
-- CHECK — run after applying (read-only). Every line must say what its
-- comment says; anything else: stop and tell Claude/Tom.
--
-- 1. The table exists and RLS is on, with NO policies:
--   select relrowsecurity from pg_class where oid = 'public.testimonial_private'::regclass;      -- true
--   select count(*) from pg_policies where schemaname = 'public' and tablename = 'testimonial_private';  -- 0
--
-- 2. anon and authenticated hold NO privilege on it (empty result):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'testimonial_private' and grantee in ('anon', 'authenticated', 'PUBLIC');
--
-- 3. service_role holds exactly SELECT, INSERT, UPDATE, DELETE:
--   select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'testimonial_private' and grantee = 'service_role';
--   -- DELETE, INSERT, SELECT, UPDATE
--
-- 4. As the API roles, the table cannot be read or written (each statement must
--    FAIL with "permission denied for table testimonial_private"; the transaction
--    is rolled back either way):
--   begin; set local role anon;          select * from public.testimonial_private limit 1; rollback;
--   begin; set local role authenticated; select * from public.testimonial_private limit 1; rollback;
--   begin; set local role anon;          insert into public.testimonial_private (project_id, testimonial_public_id) values (gen_random_uuid(), gen_random_uuid()); rollback;
--   begin; set local role authenticated; insert into public.testimonial_private (project_id, testimonial_public_id) values (gen_random_uuid(), gen_random_uuid()); rollback;
--
-- 5. Same check in one statement (true, true = no access at all):
--   select has_table_privilege('anon', 'public.testimonial_private', 'select, insert, update, delete') = false as anon_blocked,
--          has_table_privilege('authenticated', 'public.testimonial_private', 'select, insert, update, delete') = false as authenticated_blocked;
--
-- 6. The submission link survives a deleted submission (on delete set null) and a deleted project cascades:
--   select confrelid::regclass as references_table, confdeltype from pg_constraint
--    where conrelid = 'public.testimonial_private'::regclass and contype = 'f' order by 1::text;
--   -- form_submissions → n (set null), projects → c (cascade)
--
-- 7. Empty to start:
--   select count(*) from public.testimonial_private;   -- 0
-- ============================================================

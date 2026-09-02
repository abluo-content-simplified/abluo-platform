-- ============================================================
-- Supabase auth-schema shim for local RLS verification.
--
-- Reproduces ONLY the subset of the real Supabase `auth` schema this
-- project's migrations (001–013, +014 draft) actually depend on:
--   - the `authenticated` / `anon` / `service_role` / `authenticator` roles
--   - `auth.users` (id, raw_user_meta_data, raw_app_meta_data — the columns
--     public.profiles/tenant_members/project_members FK against or that
--     handle_new_user() reads)
--   - `auth.uid()` / `auth.jwt()` / `auth.role()`, matching Supabase's
--     published implementation (reads `request.jwt.claims` from
--     `current_setting()`)
--
-- Applied ONCE, before schema.sql, to a disposable local `embedded-postgres`
-- instance. Never applied to any Supabase project.
-- ============================================================

-- ── Roles ─────────────────────────────────────────────────────────────────
-- Mirrors Supabase's role model: `authenticator` is the login role PostgREST
-- connects as and then SETs ROLE into per request; `anon`/`authenticated`/
-- `service_role` are the three request-time roles this project's policies
-- and grants are written against.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'postgres';
  end if;
  -- migration 006 grants to this role (the auth-hook execution identity).
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin noinherit createrole login password 'postgres';
  end if;
end
$$;

grant anon          to authenticator;
grant authenticated to authenticator;
grant service_role  to authenticator;

-- The harness connects as `postgres` (superuser) and uses SET ROLE directly
-- (see set_session_auth() below) rather than logging in as `authenticator`
-- over the network — SET ROLE requires postgres to be a member of the
-- target role.
grant anon          to postgres;
grant authenticated to postgres;
grant service_role  to postgres;


-- ── auth schema ───────────────────────────────────────────────────────────

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, postgres;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  raw_app_meta_data   jsonb not null default '{}'::jsonb,
  -- `invited_at` is a REAL GoTrue column (internal/models/user.go:
  --   InvitedAt *time.Time  db:"invited_at"). It is modelled here
  -- because migration 024 keys the membership-creation trigger off it.
  --
  -- CRITICAL ORDERING FACT (verified against GoTrue source, see migration
  -- 024's header): GoTrue does NOT set invited_at on the INSERT. The invite
  -- endpoint calls signupNewUser() -> INSERT (invited_at NULL), and only
  -- then sendInvite() sets it:
  --     u.InvitedAt = &now
  --     u.ConfirmationSentAt = &now
  --     tx.UpdateOnly(u, "confirmation_token", "confirmation_sent_at", "invited_at")
  -- i.e. a separate UPDATE, in the same transaction. Neither NewUser() nor
  -- NewUserWithPasswordHash() ever sets InvitedAt. Tests in
  -- live-rls.verify.mjs block (k) drive that exact INSERT-then-UPDATE
  -- sequence rather than a single INSERT carrying invited_at, because a
  -- single INSERT would be a shape GoTrue never produces.
  invited_at          timestamptz,
  created_at          timestamptz not null default now()
);

alter table auth.users add column if not exists invited_at timestamptz;

grant select on auth.users to authenticated, service_role;


-- ── auth.uid() / auth.jwt() / auth.role() ────────────────────────────────
-- Matches Supabase's published implementation: reads the `request.jwt.claims`
-- GUC set per-request by PostgREST (here, set manually by the test harness
-- via set_session_auth() below).

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select nullif(auth.jwt() ->> 'role', '')
$$;


-- ── Test-harness-only helper: simulate a login for this session ──────────
-- NOT part of the Supabase auth model — this is a verification-harness
-- convenience only, defined in the disposable local DB, never applied to a
-- real Supabase project. Sets both the Postgres role (governs GRANTs) and
-- the request.jwt.claims GUC (governs RLS policies' auth.uid()/auth.jwt()).

create or replace function public.set_session_auth(
  p_user_id uuid,
  p_role    text default 'authenticated',
  p_extra_claims jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
declare
  claims jsonb;
begin
  claims := jsonb_build_object('sub', p_user_id::text, 'role', p_role) || p_extra_claims;
  perform set_config('request.jwt.claims', claims::text, false);
  execute format('set role %I', p_role);
end;
$$;

-- Reset back to postgres/superuser between tests.
create or replace function public.reset_session_auth() returns void
language plpgsql
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', false);
end;
$$;

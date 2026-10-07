-- ============================================================
-- Migration 028 — security hardening (deterministic end state)
--
-- ⚠️ NOT APPLIED BY THE TASK THAT WROTE IT (2026-10-02). File only. Tom pastes
-- it into the Supabase SQL editor — see supabase/APPLY-2026-10-02.md.
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- The ledger (APPLIED.md) proved that what ran in production is not always
-- what is in the files (005/007/010/019). So this migration does not PATCH a
-- presumed state — it DECLARES the complete access-control end state for the
-- public schema and converges whatever is live onto it:
--
--   1. RLS enabled on EVERY table in `public`.
--   2. `anon` and PUBLIC hold NO privilege on ANY relation in `public`.
--      Public forms never need one: every write goes through a Next.js route
--      using the service-role client (runAsTrustedSystemOperation —
--      src/lib/forms/submissions.ts, src/lib/notifications/consumer.ts,
--      src/lib/translate/usage.ts). Live probe 2026-10-02 found anon still
--      held INSERT/UPDATE/DELETE on `project_members` (blocked only because
--      the policy happened to read `projects`) — removed here.
--   3. `authenticated` holds EXACTLY the grants the app uses with a user
--      session, and nothing else (no INSERT/DELETE anywhere; UPDATE only on
--      profiles.full_name and form_submissions.status).
--   4. Every policy on the nine app tables is dropped unless it is in the
--      canonical set below, and the canonical set is (re)created verbatim.
--      Anything added out-of-band is removed (listed via RAISE NOTICE).
--   5. Tenant data is PROJECT grain wherever the row has a project_id, via the
--      existing SECURITY DEFINER helpers (migration 007/013 convention).
--   6. Migration 025's abluo_admin READ-ONLY access — now gated on a 2FA
--      (aal2) session; APPLY ONLY AFTER the in-app MFA code is deployed to
--      production and Tom has enrolled a factor — rebuilt without `leads`
--      (026 dropped it — 025 as written would now FAIL on that line) and with
--      `translation_usage` (027) added. Do NOT paste 025 itself.
--   7. EXECUTE on every sensitive function revoked from anon and PUBLIC.
--   8. Default privileges: future tables/functions in `public` are NOT
--      auto-granted to anon (the class of drift that left project_members open).
--   9. A self-check that RAISES (and so rolls the whole thing back) if the
--      end state is not exactly right.
--
-- Supersedes (do NOT paste these): 014 (inquiries policies), 020 (leads — table
-- is gone), 025 (admin read). 010 must never be applied.
--
-- Idempotent: safe to run any number of times. One transaction.
-- Storage: no buckets exist (live check 2026-10-02) — nothing to do here.
-- ============================================================

begin;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.get_my_project_ids()') is null
     or to_regprocedure('public.get_my_writable_project_ids()') is null
     or to_regprocedure('public.get_my_tenant_ids()') is null
     or to_regprocedure('public.get_my_owned_tenant_ids()') is null then
    raise exception '028: authorization helpers (migrations 004/007) missing — stop';
  end if;
  if to_regclass('public.translation_usage') is null then
    raise exception '028: public.translation_usage missing — apply 027 first';
  end if;
  -- Added 2026-10-07: 030 replaced four of 028's policies with permission-based
  -- ones under the SAME names; re-running 028 would silently restore the weaker
  -- membership-based rules. Refuse instead.
  if to_regprocedure('public.get_my_project_ids_with(text)') is not null then
    raise exception '028: superseded by 030 for the contact-request policies — do not re-run 028';
  end if;
end $$;


-- ── 1 + 2 + 3a. Every relation in public: RLS on, strip anon/PUBLIC/authenticated ──
do $$
declare r record;
begin
  for r in
    select c.oid, c.relname, c.relkind
    from   pg_class c join pg_namespace n on n.oid = c.relnamespace
    where  n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  loop
    if r.relkind in ('r','p') then
      execute format('alter table public.%I enable row level security', r.relname);
    end if;
    execute format('revoke all on table public.%I from anon, public', r.relname);
    execute format('revoke all on table public.%I from authenticated', r.relname);
  end loop;

  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where  n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format('revoke all on sequence public.%I from anon, authenticated, public', r.relname);
  end loop;
end $$;

revoke create on schema public from public, anon, authenticated;


-- ── 3b. The exact authenticated grant set (what the app's session clients use) ──
grant select                on public.tenants           to authenticated;  -- 021
grant select                on public.projects          to authenticated;  -- 011
grant select                on public.tenant_members    to authenticated;  -- 011
grant select                on public.project_members   to authenticated;  -- 011
grant select                on public.profiles          to authenticated;  -- 015
grant update (full_name)    on public.profiles          to authenticated;  -- 012, invite/accept
grant select                on public.inquiries         to authenticated;  -- 014 (UPDATE dropped: no caller)
grant select                on public.form_submissions  to authenticated;  -- 016
grant update (status)       on public.form_submissions  to authenticated;  -- client-dashboard.ts updateSubmissionStatus
grant select                on public.form_events       to authenticated;  -- 017
grant select                on public.translation_usage to authenticated;  -- 027

-- service_role keeps full access (bypasses RLS; used by every server route).
grant all privileges on table
  public.tenants, public.projects, public.tenant_members, public.project_members,
  public.profiles, public.inquiries, public.form_submissions, public.form_events,
  public.translation_usage
to service_role;


-- ── 6a. is_abluo_admin() — reads only the signed JWT, touches no table ────────
-- Requires a 2FA session (JWT aal = 'aal2', set by Supabase Auth after an MFA
-- challenge) AND the admin flag — top-level claim written by
-- custom_access_token_hook (006) OR the app_metadata claim GoTrue always embeds.
-- Both flag sources come from raw_app_meta_data, which only the service role
-- can write; user_metadata is never read. A password-only (aal1) admin
-- session gets NO cross-tenant read.
create or replace function public.is_abluo_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and (   coalesce(auth.jwt() ->> 'platform_role', '') = 'abluo_admin'
          or coalesce(auth.jwt() -> 'app_metadata' ->> 'platform_role', '') = 'abluo_admin')
$$;

comment on function public.is_abluo_admin() is
  'Migration 028 (supersedes 025). True when the signed JWT has aal = aal2 '
  '(MFA-verified session) AND carries platform_role = abluo_admin, top-level (custom_access_token_hook) or in '
  'app_metadata (server-controlled). No table read, so it cannot cause RLS '
  'recursion. Used by SELECT policies only — never by a write policy.';


-- ── 4. Drop every policy on the app tables that is not canonical ─────────────
do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where  schemaname = 'public'
    and    tablename in ('tenants','projects','tenant_members','project_members','profiles',
                         'inquiries','form_submissions','form_events','translation_usage')
    and    (tablename, policyname) not in (
      ('tenants',           'Members can read their tenants'),
      ('tenants',           'Abluo admins read all tenants'),
      ('projects',          'Members can read their projects'),
      ('projects',          'Abluo admins read all projects'),
      ('tenant_members',    'Users can read their own memberships'),
      ('tenant_members',    'Owners can read members of their tenants'),
      ('tenant_members',    'Abluo admins read all tenant members'),
      ('project_members',   'Users can read their own project memberships'),
      ('project_members',   'Tenant owners can read members of their projects'),
      ('project_members',   'Abluo admins read all project members'),
      ('profiles',          'Users can read their own profile'),
      ('profiles',          'Users can update their own profile'),
      ('inquiries',         'Members read inquiries for their projects'),
      ('inquiries',         'Abluo admins read all inquiries'),
      ('form_submissions',  'Members read their project submissions'),
      ('form_submissions',  'Writable roles update their project submissions'),
      ('form_submissions',  'Abluo admins read all form submissions'),
      ('form_events',       'Members read their project form events'),
      ('form_events',       'Abluo admins read all form events'),
      ('translation_usage', 'Members read their project translation usage'),
      ('translation_usage', 'Abluo admins read all translation usage')
    )
  loop
    raise notice '028: dropping non-canonical policy "%" on public.%', r.policyname, r.tablename;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- ── 4b + 5. Canonical policy set (drop-if-exists + create = exact text) ─────
-- tenants
drop policy if exists "Members can read their tenants" on public.tenants;
create policy "Members can read their tenants" on public.tenants
  for select to authenticated
  using (id in (select public.get_my_tenant_ids()));

-- projects (a project row IS the project; tenant members see their tenant's projects)
drop policy if exists "Members can read their projects" on public.projects;
create policy "Members can read their projects" on public.projects
  for select to authenticated
  using (tenant_id in (select public.get_my_tenant_ids())
         or id in (select public.get_my_project_ids()));

-- tenant_members
drop policy if exists "Users can read their own memberships" on public.tenant_members;
create policy "Users can read their own memberships" on public.tenant_members
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Owners can read members of their tenants" on public.tenant_members;
create policy "Owners can read members of their tenants" on public.tenant_members
  for select to authenticated
  using (tenant_id in (select public.get_my_owned_tenant_ids()));

-- project_members
drop policy if exists "Users can read their own project memberships" on public.project_members;
create policy "Users can read their own project memberships" on public.project_members
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Tenant owners can read members of their projects" on public.project_members;
create policy "Tenant owners can read members of their projects" on public.project_members
  for select to authenticated
  using (project_id in (select p.id from public.projects p
                       where p.tenant_id in (select public.get_my_owned_tenant_ids())));

-- profiles (own row only)
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- inquiries — PROJECT grain; legacy rows with no project_id: tenant OWNERS only
drop policy if exists "Members read inquiries for their projects" on public.inquiries;
create policy "Members read inquiries for their projects" on public.inquiries
  for select to authenticated
  using (
    (project_id is not null and project_id in (select public.get_my_project_ids()))
    or
    (project_id is null and tenant_id is not null
       and tenant_id in (select public.get_my_owned_tenant_ids()))
  );

-- form_submissions
drop policy if exists "Members read their project submissions" on public.form_submissions;
create policy "Members read their project submissions" on public.form_submissions
  for select to authenticated
  using (project_id in (select public.get_my_project_ids()));

drop policy if exists "Writable roles update their project submissions" on public.form_submissions;
create policy "Writable roles update their project submissions" on public.form_submissions
  for update to authenticated
  using      (project_id in (select public.get_my_writable_project_ids()))
  with check (project_id in (select public.get_my_writable_project_ids()));

-- form_events
drop policy if exists "Members read their project form events" on public.form_events;
create policy "Members read their project form events" on public.form_events
  for select to authenticated
  using (project_id in (select public.get_my_project_ids()));

-- translation_usage
drop policy if exists "Members read their project translation usage" on public.translation_usage;
create policy "Members read their project translation usage" on public.translation_usage
  for select to authenticated
  using (project_id in (select public.get_my_project_ids()));

-- 6b. abluo_admin READ-ONLY, every app table except profiles (as 025)
drop policy if exists "Abluo admins read all tenants"           on public.tenants;
drop policy if exists "Abluo admins read all projects"          on public.projects;
drop policy if exists "Abluo admins read all tenant members"    on public.tenant_members;
drop policy if exists "Abluo admins read all project members"   on public.project_members;
drop policy if exists "Abluo admins read all inquiries"         on public.inquiries;
drop policy if exists "Abluo admins read all form submissions"  on public.form_submissions;
drop policy if exists "Abluo admins read all form events"       on public.form_events;
drop policy if exists "Abluo admins read all translation usage" on public.translation_usage;
create policy "Abluo admins read all tenants"           on public.tenants           for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all projects"          on public.projects          for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all tenant members"    on public.tenant_members    for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all project members"   on public.project_members   for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all inquiries"         on public.inquiries         for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all form submissions"  on public.form_submissions  for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all form events"       on public.form_events       for select to authenticated using (public.is_abluo_admin());
create policy "Abluo admins read all translation usage" on public.translation_usage for select to authenticated using (public.is_abluo_admin());


-- ── 7. Functions: nothing sensitive is executable by anon / PUBLIC ───────────
do $$
declare
  f text;
begin
  -- RLS helpers: authenticated must keep EXECUTE (policies call them as the
  -- session role). anon has no table grant, so it never needs them.
  foreach f in array array[
    'public.get_my_tenant_ids()',
    'public.get_my_writable_tenant_ids()',
    'public.get_my_owned_tenant_ids()',
    'public.get_my_project_ids()',
    'public.get_my_writable_project_ids()',
    'public.is_abluo_admin()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;

  -- Server-only.
  if to_regprocedure('public.translation_usage_month_total(uuid,timestamptz)') is not null then
    revoke all on function public.translation_usage_month_total(uuid, timestamptz) from public, anon, authenticated;
    grant execute on function public.translation_usage_month_total(uuid, timestamptz) to service_role;
  end if;

  -- Auth hook: only the auth server.
  if to_regprocedure('public.custom_access_token_hook(jsonb)') is not null then
    revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;

  -- Trigger functions: EXECUTE is checked only at CREATE TRIGGER, never at
  -- fire time, so revoking does not affect the triggers. Nobody calls them directly.
  foreach f in array array[
    'public.handle_new_user()',
    'public.handle_user_invited()',
    'public.set_updated_at()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;


-- ── 8. Default privileges for objects created later by this role ─────────────
alter default privileges in schema public revoke all     on tables    from anon, authenticated, public;
alter default privileges in schema public revoke all     on sequences from anon, authenticated, public;
alter default privileges in schema public revoke execute on functions from anon, public;
alter default privileges in schema public grant  execute on functions to authenticated, service_role;
alter default privileges in schema public grant  all     on tables    to service_role;
alter default privileges in schema public grant  all     on sequences to service_role;


-- ── 9. Self-check — any violation RAISES and rolls back the whole migration ──
do $$
declare
  bad text;
begin
  -- 9a. RLS on every table in public.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  if bad is not null then raise exception '028 self-check: RLS disabled on %', bad; end if;

  -- 9b. anon: no privilege of any kind on any relation in public (table or column level).
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  and ( has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'));
  if bad is not null then raise exception '028 self-check: anon still has privileges on %', bad; end if;

  -- 9c. authenticated: SELECT only on the nine app tables; no INSERT/DELETE/
  --     TRUNCATE anywhere; table-level UPDATE nowhere.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  and ( has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('authenticated', c.oid, 'INSERT,REFERENCES')
     or (has_any_column_privilege('authenticated', c.oid, 'SELECT')
         and c.relname not in ('tenants','projects','tenant_members','project_members','profiles',
                               'inquiries','form_submissions','form_events','translation_usage')));
  if bad is not null then raise exception '028 self-check: authenticated over-granted on %', bad; end if;

  -- 9d. column UPDATE only where intended (read from pg_attribute.attacl, so
  --     it does not depend on which roles the SQL-editor user is a member of).
  select string_agg(c.relname || '.' || a.attname, ', ') into bad
  from pg_attribute a
  join pg_class c     on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(a.attacl) x
  where n.nspname = 'public' and a.attacl is not null
  and x.privilege_type = 'UPDATE'
  and x.grantee in ('authenticated'::regrole::oid, 0::oid)
  and (c.relname::text, a.attname::text) not in (('profiles','full_name'), ('form_submissions','status'));
  if bad is not null then raise exception '028 self-check: unexpected column UPDATE grant on %', bad; end if;

  -- 9e. No SECURITY DEFINER function in public callable by anon (trigger /
  --     event-trigger functions excluded: they cannot be invoked directly;
  --     extension-owned functions excluded).
  select string_agg(p.oid::regprocedure::text, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
  and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                  and d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('anon', p.oid, 'EXECUTE');
  if bad is not null then raise exception '028 self-check: anon can execute SECURITY DEFINER %', bad; end if;

  -- 9f. The admin identity is READ-ONLY: no write policy references is_abluo_admin().
  select string_agg(tablename || ':' || policyname, ', ') into bad
  from pg_policies
  where schemaname = 'public' and cmd <> 'SELECT'
  and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%is_abluo_admin%';
  if bad is not null then raise exception '028 self-check: write policy uses is_abluo_admin: %', bad; end if;

  raise notice '028 self-check passed';
end $$;

commit;


-- ── Rollback (see APPLY-2026-10-02.md for the full procedure) ────────────────
-- 028 only removes access; it never drops data. To return to the pre-028
-- state, restore the grants/policies listed in APPLY-2026-10-02.md §Rollback.

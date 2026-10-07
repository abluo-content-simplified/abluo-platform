-- ============================================================
-- Migration 029 — roles, extras, invitations (ADR-028 Migration step 2)
--
-- ⚠️ NOT APPLIED BY THE SESSION THAT WROTE IT (2026-10-07). File only.
-- Tom applies it in the Supabase SQL editor after a rollback snapshot
-- (supabase/verify/rollback-snapshot-028.sql works unchanged) and verifies
-- with supabase/verify/post-apply-029.sql. Record the result in APPLIED.md.
--
-- Proven against a real Postgres in the production shape (… 027 + 028):
--   cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-029.verify.mjs
-- (19 checks: role values, extras validation, last-Owner guard incl. tenant
-- cascade, invitation shape, server-only tables, Site admin write scope).
--
-- ⚠️ One consequence to know: deleting an auth user who is the LAST Owner of
-- a client is refused by the last-Owner guard. Add another Owner (or delete
-- the client) first.
--
-- ── What it does — ADDITIVE ONLY ──────────────────────────────────────────
-- Nothing that exists today changes meaning. No row is modified. No
-- existing grant or policy is widened. The application keeps working before
-- and after, with or without the code that uses these objects.
--
--   1. grantable_permissions — the closed list of permissions that may be
--      given as an extra (mirrors src/lib/authz/permissions.ts; a test keeps
--      the two equal).
--   2. extra_permissions text[] on tenant_members and project_members,
--      default '{}', validated by a trigger against (1): unknown ids,
--      wrong-scope ids and a dependent extra without its prerequisite are
--      REJECTED at write time.
--   3. New role values ACCEPTED (not used yet): tenant 'member', project
--      'admin' (Site admin). Legacy 'editor'/'viewer' stay accepted until
--      ADR-028 Migration step 4 reviews the existing rows.
--      tenant_members.role loses its DEFAULT 'owner' — a membership row must
--      always name its role; nothing may become an Owner by omission.
--   4. get_my_writable_project_ids() also covers a Site admin ('admin').
--   5. Last-Owner guard: a trigger refuses to delete or demote the last
--      Owner of a tenant (deleting the tenant itself still cascades).
--   6. invitations — records until accepted (ADR-028 §6), server-only.
--
-- ── Security posture (unchanged from 028) ────────────────────────────────
-- The new tables get RLS ON and NO grant and NO policy for anon or
-- authenticated: only server routes (service role) read or write them.
-- The self-check at the end re-asserts 028's invariants plus the new ones
-- and rolls the whole migration back if anything is off.
--
-- ⚠️ After 029, re-running 028 is still safe for 028's nine tables, but 028's
-- self-check knows nothing of the new tables; it does not grant on them, so
-- it stays green. Do not paste 010/014/020/025.
-- ============================================================

begin;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.is_abluo_admin()') is null then
    raise exception '029: migration 028 is not applied (is_abluo_admin missing) — apply 028 first';
  end if;
  if to_regprocedure('public.get_my_writable_project_ids()') is null
     or to_regprocedure('public.get_my_owned_tenant_ids()') is null then
    raise exception '029: authorization helpers missing — stop';
  end if;
  if to_regclass('public.invitations') is not null or to_regclass('public.grantable_permissions') is not null then
    raise exception '029: already applied (invitations / grantable_permissions exist) — stop';
  end if;
end $$;


-- ── 1. grantable_permissions ─────────────────────────────────────────────────
create table public.grantable_permissions (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  applies_to  text not null check (applies_to in ('tenant', 'project')),
  requires    text references public.grantable_permissions (id),
  description text not null
);

comment on table public.grantable_permissions is
  'ADR-028 §3 — the closed list of permissions that may be given to a person as an EXTRA on a '
  'membership. applies_to = tenant: only on tenant_members. applies_to = project: on project_members, '
  'or on tenant_members where it then applies to every project of the tenant. Mirrors '
  'src/lib/authz/permissions.ts (test: grantable-catalog.test.ts). Server-only: no grants.';

insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('billing.invoice.read',    'tenant',  null,                    'See the client''s invoices.'),
  ('forms.submission.read',   'project', null,                    'See contact requests (form submissions).'),
  ('forms.submission.update', 'project', 'forms.submission.read', 'Change the status of contact requests.');

alter table public.grantable_permissions enable row level security;
revoke all on table public.grantable_permissions from anon, authenticated, public;


-- ── 2. extra_permissions + validation ───────────────────────────────────────
alter table public.tenant_members  add column extra_permissions text[] not null default '{}';
alter table public.project_members add column extra_permissions text[] not null default '{}';

comment on column public.tenant_members.extra_permissions is
  'ADR-028 §3 — permissions added on top of the role. Only ids from grantable_permissions. '
  'Project-scoped ids here apply to every project of the tenant. Additive only: never removes a role default.';
comment on column public.project_members.extra_permissions is
  'ADR-028 §3 — permissions added on top of the role, for this project only. Only project-scoped ids '
  'from grantable_permissions. Additive only.';

create function public.validate_extra_permissions(p_extras text[], p_scope text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id   text;
  v_def  record;
begin
  if p_extras is null then
    raise exception 'extra_permissions must not be null' using errcode = '23502';
  end if;
  if cardinality(p_extras) <> cardinality(array(select distinct unnest(p_extras))) then
    raise exception 'extra_permissions contains duplicates: %', p_extras using errcode = '23514';
  end if;
  foreach v_id in array p_extras loop
    select applies_to, requires into v_def from public.grantable_permissions where id = v_id;
    if not found then
      raise exception 'extra permission "%" is not grantable', v_id using errcode = '23514';
    end if;
    if p_scope = 'project' and v_def.applies_to <> 'project' then
      raise exception 'extra permission "%" cannot be given on a project membership', v_id using errcode = '23514';
    end if;
    if v_def.requires is not null and not (v_def.requires = any (p_extras)) then
      raise exception 'extra permission "%" requires "%" in the same membership', v_id, v_def.requires using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function public.tg_validate_member_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.validate_extra_permissions(
    new.extra_permissions,
    case tg_table_name when 'project_members' then 'project' else 'tenant' end
  );
  return new;
end;
$$;

create trigger tenant_members_validate_extras
  before insert or update of extra_permissions on public.tenant_members
  for each row execute function public.tg_validate_member_extras();
create trigger project_members_validate_extras
  before insert or update of extra_permissions on public.project_members
  for each row execute function public.tg_validate_member_extras();

revoke all on function public.validate_extra_permissions(text[], text) from public, anon, authenticated;
revoke all on function public.tg_validate_member_extras() from public, anon, authenticated;


-- ── 3. Role values ───────────────────────────────────────────────────────────
-- The original CHECKs were unnamed and the live catalog has drifted from the
-- files before (APPLIED.md), so every CHECK on the role column is found and
-- replaced by name-independent lookup.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname
    from   pg_constraint c
    where  c.contype = 'c'
    and    c.conrelid in ('public.tenant_members'::regclass, 'public.project_members'::regclass)
    and    pg_get_constraintdef(c.oid) ilike '%role%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.tenant_members
  add constraint tenant_members_role_check
  check (role in ('owner', 'member', 'editor', 'viewer'));   -- editor/viewer: legacy, reviewed in step 4
alter table public.project_members
  add constraint project_members_role_check
  check (role in ('admin', 'editor', 'viewer'));             -- viewer: legacy, never granted again

alter table public.tenant_members alter column role drop default;

comment on column public.tenant_members.role is
  'ADR-028 — owner: full control of the client (every project, people, billing). member: no default '
  'permissions, carries extras only (e.g. invoices). editor/viewer: legacy values, to be reviewed and removed.';
comment on column public.project_members.role is
  'ADR-028 — admin (Site admin): full control of this project, may invite Editors. editor: write, '
  'publish, take offline. viewer: retired, never granted again.';


-- ── 4. Writable projects include Site admins ─────────────────────────────────
create or replace function public.get_my_writable_project_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select id
  from   public.projects
  where  tenant_id in (select public.get_my_owned_tenant_ids())

  union

  select project_id
  from   public.project_members
  where  user_id = auth.uid()
  and    role    in ('editor', 'admin')
$$;

revoke all on function public.get_my_writable_project_ids() from public, anon;
grant execute on function public.get_my_writable_project_ids() to authenticated;


-- ── 5. Last-Owner guard ──────────────────────────────────────────────────────
create function public.tg_keep_one_tenant_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.tenant_id = old.tenant_id then
    return new;
  end if;
  -- The tenant itself is being deleted (FK cascade): nothing to protect.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return coalesce(new, old);
  end if;
  -- Serialize owner changes per tenant so two concurrent demotions cannot both pass.
  perform 1 from public.tenants where id = old.tenant_id for update;
  if not exists (
    select 1 from public.tenant_members
    where  tenant_id = old.tenant_id and role = 'owner' and id <> old.id
  ) then
    raise exception 'a client must always have at least one Owner (tenant %)', old.tenant_id
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger tenant_members_keep_one_owner
  before update of role, tenant_id or delete on public.tenant_members
  for each row execute function public.tg_keep_one_tenant_owner();

revoke all on function public.tg_keep_one_tenant_owner() from public, anon, authenticated;


-- ── 6. invitations ───────────────────────────────────────────────────────────
create table public.invitations (
  id                uuid        primary key default gen_random_uuid(),
  email             text        not null check (email = lower(btrim(email)) and email like '%_@_%'),
  scope_type        text        not null check (scope_type in ('tenant', 'project')),
  tenant_id         uuid        references public.tenants (id)  on delete cascade,
  project_id        uuid        references public.projects (id) on delete cascade,
  role              text        not null,
  extra_permissions text[]      not null default '{}',
  invited_by        uuid        references auth.users (id) on delete set null,
  token_hash        text        not null unique check (length(token_hash) >= 43),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '14 days'),
  accepted_at       timestamptz,
  accepted_by       uuid        references auth.users (id) on delete set null,
  revoked_at        timestamptz,
  revoked_by        uuid        references auth.users (id) on delete set null,

  constraint invitations_scope_target check (
       (scope_type = 'tenant'  and tenant_id is not null and project_id is null and role in ('owner', 'member'))
    or (scope_type = 'project' and project_id is not null and tenant_id is null and role in ('admin', 'editor'))
  ),
  constraint invitations_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  ),
  constraint invitations_single_outcome check (not (accepted_at is not null and revoked_at is not null)),
  constraint invitations_accept_complete check ((accepted_at is null) = (accepted_by is null))
);

comment on table public.invitations is
  'ADR-028 §6 — an invitation is a record until accepted. One accept flow for new and existing accounts. '
  'Only a hash of the link token is stored. No-escalation is checked by the server at creation AND at '
  'acceptance. Server-only: RLS on, no grants, no policies.';
comment on column public.invitations.token_hash is
  'SHA-256 (base64url) of the random token in the email link. The token itself is never stored.';

create unique index invitations_one_pending_per_tenant
  on public.invitations (tenant_id, email)
  where scope_type = 'tenant' and accepted_at is null and revoked_at is null;
create unique index invitations_one_pending_per_project
  on public.invitations (project_id, email)
  where scope_type = 'project' and accepted_at is null and revoked_at is null;
create index invitations_email_idx on public.invitations (email);

create function public.tg_validate_invitation_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.validate_extra_permissions(new.extra_permissions, new.scope_type);
  return new;
end;
$$;

create trigger invitations_validate_extras
  before insert or update of extra_permissions, scope_type on public.invitations
  for each row execute function public.tg_validate_invitation_extras();

revoke all on function public.tg_validate_invitation_extras() from public, anon, authenticated;

alter table public.invitations enable row level security;
revoke all on table public.invitations from anon, authenticated, public;
grant all privileges on table public.invitations, public.grantable_permissions to service_role;


-- ── 7. Self-check — any failure raises and rolls everything back ────────────
do $$
declare bad text;
begin
  -- 028 invariants still hold.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
  if bad is not null then raise exception '029 self-check: RLS disabled on %', bad; end if;

  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  and ( has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'));
  if bad is not null then raise exception '029 self-check: anon has privileges on %', bad; end if;

  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
  and ( has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('authenticated', c.oid, 'INSERT,REFERENCES')
     or (has_any_column_privilege('authenticated', c.oid, 'SELECT')
         and c.relname not in ('tenants','projects','tenant_members','project_members','profiles',
                               'inquiries','form_submissions','form_events','translation_usage')));
  if bad is not null then raise exception '029 self-check: authenticated over-granted on %', bad; end if;

  -- New tables: no policy at all (server-only).
  select string_agg(tablename || ':' || policyname, ', ') into bad
  from pg_policies where schemaname = 'public' and tablename in ('invitations', 'grantable_permissions');
  if bad is not null then raise exception '029 self-check: unexpected policy %', bad; end if;

  -- New SECURITY DEFINER / helper functions not callable by anon or authenticated.
  if has_function_privilege('anon', 'public.validate_extra_permissions(text[], text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.validate_extra_permissions(text[], text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.tg_keep_one_tenant_owner()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_my_writable_project_ids()', 'EXECUTE') then
    raise exception '029 self-check: new function executable by anon/authenticated';
  end if;

  -- Triggers and constraints present.
  if (select count(*) from pg_trigger where not tgisinternal and tgname in (
        'tenant_members_validate_extras', 'project_members_validate_extras',
        'tenant_members_keep_one_owner', 'invitations_validate_extras')) <> 4 then
    raise exception '029 self-check: a trigger is missing';
  end if;
  if (select count(*) from public.grantable_permissions) <> 3 then
    raise exception '029 self-check: grantable_permissions seed incomplete';
  end if;

  -- Existing rows untouched and valid under the new constraints (no data was changed).
  if exists (select 1 from public.tenant_members  where extra_permissions <> '{}')
     or exists (select 1 from public.project_members where extra_permissions <> '{}') then
    raise exception '029 self-check: unexpected extra_permissions on existing rows';
  end if;

  raise notice '029 self-check passed';
end $$;

commit;

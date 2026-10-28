-- Migration 056 — Transfer ownership of a client (PLAT-2, ADR-028)
--
-- Tom (2026-10-28): an Owner (or a Super Admin) can make an existing member of
-- the client an Owner, and optionally step down to Site admin on every site of
-- the client — what was done by hand for Hoffmann on 2026-10-21.
--
-- One function, one transaction, so the role changes land together or not at
-- all:
--   1. the new Owner must already be in the client: a tenant_members row
--      (Member) or a project_members row on one of the client's projects;
--      otherwise NOTHING is written (`ownership:not_member`);
--   2. their tenant row becomes 'owner' (inserted if they only had site
--      access); their now-redundant site rows on this client go, because an
--      Owner reaches every site of the client;
--   3. optionally ONE current Owner steps down: tenant row → 'member', and
--      'admin' (Site admin) on every project of the client (existing site rows
--      are raised to admin, extras kept);
--   4. the client is never left without an Owner — the new Owner exists
--      before anyone steps down, the last-Owner trigger of 029 still guards
--      every write, and the function re-asserts it at the end;
--   5. access history (049): one `owner.transfer` row per project for the new
--      Owner and one `owner.step_down` row per project for the person who
--      stepped down — roles only, never emails.
--
-- Who may call it is decided by the app (src/lib/people/ownership.ts): an
-- Owner of this client, or a Super Admin with a two-factor session; never a
-- support visit. The function is service-role only.
--
-- Additive and safe before the code: nothing calls it until the PLAT-2 code
-- ships, and that code fails closed ("needs database update 056") until it is
-- applied. Needs 029 (roles, last-Owner guard) and 049 (access_audit_log).
-- Proven by supabase/verify/hardening-056.verify.mjs.
-- Rollback: supabase/verify/rollback-056.sql.

begin;

do $$
begin
  if to_regprocedure('public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)') is not null then
    raise exception '056 already applied';
  end if;
  if to_regprocedure('public.tg_keep_one_tenant_owner()') is null then
    raise exception '056 needs 029 first (last-Owner guard missing)';
  end if;
  if to_regclass('public.access_audit_log') is null then
    raise exception '056 needs 049 first (access_audit_log missing)';
  end if;
end $$;

-- ── Access history: two new actions ──────────────────────────────────────────
-- 049's CHECK is unnamed in the file; find it by definition, not by name.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.access_audit_log'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%action%'
  loop
    execute format('alter table public.access_audit_log drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.access_audit_log
  add constraint access_audit_log_action_check
  check (action in ('member.change', 'member.archive', 'member.restore', 'owner.transfer', 'owner.step_down'));


-- ── Transfer ─────────────────────────────────────────────────────────────────
create function public.tenant_transfer_ownership(
  p_tenant_id  uuid,
  p_new_owner  uuid,
  p_actor      uuid,
  p_step_down  uuid,
  p_by_admin   boolean
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owners        uuid[];
  v_projects      uuid[];
  v_audit_targets uuid[];
  v_tenant_row    uuid;
  v_tenant_role   text;
  v_site_roles    jsonb;
  v_down_roles    jsonb;
  v_extra         jsonb := case when p_by_admin then '{"byAdmin": true}'::jsonb else '{}'::jsonb end;
begin
  if p_tenant_id is null or p_new_owner is null or p_actor is null
     or (p_step_down is not null and p_step_down = p_new_owner) then
    raise exception 'ownership:invalid';
  end if;

  -- Serialize ownership changes per client (the 029 trigger locks the same row).
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'ownership:not_found'; end if;

  select coalesce(array_agg(user_id order by user_id), '{}') into v_owners
    from public.tenant_members where tenant_id = p_tenant_id and role = 'owner';
  if p_new_owner = any (v_owners) then raise exception 'ownership:already_owner'; end if;
  if p_step_down is not null and not (p_step_down = any (v_owners)) then raise exception 'ownership:not_owner'; end if;

  select coalesce(array_agg(id order by id), '{}') into v_projects
    from public.projects where tenant_id = p_tenant_id;

  select id, role into v_tenant_row, v_tenant_role
    from public.tenant_members where tenant_id = p_tenant_id and user_id = p_new_owner for update;
  select coalesce(jsonb_object_agg(project_id::text, role), '{}'::jsonb) into v_site_roles
    from public.project_members where user_id = p_new_owner and project_id = any (v_projects);

  -- 1. Already in the client — or nothing is written.
  if v_tenant_row is null and v_site_roles = '{}'::jsonb then
    raise exception 'ownership:not_member';
  end if;

  -- 2. The new Owner.
  if v_tenant_row is null then
    insert into public.tenant_members (tenant_id, user_id, role, extra_permissions)
    values (p_tenant_id, p_new_owner, 'owner', '{}');
  else
    update public.tenant_members set role = 'owner', extra_permissions = '{}' where id = v_tenant_row;
  end if;
  delete from public.project_members where user_id = p_new_owner and project_id = any (v_projects);

  -- 3. Optional step-down of one current Owner: Member of the client, Site admin everywhere.
  if p_step_down is not null then
    select coalesce(jsonb_object_agg(project_id::text, role), '{}'::jsonb) into v_down_roles
      from public.project_members where user_id = p_step_down and project_id = any (v_projects);
    update public.tenant_members set role = 'member', extra_permissions = '{}'
     where tenant_id = p_tenant_id and user_id = p_step_down;
    insert into public.project_members (project_id, user_id, role, extra_permissions)
    select pid, p_step_down, 'admin', '{}' from unnest(v_projects) as pid
    on conflict (project_id, user_id) do update set role = 'admin';
  end if;

  -- 4. Never without an Owner (belt and braces: the 029 trigger already refuses).
  if not exists (select 1 from public.tenant_members where tenant_id = p_tenant_id and role = 'owner') then
    raise exception 'ownership:no_owner';
  end if;

  -- 5. Access history — one row per site (a client without sites still gets one row).
  v_audit_targets := case when cardinality(v_projects) = 0 then array[null::uuid] else v_projects end;
  insert into public.access_audit_log (actor_id, subject_user_id, project_id, action, detail)
  select p_actor, p_new_owner, pid, 'owner.transfer',
         jsonb_build_object('tenantId', p_tenant_id, 'roleBefore', coalesce(v_tenant_role, 'none'),
                            'siteRoleBefore', v_site_roles ->> pid::text, 'role', 'owner',
                            'steppedDown', p_step_down is not null) || v_extra
    from unnest(v_audit_targets) as pid;
  if p_step_down is not null then
    insert into public.access_audit_log (actor_id, subject_user_id, project_id, action, detail)
    select p_actor, p_step_down, pid, 'owner.step_down',
           jsonb_build_object('tenantId', p_tenant_id, 'roleBefore', 'owner', 'role', 'member',
                              'siteRoleBefore', v_down_roles ->> pid::text,
                              'siteRole', case when pid is null then null else 'admin' end) || v_extra
      from unnest(v_audit_targets) as pid;
  end if;

  return jsonb_build_object(
    'tenantId', p_tenant_id,
    'newOwner', p_new_owner,
    'steppedDown', p_step_down,
    'ownersBefore', to_jsonb(v_owners),
    'projectIds', to_jsonb(v_projects)
  );
end $$;

revoke all on function public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean) to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)', 'EXECUTE') then
    raise exception '056 self-check: transfer reachable by anon/authenticated';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tenant_members_keep_one_owner' and not tgisinternal) then
    raise exception '056 self-check: last-Owner trigger missing';
  end if;
  raise notice '056 self-check passed';
end $$;

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   select has_function_privilege('anon', 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)', 'EXECUTE');           -- false
--   select has_function_privilege('authenticated', 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)', 'EXECUTE');  -- false
--   select has_function_privilege('service_role', 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)', 'EXECUTE');   -- true
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'access_audit_log_action_check';  -- includes owner.transfer, owner.step_down

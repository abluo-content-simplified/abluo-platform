-- ROLLBACK for migration 029 — ONLY if 029 must be undone. Not read-only.
-- Removes every object 029 added and restores the previous role CHECKs and
-- the pre-029 get_my_writable_project_ids(). Refuses if any row already
-- uses a value that only exists since 029 (Site admin, Member, extras,
-- invitations) — those would have to be removed deliberately first.
begin;
do $$
begin
  if exists (select 1 from public.project_members where role = 'admin' or extra_permissions <> '{}')
     or exists (select 1 from public.tenant_members where role = 'member' or extra_permissions <> '{}')
     or exists (select 1 from public.invitations) then
    raise exception 'rollback-029: data created since 029 exists — review before undoing';
  end if;
end $$;

drop trigger if exists tenant_members_keep_one_owner   on public.tenant_members;
drop trigger if exists tenant_members_validate_extras  on public.tenant_members;
drop trigger if exists project_members_validate_extras on public.project_members;
drop table   if exists public.invitations;
drop function if exists public.tg_validate_invitation_extras();
drop function if exists public.tg_keep_one_tenant_owner();
drop function if exists public.tg_validate_member_extras();
drop function if exists public.validate_extra_permissions(text[], text);
alter table public.tenant_members  drop column if exists extra_permissions;
alter table public.project_members drop column if exists extra_permissions;
drop table   if exists public.grantable_permissions;

alter table public.tenant_members  drop constraint if exists tenant_members_role_check;
alter table public.project_members drop constraint if exists project_members_role_check;
alter table public.tenant_members  add constraint tenant_members_role_check  check (role in ('owner', 'editor', 'viewer'));
alter table public.project_members add constraint project_members_role_check check (role in ('editor', 'viewer'));
alter table public.tenant_members  alter column role set default 'owner';

create or replace function public.get_my_writable_project_ids()
returns setof uuid language sql security definer stable set search_path = '' as $$
  select id from public.projects where tenant_id in (select public.get_my_owned_tenant_ids())
  union
  select project_id from public.project_members where user_id = auth.uid() and role = 'editor'
$$;
commit;

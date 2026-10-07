-- POST-APPLY CHECK for migration 029 — read-only. Paste into the Supabase SQL
-- editor (production). Every column must read as shown in the comment.
select
  to_regclass('public.invitations') is not null                                   as invitations_table,      -- true
  (select count(*) from public.grantable_permissions)                             as grantable_count,        -- 3
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'project_members' and column_name = 'extra_permissions') as extras_column,        -- true
  (select count(*) from pg_trigger where not tgisinternal and tgname in (
     'tenant_members_validate_extras','project_members_validate_extras',
     'tenant_members_keep_one_owner','invitations_validate_extras'))              as triggers,               -- 4
  has_table_privilege('authenticated', 'public.invitations', 'SELECT')            as users_can_read_invites, -- false
  has_table_privilege('anon', 'public.invitations', 'SELECT')                     as anon_can_read_invites,  -- false
  (select count(*) from public.tenants t
     where not exists (select 1 from public.tenant_members m
                       where m.tenant_id = t.id and m.role = 'owner'))            as clients_without_owner;  -- ideally 0

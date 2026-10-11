-- Run in the Supabase SQL editor right after applying 040. Every row must read true.
select
  t.tbl,
  to_regclass('public.' || t.tbl) is not null                                         as exists,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t.tbl)), false) as rls_on,
  not has_table_privilege('anon', 'public.' || t.tbl, 'SELECT')                       as anon_cannot_read,
  not has_table_privilege('authenticated', 'public.' || t.tbl, 'SELECT')              as authenticated_cannot_read,
  has_table_privilege('service_role', 'public.' || t.tbl, 'SELECT')                   as service_role_can_read,
  not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl) as no_policies
from (values ('partner_apps'), ('connections'), ('connection_tokens'), ('oauth_codes'), ('api_tombstones'), ('api_usage')) as t(tbl);

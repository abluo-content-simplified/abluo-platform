-- ROLLBACK SNAPSHOT — run BEFORE 028; save the single text cell it returns.
select string_agg(stmt, E'\n' order by ord, stmt) as rollback_sql from (
  select 1 as ord, format('create policy %I on public.%I as %s for %s to %s%s%s;',
           policyname, tablename, permissive, cmd,
           (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
           coalesce(' using (' || qual || ')', ''), coalesce(' with check (' || with_check || ')', '')) as stmt
  from pg_policies where schemaname = 'public'
  union all
  select 2, format('grant %s on public.%I to %s;', privilege_type, table_name,
           case when grantee = 'PUBLIC' then 'public' else quote_ident(grantee) end)
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
  union all
  select 3, format('grant %s (%I) on public.%I to %s;', x.privilege_type, a.attname, c.relname,
           case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end)
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(a.attacl) x
  where n.nspname = 'public' and a.attacl is not null
    and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
  union all
  select 4, format('grant execute on function %s to %s;', p.oid::regprocedure,
           case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
  where n.nspname = 'public' and x.privilege_type = 'EXECUTE'
    and (x.grantee = 0 or x.grantee in ('anon'::regrole, 'authenticated'::regrole))
) s;

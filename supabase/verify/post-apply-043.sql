-- After applying 043: every value must be true.
select
  to_regclass('public.event_series') is not null                                          as series_table,
  to_regclass('public.event_occurrences') is not null                                     as occurrences_table,
  (select relrowsecurity from pg_class where oid = 'public.event_series'::regclass)       as series_rls,
  (select relrowsecurity from pg_class where oid = 'public.event_occurrences'::regclass)  as occurrences_rls,
  not has_table_privilege('authenticated', 'public.event_occurrences', 'SELECT')          as not_readable_by_users,
  not has_table_privilege('anon', 'public.event_series', 'SELECT')                        as not_readable_by_anon,
  not has_table_privilege('service_role', 'public.event_occurrences', 'DELETE')           as no_delete,
  (select count(*) from pg_indexes where schemaname = 'public' and tablename in ('event_series', 'event_occurrences')) = 9 as indexes_9;

-- Rollback of migration 060 — drops the two optional billing_profiles columns.
-- Refuses while any LIVE profile holds a value (business data).
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'billing_profiles' and column_name = 'contact_name') then
    raise exception 'rollback-060: 060 is not applied';
  end if;
  if exists (select 1 from public.billing_profiles where livemode and (contact_name is not null or tax_code is not null)) then
    raise exception 'rollback-060: live profiles hold contact names or tax codes — refusing';
  end if;
end $$;
alter table public.billing_profiles drop column contact_name, drop column tax_code;
commit;

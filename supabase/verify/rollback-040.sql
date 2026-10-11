-- Rollback of migration 040 (Connections). Refuses once any partner app or
-- connection exists — at that point dropping would destroy real consent
-- records and live credentials; revoke connections in the app instead.
begin;
do $$
begin
  if to_regclass('public.partner_apps') is null then
    raise exception 'rollback-040: 040 is not applied — nothing to do';
  end if;
  if exists (select 1 from public.partner_apps) or exists (select 1 from public.connections) then
    raise exception 'rollback-040: partner apps or connections exist — refusing to drop real data';
  end if;
end $$;
drop table public.api_usage;
drop table public.api_tombstones;
drop table public.oauth_codes;
drop table public.connection_tokens;
drop table public.connections;
drop table public.partner_apps;
drop function public.tg_partner_apps_check_redirects();
drop function public.tg_connections_project_in_tenant();
drop function public.tg_connections_identity_fixed();
commit;

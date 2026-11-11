-- 072 — French as a dashboard language (Tom, 2026-11-11).
--
-- The dashboard now comes in English, Italian, German and French. The
-- language a person last used is kept for their emails (ADR-050 D11); until
-- this runs, choosing French simply is not remembered for emails (they stay
-- in the previous language). Safe to re-run.

alter table public.profiles drop constraint if exists profiles_interface_locale_check;
alter table public.profiles add constraint profiles_interface_locale_check
  check (interface_locale in ('en', 'it', 'de', 'fr'));

create or replace function public.set_interface_locale(p_locale text) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles
     set interface_locale = p_locale
   where id = auth.uid()
     and p_locale in ('en', 'it', 'de', 'fr')
     and interface_locale is distinct from p_locale;
$$;
revoke all on function public.set_interface_locale(text) from public, anon;
grant execute on function public.set_interface_locale(text) to authenticated;

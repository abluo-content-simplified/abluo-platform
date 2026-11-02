-- ============================================================
-- Migration 060 — billing profile: contact person + tax code (ADR-041 D14)
--
-- ⚠️ NOT APPLIED. Rehearse on the Abluo Sandbox, then Tom applies it in the
-- SQL Editor and records it in supabase/APPLIED.md.
-- Apply BEFORE deploying the code that reads these columns.
-- Purely additive: two nullable columns on public.billing_profiles.
-- Rollback: supabase/verify/rollback-060.sql
--
-- contact_name — the person to address at a business client (Tom, 2026-11-02).
--   For individuals legal_name already holds the person's full name.
-- tax_code     — national tax code where an invoice may need it, today the
--   Italian codice fiscale of an individual (FatturaPA is deferred; stored so it
--   is on file). Upper-case letters and digits, 11–16 characters.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.billing_profiles') is null then
    raise exception '060: 058 is not applied — apply it first';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'billing_profiles' and column_name = 'contact_name') then
    raise exception '060: already applied — stop';
  end if;
end $$;

alter table public.billing_profiles
  add column contact_name text check (contact_name is null or length(btrim(contact_name)) between 1 and 200),
  add column tax_code     text check (tax_code is null or tax_code ~ '^[A-Z0-9]{11,16}$');

comment on column public.billing_profiles.contact_name is 'ADR-041 — contact person at a business client.';
comment on column public.billing_profiles.tax_code is 'ADR-041 — national tax code (Italian codice fiscale for individuals), optional.';

do $$
begin
  if has_table_privilege('authenticated', 'public.billing_profiles', 'SELECT')
     or has_table_privilege('anon', 'public.billing_profiles', 'SELECT') then
    raise exception '060 self-check: billing_profiles reachable by API roles';
  end if;
  raise notice '060 self-check passed';
end $$;

commit;

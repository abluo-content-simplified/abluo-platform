-- ============================================================
-- Migration 051 — Access module: grantable extras (ADR-040 B2.1, Tom 2026-10-24)
--
-- NOT APPLIED. Additive only; independent of 050 (needs only 029's
-- public.grantable_permissions). Kept apart from 050 so the migration that
-- was rehearsed on the Abluo Sandbox stays byte-identical.
--
-- Adds the two Access permissions to the closed list of extras an Owner or
-- Site admin may give an Editor (ADR-028 §3). Mirrors
-- GRANTABLE_MODULE_PERMISSIONS in src/lib/authz/permissions.ts; the parity test
-- src/lib/authz/__tests__/grantable-catalog.test.ts keeps the two equal.
-- The extra is honoured only while the Access module is enabled on the
-- project (src/lib/authz/resolve.ts). Owners and Site admins hold both by
-- default through the module manifest — no row is needed for them.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.grantable_permissions') is null then
    raise exception '051: public.grantable_permissions missing — migration 029 is not applied';
  end if;
  if exists (select 1 from public.grantable_permissions where id = 'members.access.read') then
    raise exception '051: already applied — stop';
  end if;
end $$;

insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('members.access.read',   'project', null,                  'See the website''s access groups, password names and protected documents.'),
  ('members.access.manage', 'project', 'members.access.read', 'Manage the website''s access groups, passwords, protected documents and visitor sign-outs.');

do $$
begin
  if (select count(*) from public.grantable_permissions where id in ('members.access.read', 'members.access.manage')) <> 2 then
    raise exception '051 self-check: grantable rows missing';
  end if;
  raise notice '051 self-check passed';
end $$;

commit;

-- ── Rollback (only while no membership holds either extra) ──────────────────
--   begin;
--   delete from public.grantable_permissions where id in ('members.access.manage', 'members.access.read');
--   commit;

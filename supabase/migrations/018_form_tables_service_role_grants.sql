-- ============================================================
-- Migration 018 — service_role table privileges for the forms tables
--
-- FIX for: POST /api/forms/.../submissions → 500, Postgres error 42501
-- "permission denied for table form_submissions".
--
-- Root cause: the anonymous submission path uses the service-role client
-- (runAsTrustedSystemOperation → createAdminClient). service_role BYPASSES
-- RLS but STILL requires table-level privileges. Migrations 016/017 granted
-- only SELECT/UPDATE (and SELECT) to `authenticated`; the service_role had no
-- explicit grant on these newly-created tables, so its INSERT (and the
-- spam-check SELECT) were denied.
--
-- Grant the trusted backend role full privileges on both forms tables. This
-- matches how the platform's other service-role-written tables behave.
-- ============================================================

grant all privileges on table public.form_submissions to service_role;
grant all privileges on table public.form_events      to service_role;

-- Verification:
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_name in ('form_submissions','form_events')
--   order by table_name, grantee, privilege_type;
--   -- expect service_role rows with INSERT/SELECT/UPDATE/DELETE present.

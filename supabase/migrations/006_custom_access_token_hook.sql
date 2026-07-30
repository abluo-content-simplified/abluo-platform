-- ============================================================
-- Migration 006 — Custom access token hook (platform_role claim)
--
-- ADR-015 Phase 1 — reliable platform-admin identity.
--
-- What this migration does:
--   Defines the Supabase Auth "custom access token hook" that
--   surfaces a single top-level `platform_role` claim into every
--   issued JWT.
--
--     platform_role ∈ { 'abluo_admin', 'tenant_user' }
--     fail-safe default: 'tenant_user'
--
--   The value is read from server-controlled `app_metadata`
--   (event.claims.app_metadata.platform_role). app_metadata is not
--   writable by end users, so the claim cannot be spoofed from the
--   client.
--
--   R1 — only `platform_role` is placed in the JWT. No memberships,
--   permissions, tenant lists, or roles are cached in the token;
--   those are resolved server-side per request. This keeps the token
--   small and avoids stale-authorization drift.
--
-- Why this REPLACES a prior hook:
--   A pre-2026-06-18 stale hook read the (since-dropped)
--   `profiles.tenant_id` and `profiles.role` columns — removed by
--   Migration 004 — and injected dead `tenant_id` + `user_role`
--   claims into the JWT. Those columns no longer exist, so the old
--   hook produced meaningless claims. `create or replace` below
--   overwrites that function definition cleanly.
--
-- Provenance (config-drift closure):
--   This function and the Auth Hooks toggle were applied manually via
--   the Supabase SQL editor + Dashboard → Authentication → Hooks on
--   2026-07-29, and VERIFIED live (Tom's JWT now carries top-level
--   `platform_role: abluo_admin`). It previously existed ONLY in the
--   dashboard. This file captures the exact applied-and-verified SQL
--   for version control.
--
--   This project has no Supabase CLI / config.toml — migrations are
--   the record of truth, NOT an auto-run mechanism. Running this file
--   is a manual, idempotent (`create or replace`) operation.
--
-- Intentionally NOT in this migration:
--   The first-admin seed
--     update auth.users
--        set raw_app_meta_data =
--            raw_app_meta_data || '{"platform_role":"abluo_admin"}'
--      where email = 'thomas@tmz.it';
--   is a one-time OPERATIONAL action against environment data (a
--   specific user), not schema. It stays out of the migration record.
--
-- Follow-up (later slice):
--   proxy.ts still reads the legacy `user_role` claim and must be
--   rewired to read `platform_role`. Tracked as a separate slice; not
--   part of this database migration.
-- ============================================================


-- ── custom_access_token_hook() ────────────────────────────────────────────────
--
-- Invoked by Supabase Auth on every token issuance. Must be STABLE and
-- return the (possibly modified) event jsonb. `create or replace` makes
-- this safe to re-run and overwrites the stale pre-2026-06-18 definition.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims        jsonb;
  platform_role text;
begin
  platform_role := coalesce(
    event -> 'claims' -> 'app_metadata' ->> 'platform_role',
    'tenant_user'
  );
  claims := event -> 'claims';
  claims := jsonb_set(claims, '{platform_role}', to_jsonb(platform_role));
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage   on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

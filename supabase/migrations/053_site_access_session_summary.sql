-- ============================================================
-- Migration 053 — Site Access: "who is signed in" summary (ADR-040 B2.5, Tom 2026-10-24)
--
-- NOT APPLIED. Additive only: one read-only function. Requires 050 (not 052).
-- Apply AFTER the code that reads it is deployed, together with or after 050.
--
--   site_access_session_summary(project, environment)
--     How many visitor sessions are signed in right now, per group and in
--     total, for ONE project in ONE environment (production visitors are not
--     mixed with preview / dev test sign-ins). A session counts for a group
--     exactly when site_access_resolve would let it open that group's pages:
--     not revoked, not expired, the grant's credential usable at the version
--     the session was granted (a changed or switched-off password no longer
--     counts), the group not archived. The total row (group_id null) counts
--     each session once, however many groups it opens.
--
--   Counts only — no session ids, tokens, devices or times leave the database
--   through this function.
--
-- Same rules as 050: service_role only, SECURITY INVOKER, project-scoped.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.site_access_sessions') is null then
    raise exception '053: public.site_access_sessions missing — migration 050 is not applied';
  end if;
  if to_regprocedure('public.site_access_session_summary(uuid, text)') is not null then
    raise exception '053: already applied — stop';
  end if;
end $$;

create function public.site_access_session_summary(p_project_id uuid, p_environment text)
returns table (group_id uuid, signed_in integer)
language sql
stable
set search_path = public, pg_temp
as $$
  select cg.group_id, count(distinct s.id)::integer
    from public.site_access_sessions s
    join public.site_access_session_grants g
      on g.session_id = s.id and g.project_id = s.project_id
    join public.site_access_credentials c
      on c.id = g.credential_id and c.project_id = g.project_id
     and c.secret_version = g.credential_version
     and c.disabled_at is null
     and (c.expires_at is null or c.expires_at > now())
    join public.site_access_credential_groups cg
      on cg.credential_id = c.id and cg.project_id = c.project_id
    join public.site_access_groups sg
      on sg.id = cg.group_id and sg.project_id = cg.project_id and sg.archived_at is null
   where s.project_id = p_project_id
     and s.environment = p_environment
     and s.revoked_at is null
     and s.expires_at > now()
   group by grouping sets ((cg.group_id), ())
$$;

revoke all on function public.site_access_session_summary(uuid, text) from public, anon, authenticated;
grant execute on function public.site_access_session_summary(uuid, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.site_access_session_summary(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_session_summary(uuid, text)', 'EXECUTE') then
    raise exception '053 self-check: session summary reachable by anon/authenticated';
  end if;
  raise notice '053 self-check passed';
end $$;

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   Harness: cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-053
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   drop function if exists public.site_access_session_summary(uuid, text);

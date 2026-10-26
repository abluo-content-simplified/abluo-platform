-- ============================================================================
-- Rollback of migrations 053, 052, 051, 050 (Site Access, ADR-040) — in that
-- order, in ONE transaction. Proven against a real Postgres by
-- supabase/verify/hardening-rollback-050-053.verify.mjs.
--
-- Refuses (nothing changes) when access data that someone created exists:
-- any group, password, visitor session or document — dropping would destroy
-- real data; archive in the dashboard instead. It also refuses while any
-- membership still holds an Access extra (051), because removing the
-- catalogue row would leave an unvalidated extra behind.
--
-- Partial application is handled: each block runs only if its migration is
-- present, so it is safe after 050 alone, 050+051, 050–052 or all four.
--
-- NOT DONE HERE — the private bucket `site-access-files`. Supabase refuses
-- direct SQL deletes on storage tables; remove it afterwards with the Storage
-- API or Dashboard → Storage (it must be empty; the guard above guarantees
-- no document ever pointed at a file, and the daily sweep empties abandoned
-- uploads).
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.site_access_groups') is null and to_regprocedure('public.site_access_session_summary(uuid, text)') is null
     and not exists (select 1 from public.grantable_permissions where id like 'members.access.%') then
    raise exception 'rollback-050-053: nothing to roll back';
  end if;
  if to_regclass('public.site_access_groups') is not null and (
       exists (select 1 from public.site_access_groups)
    or exists (select 1 from public.site_access_credentials)
    or exists (select 1 from public.site_access_sessions)
    or exists (select 1 from public.site_access_documents)) then
    raise exception 'rollback-050-053: access data exists (groups, passwords, sessions or documents) — refusing to drop real data';
  end if;
  if exists (select 1 from public.project_members where extra_permissions && array['members.access.read', 'members.access.manage'])
     or exists (select 1 from public.tenant_members where extra_permissions && array['members.access.read', 'members.access.manage']) then
    raise exception 'rollback-050-053: a membership still holds an Access extra — remove it in People first';
  end if;
end $$;

-- 053 — the signed-in summary
drop function if exists public.site_access_session_summary(uuid, text);

-- 052 — uploads, trash and document functions
drop function if exists public.site_access_trash_done(text[]);
drop function if exists public.site_access_trash_batch(integer);
drop function if exists public.site_access_expire_uploads(integer);
drop function if exists public.site_access_document_for_delivery(uuid, uuid, text[]);
drop function if exists public.site_access_fail_upload(uuid, uuid);
drop function if exists public.site_access_finish_upload(uuid, uuid, integer, text, uuid);
drop function if exists public.site_access_begin_upload(uuid, uuid, text, integer, text, text, uuid, integer);
drop function if exists public.site_access_set_document_archived(uuid, uuid, boolean, uuid);
drop function if exists public.site_access_set_document_groups(uuid, uuid, uuid[], uuid);
drop function if exists public.site_access_update_document(uuid, uuid, jsonb, integer, uuid);
drop function if exists public.site_access_create_document(uuid, jsonb, uuid[], uuid);
drop table if exists public.site_access_storage_trash;
drop table if exists public.site_access_uploads;

-- 051 — the two grantable extras (manage first: it requires read)
delete from public.grantable_permissions where id = 'members.access.manage';
delete from public.grantable_permissions where id = 'members.access.read';

-- 050 — tables (their triggers go with them), then functions
drop table if exists public.site_access_events, public.site_access_document_groups,
  public.site_access_document_files, public.site_access_documents, public.site_access_attempts,
  public.site_access_session_grants, public.site_access_sessions, public.site_access_credential_groups,
  public.site_access_credential_secrets, public.site_access_credentials, public.site_access_groups;
drop function if exists public.site_access_resolve(uuid, text, text, boolean);
drop function if exists public.site_access_candidate_credentials(uuid, uuid[]);
drop function if exists public.site_access_unlock(uuid, text, uuid, integer, text, text, integer, bigint, text);
drop function if exists public.site_access_drop_credential_grants(uuid, uuid, text, uuid);
drop function if exists public.site_access_create_credential(uuid, text, text, uuid[], timestamptz, uuid);
drop function if exists public.site_access_set_credential_groups(uuid, uuid, uuid[], uuid);
drop function if exists public.site_access_rotate_credential(uuid, uuid, text, uuid);
drop function if exists public.site_access_set_credential_disabled(uuid, uuid, boolean, uuid);
drop function if exists public.site_access_revoke_sessions(uuid, uuid, text, uuid);
drop function if exists public.site_access_reserve_attempt(uuid, text, integer, integer, integer, integer, integer);
drop function if exists public.site_access_finish_attempt(uuid, bigint, boolean);
drop function if exists public.site_access_purge(integer, integer);
drop function if exists public.site_access_enforce_limits();

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'site\_access\_%')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'site\_access\_%') then
    raise exception 'rollback-050-053 self-check: site_access objects remain';
  end if;
  raise notice 'rollback-050-053 self-check passed — now remove the empty bucket site-access-files with the Storage API';
end $$;

commit;

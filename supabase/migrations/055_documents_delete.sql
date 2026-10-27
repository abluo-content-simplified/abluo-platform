-- Migration 055 — Documents: permanent delete (ADR-040 §15.10, R9.3)
--
-- Tom (2026-10-27): the site's Owner may delete documents for good, so old
-- material (last year's calendars …) does not have to be kept forever.
--
-- Rules (content-lifecycle standard: archive first, then delete for good):
--   - only ARCHIVED documents can be deleted (an archived document is already
--     off every page and refused to every visitor);
--   - up to 100 at once, all of THIS project, or nothing at all;
--   - the document, its files, groups, placements and uploads go (FK cascade);
--     each stored object is queued for the daily sweep, which removes it from
--     private storage — the sweep never removes an object a file row still uses;
--   - one audit event per document (`document_deleted`), which keeps no title.
--
-- Who may call it is decided by the app (`documents.document.delete`, Owner
-- only, never an extra, never support). The function is service-role only.
--
-- Additive and safe before the code: nothing calls it until the R9.3 code ships.
-- Rollback: supabase/verify/rollback-055.sql.

begin;

do $$
begin
  if to_regprocedure('public.site_access_delete_documents(uuid, uuid[], uuid)') is not null then
    raise exception '055 already applied';
  end if;
  if to_regprocedure('public.site_access_page_documents(uuid, text[])') is null then
    raise exception '055 needs 054 first';
  end if;
end $$;

-- ── Trash reason and audit action ────────────────────────────────────────────
alter table public.site_access_storage_trash drop constraint site_access_storage_trash_reason_check;
alter table public.site_access_storage_trash
  add constraint site_access_storage_trash_reason_check
  check (reason in ('replaced', 'failed_upload', 'expired_upload', 'language_removed', 'document_deleted'));

alter table public.site_access_events drop constraint site_access_events_action_check;
alter table public.site_access_events add constraint site_access_events_action_check check (action in (
  'group_created', 'group_updated', 'group_archived', 'group_restored',
  'credential_created', 'credential_updated', 'credential_rotated',
  'credential_disabled', 'credential_enabled', 'credential_groups_changed',
  'sessions_revoked',
  'document_created', 'document_updated', 'document_archived', 'document_restored',
  'document_groups_changed', 'document_file_uploaded', 'document_file_replaced',
  'document_access_changed', 'document_placements_changed', 'document_languages_removed',
  'page_documents_reordered', 'document_deleted'));


-- ── Delete archived documents for good ───────────────────────────────────────
create function public.site_access_delete_documents(
  p_project_id uuid, p_document_ids uuid[], p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ids   uuid[];
  v_found integer;
  v_paths text[];
  n       integer;
begin
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(p_document_ids) as i where i is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 100 then raise exception 'site_access:invalid_documents'; end if;

  -- All of them, of THIS project, locked — or nothing.
  select count(*) into v_found from (
    select 1 from public.site_access_documents
     where project_id = p_project_id and id = any (v_ids)
     for update
  ) s;
  if v_found <> cardinality(v_ids) then raise exception 'site_access:not_found'; end if;
  if exists (select 1 from public.site_access_documents
              where project_id = p_project_id and id = any (v_ids) and archived_at is null) then
    raise exception 'site_access:not_archived';
  end if;

  -- Every stored object these documents point at: files and any upload (pending, failed or finished).
  select coalesce(array_agg(distinct p), '{}') into v_paths from (
    select storage_path as p from public.site_access_document_files where project_id = p_project_id and document_id = any (v_ids)
    union
    select storage_path from public.site_access_uploads where project_id = p_project_id and document_id = any (v_ids)
  ) s;

  delete from public.site_access_documents where project_id = p_project_id and id = any (v_ids);
  get diagnostics n = row_count;

  -- A separate statement, after the delete: an object another document still
  -- uses (never expected — paths are per upload) is not queued.
  insert into public.site_access_storage_trash (storage_path, project_id, reason)
  select p, p_project_id, 'document_deleted' from unnest(v_paths) as p
   where p like p_project_id::text || '/%'
     and not exists (select 1 from public.site_access_document_files f where f.storage_path = p)
  on conflict do nothing;

  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  select p_project_id, p_actor, 'document_deleted', i, '{}'::jsonb from unnest(v_ids) as i;
  return n;
end $$;

revoke all on function public.site_access_delete_documents(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.site_access_delete_documents(uuid, uuid[], uuid) to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE') then
    raise exception '055 self-check: delete reachable by anon/authenticated';
  end if;
  raise notice '055 self-check passed';
end $$;

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   select has_function_privilege('anon', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE');  -- false
--   select has_function_privilege('service_role', 'public.site_access_delete_documents(uuid, uuid[], uuid)', 'EXECUTE');  -- true
--   Harness: cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-055

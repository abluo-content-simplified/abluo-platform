-- ============================================================================
-- Rollback of migration 055 (Documents: permanent delete) — ONE transaction.
-- Proven by supabase/verify/hardening-055.verify.mjs.
--
-- Refuses (nothing changes) once a document was deleted for good — its audit
-- events and queued objects only make sense with 055. Leaves 054 exactly as it
-- was (the trash and event checks, no delete function).
-- ============================================================================
begin;

do $$
begin
  if to_regprocedure('public.site_access_delete_documents(uuid, uuid[], uuid)') is null then
    raise exception 'rollback-055: 055 is not applied';
  end if;
  if exists (select 1 from public.site_access_events where action = 'document_deleted')
     or exists (select 1 from public.site_access_storage_trash where reason = 'document_deleted') then
    raise exception 'rollback-055: documents were deleted with 055 — rollback would misread that history';
  end if;
end $$;

drop function public.site_access_delete_documents(uuid, uuid[], uuid);

alter table public.site_access_storage_trash drop constraint site_access_storage_trash_reason_check;
alter table public.site_access_storage_trash
  add constraint site_access_storage_trash_reason_check
  check (reason in ('replaced', 'failed_upload', 'expired_upload', 'language_removed'));

alter table public.site_access_events drop constraint site_access_events_action_check;
alter table public.site_access_events add constraint site_access_events_action_check check (action in (
  'group_created', 'group_updated', 'group_archived', 'group_restored',
  'credential_created', 'credential_updated', 'credential_rotated',
  'credential_disabled', 'credential_enabled', 'credential_groups_changed',
  'sessions_revoked',
  'document_created', 'document_updated', 'document_archived', 'document_restored',
  'document_groups_changed', 'document_file_uploaded', 'document_file_replaced',
  'document_access_changed', 'document_placements_changed', 'document_languages_removed',
  'page_documents_reordered'));

commit;

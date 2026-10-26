-- ============================================================================
-- Rollback of migration 054 (Documents module, ADR-040 §15) — ONE transaction.
-- Proven by supabase/verify/hardening-rollback-054.verify.mjs.
--
-- Refuses (nothing changes) once anything only 054 can express exists:
-- a public document, a note, a category or tags, a placement, an image file
-- or upload, a stored object shared by several languages, a multi-language
-- upload, a 054 audit event, or a membership holding a documents.* extra.
-- Undoing then would lose or misread real data — archive in the dashboard.
--
-- Leaves 050–053 exactly as they were before 054 (restores 052's
-- site_access_finish_upload, the unique storage path, the PDF-only checks,
-- the events and trash checks, and the bucket's PDF-only type list).
-- ============================================================================
begin;

do $$
begin
  if to_regclass('public.site_access_document_placements') is null then
    raise exception 'rollback-054: 054 is not applied';
  end if;
  if exists (select 1 from public.site_access_documents
              where visibility <> 'groups' or note is not null or category_term_id is not null or cardinality(tag_term_ids) > 0)
     or exists (select 1 from public.site_access_document_placements)
     or exists (select 1 from public.site_access_document_files where mime_type <> 'application/pdf')
     or exists (select 1 from public.site_access_uploads where mime_type <> 'application/pdf' or cardinality(locales) > 0)
     or exists (select storage_path from public.site_access_document_files group by storage_path having count(*) > 1)
     or exists (select 1 from public.site_access_storage_trash where reason = 'language_removed')
     or exists (select 1 from public.site_access_events
                 where action in ('document_access_changed', 'document_placements_changed',
                                  'document_languages_removed', 'page_documents_reordered')) then
    raise exception 'rollback-054: 054 data exists (public documents, notes, categories/tags, placements, images, shared files or 054 events) — refusing';
  end if;
  if exists (select 1 from public.project_members where extra_permissions && array['documents.document.read', 'documents.document.manage'])
     or exists (select 1 from public.tenant_members where extra_permissions && array['documents.document.read', 'documents.document.manage']) then
    raise exception 'rollback-054: a membership still holds a documents extra — remove it in People first';
  end if;
end $$;

drop function if exists public.site_access_document_for_delivery_v2(uuid, uuid, text[]);
drop function if exists public.site_access_page_documents(uuid, text[]);
drop function if exists public.site_access_begin_upload_v2(uuid, uuid, text[], text, integer, text, text, uuid, integer);
drop function if exists public.site_access_remove_document_languages(uuid, uuid, text[], uuid);
drop function if exists public.site_access_reorder_page_documents(uuid, text, uuid[], uuid);
drop function if exists public.site_access_set_document_placements(uuid, uuid, text[], uuid);
drop function if exists public.site_access_set_document_access(uuid, uuid, text, uuid[], uuid);
drop function if exists public.site_access_update_document_v2(uuid, uuid, jsonb, jsonb, text, text[], uuid);
drop function if exists public.site_access_create_document_v2(uuid, jsonb, jsonb, text, uuid[], text, text[], uuid);
drop function if exists public.site_access_assert_live_groups(uuid, uuid[]);

-- 052's finish, verbatim
create or replace function public.site_access_finish_upload(
  p_project_id uuid, p_upload_id uuid, p_size integer, p_sha256 text, p_actor uuid
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare u public.site_access_uploads%rowtype; v_old text;
begin
  select * into u from public.site_access_uploads
   where id = p_upload_id and project_id = p_project_id
   for update;
  if not found or u.status <> 'pending' or u.expires_at <= now() then
    raise exception 'site_access:upload_unavailable';
  end if;
  if p_size <> u.declared_size or lower(p_sha256) <> u.declared_sha256 then
    raise exception 'site_access:upload_mismatch';
  end if;
  perform 1 from public.site_access_documents d
   where d.id = u.document_id and d.project_id = p_project_id and d.archived_at is null
   for update;
  if not found then raise exception 'site_access:not_found'; end if;

  select f.storage_path into v_old from public.site_access_document_files f
   where f.document_id = u.document_id and f.project_id = p_project_id and f.locale = u.locale
   for update;

  if v_old is null then
    insert into public.site_access_document_files
      (document_id, project_id, locale, storage_path, mime_type, size_bytes, sha256, original_filename, uploaded_by)
    values (u.document_id, p_project_id, u.locale, u.storage_path, 'application/pdf', p_size, lower(p_sha256), u.original_filename, p_actor);
  else
    update public.site_access_document_files
       set storage_path = u.storage_path, size_bytes = p_size, sha256 = lower(p_sha256),
           original_filename = u.original_filename, uploaded_by = p_actor, uploaded_at = now()
     where document_id = u.document_id and project_id = p_project_id and locale = u.locale;
    insert into public.site_access_storage_trash (storage_path, project_id, reason)
    values (v_old, p_project_id, 'replaced') on conflict do nothing;
  end if;

  update public.site_access_uploads set status = 'finished', finished_at = now() where id = u.id;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, case when v_old is null then 'document_file_uploaded' else 'document_file_replaced' end,
          u.document_id, jsonb_build_object('locale', u.locale, 'size', p_size));
  return v_old;
end $$;


drop table public.site_access_document_placements;

delete from public.grantable_permissions where id = 'documents.document.manage';
delete from public.grantable_permissions where id = 'documents.document.read';

update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'site-access-files';

alter table public.site_access_events drop constraint site_access_events_action_check;
alter table public.site_access_events add constraint site_access_events_action_check check (action in (
  'group_created', 'group_updated', 'group_archived', 'group_restored',
  'credential_created', 'credential_updated', 'credential_rotated',
  'credential_disabled', 'credential_enabled', 'credential_groups_changed',
  'sessions_revoked',
  'document_created', 'document_updated', 'document_archived', 'document_restored',
  'document_groups_changed', 'document_file_uploaded', 'document_file_replaced'));

alter table public.site_access_storage_trash drop constraint site_access_storage_trash_reason_check;
alter table public.site_access_storage_trash add constraint site_access_storage_trash_reason_check
  check (reason in ('replaced', 'failed_upload', 'expired_upload'));

alter table public.site_access_uploads drop column locales, drop column mime_type;
alter table public.site_access_uploads drop constraint site_access_uploads_storage_path_check;
alter table public.site_access_uploads add constraint site_access_uploads_check
  check (storage_path like project_id::text || '/%'
         and storage_path ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$');

alter table public.site_access_document_files drop constraint site_access_document_files_mime_type_check;
alter table public.site_access_document_files add constraint site_access_document_files_mime_type_check
  check (mime_type = 'application/pdf');
drop index public.site_access_document_files_path;
alter table public.site_access_document_files add constraint site_access_document_files_storage_path_key unique (storage_path);

alter table public.site_access_documents
  drop column tag_term_ids, drop column category_term_id, drop column note, drop column visibility;

drop function public.site_access_valid_locales(text[]);
drop function public.site_access_valid_sanity_ids(text[]);

do $$
begin
  if to_regclass('public.site_access_document_placements') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'site_access_documents' and column_name = 'visibility')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'site\_access\_%v2') then
    raise exception 'rollback-054 self-check: 054 objects remain';
  end if;
  raise notice 'rollback-054 self-check passed';
end $$;

commit;

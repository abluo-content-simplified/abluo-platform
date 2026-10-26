-- ============================================================
-- Migration 054 — Documents module: public or group documents, languages,
-- note, category & tags, image files, placements on pages
-- (ADR-040 §15, amendment R9, Tom 2026-10-26)
--
-- NOT APPLIED. Additive only. Requires 050 + 052. Safe before or after the
-- R9 code: the B2.5 code (6b2fc04) keeps working against it unchanged —
-- every existing column, constraint meaning and function signature it uses
-- still behaves the same (proven in hardening-054: "B2.5 code paths").
--
-- What it adds
--   site_access_documents        visibility ('everyone' | 'groups', existing
--                                rows = 'groups'), note (localized), category
--                                and tag term ids (Sanity taxonomyTerm ids)
--   site_access_document_files   one stored object may serve several
--                                languages (path no longer unique per row);
--                                PDF, JPEG, PNG or WebP
--   site_access_uploads          mime type + the full list of languages the
--                                upload is for; path extension follows type
--   site_access_document_placements   NEW — which (published) Sanity pages
--                                show a document, ordered per page
--   grantable extras             documents.document.read / .manage
--   functions (service_role only, SECURITY INVOKER, project-scoped):
--     site_access_create_document_v2, _update_document_v2,
--     _set_document_access, _set_document_placements,
--     _reorder_page_documents, _remove_document_languages,
--     _begin_upload_v2, _page_documents, _document_for_delivery_v2
--   site_access_finish_upload    same signature; now also writes the extra
--                                languages and the upload's mime type
--
-- Rules carried over from 050/052: RLS on, no grants and no policies for
-- anon / authenticated, composite (id, project_id) foreign keys. Nothing is
-- deleted from site_access_documents (archive). A stored object is removed
-- only when no file row points at it any more (052 trash rules).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.site_access_uploads') is null then
    raise exception '054: public.site_access_uploads missing — migration 052 is not applied';
  end if;
  if to_regclass('public.grantable_permissions') is null then
    raise exception '054: public.grantable_permissions missing — migration 029 is not applied';
  end if;
  if to_regclass('public.site_access_document_placements') is not null then
    raise exception '054: already applied — stop';
  end if;
end $$;

-- Drops the CHECK constraint(s) that involve one column of one table,
-- whatever they were auto-named (single- or multi-column). Session-local;
-- dropped before commit. Used only inside this migration; dropped at the end.
create function pg_temp.drop_column_checks(p_table text, p_column text) returns void
language plpgsql as $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
     where con.conrelid = format('public.%I', p_table)::regclass
       and con.contype = 'c' and a.attname = p_column
  loop
    execute format('alter table public.%I drop constraint %I', p_table, c);
  end loop;
end $$;

-- Term ids and page ids: Sanity document ids, never drafts or versions.
create function public.site_access_valid_sanity_ids(p_ids text[]) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select coalesce(bool_and(i ~ '^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$'
                           and i not like 'drafts.%' and i not like 'versions.%'), true)
    from unnest(p_ids) as i
$$;

create function public.site_access_valid_locales(p_locales text[]) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select cardinality(p_locales) between 1 and 20
     and (select bool_and(l ~ '^[a-z]{2}(-[A-Z]{2})?$') from unnest(p_locales) as l)
     and cardinality(p_locales) = (select count(distinct l) from unnest(p_locales) as l)
$$;


-- ── Documents ────────────────────────────────────────────────────────────────
alter table public.site_access_documents
  add column visibility        text   not null default 'groups' check (visibility in ('everyone', 'groups')),
  add column note              jsonb  check (note is null or (jsonb_typeof(note) = 'object' and char_length(note::text) <= 4000)),
  add column category_term_id  text   check (category_term_id is null or public.site_access_valid_sanity_ids(array[category_term_id])),
  add column tag_term_ids      text[] not null default '{}'
                                 check (cardinality(tag_term_ids) <= 20 and public.site_access_valid_sanity_ids(tag_term_ids));


-- ── Files: several languages may share one stored object; images allowed ────
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.site_access_document_files'::regclass and contype = 'u'
     and conkey = array[(select attnum from pg_attribute where attrelid = 'public.site_access_document_files'::regclass and attname = 'storage_path')]::int2[];
  if c is null then raise exception '054: unique(storage_path) on site_access_document_files not found'; end if;
  execute format('alter table public.site_access_document_files drop constraint %I', c);
end $$;
create index site_access_document_files_path on public.site_access_document_files (storage_path);

select pg_temp.drop_column_checks('site_access_document_files', 'mime_type');
alter table public.site_access_document_files
  add constraint site_access_document_files_mime_type_check
  check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'));


-- ── Uploads: type + the languages the upload is for ──────────────────────────
select pg_temp.drop_column_checks('site_access_uploads', 'storage_path');
alter table public.site_access_uploads
  add constraint site_access_uploads_storage_path_check
  check (storage_path like project_id::text || '/%'
         and storage_path ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$');
alter table public.site_access_uploads
  add column mime_type text   not null default 'application/pdf'
                         check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  -- Every language this upload serves; empty = only `locale` (B2.5 uploads).
  add column locales   text[] not null default '{}'
                         check (cardinality(locales) = 0 or public.site_access_valid_locales(locales));


-- ── Trash: a language removed from a document ────────────────────────────────
select pg_temp.drop_column_checks('site_access_storage_trash', 'reason');
alter table public.site_access_storage_trash
  add constraint site_access_storage_trash_reason_check
  check (reason in ('replaced', 'failed_upload', 'expired_upload', 'language_removed'));


-- ── Placements ───────────────────────────────────────────────────────────────
-- page_id is the PUBLISHED Sanity page id. Whether the page still fits (has a
-- Download section, public vs protected, its groups) is re-checked by the
-- server at every display — a placement never grants anything by itself.
create table public.site_access_document_placements (
  document_id  uuid        not null,
  project_id   uuid        not null,
  page_id      text        not null check (public.site_access_valid_sanity_ids(array[page_id])),
  sort_order   integer     not null default 0,
  created_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (document_id, page_id),
  foreign key (document_id, project_id) references public.site_access_documents (id, project_id) on delete cascade
);
create index site_access_document_placements_page on public.site_access_document_placements (project_id, page_id, sort_order);


-- ── Audit actions ────────────────────────────────────────────────────────────
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


-- ── Private bucket: images too (size limit unchanged, 20 MB) ─────────────────
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
 where id = 'site-access-files';


-- ── Grantable extras (ADR-028 §3; mirrors GRANTABLE_MODULE_PERMISSIONS) ──────
insert into public.grantable_permissions (id, applies_to, requires, description) values
  ('documents.document.read',   'project', null,                      'See the website''s documents and on which pages they show.'),
  ('documents.document.manage', 'project', 'documents.document.read', 'Add, change, place and archive the website''s documents (never access groups or passwords).');


-- ── Internal: the live groups of a set must all belong to the project ───────
create function public.site_access_assert_live_groups(p_project_id uuid, p_group_ids uuid[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from unnest(coalesce(p_group_ids, '{}'::uuid[])) as g
     where not exists (select 1 from public.site_access_groups sg
                        where sg.id = g and sg.project_id = p_project_id and sg.archived_at is null)
  ) then
    raise exception 'site_access:unknown_group';
  end if;
end $$;


-- ── Documents (v2) ───────────────────────────────────────────────────────────
create function public.site_access_create_document_v2(
  p_project_id uuid, p_title jsonb, p_note jsonb, p_visibility text, p_group_ids uuid[],
  p_category_term_id text, p_tag_term_ids text[], p_actor uuid
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid; v_groups uuid[] := coalesce(p_group_ids, '{}'::uuid[]);
begin
  if p_visibility = 'everyone' and cardinality(v_groups) > 0 then raise exception 'site_access:groups_with_everyone'; end if;
  if p_visibility = 'groups' and cardinality(v_groups) = 0 then raise exception 'site_access:no_groups'; end if;
  perform public.site_access_assert_live_groups(p_project_id, v_groups);
  insert into public.site_access_documents (project_id, title, note, visibility, category_term_id, tag_term_ids, created_by)
  values (p_project_id, p_title, p_note, p_visibility, p_category_term_id, coalesce(p_tag_term_ids, '{}'), p_actor)
  returning id into v_id;
  insert into public.site_access_document_groups (document_id, group_id, project_id)
  select v_id, g, p_project_id from unnest(v_groups) as g on conflict do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'document_created', v_id, jsonb_build_object('visibility', p_visibility));
  return v_id;
end $$;

-- Title, note, category and tags — a full replace of those four fields.
create function public.site_access_update_document_v2(
  p_project_id uuid, p_document_id uuid, p_title jsonb, p_note jsonb,
  p_category_term_id text, p_tag_term_ids text[], p_actor uuid
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.site_access_documents
     set title = p_title, note = p_note, category_term_id = p_category_term_id,
         tag_term_ids = coalesce(p_tag_term_ids, '{}')
   where id = p_document_id and project_id = p_project_id;
  if not found then raise exception 'site_access:not_found'; end if;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id)
  values (p_project_id, p_actor, 'document_updated', p_document_id);
end $$;

-- Who can open it: everyone, or one or more live groups — set together.
create function public.site_access_set_document_access(
  p_project_id uuid, p_document_id uuid, p_visibility text, p_group_ids uuid[], p_actor uuid
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_groups uuid[] := coalesce(p_group_ids, '{}'::uuid[]);
begin
  if p_visibility not in ('everyone', 'groups') then raise exception 'site_access:invalid_visibility'; end if;
  if p_visibility = 'everyone' and cardinality(v_groups) > 0 then raise exception 'site_access:groups_with_everyone'; end if;
  if p_visibility = 'groups' and cardinality(v_groups) = 0 then raise exception 'site_access:no_groups'; end if;
  perform 1 from public.site_access_documents where id = p_document_id and project_id = p_project_id for update;
  if not found then raise exception 'site_access:not_found'; end if;
  perform public.site_access_assert_live_groups(p_project_id, v_groups);
  update public.site_access_documents set visibility = p_visibility
   where id = p_document_id and project_id = p_project_id;
  delete from public.site_access_document_groups where document_id = p_document_id and project_id = p_project_id;
  insert into public.site_access_document_groups (document_id, group_id, project_id)
  select p_document_id, g, p_project_id from unnest(v_groups) as g on conflict do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'document_access_changed', p_document_id,
          jsonb_build_object('visibility', p_visibility, 'groups', cardinality(v_groups)));
end $$;

-- "Show on": the full set of pages. Pages kept keep their position; new pages
-- put the document at the end of that page's list.
create function public.site_access_set_document_placements(
  p_project_id uuid, p_document_id uuid, p_page_ids text[], p_actor uuid
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_pages text[] := coalesce(p_page_ids, '{}'::text[]);
begin
  if cardinality(v_pages) > 50 or not public.site_access_valid_sanity_ids(v_pages) then
    raise exception 'site_access:invalid_page';
  end if;
  perform 1 from public.site_access_documents
   where id = p_document_id and project_id = p_project_id and archived_at is null for update;
  if not found then raise exception 'site_access:not_found'; end if;
  delete from public.site_access_document_placements
   where document_id = p_document_id and project_id = p_project_id and not (page_id = any (v_pages));
  insert into public.site_access_document_placements (document_id, project_id, page_id, sort_order, created_by)
  select p_document_id, p_project_id, pg,
         coalesce((select max(x.sort_order) + 1 from public.site_access_document_placements x
                    where x.project_id = p_project_id and x.page_id = pg), 0),
         p_actor
    from (select distinct unnest(v_pages) as pg) s
  on conflict (document_id, page_id) do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'document_placements_changed', p_document_id,
          jsonb_build_object('pages', cardinality(v_pages)));
end $$;

-- The order of the documents on one page. The list must be exactly the
-- documents placed on that page (no more, no fewer).
create function public.site_access_reorder_page_documents(
  p_project_id uuid, p_page_id text, p_document_ids uuid[], p_actor uuid
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_ids uuid[] := coalesce(p_document_ids, '{}'::uuid[]);
begin
  if not public.site_access_valid_sanity_ids(array[p_page_id]) then raise exception 'site_access:invalid_page'; end if;
  perform 1 from public.site_access_document_placements
   where project_id = p_project_id and page_id = p_page_id for update;
  if (select count(*) from public.site_access_document_placements where project_id = p_project_id and page_id = p_page_id)
       <> cardinality(v_ids)
     or cardinality(v_ids) <> (select count(distinct d) from unnest(v_ids) as d)
     or exists (select 1 from unnest(v_ids) as d
                 where not exists (select 1 from public.site_access_document_placements x
                                    where x.project_id = p_project_id and x.page_id = p_page_id and x.document_id = d)) then
    raise exception 'site_access:order_mismatch';
  end if;
  update public.site_access_document_placements x
     set sort_order = o.ord - 1
    from unnest(v_ids) with ordinality as o(id, ord)
   where x.project_id = p_project_id and x.page_id = p_page_id and x.document_id = o.id;
  insert into public.site_access_events (project_id, actor_user_id, action, detail)
  values (p_project_id, p_actor, 'page_documents_reordered', jsonb_build_object('page', p_page_id));
end $$;

-- Remove languages from a document. The last language cannot be removed
-- (archive the document instead). Objects no row uses any more are queued.
create function public.site_access_remove_document_languages(
  p_project_id uuid, p_document_id uuid, p_locales text[], p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer; v_paths text[];
begin
  if not public.site_access_valid_locales(p_locales) then raise exception 'site_access:invalid_locale'; end if;
  perform 1 from public.site_access_documents where id = p_document_id and project_id = p_project_id for update;
  if not found then raise exception 'site_access:not_found'; end if;
  if not exists (select 1 from public.site_access_document_files f
                  where f.document_id = p_document_id and f.project_id = p_project_id
                    and not (f.locale = any (p_locales))) then
    raise exception 'site_access:last_language';
  end if;
  with gone as (
    delete from public.site_access_document_files f
     where f.document_id = p_document_id and f.project_id = p_project_id and f.locale = any (p_locales)
    returning f.storage_path
  )
  select count(*), coalesce(array_agg(distinct storage_path), '{}') into n, v_paths from gone;
  -- A separate statement, so it sees the rows deleted above: an object that
  -- another language still uses is not queued.
  insert into public.site_access_storage_trash (storage_path, project_id, reason)
  select p, p_project_id, 'language_removed' from unnest(v_paths) as p
   where not exists (select 1 from public.site_access_document_files f2 where f2.storage_path = p)
  on conflict do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'document_languages_removed', p_document_id, jsonb_build_object('locales', to_jsonb(p_locales)));
  return n;
end $$;


-- ── Uploads (v2): type and several languages ─────────────────────────────────
-- PDF up to 20 MB, images up to 10 MB. The path (and its extension) is chosen
-- here. At most 20 pending uploads per project (as 052).
create function public.site_access_begin_upload_v2(
  p_project_id uuid, p_document_id uuid, p_locales text[], p_mime text, p_size integer, p_sha256 text,
  p_filename text, p_actor uuid, p_ttl_seconds integer
) returns table (upload_id uuid, storage_path text, expires_at timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_expires timestamptz; n integer; v_ext text; v_max integer;
begin
  if p_ttl_seconds < 60 or p_ttl_seconds > 86400 then raise exception 'site_access:invalid_ttl'; end if;
  if not public.site_access_valid_locales(p_locales) then raise exception 'site_access:invalid_locale'; end if;
  v_ext := case p_mime when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
                       when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then raise exception 'site_access:invalid_type'; end if;
  v_max := case when p_mime = 'application/pdf' then 20971520 else 10485760 end;
  if p_size is null or p_size <= 0 or p_size > v_max then raise exception 'site_access:too_large'; end if;
  perform 1 from public.site_access_documents d
   where d.id = p_document_id and d.project_id = p_project_id and d.archived_at is null;
  if not found then raise exception 'site_access:not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('site_access_upload:' || p_project_id::text, 0));
  select count(*) into n from public.site_access_uploads u
   where u.project_id = p_project_id and u.status = 'pending' and u.expires_at > now();
  if n >= 20 then raise exception 'site_access:too_many_uploads'; end if;
  v_path := p_project_id::text || '/' || gen_random_uuid()::text || '.' || v_ext;
  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.site_access_uploads
    (id, project_id, document_id, locale, locales, mime_type, storage_path, declared_size, declared_sha256,
     original_filename, created_by, expires_at)
  values (v_id, p_project_id, p_document_id, p_locales[1], p_locales, p_mime, v_path, p_size, lower(p_sha256),
          p_filename, p_actor, v_expires);
  return query select v_id, v_path, v_expires;
end $$;

-- 052's finish, extended: the upload's type, and every language it is for.
-- Same signature and return value (the previous path of the FIRST language).
-- A previous object is queued; the sweep removes it only once no file row
-- points at it (a shared object stays while any language still uses it).
create or replace function public.site_access_finish_upload(
  p_project_id uuid, p_upload_id uuid, p_size integer, p_sha256 text, p_actor uuid
) returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare u public.site_access_uploads%rowtype; v_old text; v_first_old text; v_loc text; v_any_new boolean := false;
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

  foreach v_loc in array (case when cardinality(u.locales) > 0 then u.locales else array[u.locale] end) loop
    v_old := null;
    select f.storage_path into v_old from public.site_access_document_files f
     where f.document_id = u.document_id and f.project_id = p_project_id and f.locale = v_loc
     for update;
    if v_loc = u.locale then v_first_old := v_old; end if;
    if v_old is null then
      v_any_new := true;
      insert into public.site_access_document_files
        (document_id, project_id, locale, storage_path, mime_type, size_bytes, sha256, original_filename, uploaded_by)
      values (u.document_id, p_project_id, v_loc, u.storage_path, u.mime_type, p_size, lower(p_sha256), u.original_filename, p_actor);
    else
      update public.site_access_document_files
         set storage_path = u.storage_path, mime_type = u.mime_type, size_bytes = p_size, sha256 = lower(p_sha256),
             original_filename = u.original_filename, uploaded_by = p_actor, uploaded_at = now()
       where document_id = u.document_id and project_id = p_project_id and locale = v_loc;
      if v_old <> u.storage_path then
        insert into public.site_access_storage_trash (storage_path, project_id, reason)
        values (v_old, p_project_id, 'replaced') on conflict do nothing;
      end if;
    end if;
  end loop;

  update public.site_access_uploads set status = 'finished', finished_at = now() where id = u.id;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, case when v_first_old is null then 'document_file_uploaded' else 'document_file_replaced' end,
          u.document_id, jsonb_build_object('locale', u.locale,
                                            'locales', to_jsonb(case when cardinality(u.locales) > 0 then u.locales else array[u.locale] end),
                                            'size', p_size));
  return v_first_old;
end $$;


-- ── Reads ────────────────────────────────────────────────────────────────────
-- Everything a Download section (and the dashboard recap) needs for some pages
-- of THIS project: live documents placed on them that have at least one file.
-- No storage paths. Whether a page fits, and what this visitor may open, is
-- decided by the caller from the page's own access rule — never from here.
create function public.site_access_page_documents(p_project_id uuid, p_page_ids text[])
returns table (page_id text, sort_order integer, document_id uuid, visibility text, title jsonb, note jsonb,
               category_term_id text, tag_term_ids text[], group_ids uuid[], files jsonb, updated_at timestamptz)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.page_id, p.sort_order, d.id, d.visibility, d.title, d.note, d.category_term_id, d.tag_term_ids,
         coalesce((select array_agg(g.group_id order by g.group_id)
                     from public.site_access_document_groups g
                     join public.site_access_groups sg on sg.id = g.group_id and sg.project_id = g.project_id
                    where g.document_id = d.id and g.project_id = d.project_id and sg.archived_at is null), '{}'::uuid[]),
         (select jsonb_agg(jsonb_build_object('locale', f.locale, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes,
                                              'uploadedAt', f.uploaded_at) order by f.locale)
            from public.site_access_document_files f
           where f.document_id = d.id and f.project_id = d.project_id),
         d.updated_at
    from public.site_access_document_placements p
    join public.site_access_documents d on d.id = p.document_id and d.project_id = p.project_id
   where p.project_id = p_project_id
     and p.page_id = any (coalesce(p_page_ids, '{}'::text[]))
     and d.archived_at is null
     and exists (select 1 from public.site_access_document_files f where f.document_id = d.id and f.project_id = d.project_id)
   order by p.page_id, p.sort_order, d.created_at
$$;

-- 052's delivery read plus visibility and mime type. The first language in
-- p_locales that has a file; the returned locale is the file's real language
-- (the site labels it honestly). Zero rows for unknown / other project.
create function public.site_access_document_for_delivery_v2(p_project_id uuid, p_document_id uuid, p_locales text[])
returns table (archived boolean, visibility text, title jsonb, group_ids uuid[], locale text, storage_path text,
               size_bytes integer, sha256 text, mime_type text)
language sql
stable
set search_path = public, pg_temp
as $$
  select d.archived_at is not null,
         d.visibility,
         d.title,
         case when d.visibility = 'everyone' then '{}'::uuid[] else
           coalesce((select array_agg(g.group_id order by g.group_id)
                       from public.site_access_document_groups g
                       join public.site_access_groups sg on sg.id = g.group_id and sg.project_id = g.project_id
                      where g.document_id = d.id and g.project_id = d.project_id and sg.archived_at is null), '{}'::uuid[])
         end,
         f.locale, f.storage_path, f.size_bytes, f.sha256, f.mime_type
    from public.site_access_documents d
    join public.site_access_document_files f on f.document_id = d.id and f.project_id = d.project_id
    join unnest(p_locales) with ordinality as l(code, ord) on l.code = f.locale
   where d.id = p_document_id and d.project_id = p_project_id
   order by l.ord
   limit 1
$$;


-- ── Lock everything to the service role ──────────────────────────────────────
do $$
declare f text;
begin
  alter table public.site_access_document_placements enable row level security;
  revoke all on table public.site_access_document_placements from anon, authenticated, public;
  grant all privileges on table public.site_access_document_placements to service_role;
  foreach f in array array[
    'public.site_access_valid_sanity_ids(text[])',
    'public.site_access_valid_locales(text[])',
    'public.site_access_assert_live_groups(uuid, uuid[])',
    'public.site_access_create_document_v2(uuid, jsonb, jsonb, text, uuid[], text, text[], uuid)',
    'public.site_access_update_document_v2(uuid, uuid, jsonb, jsonb, text, text[], uuid)',
    'public.site_access_set_document_access(uuid, uuid, text, uuid[], uuid)',
    'public.site_access_set_document_placements(uuid, uuid, text[], uuid)',
    'public.site_access_reorder_page_documents(uuid, text, uuid[], uuid)',
    'public.site_access_remove_document_languages(uuid, uuid, text[], uuid)',
    'public.site_access_begin_upload_v2(uuid, uuid, text[], text, integer, text, text, uuid, integer)',
    'public.site_access_finish_upload(uuid, uuid, integer, text, uuid)',
    'public.site_access_page_documents(uuid, text[])',
    'public.site_access_document_for_delivery_v2(uuid, uuid, text[])']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.site_access_document_placements'::regclass) then
    raise exception '054 self-check: RLS disabled on site_access_document_placements';
  end if;
  if has_table_privilege('anon', 'public.site_access_document_placements', 'SELECT')
     or has_table_privilege('authenticated', 'public.site_access_document_placements', 'SELECT') then
    raise exception '054 self-check: placements reachable by anon/authenticated';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_access_document_placements') then
    raise exception '054 self-check: placements must have no policies';
  end if;
  if has_function_privilege('anon', 'public.site_access_page_documents(uuid, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_document_for_delivery_v2(uuid, uuid, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_begin_upload_v2(uuid, uuid, text[], text, integer, text, text, uuid, integer)', 'EXECUTE') then
    raise exception '054 self-check: document functions reachable by anon/authenticated';
  end if;
  if exists (select 1 from public.site_access_documents where visibility <> 'groups') then
    raise exception '054 self-check: existing documents must stay group documents';
  end if;
  if (select count(*) from public.grantable_permissions where id in ('documents.document.read', 'documents.document.manage')) <> 2 then
    raise exception '054 self-check: grantable rows missing';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-access-files' and not public and file_size_limit = 20971520
                    and allowed_mime_types @> array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) then
    raise exception '054 self-check: bucket site-access-files missing, public, not 20 MB or without image types';
  end if;
  raise notice '054 self-check passed';
end $$;

drop function pg_temp.drop_column_checks(text, text);

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   select count(*) from pg_tables where schemaname = 'public' and tablename like 'site_access_%';   -- 14
--   select column_name from information_schema.columns where table_name = 'site_access_documents' and column_name = 'visibility';  -- 1 row
--   select allowed_mime_types from storage.buckets where id = 'site-access-files';   -- 4 types
--   select id from public.grantable_permissions where id like 'documents.%';         -- 2 rows
--   Harness: cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-054
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   supabase/verify/rollback-054.sql (refuses once a document is public, has a
--   note, category, tags, a placement, an image file or a file shared by
--   several languages — undoing would lose or misread that data).

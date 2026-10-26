-- ============================================================
-- Migration 052 — Site Access: protected documents (ADR-040 B2.4, Tom 2026-10-24)
--
-- NOT APPLIED. Additive only. Requires 050. Apply AFTER the code that reads it
-- is deployed (2026-08-14 rule), together with or after 050/051.
--
-- 050 created the document tables and the private bucket. This adds the
-- operations around them:
--
--   site_access_uploads        one row per direct-to-storage upload: reserved
--                              BEFORE the browser uploads (path chosen here,
--                              never by the client), finished only after the
--                              server has checked the stored object (type,
--                              size, sha256), or failed / expired
--   site_access_storage_trash  storage objects to remove: a replaced file, a
--                              failed or abandoned upload. The sweep removes an
--                              object ONLY while no document file row points
--                              at it — an active document is never deleted
--
--   functions (service_role only, SECURITY INVOKER, all project-scoped):
--     site_access_create_document / _update_document / _set_document_groups /
--     _set_document_archived, site_access_begin_upload / _finish_upload /
--     _fail_upload, site_access_document_for_delivery, site_access_expire_uploads,
--     site_access_trash_batch / _trash_done
--
-- Nothing is ever deleted from site_access_documents or _document_files here:
-- documents are archived (Tom: archive, don't delete). Replacing a language's
-- file swaps the row in one transaction and queues the old object for removal.
--
-- Same rules as 050: RLS on, no grants and no policies for anon /
-- authenticated, composite (id, project_id) foreign keys for isolation.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.site_access_documents') is null then
    raise exception '052: public.site_access_documents missing — migration 050 is not applied';
  end if;
  if to_regclass('public.site_access_uploads') is not null then
    raise exception '052: already applied — stop';
  end if;
end $$;


-- ── Uploads ──────────────────────────────────────────────────────────────────
create table public.site_access_uploads (
  id                 uuid        primary key default gen_random_uuid(),
  project_id         uuid        not null references public.projects (id) on delete cascade,
  document_id        uuid        not null,
  locale             text        not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- '<project_id>/<uuid>.pdf' — chosen by the database, never by the client.
  storage_path       text        not null unique
                       check (storage_path like project_id::text || '/%'
                              and storage_path ~ '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'),
  declared_size      integer     not null check (declared_size > 0 and declared_size <= 20971520),
  declared_sha256    text        not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  original_filename  text        check (original_filename is null or char_length(original_filename) <= 200),
  status             text        not null default 'pending' check (status in ('pending', 'finished', 'failed', 'expired')),
  created_by         uuid        references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  finished_at        timestamptz,
  foreign key (document_id, project_id) references public.site_access_documents (id, project_id) on delete cascade
);
create index site_access_uploads_pending on public.site_access_uploads (expires_at) where status = 'pending';
create index site_access_uploads_project on public.site_access_uploads (project_id, created_at);


-- ── Storage trash ────────────────────────────────────────────────────────────
create table public.site_access_storage_trash (
  storage_path  text        primary key check (storage_path like project_id::text || '/%'),
  project_id    uuid        not null references public.projects (id) on delete cascade,
  reason        text        not null check (reason in ('replaced', 'failed_upload', 'expired_upload')),
  queued_at     timestamptz not null default now()
);
create index site_access_storage_trash_queued on public.site_access_storage_trash (queued_at);


-- ── Audit actions for documents ──────────────────────────────────────────────
alter table public.site_access_events drop constraint site_access_events_action_check;
alter table public.site_access_events add constraint site_access_events_action_check check (action in (
  'group_created', 'group_updated', 'group_archived', 'group_restored',
  'credential_created', 'credential_updated', 'credential_rotated',
  'credential_disabled', 'credential_enabled', 'credential_groups_changed',
  'sessions_revoked',
  'document_created', 'document_updated', 'document_archived', 'document_restored',
  'document_groups_changed', 'document_file_uploaded', 'document_file_replaced'));


-- ── Documents ────────────────────────────────────────────────────────────────
create function public.site_access_create_document(p_project_id uuid, p_title jsonb, p_group_ids uuid[], p_actor uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.site_access_documents (project_id, title, created_by)
  values (p_project_id, p_title, p_actor)
  returning id into v_id;
  -- Composite FK: a group of another project is refused here (23503).
  insert into public.site_access_document_groups (document_id, group_id, project_id)
  select v_id, g, p_project_id from unnest(coalesce(p_group_ids, '{}'::uuid[])) as g
  on conflict do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id)
  values (p_project_id, p_actor, 'document_created', v_id);
  return v_id;
end $$;

create function public.site_access_update_document(p_project_id uuid, p_document_id uuid, p_title jsonb, p_sort_order integer, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.site_access_documents
     set title = coalesce(p_title, title),
         sort_order = coalesce(p_sort_order, sort_order)
   where id = p_document_id and project_id = p_project_id;
  if not found then raise exception 'site_access:not_found'; end if;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id)
  values (p_project_id, p_actor, 'document_updated', p_document_id);
end $$;

create function public.site_access_set_document_groups(p_project_id uuid, p_document_id uuid, p_group_ids uuid[], p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.site_access_documents where id = p_document_id and project_id = p_project_id for update;
  if not found then raise exception 'site_access:not_found'; end if;
  delete from public.site_access_document_groups where document_id = p_document_id and project_id = p_project_id;
  insert into public.site_access_document_groups (document_id, group_id, project_id)
  select p_document_id, g, p_project_id from unnest(coalesce(p_group_ids, '{}'::uuid[])) as g
  on conflict do nothing;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'document_groups_changed', p_document_id,
          jsonb_build_object('groups', coalesce(cardinality(p_group_ids), 0)));
end $$;

create function public.site_access_set_document_archived(p_project_id uuid, p_document_id uuid, p_archived boolean, p_actor uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.site_access_documents
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end
   where id = p_document_id and project_id = p_project_id;
  if not found then raise exception 'site_access:not_found'; end if;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id)
  values (p_project_id, p_actor, case when p_archived then 'document_archived' else 'document_restored' end, p_document_id);
end $$;


-- ── Uploads ──────────────────────────────────────────────────────────────────
-- Reserve an upload for one language of one document of THIS project. The
-- storage path is generated here. At most 20 pending uploads per project.
create function public.site_access_begin_upload(
  p_project_id uuid, p_document_id uuid, p_locale text, p_size integer, p_sha256 text,
  p_filename text, p_actor uuid, p_ttl_seconds integer
) returns table (upload_id uuid, storage_path text, expires_at timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid := gen_random_uuid(); v_path text; v_expires timestamptz; n integer;
begin
  if p_ttl_seconds < 60 or p_ttl_seconds > 86400 then raise exception 'site_access:invalid_ttl'; end if;
  perform 1 from public.site_access_documents d
   where d.id = p_document_id and d.project_id = p_project_id and d.archived_at is null;
  if not found then raise exception 'site_access:not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('site_access_upload:' || p_project_id::text, 0));
  select count(*) into n from public.site_access_uploads u
   where u.project_id = p_project_id and u.status = 'pending' and u.expires_at > now();
  if n >= 20 then raise exception 'site_access:too_many_uploads'; end if;
  v_path := p_project_id::text || '/' || gen_random_uuid()::text || '.pdf';
  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.site_access_uploads
    (id, project_id, document_id, locale, storage_path, declared_size, declared_sha256, original_filename, created_by, expires_at)
  values (v_id, p_project_id, p_document_id, p_locale, v_path, p_size, lower(p_sha256), p_filename, p_actor, v_expires);
  return query select v_id, v_path, v_expires;
end $$;

-- Called by the SERVER after it has downloaded the stored object and checked
-- it (PDF signature, size, sha256). The measured size and hash must equal what
-- was declared. Swaps the document's file for that language atomically; the
-- previous object (if any) is queued for removal. Returns the replaced path.
create function public.site_access_finish_upload(
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

-- A rejected upload (wrong type, size or hash; nothing uploaded): its object,
-- if any, is queued for removal. Idempotent; finished uploads are untouched.
create function public.site_access_fail_upload(p_project_id uuid, p_upload_id uuid)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare v_path text;
begin
  update public.site_access_uploads set status = 'failed', finished_at = now()
   where id = p_upload_id and project_id = p_project_id and status = 'pending'
  returning storage_path into v_path;
  if v_path is not null then
    insert into public.site_access_storage_trash (storage_path, project_id, reason)
    values (v_path, p_project_id, 'failed_upload') on conflict do nothing;
  end if;
end $$;


-- ── Delivery read (one round trip per file request) ─────────────────────────
-- The first language in p_locales that has a file, for a document of THIS
-- project. Zero rows for an unknown id, another project's id, or no file in
-- any of the languages. Archived documents are returned flagged so the caller
-- refuses them exactly like an unknown id.
create function public.site_access_document_for_delivery(p_project_id uuid, p_document_id uuid, p_locales text[])
returns table (archived boolean, title jsonb, group_ids uuid[], locale text, storage_path text, size_bytes integer, sha256 text)
language sql
stable
set search_path = public, pg_temp
as $$
  select d.archived_at is not null,
         d.title,
         coalesce((select array_agg(g.group_id order by g.group_id)
                     from public.site_access_document_groups g
                     join public.site_access_groups sg on sg.id = g.group_id and sg.project_id = g.project_id
                    where g.document_id = d.id and g.project_id = d.project_id and sg.archived_at is null), '{}'::uuid[]),
         f.locale, f.storage_path, f.size_bytes, f.sha256
    from public.site_access_documents d
    join public.site_access_document_files f on f.document_id = d.id and f.project_id = d.project_id
    join unnest(p_locales) with ordinality as l(code, ord) on l.code = f.locale
   where d.id = p_document_id and d.project_id = p_project_id
   order by l.ord
   limit 1
$$;


-- ── Sweep (daily cron) ───────────────────────────────────────────────────────
-- Pending uploads past their expiry become 'expired' and their objects are
-- queued. Returns how many expired.
create function public.site_access_expire_uploads(p_limit integer default 500)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  with expired as (
    update public.site_access_uploads u set status = 'expired', finished_at = now()
     where u.id in (select id from public.site_access_uploads
                     where status = 'pending' and expires_at <= now()
                     order by expires_at limit greatest(p_limit, 1)
                     for update skip locked)
    returning u.storage_path, u.project_id
  ), queued as (
    insert into public.site_access_storage_trash (storage_path, project_id, reason)
    select storage_path, project_id, 'expired_upload' from expired
    on conflict do nothing
    returning 1
  )
  select count(*) into n from expired;
  return n;
end $$;

-- The next objects to remove. A path that a document file row points at is
-- NEVER returned (it is dropped from the trash instead: the file is active).
create function public.site_access_trash_batch(p_limit integer default 200)
returns table (storage_path text, project_id uuid)
language plpgsql
set search_path = public, pg_temp
as $$
begin
  delete from public.site_access_storage_trash t
   where exists (select 1 from public.site_access_document_files f where f.storage_path = t.storage_path);
  return query
    select t.storage_path, t.project_id from public.site_access_storage_trash t
     where not exists (select 1 from public.site_access_document_files f where f.storage_path = t.storage_path)
       and not exists (select 1 from public.site_access_uploads u where u.storage_path = t.storage_path and u.status = 'pending' and u.expires_at > now())
     order by t.queued_at
     limit greatest(p_limit, 1);
end $$;

-- Objects the sweep has removed from storage. Still refuses to forget a path
-- that has become active in the meantime.
create function public.site_access_trash_done(p_paths text[])
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from public.site_access_storage_trash t
   where t.storage_path = any (p_paths)
     and not exists (select 1 from public.site_access_document_files f where f.storage_path = t.storage_path);
  get diagnostics n = row_count;
  return n;
end $$;


-- ── Lock everything to the service role ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['site_access_uploads', 'site_access_storage_trash'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;
  foreach f in array array[
    'public.site_access_create_document(uuid, jsonb, uuid[], uuid)',
    'public.site_access_update_document(uuid, uuid, jsonb, integer, uuid)',
    'public.site_access_set_document_groups(uuid, uuid, uuid[], uuid)',
    'public.site_access_set_document_archived(uuid, uuid, boolean, uuid)',
    'public.site_access_begin_upload(uuid, uuid, text, integer, text, text, uuid, integer)',
    'public.site_access_finish_upload(uuid, uuid, integer, text, uuid)',
    'public.site_access_fail_upload(uuid, uuid)',
    'public.site_access_document_for_delivery(uuid, uuid, text[])',
    'public.site_access_expire_uploads(integer)',
    'public.site_access_trash_batch(integer)',
    'public.site_access_trash_done(text[])']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['site_access_uploads', 'site_access_storage_trash'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '052 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'SELECT') then
      raise exception '052 self-check: % reachable by anon/authenticated', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '052 self-check: % must have no policies', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.site_access_document_for_delivery(uuid, uuid, text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_begin_upload(uuid, uuid, text, integer, text, text, uuid, integer)', 'EXECUTE') then
    raise exception '052 self-check: document functions reachable by anon/authenticated';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-access-files' and not public and file_size_limit = 20971520) then
    raise exception '052 self-check: bucket site-access-files missing, public or not 20 MB';
  end if;
  raise notice '052 self-check passed';
end $$;

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   select count(*) from pg_tables where schemaname = 'public' and tablename like 'site_access_%';  -- 13
--   Harness: cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-052
--
-- ── Rollback (only while no upload has finished through it) ──────────────────
--   begin;
--   drop function if exists public.site_access_trash_done(text[]), public.site_access_trash_batch(integer),
--     public.site_access_expire_uploads(integer), public.site_access_document_for_delivery(uuid, uuid, text[]),
--     public.site_access_fail_upload(uuid, uuid), public.site_access_finish_upload(uuid, uuid, integer, text, uuid),
--     public.site_access_begin_upload(uuid, uuid, text, integer, text, text, uuid, integer),
--     public.site_access_set_document_archived(uuid, uuid, boolean, uuid),
--     public.site_access_set_document_groups(uuid, uuid, uuid[], uuid),
--     public.site_access_update_document(uuid, uuid, jsonb, integer, uuid),
--     public.site_access_create_document(uuid, jsonb, uuid[], uuid);
--   drop table if exists public.site_access_storage_trash, public.site_access_uploads;
--   -- the widened events check stays (it only allows more values)
--   commit;

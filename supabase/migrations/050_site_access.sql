-- ============================================================
-- Migration 050 — Site Access (ADR-040, Tom 2026-10-24)
--
-- NOT APPLIED. Additive only. Apply AFTER the code that reads it is deployed
-- (2026-08-14 rule). The B1 code is a library with no route or page calling it
-- yet, so applying early is harmless, but keep the order anyway.
--
-- Website VISITOR access to restricted pages and protected files. This is a
-- separate identity plane from the dashboard: nothing here references
-- auth.users for visitors, and no row here can satisfy any dashboard check.
-- (auth.users appears only as the ACTOR of a management change.)
--
-- ── What ───────────────────────────────────────────────────────────────────
--   site_access_groups            audiences ("Members", "Teachers", "Staff")
--   site_access_credentials       how a visitor proves something. Phase 1:
--                                 kind = 'shared_password' only
--   site_access_credential_secrets the password hash, in its own table
--   site_access_credential_groups which groups a credential opens (N:M)
--   site_access_sessions          one per browser per project AND environment;
--                                 only the sha256 of the cookie token is stored
--   site_access_session_grants    "this session typed credential X at
--                                 version V" — groups are resolved LIVE
--   site_access_attempts          rate-limit store (salted IP hashes only);
--                                 reserved atomically BEFORE a password is checked
--   site_access_documents         a protected document ("Timetable")
--   site_access_document_files    one file per language, in the private bucket
--   site_access_document_groups   which groups may open a document (N:M)
--   site_access_events            management audit trail (never a secret)
--   storage bucket                site-access-files (PRIVATE, PDF, 20 MB)
--
-- ── Isolation is in the schema, not only in the code ──────────────────────
--   Every link table carries project_id and uses COMPOSITE foreign keys
--   (id, project_id), so a credential of project A cannot be linked to a
--   group of project B, a grant cannot point at another project's credential,
--   and a document cannot allow another project's group — the database
--   refuses the row.
--
-- ── Environments (B2.0, Tom 2026-10-24) ───────────────────────────────────
--   dev, preview and production share this database. A SESSION is bound to
--   the environment that created it ('production' | 'preview' | 'dev' |
--   'local') and is only ever resolved there. Everything else is
--   PROJECT-level and deliberately shared across environments: groups,
--   passwords (a rotation on dev rotates production), documents, the audit
--   trail and the rate-limit counts (stricter, not looser). "Sign out
--   everyone" signs out every environment.
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   Every table: RLS on, NO grants and NO policies for anon / authenticated.
--   Visitors never talk to Supabase; dashboard users reach this only through
--   server code after the module permission check. Write paths that must be
--   atomic are SECURITY INVOKER functions executable by service_role only.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.projects') is null then
    raise exception '050: public.projects missing';
  end if;
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '050: public.set_updated_at() missing — migration 005 is not applied';
  end if;
  if to_regclass('public.site_access_groups') is not null then
    raise exception '050: already applied — stop';
  end if;
end $$;


-- ── Groups ───────────────────────────────────────────────────────────────────
create table public.site_access_groups (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references public.projects (id) on delete cascade,
  -- Localized: a group name may be shown to visitors ("Teachers' area").
  name         jsonb       not null check (jsonb_typeof(name) = 'object' and name <> '{}'::jsonb),
  description  text        check (description is null or char_length(description) <= 500),
  sort_order   integer     not null default 0,
  archived_at  timestamptz,                       -- never deleted (Tom: archive, don't delete)
  created_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, project_id)
);
create index site_access_groups_project on public.site_access_groups (project_id) where archived_at is null;


-- ── Credentials ──────────────────────────────────────────────────────────────
create table public.site_access_credentials (
  id              uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.projects (id) on delete cascade,
  kind            text        not null default 'shared_password' check (kind in ('shared_password')),
  label           text        not null check (char_length(btrim(label)) between 1 and 80),  -- admin-only, never public
  secret_version  integer     not null default 1 check (secret_version >= 1),
  expires_at      timestamptz,
  disabled_at     timestamptz,
  created_by      uuid        references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  rotated_at      timestamptz,
  rotated_by      uuid        references auth.users (id) on delete set null,
  unique (id, project_id)
);
create index site_access_credentials_project on public.site_access_credentials (project_id) where disabled_at is null;

-- Split out so that no future select of the credential list can ever carry a hash.
create table public.site_access_credential_secrets (
  credential_id  uuid        primary key references public.site_access_credentials (id) on delete cascade,
  password_hash  text        not null check (password_hash like 'scrypt$%'),
  updated_at     timestamptz not null default now()
);

create table public.site_access_credential_groups (
  credential_id  uuid not null,
  group_id       uuid not null,
  project_id     uuid not null,
  primary key (credential_id, group_id),
  foreign key (credential_id, project_id) references public.site_access_credentials (id, project_id) on delete cascade,
  foreign key (group_id, project_id)      references public.site_access_groups (id, project_id)      on delete cascade
);
create index site_access_credential_groups_group on public.site_access_credential_groups (group_id);


-- ── Sessions and grants ──────────────────────────────────────────────────────
create table public.site_access_sessions (
  id              uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.projects (id) on delete cascade,
  token_hash      text        not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  environment     text        not null check (environment in ('production', 'preview', 'dev', 'local')),
  device_label    text        check (device_label is null or char_length(device_label) <= 80),
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_reason  text        check (revoked_reason is null or revoked_reason in
                    ('logout', 'credential_rotated', 'credential_disabled', 'revoked_by_admin', 'revoked_all')),
  revoked_by      uuid        references auth.users (id) on delete set null,
  unique (id, project_id)
);
create index site_access_sessions_project_live on public.site_access_sessions (project_id) where revoked_at is null;
create index site_access_sessions_expiry on public.site_access_sessions (expires_at);

create table public.site_access_session_grants (
  session_id          uuid        not null,
  credential_id       uuid        not null,
  project_id          uuid        not null,
  credential_version  integer     not null,
  -- Phase 2 hook: a personal identity will be a second grant source. Kept
  -- nullable and un-referenced until that table exists.
  subject_id          uuid,
  granted_at          timestamptz not null default now(),
  primary key (session_id, credential_id),
  foreign key (session_id, project_id)    references public.site_access_sessions (id, project_id)    on delete cascade,
  foreign key (credential_id, project_id) references public.site_access_credentials (id, project_id) on delete cascade
);
create index site_access_session_grants_credential on public.site_access_session_grants (credential_id);


-- ── Rate-limit store ─────────────────────────────────────────────────────────
create table public.site_access_attempts (
  id           bigint      generated always as identity primary key,
  project_id   uuid        not null references public.projects (id) on delete cascade,
  ip_hash      text        not null check (ip_hash ~ '^[0-9a-f]{64}$'),   -- sha256(ip /64 || ACCESS_IP_SALT)
  -- null = PENDING: reserved, password not yet checked. A pending attempt
  -- counts as a failure until it is finished, and like a failure it stops
  -- counting when it leaves the window — an abandoned one (function timeout,
  -- crash) can never block anyone for longer than one window.
  succeeded    boolean,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index site_access_attempts_project_ip on public.site_access_attempts (project_id, ip_hash, created_at);
create index site_access_attempts_project    on public.site_access_attempts (project_id, created_at);
create index site_access_attempts_ip         on public.site_access_attempts (ip_hash, created_at);


-- ── Protected documents ──────────────────────────────────────────────────────
create table public.site_access_documents (
  id           uuid        primary key default gen_random_uuid(),
  project_id   uuid        not null references public.projects (id) on delete cascade,
  title        jsonb       not null check (jsonb_typeof(title) = 'object' and title <> '{}'::jsonb),
  sort_order   integer     not null default 0,
  archived_at  timestamptz,
  created_by   uuid        references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, project_id)
);
create index site_access_documents_project on public.site_access_documents (project_id) where archived_at is null;

create table public.site_access_document_files (
  id                 uuid        primary key default gen_random_uuid(),
  document_id        uuid        not null,
  project_id         uuid        not null,
  locale             text        not null check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- '<project_id>/<file uuid>.pdf' — no titles or filenames in the path.
  storage_path       text        not null unique check (storage_path like project_id::text || '/%'),
  mime_type          text        not null check (mime_type = 'application/pdf'),
  size_bytes         integer     not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256             text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_filename  text        check (original_filename is null or char_length(original_filename) <= 200),
  uploaded_by        uuid        references auth.users (id) on delete set null,
  uploaded_at        timestamptz not null default now(),
  unique (document_id, locale),
  foreign key (document_id, project_id) references public.site_access_documents (id, project_id) on delete cascade
);

create table public.site_access_document_groups (
  document_id  uuid not null,
  group_id     uuid not null,
  project_id   uuid not null,
  primary key (document_id, group_id),
  foreign key (document_id, project_id) references public.site_access_documents (id, project_id) on delete cascade,
  foreign key (group_id, project_id)    references public.site_access_groups (id, project_id)    on delete cascade
);


-- ── Audit trail ──────────────────────────────────────────────────────────────
-- Named apart from access_audit_log (049), which is about DASHBOARD access.
create table public.site_access_events (
  id             bigint      generated always as identity primary key,
  project_id     uuid        not null references public.projects (id) on delete cascade,
  actor_user_id  uuid        references auth.users (id) on delete set null,
  action         text        not null check (action in (
                   'group_created', 'group_updated', 'group_archived', 'group_restored',
                   'credential_created', 'credential_updated', 'credential_rotated',
                   'credential_disabled', 'credential_enabled', 'credential_groups_changed',
                   'sessions_revoked')),
  target_id      uuid,
  detail         jsonb       not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at     timestamptz not null default now()
);
create index site_access_events_project on public.site_access_events (project_id, created_at desc);


-- ── updated_at ───────────────────────────────────────────────────────────────
create trigger site_access_groups_set_updated_at      before update on public.site_access_groups      for each row execute function public.set_updated_at();
create trigger site_access_credentials_set_updated_at before update on public.site_access_credentials for each row execute function public.set_updated_at();
create trigger site_access_documents_set_updated_at   before update on public.site_access_documents   for each row execute function public.set_updated_at();


-- ── Operational limits (per project) ─────────────────────────────────────────
create function public.site_access_enforce_limits() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if tg_table_name = 'site_access_groups' then
    select count(*) into n from public.site_access_groups where project_id = new.project_id;
    if n >= 100 then raise exception 'site_access:too_many_groups'; end if;
  elsif tg_table_name = 'site_access_credentials' then
    select count(*) into n from public.site_access_credentials where project_id = new.project_id;
    if n >= 50 then raise exception 'site_access:too_many_credentials'; end if;
  elsif tg_table_name = 'site_access_documents' then
    select count(*) into n from public.site_access_documents where project_id = new.project_id;
    if n >= 500 then raise exception 'site_access:too_many_documents'; end if;
  elsif tg_table_name = 'site_access_session_grants' then
    select count(*) into n from public.site_access_session_grants where session_id = new.session_id;
    if n >= 20 then raise exception 'site_access:too_many_grants'; end if;
  end if;
  return new;
end $$;
create trigger site_access_groups_limit      before insert on public.site_access_groups         for each row execute function public.site_access_enforce_limits();
create trigger site_access_credentials_limit before insert on public.site_access_credentials    for each row execute function public.site_access_enforce_limits();
create trigger site_access_documents_limit   before insert on public.site_access_documents      for each row execute function public.site_access_enforce_limits();
create trigger site_access_grants_limit      before insert on public.site_access_session_grants for each row execute function public.site_access_enforce_limits();


-- ── Lock every table to the service role ─────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['site_access_groups', 'site_access_credentials', 'site_access_credential_secrets',
                           'site_access_credential_groups', 'site_access_sessions', 'site_access_session_grants',
                           'site_access_attempts', 'site_access_documents', 'site_access_document_files',
                           'site_access_document_groups', 'site_access_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;
end $$;


-- ── Read path: resolve a visitor (one round trip per protected request) ──────
-- Returns ZERO rows when the token is unknown, belongs to another project or
-- another ENVIRONMENT, is revoked or expired. Otherwise the session and its LIVE groups: a grant counts
-- only while its credential is enabled, unexpired, still at the version that
-- was typed, and the group is not archived. Group membership of a credential
-- is read live, so changing it takes effect on the next request.
create function public.site_access_resolve(p_project_id uuid, p_token_hash text, p_environment text, p_touch boolean default true)
returns table (session_id uuid, expires_at timestamptz, group_ids uuid[], credential_ids uuid[])
language plpgsql
set search_path = public, pg_temp
as $$
declare v_session public.site_access_sessions%rowtype;
begin
  select * into v_session
    from public.site_access_sessions s
   where s.token_hash = p_token_hash
     and s.project_id = p_project_id
     and s.environment = p_environment
     and s.revoked_at is null
     and s.expires_at > now();
  if not found then return; end if;

  if p_touch and v_session.last_seen_at < now() - interval '5 minutes' then
    update public.site_access_sessions set last_seen_at = now() where id = v_session.id;
  end if;

  return query
    select v_session.id,
           v_session.expires_at,
           coalesce(array_agg(distinct cg.group_id) filter (where g.id is not null), '{}'::uuid[]),
           coalesce(array_agg(distinct c.id), '{}'::uuid[])
      from public.site_access_session_grants sg
      join public.site_access_credentials c
        on c.id = sg.credential_id
       and c.project_id = p_project_id
       and c.disabled_at is null
       and (c.expires_at is null or c.expires_at > now())
       and c.secret_version = sg.credential_version
      left join public.site_access_credential_groups cg
        on cg.credential_id = c.id
      left join public.site_access_groups g
        on g.id = cg.group_id
       and g.project_id = p_project_id
       and g.archived_at is null
     where sg.session_id = v_session.id
       and sg.project_id = p_project_id;
end $$;


-- ── Candidates for a password prompt (hashes leave the DB only to the server) ─
-- Usable credentials of the project with their LIVE groups. When p_group_ids
-- is given, only credentials that open at least one of those groups — a prompt
-- never checks a password that could not help with the resource in front of it.
create function public.site_access_candidate_credentials(p_project_id uuid, p_group_ids uuid[] default null)
returns table (credential_id uuid, secret_version integer, password_hash text, group_ids uuid[])
language sql
stable
set search_path = public, pg_temp
as $$
  select c.id, c.secret_version, s.password_hash,
         coalesce(array_agg(g.id order by g.id) filter (where g.id is not null), '{}'::uuid[])
    from public.site_access_credentials c
    join public.site_access_credential_secrets s on s.credential_id = c.id
    left join public.site_access_credential_groups cg on cg.credential_id = c.id
    left join public.site_access_groups g on g.id = cg.group_id and g.project_id = p_project_id and g.archived_at is null
   where c.project_id = p_project_id
     and c.disabled_at is null
     and (c.expires_at is null or c.expires_at > now())
   group by c.id, c.secret_version, s.password_hash
  having p_group_ids is null
      or bool_or(g.id = any (p_group_ids))
   order by c.created_at, c.id
$$;


-- ── Unlock: add a credential grant to a session (creating or ROTATING it) ────
-- The caller has already verified the password (scrypt, in the app) for
-- (p_credential_id, p_credential_version). This function re-checks that the
-- credential belongs to the project, is usable, and is still at that version,
-- then:
--   • a valid current session in THIS project and environment → its token is replaced
--     (session fixation defence), the grant is added, expiry is extended;
--   • otherwise → a new session.
-- It also marks the reserved attempt succeeded. Raises 'site_access:<code>'.
create function public.site_access_unlock(
  p_project_id uuid, p_environment text, p_credential_id uuid, p_credential_version integer,
  p_current_token_hash text, p_new_token_hash text, p_session_seconds integer,
  p_attempt_id bigint, p_device_label text default null
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_session uuid;
begin
  if p_session_seconds is null or p_session_seconds < 300 or p_session_seconds > 31536000 then
    raise exception 'site_access:invalid_session_length';
  end if;
  if p_environment is null or p_environment not in ('production', 'preview', 'dev', 'local') then
    raise exception 'site_access:invalid_environment';
  end if;
  perform 1 from public.site_access_credentials c
   where c.id = p_credential_id and c.project_id = p_project_id
     and c.disabled_at is null and (c.expires_at is null or c.expires_at > now())
     and c.secret_version = p_credential_version
   for share;
  if not found then raise exception 'site_access:credential_unavailable'; end if;

  if p_current_token_hash is not null then
    update public.site_access_sessions s
       set token_hash = p_new_token_hash,
           expires_at = greatest(s.expires_at, now() + make_interval(secs => p_session_seconds)),
           last_seen_at = now()
     where s.token_hash = p_current_token_hash and s.project_id = p_project_id
       and s.environment = p_environment
       and s.revoked_at is null and s.expires_at > now()
    returning s.id into v_session;
  end if;

  if v_session is null then
    insert into public.site_access_sessions (project_id, token_hash, environment, device_label, expires_at)
    values (p_project_id, p_new_token_hash, p_environment, p_device_label, now() + make_interval(secs => p_session_seconds))
    returning id into v_session;
  end if;

  insert into public.site_access_session_grants (session_id, credential_id, project_id, credential_version)
  values (v_session, p_credential_id, p_project_id, p_credential_version)
  on conflict (session_id, credential_id) do update
    set credential_version = excluded.credential_version, granted_at = now();

  if p_attempt_id is not null then
    update public.site_access_attempts
       set succeeded = true, finished_at = now()
     where id = p_attempt_id and project_id = p_project_id and succeeded is null;
  end if;
  return v_session;
end $$;


-- ── Internal: drop a credential's grants and revoke sessions left empty ──────
create function public.site_access_drop_credential_grants(
  p_project_id uuid, p_credential_id uuid, p_reason text, p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_affected uuid[]; v_revoked integer;
begin
  with gone as (
    delete from public.site_access_session_grants
     where credential_id = p_credential_id and project_id = p_project_id
    returning session_id
  )
  select coalesce(array_agg(distinct session_id), '{}') into v_affected from gone;

  update public.site_access_sessions s
     set revoked_at = now(), revoked_reason = p_reason, revoked_by = p_actor
   where s.id = any (v_affected) and s.project_id = p_project_id and s.revoked_at is null
     and not exists (select 1 from public.site_access_session_grants g where g.session_id = s.id);
  get diagnostics v_revoked = row_count;
  return v_revoked;
end $$;


-- ── Management write paths ───────────────────────────────────────────────────
create function public.site_access_create_credential(
  p_project_id uuid, p_label text, p_password_hash text, p_group_ids uuid[],
  p_expires_at timestamptz, p_actor uuid
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  insert into public.site_access_credentials (project_id, label, expires_at, created_by)
  values (p_project_id, p_label, p_expires_at, p_actor)
  returning id into v_id;
  insert into public.site_access_credential_secrets (credential_id, password_hash) values (v_id, p_password_hash);
  -- Composite FK refuses a group of another project.
  insert into public.site_access_credential_groups (credential_id, group_id, project_id)
  select v_id, g, p_project_id from unnest(coalesce(p_group_ids, '{}')) as g;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'credential_created', v_id,
          jsonb_build_object('groups', coalesce(to_jsonb(p_group_ids), '[]'::jsonb)));
  return v_id;
end $$;

create function public.site_access_set_credential_groups(
  p_project_id uuid, p_credential_id uuid, p_group_ids uuid[], p_actor uuid
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.site_access_credentials where id = p_credential_id and project_id = p_project_id for update;
  if not found then raise exception 'site_access:not_found'; end if;
  delete from public.site_access_credential_groups where credential_id = p_credential_id and project_id = p_project_id;
  insert into public.site_access_credential_groups (credential_id, group_id, project_id)
  select p_credential_id, g, p_project_id from unnest(coalesce(p_group_ids, '{}')) as g;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'credential_groups_changed', p_credential_id,
          jsonb_build_object('groups', coalesce(to_jsonb(p_group_ids), '[]'::jsonb)));
end $$;

-- Rotation: new hash, version + 1, every grant from the old password is gone
-- and sessions that held nothing else are revoked. Returns the revoked count.
create function public.site_access_rotate_credential(
  p_project_id uuid, p_credential_id uuid, p_password_hash text, p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_revoked integer;
begin
  update public.site_access_credentials
     set secret_version = secret_version + 1, rotated_at = now(), rotated_by = p_actor
   where id = p_credential_id and project_id = p_project_id;
  if not found then raise exception 'site_access:not_found'; end if;
  update public.site_access_credential_secrets
     set password_hash = p_password_hash, updated_at = now()
   where credential_id = p_credential_id;
  v_revoked := public.site_access_drop_credential_grants(p_project_id, p_credential_id, 'credential_rotated', p_actor);
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, 'credential_rotated', p_credential_id, jsonb_build_object('revokedSessions', v_revoked));
  return v_revoked;
end $$;

-- Disabling also drops grants: re-enabling never silently brings back old
-- sessions — visitors type the password again.
create function public.site_access_set_credential_disabled(
  p_project_id uuid, p_credential_id uuid, p_disabled boolean, p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_revoked integer := 0;
begin
  update public.site_access_credentials
     set disabled_at = case when p_disabled then coalesce(disabled_at, now()) else null end
   where id = p_credential_id and project_id = p_project_id;
  if not found then raise exception 'site_access:not_found'; end if;
  if p_disabled then
    v_revoked := public.site_access_drop_credential_grants(p_project_id, p_credential_id, 'credential_disabled', p_actor);
  end if;
  insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
  values (p_project_id, p_actor, case when p_disabled then 'credential_disabled' else 'credential_enabled' end,
          p_credential_id, jsonb_build_object('revokedSessions', v_revoked));
  return v_revoked;
end $$;

-- One session (logout / admin revoke) or all of a project's sessions.
create function public.site_access_revoke_sessions(
  p_project_id uuid, p_session_id uuid, p_reason text, p_actor uuid
) returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_revoked integer;
begin
  update public.site_access_sessions
     set revoked_at = now(), revoked_reason = p_reason, revoked_by = p_actor
   where project_id = p_project_id and revoked_at is null
     and (p_session_id is null or id = p_session_id);
  get diagnostics v_revoked = row_count;
  if p_reason <> 'logout' then
    insert into public.site_access_events (project_id, actor_user_id, action, target_id, detail)
    values (p_project_id, p_actor, 'sessions_revoked', p_session_id,
            jsonb_build_object('count', v_revoked, 'reason', p_reason));
  end if;
  return v_revoked;
end $$;


-- ── Rate limiting: reserve an attempt ATOMICALLY before checking a password ──
-- One call counts and reserves under a transaction-scoped advisory lock on the
-- IP hash, so parallel requests from one address are serialised: twenty
-- concurrent guesses get exactly the allowance, not twenty checks (B1 review,
-- 2026-10-24). Layers (limits passed in from src/lib/access/rate-limit.ts):
--   1. per IP on this project            p_per_ip failures in the window
--   2. per IP across all projects        p_per_ip_all
--   3. per project, all IPs: at ≥ p_pressure failures the project is under
--      pressure and (1) tightens to p_per_ip_pressure — never to zero, so
--      there is no global lockout an attacker can use against members.
-- Pending (unfinished) attempts count as failures. Allowed → a pending row
-- is inserted and its id returned; refused → nothing is written.
create function public.site_access_reserve_attempt(
  p_project_id uuid, p_ip_hash text, p_window_seconds integer,
  p_per_ip integer, p_per_ip_pressure integer, p_per_ip_all integer, p_pressure integer
) returns table (allowed boolean, attempt_id bigint, under_pressure boolean, retry_after_seconds integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(secs => p_window_seconds);
  v_ip_project integer; v_ip_all integer; v_project integer; v_limit integer; v_id bigint;
  v_pressure boolean;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_window_seconds < 60
     or least(p_per_ip, p_per_ip_pressure, p_per_ip_all, p_pressure) < 1 then
    raise exception 'site_access:invalid_rate_limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('site_access_attempt:' || p_ip_hash, 0));

  select count(*) filter (where project_id = p_project_id), count(*)
    into v_ip_project, v_ip_all
    from public.site_access_attempts
   where ip_hash = p_ip_hash and succeeded is not true and created_at > v_since;
  select count(*) into v_project
    from public.site_access_attempts
   where project_id = p_project_id and succeeded is not true and created_at > v_since;

  v_pressure := v_project >= p_pressure;
  v_limit := case when v_pressure then p_per_ip_pressure else p_per_ip end;
  if v_ip_project >= v_limit or v_ip_all >= p_per_ip_all then
    return query select false, null::bigint, v_pressure, p_window_seconds;
    return;
  end if;

  insert into public.site_access_attempts (project_id, ip_hash) values (p_project_id, p_ip_hash)
  returning id into v_id;
  return query select true, v_id, v_pressure, 0;
end $$;

-- A wrong password (or an unlock that could not complete) finishes the
-- reservation as a failure. Project-scoped; a finished attempt never changes.
create function public.site_access_finish_attempt(p_project_id uuid, p_attempt_id bigint, p_succeeded boolean)
returns void
language sql
set search_path = public, pg_temp
as $$
  update public.site_access_attempts
     set succeeded = p_succeeded, finished_at = now()
   where id = p_attempt_id and project_id = p_project_id and succeeded is null
$$;


-- ── Retention (for the sweep cron in B2) ─────────────────────────────────────
create function public.site_access_purge(p_attempt_days integer default 30, p_session_days integer default 90)
returns table (attempts_deleted integer, sessions_deleted integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare a integer; s integer;
begin
  delete from public.site_access_attempts where created_at < now() - make_interval(days => p_attempt_days);
  get diagnostics a = row_count;
  delete from public.site_access_sessions
   where coalesce(revoked_at, expires_at) < now() - make_interval(days => p_session_days);
  get diagnostics s = row_count;
  return query select a, s;
end $$;


do $$
declare f text;
begin
  foreach f in array array[
    'public.site_access_resolve(uuid, text, text, boolean)',
    'public.site_access_candidate_credentials(uuid, uuid[])',
    'public.site_access_unlock(uuid, text, uuid, integer, text, text, integer, bigint, text)',
    'public.site_access_drop_credential_grants(uuid, uuid, text, uuid)',
    'public.site_access_create_credential(uuid, text, text, uuid[], timestamptz, uuid)',
    'public.site_access_set_credential_groups(uuid, uuid, uuid[], uuid)',
    'public.site_access_rotate_credential(uuid, uuid, text, uuid)',
    'public.site_access_set_credential_disabled(uuid, uuid, boolean, uuid)',
    'public.site_access_revoke_sessions(uuid, uuid, text, uuid)',
    'public.site_access_reserve_attempt(uuid, text, integer, integer, integer, integer, integer)',
    'public.site_access_finish_attempt(uuid, bigint, boolean)',
    'public.site_access_purge(integer, integer)',
    'public.site_access_enforce_limits()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;


-- ── Private bucket for protected files (service role only; signed links) ────
-- 20 MB per file at bucket level. The PROJECT-wide Supabase upload limit must
-- be ≥ 20 MB (Settings → Storage); check it when applying.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-access-files', 'site-access-files', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['site_access_groups', 'site_access_credentials', 'site_access_credential_secrets',
                           'site_access_credential_groups', 'site_access_sessions', 'site_access_session_grants',
                           'site_access_attempts', 'site_access_documents', 'site_access_document_files',
                           'site_access_document_groups', 'site_access_events']
  loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '050 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('anon', format('public.%I', t), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT') then
      raise exception '050 self-check: % reachable by anon/authenticated', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '050 self-check: % must have no policies', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.site_access_resolve(uuid, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.site_access_unlock(uuid, text, uuid, integer, text, text, integer, bigint, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.site_access_reserve_attempt(uuid, text, integer, integer, integer, integer, integer)', 'EXECUTE') then
    raise exception '050 self-check: site access functions reachable by anon/authenticated';
  end if;
  if not exists (select 1 from storage.buckets where id = 'site-access-files' and not public) then
    raise exception '050 self-check: bucket site-access-files missing or public';
  end if;
  raise notice '050 self-check passed';
end $$;

commit;

-- ── Verification (run after applying) ────────────────────────────────────────
--   select count(*) from pg_tables where schemaname = 'public' and tablename like 'site_access_%';  -- 11
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'site-access-files';
--   Harness: cd supabase/verify && npx vitest run --config vitest.config.mjs hardening-050
--
-- ── Rollback (nothing else depends on these objects) ─────────────────────────
--   begin;
--   drop function if exists public.site_access_resolve(uuid, text, text, boolean), … ;   -- see 050 list above
--   drop table if exists public.site_access_events, public.site_access_document_groups,
--     public.site_access_document_files, public.site_access_documents, public.site_access_attempts,
--     public.site_access_session_grants, public.site_access_sessions, public.site_access_credential_groups,
--     public.site_access_credential_secrets, public.site_access_credentials, public.site_access_groups cascade;
--   drop function if exists public.site_access_enforce_limits() cascade;
--   delete from storage.buckets where id = 'site-access-files';   -- only while it holds no objects
--   commit;

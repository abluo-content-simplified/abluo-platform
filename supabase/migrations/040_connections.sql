-- ============================================================
-- Migration 040 — Connections: partner apps, OAuth codes and tokens,
-- removal records (tombstones) and API usage (ADR-031 V1 step 3)
--
-- ⚠️ NOT APPLIED. File only — Tom applies it in the Supabase SQL editor after
-- a rollback snapshot, verifies with supabase/verify/post-apply-040.sql and
-- records the result in supabase/APPLIED.md.
-- Proven first by supabase/verify/hardening-040.verify.mjs.
-- Requires 005 (public.set_updated_at()) and 028 (hardening baseline).
-- Rollback: supabase/verify/rollback-040.sql (refuses once real data exists).
--
-- ── What ─────────────────────────────────────────────────────────────────
-- ADR-031 §3. Nothing reads these tables yet; the OAuth endpoints and the
-- events API arrive in V1 steps 4–5. ADDITIVE ONLY: no existing table, grant
-- or policy changes.
--
--   partner_apps        registered partner applications (TableRes first).
--                       Only Abluo-approved apps may start a Connect.
--   connections         one app × one project (× optional location keys).
--                       What is shared, delivery, status, the consent record.
--   connection_tokens   OAuth access + refresh tokens — SHA-256 hashes only,
--                       a rotation chain, reuse detection support.
--   oauth_codes         single-use, minutes-lived authorization codes (PKCE).
--   api_tombstones      "this item is gone" records, so a partner polling with
--                       updated_since learns about removals (ADR-031 D4).
--   api_usage           one row per API call, per connection (metering).
--
-- ── Security posture (same as 029–039) ──────────────────────────────────
-- Every table: RLS ON, NO grant and NO policy for anon / authenticated, all
-- privileges to service_role only. Partners never touch the database; the
-- server reads/writes with the service role after its own checks.
-- Secrets: only hashes are stored, enforced by CHECK constraints — a column
-- that must hold a 64-hex SHA-256 digest cannot hold a plaintext token.
-- The self-check at the end rolls the whole migration back if anything is off.
-- ============================================================

begin;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '040: public.set_updated_at() missing — apply 005 first';
  end if;
  if to_regprocedure('public.is_abluo_admin()') is null then
    raise exception '040: migration 028 is not applied — apply 028 first';
  end if;
  if to_regclass('public.partner_apps') is not null or to_regclass('public.connections') is not null then
    raise exception '040: already applied (partner_apps / connections exist) — stop';
  end if;
end $$;

-- ── 1. partner_apps ──────────────────────────────────────────────────────────
create table public.partner_apps (
  id                  uuid        primary key default gen_random_uuid(),
  name                text        not null check (length(btrim(name)) between 1 and 120),
  -- Public identifier the partner sends with every OAuth request.
  client_id           text        not null unique check (client_id ~ '^abluo_app_[A-Za-z0-9]{16,64}$'),
  -- SHA-256 (hex) of the client secret. The secret itself is shown once at registration.
  client_secret_hash  text        not null check (client_secret_hash ~ '^[0-9a-f]{64}$'),
  -- Exact redirect URIs (no wildcards). https only, except localhost for the sandbox.
  redirect_uris       text[]      not null check (
                        cardinality(redirect_uris) between 1 and 10
                        and array_position(redirect_uris, null) is null
                      ),
  status              text        not null default 'pending'
                        check (status in ('pending', 'approved', 'suspended')),
  -- Version of the partner terms + data-processing agreement accepted at registration (ADR-031 D8.1).
  terms_version       text        check (terms_version is null or terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  contact_email       text        check (contact_email is null or contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  approved_by         uuid        references auth.users (id) on delete set null,
  approved_at         timestamptz,
  created_by          uuid        references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- An approved app records when; a pending one has never been approved.
  check ((status = 'pending') = (approved_at is null))
);

comment on table public.partner_apps is
  'ADR-031 — partner applications allowed to request a Connection. Only status = approved may start Connect. '
  'client_secret_hash is a SHA-256 hex digest; the secret is never stored. Server-only.';

-- Every redirect URI is exact https://… or http://localhost[:port]/… (sandbox).
create function public.tg_partner_apps_check_redirects()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_uri text;
begin
  foreach v_uri in array new.redirect_uris loop
    if v_uri !~ '^https://[a-z0-9.-]+(:[0-9]{2,5})?(/[^\s#*]*)?$'
       and v_uri !~ '^http://localhost(:[0-9]{2,5})?(/[^\s#*]*)?$' then
      raise exception 'redirect URI not allowed: %', v_uri using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
create trigger partner_apps_check_redirects
  before insert or update of redirect_uris on public.partner_apps
  for each row execute function public.tg_partner_apps_check_redirects();

create trigger partner_apps_updated_at
  before update on public.partner_apps
  for each row execute function public.set_updated_at();

-- ── 2. connections ───────────────────────────────────────────────────────────
create table public.connections (
  id             uuid        primary key default gen_random_uuid(),
  app_id         uuid        not null references public.partner_apps (id) on delete restrict,
  tenant_id      uuid        not null references public.tenants (id) on delete cascade,
  -- Exactly one project. Location keys narrow the data (a filter, NOT a
  -- security boundary — ADR-031 D6); empty = all of the project's locations.
  project_id     uuid        not null references public.projects (id) on delete cascade,
  location_keys  text[]      not null default '{}' check (array_position(location_keys, null) is null),
  -- What is shared: { "<resource>": { "fields": ["title", …], "rule": "all" | "ticked" } }.
  resources      jsonb       not null default '{}'::jsonb check (jsonb_typeof(resources) = 'object'),
  -- V1.2 ownership map: { "<location key>": { "identity": "abluo" | "partner", … } }.
  ownership      jsonb       not null default '{}'::jsonb check (jsonb_typeof(ownership) = 'object'),
  delivery       text[]      not null default '{pull}'
                   check (cardinality(delivery) between 1 and 2 and delivery <@ array['pull', 'push']::text[]),
  status         text        not null default 'active'
                   check (status in ('active', 'paused', 'needs_reconnect', 'revoked')),
  -- Why it is paused (tenant, module uninstalled, app suspended, …) — for the health screen.
  status_reason  text        check (status_reason is null or length(status_reason) <= 200),
  -- Test-mode connection against a demo project (ADR-031 D8.3).
  sandbox        boolean     not null default false,
  -- The consent record: who approved what, when (ADR-031 D8.1). Required.
  consent        jsonb       not null check (
                   jsonb_typeof(consent) = 'object'
                   and consent ? 'by' and consent ? 'at' and consent ? 'resources'
                 ),
  created_by     uuid        references auth.users (id) on delete set null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.connections is
  'ADR-031 D1 — one partner app × one project. Revoking ends every token at once. Server-only.';

-- One live connection per app per project; revoked ones are history.
create unique index connections_one_live_per_app_project
  on public.connections (app_id, project_id) where status <> 'revoked';
create index connections_project on public.connections (project_id, status);
create index connections_app on public.connections (app_id, status);

-- The project must belong to the tenant named on the row.
create function public.tg_connections_project_in_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A missing project/tenant is reported by NOT NULL, not here.
  if new.project_id is null or new.tenant_id is null then
    return new;
  end if;
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.tenant_id = new.tenant_id) then
    raise exception 'project % does not belong to tenant %', new.project_id, new.tenant_id using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger connections_project_in_tenant
  before insert or update of project_id, tenant_id on public.connections
  for each row execute function public.tg_connections_project_in_tenant();

-- A connection never moves to another app or project: identity is fixed.
create function public.tg_connections_identity_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.app_id <> old.app_id or new.project_id <> old.project_id or new.tenant_id <> old.tenant_id then
    raise exception 'a connection cannot change app, tenant or project' using errcode = '23514';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'a revoked connection cannot be reactivated — connect again' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger connections_identity_fixed
  before update on public.connections
  for each row execute function public.tg_connections_identity_fixed();

create trigger connections_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

-- ── 3. connection_tokens ─────────────────────────────────────────────────────
create table public.connection_tokens (
  id             uuid        primary key default gen_random_uuid(),
  connection_id  uuid        not null references public.connections (id) on delete cascade,
  kind           text        not null check (kind in ('access', 'refresh')),
  -- SHA-256 (hex) of the token. The token itself is returned to the partner once.
  token_hash     text        not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- First characters, for support and secret-scanning reports (never enough to use).
  token_prefix   text        not null check (token_prefix ~ '^abluo_(at|rt)_[A-Za-z0-9]{4}$'),
  expires_at     timestamptz not null,
  -- Rotation: a used refresh token is retired and points at its successor.
  replaced_by    uuid        references public.connection_tokens (id) on delete set null,
  retired_at     timestamptz,
  revoked_at     timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (expires_at > created_at),
  check (kind = 'refresh' or replaced_by is null),
  check (token_prefix like case kind when 'access' then 'abluo_at_%' else 'abluo_rt_%' end)
);

comment on table public.connection_tokens is
  'ADR-031 D2 — OAuth tokens as SHA-256 hashes. Refresh tokens rotate (replaced_by/retired_at); '
  'reuse of a retired token outside the grace window revokes the whole connection. Server-only.';

create index connection_tokens_connection on public.connection_tokens (connection_id, kind);
create index connection_tokens_expiry on public.connection_tokens (expires_at);

create trigger connection_tokens_updated_at
  before update on public.connection_tokens
  for each row execute function public.set_updated_at();

-- ── 4. oauth_codes ───────────────────────────────────────────────────────────
create table public.oauth_codes (
  code_hash              text        primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  app_id                 uuid        not null references public.partner_apps (id) on delete cascade,
  connection_id          uuid        not null references public.connections (id) on delete cascade,
  -- PKCE S256 challenge: base64url, 43 characters.
  code_challenge         text        not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  code_challenge_method  text        not null default 'S256' check (code_challenge_method = 'S256'),
  -- Must equal one of the app's registered redirect URIs exactly (checked by the server).
  redirect_uri           text        not null check (length(redirect_uri) <= 500),
  expires_at             timestamptz not null,
  used_at                timestamptz,
  created_at             timestamptz not null default now(),
  -- Minutes-lived: never more than 10 minutes.
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

comment on table public.oauth_codes is
  'ADR-031 D2 — single-use authorization codes (hash only, PKCE S256, ≤ 10 minutes). Server-only.';

create index oauth_codes_expiry on public.oauth_codes (expires_at);

-- ── 5. api_tombstones ────────────────────────────────────────────────────────
create table public.api_tombstones (
  id          bigint      generated always as identity primary key,
  project_id  uuid        not null references public.projects (id) on delete cascade,
  -- Contract resource name, e.g. 'event', 'eventVenue', later 'menu'.
  resource    text        not null check (resource ~ '^[a-z][A-Za-z0-9]{1,39}$'),
  public_id   uuid        not null,
  reason      text        not null check (reason in ('deleted', 'unpublished', 'unlisted', 'websiteOnly')),
  removed_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

comment on table public.api_tombstones is
  'ADR-031 D4 — removals visible to pull clients through the updated_since cursor. Server-only.';

create index api_tombstones_cursor on public.api_tombstones (project_id, resource, removed_at);

-- ── 6. api_usage ─────────────────────────────────────────────────────────────
create table public.api_usage (
  id             bigint      generated always as identity primary key,
  connection_id  uuid        not null references public.connections (id) on delete cascade,
  at             timestamptz not null default now(),
  method         text        not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  endpoint       text        not null check (endpoint ~ '^/api/v[0-9]+/[A-Za-z0-9/_{}-]{1,120}$'),
  status         integer     not null check (status between 100 and 599),
  duration_ms    integer     check (duration_ms is null or duration_ms >= 0),
  request_id     text        check (request_id is null or length(request_id) <= 100)
);

comment on table public.api_usage is
  'ADR-031 D4 — one row per partner API call. Totals are summed in SQL, never by selecting rows. Server-only.';

create index api_usage_connection_at on public.api_usage (connection_id, at desc);

-- ── 7. Access: server-only ───────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['partner_apps', 'connections', 'connection_tokens', 'oauth_codes', 'api_tombstones', 'api_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all privileges on table public.%I to service_role', t);
  end loop;
end $$;

-- The two identity sequences: service_role only.
do $$
declare s text;
begin
  foreach s in array array[
    pg_get_serial_sequence('public.api_tombstones', 'id'),
    pg_get_serial_sequence('public.api_usage', 'id')
  ] loop
    execute format('revoke all on sequence %s from anon, authenticated, public', s);
    execute format('grant usage, select on sequence %s to service_role', s);
  end loop;
end $$;

revoke all on function public.tg_partner_apps_check_redirects() from public, anon, authenticated;
revoke all on function public.tg_connections_project_in_tenant() from public, anon, authenticated;
revoke all on function public.tg_connections_identity_fixed() from public, anon, authenticated;

-- ── 8. Self-check ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['partner_apps', 'connections', 'connection_tokens', 'oauth_codes', 'api_tombstones', 'api_usage'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I', t)::regclass) then
      raise exception '040 self-check: RLS disabled on %', t;
    end if;
    if has_table_privilege('authenticated', format('public.%I', t), 'SELECT')
       or has_table_privilege('anon', format('public.%I', t), 'SELECT')
       or has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
       or has_table_privilege('anon', format('public.%I', t), 'INSERT') then
      raise exception '040 self-check: % reachable by API roles', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '040 self-check: % must have no policies', t;
    end if;
    if not has_table_privilege('service_role', format('public.%I', t), 'SELECT') then
      raise exception '040 self-check: service_role cannot read %', t;
    end if;
  end loop;
  raise notice '040 self-check passed';
end $$;

commit;

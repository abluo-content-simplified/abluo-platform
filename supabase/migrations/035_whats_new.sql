-- ============================================================
-- Migration 035 — "What's new": product updates for clients (ADR-030, Tom 2026-10-08)
--
-- NOT APPLIED. Additive. Requires 005 (public.set_updated_at). Safe to apply
-- before or after the code: the client dashboard catches "table missing"
-- (42P01 / PGRST205) and simply shows no "What's new" entry.
--
-- ── What ───────────────────────────────────────────────────────────────────
-- Abluo writes short product updates in the admin dashboard (/whats-new);
-- clients read them in their dashboard ("What's new" in the sidebar / account
-- menu). Content is per language ({en,it,de} jsonb); the client sees its UI
-- language, falling back to en, then any language that is filled.
-- `audience.modules` narrows an update to projects with one of those modules
-- (empty / absent = everyone); matched in the app (src/lib/whats-new/audience.ts).
--
-- ── Who can do what ────────────────────────────────────────────────────────
--   product_updates       authenticated: SELECT published rows only (policy).
--                         No writes for API roles — the admin writes with the
--                         service role behind requireAbluoAdmin().
--   product_update_reads  authenticated: SELECT / INSERT their OWN rows only
--                         (user_id = auth.uid()), and only for a published
--                         update. No update/delete for API roles.
--   storage bucket `product-updates` — public read (the <img>), uploads with
--                         the service role only (same shape as 032 `avatars`).
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '035: public.set_updated_at() missing — migration 005 is not applied';
  end if;
  if to_regclass('public.product_updates') is not null then
    raise exception '035: already applied — stop';
  end if;
end $$;


-- ── product_updates ──────────────────────────────────────────────────────────
create table public.product_updates (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  status        text        not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at  timestamptz,
  title         jsonb       not null default '{}'::jsonb check (jsonb_typeof(title) = 'object'),
  body          jsonb       not null default '{}'::jsonb check (jsonb_typeof(body) = 'object'),
  -- Only https URLs; the app further accepts only this project's public Storage.
  image_url     text        check (image_url is null or image_url ~ '^https://'),
  cta_label     jsonb       check (cta_label is null or jsonb_typeof(cta_label) = 'object'),
  cta_url       text        check (cta_url is null or cta_url ~ '^https://'),
  audience      jsonb       not null default '{}'::jsonb check (jsonb_typeof(audience) = 'object'),
  created_by    uuid        references auth.users (id) on delete set null,
  updated_by    uuid        references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint product_updates_published_has_date check (status <> 'published' or published_at is not null)
);

comment on table public.product_updates is
  'ADR-030 — product updates Abluo publishes for clients ("What''s new"). title/body/cta_label are {en,it,de}. '
  'audience.modules: only projects with one of these modules (empty = everyone). '
  'Clients read published rows under RLS; written by the admin with the service role only.';

create index product_updates_published on public.product_updates (published_at desc) where status = 'published';

create trigger product_updates_set_updated_at
  before update on public.product_updates
  for each row execute function public.set_updated_at();

alter table public.product_updates enable row level security;
revoke all on table public.product_updates from anon, authenticated, public;
grant select on table public.product_updates to authenticated;
grant all privileges on table public.product_updates to service_role;

create policy "Signed-in people read published updates"
  on public.product_updates
  for select
  to authenticated
  using (status = 'published');


-- ── product_update_reads ─────────────────────────────────────────────────────
create table public.product_update_reads (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  update_id  uuid        not null references public.product_updates (id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (user_id, update_id)
);

comment on table public.product_update_reads is
  'ADR-030 — which product updates a person has seen. Each person reads and inserts only their own rows (RLS).';

create index product_update_reads_update on public.product_update_reads (update_id);

alter table public.product_update_reads enable row level security;
revoke all on table public.product_update_reads from anon, authenticated, public;
grant select, insert on table public.product_update_reads to authenticated;
grant all privileges on table public.product_update_reads to service_role;

create policy "People read their own update reads"
  on public.product_update_reads
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The EXISTS runs under the caller's RLS on product_updates, so only a
-- published update can be marked read.
create policy "People mark updates read for themselves"
  on public.product_update_reads
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.product_updates u where u.id = update_id and u.status = 'published')
  );


-- ── Storage bucket for update images (public read, service-role writes) ─────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-updates', 'product-updates', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.product_updates'::regclass) then
    raise exception '035 self-check: RLS disabled on product_updates';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.product_update_reads'::regclass) then
    raise exception '035 self-check: RLS disabled on product_update_reads';
  end if;
  if has_table_privilege('anon', 'public.product_updates', 'SELECT')
     or has_table_privilege('anon', 'public.product_update_reads', 'SELECT') then
    raise exception '035 self-check: readable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.product_updates', 'INSERT')
     or has_table_privilege('authenticated', 'public.product_updates', 'UPDATE')
     or has_table_privilege('authenticated', 'public.product_updates', 'DELETE') then
    raise exception '035 self-check: product_updates writable by authenticated';
  end if;
  if has_table_privilege('authenticated', 'public.product_update_reads', 'UPDATE')
     or has_table_privilege('authenticated', 'public.product_update_reads', 'DELETE') then
    raise exception '035 self-check: product_update_reads updatable/deletable by authenticated';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_updates') <> 1 then
    raise exception '035 self-check: product_updates must have exactly one policy (published read)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_update_reads') <> 2 then
    raise exception '035 self-check: product_update_reads must have exactly two policies (own select, own insert)';
  end if;
  if not exists (select 1 from storage.buckets where id = 'product-updates' and public) then
    raise exception '035 self-check: bucket product-updates missing or not public';
  end if;
  raise notice '035 self-check passed';
end $$;

commit;

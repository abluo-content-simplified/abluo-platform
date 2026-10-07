-- ============================================================
-- Migration 031 — archived people (ADR-028, People list)
--
-- APPLIED 2026-10-07 to production by Tom (SQL editor). See supabase/APPLIED.md.
-- Requires 029. Proven by supabase/verify/hardening-031.verify.mjs.
-- Rollback: supabase/verify/rollback-031.sql.
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- People are archived, not deleted (Tom, 2026-10-07). Archiving REMOVES the
-- project_members row — so every existing access check (RLS helpers,
-- resolver, policies) ends the person's access at once, with nothing new to
-- remember — and keeps this record of what they had, shown in the People
-- list as "Archived" with Restore. Restore re-creates the membership with
-- the same role and extras (the server re-checks no-escalation).
--
-- An archive record grants NOTHING. It is never read by any access check.
-- Server-only: RLS on, no grants, no policies (like invitations).
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.invitations') is null then
    raise exception '031: migration 029 is not applied — apply 029 first';
  end if;
  if to_regclass('public.project_member_archive') is not null then
    raise exception '031: already applied — stop';
  end if;
end $$;

create table public.project_member_archive (
  id                uuid        primary key default gen_random_uuid(),
  project_id        uuid        not null references public.projects (id) on delete cascade,
  user_id           uuid        not null references auth.users (id) on delete cascade,
  role              text        not null check (role in ('admin', 'editor')),
  extra_permissions text[]      not null default '{}',
  member_since      timestamptz,
  archived_at       timestamptz not null default now(),
  archived_by       uuid        references auth.users (id) on delete set null,
  restored_at       timestamptz,
  restored_by       uuid        references auth.users (id) on delete set null,
  -- restored_by may become null later (account deleted); never set without restored_at.
  constraint project_member_archive_restore_complete check (restored_by is null or restored_at is not null)
);

comment on table public.project_member_archive is
  'ADR-028 — people archived from a site. The membership row is deleted on archive (access ends everywhere at once); '
  'this record only remembers role/extras for Restore and for the People list. Grants nothing. Server-only.';

-- At most one open (not restored) archive record per person and site.
create unique index project_member_archive_one_open
  on public.project_member_archive (project_id, user_id)
  where restored_at is null;

-- Same validation as memberships: only grantable project extras.
create function public.tg_validate_archive_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.validate_extra_permissions(new.extra_permissions, 'project');
  return new;
end;
$$;

create trigger project_member_archive_validate_extras
  before insert or update of extra_permissions on public.project_member_archive
  for each row execute function public.tg_validate_archive_extras();

revoke all on function public.tg_validate_archive_extras() from public, anon, authenticated;

alter table public.project_member_archive enable row level security;
revoke all on table public.project_member_archive from anon, authenticated, public;
grant all privileges on table public.project_member_archive to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.project_member_archive'::regclass) then
    raise exception '031 self-check: RLS disabled on project_member_archive';
  end if;
  if has_table_privilege('authenticated', 'public.project_member_archive', 'SELECT')
     or has_table_privilege('anon', 'public.project_member_archive', 'SELECT') then
    raise exception '031 self-check: project_member_archive readable by API roles';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_member_archive') then
    raise exception '031 self-check: project_member_archive must have no policies';
  end if;
  raise notice '031 self-check passed';
end $$;

commit;

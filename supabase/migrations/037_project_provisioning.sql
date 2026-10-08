-- ============================================================
-- Migration 037 — project provisioning runs (admin "New project" wizard)
--
-- ⚠️ NOT APPLIED. File only — Tom applies it (SQL editor) and records the
-- outcome in supabase/APPLIED.md. Apply before or after the code: the wizard
-- shows a calm "apply migration 037" state while the table is missing, and
-- creates nothing.
-- Requires 005 (public.set_updated_at()).
-- Rollback (refuse if any run is not 'completed' and you still need it):
--   drop table public.project_provisioning_runs;
--
-- ── What ─────────────────────────────────────────────────────────────────
-- One row per "New project" run started in the admin dashboard
-- (admin.abluo.app/projects/new). A run executes ordered, idempotent steps —
--   supabase.tenant → supabase.project → sanity.client → sanity.designSystem
--   → sanity.project → sanity.siteConfig → sanity.homePage → invite.owner
-- — with ids chosen ONCE at start (tenant_id, project_id, the Sanity document
-- ids in `plan`). Progress is recorded per step in `steps`, so a failed run is
-- resumed with "Retry" from the step that failed; steps already done are not
-- repeated. The plan (every row and document to write) is stored at start and
-- replayed as-is by every retry.
--
-- tenant_id / project_id are NOT foreign keys on purpose: the run exists
-- before the rows it creates. Runs are never deleted by the application
-- (history of who created which client/project, and when).
--
-- One open run per project slug: a second "New project" for a slug that
-- already has a pending, running or completed run is refused by the unique
-- index below. A FAILED run does not hold the slug (its retry would then fail
-- on the projects table itself, which is the honest outcome).
--
-- ── Access ───────────────────────────────────────────────────────────────
-- Server-only: RLS on, no grants to anon/authenticated, no policies; read and
-- written with the service role behind requireAbluoAdmin() (src/lib/admin/
-- provisioning). Holds the Owner's email — never exposed to API roles.
-- ============================================================

begin;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    raise exception '037: public.set_updated_at() missing — apply 005 first';
  end if;
  if to_regclass('public.project_provisioning_runs') is not null then
    raise exception '037: already applied — stop';
  end if;
end $$;

create table public.project_provisioning_runs (
  id            uuid        primary key default gen_random_uuid(),
  status        text        not null default 'pending'
                  check (status in ('pending', 'running', 'failed', 'completed')),
  tenant_mode   text        not null check (tenant_mode in ('existing', 'new')),
  -- Chosen once at start: the existing client's id, or a fresh one for a new client.
  tenant_id     uuid        not null,
  -- A NEW client's slug follows the wizard's rules; an existing client keeps
  -- whatever slug it already has, so this check is looser than the wizard's.
  tenant_slug   text        not null check (tenant_slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  -- Chosen once at start: the new project's id (projects.id).
  project_id    uuid        not null,
  project_slug  text        not null check (project_slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  -- The validated wizard input (names, languages, design system id, Owner).
  input         jsonb       not null check (jsonb_typeof(input) = 'object'),
  -- Every row and document to write, computed once at start (planProvisioning()).
  plan          jsonb       not null check (jsonb_typeof(plan) = 'object'),
  -- { "<step id>": { "status": "done" | "failed" | "skipped", "at": …, "error"?: …, "message"?: …, "result"?: {…} } }
  steps         jsonb       not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  current_step  text        check (current_step is null or current_step ~ '^[a-z]+\.[a-zA-Z]+$'),
  last_error    text        check (last_error is null or length(last_error) <= 2000),
  attempts      integer     not null default 0 check (attempts >= 0),
  created_by    uuid        references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

comment on table public.project_provisioning_runs is
  'Admin "New project" wizard runs — ordered idempotent provisioning steps with recorded progress (resume with Retry). '
  'Server-only (service role behind requireAbluoAdmin). Never deleted by the application.';

create unique index project_provisioning_runs_open_slug
  on public.project_provisioning_runs (project_slug)
  where status in ('pending', 'running', 'completed');
create index project_provisioning_runs_status on public.project_provisioning_runs (status, updated_at desc);
create index project_provisioning_runs_created on public.project_provisioning_runs (created_at desc);

-- updated_at (shared helper from 005)
create trigger project_provisioning_runs_updated_at
  before update on public.project_provisioning_runs
  for each row execute function public.set_updated_at();

alter table public.project_provisioning_runs enable row level security;
revoke all on table public.project_provisioning_runs from anon, authenticated, public;
grant all privileges on table public.project_provisioning_runs to service_role;


-- ── Self-check ───────────────────────────────────────────────────────────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.project_provisioning_runs'::regclass) then
    raise exception '037 self-check: RLS disabled on project_provisioning_runs';
  end if;
  if has_table_privilege('authenticated', 'public.project_provisioning_runs', 'SELECT')
     or has_table_privilege('anon', 'public.project_provisioning_runs', 'SELECT') then
    raise exception '037 self-check: project_provisioning_runs readable by API roles';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_provisioning_runs') then
    raise exception '037 self-check: project_provisioning_runs must have no policies';
  end if;
  raise notice '037 self-check passed';
end $$;

commit;

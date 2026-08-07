-- ============================================================
-- Migration 008 — leads.project_id (additive step 1 of 5)
--
-- ADR-017 Decision 6, "leads.project_id — confirmed phased plan":
-- `leads` has no project_id column today (`supabase/schema.sql:101-116`
-- defines it with only `tenant_id`), so per-project RLS
-- (`project_id in get_my_project_ids()`) cannot be written against it yet.
-- This migration is step 1 of the confirmed 5-step sequence:
--
--   1. Add project_id uuid references public.projects(id), NULLABLE.
--      Purely additive — no behavior change, no RLS change.  ← THIS MIGRATION
--   2. Backfill existing rows from each lead's tenant_id → its project.
--      Trivial today: every tenant is 1:1 with exactly one project
--      (livener → livener-main, studiomartegani → studiomartegani-main).
--      If leads is empty at backfill time, this step is a no-op.
--   3. Populate project_id on all new lead captures going forward.
--   4. GATED, "Tom decides" at execution time: only after the backfill is
--      verified complete, flip project_id to NOT NULL and add the
--      project-scoped RLS policy (project_id in get_my_project_ids()).
--   5. Keep tenant_id alongside project_id (harmless denormalization,
--      derivable via projects.tenant_id) — retire later if desired.
--
-- Steps 2–5 are NOT part of this migration. This migration performs step 1
-- only: no backfill, no NOT NULL, no RLS change. Existing RLS policies on
-- leads (migration 004 — tenant-scoped via get_my_tenant_ids() /
-- get_my_writable_tenant_ids()) are untouched and continue to govern access.
-- ============================================================


-- ── Column ────────────────────────────────────────────────────────────────────

alter table public.leads
  add column if not exists project_id uuid references public.projects (id) on delete set null;

comment on column public.leads.project_id is
  'ADR-017 Decision 6, step 1 of 5 (phased, additive-first plan). Nullable by '
  'design — backfill (step 2), forward-population (step 3), and the gated '
  'NOT NULL + RLS flip (step 4, requires explicit Tom sign-off at execution '
  'time) are later, separate migrations. tenant_id is kept alongside '
  'project_id indefinitely (step 5) — it is not being replaced here.';


-- ── Index ─────────────────────────────────────────────────────────────────────

create index if not exists leads_project_id_idx on public.leads (project_id);


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Run after applying the migration to confirm correctness. No RLS or
-- NOT NULL check applies yet — those belong to the later gated migration.
--
-- 1. Column exists, nullable, correct type and FK target:
--
--    select column_name, data_type, is_nullable
--    from   information_schema.columns
--    where  table_schema = 'public'
--    and    table_name   = 'leads'
--    and    column_name  = 'project_id';
--
--    Expected: project_id | uuid | YES
--
-- 2. Foreign key targets public.projects(id) with ON DELETE SET NULL:
--
--    select
--      tc.constraint_name,
--      rc.delete_rule,
--      ccu.table_name as references_table
--    from information_schema.table_constraints tc
--    join information_schema.referential_constraints rc
--      on tc.constraint_name = rc.constraint_name
--    join information_schema.constraint_column_usage ccu
--      on rc.unique_constraint_name = ccu.constraint_name
--    where tc.table_name = 'leads'
--    and   tc.constraint_type = 'FOREIGN KEY'
--    and   tc.constraint_name like '%project_id%';
--
--    Expected: delete_rule = SET NULL, references_table = projects
--
-- 3. Index exists:
--
--    select indexname from pg_indexes
--    where  schemaname = 'public' and tablename = 'leads'
--    and    indexname  = 'leads_project_id_idx';
--
--    Expected: 1 row.
--
-- 4. All existing rows have project_id = null (no backfill has run yet):
--
--    select count(*) as total, count(project_id) as with_project_id
--    from   public.leads;
--
--    Expected: with_project_id = 0 (unless leads is already empty).

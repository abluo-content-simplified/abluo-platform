-- ============================================================
-- Migration 026 — drop public.leads
--
-- ⚠️ NOT APPLIED BY THIS TASK. File only, for Tom to run in the Supabase SQL
-- editor, per CLAUDE.md's Schema Evolution Rules.
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- `leads` is dead. Verified 2026-09-03 against the live project:
--
--   * 0 rows. Not "few" — zero, since it was created.
--   * 0 references anywhere in `src/`. Every .ts/.tsx grepped for
--     `from('leads')`; nothing. The `/leads` page in the client dashboard
--     (`app/[locale]/(client)/[tenant]/leads/page.tsx`) renders a
--     `leads.comingSoon` string and queries nothing.
--   * No grant to `authenticated` ever existed, so no session could read it
--     even if a row appeared.
--
-- Form submissions live in `form_submissions` (migration 016), which is
-- project-scoped, carries the full `source` object (page_url, utm_*, gclid,
-- device, country) and is what the client dashboard actually reads. Its
-- delivery outbox is `form_events` (017).
--
-- ── This supersedes migration 020 ────────────────────────────────────────
-- 020 rewrote the `leads` RLS policies from tenant grain to project grain. It
-- was correct and was never applied. Dropping the table makes it moot: DO NOT
-- APPLY 020. It stays in the tree as the record of a real defect (a
-- tenant-grain policy on a project-grain table over-shares to every project in
-- the tenant AND under-shares to project-only members) — the same defect class
-- to check for if `leads` is ever resurrected. Its header has been updated to
-- say so.
--
-- ── What this deliberately does NOT do ───────────────────────────────────
-- It does not touch `inquiries` (8 real early-access signups from
-- 2026-06-25..2026-08-10, all with `project_id` NULL because the table
-- predates the multi-project model). That table is retained read-only and
-- still browsable in the Supabase table editor. Decide its fate separately —
-- dropping it WOULD lose data, and this migration would not.
--
-- ── Reversibility ────────────────────────────────────────────────────────
-- Irreversible in the sense that the table is gone. Costless in the sense that
-- it has never held a row: schema.sql §"leads" plus migrations 001 and 008
-- reconstruct it exactly, and 020 reconstructs the correct policies. There is
-- no data to restore because there has never been any.
--
-- ── Verify after running ─────────────────────────────────────────────────
--   select to_regclass('public.leads');            -- expect NULL
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'leads';   -- expect 0
-- ============================================================

-- Policies and indexes are dropped implicitly with the table; naming them
-- first makes the intent explicit and keeps this readable in the audit trail.
drop policy if exists "Members can read leads for their tenants"        on public.leads;
drop policy if exists "Contributors can insert leads for their tenants" on public.leads;
drop policy if exists "Contributors can update leads for their tenants" on public.leads;
drop policy if exists "Members read leads for their projects"           on public.leads;
drop policy if exists "Writable roles insert leads for their projects"  on public.leads;
drop policy if exists "Writable roles update leads for their projects"  on public.leads;

-- No dependent views, functions or foreign keys point AT leads (it references
-- tenants and projects, not the other way round), so a plain drop suffices.
-- `restrict` rather than `cascade`: if anything unexpectedly depends on this
-- table, the migration should FAIL loudly rather than silently remove it too.
drop table if exists public.leads restrict;

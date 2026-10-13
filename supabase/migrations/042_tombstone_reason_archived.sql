-- ============================================================
-- Migration 042 — removal reason 'archived' (ADR-032 D11, slice 5 — Tom, 2026-10-13)
--
-- APPLIED 2026-10-13 to production by Tom (SQL editor) — see supabase/APPLIED.md.
--
-- The partner API's removal rows (`api_tombstones`, migration 040) gain the
-- reason 'archived', matching Event v1's `EventRemovedV1.reason`. Today the
-- API derives 'archived' from the document itself (archivedAt) and writes no
-- such tombstone; the constraint is widened now so the contract, the code
-- and the database agree before anything (the V1.1 push sweep) records one.
--
-- Additive and backward compatible: every row the current code writes is
-- still valid; nothing is rewritten.
--
-- DEPLOYMENT ORDER: apply this migration BEFORE deploying slice 5 to
-- production (it is harmless to code that never writes 'archived', so it can
-- go first at any time). Production runs migrations 040/041 already.
--
-- Safe to re-run: replaces whatever CHECK constraint currently governs
-- `reason` with the one below.
-- ============================================================

begin;

do $$
declare c record;
begin
  if to_regclass('public.api_tombstones') is null then
    raise exception 'migration 042: public.api_tombstones does not exist — apply 040 first';
  end if;
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.api_tombstones'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%reason%'
  loop
    execute format('alter table public.api_tombstones drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.api_tombstones
  add constraint api_tombstones_reason_check
  check (reason in ('deleted', 'unpublished', 'unlisted', 'websiteOnly', 'archived'));

comment on column public.api_tombstones.reason is
  'Why partners must drop the item: deleted | unpublished | unlisted | websiteOnly | archived (042). Partners are told to tolerate unknown reasons.';

commit;

-- Post-apply check (expect one row, has_archived = true). The table has a
-- second CHECK (on `resource`, from 040) — that one is expected and untouched.
--   select pg_get_constraintdef(oid) like '%archived%' as has_archived
--   from pg_constraint
--   where conrelid = 'public.api_tombstones'::regclass
--     and conname = 'api_tombstones_reason_check';

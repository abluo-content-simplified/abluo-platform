-- Rollback for migration 031 (archived people). Loses the archive records only;
-- memberships are untouched (archived people stay without access).
begin;
drop table if exists public.project_member_archive;
drop function if exists public.tg_validate_archive_extras();
commit;

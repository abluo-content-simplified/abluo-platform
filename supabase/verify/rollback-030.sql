-- ROLLBACK for migration 030 — ONLY if 030 must be undone. Not read-only.
-- Restores 028's membership-based contact-request policies and re-allows the
-- legacy role values (029 shape). Does not touch any row.
begin;
drop policy if exists "Members read their project submissions" on public.form_submissions;
create policy "Members read their project submissions" on public.form_submissions
  for select to authenticated using (project_id in (select public.get_my_project_ids()));
drop policy if exists "Writable roles update their project submissions" on public.form_submissions;
create policy "Writable roles update their project submissions" on public.form_submissions
  for update to authenticated
  using (project_id in (select public.get_my_writable_project_ids()))
  with check (project_id in (select public.get_my_writable_project_ids()));
drop policy if exists "Members read their project form events" on public.form_events;
create policy "Members read their project form events" on public.form_events
  for select to authenticated using (project_id in (select public.get_my_project_ids()));
drop policy if exists "Members read inquiries for their projects" on public.inquiries;
create policy "Members read inquiries for their projects" on public.inquiries
  for select to authenticated
  using ((project_id is not null and project_id in (select public.get_my_project_ids()))
         or (project_id is null and tenant_id is not null and tenant_id in (select public.get_my_owned_tenant_ids())));
drop function if exists public.get_my_project_ids_with(text);
alter table public.tenant_members  drop constraint tenant_members_role_check;
alter table public.project_members drop constraint project_members_role_check;
alter table public.tenant_members  add constraint tenant_members_role_check  check (role in ('owner', 'member', 'editor', 'viewer'));
alter table public.project_members add constraint project_members_role_check check (role in ('admin', 'editor', 'viewer'));
commit;

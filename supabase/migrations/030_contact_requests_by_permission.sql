-- ============================================================
-- Migration 030 — contact requests follow the permission, not membership
-- (ADR-028 Migration steps 3–4)
--
-- ⚠️ NOT APPLIED BY THE SESSION THAT WROTE IT (2026-10-07). File only.
-- Requires 029. Proven by supabase/verify/hardening-030.verify.mjs.
-- Rollback: supabase/verify/rollback-030.sql.
--
-- ── Why ──────────────────────────────────────────────────────────────────
-- Until now every member of a site could read its contact requests (form
-- submissions, their events, inquiries) at the DATABASE level, whatever the
-- dashboard showed. Contact requests hold the client's customers' personal
-- data (patients, for a dentist). From now on the database itself answers
-- "may this person see contact requests here?" exactly as the code does
-- (src/lib/authz, module permission forms.submission.read / .update):
--
--   read    = Owner of the client · Site admin of the site ·
--             anyone with the extra on that site · a client Member with the
--             extra on the client (applies to every site of the client)
--   update  = the same, with forms.submission.update
--
-- An Editor without the extra no longer reads contact requests.
-- Production review 2026-10-07: no Editor or Viewer exists, so nobody loses
-- access. The precondition below refuses to run if that is no longer true.
--
-- Also retires the legacy role values (ADR-028 §1): project 'viewer',
-- tenant 'editor'/'viewer'.
--
-- Unchanged: projects/tenants/membership read policies, translation_usage
-- (not personal data — every member of the site keeps it), the abluo_admin
-- read-only policies of 028.
-- ============================================================

begin;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.grantable_permissions') is null then
    raise exception '030: migration 029 is not applied — apply 029 first';
  end if;
  if to_regprocedure('public.get_my_project_ids_with(text)') is not null then
    raise exception '030: already applied — stop';
  end if;
  if exists (select 1 from public.project_members where role not in ('admin', 'editor'))
     or exists (select 1 from public.tenant_members where role not in ('owner', 'member')) then
    raise exception '030: legacy roles (viewer, or tenant-level editor/viewer) still exist — review them first (ADR-028 step 4)';
  end if;
  if exists (select 1 from public.project_members where role = 'editor') then
    raise notice '030: Editors exist — they keep contact requests only if they hold the extra forms.submission.read';
  end if;
end $$;


-- ── 1. Retire legacy role values ─────────────────────────────────────────────
alter table public.tenant_members  drop constraint tenant_members_role_check;
alter table public.project_members drop constraint project_members_role_check;
alter table public.tenant_members
  add constraint tenant_members_role_check  check (role in ('owner', 'member'));
alter table public.project_members
  add constraint project_members_role_check check (role in ('admin', 'editor'));


-- ── 2. One helper: the projects where I hold a contact-request permission ───
create function public.get_my_project_ids_with(p_permission text)
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select p.id
  from   public.projects p
  where  p_permission in ('forms.submission.read', 'forms.submission.update')
  and (
         p.tenant_id in (
           select m.tenant_id from public.tenant_members m
           where  m.user_id = auth.uid()
           and   (m.role = 'owner' or p_permission = any (m.extra_permissions)))
      or p.id in (
           select pm.project_id from public.project_members pm
           where  pm.user_id = auth.uid()
           and   (pm.role = 'admin' or p_permission = any (pm.extra_permissions)))
  )
$$;

comment on function public.get_my_project_ids_with(text) is
  'ADR-028 — projects where auth.uid() holds a contact-request permission (forms.submission.read / '
  '.update): tenant Owner, Site admin, or the permission as an extra on the project or tenant membership. '
  'Mirrors src/lib/authz for the permissions RLS enforces. Any other permission → empty (fail closed).';

revoke all on function public.get_my_project_ids_with(text) from public, anon;
grant execute on function public.get_my_project_ids_with(text) to authenticated;


-- ── 3. Policies (same names as 028, new rule) ────────────────────────────────
drop policy if exists "Members read their project submissions" on public.form_submissions;
create policy "Members read their project submissions" on public.form_submissions
  for select to authenticated
  using (project_id in (select public.get_my_project_ids_with('forms.submission.read')));

drop policy if exists "Writable roles update their project submissions" on public.form_submissions;
create policy "Writable roles update their project submissions" on public.form_submissions
  for update to authenticated
  using      (project_id in (select public.get_my_project_ids_with('forms.submission.update')))
  with check (project_id in (select public.get_my_project_ids_with('forms.submission.update')));

drop policy if exists "Members read their project form events" on public.form_events;
create policy "Members read their project form events" on public.form_events
  for select to authenticated
  using (project_id in (select public.get_my_project_ids_with('forms.submission.read')));

drop policy if exists "Members read inquiries for their projects" on public.inquiries;
create policy "Members read inquiries for their projects" on public.inquiries
  for select to authenticated
  using (
    (project_id is not null and project_id in (select public.get_my_project_ids_with('forms.submission.read')))
    or
    (project_id is null and tenant_id is not null
       and tenant_id in (select public.get_my_owned_tenant_ids()))
  );


-- ── 4. Self-check ────────────────────────────────────────────────────────────
do $$
declare bad text;
begin
  select string_agg(tablename || ':' || policyname, ', ') into bad
  from pg_policies
  where schemaname = 'public'
  and (tablename, policyname) in (
    ('form_submissions', 'Members read their project submissions'),
    ('form_submissions', 'Writable roles update their project submissions'),
    ('form_events',      'Members read their project form events'),
    ('inquiries',        'Members read inquiries for their projects'))
  and (coalesce(qual, '') || coalesce(with_check, '')) not ilike '%get_my_project_ids_with%';
  if bad is not null then raise exception '030 self-check: policy not on the permission helper: %', bad; end if;

  if (select count(*) from pg_policies where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%get_my_project_ids_with%') <> 4 then
    raise exception '030 self-check: expected exactly 4 policies on the permission helper';
  end if;

  -- No other permissive non-admin policy still opens contact requests to plain membership.
  select string_agg(tablename || ':' || policyname, ', ') into bad
  from pg_policies
  where schemaname = 'public' and tablename in ('form_submissions', 'form_events', 'inquiries')
  and policyname not in ('Members read their project submissions', 'Writable roles update their project submissions',
                         'Members read their project form events', 'Members read inquiries for their projects',
                         'Abluo admins read all form submissions', 'Abluo admins read all form events',
                         'Abluo admins read all inquiries');
  if bad is not null then raise exception '030 self-check: unexpected policy on contact-request tables: %', bad; end if;

  if has_function_privilege('anon', 'public.get_my_project_ids_with(text)', 'EXECUTE') then
    raise exception '030 self-check: anon can execute get_my_project_ids_with';
  end if;

  raise notice '030 self-check passed';
end $$;

commit;

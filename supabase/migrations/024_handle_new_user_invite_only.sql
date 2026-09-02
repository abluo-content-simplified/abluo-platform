-- ============================================================
-- Migration 024 — handle_new_user(): membership rows for INVITED users only
--
-- STATUS: WRITTEN, **NOT APPLIED**. See supabase/APPLIED.md.
--
-- ── The defect this closes (P0, confirmed against the live project) ──────
--
-- `handle_new_user()` runs `after insert on auth.users` and reads
-- `new.raw_user_meta_data` — the bag of JSON the CLIENT supplies at signup
-- (`POST /auth/v1/signup`, body field `data`). Unlike `raw_app_meta_data`,
-- nothing server-side validates it. The live function body creates a
-- `tenant_members` row whenever that bag contains `tenant_id`, with
-- `coalesce(role, 'owner')`.
--
-- `GET /auth/v1/settings` on the live project returned `disable_signup:
-- false`, and the anon key ships in the browser bundle. So, before this
-- migration, ANY member of the public could:
--
--     POST /auth/v1/signup
--     { "email": "...", "password": "...",
--       "data": { "tenant_id": "<any tenant uuid>" } }
--
-- and receive `tenant_members(tenant_id, user_id, role='owner')` for a
-- tenant they have no relationship with — read of that tenant's projects
-- and leads (get_my_tenant_ids), write (get_my_writable_tenant_ids), and
-- the ability to add further members (migration 003's owner INSERT policy).
-- The `project_id` branch is the same hole one grain down, at editor/viewer.
--
-- Disabling self-signup in the Supabase dashboard is the PRIMARY control and
-- was done first. This migration is the SECOND LAYER: it makes the trigger
-- itself safe, so re-enabling signup (deliberately or by accident, e.g. a
-- project restore or a dashboard misclick) does not silently reopen the hole.
--
--
-- ── The discriminator: `auth.users.invited_at`, on UPDATE, not INSERT ────
--
-- Users are created legitimately by exactly two routes, both of which call
-- `auth.admin.inviteUserByEmail(email, { data })` with the service role
-- AFTER authorising the caller server-side:
--
--   src/app/api/tenants/[tenantId]/invite/route.ts   (requireAbluoAdmin)
--       data = { tenant_id, role: 'owner', invited_by }
--   src/app/api/projects/[projectId]/invite/route.ts (tenant-owner check)
--       data = { project_id, role: 'editor'|'viewer', invited_by }
--
-- Their metadata IS trustworthy; a self-signup's is not. `invited_at` is the
-- column that separates them: GoTrue sets it on the invite path and never on
-- the signup path.
--
-- **But it is NOT set by the INSERT.** This was checked against the GoTrue
-- (supabase/auth) source rather than assumed, because the obvious form of
-- this fix — `if new.invited_at is not null then ...` inside the existing
-- `after insert` trigger — would be a guard that does not guard: it would
-- block every legitimate invite too, and the membership model would quietly
-- stop working while looking fixed.
--
--   internal/models/user.go — InvitedAt *time.Time  db:"invited_at";
--     neither NewUser() nor NewUserWithPasswordHash() sets it.
--   internal/api/invite.go — the handler calls signupNewUser() (which
--     INSERTs the row) and only afterwards sendInvite().
--   internal/api/mail.go, sendInvite():
--         u.InvitedAt = &now
--         u.ConfirmationSentAt = &now
--         tx.UpdateOnly(u, "confirmation_token", "confirmation_sent_at", "invited_at")
--
-- So the real sequence inside one invite request, one transaction, is:
--     1. INSERT into auth.users   — invited_at IS NULL
--     2. UPDATE  auth.users       — invited_at := now()
--
-- Therefore this migration SPLITS the trigger:
--
--   `on_auth_user_created`  (after insert)  → profiles only. Identity data,
--        no privilege, correct for every user however they were created.
--        Unchanged in shape from schema.sql / migration 004; the membership
--        branches are removed from it.
--
--   `on_auth_user_invited`  (after update of invited_at, WHEN the value
--        actually transitions to non-null) → tenant_members / project_members.
--        A self-signup never reaches step 2, so it never gets a membership
--        row, no matter what it puts in `data`. A real invite reaches it in
--        the same transaction as the insert, so the membership is still
--        created atomically with the account — the property migration 004
--        and the 010 draft were relying on.
--
-- The `when (...)` clause fires only on a genuine null -> non-null (or
-- changed) transition, so an ordinary `auth.updateUser({ data })` call by an
-- already-invited user — which rewrites raw_user_meta_data but never touches
-- invited_at — cannot re-run the membership branches with metadata the user
-- has since edited.
--
--
-- ── Second change: `role` no longer defaults to 'owner' ─────────────────
--
-- Migration 004 used `coalesce(new.raw_user_meta_data->>'role', 'owner')`,
-- with the rationale "so no user is accidentally locked out". That trade is
-- backwards: an ABSENT role now silently grants the HIGHEST privilege in the
-- system. It is what turned the metadata hole from "attacker joins a tenant"
-- into "attacker owns a tenant" — the attack does not even need to name a
-- role. Being locked out is a support ticket; being made an owner is a breach.
--
-- Role vocabulary (migration 003 / 007):
--   tenant_members.role  check in ('owner', 'editor', 'viewer')
--   project_members.role check in ('editor', 'viewer')   -- 'owner' is
--     deliberately not a project-level role (ADR-017 Decision 2)
--
-- This migration requires the role to be stated EXPLICITLY and to be in the
-- vocabulary for the branch concerned. Anything else — absent, empty, or an
-- unrecognised string — creates NO row (fails closed), which is already how
-- the 010 draft's project branch behaved. No regression: both invite routes
-- always send `role` explicitly, and the project route additionally rejects
-- anything outside {editor, viewer} before it calls Supabase at all.
--
-- (The column default `tenant_members.role default 'owner'` from migration
-- 003 is left alone — it is not reachable from this trigger any more, since
-- every insert here names the column, and changing it is a separate blast
-- radius. It is flagged in APPLIED.md as worth revisiting.)
--
--
-- ── Relationship to the 010 draft ───────────────────────────────────────
--
-- The live function body contains the `project_id` / `project_members`
-- branch from `010_project_member_invite_trigger.sql.draft`, so that draft
-- (or something equal to it) WAS applied by hand even though the file is
-- still named `.sql.draft` and marked NOT APPLIED. This migration supersedes
-- it: both branches live here, in their guarded form. Migration 010's draft
-- file should be left in place as history but is now dead — do not apply it
-- after this.
--
--
-- ── Known residual risk (documented, not closed here) ───────────────────
--
-- GoTrue's re-invite path MERGES the new invite's `data` into the existing
-- row's raw_user_meta_data rather than replacing it. So a self-signed-up
-- user who had planted `tenant_id: <victim>` in their own metadata, and who
-- is LATER invited (to a project, say) by a legitimate admin at that same
-- email address, would have the planted key survive the merge and be read by
-- this trigger. Closing that requires either replacing (not merging) the
-- metadata at invite time or moving the grant out of user metadata entirely
-- into a server-written `pending_invitations` table keyed by a nonce — both
-- application changes, outside this migration's scope. The precondition (an
-- admin invites the attacker's exact address) makes it materially narrower
-- than the hole being closed here.
-- ============================================================


-- ── 1. handle_new_user() — identity only ─────────────────────────────────
--
-- Reduced to what it can safely do for an arbitrary, unauthenticated
-- stranger: give them a profile row. `profiles` is identity-only since
-- migration 004 (id, full_name, avatar_url, created_at) and confers no
-- authorization — every RLS policy in the system resolves through
-- tenant_members / project_members, never through profiles.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Trigger function: runs after INSERT on auth.users. '
  'Creates the identity-only profiles row for EVERY new user. '
  'Deliberately creates NO membership rows: raw_user_meta_data is '
  'client-supplied and untrusted at signup time. Membership creation moved '
  'to handle_user_invited() (migration 024), which fires only when GoTrue '
  'stamps auth.users.invited_at.';


-- ── 2. handle_user_invited() — memberships, invited users only ───────────
--
-- Fires on the UPDATE that GoTrue's sendInvite() issues, never on signup.
-- SECURITY DEFINER (as before) so the inserts bypass RLS on
-- tenant_members / project_members.

create or replace function public.handle_user_invited()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_role text := nullif(new.raw_user_meta_data->>'role', '');
begin
  -- Tenant-owner invite path (src/app/api/tenants/[tenantId]/invite).
  -- Role must be stated and must be in tenant_members' vocabulary; there is
  -- no 'owner' fallback any more (see header).
  if new.raw_user_meta_data->>'tenant_id' is not null
     and v_role in ('owner', 'editor', 'viewer') then
    insert into public.tenant_members (tenant_id, user_id, role)
    values (
      (new.raw_user_meta_data->>'tenant_id')::uuid,
      new.id,
      v_role
    )
    on conflict (tenant_id, user_id) do nothing;
  end if;

  -- Project editor/viewer invite path (src/app/api/projects/[projectId]/invite).
  -- 'owner' is intentionally absent: ownership is tenant-level only
  -- (ADR-017 Decision 2), and project_members' own check constraint
  -- (migration 007) would reject it regardless.
  if new.raw_user_meta_data->>'project_id' is not null
     and v_role in ('editor', 'viewer') then
    insert into public.project_members (project_id, user_id, role)
    values (
      (new.raw_user_meta_data->>'project_id')::uuid,
      new.id,
      v_role
    )
    on conflict (project_id, user_id) do nothing;
  end if;

  return null;  -- AFTER ... FOR EACH ROW: return value is ignored.
end;
$$;

comment on function public.handle_user_invited() is
  'Trigger function: runs after the UPDATE in which GoTrue sets '
  'auth.users.invited_at (sendInvite()), i.e. only for users created by '
  'auth.admin.inviteUserByEmail from an already-authorised server route. '
  'Creates tenant_members / project_members from the invite metadata. '
  'Role must be explicit and in the vocabulary — there is no ''owner'' '
  'default. A self-signup never reaches this trigger.';


-- ── 3. Triggers ──────────────────────────────────────────────────────────

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

drop trigger if exists on_auth_user_invited on auth.users;
create trigger on_auth_user_invited
  after update of invited_at on auth.users
  for each row
  when (
    new.invited_at is not null
    and old.invited_at is distinct from new.invited_at
  )
  execute procedure public.handle_user_invited();


-- ── Verification ─────────────────────────────────────────────────────────
--
-- Run in the Supabase dashboard SQL editor AFTER applying, and record the
-- result in supabase/APPLIED.md.
--
-- 1. handle_new_user() must no longer mention either membership table:
--
--    select prosrc ilike '%tenant_members%' as mentions_tenant_members,
--           prosrc ilike '%project_members%' as mentions_project_members
--    from   pg_proc
--    where  proname = 'handle_new_user'
--    and    pronamespace = 'public'::regnamespace;
--
--    Expected: false | false
--
-- 2. Both triggers exist on auth.users, with the right events:
--
--    select t.tgname,
--           pg_get_triggerdef(t.oid) as definition
--    from   pg_trigger t
--    where  t.tgrelid = 'auth.users'::regclass
--    and    not t.tgisinternal
--    order  by t.tgname;
--
--    Expected: two rows.
--      on_auth_user_created — AFTER INSERT ... handle_new_user()
--      on_auth_user_invited — AFTER UPDATE OF invited_at ...
--                             WHEN (new.invited_at IS NOT NULL AND
--                                   old.invited_at IS DISTINCT FROM new.invited_at)
--                             ... handle_user_invited()
--
-- 3. No 'owner' fallback survives anywhere in the trigger pair:
--
--    select proname
--    from   pg_proc
--    where  proname in ('handle_new_user', 'handle_user_invited')
--    and    pronamespace = 'public'::regnamespace
--    and    prosrc ilike '%coalesce%role%owner%';
--
--    Expected: 0 rows.
--
-- 4. Behavioural check (NON-PRODUCTION project only — this creates a user):
--
--    -- Simulate a self-signup exactly as GoTrue writes it: one INSERT,
--    -- invited_at left NULL.
--    insert into auth.users (id, email, raw_user_meta_data)
--    values (gen_random_uuid(), 'probe-selfsignup@example.test',
--            jsonb_build_object('tenant_id', '<a real tenant uuid>'))
--    returning id;
--
--    select count(*) from public.tenant_members where user_id = '<that id>';
--    -- Expected: 0     (before migration 024 this was 1, role='owner')
--    select count(*) from public.profiles       where id      = '<that id>';
--    -- Expected: 1
--
--    Then clean up: delete from auth.users where id = '<that id>';
--
-- 5. The primary control, checked separately from this migration:
--
--    curl -s https://<project-ref>.supabase.co/auth/v1/settings \
--         -H "apikey: <anon key>" | jq .disable_signup
--    -- Expected: true

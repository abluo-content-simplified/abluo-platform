-- ============================================================
-- Migration 025 — abluo_admin cross-tenant READ access via RLS
--
-- ⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK.
-- FILE ONLY, handed to Tom to review and apply manually via the Supabase SQL
-- editor, per CLAUDE.md's Schema Evolution Rules and this task's explicit hard
-- stop. Proven against the local disposable-Postgres harness only
-- (supabase/verify/live-rls.verify.mjs, block "(l) abluo_admin cross-tenant
-- read"). Record the outcome in supabase/APPLIED.md once it has actually run.
--
-- ⚠️ READ THIS FIRST — THIS MIGRATION REVERSES A DOCUMENTED DECISION.
--   Until today, "abluo_admin is NOT special-cased in any RLS policy" was an
--   explicit, written, and TESTED property of this schema:
--     - src/lib/api/tenant-context.ts, module comment "`abluo_admin` note":
--       "Abluo admins reach cross-tenant surfaces through separate admin-only
--       routes (requireAbluoAdmin(), /studio, the admin dashboard's
--       service-role reads), not through this per-project membership context."
--     - supabase/verify/live-rls.verify.mjs block (d) exists solely to assert
--       that property at the database layer ("the negative control most likely
--       to be gotten wrong").
--   Grep confirms the claim was accurate: before this file, the string
--   `abluo_admin` appeared in supabase/ ONLY in migration 006's comments and
--   in the harness. ZERO policies referenced it.
--   This migration makes the platform-admin identity a first-class RLS reader.
--   That is a deliberate architectural change, not a bug fix. If Tom does not
--   want it, do not apply this file — nothing else depends on it.
--
--
-- ── The defect this closes ───────────────────────────────────────────────
--
-- Every cross-tenant admin surface today runs on the SERVICE ROLE
-- (createAdminClient(), src/lib/supabase/admin.ts — e.g. the admin dashboard's
-- `.from('projects').select('*, tenants(...)')` in
-- src/app/[locale]/(admin)/dashboard/page.tsx, and every /api/sanity/* and
-- /api/media/* route). The service role bypasses RLS AND grants entirely: it
-- is all-tables, all-rows, all-verbs, read AND WRITE, with no database-layer
-- record of who the human behind the request was. `requireAbluoAdmin()` in
-- application code is the ONLY thing standing between a route handler bug and
-- unrestricted write access to every tenant's data. src/lib/supabase/admin.ts
-- line 50 already flags this as owed hardening: "flip to abluo_admin-gated +
-- non-service-role".
--
-- This migration supplies the missing half of that flip: a database-enforced
-- identity that can READ across tenants and can do NOTHING ELSE. An admin
-- surface rebuilt on the ordinary session client instead of the service role
-- gets, from the database itself:
--   - cross-tenant reads, and
--   - exactly zero additional write capability — a route-handler bug can no
--     longer mutate another tenant's rows, because no write policy anywhere
--     mentions this identity.
-- That is a strictly better failure mode than the service role's, and it is
-- the entire point of the migration.
--
--
-- ── What this migration does ─────────────────────────────────────────────
--
--   1. Adds a helper, public.is_abluo_admin(), that reads ONE JWT claim and
--      touches NO TABLE AT ALL.
--   2. Adds ONE additional permissive SELECT policy, per table, on eight
--      tables:
--        tenants, projects, tenant_members, project_members,
--        leads, inquiries, form_submissions, form_events
--      Each new policy's entire predicate is `public.is_abluo_admin()`.
--
-- Nothing else. No grant, no schema change, no existing policy is dropped,
-- altered, or re-created.
--
--
-- ── Design note 1: why a SEPARATE policy, not `or public.is_abluo_admin()`
--    spliced into each existing SELECT policy ──────────────────────────────
--
-- These are semantically IDENTICAL. PostgreSQL OR-combines every applicable
-- PERMISSIVE policy for a command (this is exactly the mechanic migration
-- 013's header relies on: "Postgres OR-combines every applicable policy for a
-- SELECT"), so
--     policy P: using (X)   +   policy Q: using (is_abluo_admin())
-- admits precisely the rows that
--     policy P': using (X or is_abluo_admin())
-- admits. There is no row, no caller, and no command for which the two shapes
-- differ.
--
-- The separate-policy form was chosen for three reasons, in order of weight:
--
--   (a) IT CANNOT CORRUPT THE EXISTING PREDICATES. The splice form requires
--       `drop policy` + `create policy` with the old predicate RE-TYPED from a
--       migration file. supabase/APPLIED.md records that migrations 005, 007
--       and 019 are live as **"APPLIED (NOT VERBATIM)"** — what ran against
--       the real database was demonstrably not the file's exact text — and
--       that the `projects` SELECT policy's live `qual` is still **"NEEDS
--       CATALOG"** (i.e. nobody has read it back; 013 may or may not be live).
--       Re-typing a predicate from a file that may not match the live catalog
--       is how you silently widen or silently break tenant isolation. This
--       form re-types nothing: the existing predicates are preserved
--       byte-for-byte by never being touched.
--
--   (b) IT IS ORDER-INDEPENDENT (see Design note 2 — the migration 020
--       problem). Splicing requires knowing which of two possible `leads`
--       policy shapes is live. Adding a policy does not.
--
--   (c) IT IS LEGIBLE AND TRIVIALLY REVERSIBLE. `pg_policies` shows the
--       admin grant as its own eight rows with the same name prefix; the
--       revert is eight `drop policy` statements plus one `drop function`,
--       with no risk of restoring the wrong original text.
--
-- If Tom prefers the spliced form, that is a legitimate style preference —
-- but it should be taken only AFTER reading the eight live `qual`s back out
-- of the catalog, not out of these files.
--
--
-- ── Design note 2: the migration 020 ordering problem — RESOLVED, NOT
--    ASSUMED ─────────────────────────────────────────────────────────────
--
-- Migration 020 (`leads`: tenant grain → project grain) is written but
-- **NOT APPLIED** — supabase/APPLIED.md confirms this against the live
-- database ("the `leads` table comment is still 'Contact form submissions.
-- Tenant-scoped.'"). So `leads` today carries the schema.sql-era policy
-- "Members can read leads for their tenants", not 020's "Members read leads
-- for their projects".
--
-- **DECISION: 025 does NOT depend on 020, in either direction.** It handles
-- both shapes because it inspects neither. The new `leads` policy is a new,
-- independently-named row that ORs with whatever SELECT policy is live:
--   - 020 not applied → OR'd with the tenant-grain policy. Correct.
--   - 020 applied first → OR'd with the project-grain policy. Correct.
--   - 020 applied AFTER 025 → 020's `drop policy if exists` names only its own
--     three policy names and the three schema.sql ones. It does not name
--     "Abluo admins read all leads", so 025's policy survives 020 untouched.
--     Correct.
-- 025 and 020 commute. Apply them in any order, or apply only one.
--
-- This is stated here rather than as a "requires 020" header line precisely
-- because a stated prerequisite that nothing enforces is how 021/022/023 came
-- to be believed un-applied for weeks (APPLIED.md, "What this file got wrong").
-- An ordering constraint that does not exist is better than one that exists
-- only in a comment.
--
--
-- ── Design note 3: why is_abluo_admin() cannot reintroduce the migration 013
--    recursion ──────────────────────────────────────────────────────────────
--
-- Migration 013's incident had exactly one cause: a policy on table A reached
-- table B with a RAW (non-SECURITY-DEFINER) subquery, so evaluating A's policy
-- re-entered B's policies, one of which reached back into A.
--
-- is_abluo_admin() reads `auth.jwt()`, which is `current_setting(
-- 'request.jwt.claims')` — a session GUC. It has NO FROM clause. It references
-- no relation, so the policy evaluator has nothing to re-enter. This is a
-- stronger guarantee than the SECURITY DEFINER helpers give: those bypass RLS
-- on tables they read; this one reads no table to bypass RLS on.
--
-- Consequences, spelled out:
--   - SECURITY DEFINER is NOT used, and MUST NOT be added. It is the correct
--     tool for "read a table without triggering its RLS"; there is no table
--     here. Adding it would create an elevated-privilege function for no
--     reason, which is a gratuitous escalation surface. SECURITY INVOKER (the
--     default) is deliberate. Note also that SECURITY DEFINER would not even
--     change this function's ANSWER: `current_setting()` reads session state,
--     which is identical under either mode.
--   - `stable`, not `volatile`: the claim cannot change mid-statement, so the
--     planner may evaluate it once per query instead of once per row. Not
--     `immutable` — the value differs between sessions.
--   - `set search_path = ''`: same injection hardening as every helper in
--     schema.sql §7 and migrations 003/004/007/024. This is why `auth.jwt()`
--     below is schema-qualified — with an empty search_path an unqualified
--     `jwt()` would not resolve.
--
--
-- ── Design note 4: null handling, and why coalesce() is here ──────────────
--
-- `auth.jwt() ->> 'platform_role'` yields SQL NULL when the claim is absent
-- (anon session, service-role session, or a JWT minted before migration 006's
-- hook was wired up). `NULL = 'abluo_admin'` is NULL, and RLS treats a NULL
-- policy result as NOT TRUE — so the bare comparison ALREADY fails closed for
-- the RLS use. coalesce() is therefore not required for safety here.
--
-- It is included anyway because a three-valued boolean is a trap waiting for
-- the first caller who writes `not public.is_abluo_admin()` (which would be
-- NULL, not TRUE, for an anonymous caller — i.e. it would fail OPEN in the
-- negated position). Making the function TOTAL — it returns exactly true or
-- false, never null, for every possible session — removes that trap
-- permanently. This is the same fail-safe-by-construction reasoning as
-- resolvePlatformRole() in src/lib/api/auth.ts.
--
-- Exact-match semantics, matching resolvePlatformRole(): ONLY the literal
-- string 'abluo_admin' is admin. Every other value — 'super-admin',
-- 'Abluo_Admin', ' abluo_admin ' (padded), a JSON object rather than a string,
-- absent, null — is not. This closes the gap live-rls.verify.mjs block (d)
-- already documents in migration 006's hook: the hook's own coalesce passes a
-- present-but-garbage app_metadata value straight through, so the exact match
-- has to happen at the consuming end. It happens here.
--
-- The claim read is the TOP-LEVEL `platform_role` claim that migration 006's
-- custom_access_token_hook writes — NOT `app_metadata.platform_role`. Those
-- are two different paths in the same token. The top-level one is the hook's
-- output and is the one migration 006 verified live in Tom's own JWT. Reading
-- app_metadata directly would work too, but it would bypass the hook, which is
-- the single place the platform-role mapping is defined.
--
-- Spoofability: none from the client. The hook sources the claim from
-- `raw_app_meta_data`, which is admin/service-role-writable only (migration
-- 006 header), and the JWT is signed. A user cannot mint themselves this
-- claim. This is the whole reason the claim, rather than a table lookup, is
-- an acceptable authorization input.
--
--
-- ── Design note 5: READ-ONLY BY CONSTRUCTION ─────────────────────────────
--
-- Every policy created below is `for select`. No INSERT, UPDATE, DELETE, or
-- ALL policy anywhere in this schema mentions is_abluo_admin(), and none is
-- created here.
--
-- Why a widened SELECT policy cannot leak write access, precisely:
--   - For UPDATE and DELETE, the rows a statement may touch are determined by
--     the applicable UPDATE/DELETE (or ALL) policies' USING expressions.
--     SELECT policies do not contribute rows to that set; where a SELECT
--     policy is consulted during an UPDATE at all (because the statement's
--     WHERE / RETURNING reads columns), it can only INTERSECT with — never
--     widen — the UPDATE policy's row set.
--   - For INSERT, admissibility is the WITH CHECK of the INSERT/ALL policies.
--     None mentions this identity.
--   => An abluo_admin session's write capability after this migration is
--      byte-for-byte what it was before: whatever their ordinary memberships
--      grant them, and nothing more. This is asserted, not assumed, in harness
--      block (l) — every write verb is probed against every target table.
--
-- Note the one real trade-off being accepted: on tables the admin can already
-- write through membership, RLS is no longer an independent second boundary
-- for READS. Every RLS-client read in src/ carries its own explicit predicate
-- (`.eq('user_id', …)`, `.eq('project_id', …)`, `.in('tenant_id', …)`) and
-- every dashboard read is gated by `assertModuleAction(ctx, …)` on a
-- membership-derived context, so no existing code path changes behaviour —
-- verified by grepping every `.from(...)` call site in src/. But a FUTURE
-- read written with no predicate, under an admin session, will now return the
-- whole platform. That is the intended capability; it is also the new footgun,
-- and it is the reason profiles is excluded below.
--
--
-- ── Design note 6: `profiles` is DELIBERATELY EXCLUDED ───────────────────
--
-- Decision: NO admin read policy on public.profiles. Reasons, in order:
--
--   1. profiles is the one table in this schema whose SELECT policy is a bare
--      identity check — `id = auth.uid()`, self and nothing else (schema.sql
--      §8, unchanged by 004/012/015). Every other policy here is already a
--      membership-scoped multi-row grant, so adding an admin branch changes
--      the SIZE of an existing grant. On profiles it would change its KIND:
--      from "you can see yourself" to "one identity can enumerate every human
--      being on the platform." That deserves its own migration and its own
--      decision, not a line inside an eight-table sweep.
--
--   2. Nothing needs it. No code path in src/ reads profiles cross-user
--      through an RLS-scoped client — the only session-client profiles access
--      is src/app/invite/accept/page.tsx:384, an UPDATE of the caller's OWN
--      row. Admin surfaces that need user identity already read auth.users via
--      the service role. Granting an unused capability is pure downside.
--
--   3. It is the highest-PII, lowest-operational-value table in the set. leads
--      and inquiries and form_submissions hold client business data an admin
--      is legitimately operating on; profiles holds the platform's own users'
--      personal identity data.
--
-- The counter-argument, stated fairly: a future admin "users" screen will want
-- exactly this, and it is a one-line follow-up (the helper already exists after
-- this migration). Adding it later is cheap; un-leaking a user list is not.
-- Deferred deliberately, not overlooked.
--
--
-- ── What this migration deliberately does NOT do ─────────────────────────
--
--   - NO GRANT of any kind, to any role. In particular `public.leads` still
--     has ZERO grants to `authenticated` (migration 020's header; confirmed
--     unchanged). The leads policy below is therefore LATENT: an abluo_admin
--     session reading leads still fails CLOSED with
--     `42501 permission denied for table leads`, exactly as every other
--     authenticated session does. That is correct and intentional — turning
--     the leads read on is a separate, deliberate decision (see 020's header).
--     The policy is written now so that the eventual grant cannot ship without
--     the admin branch already being correct. The same is true of any table
--     whose grant is later revoked.
--   - Does NOT touch `profiles` (Design note 6).
--   - Does NOT modify, drop, or re-create ANY existing policy. After this
--     migration every pre-existing policy row in pg_policies is bit-identical
--     to what it was before, including its `qual`, `with_check`, `roles`, and
--     `permissive` fields.
--   - Does NOT create any write policy, and does NOT mention is_abluo_admin()
--     in any WITH CHECK.
--   - Does NOT change migration 006's hook, and does NOT seed any user's
--     raw_app_meta_data. Granting a human the abluo_admin role remains the
--     one-time operational `update auth.users` documented in 006's header.
--   - Does NOT rewire any application code. src/lib/supabase/admin.ts still
--     uses the service role everywhere; converting an admin surface to the
--     session client is the follow-on slice this migration enables, not part
--     of it.
--
-- Idempotent: `create or replace function`, and every policy is dropped with
-- `drop policy if exists` under its own name before being created. Safe to
-- re-run. Applying it twice, or applying it in either order relative to 020,
-- yields the same state.
-- ============================================================


-- ── 1. is_abluo_admin() ──────────────────────────────────────────────────
--
-- The entire authorization input is one signed JWT claim. No FROM clause, no
-- relation reference, no SECURITY DEFINER — see Design notes 3 and 4.

create or replace function public.is_abluo_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'platform_role', '') = 'abluo_admin'
$$;

comment on function public.is_abluo_admin() is
  'Migration 025. True when the current session''s JWT carries the top-level '
  'claim platform_role = ''abluo_admin'' (written by '
  'public.custom_access_token_hook(), migration 006, from server-controlled '
  'raw_app_meta_data — not client-writable, not spoofable). '
  'Reads ONE session GUC via auth.jwt() and touches NO TABLE, which is what '
  'makes it structurally incapable of reintroducing the migration 013 RLS '
  'recursion: a policy calling it has no relation to re-enter. '
  'Deliberately NOT security definer — there is no table read to bypass RLS '
  'for, so definer rights would be a pure escalation surface with no effect '
  'on the answer. Total function: returns exactly true or false, never null, '
  'for every session including anon and service_role, so `not '
  'is_abluo_admin()` is safe. Exact string match only, mirroring '
  'resolvePlatformRole() in src/lib/api/auth.ts — every other value '
  '(garbage, padded, wrong case, absent) is not admin. '
  'READ AUTHORIZATION ONLY: no INSERT/UPDATE/DELETE/ALL policy in this '
  'schema references this function, and none may be added without a separate, '
  'explicit decision.';

-- No GRANT/REVOKE is issued: PostgreSQL grants EXECUTE on new functions to
-- PUBLIC by default, which is what every other helper in this schema
-- (get_my_tenant_ids() et al., schema.sql §7) relies on and what RLS
-- evaluation for `anon`/`authenticated` requires. Being able to CALL this
-- function confers nothing — it only reports back a claim the caller's own
-- token already carries.


-- ── 2. Additive admin SELECT policies ────────────────────────────────────
--
-- One per table. Each is PERMISSIVE (the default) and therefore ORs with the
-- table's existing SELECT policies, which are left untouched. Each is scoped
-- `to authenticated`: an admin session is an `authenticated` session, and
-- restricting the role means these policies are never even evaluated for
-- `anon` (defense in depth — the predicate is already false for anon, since
-- an anon token carries no platform_role claim).

drop policy if exists "Abluo admins read all tenants"           on public.tenants;
drop policy if exists "Abluo admins read all projects"          on public.projects;
drop policy if exists "Abluo admins read all tenant members"    on public.tenant_members;
drop policy if exists "Abluo admins read all project members"   on public.project_members;
drop policy if exists "Abluo admins read all leads"             on public.leads;
drop policy if exists "Abluo admins read all inquiries"         on public.inquiries;
drop policy if exists "Abluo admins read all form submissions"  on public.form_submissions;
drop policy if exists "Abluo admins read all form events"       on public.form_events;


create policy "Abluo admins read all tenants"
  on public.tenants for select to authenticated
  using (public.is_abluo_admin());

create policy "Abluo admins read all projects"
  on public.projects for select to authenticated
  using (public.is_abluo_admin());

create policy "Abluo admins read all tenant members"
  on public.tenant_members for select to authenticated
  using (public.is_abluo_admin());

create policy "Abluo admins read all project members"
  on public.project_members for select to authenticated
  using (public.is_abluo_admin());

-- LATENT until `leads` is granted to `authenticated` (see "deliberately does
-- NOT do"). Independent of migration 020 in both directions — Design note 2.
create policy "Abluo admins read all leads"
  on public.leads for select to authenticated
  using (public.is_abluo_admin());

-- Also covers PLATFORM-level inquiries (tenant_id AND project_id both null),
-- which migration 014's policy deliberately shows to nobody. Those are the
-- Abluo early-access submissions — platform-owned data, and the one row class
-- this migration makes visible that no membership could ever reach.
create policy "Abluo admins read all inquiries"
  on public.inquiries for select to authenticated
  using (public.is_abluo_admin());

-- Same note as inquiries: migration 016's policy hides project_id-null rows
-- from all members; this exposes them to the platform admin only.
create policy "Abluo admins read all form submissions"
  on public.form_submissions for select to authenticated
  using (public.is_abluo_admin());

create policy "Abluo admins read all form events"
  on public.form_events for select to authenticated
  using (public.is_abluo_admin());


-- ── 3. Policy comments ───────────────────────────────────────────────────

do $$
declare
  t text;
  p text;
begin
  for t, p in
    select * from (values
      ('tenants',          'Abluo admins read all tenants'),
      ('projects',         'Abluo admins read all projects'),
      ('tenant_members',   'Abluo admins read all tenant members'),
      ('project_members',  'Abluo admins read all project members'),
      ('leads',            'Abluo admins read all leads'),
      ('inquiries',        'Abluo admins read all inquiries'),
      ('form_submissions', 'Abluo admins read all form submissions'),
      ('form_events',      'Abluo admins read all form events')
    ) as v(t, p)
  loop
    execute format(
      'comment on policy %I on public.%I is %L',
      p, t,
      'Migration 025. ADDITIVE, READ-ONLY cross-tenant grant for the '
      'platform-admin identity. Permissive, so it ORs with this table''s '
      'existing SELECT policies, which migration 025 does not touch. '
      'Predicate is public.is_abluo_admin() alone — one JWT claim, no table '
      'read, so it cannot participate in an RLS recursion cycle (migration '
      '013). SELECT only: no write policy on any table references '
      'is_abluo_admin(), so an admin session''s INSERT/UPDATE/DELETE '
      'capability is unchanged by this migration.'
    );
  end loop;
end;
$$;


-- ============================================================
-- Verification — run in the Supabase SQL editor after applying
-- ============================================================
--
-- 1. The helper exists, is STABLE, is NOT security definer, and has an empty
--    search_path:
--
--    select proname, prosecdef, provolatile, proconfig, prorettype::regtype
--    from   pg_proc
--    where  proname = 'is_abluo_admin' and pronamespace = 'public'::regnamespace;
--
--    Expected: exactly one row —
--      prosecdef   = false          (NOT security definer — Design note 3)
--      provolatile = 's'            (stable)
--      proconfig   = {"search_path=\"\""}
--      prorettype  = boolean
--    If prosecdef is true, someone changed this file. Do not apply it.
--
-- 2. The helper reads no relation:
--
--    select prosrc from pg_proc
--    where  proname = 'is_abluo_admin' and pronamespace = 'public'::regnamespace;
--
--    Expected: a single `select coalesce(auth.jwt() ->> 'platform_role', '')
--    = 'abluo_admin'`. There must be no FROM clause and no `public.` table
--    reference anywhere in the body.
--
-- 3. It is total and correct for every claim shape (safe to run — pure
--    function, reads only the session GUC, which the SQL editor does not set
--    to an admin token):
--
--    select public.is_abluo_admin() as no_claim_at_all;   -- expect false, NOT null
--
--    set local request.jwt.claims = '{"platform_role":"abluo_admin"}';
--    select public.is_abluo_admin();                       -- expect true
--    set local request.jwt.claims = '{"platform_role":"tenant_user"}';
--    select public.is_abluo_admin();                       -- expect false
--    set local request.jwt.claims = '{"platform_role":"super-admin"}';
--    select public.is_abluo_admin();                       -- expect false
--    set local request.jwt.claims = '{"platform_role":" abluo_admin "}';
--    select public.is_abluo_admin();                       -- expect false
--    set local request.jwt.claims = '{"app_metadata":{"platform_role":"abluo_admin"}}';
--    select public.is_abluo_admin();                       -- expect FALSE — the
--      -- top-level claim is what the hook writes and what this reads; the
--      -- nested app_metadata path is deliberately NOT consulted.
--    reset request.jwt.claims;
--
-- 4. Exactly eight new policies exist, all SELECT, all permissive, all
--    {authenticated}, and every one of them has is_abluo_admin() as its
--    ENTIRE predicate and a null with_check:
--
--    select tablename, policyname, cmd, permissive, roles, qual, with_check
--    from   pg_policies
--    where  schemaname = 'public' and policyname like 'Abluo admins read all%'
--    order  by tablename;
--
--    Expected: 8 rows —
--      cmd        = 'SELECT'        for all 8
--      permissive = 'PERMISSIVE'    for all 8
--      roles      = {authenticated} for all 8
--      qual       = 'is_abluo_admin()'
--      with_check = null            for all 8
--    Tables: form_events, form_submissions, inquiries, leads, project_members,
--            projects, tenant_members, tenants. NOT profiles (Design note 6).
--
-- 5. NO write policy anywhere references the helper. This is the single most
--    important check in this list — run it, and re-run it after any future
--    migration:
--
--    select tablename, policyname, cmd
--    from   pg_policies
--    where  schemaname = 'public'
--    and    (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%is_abluo_admin%'
--    and    cmd <> 'SELECT';
--
--    Expected: ZERO rows. Any row here is a read-only-by-construction
--    violation.
--
-- 6. No pre-existing policy was modified. `profiles` still has exactly its
--    two self-scoped policies, and the eight target tables each have exactly
--    ONE more policy than before:
--
--    select tablename, count(*) as policy_count
--    from   pg_policies where schemaname = 'public'
--    group  by tablename order by tablename;
--
--    Expected AFTER this migration, assuming 014/016/017 are live and 020 is
--    NOT (the state supabase/APPLIED.md records as of 2026-09-02):
--      form_events      → 2   (1 + 1)
--      form_submissions → 3   (2 + 1)
--      inquiries        → 3   (2 + 1)
--      leads            → 4   (3 + 1)
--      profiles         → 2   (UNCHANGED — no admin policy)
--      project_members  → 5   (4 + 1)
--      projects         → 3   (2 + 1)
--      tenant_members   → 6   (5 + 1)
--      tenants          → 2   (1 + 1)
--    If 020 has since been applied, `leads` is still 4 (020 keeps three
--    policies of its own). Every other count is unaffected by 020.
--
--    And confirm the existing predicates are untouched:
--
--    select tablename, policyname, qual from pg_policies
--    where  schemaname = 'public' and policyname not like 'Abluo admins%'
--    order  by tablename, policyname;
--
--    Expected: identical to a capture taken BEFORE applying. Take that capture
--    first — it is also the missing "NEEDS CATALOG" reading APPLIED.md wants
--    for 009/011/012/013/014/015/018, so the pre-apply snapshot is worth
--    keeping regardless of this migration.
--
-- 7. `leads` grants are STILL empty — this migration must not have granted
--    anything:
--
--    select table_name, grantee, privilege_type
--    from   information_schema.role_table_grants
--    where  table_schema = 'public' and grantee in ('authenticated','anon')
--    order  by table_name, privilege_type;
--
--    Expected: no row for `leads`, and the rest identical to before applying.
--
-- 8. Behavioural proof (harness, not the dashboard):
--    `cd supabase/verify && npm run verify` — block "(l) abluo_admin
--    cross-tenant read (migration 025)" asserts, on a real PostgreSQL with
--    per-session JWT claims: an admin JWT reads across all tenants on all
--    eight tables; a tenant_user JWT reads EXACTLY the same row sets as
--    before (row-for-row, no widening); an admin JWT gains ZERO
--    insert/update/delete capability on any of them; and no table raises a
--    recursion or policy error under either identity.
--
-- 9. Live smoke test, as a real logged-in abluo_admin (Tom), once applied:
--    reload /account and the client dashboard. Expected: NO visible change.
--    Every RLS-client read in src/ carries its own explicit predicate, so
--    widened row visibility must not surface anywhere yet. If something DOES
--    change, a read is relying on RLS for scoping rather than on its own
--    filter — find it before building anything on this migration.

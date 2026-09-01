-- ============================================================
-- Migration 023 — projects.slug: GLOBAL unique → unique PER TENANT
--
-- ⚠️ NOT APPLIED TO ANY SUPABASE PROJECT (dev/preview/prod) BY THIS TASK.
-- This is a FILE ONLY, handed to Tom to review and apply manually via the
-- Supabase SQL editor, per CLAUDE.md's Schema Evolution Rules ("Tom decides
-- at execution time") and this task's explicit hard stop. Proven against the
-- local disposable-Postgres harness only (supabase/verify/live-rls.verify.mjs,
-- block "(j) schema cleanup") — never executed against the single shared
-- Supabase project. Record the outcome in supabase/APPLIED.md once it has
-- actually been run.
--
-- This is `src/lib/tenancy/RENAME.md` Step 7, second bullet.
--
-- ── The defect ───────────────────────────────────────────────────────────
-- schema.sql §5 / migration 002:
--
--     create table public.projects (
--       ...
--       slug text not null unique,          -- ← GLOBAL across all tenants
--       tenant_id uuid not null references public.tenants (id) ...,
--       ...
--     );
--
-- A project slug is unique across the ENTIRE platform, so no two clients can
-- each have a project called `main`, `starter` or `site`. In a system whose
-- whole premise is "one tenant owns N projects", that is a tenant-blind
-- constraint on a tenant-owned row.
--
-- It is a root cause, not a detail. RENAME.md §0 traces the three-namespace
-- mess this refactor is unwinding — `livener` / `livener-main` / `livener` —
-- back to exactly this: when the natural project name (`main`) is already
-- taken platform-wide, the cheapest thing to type is a tenant-prefixed name
-- (`livener-main`, `studiomartegani-main`). Those prefixes then diverged from
-- the URL segment and from Sanity's `projectSlug`, which is the direct cause
-- of the four live defects recorded in `f669ab9`. Replacing the constraint
-- removes the pressure that produced the prefixes, so the same shape cannot
-- regrow after the rename.
--
-- The correct grain is (tenant_id, slug): a slug identifies a project WITHIN
-- its owning tenant, and the tenant is always known — every project row
-- carries a NOT NULL `tenant_id` FK (migration 002).
--
-- ── Lookup-by-slug-alone audit — REQUIRED READING BEFORE APPLYING ────────
-- Once slugs are unique only per tenant, any lookup keyed on slug WITHOUT a
-- tenant is ambiguous. Full audit of `src/`, `scripts/` and `supabase/`,
-- 2026-09-01 (patterns: `.eq('slug', …)`, `where slug =`, `projectSlug ===`,
-- `find(… .slug …)`, plus every `.from('projects')` call site). FIVE sites
-- key on a project slug without a tenant. NONE of them is a silent
-- cross-tenant data leak today, but two are real correctness bugs the day two
-- tenants actually share a slug, and one blocks tooling:
--
--   1. src/lib/forms/submissions.ts:103 — `resolveProjectScope()`
--        .from('projects').select('id, tenant_id')
--        .eq('slug', unbrand(projectSlug)).maybeSingle()
--      The slug comes straight off the URL of `/api/forms/[projectSlug]/…`,
--      i.e. it is attacker-supplied. UNSAFE-BUT-FAILS-CLOSED. With two
--      same-slug projects the query matches 2 rows and PostgREST's
--      `.maybeSingle()` raises (PGRST116) rather than returning either one,
--      so `data` is undefined, the function returns `null`, and both call
--      sites (`create` :177 and `completeStep` :301) already treat `null` as
--      "unknown project" and fail closed — that null-vs-empty-scope
--      distinction is the documented point of this function's header. So the
--      failure mode is a broken form on BOTH projects, not one tenant's
--      submission landing in the other's tenant. It is still the most
--      important entry in this list: it is the one place where a hostile
--      caller picks the lookup key, and it turns a shared slug into an
--      outage. It needs the tenant (or the host, per RENAME.md Step 6) in the
--      lookup before any two tenants are allowed to share a slug.
--
--   2. src/lib/notifications/consumer.ts:92 — `resolveEventScope()`
--        .from('projects').select('id')
--        .eq('slug', unbrand(denormalized)).maybeSingle()
--      Same shape, narrower blast radius: this is the LEGACY branch, reached
--      only for a `form_events` row with no `project_id` (the id branch at
--      :78 is preferred and is keyed on `project_id`, which is unambiguous).
--      The slug is `form_events.project_slug`, written by
--      `resolveProjectSlugById()` — platform-internal, never user-supplied.
--      UNSAFE-BUT-FAILS-CLOSED, same `.maybeSingle()` mechanics: a shared
--      slug makes the lookup raise, `resolvedId` is null, the function
--      returns null and the event is not delivered. A stuck notification, not
--      a misrouted one. (Note the module's own header already calls this out
--      as the reason the id is the key and the slug is "carried only for
--      logs".)
--
--   3. src/lib/modules/client-navigation.ts:109 — `resolveProjectGrant()`
--        projects.find((grant) => grant.projectSlug === projectSlug)
--      In-memory, over `ctx.projects` — the caller's OWN grants, resolved
--      from `tenant_members`/`project_members` by
--      `getTenantAuthorizationContext()`. Called from every client-dashboard
--      route: `[tenant]/layout.tsx:42` (the `[tenant]` folder segment carries
--      a projectSlug — see that file's header), posts/leads/submissions/
--      analytics pages and `submissions/actions.ts:43`.
--      REAL BUG, and the only entry that can silently show the WRONG project:
--      the grant list spans every tenant the caller belongs to, so a user who
--      is a member of two tenants that both have a project `main` gets
--      `find()`'s FIRST match. The URL `/en/main/posts` then renders one of
--      the two arbitrarily, with no error. It cannot cross a permission
--      boundary — every candidate is a project the caller already holds a
--      grant on, and the fetches downstream are keyed on the resolved
--      grant's `projectId` — so it is a wrong-project-shown bug, not a leak.
--      Today it is unreachable: all six live projects have distinct slugs.
--      It becomes reachable the moment this constraint flips AND some user
--      holds grants in two tenants sharing a slug. Fixing it means the URL
--      must carry the tenant (RENAME.md Step 6's host-first resolution
--      already supplies one).
--
--   4. scripts/generate-route-config.mjs:197,200 — `hostsForProject()`
--        add(`${project.slug}${PREVIEW_SUFFIX}`,  'preview-subdomain')
--        add(`${project.slug}${LOCALHOST_SUFFIX}`, 'localhost-subdomain')
--      Not a lookup but the same assumption inverted: the preview host
--      namespace `{slug}.preview.abluo.app` (and `{slug}.localhost`) is
--      derived from the slug alone, so it is FLAT and global by construction.
--      Two tenants with a project `main` both claim `main.preview.abluo.app`.
--      SAFE, LOUDLY: `buildRows()`'s collision check (:222) throws
--      "Host collision: … Decision D-2 is one project = one host" and the
--      generator refuses to emit anything. Nothing is mis-served — but
--      regeneration is blocked, and with `--check` in the deploy pipeline
--      (RENAME.md Step 6) so is the deploy. Whoever first gives two tenants
--      the same slug must also decide what the preview host for each is.
--
--   5. supabase/ itself — nothing. Checked schema.sql and migrations 001–022:
--      no policy, SECURITY DEFINER helper, trigger, view or function reads
--      `projects.slug` at all (the helpers are all id-based:
--      `get_my_project_ids()` selects `id`). The only `where slug = …` in
--      this directory is schema.sql's own seed block, and it is on
--      `public.tenants.slug`, which this migration does not touch and which
--      remains globally unique. This migration is therefore invisible to
--      every RLS decision in the database.
--
-- ── Verdict ──────────────────────────────────────────────────────────────
-- The constraint can be flipped safely, because flipping it does not by
-- itself create a duplicate slug — it only stops the database from refusing
-- one. Every site above stays exactly as correct as it is today until
-- somebody inserts a second project with an existing slug in another tenant.
-- So: apply this migration whenever you like; treat sites 1, 3 and 4 as a
-- prerequisite for USING the new freedom. The safe sequencing is
--
--     apply 023  →  RENAME.md Step 6 (host-first resolution)  →  fix 1/3/4
--     →  only then create a project whose slug duplicates another tenant's.
--
-- A cheap tripwire in the meantime, which fails loudly rather than at 3am:
--
--     select slug, count(*) as tenants_using_it
--     from   public.projects group by slug having count(*) > 1;
--
-- It must return 0 rows until sites 1, 3 and 4 are fixed. Worth pinning as a
-- saved query in the dashboard the day this migration is applied.
--
-- ── What this migration does ─────────────────────────────────────────────
--   1. Drops whatever UNIQUE constraint currently covers exactly (slug).
--      Discovered from the catalog rather than assumed by name: the
--      constraint is implicit (`slug text not null unique`), so Postgres
--      named it `projects_slug_key`, but a hand-applied schema could have
--      given it another name and this must not depend on that.
--   2. Adds `unique (tenant_id, slug)` as a NAMED constraint,
--      `projects_tenant_id_slug_key`, so future migrations can address it.
--   3. Leaves `projects_slug_idx` (the plain, non-unique index on slug) in
--      place. It is still the right index for the by-slug lookups above,
--      which continue to exist; the composite unique constraint's own index
--      is (tenant_id, slug) and cannot serve a slug-only predicate.
--
-- Idempotent: the drop is catalog-driven and a no-op when the constraint is
-- already gone; the add is guarded by an existence check. Safe to re-run.
--
-- ── What this migration deliberately does NOT do ─────────────────────────
--   * It does not rename any project. The `livener-main` /
--     `studiomartegani-main` names live in SANITY (`projectSlug`), not in
--     this column — `projects.slug` is already `livener` /
--     `studiomartegani` (RENAME.md §0). This migration only removes the
--     constraint that made such prefixes look necessary; RENAME.md Steps 3–5
--     do the actual renaming, in Sanity, and are unaffected by this file.
--   * It does not touch `projects.custom_domain`, which stays GLOBALLY
--     unique — correctly so: a host is a global resource and two tenants
--     genuinely cannot both own `example.com`.
--   * It does not touch `tenants.slug`, which stays globally unique — it is
--     the top of the ownership tree, so it has nothing to be scoped to.
--   * It changes no policy and no grant.
-- ============================================================


-- ── 1. Drop the global unique on (slug) ──────────────────────────────────
--
-- Catalog-driven: finds every UNIQUE constraint on public.projects whose
-- column list is exactly (slug) — normally one, named projects_slug_key —
-- and drops it. Its backing index goes with it. A table that has already
-- been migrated has no such constraint and this loop does nothing.

do $$
declare
  con record;
  slug_attnum smallint;
begin
  select a.attnum into slug_attnum
  from   pg_attribute a
  join   pg_class     c on c.oid = a.attrelid
  join   pg_namespace n on n.oid = c.relnamespace
  where  n.nspname = 'public' and c.relname = 'projects'
  and    a.attname = 'slug' and not a.attisdropped;

  if slug_attnum is null then
    raise exception 'public.projects has no slug column — refusing to guess';
  end if;

  for con in
    select c.conname
    from   pg_constraint c
    join   pg_class      r on r.oid = c.conrelid
    join   pg_namespace  n on n.oid = r.relnamespace
    where  n.nspname = 'public' and r.relname = 'projects'
    and    c.contype  = 'u'
    and    c.conkey   = array[slug_attnum]
  loop
    execute format('alter table public.projects drop constraint %I', con.conname);
    raise notice 'dropped global unique constraint %I on public.projects (slug)', con.conname;
  end loop;
end
$$;


-- ── 2. Add the per-tenant unique ─────────────────────────────────────────
--
-- `add constraint … if not exists` does not exist in PostgreSQL, hence the
-- guard. Note the column order (tenant_id, slug): the constraint's index is
-- then also usable for the very common "all projects of this tenant" scan.

do $$
begin
  if not exists (
    select 1
    from   pg_constraint c
    join   pg_class      r on r.oid = c.conrelid
    join   pg_namespace  n on n.oid = r.relnamespace
    where  n.nspname = 'public' and r.relname = 'projects'
    and    c.conname = 'projects_tenant_id_slug_key'
  ) then
    alter table public.projects
      add constraint projects_tenant_id_slug_key unique (tenant_id, slug);
  end if;
end
$$;


comment on column public.projects.slug is
  'Project slug, unique WITHIN its owning tenant (migration 023, '
  'constraint projects_tenant_id_slug_key) — NOT globally. Any lookup by '
  'slug must also carry the tenant (or resolve the project from the host, '
  'per src/lib/tenancy/host-scope.ts); see migration 023''s header for the '
  'audited list of call sites that still key on slug alone.';


-- ============================================================
-- Verification — run in the Supabase SQL editor after applying
-- ============================================================
--
-- 1. The constraint set on public.projects is exactly what is expected:
--
--    select con.conname, con.contype, pg_get_constraintdef(con.oid) as def
--    from   pg_constraint con
--    join   pg_class      r on r.oid = con.conrelid
--    join   pg_namespace  n on n.oid = r.relnamespace
--    where  n.nspname = 'public' and r.relname = 'projects'
--    order  by con.contype, con.conname;
--
--    Expected: a UNIQUE `projects_tenant_id_slug_key` with definition
--    `UNIQUE (tenant_id, slug)`, a UNIQUE on (custom_domain) (unchanged),
--    the primary key, the FK to tenants, and the status CHECK.
--    There must be NO unique constraint whose definition is `UNIQUE (slug)`.
--
-- 2. Indexes — the composite exists and the plain slug index survived:
--
--    select indexname, indexdef from pg_indexes
--    where  schemaname = 'public' and tablename = 'projects'
--    order  by indexname;
--
--    Expected to include `projects_tenant_id_slug_key` (unique, on
--    (tenant_id, slug)) and `projects_slug_idx` (non-unique, on (slug)), and
--    to NOT include `projects_slug_key`.
--
-- 3. The new constraint actually bites — proof, not inspection. Run inside a
--    transaction and roll it back; substitute two real tenant ids:
--
--    begin;
--      -- same slug, DIFFERENT tenants: must SUCCEED (this is the point)
--      insert into public.projects (slug, tenant_id, name)
--      values ('constraint-probe', '<tenant-A-uuid>', 'probe A'),
--             ('constraint-probe', '<tenant-B-uuid>', 'probe B');
--      -- same slug, SAME tenant: must FAIL with 23505 on
--      -- projects_tenant_id_slug_key
--      insert into public.projects (slug, tenant_id, name)
--      values ('constraint-probe', '<tenant-A-uuid>', 'probe A2');
--    rollback;
--
--    ⚠️ Do not forget the `rollback` — and note that even the successful
--    insert would create real preview hosts if committed (see audit entry 4).
--
-- 4. No duplicate slug has appeared yet. This must stay at 0 rows until the
--    call sites in the header's audit entries 1, 3 and 4 are fixed:
--
--    select slug, count(*) as tenants_using_it
--    from   public.projects group by slug having count(*) > 1;
--
-- 5. Nothing about RLS changed:
--
--    select policyname, cmd, qual from pg_policies
--    where  schemaname = 'public' and tablename = 'projects'
--    order  by policyname;
--    -- Expect the migration-013 policy set, byte-identical to before.
--
-- 6. Behavioural proof (harness, not the dashboard): `npm run verify` in
--    supabase/verify — block "(j) schema cleanup" inserts two projects with
--    the SAME slug under two DIFFERENT tenants (must succeed) and a
--    duplicate slug within ONE tenant (must be rejected with 23505), on a
--    real PostgreSQL.

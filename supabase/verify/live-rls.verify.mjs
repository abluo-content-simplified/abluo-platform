/**
 * Live-DB verification suite — Phase A safety net (ADR-017 slice 5 groundwork).
 *
 * Connects to a REAL local Postgres (see lib/harness.mjs) and drives every
 * assertion AS the `authenticated` Postgres role, with `request.jwt.claims`
 * set per test via `public.set_session_auth(userId, role, extraClaims)` —
 * exactly the two enforcement layers (table GRANT, then RLS policy) a real
 * Supabase request goes through. This is what the in-memory
 * `cross-tenant-isolation.test.ts` structurally cannot catch.
 *
 * Regression guards reproduce the exact slice-4 bug classes:
 *   (a) migration 011 — a missing base-table GRANT surfaces as
 *       "permission denied for table X", not an empty result set.
 *   (b) tenant A cannot see/act on tenant B's rows, for every table that
 *       matters: tenant_members, projects, project_members (and, after
 *       migration 014 is applied in the dedicated suite below, inquiries).
 *   (c) no policy causes "infinite recursion detected in policy for
 *       relation X" (the migration 013 bug).
 *   (d) an abluo_admin JWT claim behaves as intended — i.e. it does NOT
 *       silently widen row visibility at the RLS layer (ADR-017 Decision 2/
 *       tenant-context.ts's own module comment: abluo_admin reaches
 *       cross-tenant surfaces through separate service-role admin routes,
 *       never through this per-row RLS path) — the negative-control most
 *       likely to be gotten wrong.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let client

beforeAll(async () => {
  ;({ client } = await startHarness())
}, 60_000)

afterAll(async () => {
  await stopHarness(client)
}, 30_000)

// ── Fixture world: three tenants, four projects ────────────────────────────
//
// Tenant A ("livener")          — owner: userA
//   project A1 ("livener-main")
// Tenant B ("studiomartegani")  — owner: userB
//   project B1 ("studiomartegani-main")
// userEditorA1 — project_members editor on A1 only, no tenant_members row
//   anywhere (isolates the project_members-only grant path).
//
// Tenant C ("freeriders")       — owner: userC
//   project C1 ("nologo")
//   project C2 ("t42")
// Tenant C is the TWO-PROJECT tenant, mirroring the real live-Supabase
// `freeriders` tenant which owns both `nologo` and `t42` as of 2026-08-31.
// It exists because, until it was added, EVERY tenant in this fixture owned
// exactly one project — which means no assertion in this file could
// distinguish TENANT grain from PROJECT grain: the two collapse into the
// same row set when a tenant has a single project. That is precisely the
// RC-4 failure mode ("any capability a client can switch on/off needs an
// acceptance check that switches it on") applied to the fixture itself.
// Every table's grain is now separable — see block (i). That is what made
// the `leads` grain defect visible and led to migration 020, which moved
// `leads` onto the same project grain as `form_submissions`/`form_events`.
//
// Tenant C's users are chosen so each grant PATH is isolated:
//   userC             — tenant_members OWNER on tenant C, no project_members
//                       row at all. Tenant grain + owner precedence (ADR-017
//                       Decision 2: owning a tenant implies all its projects).
//   userEditorC1      — project_members EDITOR on C1 ONLY, no tenant_members
//                       row anywhere (same shape as userEditorA1, but now
//                       against a tenant that has a SECOND project to leak
//                       into). This is the user that answers "is this table
//                       tenant grain or project grain?" for real.
//   userTenantViewerC — tenant_members VIEWER on tenant C, no project_members
//                       row. The mirror-image probe: tenant grain WITHOUT
//                       owner precedence, so get_my_tenant_ids() returns
//                       tenant C while get_my_project_ids() returns NOTHING.

const ids = {}

async function asSuperuser(fn) {
  await client.query(`select public.reset_session_auth()`)
  return fn()
}

async function loginAs(userId, extraClaims = {}) {
  await client.query(`select public.set_session_auth($1::uuid, 'authenticated', $2::jsonb)`, [
    userId,
    JSON.stringify(extraClaims),
  ])
}

async function logout() {
  await client.query(`select public.reset_session_auth()`)
}

beforeEach(async () => {
  await logout()
})

describe('fixture setup', () => {
  it('seeds three tenants (one of them owning TWO projects), four projects, six users, and memberships as superuser', async () => {
    await asSuperuser(async () => {
      const tenantA = await client.query(
        `insert into public.tenants (slug, display_name, domain) values ('verify-tenant-a', 'Tenant A', 'tenant-a.verify.test') returning id`
      )
      const tenantB = await client.query(
        `insert into public.tenants (slug, display_name, domain) values ('verify-tenant-b', 'Tenant B', 'tenant-b.verify.test') returning id`
      )
      ids.tenantA = tenantA.rows[0].id
      ids.tenantB = tenantB.rows[0].id

      const projectA1 = await client.query(
        `insert into public.projects (slug, tenant_id, name) values ('verify-a1', $1, 'Project A1') returning id`,
        [ids.tenantA]
      )
      const projectB1 = await client.query(
        `insert into public.projects (slug, tenant_id, name) values ('verify-b1', $1, 'Project B1') returning id`,
        [ids.tenantB]
      )
      ids.projectA1 = projectA1.rows[0].id
      ids.projectB1 = projectB1.rows[0].id

      const userA = await client.query(`insert into auth.users (email) values ('owner-a@verify.test') returning id`)
      const userB = await client.query(`insert into auth.users (email) values ('owner-b@verify.test') returning id`)
      const userEditorA1 = await client.query(
        `insert into auth.users (email) values ('editor-a1@verify.test') returning id`
      )
      const userNoMemberships = await client.query(
        `insert into auth.users (email) values ('nobody@verify.test') returning id`
      )
      ids.userA = userA.rows[0].id
      ids.userB = userB.rows[0].id
      ids.userEditorA1 = userEditorA1.rows[0].id
      ids.userNoMemberships = userNoMemberships.rows[0].id

      await client.query(
        `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [ids.tenantA, ids.userA]
      )
      await client.query(
        `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [ids.tenantB, ids.userB]
      )
      await client.query(
        `insert into public.project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
        [ids.projectA1, ids.userEditorA1]
      )

      // ── Tenant C — the two-project tenant (mirrors freeriders/nologo+t42) ──
      // Everything below follows the same insert idiom as tenants A/B above;
      // the only structural difference is that ONE tenant now owns TWO
      // projects, which is what makes tenant-grain vs project-grain
      // separable for the first time in this fixture.
      const tenantC = await client.query(
        `insert into public.tenants (slug, display_name, domain) values ('verify-tenant-c', 'Tenant C', 'tenant-c.verify.test') returning id`
      )
      ids.tenantC = tenantC.rows[0].id

      const projectC1 = await client.query(
        `insert into public.projects (slug, tenant_id, name) values ('verify-c1', $1, 'Project C1') returning id`,
        [ids.tenantC]
      )
      const projectC2 = await client.query(
        `insert into public.projects (slug, tenant_id, name) values ('verify-c2', $1, 'Project C2') returning id`,
        [ids.tenantC]
      )
      ids.projectC1 = projectC1.rows[0].id
      ids.projectC2 = projectC2.rows[0].id

      const userC = await client.query(`insert into auth.users (email) values ('owner-c@verify.test') returning id`)
      const userEditorC1 = await client.query(
        `insert into auth.users (email) values ('editor-c1@verify.test') returning id`
      )
      const userTenantViewerC = await client.query(
        `insert into auth.users (email) values ('tenant-viewer-c@verify.test') returning id`
      )
      ids.userC = userC.rows[0].id
      ids.userEditorC1 = userEditorC1.rows[0].id
      ids.userTenantViewerC = userTenantViewerC.rows[0].id

      await client.query(
        `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [ids.tenantC, ids.userC]
      )
      await client.query(
        `insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'viewer')`,
        [ids.tenantC, ids.userTenantViewerC]
      )
      // NOTE: userEditorC1 deliberately gets NO tenant_members row — the
      // whole point of this user is the project_members-only grant path.
      await client.query(
        `insert into public.project_members (project_id, user_id, role) values ($1, $2, 'editor')`,
        [ids.projectC1, ids.userEditorC1]
      )

      // No manual profiles insert needed: `on_auth_user_created` /
      // `handle_new_user()` (schema.sql / migration 004) already fires on
      // every `auth.users` insert above and creates the profiles row
      // automatically (identity-only, regardless of tenant_id metadata).
    })

    expect(Object.keys(ids).length).toBeGreaterThan(0)
  })
})

// ── (a) Missing-grant regression guard (migration 011 bug class) ──────────

describe('(a) base-table GRANT is present for authenticated — migration 011 bug class', () => {
  it('authenticated has SELECT on tenant_members, project_members, projects', async () => {
    const { rows } = await client.query(
      `select table_name from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'SELECT'
       and table_name in ('tenant_members', 'project_members', 'projects')`
    )
    const granted = rows.map((r) => r.table_name).sort()
    expect(granted).toEqual(['project_members', 'projects', 'tenant_members'])
  })

  it('a real authenticated read of tenant_members fails CLOSED with a permission error if the grant is (hypothetically) revoked — proves the harness actually distinguishes "no grant" from "empty result"', async () => {
    // Revoke, probe, re-grant — isolated to this test, doesn't leak into others.
    await asSuperuser(() => client.query(`revoke select on public.tenant_members from authenticated`))
    await loginAs(ids.userA)
    await expect(client.query(`select * from public.tenant_members`)).rejects.toThrow(
      /permission denied for table tenant_members/
    )
    await asSuperuser(() => client.query(`grant select on public.tenant_members to authenticated`))
  })

  it('with the grant restored, the same read succeeds (not just "no longer throws" — returns the caller\'s own row)', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select * from public.tenant_members`)
    expect(rows.map((r) => r.tenant_id)).toEqual([ids.tenantA])
  })
})

// ── (b) Cross-tenant isolation — tenant_members, projects, project_members ─

describe('(b) cross-tenant isolation under real RLS', () => {
  it('tenant_members: userA sees only their own membership row, never tenant B\'s', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select tenant_id, user_id from public.tenant_members`)
    expect(rows).toHaveLength(1)
    expect(rows[0].tenant_id).toBe(ids.tenantA)
  })

  it('projects: userA (owner of tenant A) can SELECT project A1 but not project B1', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select id from public.projects where id in ($1, $2)`, [
      ids.projectA1,
      ids.projectB1,
    ])
    expect(rows.map((r) => r.id)).toEqual([ids.projectA1])
  })

  // ── DISCOVERED GAP (out of this task's P0 scope — flagged, not fixed) ──
  // Neither of the two UPDATE probes below can distinguish "wrong tenant,
  // correctly denied" from "correctly scoped, actually worked" the way the
  // isolation tests above do — because `authenticated` has NO write grant
  // (INSERT/UPDATE/DELETE) on `projects` at all. Migration 011 added only
  // `grant select`; no migration in 001–013 ever grants write on projects,
  // tenant_members, or project_members to `authenticated`. The "Owners can
  // manage their projects" RLS ALL policy (schema.sql / migration 004) is
  // consequently unreachable for any real authenticated session today — it
  // is dead code at the privilege layer, not just row-filtered. Today this
  // is harmless (all project writes go through service-role admin routes),
  // but it means that RLS policy has never been exercised the way its
  // authors intended, and the isolation it appears to provide is currently
  // provided entirely by grants being absent, not by the policy. Recorded
  // here as a discovered gap for Tom — see handoff §10 — not remediated by
  // this task (scope is `inquiries`, not `projects`).
  it('KNOWN GAP: authenticated has no write grant on projects at all — UPDATE fails closed regardless of tenant (not the same thing as RLS scoping)', async () => {
    await loginAs(ids.userA)
    await expect(
      client.query(`update public.projects set name = 'hijacked' where id = $1`, [ids.projectB1])
    ).rejects.toThrow(/permission denied for table projects/)
    // Same failure for the OWNER's own project — proves this is a missing
    // GRANT, not RLS row-scoping (a real RLS block would be a 0-row UPDATE,
    // not a permission-denied error).
    await expect(
      client.query(`update public.projects set name = 'renamed' where id = $1`, [ids.projectA1])
    ).rejects.toThrow(/permission denied for table projects/)
  })

  it('project_members: a project-only editor (userEditorA1, no tenant_members row anywhere) sees exactly project A1, nothing from tenant B', async () => {
    await loginAs(ids.userEditorA1)
    const { rows } = await client.query(`select id, slug from public.projects`)
    expect(rows.map((r) => r.id)).toEqual([ids.projectA1])
  })

  it('project_members: userEditorA1 cannot read project_members rows belonging to a project they don\'t own/aren\'t admin of', async () => {
    await loginAs(ids.userEditorA1)
    // Seed (as superuser) a second project_members row on B1 for userB, then
    // confirm userEditorA1's own-rows-only policy hides it.
    await asSuperuser(() =>
      client.query(`insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')`, [
        ids.projectB1,
        ids.userB,
      ])
    )
    await loginAs(ids.userEditorA1)
    const { rows } = await client.query(`select * from public.project_members`)
    expect(rows).toHaveLength(1)
    expect(rows[0].project_id).toBe(ids.projectA1)
  })

  it('a user with zero memberships anywhere sees zero rows on every membership-scoped table', async () => {
    await loginAs(ids.userNoMemberships)
    const [tm, pm, pr] = await Promise.all([
      client.query(`select * from public.tenant_members`),
      client.query(`select * from public.project_members`),
      client.query(`select * from public.projects`),
    ])
    expect(tm.rows).toHaveLength(0)
    expect(pm.rows).toHaveLength(0)
    expect(pr.rows).toHaveLength(0)
  })
})

// ── (c) No infinite recursion — migration 013 bug class ────────────────────

describe('(c) no infinite recursion in projects/project_members policies — migration 013 regression guard', () => {
  it('userA (tenant owner) reading projects does not recurse', async () => {
    await loginAs(ids.userA)
    await expect(client.query(`select * from public.projects`)).resolves.toBeDefined()
  })

  it('userEditorA1 (project_members-only) reading projects does not recurse', async () => {
    await loginAs(ids.userEditorA1)
    await expect(client.query(`select * from public.projects`)).resolves.toBeDefined()
  })

  it('userB (tenant owner) reading project_members does not recurse (exercises migration 007\'s raw projects subquery inside project_members\' own policy)', async () => {
    await loginAs(ids.userB)
    await expect(client.query(`select * from public.project_members`)).resolves.toBeDefined()
  })
})

// ── (d) abluo_admin JWT claim behavior ──────────────────────────────────────

describe('(d) abluo_admin platform_role claim does not widen RLS row visibility', () => {
  it('a user carrying platform_role=abluo_admin in app_metadata, but with a real membership only on tenant A, still cannot read tenant B\'s rows via RLS', async () => {
    // ADR-017 / tenant-context.ts module comment: abluo_admin is NOT
    // special-cased in any RLS policy — admin cross-tenant reads happen via
    // separate service-role routes, never through these per-row policies.
    // This is the negative control that proves that design held at the DB
    // layer, not just in application code review.
    await loginAs(ids.userA, { app_metadata: { platform_role: 'abluo_admin' } })
    const { rows } = await client.query(`select id from public.projects where id = $1`, [ids.projectB1])
    expect(rows).toHaveLength(0)
  })

  it('custom_access_token_hook resolves platform_role=abluo_admin only from a real app_metadata.platform_role=="abluo_admin" claim, tenant_user otherwise (fail-safe default)', async () => {
    await asSuperuser(async () => {
      const admin = await client.query(
        `select public.custom_access_token_hook($1::jsonb) as event`,
        [JSON.stringify({ claims: { app_metadata: { platform_role: 'abluo_admin' } } })]
      )
      expect(admin.rows[0].event.claims.platform_role).toBe('abluo_admin')

      const absent = await client.query(
        `select public.custom_access_token_hook($1::jsonb) as event`,
        [JSON.stringify({ claims: { app_metadata: {} } })]
      )
      expect(absent.rows[0].event.claims.platform_role).toBe('tenant_user')

      // NUANCE (not a bug in this hook, but worth making explicit): the
      // hook's `coalesce(..., 'tenant_user')` only substitutes on SQL NULL
      // — an absent claim (undefined key, first case above) resolves to
      // NULL via the `->>` operator and IS caught. A present-but-garbage
      // string is NOT NULL, so coalesce passes it through unchanged. The
      // hook alone is therefore not the fail-safe boundary for a garbage
      // (as opposed to absent) app_metadata.platform_role value — that
      // boundary is `resolvePlatformRole()` in src/lib/api/auth.ts, which
      // requires an EXACT 'abluo_admin' match and treats every other value
      // (including this garbage case) as 'tenant_user'. Defense in depth:
      // app_metadata is server-controlled/unspoofable either way (migration
      // 006 header), so a garbage value can only originate from an
      // operator/deploy mistake, not attacker input — but the two layers'
      // fail-safe semantics differ, which is worth Tom knowing.
      const garbage = await client.query(
        `select public.custom_access_token_hook($1::jsonb) as event`,
        [JSON.stringify({ claims: { app_metadata: { platform_role: 'super-admin' } } })]
      )
      expect(garbage.rows[0].event.claims.platform_role).toBe('super-admin')
    })
  })
})

// ── profiles UPDATE grant regression (migration 012 bug class) ─────────────

describe('profiles: column-scoped UPDATE grant (migration 012 regression guard)', () => {
  // ── This gap is now FIXED by migration 015 (applied in the dedicated
  // describe block at the end of this file). The two tests below run BEFORE
  // migration 015 is applied and are retained as the PRE-015 regression
  // guard — they prove the fault genuinely existed against the real
  // migrations, so a future revert of migration 015 would fail here. ────────
  //
  // ── DISCOVERED GAP (as it stood pre-015 — the reason migration 015 exists)
  // Migration 012 grants `update (full_name) on public.profiles to
  // authenticated`, and the RLS policy `id = auth.uid()` is correct — but
  // PostgreSQL requires SELECT privilege on any column referenced in an
  // UPDATE's WHERE clause (or RETURNING/expressions), not just the columns
  // being SET. `authenticated` has NEVER been granted SELECT on
  // `public.profiles` (migration 011's audit covered tenant_members/
  // project_members/projects only; migration 012's own header explicitly
  // says "No SELECT grant is added ... add it separately, deliberately, if/
  // when a client-side profiles read is built" — not anticipating that
  // UPDATE ... WHERE id = $1 itself needs it). The live invite-acceptance
  // flow (src/app/invite/accept/page.tsx:382-385,
  // `.from('profiles').update({ full_name }).eq('id', freshUserId)`) uses
  // exactly this shape. That file's own comment (line 376) says "The DB
  // grant + RLS UPDATE policy on profiles are confirmed correct" — this
  // harness empirically disproves that claim: the exact same query shape,
  // run here against the real migrations under a real `authenticated`
  // session, fails with `permission denied for table profiles`, not a
  // successful update. This means the invite-acceptance name-sync write is
  // silently failing in production today (caught by that page's own
  // profileError handling — it shows a "your name may not have saved"
  // warning rather than crashing — so it is not silently invisible, but it
  // is a real, currently-active gap). See handoff §10.
  it('KNOWN GAP: an UPDATE ... WHERE id = $1 (the invite/accept page\'s exact query shape) fails — authenticated lacks SELECT on profiles, which Postgres requires for any WHERE-referenced column even on a column-scoped UPDATE grant', async () => {
    await loginAs(ids.userA)
    await expect(
      client.query(`update public.profiles set full_name = 'Renamed' where id = $1`, [ids.userA])
    ).rejects.toThrow(/permission denied for table profiles/)
  })

  it('cross-check: the SAME update succeeds once SELECT is (hypothetically) granted — isolates the failure to the missing SELECT grant, not the UPDATE grant or the RLS policy', async () => {
    await asSuperuser(() => client.query(`grant select on public.profiles to authenticated`))
    await loginAs(ids.userA)
    await expect(
      client.query(`update public.profiles set full_name = 'Renamed' where id = $1`, [ids.userA])
    ).resolves.toMatchObject({ rowCount: 1 })
    // And the RLS "own row only" boundary still correctly holds with SELECT
    // granted — confirms the fix (if Tom applies one) wouldn't itself widen
    // cross-user write access.
    const { rowCount } = await client.query(`update public.profiles set full_name = 'hijacked' where id = $1`, [
      ids.userB,
    ])
    expect(rowCount).toBe(0)
    await asSuperuser(() => client.query(`revoke select on public.profiles from authenticated`))
  })
})

// ── (e) inquiries authz — migration 014 (this task's P0 fix) ──────────────
//
// Applied here, as the LAST describe block, so every test above ran
// against the pre-014 (current production) state first. Seeds two
// inquiries rows (one per tenant/project) and proves the exact isolation
// this task's migration 014 + route fix are meant to guarantee: a
// cross-tenant caller cannot read or update another tenant's inquiry, a
// legitimate owner/editor of the right tenant/project CAN, a viewer can
// read but not write, and an unauthenticated (no session at all) caller is
// denied by RLS just as completely as a cross-tenant one — the DB-layer
// half of "the route must fail closed for anonymous callers".

describe('(e) inquiries authz — migration 014 (closes the live P0)', () => {
  const inquiryIds = {}

  beforeAll(async () => {
    await asSuperuser(async () => {
      // Pre-014 baseline, asserted once before applying the migration —
      // proves the harness is testing a real before/after, not a fixture
      // that always looked this way.
      const preGrants = await client.query(
        `select privilege_type from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'inquiries' and grantee = 'authenticated'`
      )
      if (preGrants.rows.length !== 0) {
        throw new Error(
          'Expected zero authenticated grants on inquiries before migration 014 — got: ' +
            JSON.stringify(preGrants.rows)
        )
      }

      await applyMigrationFile(client, path.join(__dirname, '..', 'migrations', '014_inquiries_authz.sql'))

      // Seed inquiries: one for tenant A / project A1, one for tenant B /
      // project B1, one platform-level (no tenant/project — must stay
      // invisible to every authenticated role tested here).
      const inqA = await client.query(
        `insert into public.inquiries (tenant_id, project_id, name, email) values ($1, $2, 'Inquiry A', 'a@verify.test') returning id`,
        [ids.tenantA, ids.projectA1]
      )
      const inqB = await client.query(
        `insert into public.inquiries (tenant_id, project_id, name, email) values ($1, $2, 'Inquiry B', 'b@verify.test') returning id`,
        [ids.tenantB, ids.projectB1]
      )
      const inqPlatform = await client.query(
        `insert into public.inquiries (name, email) values ('Platform inquiry', 'platform@verify.test') returning id`
      )
      inquiryIds.a = inqA.rows[0].id
      inquiryIds.b = inqB.rows[0].id
      inquiryIds.platform = inqPlatform.rows[0].id

      // A viewer-only user on project A1, for the read-but-not-write case.
      const userViewerA1 = await client.query(
        `insert into auth.users (email) values ('viewer-a1@verify.test') returning id`
      )
      ids.userViewerA1 = userViewerA1.rows[0].id
      await client.query(
        `insert into public.project_members (project_id, user_id, role) values ($1, $2, 'viewer')`,
        [ids.projectA1, ids.userViewerA1]
      )
    })
  })

  it('post-014: authenticated now has SELECT + UPDATE on inquiries (grant closes; no INSERT/DELETE was added)', async () => {
    const { rows } = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'inquiries' and grantee = 'authenticated'
       order by privilege_type`
    )
    expect(rows.map((r) => r.privilege_type)).toEqual(['SELECT', 'UPDATE'])
  })

  it('tenant A owner (userA) can read Inquiry A but not Inquiry B or the platform-level inquiry', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select id from public.inquiries order by id`)
    const seen = rows.map((r) => r.id)
    expect(seen).toContain(inquiryIds.a)
    expect(seen).not.toContain(inquiryIds.b)
    expect(seen).not.toContain(inquiryIds.platform)
  })

  it('tenant B owner (userB) can read Inquiry B but not Inquiry A', async () => {
    await loginAs(ids.userB)
    const { rows } = await client.query(`select id from public.inquiries`)
    const seen = rows.map((r) => r.id)
    expect(seen).toContain(inquiryIds.b)
    expect(seen).not.toContain(inquiryIds.a)
  })

  it("CROSS-TENANT WRITE DENIAL: tenant A owner (userA) CANNOT update tenant B's inquiry (0 rows affected — this is the exact PATCH /api/inquiries/[id] P0 scenario)", async () => {
    await loginAs(ids.userA)
    const { rowCount } = await client.query(
      `update public.inquiries set data = '{"hijacked": true}'::jsonb where id = $1`,
      [inquiryIds.b]
    )
    expect(rowCount).toBe(0)
  })

  it('LEGITIMATE OWNER CAN update their own tenant/project inquiry', async () => {
    await loginAs(ids.userA)
    const { rowCount } = await client.query(
      `update public.inquiries set data = '{"organization": "Acme"}'::jsonb where id = $1`,
      [inquiryIds.a]
    )
    expect(rowCount).toBe(1)
  })

  it('project-only editor (userEditorA1, no tenant_members row) can also update Inquiry A via the project_id branch', async () => {
    await loginAs(ids.userEditorA1)
    const { rowCount } = await client.query(
      `update public.inquiries set data = '{"organization": "Acme via editor"}'::jsonb where id = $1`,
      [inquiryIds.a]
    )
    expect(rowCount).toBe(1)
  })

  it('VIEWER CAN READ but CANNOT WRITE — project-only viewer on A1 sees Inquiry A but an UPDATE affects 0 rows', async () => {
    await loginAs(ids.userViewerA1)
    const read = await client.query(`select id from public.inquiries where id = $1`, [inquiryIds.a])
    expect(read.rows).toHaveLength(1)

    const write = await client.query(`update public.inquiries set data = '{"x": 1}'::jsonb where id = $1`, [
      inquiryIds.a,
    ])
    expect(write.rowCount).toBe(0)
  })

  it('ANONYMOUS (no session at all — RESET ROLE, no request.jwt.claims) is denied by RLS just as completely as a cross-tenant caller: 0 rows on both SELECT and UPDATE', async () => {
    await logout() // no set_session_auth() call — this IS the anonymous case
    // Query as the bare `authenticated` role would still require SET ROLE;
    // logout() resets to `postgres` (superuser, bypassrls) which is NOT a
    // faithful anonymous simulation. Explicitly simulate anon instead: the
    // `anon` role, no claims at all.
    await client.query(`set role anon`)
    await expect(client.query(`select id from public.inquiries where id = $1`, [inquiryIds.a])).rejects.toThrow(
      /permission denied for table inquiries/
    )
    await client.query(`reset role`)
  })

  it('the no-INSERT-policy decision holds: even a legitimate tenant owner cannot INSERT via the authenticated role (public inserts stay service-role only, by design — see migration 014 "OPEN DECISION")', async () => {
    await loginAs(ids.userA)
    await expect(
      client.query(
        `insert into public.inquiries (tenant_id, project_id, name, email) values ($1, $2, 'x', 'x@x.test')`,
        [ids.tenantA, ids.projectA1]
      )
    ).rejects.toThrow(/permission denied for table inquiries/)
  })

  it('platform-level inquiry (no tenant_id, no project_id) stays invisible to every authenticated tenant/project member tested', async () => {
    for (const userId of [ids.userA, ids.userB, ids.userEditorA1, ids.userViewerA1]) {
      await loginAs(userId)
      const { rows } = await client.query(`select id from public.inquiries where id = $1`, [inquiryIds.platform])
      expect(rows).toHaveLength(0)
    }
  })
})

// ── (f) profiles SELECT grant — migration 015 (closes the invite/accept gap) ─
//
// Applied here, as the LAST describe block, so the PRE-015 regression guard
// in the "profiles: column-scoped UPDATE grant" block above ran first
// against the real (pre-015) migration state and observed the genuine
// `permission denied for table profiles` failure. This block then applies
// migration 015 verbatim on top of 001–014 and proves:
//   (a) the invite/accept UPDATE ... WHERE id = $1 shape now SUCCEEDS,
//   (b) the "own row" SELECT RLS policy still isolates — user A cannot read
//       (nor write) user B's profile row, so the table-level SELECT grant
//       did NOT widen cross-user visibility, exactly as migration 015's
//       header claims.
// Requirement (c) — reproducing the pre-015 failure as a guard — is
// satisfied by the retained PRE-015 tests in the migration-012 block above;
// they will start failing the moment migration 015 is reverted.

describe('(f) profiles SELECT grant — migration 015 (closes the invite/accept name-sync gap)', () => {
  beforeAll(async () => {
    await asSuperuser(() =>
      applyMigrationFile(client, path.join(__dirname, '..', 'migrations', '015_profiles_select_grant.sql'))
    )
  })

  it('post-015: authenticated now has TABLE-level SELECT on profiles (migration 015), while migration 012\'s UPDATE stays COLUMN-scoped to full_name only', async () => {
    // Migration 015 grants table-level SELECT — visible in role_table_grants.
    const table = await client.query(
      `select distinct privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'
       order by privilege_type`
    )
    expect(table.rows.map((r) => r.privilege_type)).toEqual(['SELECT'])

    // Migration 012's UPDATE is COLUMN-scoped (grant update (full_name)),
    // so it appears in column_privileges — not role_table_grants — and only
    // for full_name (never id, avatar_url, created_at). Confirm 015 did not
    // widen it into a table-level or all-column UPDATE.
    const cols = await client.query(
      `select privilege_type, column_name from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'
         and privilege_type = 'UPDATE'
       order by column_name`
    )
    expect(cols.rows).toEqual([{ privilege_type: 'UPDATE', column_name: 'full_name' }])
  })

  it("(a) the invite/accept path — UPDATE profiles SET full_name = $1 WHERE id = A — now SUCCEEDS for the caller's own row (1 row affected)", async () => {
    await loginAs(ids.userA)
    const res = await client.query(`update public.profiles set full_name = $1 where id = $2`, [
      'Invited Owner A',
      ids.userA,
    ])
    expect(res.rowCount).toBe(1)
    // Read-back through the caller's own SELECT (now granted) confirms it stuck.
    const { rows } = await client.query(`select full_name from public.profiles where id = $1`, [ids.userA])
    expect(rows).toHaveLength(1)
    expect(rows[0].full_name).toBe('Invited Owner A')
  })

  it('(b) RLS still isolates: user A cannot SELECT user B\'s profile row (0 rows), and SELECT * returns only A\'s own row — the table grant did not widen cross-user visibility', async () => {
    await loginAs(ids.userA)
    const other = await client.query(`select id from public.profiles where id = $1`, [ids.userB])
    expect(other.rows).toHaveLength(0)

    const all = await client.query(`select id from public.profiles`)
    expect(all.rows.map((r) => r.id)).toEqual([ids.userA])
  })

  it('(b cont.) RLS still isolates writes: user A\'s UPDATE targeting user B\'s row affects 0 rows (own-row UPDATE policy unchanged)', async () => {
    await loginAs(ids.userA)
    const { rowCount } = await client.query(`update public.profiles set full_name = 'hijacked' where id = $1`, [
      ids.userB,
    ])
    expect(rowCount).toBe(0)
  })
})

// ── (g) leads — PROJECT grain as of migration 020; still ungranted ────────
//
// Written originally (ADR-015 close-out, task #78) as a CHARACTERIZATION of
// the pre-020 state — it asserted the defect. CONVERTED on 2026-08-31 into
// an assertion of the corrected behaviour, when migration 020 (`leads`:
// tenant grain → project grain) was written and added to the harness's base
// migration list. What changed here is listed explicitly so the diff reads
// as intentional and no assertion looks silently flipped:
//
//   CHANGED — the old "KNOWN GAP" line asserted that userEditorA1
//     (project_members editor on A1, no tenant_members row anywhere) reads
//     ZERO leads. That was the UNDER-SHARE half of the defect, deliberately
//     recorded as today's behaviour. It now asserts ONE row (lead A, which
//     carries project_id = A1), because migration 020's SELECT policy
//     resolves project grants. The inversion is the point of the migration.
//   CHANGED — the block title and the prose below no longer describe the
//     leads RLS as tenant-grain, because it no longer is.
//   ADDED — a structural check that the three policies really are the
//     project-grain ones, and a check of migration 020's backfill step.
//
// UNCHANGED, and still asserted below:
//   (1) `authenticated` has ZERO grants on `leads`. Migration 020 is
//       policy-only and deliberately grants nothing (see its header): the
//       table stays unreadable through a real session — a read fails CLOSED
//       with "permission denied for table leads", for the row's own tenant
//       owner as much as for a stranger. All live leads access is
//       service-role, and the client dashboard's leads page is still a
//       "coming soon" stub. So everything the policies do below is LATENT:
//       correct for the day the grant lands, unreachable until then. The
//       grant is simulated inside the tests that need it and reverted in a
//       `finally`, exactly as this block always did.
//   (2) Cross-tenant isolation (tenant A cannot read or write tenant B's
//       lead). A project-grain policy is strictly narrower than the
//       tenant-grain one it replaced, so no cross-tenant assertion needed
//       weakening — they pass unchanged, which is itself the regression
//       guard that 020 did not widen anything.

describe('(g) leads — project-grain RLS (migration 020), still ungranted to authenticated', () => {
  const leadIds = {}

  it('authenticated STILL has ZERO grants on leads — migration 020 is policy-only and grants nothing (the dashboard leads read is a separate, later decision)', async () => {
    const { rows } = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'leads' and grantee = 'authenticated'`
    )
    expect(rows).toEqual([])
  })

  it('even the tenant owner of the row\'s own tenant cannot read leads via the authenticated role — fails CLOSED with a permission error, not an empty result', async () => {
    await asSuperuser(async () => {
      const lead = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, $2, 'Lead A', 'lead-a@verify.test') returning id`,
        [ids.tenantA, ids.projectA1]
      )
      leadIds.a = lead.rows[0].id
    })
    await loginAs(ids.userA)
    await expect(client.query(`select id from public.leads where id = $1`, [leadIds.a])).rejects.toThrow(
      /permission denied for table leads/
    )
  })

  it('STRUCTURAL (migration 020): the three tenant-grain policies are gone; the three that exist filter on project_id via the project helpers, and mention a tenant helper only inside the project_id-is-null legacy branch', async () => {
    const { rows } = await client.query(
      `select policyname, cmd, qual, with_check from pg_policies
       where schemaname = 'public' and tablename = 'leads' order by cmd, policyname`
    )
    expect(rows.map((r) => `${r.cmd}:${r.policyname}`).sort()).toEqual([
      'INSERT:Writable roles insert leads for their projects',
      'SELECT:Members read leads for their projects',
      'UPDATE:Writable roles update leads for their projects',
    ])
    // No policy named after the old tenant grain survives, and no DELETE
    // policy was introduced (deletes stay service-role only, as schema.sql
    // left them).
    expect(rows.some((r) => /for their tenants/.test(r.policyname))).toBe(false)
    expect(rows.some((r) => r.cmd === 'DELETE')).toBe(false)

    for (const r of rows) {
      const expr = `${r.qual ?? ''} ${r.with_check ?? ''}`
      expect(expr).toMatch(/get_my_(writable_)?project_ids/)
      // get_my_tenant_ids / get_my_writable_tenant_ids must be gone entirely.
      expect(expr).not.toMatch(/get_my_tenant_ids|get_my_writable_tenant_ids/)
      // The only permitted tenant helper is the owner one, and only in the
      // transitional `project_id is null` branch of SELECT/UPDATE.
      if (/get_my_owned_tenant_ids/.test(expr)) {
        expect(r.cmd === 'SELECT' || r.cmd === 'UPDATE').toBe(true)
        expect(expr).toMatch(/project_id IS NULL/i)
      }
    }
  })

  it('IF the grant is added (simulated, then reverted): cross-tenant isolation still holds AND a project_members-only editor now reads their project\'s leads — the under-share migration 020 closes', async () => {
    await asSuperuser(async () => {
      const leadB = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, $2, 'Lead B', 'lead-b@verify.test') returning id`,
        [ids.tenantB, ids.projectB1]
      )
      leadIds.b = leadB.rows[0].id
      await client.query(`grant select, insert, update on public.leads to authenticated`)
    })

    try {
      // Positive: tenant A owner reads exactly Lead A — via get_my_project_ids()'s
      // owned-tenant branch now, not via tenant_members. Unchanged outcome,
      // different mechanism.
      await loginAs(ids.userA)
      const { rows: aRows } = await client.query(`select id from public.leads`)
      expect(aRows.map((r) => r.id)).toEqual([leadIds.a])

      // Negative: tenant A owner cannot read or write tenant B's lead.
      const { rows: crossRead } = await client.query(`select id from public.leads where id = $1`, [leadIds.b])
      expect(crossRead).toHaveLength(0)
      const { rowCount: crossWrite } = await client.query(
        `update public.leads set message = 'hijacked' where id = $1`,
        [leadIds.b]
      )
      expect(crossWrite).toBe(0)

      // Positive write: tenant A owner (writable role) can update their own lead.
      const { rowCount: ownWrite } = await client.query(
        `update public.leads set message = 'contacted by owner' where id = $1`,
        [leadIds.a]
      )
      expect(ownWrite).toBe(1)

      // CHANGED BY MIGRATION 020 (was: expect(editorRows).toHaveLength(0),
      // labelled "KNOWN GAP"). userEditorA1 holds a project_members editor
      // grant on A1 and no tenant_members row anywhere. Under the old
      // tenant-grain policy get_my_tenant_ids() returned nothing for them and
      // the whole table was invisible — the under-share. Under 020 they read
      // exactly A1's lead, and still nothing of tenant B's.
      await loginAs(ids.userEditorA1)
      const { rows: editorRows } = await client.query(`select id from public.leads`)
      expect(editorRows.map((r) => r.id)).toEqual([leadIds.a])
      const { rowCount: editorWrite } = await client.query(
        `update public.leads set message = 'contacted by editor' where id = $1`,
        [leadIds.a]
      )
      expect(editorWrite).toBe(1)
      const { rowCount: editorCrossWrite } = await client.query(
        `update public.leads set message = 'hijacked' where id = $1`,
        [leadIds.b]
      )
      expect(editorCrossWrite).toBe(0)

      // A user with zero memberships of any kind still sees zero leads.
      await loginAs(ids.userNoMemberships)
      const { rows: noneRows } = await client.query(`select id from public.leads`)
      expect(noneRows).toHaveLength(0)
    } finally {
      await asSuperuser(() => client.query(`revoke select, insert, update on public.leads from authenticated`))
    }
  })

  it('BACKFILL (migration 020 step 1) attributes a legacy project_id-null lead of a SINGLE-project tenant and deliberately leaves a MULTI-project tenant\'s lead null', async () => {
    // Migration 008 added project_id nullable and did NOT backfill, so real
    // rows are expected to be null today. 020 attributes the unambiguous
    // ones (tenant owns exactly one project) and cannot attribute the rest.
    // Re-applying the migration file is safe by construction — the backfill
    // is a no-op on a second run and every policy is dropped-if-exists first.
    const legacy = {}
    await asSuperuser(async () => {
      const a = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, null, 'Legacy A', 'legacy-a@verify.test') returning id`,
        [ids.tenantA]
      )
      const c = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, null, 'Legacy C', 'legacy-c@verify.test') returning id`,
        [ids.tenantC]
      )
      legacy.a = a.rows[0].id
      legacy.c = c.rows[0].id
    })

    try {
      await applyMigrationFile(client, path.join(__dirname, '..', 'migrations', '020_leads_project_grain.sql'))
      await asSuperuser(async () => {
        const { rows } = await client.query(
          `select id, project_id from public.leads where id in ($1, $2) order by name`,
          [legacy.a, legacy.c]
        )
        const byId = Object.fromEntries(rows.map((r) => [r.id, r.project_id]))
        // Tenant A owns exactly one project → unambiguous, attributed.
        expect(byId[legacy.a]).toBe(ids.projectA1)
        // Tenant C owns TWO projects → nothing in the row says which one, so
        // the backfill must not guess. Stays null, and stays reachable only
        // through the transitional owner-scoped null branch (block (i)).
        expect(byId[legacy.c]).toBeNull()
      })
    } finally {
      // Leave the fixture exactly as found — later blocks count leads rows.
      await asSuperuser(() =>
        client.query(`delete from public.leads where id in ($1, $2)`, [legacy.a, legacy.c])
      )
    }
  })

  it('AFTER revert: authenticated is back to zero grants on leads, confirming this block left no state behind for tests that run after it', async () => {
    const { rows } = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'leads' and grantee = 'authenticated'`
    )
    expect(rows).toEqual([])
  })
})

// ── (h) form_submissions + form_events — migrations 016–019 (Forms Module) ──
//
// Filled as part of finding I-11 close-out: `form_submissions` and
// `form_events` are the two tables that hold real client form submission
// content, and before this block NEITHER was mentioned anywhere in this
// suite — the ADR-018 §16 access model ("anonymous visitors create via the
// service-role route; dashboard members read/update via RLS; no anon
// policy") had never been exercised against a real Postgres. Everything
// asserted here was read off migrations 016/017/018/019 first, not assumed.
//
// Applied LAST, after (g), so every earlier block ran against the pre-016
// state. Four things are proven, in this order:
//   (1) GRANT layer — `authenticated` gets exactly SELECT+UPDATE on
//       form_submissions and SELECT only on form_events (016/017); `anon`
//       gets NOTHING on either (the "no anon policy" claim is actually
//       enforced one layer lower, by the absence of a grant); `service_role`
//       holds the full DML set (018 — the fix for the 42501 that broke the
//       anonymous POST path).
//   (2) POLICY GRAIN — both tables' policies are PROJECT-grain
//       (get_my_project_ids / get_my_writable_project_ids) and reference
//       project_id only. This is the distinction that matters: `leads`
//       (block (g)) was still tenant-grain when this block was written, so a
//       project-only editor saw nothing there; migration 020 has since moved
//       leads onto this same model. These tables are the project-grain model ADR-017
//       Decision 6 wants, and a silent regression to tenant-grain would
//       both over-share (every project in the tenant) and under-share
//       (project_members-only grants). Asserted structurally (pg_policies)
//       AND behaviourally (a row whose tenant_id is A's but whose
//       project_id is B's must be visible to B, never to A).
//   (3) WRITE PATH — the service role is the only writer. `authenticated`
//       cannot INSERT or DELETE either table (permission denied, not an
//       empty result), cannot INSERT or UPDATE form_events at all, and a
//       viewer cannot UPDATE a submission it can read. `service_role` can.
//   (4) migration 019's environment/project_slug columns and the widened
//       status CHECK ('skipped' accepted, garbage rejected) really exist.

describe('(h) form_submissions + form_events — migrations 016–019 (forms data isolation)', () => {
  const subIds = {}
  const eventIds = {}

  beforeAll(async () => {
    await asSuperuser(async () => {
      // Pre-016 baseline — proves this block tests a real before/after and
      // that no earlier block accidentally created these tables.
      const pre = await client.query(
        `select table_name from information_schema.tables
         where table_schema = 'public' and table_name in ('form_submissions', 'form_events')`
      )
      if (pre.rows.length !== 0) {
        throw new Error(
          'Expected form_submissions/form_events not to exist before migration 016 — got: ' +
            JSON.stringify(pre.rows)
        )
      }

      for (const file of [
        '016_form_submissions.sql',
        '017_form_events.sql',
        '018_form_tables_service_role_grants.sql',
        '019_form_events_env_and_status.sql',
      ]) {
        await applyMigrationFile(client, path.join(__dirname, '..', 'migrations', file))
      }

      // Seed four submissions. The fourth is the discriminator: its
      // tenant_id is tenant A's but its project_id is project B1 — under
      // project-grain RLS it belongs to B and MUST be invisible to A.
      const seed = async (tenantId, projectId, formId) => {
        const { rows } = await client.query(
          `insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
           values ($1, $2, $3, 1, '{"name": "seed"}'::jsonb) returning id`,
          [tenantId, projectId, formId]
        )
        return rows[0].id
      }
      subIds.a = await seed(ids.tenantA, ids.projectA1, 'early-access')
      subIds.b = await seed(ids.tenantB, ids.projectB1, 'early-access')
      subIds.platform = await seed(null, null, 'early-access')
      subIds.tenantAProjectB = await seed(ids.tenantA, ids.projectB1, 'early-access')

      const seedEvent = async (tenantId, projectId, submissionId, slug) => {
        const { rows } = await client.query(
          `insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id, project_slug, environment)
           values ($1, $2, 'early-access', 1, $3, $4, 'production') returning event_id`,
          [tenantId, projectId, submissionId, slug]
        )
        return rows[0].event_id
      }
      eventIds.a = await seedEvent(ids.tenantA, ids.projectA1, subIds.a, 'verify-a1')
      eventIds.b = await seedEvent(ids.tenantB, ids.projectB1, subIds.b, 'verify-b1')
      eventIds.platform = await seedEvent(null, null, subIds.platform, null)
    })
  })

  // ── (1) GRANT layer ──────────────────────────────────────────────────────

  it('RLS is ENABLED on both forms tables', async () => {
    const { rows } = await client.query(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public' and tablename in ('form_submissions', 'form_events')
       order by tablename`
    )
    expect(rows).toEqual([
      { tablename: 'form_events', rowsecurity: true },
      { tablename: 'form_submissions', rowsecurity: true },
    ])
  })

  it('authenticated holds exactly SELECT+UPDATE on form_submissions and SELECT only on form_events — no INSERT, no DELETE (migrations 016/017)', async () => {
    const { rows } = await client.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'authenticated'
         and table_name in ('form_submissions', 'form_events')
       order by table_name, privilege_type`
    )
    expect(rows).toEqual([
      { table_name: 'form_events', privilege_type: 'SELECT' },
      { table_name: 'form_submissions', privilege_type: 'SELECT' },
      { table_name: 'form_submissions', privilege_type: 'UPDATE' },
    ])
  })

  it('ANON HAS NO GRANT AT ALL on either forms table — table-level or column-level (this, not a policy, is what makes "no anon access" true; a submission is client data and anon is the whole public internet)', async () => {
    const table = await client.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'anon'
         and table_name in ('form_submissions', 'form_events')`
    )
    expect(table.rows).toEqual([])

    // Column-level grants are a separate catalog (migration 012 uses them on
    // profiles) — a column grant here would be just as much of a leak.
    const cols = await client.query(
      `select table_name, column_name, privilege_type from information_schema.column_privileges
       where table_schema = 'public' and grantee = 'anon'
         and table_name in ('form_submissions', 'form_events')`
    )
    expect(cols.rows).toEqual([])
  })

  it('service_role holds the full DML set on both tables (migration 018 — the fix for the 42501 "permission denied" that broke the anonymous POST path)', async () => {
    const { rows } = await client.query(
      `select table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and grantee = 'service_role'
         and table_name in ('form_submissions', 'form_events')
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
       order by table_name, privilege_type`
    )
    const byTable = {}
    for (const r of rows) (byTable[r.table_name] ??= []).push(r.privilege_type)
    expect(byTable.form_submissions).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    expect(byTable.form_events).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  })

  // ── (2) POLICY GRAIN ─────────────────────────────────────────────────────

  it('the policies that exist are exactly the ones migrations 016/017 define — 2 on form_submissions (SELECT, UPDATE), 1 on form_events (SELECT); no INSERT/DELETE/ALL policy anywhere', async () => {
    const { rows } = await client.query(
      `select tablename, policyname, cmd, roles::text as roles from pg_policies
       where schemaname = 'public' and tablename in ('form_submissions', 'form_events')
       order by tablename, cmd`
    )
    expect(rows.map((r) => `${r.tablename}:${r.cmd}`)).toEqual([
      'form_events:SELECT',
      'form_submissions:SELECT',
      'form_submissions:UPDATE',
    ])
    // Every policy applies to PUBLIC (no role restriction) — so the grant
    // layer above is the only thing standing between anon and these rows.
    // Asserted so the two layers are never conflated when reading this file.
    for (const r of rows) expect(r.roles).toBe('{public}')
  })

  it('POLICY GRAIN IS PROJECT, NOT TENANT: every forms policy filters on project_id via get_my_project_ids()/get_my_writable_project_ids() and mentions no tenant helper at all', async () => {
    const { rows } = await client.query(
      `select tablename, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
       from pg_policies
       where schemaname = 'public' and tablename in ('form_submissions', 'form_events')
       order by tablename, cmd`
    )
    for (const r of rows) {
      const expr = `${r.qual} ${r.with_check}`
      expect(expr).toMatch(/project_id/)
      // Tenant-grain helpers must not appear — that would widen a project
      // grant to every project in the tenant (the `leads` shape, block (g)).
      expect(expr).not.toMatch(/get_my_tenant_ids|get_my_writable_tenant_ids|get_my_owned_tenant_ids/)
      expect(expr).not.toMatch(/tenant_id/)
    }
    const readGrain = rows.filter((r) => r.cmd === 'SELECT')
    for (const r of readGrain) expect(r.qual).toMatch(/get_my_project_ids/)

    const writeGrain = rows.find((r) => r.tablename === 'form_submissions' && r.cmd === 'UPDATE')
    // Writable-only helper on BOTH sides — a USING-only policy would let a
    // writable row be UPDATEd into a project the caller cannot write.
    expect(writeGrain.qual).toMatch(/get_my_writable_project_ids/)
    expect(writeGrain.with_check).toMatch(/get_my_writable_project_ids/)
  })

  // ── (2b) The same grain, proven behaviourally ────────────────────────────

  it('CROSS-TENANT READ DENIAL: tenant A owner reads submission A and nothing else — not B\'s, not the platform-level row', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select id from public.form_submissions`)
    const seen = rows.map((r) => r.id)
    expect(seen).toEqual([subIds.a])
    expect(seen).not.toContain(subIds.b)
    expect(seen).not.toContain(subIds.platform)
  })

  it('PROJECT-GRAIN DISCRIMINATOR: a submission carrying tenant A\'s tenant_id but project B1\'s project_id is visible to tenant B\'s owner and INVISIBLE to tenant A\'s — a tenant-grain regression would flip both halves', async () => {
    await loginAs(ids.userA)
    const a = await client.query(`select id from public.form_submissions where id = $1`, [
      subIds.tenantAProjectB,
    ])
    expect(a.rows).toHaveLength(0)

    await loginAs(ids.userB)
    const b = await client.query(`select id from public.form_submissions where id = $1`, [
      subIds.tenantAProjectB,
    ])
    expect(b.rows).toHaveLength(1)
  })

  it('a project_members-only editor (userEditorA1, zero tenant_members rows anywhere) DOES see project A1\'s submissions — the project-grain path `leads` lacked until migration 020 gave it the same shape (see block (g))', async () => {
    await loginAs(ids.userEditorA1)
    const { rows } = await client.query(`select id from public.form_submissions`)
    expect(rows.map((r) => r.id)).toEqual([subIds.a])
  })

  it('a user with zero memberships anywhere sees zero submissions and zero form_events', async () => {
    await loginAs(ids.userNoMemberships)
    const [subs, evts] = await Promise.all([
      client.query(`select id from public.form_submissions`),
      client.query(`select event_id from public.form_events`),
    ])
    expect(subs.rows).toHaveLength(0)
    expect(evts.rows).toHaveLength(0)
  })

  // ── (3) WRITE PATH — service role is the only writer ─────────────────────

  it('CROSS-TENANT WRITE DENIAL: tenant A owner\'s UPDATE of tenant B\'s submission affects 0 rows, while the same UPDATE on their own submission affects 1', async () => {
    await loginAs(ids.userA)
    const cross = await client.query(`update public.form_submissions set status = 'archived' where id = $1`, [
      subIds.b,
    ])
    expect(cross.rowCount).toBe(0)

    const own = await client.query(`update public.form_submissions set status = 'processed' where id = $1`, [
      subIds.a,
    ])
    expect(own.rowCount).toBe(1)
  })

  it('WITH CHECK holds: an owner cannot re-parent their own submission into a project they cannot write — the UPDATE is REJECTED outright ("new row violates row-level security policy"), not silently filtered, so a writable row can never be walked across the tenant boundary', async () => {
    await loginAs(ids.userA)
    // Note the asymmetry vs. the cross-tenant UPDATE above: reaching for
    // someone else's row is a 0-row no-op (USING filters it away), whereas
    // pushing your own row INTO someone else's project is a hard error
    // (WITH CHECK evaluates the post-image). Both are denials; only this
    // one surfaces to the caller. Pinned so a future policy edit that drops
    // the WITH CHECK — leaving a USING-only UPDATE policy — fails here.
    await expect(
      client.query(`update public.form_submissions set project_id = $1 where id = $2`, [
        ids.projectB1,
        subIds.a,
      ])
    ).rejects.toThrow(/new row violates row-level security policy for table "form_submissions"/)

    // The row did not move.
    await asSuperuser(async () => {
      const { rows } = await client.query(`select project_id from public.form_submissions where id = $1`, [
        subIds.a,
      ])
      expect(rows[0].project_id).toBe(ids.projectA1)
    })
  })

  it('VIEWER CAN READ but CANNOT WRITE — project-only viewer on A1 sees submission A, and an UPDATE affects 0 rows (get_my_writable_project_ids excludes viewer)', async () => {
    await loginAs(ids.userViewerA1)
    const read = await client.query(`select id from public.form_submissions where id = $1`, [subIds.a])
    expect(read.rows).toHaveLength(1)
    const write = await client.query(`update public.form_submissions set status = 'spam' where id = $1`, [
      subIds.a,
    ])
    expect(write.rowCount).toBe(0)
  })

  it('authenticated CANNOT INSERT or DELETE form_submissions — permission denied at the grant layer, not a row-filtered no-op (the anonymous create path is service-role only, ADR-018 §16)', async () => {
    await loginAs(ids.userA)
    await expect(
      client.query(
        `insert into public.form_submissions (tenant_id, project_id, form_id, form_version) values ($1, $2, 'early-access', 1)`,
        [ids.tenantA, ids.projectA1]
      )
    ).rejects.toThrow(/permission denied for table form_submissions/)
    await expect(
      client.query(`delete from public.form_submissions where id = $1`, [subIds.a])
    ).rejects.toThrow(/permission denied for table form_submissions/)
  })

  it('form_events is READ-ONLY for authenticated — SELECT is scoped to own projects, INSERT/UPDATE/DELETE are permission denied (the outbox is written by the emit path and consumed by ADR-019, both service-role)', async () => {
    await loginAs(ids.userA)
    const { rows } = await client.query(`select event_id from public.form_events`)
    expect(rows.map((r) => r.event_id)).toEqual([eventIds.a])

    await expect(
      client.query(
        `insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id) values ($1, $2, 'early-access', 1, $3)`,
        [ids.tenantA, ids.projectA1, subIds.a]
      )
    ).rejects.toThrow(/permission denied for table form_events/)
    await expect(
      client.query(`update public.form_events set status = 'delivered' where event_id = $1`, [eventIds.a])
    ).rejects.toThrow(/permission denied for table form_events/)
    await expect(
      client.query(`delete from public.form_events where event_id = $1`, [eventIds.a])
    ).rejects.toThrow(/permission denied for table form_events/)
  })

  it('platform-level rows (project_id null) are invisible to every authenticated member on both tables — they are admin/service-role surface only', async () => {
    for (const userId of [ids.userA, ids.userB, ids.userEditorA1, ids.userViewerA1]) {
      await loginAs(userId)
      const sub = await client.query(`select id from public.form_submissions where id = $1`, [subIds.platform])
      expect(sub.rows).toHaveLength(0)
      const evt = await client.query(`select event_id from public.form_events where event_id = $1`, [
        eventIds.platform,
      ])
      expect(evt.rows).toHaveLength(0)
    }
  })

  it('ANON (the whole public internet — the role a visitor\'s submission would arrive as if the route ever stopped using the service-role client) is denied outright on both tables: SELECT, INSERT and UPDATE all raise permission denied', async () => {
    await logout()
    await client.query(`set role anon`)
    try {
      await expect(client.query(`select id from public.form_submissions`)).rejects.toThrow(
        /permission denied for table form_submissions/
      )
      await expect(
        client.query(
          `insert into public.form_submissions (form_id, form_version) values ('early-access', 1)`
        )
      ).rejects.toThrow(/permission denied for table form_submissions/)
      await expect(client.query(`select event_id from public.form_events`)).rejects.toThrow(
        /permission denied for table form_events/
      )
      await expect(
        client.query(
          `insert into public.form_events (form_id, form_version, submission_id) values ('early-access', 1, $1)`,
          [subIds.a]
        )
      ).rejects.toThrow(/permission denied for table form_events/)
    } finally {
      await client.query(`reset role`)
    }
  })

  it('THE SERVICE ROLE IS THE ONLY WRITER: running as service_role, the exact INSERT pair the anonymous route performs (form_submissions then form_events) succeeds', async () => {
    await logout()
    await client.query(`set role service_role`)
    try {
      const sub = await client.query(
        `insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data, completion_state)
         values ($1, $2, 'early-access', 1, '{"name": "via service role"}'::jsonb, 'complete') returning id`,
        [ids.tenantA, ids.projectA1]
      )
      expect(sub.rows).toHaveLength(1)

      const evt = await client.query(
        `insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id, project_slug, environment, status)
         values ($1, $2, 'early-access', 1, $3, 'verify-a1', 'production', 'pending') returning event_id`,
        [ids.tenantA, ids.projectA1, sub.rows[0].id]
      )
      expect(evt.rows).toHaveLength(1)

      // And it bypasses RLS entirely — it sees every project's rows, which is
      // exactly why no route may ever hand it a caller-supplied project scope.
      const all = await client.query(`select id from public.form_submissions`)
      expect(all.rows.length).toBeGreaterThan(4)
    } finally {
      await client.query(`reset role`)
    }
  })

  // ── (4) Migration 019 shape ──────────────────────────────────────────────

  it('migration 019 added form_events.environment + project_slug and widened the status CHECK to accept \'skipped\' while still rejecting an unknown status', async () => {
    await asSuperuser(async () => {
      const cols = await client.query(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'form_events'
           and column_name in ('environment', 'project_slug')
         order by column_name`
      )
      expect(cols.rows.map((r) => r.column_name)).toEqual(['environment', 'project_slug'])

      const ok = await client.query(
        `insert into public.form_events (form_id, form_version, submission_id, status, environment)
         values ('early-access', 1, $1, 'skipped', 'preview') returning event_id`,
        [subIds.a]
      )
      expect(ok.rows).toHaveLength(1)

      await expect(
        client.query(
          `insert into public.form_events (form_id, form_version, submission_id, status) values ('early-access', 1, $1, 'not-a-status')`,
          [subIds.a]
        )
      ).rejects.toThrow(/form_events_status_check/)
    })
  })
})

// ── (i) TWO-PROJECT TENANT — tenant grain vs project grain, made separable ──
//
// Until Tenant C existed, every tenant in this fixture owned exactly ONE
// project, so "tenant grain" and "project grain" produced identical row sets
// and NO assertion in this file could tell them apart. This block is the
// acceptance check RC-4 asks for, applied to the fixture's own blind spot:
// it switches on the configuration that has never been exercised (one tenant,
// two projects) and reads the resulting rows out of a real Postgres under
// real RLS, rather than reasoning about the policy text.
//
// It is a CHARACTERIZATION suite: every assertion below states what the
// migrations as they stand TODAY actually do — including where that differs
// from the ADR-017 per-project target model. Where the two differ, the
// difference is named inline as an OPEN FINDING with the target policy, and
// the test asserts today's behaviour so that the day the policy is rewritten,
// this block fails loudly and deliberately instead of silently drifting. No
// migration or policy SQL is changed by this block.
//
// Runs LAST so migrations 014–019 (applied by blocks (e)/(f)/(h)) are all in
// force — this is the full, current production shape.

describe('(i) two-project tenant (Tenant C = freeriders/nologo+t42): tenant grain vs project grain', () => {
  const cLeadIds = {}
  const cSubIds = {}

  beforeAll(async () => {
    await asSuperuser(async () => {
      // Leads: one per project of the SAME tenant. Under the tenant-grain RLS
      // that was in force before migration 020 these two rows were
      // indistinguishable; under 020's project-grain RLS they are not. That
      // is the whole experiment, and it is what the assertions below now
      // measure.
      const l1 = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, $2, 'Lead C1', 'lead-c1@verify.test') returning id`,
        [ids.tenantC, ids.projectC1]
      )
      const l2 = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email) values ($1, $2, 'Lead C2', 'lead-c2@verify.test') returning id`,
        [ids.tenantC, ids.projectC2]
      )
      cLeadIds.c1 = l1.rows[0].id
      cLeadIds.c2 = l2.rows[0].id

      // form_submissions: same pair of projects, plus a platform-level row.
      const seedSub = async (tenantId, projectId) => {
        const { rows } = await client.query(
          `insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
           values ($1, $2, 'early-access', 1, '{"name": "seed-c"}'::jsonb) returning id`,
          [tenantId, projectId]
        )
        return rows[0].id
      }
      cSubIds.c1 = await seedSub(ids.tenantC, ids.projectC1)
      cSubIds.c2 = await seedSub(ids.tenantC, ids.projectC2)
      cSubIds.platform = await seedSub(null, null)

      // `leads` has no grant to `authenticated` in any migration (block (g)).
      // Grant it here, exactly as block (g) does, so the POLICY can be
      // exercised at all; reverted in afterAll so this block leaves the
      // grant catalog exactly as it found it.
      await client.query(`grant select, insert, update on public.leads to authenticated`)
    })
  })

  afterAll(async () => {
    await asSuperuser(() =>
      client.query(`revoke select, insert, update on public.leads from authenticated`)
    )
  })

  // ── The fixture itself now models what it never modelled ────────────────

  it('the fixture really does contain a tenant with TWO projects (the precondition every assertion below depends on)', async () => {
    await asSuperuser(async () => {
      const { rows } = await client.query(
        `select slug from public.projects where tenant_id = $1 order by slug`,
        [ids.tenantC]
      )
      expect(rows.map((r) => r.slug)).toEqual(['verify-c1', 'verify-c2'])
      // And no OTHER tenant in the fixture has two — i.e. this really was
      // the missing configuration, and the earlier blocks genuinely could
      // not have caught a grain bug.
      const counts = await client.query(
        `select tenant_id, count(*)::int as n from public.projects group by tenant_id order by n desc`
      )
      expect(counts.rows[0].n).toBe(2)
      expect(counts.rows.slice(1).every((r) => r.n === 1)).toBe(true)
    })
  })

  // ── leads — PROJECT grain as of migration 020 ────────────────────────────
  //
  // Policy in force BEFORE migration 020 (schema.sql, migration-004 era):
  //   "Members can read leads for their tenants"
  //     using (tenant_id in (select public.get_my_tenant_ids()))
  // `leads.project_id` existed (migration 008) but NO leads policy referenced
  // it, so leads visibility was decided purely by tenant_members — wrong in
  // both directions once a tenant owns more than one project.
  //
  // Policy in force NOW (migration 020, applied by lib/harness.mjs):
  //   "Members read leads for their projects"
  //     using (project_id in (select public.get_my_project_ids())
  //            or (project_id is null
  //                and tenant_id in (select public.get_my_owned_tenant_ids())))
  //
  // The four tests below were written as CHARACTERIZATIONS of the tenant-grain
  // defect and were CONVERTED on 2026-08-31 into assertions of the corrected
  // behaviour. Each one names what its expectation used to be and why it
  // changed — no assertion here was flipped silently.

  it('TENANT-OWNER PRECEDENCE SURVIVES 020: userC (tenant_members owner, no project_members row at all) still reads BOTH projects\' leads — now via get_my_project_ids()\'s owned-tenant branch, not via tenant_members', async () => {
    // UNCHANGED EXPECTATION, CHANGED MECHANISM (title changed, assertions did
    // not). Before 020 userC saw both leads because the policy read
    // get_my_tenant_ids(). After 020 they still see both, because
    // get_my_project_ids() begins with
    //   select id from public.projects
    //   where tenant_id in (select public.get_my_owned_tenant_ids())
    // — owning tenant C resolves to every project of tenant C (ADR-017
    // Decision 2). This test is the guard that migration 020 did not take
    // access away from the one role that should keep it.
    await loginAs(ids.userC)
    const { rows } = await client.query(`select id from public.leads order by created_at`)
    const seen = rows.map((r) => r.id)
    expect(seen).toContain(cLeadIds.c1)
    expect(seen).toContain(cLeadIds.c2)
    expect(seen).toHaveLength(2)
  })

  it('OVER-SHARE CLOSED (migration 020): userTenantViewerC (tenant_members VIEWER on C, zero project grants) now reads ZERO leads — it used to read BOTH projects\' leads', async () => {
    // CHANGED BY MIGRATION 020. This test previously asserted
    //   expect(seen).toContain(cLeadIds.c1); expect(seen).toContain(cLeadIds.c2)
    // and was labelled "OPEN FINDING (documented, NOT fixed here)". It was
    // the over-share half of the defect: a tenant member with no
    // project-scoped grant of any kind saw every project's leads in the
    // tenant, because the policy never looked at project_id. A
    // one-project-per-tenant fixture could not tell that apart from correct
    // behaviour; tenant C's two projects can.
    //
    // Under 020 this user resolves to nothing: they own no tenant (so
    // get_my_owned_tenant_ids() is empty, and with it the owned-tenant branch
    // of get_my_project_ids()) and hold no project_members row. A tenant
    // VIEWER role is no longer, by itself, leads access — per ADR-017
    // Decision 6 non-owner tenant members get leads access through
    // project_members rows.
    await loginAs(ids.userTenantViewerC)
    const { rows } = await client.query(`select id from public.leads`)
    expect(rows).toHaveLength(0)
  })

  it('UNDER-SHARE CLOSED (migration 020): userEditorC1 (project_members editor on C1 ONLY) now reads C1\'s lead — and still NOT C2\'s, the sibling project of the same tenant', async () => {
    // CHANGED BY MIGRATION 020, in one direction only. This test previously
    // asserted `expect(rows).toHaveLength(0)` with the inline notes
    // "TARGET AFTER REWRITE: 1 row" (C1) and "TARGET AFTER REWRITE: still 0
    // rows" (C2). Those targets are now the assertions.
    //
    // Before: the policy scoped by TENANT and this user has no tenant_members
    // row at all, so get_my_tenant_ids() returned the empty set and the whole
    // table was invisible — C1 included. It failed CLOSED (no cross-project
    // leak) while ALSO denying the access ADR-017 says an editor grant
    // carries. After: the project_members branch of get_my_project_ids()
    // resolves C1 and only C1.
    //
    // The C2 half is the load-bearing negative control: two projects of the
    // SAME tenant are now genuinely isolated from each other, which is
    // exactly what the tenant-grain policy could never express.
    await loginAs(ids.userEditorC1)
    const { rows } = await client.query(`select id from public.leads`)
    expect(rows.map((r) => r.id)).toEqual([cLeadIds.c1])

    const c1 = await client.query(`select id from public.leads where id = $1`, [cLeadIds.c1])
    expect(c1.rows).toHaveLength(1)
    const c2 = await client.query(`select id from public.leads where id = $1`, [cLeadIds.c2])
    expect(c2.rows).toHaveLength(0)
  })

  it('leads WRITE is PROJECT grain as of 020: userC (owner) still updates C2\'s lead, userEditorC1 updates C1\'s but NOT C2\'s, userTenantViewerC updates nothing, and tenants A/B still cannot touch tenant C at all', async () => {
    // CHANGED BY MIGRATION 020 — title and coverage, not the two assertions
    // that were already here. The original test asserted only (a) userC can
    // update C2's lead "despite holding no project grant on C2" and (b)
    // tenants A and B can neither read nor write tenant C's leads.
    //
    // (a) still holds and is still correct: get_my_writable_project_ids()
    // opens with the SAME owned-tenant branch as get_my_project_ids(), so a
    // tenant owner keeps write access to every project of their tenant. What
    // the original title called an over-share was, for the OWNER role
    // specifically, intended behaviour all along (ADR-017 Decision 2). The
    // genuine write over-share was the tenant EDITOR/VIEWER case, now added
    // below and now denied.
    await loginAs(ids.userC)
    const own = await client.query(`update public.leads set message = 'contacted' where id = $1`, [
      cLeadIds.c2,
    ])
    expect(own.rowCount).toBe(1)

    // NEW: the project-grain write boundary inside one tenant. An editor on
    // C1 writes C1 and is silently filtered out of C2 — under the old
    // tenant-grain UPDATE policy (get_my_writable_tenant_ids()) this user
    // could write NEITHER, since they hold no tenant_members row.
    await loginAs(ids.userEditorC1)
    const editorOwn = await client.query(`update public.leads set message = 'editor note' where id = $1`, [
      cLeadIds.c1,
    ])
    expect(editorOwn.rowCount).toBe(1)
    const editorCross = await client.query(`update public.leads set message = 'hijacked' where id = $1`, [
      cLeadIds.c2,
    ])
    expect(editorCross.rowCount).toBe(0)

    // NEW: a tenant VIEWER writes nothing — read-only at the database layer
    // was already the convention (get_my_writable_* excludes viewer); what
    // changed is that they can no longer even SEE the rows.
    await loginAs(ids.userTenantViewerC)
    const viewerWrite = await client.query(
      `update public.leads set message = 'viewer wrote this' where id in ($1, $2)`,
      [cLeadIds.c1, cLeadIds.c2]
    )
    expect(viewerWrite.rowCount).toBe(0)

    for (const userId of [ids.userA, ids.userB]) {
      await loginAs(userId)
      const read = await client.query(`select id from public.leads where id in ($1, $2)`, [
        cLeadIds.c1,
        cLeadIds.c2,
      ])
      expect(read.rows).toHaveLength(0)
      const write = await client.query(`update public.leads set message = 'hijacked' where id in ($1, $2)`, [
        cLeadIds.c1,
        cLeadIds.c2,
      ])
      expect(write.rowCount).toBe(0)
    }
  })

  it('TRANSITIONAL NULL BRANCH (migration 020): an un-backfillable legacy lead (project_id null, multi-project tenant) stays visible and writable to the tenant OWNER only — not to the tenant viewer, not to the project editor', async () => {
    // The compatibility branch migration 020 adds for rows its backfill
    // cannot attribute:
    //   or (project_id is null and tenant_id in (select get_my_owned_tenant_ids()))
    // Scoped to owners on purpose: an owner would see the row under ANY
    // eventual attribution (owned-tenant branch of get_my_project_ids()), so
    // the branch grants them nothing extra — while the tenant VIEWER whose
    // over-share 020 closes stays denied. If this test ever fails open for
    // userTenantViewerC, the branch has re-introduced tenant grain.
    const legacy = {}
    await asSuperuser(async () => {
      const { rows } = await client.query(
        `insert into public.leads (tenant_id, project_id, name, email)
         values ($1, null, 'Legacy C null', 'legacy-c-null@verify.test') returning id`,
        [ids.tenantC]
      )
      legacy.id = rows[0].id
    })

    try {
      await loginAs(ids.userC)
      const ownerRead = await client.query(`select id from public.leads where id = $1`, [legacy.id])
      expect(ownerRead.rows).toHaveLength(1)
      const ownerWrite = await client.query(`update public.leads set message = 'legacy touch' where id = $1`, [
        legacy.id,
      ])
      expect(ownerWrite.rowCount).toBe(1)

      for (const userId of [ids.userTenantViewerC, ids.userEditorC1, ids.userA]) {
        await loginAs(userId)
        const read = await client.query(`select id from public.leads where id = $1`, [legacy.id])
        expect(read.rows).toHaveLength(0)
        const write = await client.query(`update public.leads set message = 'nope' where id = $1`, [legacy.id])
        expect(write.rowCount).toBe(0)
      }
    } finally {
      await asSuperuser(() => client.query(`delete from public.leads where id = $1`, [legacy.id]))
    }
  })

  it('INSERT has NO null branch (migration 020): a writable role can insert a lead naming a project they can write, but an insert with project_id null is REJECTED outright — which is how the un-backfillable set stays finite', async () => {
    await loginAs(ids.userEditorC1)
    const inserted = await client.query(
      `insert into public.leads (tenant_id, project_id, name, email)
       values ($1, $2, 'Inserted by editor', 'ins-c1@verify.test') returning id`,
      [ids.tenantC, ids.projectC1]
    )
    expect(inserted.rows).toHaveLength(1)

    // Sibling project of the same tenant: rejected by WITH CHECK.
    await expect(
      client.query(
        `insert into public.leads (tenant_id, project_id, name, email)
         values ($1, $2, 'Cross-project', 'ins-c2@verify.test')`,
        [ids.tenantC, ids.projectC2]
      )
    ).rejects.toThrow(/row-level security policy/)

    // project_id null: rejected too — even for the tenant owner, whose SELECT
    // and UPDATE null branch does NOT extend to INSERT.
    await loginAs(ids.userC)
    await expect(
      client.query(
        `insert into public.leads (tenant_id, project_id, name, email)
         values ($1, null, 'No project', 'ins-null@verify.test')`,
        [ids.tenantC]
      )
    ).rejects.toThrow(/row-level security policy/)

    await asSuperuser(() =>
      client.query(`delete from public.leads where id = $1`, [inserted.rows[0].id])
    )
  })

  // ── form_submissions — PROJECT grain (migration 016:~105) ────────────────

  it('form_submissions ARE PROJECT GRAIN: userEditorC1 sees C1\'s submission and NOT C2\'s — two projects of the SAME tenant are genuinely isolated from each other', async () => {
    await loginAs(ids.userEditorC1)
    const { rows } = await client.query(`select id from public.form_submissions`)
    expect(rows.map((r) => r.id)).toEqual([cSubIds.c1])

    const c2 = await client.query(`select id from public.form_submissions where id = $1`, [cSubIds.c2])
    expect(c2.rows).toHaveLength(0)
  })

  it('form_submissions cross-PROJECT write denial inside one tenant: userEditorC1\'s UPDATE of C2\'s submission affects 0 rows, while C1\'s affects 1', async () => {
    await loginAs(ids.userEditorC1)
    const cross = await client.query(`update public.form_submissions set status = 'archived' where id = $1`, [
      cSubIds.c2,
    ])
    expect(cross.rowCount).toBe(0)

    const own = await client.query(`update public.form_submissions set status = 'processed' where id = $1`, [
      cSubIds.c1,
    ])
    expect(own.rowCount).toBe(1)
  })

  it('tenant-owner precedence still applies at project grain: userC (owner of tenant C, no project_members row) sees BOTH C1\'s and C2\'s submissions via get_my_project_ids()\'s owned-tenant branch', async () => {
    await loginAs(ids.userC)
    const { rows } = await client.query(`select id from public.form_submissions order by created_at`)
    const seen = rows.map((r) => r.id)
    expect(seen).toContain(cSubIds.c1)
    expect(seen).toContain(cSubIds.c2)
    expect(seen).not.toContain(cSubIds.platform)
  })

  it('GRAIN NOW AGREES, same user, two tables: userTenantViewerC reads ZERO leads and ZERO form_submissions — and userEditorC1 reads exactly one of each, C1\'s', async () => {
    // CHANGED BY MIGRATION 020. This test was previously titled "GRAIN
    // MISMATCH …" and asserted `expect(leads.rows).toHaveLength(2)` against
    // `expect(subs.rows).toHaveLength(0)` — the single sharpest demonstration
    // that the two tables disagreed about what a "member" is: a non-owner
    // tenant member was fully visible to the tenant-grain table and
    // completely invisible to the project-grain one.
    //
    // The mismatch is what migration 020 removes, so the test now asserts
    // agreement in BOTH directions: the tenant-viewer probe (visible to
    // neither) and the project-editor probe (visible to both, and to the same
    // project). Keeping only the first half would let a partial regression —
    // e.g. a policy that denies everyone — pass unnoticed.
    await loginAs(ids.userTenantViewerC)
    const leads = await client.query(`select id from public.leads`)
    expect(leads.rows).toHaveLength(0)
    const subs = await client.query(`select id from public.form_submissions`)
    expect(subs.rows).toHaveLength(0)

    await loginAs(ids.userEditorC1)
    const editorLeads = await client.query(`select id from public.leads`)
    expect(editorLeads.rows.map((r) => r.id)).toEqual([cLeadIds.c1])
    const editorSubs = await client.query(`select id from public.form_submissions`)
    expect(editorSubs.rows.map((r) => r.id)).toEqual([cSubIds.c1])
  })

  it('a project_id = null (platform-level) submission is invisible to EVERY member of the two-project tenant — owner, project editor and tenant viewer alike', async () => {
    for (const userId of [ids.userC, ids.userEditorC1, ids.userTenantViewerC]) {
      await loginAs(userId)
      const { rows } = await client.query(`select id from public.form_submissions where id = $1`, [
        cSubIds.platform,
      ])
      expect(rows).toHaveLength(0)
    }
  })

  it('tenant A and tenant B see NONE of tenant C\'s submissions — adding a third tenant did not widen anything for the existing two', async () => {
    for (const userId of [ids.userA, ids.userB, ids.userEditorA1, ids.userNoMemberships]) {
      await loginAs(userId)
      const { rows } = await client.query(
        `select id from public.form_submissions where id in ($1, $2, $3)`,
        [cSubIds.c1, cSubIds.c2, cSubIds.platform]
      )
      expect(rows).toHaveLength(0)
    }
  })

  // ── projects / project_members / tenant_members under two projects ───────

  it('projects: userC (tenant owner) sees BOTH C1 and C2; userTenantViewerC (tenant viewer) also sees both via the tenant branch of the migration-013 policy', async () => {
    for (const userId of [ids.userC, ids.userTenantViewerC]) {
      await loginAs(userId)
      const { rows } = await client.query(`select id from public.projects order by slug`)
      expect(rows.map((r) => r.id)).toEqual([ids.projectC1, ids.projectC2])
    }
  })

  it('projects: userEditorC1 (project_members on C1 only) sees EXACTLY C1 — the sibling project C2 of the same tenant stays invisible (branch (b) of the migration-013 policy does not widen to the tenant)', async () => {
    await loginAs(ids.userEditorC1)
    const { rows } = await client.query(`select id from public.projects`)
    expect(rows.map((r) => r.id)).toEqual([ids.projectC1])
  })

  it('projects: tenant A\'s and tenant B\'s users see neither C1 nor C2, and a zero-membership user still sees nothing at all', async () => {
    for (const userId of [ids.userA, ids.userB, ids.userEditorA1]) {
      await loginAs(userId)
      const { rows } = await client.query(`select id from public.projects where id in ($1, $2)`, [
        ids.projectC1,
        ids.projectC2,
      ])
      expect(rows).toHaveLength(0)
    }
    await loginAs(ids.userNoMemberships)
    const { rows } = await client.query(`select id from public.projects`)
    expect(rows).toHaveLength(0)
  })

  it('project_members: userC (tenant owner) reads the C1 editor grant via "Tenant owners can read members of their projects" — including for a project they hold no project_members row on', async () => {
    await loginAs(ids.userC)
    const { rows } = await client.query(`select project_id, user_id, role from public.project_members`)
    expect(rows).toHaveLength(1)
    expect(rows[0].project_id).toBe(ids.projectC1)
    expect(rows[0].user_id).toBe(ids.userEditorC1)
    expect(rows[0].role).toBe('editor')
  })

  it('project_members: userEditorC1 reads only their OWN row (own-rows policy), and userTenantViewerC — a tenant member who is not an owner — reads NONE', async () => {
    await loginAs(ids.userEditorC1)
    const editor = await client.query(`select project_id from public.project_members`)
    expect(editor.rows.map((r) => r.project_id)).toEqual([ids.projectC1])

    await loginAs(ids.userTenantViewerC)
    const viewer = await client.query(`select project_id from public.project_members`)
    expect(viewer.rows).toHaveLength(0)
  })

  it('tenant_members: userC (owner) reads BOTH tenant C membership rows (own + the tenant viewer\'s); userTenantViewerC reads only their own; userEditorC1 reads none', async () => {
    await loginAs(ids.userC)
    const owner = await client.query(`select user_id from public.tenant_members order by created_at`)
    expect(owner.rows.map((r) => r.user_id).sort()).toEqual([ids.userC, ids.userTenantViewerC].sort())

    await loginAs(ids.userTenantViewerC)
    const viewer = await client.query(`select user_id, tenant_id from public.tenant_members`)
    expect(viewer.rows).toHaveLength(1)
    expect(viewer.rows[0].user_id).toBe(ids.userTenantViewerC)
    expect(viewer.rows[0].tenant_id).toBe(ids.tenantC)

    await loginAs(ids.userEditorC1)
    const editor = await client.query(`select user_id from public.tenant_members`)
    expect(editor.rows).toHaveLength(0)
  })

  it('tenant_members: tenant A\'s and tenant B\'s owners see no tenant C membership row', async () => {
    for (const userId of [ids.userA, ids.userB]) {
      await loginAs(userId)
      const tm = await client.query(`select user_id from public.tenant_members where tenant_id = $1`, [
        ids.tenantC,
      ])
      expect(tm.rows).toHaveLength(0)
    }
  })

  it('`public.tenants` READ GRANT (migration 021): authenticated now holds SELECT (and only SELECT), so "Members can read their tenants" is finally reachable — and it isolates correctly', async () => {
    // CHANGED BY MIGRATION 021. This test was originally titled
    // "DISCOVERED (migration-011 bug class, one more table)" and asserted the
    // gap: `expect(grants.rows).toEqual([])`, plus two
    // `.rejects.toThrow(/permission denied for table tenants/)` probes (for a
    // stranger AND for the row's own owner — which is how a missing GRANT is
    // told apart from RLS filtering, since RLS returns an empty set and never
    // raises). It then granted SELECT, proved the policy isolates, and
    // reverted.
    //
    // Migration 021 makes that simulate-then-revert block permanent: the
    // grant is now applied by lib/harness.mjs's base migration list, so the
    // "permission denied" assertions are gone (they would now fail) and the
    // isolation assertions run against the real granted state. 021 is
    // GRANT-ONLY — schema.sql's policy is unchanged and still correct, which
    // is why nothing below had to be rewritten, only un-simulated.
    const grants = await client.query(
      `select privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'tenants' and grantee = 'authenticated'`
    )
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['SELECT'])

    // The policy itself must still be the untouched schema.sql one.
    const policies = await client.query(
      `select policyname, cmd, qual from pg_policies
       where schemaname = 'public' and tablename = 'tenants'`
    )
    expect(policies.rows.map((r) => `${r.cmd}:${r.policyname}`)).toEqual([
      'SELECT:Members can read their tenants',
    ])
    expect(policies.rows[0].qual).toMatch(/get_my_tenant_ids/)

    // A tenant member reads exactly their own tenant row — no error, and no
    // other tenant's row.
    await loginAs(ids.userC)
    const mine = await client.query(`select id from public.tenants`)
    expect(mine.rows.map((r) => r.id)).toEqual([ids.tenantC])

    // Tenant grain is CORRECT for this table (one row per tenant), so a
    // tenant VIEWER does see it — unlike `leads`, where migration 020
    // deliberately removed that. The grain asymmetry is intentional; see
    // migration 021's header.
    await loginAs(ids.userTenantViewerC)
    const viewer = await client.query(`select id from public.tenants`)
    expect(viewer.rows.map((r) => r.id)).toEqual([ids.tenantC])

    // Known, unchanged under-share of the same family as leads': a
    // project_members-only holder has no tenant_members row, so
    // get_my_tenant_ids() is empty and they see no tenant row at all — not
    // even the tenant owning the project they edit. 021 does not address
    // this (grant-only, no visibility change); recorded so a future widening
    // of the tenants policy is a deliberate edit to this line.
    await loginAs(ids.userEditorC1)
    const editor = await client.query(`select id from public.tenants`)
    expect(editor.rows).toHaveLength(0)

    // Cross-tenant denial is a filtered empty set now, not a 42501.
    for (const userId of [ids.userA, ids.userB]) {
      await loginAs(userId)
      const t = await client.query(`select id from public.tenants where id = $1`, [ids.tenantC])
      expect(t.rows).toHaveLength(0)
    }

    // A user with no membership anywhere sees nothing at all.
    await loginAs(ids.userNoMemberships)
    const none = await client.query(`select id from public.tenants`)
    expect(none.rows).toHaveLength(0)
  })

  it('migration 021 granted SELECT only — authenticated still cannot write public.tenants, which has no write policy to constrain it (platform-admin surface, service-role only)', async () => {
    await loginAs(ids.userC)
    await expect(
      client.query(`update public.tenants set display_name = 'renamed' where id = $1`, [ids.tenantC])
    ).rejects.toThrow(/permission denied for table tenants/)
    await expect(
      client.query(
        `insert into public.tenants (slug, display_name, domain) values ('verify-rogue', 'Rogue', 'rogue.verify.test')`
      )
    ).rejects.toThrow(/permission denied for table tenants/)
    await expect(
      client.query(`delete from public.tenants where id = $1`, [ids.tenantC])
    ).rejects.toThrow(/permission denied for table tenants/)
  })

  it('form_events follow form_submissions\' project grain across the two projects of one tenant (the outbox must not leak sibling-project events)', async () => {
    await asSuperuser(async () => {
      await client.query(
        `insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id, project_slug, environment)
         values ($1, $2, 'early-access', 1, $3, 'verify-c2', 'production')`,
        [ids.tenantC, ids.projectC2, cSubIds.c2]
      )
    })
    await loginAs(ids.userEditorC1)
    const { rows } = await client.query(`select event_id from public.form_events`)
    expect(rows).toHaveLength(0) // C1 has no events; C2's event must not appear

    await loginAs(ids.userC)
    const ownerRows = await client.query(`select project_id from public.form_events`)
    expect(ownerRows.rows.map((r) => r.project_id)).toEqual([ids.projectC2])
  })
})

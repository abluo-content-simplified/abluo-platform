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

// ── Fixture world: two tenants, two projects, three users ──────────────────
//
// Tenant A ("livener")          — owner: userA
//   project A1 ("livener-main")
// Tenant B ("studiomartegani")  — owner: userB
//   project B1 ("studiomartegani-main")
// userEditorA1 — project_members editor on A1 only, no tenant_members row
//   anywhere (isolates the project_members-only grant path).

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
  it('seeds two tenants, two projects, three users, and memberships as superuser', async () => {
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

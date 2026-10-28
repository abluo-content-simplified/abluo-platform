/**
 * Migration 056 — transfer ownership of a client (PLAT-2). Proves, against a
 * real Postgres with … 029 … 049 → 056 applied:
 *  - the function is service-role only;
 *  - a person who is not in the client is refused and NOTHING is written;
 *  - an existing Member or a site-only member becomes Owner; their site rows go;
 *  - step-down: the Owner becomes Member and Site admin on EVERY project
 *    (existing site rows raised, extras kept); access history per project;
 *  - the client is never left without an Owner (the step-down user must be an
 *    Owner; the last-Owner trigger still refuses a bare demotion);
 *  - rollback-056 restores the catalog exactly, refuses once a transfer was
 *    recorded, and 056 applies again; 056 refuses to run twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '049_people_last_seen_and_access_log.sql']
const M056 = MIG('056_tenant_ownership_transfer.sql')
const ROLLBACK = path.join(__dirname, 'rollback-056.sql')
const FN = 'public.tenant_transfer_ownership(uuid, uuid, uuid, uuid, boolean)'

let client
let n = 0
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asService() { await client.query(`select public.set_session_auth(null, 'service_role')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function sq(sql, params) { await asService(); try { return await q(sql, params) } finally { await reset() } }
const one = async (sql, p) => (await q(sql, p))[0].id
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const user = (tag) => one(`insert into auth.users (email) values ($1) returning id`, [`${tag}-${++n}@t56.test`])
async function client3() {
  const k = ++n
  const t = await one(`insert into public.tenants (slug, display_name) values ($1,'C') returning id`, [`t56-${k}`])
  const pA = await one(`insert into public.projects (slug, tenant_id, name) values ($1,$2,'A') returning id`, [`t56-${k}-a`, t])
  const pB = await one(`insert into public.projects (slug, tenant_id, name) values ($1,$2,'B') returning id`, [`t56-${k}-b`, t])
  const pC = await one(`insert into public.projects (slug, tenant_id, name) values ($1,$2,'C') returning id`, [`t56-${k}-c`, t])
  const owner = await user('owner')
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [t, owner])
  return { t, pA, pB, pC, owner }
}
const transfer = (t, to, actor, down = null, byAdmin = false) =>
  sq(`select public.tenant_transfer_ownership($1, $2, $3, $4, $5) as r`, [t, to, actor, down, byAdmin]).then((r) => r[0].r)
const tenantRole = async (t, u) => (await q(`select role from public.tenant_members where tenant_id = $1 and user_id = $2`, [t, u]))[0]?.role ?? null
const siteRoles = async (u) => Object.fromEntries((await q(`select project_id, role from public.project_members where user_id = $1`, [u])).map((r) => [r.project_id, r.role]))
const snapshot = async (t) => JSON.stringify([
  await q(`select user_id, role, extra_permissions from public.tenant_members where tenant_id = $1 order by user_id`, [t]),
  await q(`select pm.user_id, pm.project_id, pm.role from public.project_members pm join public.projects p on p.id = pm.project_id where p.tenant_id = $1 order by 1, 2`, [t]),
  await q(`select count(*)::int as n from public.access_audit_log`),
])

async function catalog() {
  const parts = await Promise.all([
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body,
              coalesce(array_to_string(p.proacl, ','), '') as acl
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`),
  ])
  return JSON.stringify(parts)
}

let before
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  before = await catalog()
  await applyMigrationFile(client, M056)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('056 — locked to the service role', () => {
  it('anon and a tenant Owner cannot call it', async () => {
    const c = await client3()
    const m = await user('m')
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [c.t, m])
    for (const as of [() => asAnon(), () => asUser(c.owner)]) {
      await as()
      const e = await errOf(() => q(`select ${FN.replace('(uuid, uuid, uuid, uuid, boolean)', '')}($1, $2, $3, null, false)`, [c.t, m, c.owner]))
      expect(e?.message).toMatch(/permission denied/)
      await reset()
    }
    expect(await tenantRole(c.t, m)).toBe('member')
  })
})

describe('056 — who can become Owner', () => {
  it('a person who is not in the client is refused and nothing is written', async () => {
    const c = await client3()
    const stranger = await user('stranger')
    const other = await client3()
    await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'admin')`, [other.pA, stranger]) // another client's site
    const s = await snapshot(c.t)
    expect((await errOf(() => transfer(c.t, stranger, c.owner, c.owner)))?.message).toMatch(/ownership:not_member/)
    expect(await snapshot(c.t)).toBe(s)
    expect(await tenantRole(c.t, c.owner)).toBe('owner')
  })
  it('an existing Owner is refused (already_owner); a step-down of a non-Owner is refused', async () => {
    const c = await client3()
    const m = await user('m')
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [c.t, m])
    expect((await errOf(() => transfer(c.t, c.owner, c.owner)))?.message).toMatch(/ownership:already_owner/)
    const e = await user('e')
    await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [c.pA, e])
    const s = await snapshot(c.t)
    expect((await errOf(() => transfer(c.t, m, c.owner, e)))?.message).toMatch(/ownership:not_owner/)
    expect((await errOf(() => transfer(c.t, m, c.owner, m)))?.message).toMatch(/ownership:invalid/)
    expect(await snapshot(c.t)).toBe(s)
  })
  it('a client Member becomes Owner; extras cleared; nobody steps down', async () => {
    const c = await client3()
    const m = await user('m')
    await q(`insert into public.tenant_members (tenant_id, user_id, role, extra_permissions) values ($1,$2,'member','{billing.invoice.read}')`, [c.t, m])
    const r = await transfer(c.t, m, c.owner)
    expect(r.newOwner).toBe(m)
    expect(r.steppedDown).toBeNull()
    expect(await tenantRole(c.t, m)).toBe('owner')
    expect(await tenantRole(c.t, c.owner)).toBe('owner')
    expect((await q(`select extra_permissions from public.tenant_members where tenant_id = $1 and user_id = $2`, [c.t, m]))[0].extra_permissions).toEqual([])
  })
  it('a site-only Editor becomes Owner: a tenant row is created and their site rows go', async () => {
    const c = await client3()
    const e = await user('e')
    await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [c.pB, e])
    await transfer(c.t, e, c.owner)
    expect(await tenantRole(c.t, e)).toBe('owner')
    expect(await siteRoles(e)).toEqual({})
  })
})

describe('056 — step down', () => {
  it('the Owner becomes Member and Site admin on every project; existing site rows are raised, extras kept', async () => {
    const c = await client3()
    const m = await user('m')
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [c.t, m])
    await q(`insert into public.project_members (project_id, user_id, role, extra_permissions) values ($1,$2,'editor','{forms.submission.read}')`, [c.pA, c.owner])
    await transfer(c.t, m, c.owner, c.owner)
    expect(await tenantRole(c.t, c.owner)).toBe('member')
    expect(await tenantRole(c.t, m)).toBe('owner')
    expect(await siteRoles(c.owner)).toEqual({ [c.pA]: 'admin', [c.pB]: 'admin', [c.pC]: 'admin' })
    expect((await q(`select extra_permissions from public.project_members where project_id = $1 and user_id = $2`, [c.pA, c.owner]))[0].extra_permissions).toEqual(['forms.submission.read'])
  })
  it('access history: one owner.transfer and one owner.step_down row per project, roles only', async () => {
    const c = await client3()
    const m = await user('m')
    const admin = await user('admin')
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [c.t, m])
    await transfer(c.t, m, admin, c.owner, true)
    const rows = await q(`select actor_id, subject_user_id, project_id, action, detail from public.access_audit_log where detail->>'tenantId' = $1 order by action, project_id`, [c.t])
    expect(rows.filter((r) => r.action === 'owner.transfer').map((r) => r.project_id).sort()).toEqual([c.pA, c.pB, c.pC].sort())
    expect(rows.filter((r) => r.action === 'owner.step_down').map((r) => r.project_id).sort()).toEqual([c.pA, c.pB, c.pC].sort())
    for (const r of rows) {
      expect(r.actor_id).toBe(admin)
      expect(r.detail.byAdmin).toBe(true)
      expect(JSON.stringify(r.detail)).not.toMatch(/@/)
    }
    expect(rows.find((r) => r.action === 'owner.transfer').detail).toMatchObject({ roleBefore: 'member', role: 'owner', steppedDown: true })
  })
  it('the last-Owner guard still refuses a bare demotion of the only Owner', async () => {
    const c = await client3()
    const e = await errOf(() => sq(`update public.tenant_members set role = 'member' where tenant_id = $1 and user_id = $2`, [c.t, c.owner]))
    expect(e?.message).toMatch(/at least one Owner/)
    expect(await tenantRole(c.t, c.owner)).toBe('owner')
  })
})

describe('056 — rollback', () => {
  it('rollback refuses once a transfer was recorded, and 056 refuses to run twice', async () => {
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK)))?.message).toMatch(/rollback-056: ownership was transferred/)
    expect((await errOf(() => applyMigrationFile(client, M056)))?.message).toMatch(/056 already applied/)
  })
  it('without transfers, rollback restores the catalog exactly and 056 applies again', async () => {
    await sq(`delete from public.access_audit_log where action in ('owner.transfer', 'owner.step_down')`)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(before)
    await applyMigrationFile(client, M056)
    expect((await q(`select has_function_privilege('service_role', '${FN}', 'EXECUTE') as ok`))[0].ok).toBe(true)
  })
})

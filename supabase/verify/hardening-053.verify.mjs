/**
 * Migration 053 — Site Access session summary (ADR-040 B2.5). Proves, against
 * a real Postgres:
 *  - the function is service-role only;
 *  - it counts exactly the sessions site_access_resolve would honour: revoked,
 *    expired, rotated-away, switched-off and archived-group sessions are not
 *    counted; another environment and another project are not counted;
 *  - per-group counts and a total that counts a multi-group session once;
 *  - nothing but counts comes back; no re-run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql', '034_admin_backlog.sql',
  '035_whats_new.sql', '036_analytics_snapshots.sql', '050_site_access.sql']
const M053 = MIG('053_site_access_session_summary.sql')
const HASH = 'scrypt$32768$8$1$c2FsdA$aGFzaA'
const DAY = 86400
const tok = () => randomBytes(32).toString('base64url')
const sha = (s) => createHash('sha256').update(s).digest('hex')

let client
const ids = {}
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

const group = async (p, name = 'Members') => (await sq(`insert into public.site_access_groups (project_id, name) values ($1, $2::jsonb) returning id`, [p, JSON.stringify({ en: name })]))[0].id
const credential = async (p, groupIds) => (await sq(`select public.site_access_create_credential($1, 'pw', $2, $3::uuid[], null, null) as id`, [p, HASH, groupIds]))[0].id
const version = async (c) => (await sq(`select secret_version v from public.site_access_credentials where id = $1`, [c]))[0].v
async function unlock(p, c, current = null, env = 'production') {
  const t = tok()
  await sq(`select public.site_access_unlock($1, $2, $3, $4, $5, $6, $7, null)`, [p, env, c, await version(c), current ? sha(current) : null, sha(t), 30 * DAY])
  return t
}
async function summary(p, env = 'production') {
  const rows = await sq(`select * from public.site_access_session_summary($1, $2)`, [p, env])
  const out = { total: 0, byGroup: {} }
  for (const r of rows) {
    if (r.group_id === null) out.total = r.signed_in
    else out.byGroup[r.group_id] = r.signed_in
  }
  return out
}

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M053)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('s53','S') returning id`)
  ids.pA = await one(`insert into public.projects (slug, tenant_id, name) values ('s53a',$1,'A') returning id`, [ids.t])
  ids.pB = await one(`insert into public.projects (slug, tenant_id, name) values ('s53b',$1,'B') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('owner@s53.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => {
  await reset()
  await sq(`update public.site_access_sessions set revoked_at = now(), revoked_reason = 'revoked_all' where revoked_at is null`)
})

describe('053 — locked to the service role', () => {
  it('anon, a signed-in user and the tenant Owner cannot call it', async () => {
    for (const who of [() => asAnon(), () => asUser(ids.owner)]) {
      await who()
      const e = await errOf(() => q(`select * from public.site_access_session_summary($1, 'production')`, [ids.pA]))
      expect(e?.message).toMatch(/permission denied/)
      await reset()
    }
  })
})

describe('053 — counts what resolve would honour', () => {
  it('counts per group, and a session that opens two groups once in the total', async () => {
    const g1 = await group(ids.pA, 'Parents'), g2 = await group(ids.pA, 'Teachers')
    const c1 = await credential(ids.pA, [g1]), c2 = await credential(ids.pA, [g2])
    const a = await unlock(ids.pA, c1)
    await unlock(ids.pA, c2, a)           // the same browser also opens Teachers
    await unlock(ids.pA, c1)              // a second Parents visitor
    const s = await summary(ids.pA)
    expect(s.byGroup[g1]).toBe(2)
    expect(s.byGroup[g2]).toBe(1)
    expect(s.total).toBe(2)
  })

  it('one password for two groups counts the visitor in both groups, once in total', async () => {
    const g1 = await group(ids.pA), g2 = await group(ids.pA)
    const c = await credential(ids.pA, [g1, g2])
    await unlock(ids.pA, c)
    const s = await summary(ids.pA)
    expect([s.byGroup[g1], s.byGroup[g2], s.total]).toEqual([1, 1, 1])
  })

  it('a changed password, a switched-off password, an archived group, a revoked or expired session do not count', async () => {
    const gRot = await group(ids.pA), gOff = await group(ids.pA), gArc = await group(ids.pA), gRev = await group(ids.pA), gExp = await group(ids.pA)
    const cRot = await credential(ids.pA, [gRot]), cOff = await credential(ids.pA, [gOff])
    const cArc = await credential(ids.pA, [gArc]), cRev = await credential(ids.pA, [gRev]), cExp = await credential(ids.pA, [gExp])
    await unlock(ids.pA, cRot); await unlock(ids.pA, cOff); await unlock(ids.pA, cArc); await unlock(ids.pA, cExp)
    const rev = await unlock(ids.pA, cRev)
    expect((await summary(ids.pA)).total).toBe(5)

    await sq(`select public.site_access_rotate_credential($1, $2, $3, null)`, [ids.pA, cRot, HASH])
    await sq(`select public.site_access_set_credential_disabled($1, $2, true, null)`, [ids.pA, cOff])
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [gArc])
    await sq(`update public.site_access_sessions set revoked_at = now(), revoked_reason = 'logout' where token_hash = $1`, [sha(rev)])
    await sq(`update public.site_access_sessions s set expires_at = now() - interval '1 second'
               from public.site_access_session_grants g where g.session_id = s.id and g.credential_id = $1`, [cExp])

    const s = await summary(ids.pA)
    expect(s.total).toBe(0)
    expect(s.byGroup).toEqual({})
  })

  it('another environment and another project are not counted', async () => {
    const gA = await group(ids.pA), gB = await group(ids.pB)
    const cA = await credential(ids.pA, [gA]), cB = await credential(ids.pB, [gB])
    await unlock(ids.pA, cA, null, 'preview')
    await unlock(ids.pB, cB)
    expect(await summary(ids.pA)).toEqual({ total: 0, byGroup: {} })
    expect((await summary(ids.pA, 'preview')).total).toBe(1)
    expect((await summary(ids.pB)).byGroup[gB]).toBe(1)
  })

  it('returns counts only', async () => {
    const g = await group(ids.pA)
    await unlock(ids.pA, await credential(ids.pA, [g]))
    const rows = await sq(`select * from public.site_access_session_summary($1, 'production')`, [ids.pA])
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(['group_id', 'signed_in'])
  })
})

describe('053 — no re-run', () => {
  it('refuses to apply twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M053))
    expect(e?.message).toMatch(/already applied/)
  })
})

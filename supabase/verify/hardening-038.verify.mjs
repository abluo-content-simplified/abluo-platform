/**
 * Migration 038 — support sessions (ADR-028 §8 support mode). Production
 * shape: 014–036, then 038 (037 is reserved for another change and is not
 * needed here). Proves: only the client's Owner / Site admin read their
 * project's visits (never an Editor, another client, or anon); nobody but the
 * service role writes the table; decisions go only through
 * support_session_decide(), which refuses non-managers, the requesting admin
 * (even when that admin is also an Owner), invalid transitions and durations
 * out of bounds; the CHECKs hold; one open visit per admin and project; no
 * re-run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql', '034_admin_backlog.sql',
  '035_whats_new.sql', '036_analytics_snapshots.sql']
const M038 = MIG('038_support_sessions.sql')

let client
const ids = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asService() { await client.query(`select public.set_session_auth(null, 'service_role')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
const one = async (sql, p) => (await q(sql, p))[0].id
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const visible = async () => (await q(`select id from public.support_sessions order by started_at`)).map((r) => r.id)
const decide = (id, d, m = 60) => q(`select * from public.support_session_decide($1, $2, $3)`, [id, d, m])
const row = async (id) => { await reset(); return (await q(`select * from public.support_sessions where id = $1`, [id]))[0] }
async function visit(project, admin, cols = {}) {
  await reset()
  const keys = ['project_id', 'admin_user_id', ...Object.keys(cols)]
  const vals = [project, admin, ...Object.values(cols)]
  return one(`insert into public.support_sessions (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)
}

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M038)
  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('ss-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('ss-b','B') returning id`)
  ids.pA1 = await one(`insert into public.projects (slug, tenant_id, name) values ('ss-a1',$1,'A1') returning id`, [ids.tA])
  ids.pA2 = await one(`insert into public.projects (slug, tenant_id, name) values ('ss-a2',$1,'A2') returning id`, [ids.tA])
  ids.pB1 = await one(`insert into public.projects (slug, tenant_id, name) values ('ss-b1',$1,'B1') returning id`, [ids.tB])
  for (const u of ['admin', 'admin2', 'ownerA', 'siteAdminA1', 'editorA1', 'ownerB']) {
    ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@ss.test`])
  }
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tA, ids.ownerA])
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tB, ids.ownerB])
  // admin2 is an Abluo admin who ALSO owns tenant A (Tom's own accounts do).
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tA, ids.admin2])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'admin')`, [ids.pA1, ids.siteAdminA1])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.pA1, ids.editorA1])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('038 support_sessions — reads', () => {
  it('Owner reads every visit of their client’s projects; Site admin only their project; others nothing', async () => {
    const a1 = await visit(ids.pA1, ids.admin)
    const a2 = await visit(ids.pA2, ids.admin)
    const b1 = await visit(ids.pB1, ids.admin)
    await asUser(ids.ownerA)
    expect((await visible()).sort()).toEqual([a1, a2].sort())
    await asUser(ids.siteAdminA1)
    expect(await visible()).toEqual([a1])
    await asUser(ids.editorA1)
    expect(await visible()).toEqual([])
    await asUser(ids.ownerB)
    expect(await visible()).toEqual([b1])
    await asUser(ids.admin)
    expect(await visible()).toEqual([]) // the admin reads through the service role, not RLS
    await reset()
    await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = any($1)`, [[a1, a2, b1]])
  })
  it('anon can neither read nor call the functions', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.support_sessions`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => q(`select * from public.get_my_support_project_ids()`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => decide('00000000-0000-0000-0000-000000000000', 'allow')))?.code).toBe('42501')
  })
})

describe('038 support_sessions — writes', () => {
  it('authenticated (even the Owner) cannot insert, update or delete', async () => {
    const id = await visit(ids.pA1, ids.admin)
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`insert into public.support_sessions (project_id, admin_user_id) values ($1,$2)`, [ids.pA1, ids.ownerA])))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`update public.support_sessions set status = 'allowed', expires_at = now() + interval '1 day' where id = $1`, [id])))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`delete from public.support_sessions where id = $1`, [id])))?.code).toBe('42501')
    expect((await row(id)).status).toBe('viewing')
    await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = $1`, [id])
  })
  it('one open visit per admin and project; a closed one does not count', async () => {
    const id = await visit(ids.pA1, ids.admin)
    expect((await errOf(() => visit(ids.pA1, ids.admin)))?.code).toBe('23505')
    await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = $1`, [id])
    const id2 = await visit(ids.pA1, ids.admin)
    await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = $1`, [id2])
  })
  it('CHECKs: role, status, ended/ended_at, allowed needs expiry, decided needs who', async () => {
    expect((await errOf(() => visit(ids.pB1, ids.admin, { role: 'member' })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { status: 'live' })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { status: 'ended' })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { ended_at: new Date().toISOString() })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { status: 'allowed', requested_at: new Date().toISOString(), decided_at: new Date().toISOString(), decided_by: ids.ownerB })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { status: 'declined', requested_at: new Date().toISOString() })))?.code).toBe('23514')
    expect((await errOf(() => visit(ids.pB1, ids.admin, { status: 'requested' })))?.code).toBe('23514')
  })
  it('the service role writes', async () => {
    await asService()
    const id = await one(`insert into public.support_sessions (project_id, admin_user_id) values ($1,$2) returning id`, [ids.pB1, ids.admin2])
    await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = $1`, [id])
  })
})

describe('038 support_session_decide()', () => {
  async function requested(project = ids.pA1, admin = ids.admin) {
    return visit(project, admin, { status: 'requested', requested_at: new Date().toISOString() })
  }
  async function close(id) { await reset(); await q(`update public.support_sessions set status = 'ended', ended_at = now() where id = $1`, [id]) }

  it('Owner allows: allowed, decided_by = Owner, expires in p_minutes', async () => {
    const id = await requested()
    await asUser(ids.ownerA)
    const [r] = await decide(id, 'allow', 60)
    expect(r.status).toBe('allowed')
    expect(r.decided_by).toBe(ids.ownerA)
    const mins = (new Date(r.expires_at) - new Date(r.decided_at)) / 60000
    expect(Math.round(mins)).toBe(60)
    await close(id)
  })
  it('Site admin declines; Editor and another client’s Owner cannot decide', async () => {
    const id = await requested()
    await asUser(ids.editorA1)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('42501')
    await asUser(ids.ownerB)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('42501')
    await asUser(ids.siteAdminA1)
    const [r] = await decide(id, 'decline')
    expect(r.status).toBe('declined')
    expect(r.expires_at).toBeNull()
    await close(id)
  })
  it('a Site admin of ANOTHER project of the same client cannot decide', async () => {
    const id = await requested(ids.pA2)
    await asUser(ids.siteAdminA1)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('42501')
    await close(id)
  })
  it('the requesting admin can never approve their own request — even as Owner', async () => {
    const id = await requested(ids.pA1, ids.admin2)
    await asUser(ids.admin2)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('42501')
    expect((await row(id)).status).toBe('requested')
    // and the table refuses it even for the service role
    expect((await errOf(() => q(`update public.support_sessions set status = 'allowed', decided_at = now(), decided_by = admin_user_id, expires_at = now() + interval '1 hour' where id = $1`, [id])))?.code).toBe('23514')
    await close(id)
  })
  it('invalid transitions: allow twice, decline after allow, revoke without access, decide a closed visit', async () => {
    const id = await requested()
    await asUser(ids.ownerA)
    await decide(id, 'allow')
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('55000')
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'decline')))?.code).toBe('55000')
    await asUser(ids.ownerA)
    const [r] = await decide(id, 'revoke')
    expect(r.status).toBe('revoked')
    expect(r.revoked_by).toBe(ids.ownerA)
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'revoke')))?.code).toBe('55000')
    await close(id)
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'allow')))?.code).toBe('55000')
  })
  it('an expired approval cannot be revoked (nothing to end)', async () => {
    const id = await visit(ids.pA1, ids.admin, {
      status: 'allowed', requested_at: new Date(Date.now() - 7_200_000).toISOString(),
      decided_at: new Date(Date.now() - 7_000_000).toISOString(), decided_by: ids.ownerA,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'revoke')))?.code).toBe('55000')
    await close(id)
  })
  it('bad decision or duration is refused', async () => {
    const id = await requested()
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'approve')))?.code).toBe('22023')
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'allow', 1)))?.code).toBe('22023')
    await asUser(ids.ownerA)
    expect((await errOf(() => decide(id, 'allow', 100000)))?.code).toBe('22023')
    expect((await row(id)).status).toBe('requested')
    await close(id)
  })
  it('an unknown id answers like a foreign one (nothing leaks)', async () => {
    await asUser(ids.ownerA)
    expect((await errOf(() => decide('00000000-0000-4000-8000-000000000999', 'allow')))?.code).toBe('42501')
  })
})

describe('038 shape and re-run', () => {
  it('functions are SECURITY DEFINER with an empty search_path', async () => {
    const rows = await q(`select proname, prosecdef, proconfig from pg_proc
      where proname in ('support_session_decide', 'get_my_support_project_ids') and pronamespace = 'public'::regnamespace`)
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.prosecdef).toBe(true)
      expect(r.proconfig).toContain('search_path=""')
    }
  })
  it('refuses to run twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M038))
    expect(String(e?.message)).toMatch(/038: already applied/)
  })
})

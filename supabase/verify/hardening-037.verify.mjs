/**
 * Migration 037 — project provisioning runs (admin "New project" wizard).
 * Production shape: 014–036, then 037. Proves the CHECKs, the one-open-run-
 * per-slug index, the updated_at trigger, that API roles (even an Owner) have
 * no access while the service role does, and that the migration refuses to
 * run twice.
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
const M037 = MIG('037_project_provisioning.sql')

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
let n = 0
const run = (cols = {}) => {
  n += 1
  const c = {
    tenant_mode: 'new',
    tenant_id: '00000000-0000-4000-8000-0000000000a1',
    tenant_slug: 'acme',
    project_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    project_slug: `site-${n}`,
    input: '{}',
    plan: '{}',
    ...cols,
  }
  const keys = Object.keys(c)
  return q(`insert into public.project_provisioning_runs (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    keys.map((k) => c[k]))
}
const row = async (id) => (await q(`select * from public.project_provisioning_runs where id = $1`, [id]))[0]
const tick = () => q(`select pg_sleep(0.02)`)

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M037)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('pv-a','A') returning id`)
  ids.owner = await one(`insert into auth.users (email) values ('owner@pv.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('037 CHECK constraints', () => {
  it('defaults: pending, no steps, 0 attempts, not completed', async () => {
    const [r] = await run()
    expect([r.status, r.steps, r.attempts, r.completed_at, r.current_step]).toEqual(['pending', {}, 0, null, null])
  })
  it('status and tenant_mode accept only their values', async () => {
    for (const s of ['pending', 'running', 'failed']) await run({ status: s })
    await run({ status: 'completed', completed_at: new Date().toISOString() })
    for (const s of ['done', 'Completed', '']) expect((await errOf(() => run({ status: s })))?.code).toBe('23514')
    for (const m of ['existing', 'new']) await run({ tenant_mode: m })
    for (const m of ['old', '']) expect((await errOf(() => run({ tenant_mode: m })))?.code).toBe('23514')
  })
  it('completed ⇔ completed_at', async () => {
    expect((await errOf(() => run({ status: 'completed' })))?.code).toBe('23514')
    expect((await errOf(() => run({ status: 'failed', completed_at: new Date().toISOString() })))?.code).toBe('23514')
  })
  it('slugs, json shapes, current_step, last_error and attempts are bounded', async () => {
    for (const bad of [
      { project_slug: 'Bad' }, { project_slug: '1abc' }, { project_slug: 'a' }, { project_slug: 'x'.repeat(41) },
      { tenant_slug: 'Bad' }, { tenant_slug: '' },
      { input: '[]' }, { plan: '"x"' }, { steps: '[]' },
      { current_step: 'drop table' }, { last_error: 'x'.repeat(2001) }, { attempts: -1 },
    ]) {
      expect((await errOf(() => run(bad)))?.code).toBe('23514')
    }
    // An existing client keeps its own slug shape.
    await run({ tenant_mode: 'existing', tenant_slug: 'studio_old-1' })
    await run({ current_step: 'sanity.designSystem', last_error: 'x'.repeat(2000), attempts: 3 })
  })
})

describe('037 one open run per project slug', () => {
  it('a second pending/running/completed run for the same slug is refused', async () => {
    await run({ project_slug: 'dup-a' })
    expect((await errOf(() => run({ project_slug: 'dup-a' })))?.code).toBe('23505')
    expect((await errOf(() => run({ project_slug: 'dup-a', status: 'completed', completed_at: new Date().toISOString() })))?.code).toBe('23505')
  })
  it('failed runs do not hold the slug', async () => {
    await run({ project_slug: 'dup-b', status: 'failed' })
    await run({ project_slug: 'dup-b', status: 'failed' })
    await run({ project_slug: 'dup-b' })
  })
  it('a failed run cannot be resumed while another run holds its slug', async () => {
    const [f] = await run({ project_slug: 'dup-c', status: 'failed' })
    await run({ project_slug: 'dup-c' })
    expect((await errOf(() => q(`update public.project_provisioning_runs set status = 'running' where id = $1`, [f.id])))?.code).toBe('23505')
  })
})

describe('037 trigger', () => {
  it('updated_at moves on update', async () => {
    const [r] = await run()
    await tick()
    await q(`update public.project_provisioning_runs set status = 'running', attempts = attempts + 1 where id = $1`, [r.id])
    expect((await row(r.id)).updated_at.getTime()).toBeGreaterThan(r.updated_at.getTime())
  })
})

describe('037 access', () => {
  it('RLS on, no policies, no API-role privileges', async () => {
    expect((await q(`select relrowsecurity from pg_class where oid = 'public.project_provisioning_runs'::regclass`))[0].relrowsecurity).toBe(true)
    expect((await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='project_provisioning_runs'`))[0].n).toBe(0)
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await q(`select has_table_privilege($1, 'public.project_provisioning_runs', $2) as ok`, [role, priv]))[0].ok).toBe(false)
      }
    }
  })
  it('authenticated (even an Owner) cannot read or write', async () => {
    await asUser(ids.owner)
    expect((await errOf(() => q(`select * from public.project_provisioning_runs`)))?.code).toBe('42501')
    await asUser(ids.owner)
    expect((await errOf(() => run()))?.code).toBe('42501')
  })
  it('anon cannot read or write', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.project_provisioning_runs`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => run()))?.code).toBe('42501')
  })
  it('the service role reads and writes', async () => {
    await asService()
    const [r] = await run({ project_slug: 'svc-a' })
    await q(`update public.project_provisioning_runs set steps = $2::jsonb where id = $1`, [r.id, JSON.stringify({ 'supabase.tenant': { status: 'done' } })])
    expect((await row(r.id)).steps).toEqual({ 'supabase.tenant': { status: 'done' } })
  })
  it('re-running the migration raises and changes nothing', async () => {
    const before = (await q(`select count(*)::int as n from public.project_provisioning_runs`))[0].n
    const err = await errOf(() => applyMigrationFile(client, M037))
    expect(err?.message).toMatch(/037: already applied/)
    expect((await q(`select count(*)::int as n from public.project_provisioning_runs`))[0].n).toBe(before)
  })
})

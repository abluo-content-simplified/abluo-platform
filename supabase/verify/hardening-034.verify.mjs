/**
 * Migration 034 — admin backlog (ADR-030 §5.5). Production shape: 014–033,
 * then 034. Proves the CHECKs, the updated_at / done_at triggers, that API
 * roles have no access, and that the migration refuses to run twice.
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
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql']
const M034 = MIG('034_admin_backlog.sql')

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
const item = (cols = {}) => {
  const c = { title: 'T', ...cols }
  const keys = Object.keys(c)
  return q(`insert into public.admin_backlog_items (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
    keys.map((k) => c[k]))
}
const row = async (id) => (await q(`select * from public.admin_backlog_items where id = $1`, [id]))[0]
// now() is the transaction start time; separate statements = separate transactions, so a short sleep makes it move.
const tick = () => q(`select pg_sleep(0.02)`)

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M034)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('bl-a','A') returning id`)
  ids.p = await one(`insert into public.projects (slug, tenant_id, name) values ('bl-a1',$1,'A1') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('owner@bl.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('034 CHECK constraints', () => {
  it('defaults: other / task / p2 / inbox, no done_at', async () => {
    const [r] = await item()
    expect([r.area, r.type, r.priority, r.status, r.done_at]).toEqual(['other', 'task', 'p2', 'inbox', null])
  })
  const valid = {
    area: ['client_dashboard', 'admin', 'module', 'website', 'platform', 'infrastructure', 'other'],
    type: ['bug', 'improvement', 'idea', 'task'],
    priority: ['p0', 'p1', 'p2', 'p3'],
    status: ['inbox', 'planned', 'in_progress', 'blocked', 'done', 'wont_do'],
  }
  const invalid = { area: ['dashboard', 'Admin', ''], type: ['feature', 'Bug'], priority: ['p4', 'P0', 'high'], status: ['open', 'closed', 'Done'] }
  for (const col of Object.keys(valid)) {
    it(`${col}: every allowed value is accepted, others are rejected`, async () => {
      for (const v of valid[col]) await item({ [col]: v })
      for (const v of invalid[col]) expect((await errOf(() => item({ [col]: v })))?.code).toBe('23514')
      expect((await errOf(() => item({ [col]: null })))?.code).toBe('23502')
    })
  }
  it('title, body, module_id and links are bounded', async () => {
    for (const bad of [{ title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { body: 'x'.repeat(20001) },
      { module_id: 'Forms' }, { module_id: '1forms' }, { links: '{}' }, { links: JSON.stringify(Array(21).fill({})) }]) {
      expect((await errOf(() => item(bad)))?.code).toBe('23514')
    }
    await item({ title: 'x'.repeat(200), module_id: 'forms', links: JSON.stringify([{ label: 'ADR-030', url: 'https://x' }]) })
  })
})

describe('034 triggers', () => {
  it('updated_at moves on update', async () => {
    const [r] = await item()
    await tick()
    await q(`update public.admin_backlog_items set title = 'T2' where id = $1`, [r.id])
    expect((await row(r.id)).updated_at.getTime()).toBeGreaterThan(r.updated_at.getTime())
  })
  it('inserting as done sets done_at', async () => {
    const [r] = await item({ status: 'done' })
    expect(r.done_at).not.toBeNull()
  })
  it('done_at is set when status becomes done, kept while done, cleared when it leaves done', async () => {
    const [r] = await item({ status: 'planned' })
    expect(r.done_at).toBeNull()
    await q(`update public.admin_backlog_items set status = 'done' where id = $1`, [r.id])
    const doneAt = (await row(r.id)).done_at
    expect(doneAt).not.toBeNull()
    await tick()
    // done → done (status touched again) keeps the original done_at
    await q(`update public.admin_backlog_items set status = 'done' where id = $1`, [r.id])
    expect((await row(r.id)).done_at.getTime()).toBe(doneAt.getTime())
    // an unrelated edit while done keeps it
    await q(`update public.admin_backlog_items set title = 'edited' where id = $1`, [r.id])
    expect((await row(r.id)).done_at.getTime()).toBe(doneAt.getTime())
    // leaving done clears it
    await q(`update public.admin_backlog_items set status = 'in_progress' where id = $1`, [r.id])
    expect((await row(r.id)).done_at).toBeNull()
    // done again → a fresh date
    await tick()
    await q(`update public.admin_backlog_items set status = 'done' where id = $1`, [r.id])
    expect((await row(r.id)).done_at.getTime()).toBeGreaterThan(doneAt.getTime())
  })
  it('a client-supplied done_at on a non-done item is cleared', async () => {
    const [r] = await item({ status: 'inbox', done_at: '2020-01-01T00:00:00Z' })
    expect(r.done_at).toBeNull()
  })
  it('the trigger function is not executable by API roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect((await q(`select has_function_privilege($1, 'public.tg_admin_backlog_done_at()', 'EXECUTE') as ok`, [role]))[0].ok).toBe(false)
    }
  })
})

describe('034 access', () => {
  it('RLS on, no policies, no API-role privileges', async () => {
    expect((await q(`select relrowsecurity from pg_class where oid = 'public.admin_backlog_items'::regclass`))[0].relrowsecurity).toBe(true)
    expect((await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='admin_backlog_items'`))[0].n).toBe(0)
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await q(`select has_table_privilege($1, 'public.admin_backlog_items', $2) as ok`, [role, priv]))[0].ok).toBe(false)
      }
    }
  })
  it('authenticated (even an Owner) cannot read or write', async () => {
    await asUser(ids.owner)
    expect((await errOf(() => q(`select * from public.admin_backlog_items`)))?.code).toBe('42501')
    await asUser(ids.owner)
    expect((await errOf(() => item()))?.code).toBe('42501')
  })
  it('anon cannot read or write', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.admin_backlog_items`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => item()))?.code).toBe('42501')
  })
  it('the service role reads and writes (and the triggers run for it)', async () => {
    await asService()
    const [r] = await item({ status: 'done', project_id: ids.p })
    expect(r.done_at).not.toBeNull()
    await q(`update public.admin_backlog_items set status = 'wont_do' where id = $1`, [r.id])
    expect((await row(r.id)).done_at).toBeNull()
    await q(`delete from public.admin_backlog_items where id = $1`, [r.id])
  })
  it('deleting the project keeps the item (set null)', async () => {
    const p2 = await one(`insert into public.projects (slug, tenant_id, name) values ('bl-a2',$1,'A2') returning id`, [ids.t])
    const [r] = await item({ project_id: p2 })
    await q(`delete from public.projects where id = $1`, [p2])
    expect((await row(r.id)).project_id).toBeNull()
  })
  it('re-running the migration raises and changes nothing', async () => {
    const before = (await q(`select count(*)::int as n from public.admin_backlog_items`))[0].n
    const err = await errOf(() => applyMigrationFile(client, M034))
    expect(err?.message).toMatch(/034: already applied/)
    expect((await q(`select count(*)::int as n from public.admin_backlog_items`))[0].n).toBe(before)
  })
})

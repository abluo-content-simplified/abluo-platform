/**
 * Migration 039 — dashboard dismissals ("Hide checklist", ADR-029 Home).
 * Production shape: 014–036, then 039. Proves: a person hides things only for
 * themselves and only on a project they belong to (tenant Owner → every
 * project of the tenant; site member → that site); they see only their own
 * rows; nobody updates or deletes through the API; anon gets nothing; the key
 * pattern holds; rows follow the person and the project; no re-run.
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
const M039 = MIG('039_dashboard_dismissals.sql')

let client
const ids = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
const one = async (sql, p) => (await q(sql, p))[0].id
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const hide = (user, project, key = 'setupChecklist') =>
  q(`insert into public.dashboard_dismissals (user_id, project_id, key) values ($1,$2,$3)`, [user, project, key])
const mine = async () => (await q(`select user_id, project_id, key from public.dashboard_dismissals order by project_id, key`))
const count = async () => (await q(`select count(*)::int as n from public.dashboard_dismissals`))[0].n

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M039)

  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('dd-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('dd-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('dd-a1',$1,'A1') returning id`, [ids.tA])
  ids.A2 = await one(`insert into public.projects (slug, tenant_id, name) values ('dd-a2',$1,'A2') returning id`, [ids.tA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('dd-b1',$1,'B1') returning id`, [ids.tB])
  for (const u of ['ownerA', 'editorA1', 'ownerB', 'stranger']) ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@dd.test`])
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner'), ($3,$4,'owner')`, [ids.tA, ids.ownerA, ids.tB, ids.ownerB])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.A1, ids.editorA1])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('039 dashboard_dismissals — who may hide what', () => {
  it('an Owner hides on every project of their client; an Editor on their own site', async () => {
    await asUser(ids.ownerA)
    await hide(ids.ownerA, ids.A1)
    await hide(ids.ownerA, ids.A2)
    await asUser(ids.editorA1)
    await hide(ids.editorA1, ids.A1)
    await reset()
    expect(await count()).toBe(3)
  })
  it('nobody hides on a project they do not belong to', async () => {
    await asUser(ids.editorA1)
    expect((await errOf(() => hide(ids.editorA1, ids.A2)))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => hide(ids.ownerA, ids.B1)))?.code).toBe('42501')
    await asUser(ids.stranger)
    expect((await errOf(() => hide(ids.stranger, ids.A1)))?.code).toBe('42501')
  })
  it('nobody hides on behalf of someone else', async () => {
    await asUser(ids.ownerA)
    expect((await errOf(() => hide(ids.editorA1, ids.A1, 'other.key')))?.code).toBe('42501')
    await reset()
    expect((await q(`select count(*)::int as n from public.dashboard_dismissals where key = 'other.key'`))[0].n).toBe(0)
  })
  it('each person sees only their own rows', async () => {
    await asUser(ids.editorA1)
    expect(await mine()).toEqual([{ user_id: ids.editorA1, project_id: ids.A1, key: 'setupChecklist' }])
    await asUser(ids.ownerB)
    expect(await mine()).toEqual([])
  })
  it('hiding twice is a primary-key conflict (the app upserts with ignoreDuplicates)', async () => {
    await asUser(ids.editorA1)
    expect((await errOf(() => hide(ids.editorA1, ids.A1)))?.code).toBe('23505')
    await asUser(ids.editorA1)
    await q(`insert into public.dashboard_dismissals (user_id, project_id, key) values ($1,$2,'setupChecklist') on conflict do nothing`, [ids.editorA1, ids.A1])
  })
  it('no update or delete through the API (own rows included)', async () => {
    await asUser(ids.editorA1)
    expect((await errOf(() => q(`update public.dashboard_dismissals set key = 'x' where user_id = $1`, [ids.editorA1])))?.code).toBe('42501')
    await asUser(ids.editorA1)
    expect((await errOf(() => q(`delete from public.dashboard_dismissals where user_id = $1`, [ids.editorA1])))?.code).toBe('42501')
    await reset()
    expect(await count()).toBe(3)
  })
  it('anon can neither read nor write', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.dashboard_dismissals`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => hide(ids.ownerA, ids.A1, 'anon.key')))?.code).toBe('42501')
  })
  it('the key must match the pattern', async () => {
    for (const bad of ['', 'Upper', '1abc', 'has space', 'a'.repeat(65), 'semi;colon']) {
      expect((await errOf(() => hide(ids.ownerA, ids.A1, bad)))?.code).toBe('23514')
    }
  })
  it('rows follow the project and the person (cascade)', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('dd-tmp',$1,'T') returning id`, [ids.tA])
    await asUser(ids.ownerA)
    await hide(ids.ownerA, p)
    await reset()
    await q(`delete from public.projects where id = $1`, [p])
    expect((await q(`select count(*)::int as n from public.dashboard_dismissals where project_id = $1`, [p]))[0].n).toBe(0)
    const u = await one(`insert into auth.users (email) values ('gone@dd.test') returning id`)
    await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.A2, u])
    await asUser(u)
    await hide(u, ids.A2)
    await reset()
    await q(`delete from public.project_members where user_id = $1`, [u])
    await q(`delete from auth.users where id = $1`, [u])
    expect((await q(`select count(*)::int as n from public.dashboard_dismissals where user_id = $1`, [u]))[0].n).toBe(0)
  })
})

describe('039 re-run', () => {
  it('re-running the migration raises and changes nothing', async () => {
    const err = await errOf(() => applyMigrationFile(client, M039))
    expect(err?.message).toMatch(/039: already applied/)
    expect((await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename = 'dashboard_dismissals'`))[0].n).toBe(2)
  })
})

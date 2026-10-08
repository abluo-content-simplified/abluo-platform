/**
 * Migration 033 — internal admin audit log (ADR-030). Production shape:
 * 014–031 (as hardening-031) + 032 avatars bucket, then 033. Proves the log is
 * server-only (RLS on, no API-role access, no policies), the service role can
 * write it, the action CHECK holds, and the migration refuses to run twice.
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
  '031_project_member_archive.sql', '032_avatars_bucket.sql']
const M033 = MIG('033_admin_audit_log.sql')

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
const insertLog = (action = 'project.view') =>
  q(`insert into public.admin_audit_log (actor_id, action, project_id, detail) values ($1,$2,$3,'{"k":1}')`, [ids.admin, action, ids.p])

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M033)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('al-a','A') returning id`)
  ids.p = await one(`insert into public.projects (slug, tenant_id, name) values ('al-a1',$1,'A1') returning id`, [ids.t])
  ids.admin = await one(`insert into auth.users (email) values ('admin@al.test') returning id`)
  ids.owner = await one(`insert into auth.users (email) values ('owner@al.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('033 admin_audit_log', () => {
  it('032 created a public avatars bucket (storage shim)', async () => {
    expect(await q(`select id, public from storage.buckets where id = 'avatars'`)).toEqual([{ id: 'avatars', public: true }])
  })
  it('table exists with RLS on and no policies', async () => {
    expect((await q(`select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass`))[0].relrowsecurity).toBe(true)
    expect((await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='admin_audit_log'`))[0].n).toBe(0)
  })
  it('anon and authenticated hold no privilege at all', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await q(`select has_table_privilege($1, 'public.admin_audit_log', $2) as ok`, [role, priv]))[0].ok).toBe(false)
      }
    }
  })
  it('the service role can insert and read', async () => {
    await asService()
    await insertLog()
    expect((await q(`select count(*)::int as n from public.admin_audit_log`))[0].n).toBe(1)
  })
  it('a signed-in person (even the Owner of the project) cannot read or insert', async () => {
    await asUser(ids.owner)
    expect((await errOf(() => q(`select * from public.admin_audit_log`)))?.code).toBe('42501')
    await asUser(ids.owner)
    expect((await errOf(() => insertLog()))?.code).toBe('42501')
  })
  it('anon cannot read or insert', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.admin_audit_log`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => insertLog()))?.code).toBe('42501')
  })
  it('action CHECK rejects bad names and accepts good ones', async () => {
    for (const bad of ['Project.view', '1abc', 'ab', 'project view', 'project-view', '', 'x'.repeat(65)]) {
      expect((await errOf(() => insertLog(bad)))?.code).toBe('23514')
    }
    for (const good of ['abc', 'project.view', 'media.list_all', 'a' + 'b'.repeat(63)]) await insertLog(good)
  })
  it('deleting the project or the actor keeps the row (set null)', async () => {
    const t2 = await one(`insert into public.projects (slug, tenant_id, name) values ('al-a2',$1,'A2') returning id`, [ids.t])
    const u2 = await one(`insert into auth.users (email) values ('a2@al.test') returning id`)
    const row = await one(`insert into public.admin_audit_log (actor_id, action, project_id) values ($1,'project.view',$2) returning id`, [u2, t2])
    await q(`delete from public.projects where id = $1`, [t2])
    await q(`delete from auth.users where id = $1`, [u2])
    expect(await q(`select actor_id, project_id from public.admin_audit_log where id = $1`, [row])).toEqual([{ actor_id: null, project_id: null }])
  })
  it('re-running the migration raises and changes nothing', async () => {
    const before = (await q(`select count(*)::int as n from public.admin_audit_log`))[0].n
    const err = await errOf(() => applyMigrationFile(client, M033))
    expect(err?.message).toMatch(/033: already applied/)
    expect((await q(`select count(*)::int as n from public.admin_audit_log`))[0].n).toBe(before)
  })
})

/**
 * Migration 031 — archived people. Proves the archive record is server-only,
 * grants nothing, validates extras, and allows one open record per person/site.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)

let client
const ids = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
const one = async (sql, p) => (await q(sql, p))[0].id
async function fails(fn) { try { await fn(); return false } catch { await reset(); return true } }

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
    '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
    '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
    '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
    '031_project_member_archive.sql']) {
    await applyMigrationFile(client, MIG(f))
  }
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('ar-a','A') returning id`)
  ids.p = await one(`insert into public.projects (slug, tenant_id, name) values ('ar-a1',$1,'A1') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('owner@ar.test') returning id`)
  ids.ed = await one(`insert into auth.users (email) values ('ed@ar.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('031 project_member_archive', () => {
  it('service role can write a valid record', async () => {
    await reset()
    await q(`insert into public.project_member_archive (project_id, user_id, role, extra_permissions, archived_by)
             values ($1,$2,'editor','{forms.submission.read}',$3)`, [ids.p, ids.ed, ids.owner])
    expect((await q(`select count(*)::int as n from public.project_member_archive`))[0].n).toBe(1)
  })
  it('only one open record per person and site', async () => {
    await reset()
    expect(await fails(() => q(`insert into public.project_member_archive (project_id, user_id, role) values ($1,$2,'editor')`, [ids.p, ids.ed]))).toBe(true)
  })
  it('rejects roles that are not site roles and extras that are not grantable', async () => {
    await reset()
    const u = await one(`insert into auth.users (email) values ('x@ar.test') returning id`)
    expect(await fails(() => q(`insert into public.project_member_archive (project_id, user_id, role) values ($1,$2,'owner')`, [ids.p, u]))).toBe(true)
    expect(await fails(() => q(`insert into public.project_member_archive (project_id, user_id, role, extra_permissions) values ($1,$2,'editor','{billing.manage}')`, [ids.p, u]))).toBe(true)
  })
  it('signed-in people (even the Owner) and anon cannot read or write it', async () => {
    await asUser(ids.owner)
    expect(await fails(() => q(`select * from public.project_member_archive`))).toBe(true)
    await asUser(ids.ed)
    expect(await fails(() => q(`insert into public.project_member_archive (project_id, user_id, role) values ($1,$2,'editor')`, [ids.p, ids.ed]))).toBe(true)
    await asAnon()
    expect(await fails(() => q(`select * from public.project_member_archive`))).toBe(true)
    await reset()
  })
  it('an archive record grants nothing: the archived editor has no site', async () => {
    await asUser(ids.ed)
    expect(await q(`select * from public.get_my_project_ids()`)).toEqual([])
    expect(await q(`select * from public.get_my_project_ids_with('forms.submission.read')`)).toEqual([])
    await reset()
  })
  it('restore closes the record; a new archive is then allowed', async () => {
    await reset()
    await q(`update public.project_member_archive set restored_at = now(), restored_by = $1 where user_id = $2`, [ids.owner, ids.ed])
    await q(`insert into public.project_member_archive (project_id, user_id, role) values ($1,$2,'editor')`, [ids.p, ids.ed])
    expect((await q(`select count(*)::int as n from public.project_member_archive`))[0].n).toBe(2)
  })
  it('restored_by without restored_at is refused', async () => {
    await reset()
    expect(await fails(() => q(`update public.project_member_archive set restored_by = $1 where restored_at is null`, [ids.owner]))).toBe(true)
  })
})

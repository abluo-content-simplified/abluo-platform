/**
 * Migration 051 — Access module grantable extras (ADR-040 B2.1). Proves, against
 * a real Postgres: the two extras are accepted on a project membership, manage
 * is refused without read (029's validation trigger), neither applies to a
 * tenant-only scope wrongly, an unknown members.* id is refused, and no re-run.
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
  '028_security_hardening.sql', '029_roles_extras_invitations.sql']
const M051 = MIG('051_site_access_grantable.sql')

let client
const ids = {}
const q = async (sql, p) => (await client.query(sql, p)).rows
async function errOf(fn) { try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} return e } }

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M051)
  ids.t = (await q(`insert into public.tenants (slug, display_name) values ('g51','G') returning id`))[0].id
  ids.p = (await q(`insert into public.projects (slug, tenant_id, name) values ('g51p',$1,'GP') returning id`, [ids.t]))[0].id
  ids.u = (await q(`insert into auth.users (email) values ('ed@g51.test') returning id`))[0].id
  ids.u2 = (await q(`insert into auth.users (email) values ('ow@g51.test') returning id`))[0].id
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('051 — Access extras', () => {
  it('rows exist as project-scoped, manage requires read', async () => {
    expect(await q(`select id, applies_to, requires from public.grantable_permissions where id like 'members.%' order by id`)).toEqual([
      { id: 'members.access.manage', applies_to: 'project', requires: 'members.access.read' },
      { id: 'members.access.read', applies_to: 'project', requires: null },
    ])
  })
  it('an Editor membership may carry read, or read + manage', async () => {
    await q(`insert into public.project_members (project_id, user_id, role, extra_permissions) values ($1,$2,'editor', array['members.access.read'])`, [ids.p, ids.u])
    await q(`update public.project_members set extra_permissions = array['members.access.read','members.access.manage'] where user_id = $1`, [ids.u])
    expect((await q(`select extra_permissions from public.project_members where user_id = $1`, [ids.u]))[0].extra_permissions)
      .toEqual(['members.access.read', 'members.access.manage'])
  })
  it('manage without read is refused by the database', async () => {
    const e = await errOf(() => q(`update public.project_members set extra_permissions = array['members.access.manage'] where user_id = $1`, [ids.u]))
    expect(e?.code).toBe('23514')
    expect(e?.message).toContain('requires "members.access.read"')
  })
  it('an unknown members.* id is refused', async () => {
    const e = await errOf(() => q(`update public.project_members set extra_permissions = array['members.access.delete'] where user_id = $1`, [ids.u]))
    expect(e?.code).toBe('23514')
  })
  it('on a tenant membership the extras are accepted as project-scoped (they then apply to every project of the tenant)', async () => {
    await q(`insert into public.tenant_members (tenant_id, user_id, role, extra_permissions) values ($1,$2,'member', array['members.access.read'])`, [ids.t, ids.u2])
    expect((await q(`select extra_permissions from public.tenant_members where user_id = $1`, [ids.u2]))[0].extra_permissions).toEqual(['members.access.read'])
  })
  it('refuses to run twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M051))
    expect(e?.message).toContain('051: already applied')
  })
})

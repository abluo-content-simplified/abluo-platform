/**
 * Migration 042 — removal reason 'archived' (ADR-032 D11, slice 5).
 * Production shape: … 040, 041, then 042. Proves: 'archived' is accepted,
 * every existing reason still is, unknown reasons are still refused, existing
 * rows are untouched, exactly one reason constraint remains, the migration can
 * be re-run, and it refuses to run without 040.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql', '034_admin_backlog.sql',
  '035_whats_new.sql', '036_analytics_snapshots.sql', '040_connections.sql', '041_content_audit_log.sql']
const M042 = MIG('042_tombstone_reason_archived.sql')

let client
let projectId
const q = async (sql, p) => (await client.query(sql, p)).rows
const insert = (reason) =>
  client.query(`insert into public.api_tombstones (project_id, resource, public_id, reason) values ($1, 'event', gen_random_uuid(), $2)`, [projectId, reason])
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} return e }
}
const reasonChecks = () => q(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.api_tombstones'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%reason%'`)

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  const t = (await q(`insert into public.tenants (slug, display_name) values ('t-042', 'T') returning id`))[0].id
  projectId = (await q(`insert into public.projects (slug, tenant_id, name) values ('p-042', $1, 'P') returning id`, [t]))[0].id
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('migration 042', () => {
  it('before: archived is refused, existing reasons are accepted', async () => {
    expect(await errOf(() => insert('archived'))).toBeTruthy()
    for (const r of ['deleted', 'unpublished', 'unlisted', 'websiteOnly']) await insert(r)
  })

  it('after: archived is accepted, the old reasons still are, unknown ones are not; old rows untouched', async () => {
    const before = await q(`select reason from public.api_tombstones order by id`)
    await applyMigrationFile(client, M042)
    await insert('archived')
    for (const r of ['deleted', 'unpublished', 'unlisted', 'websiteOnly']) await insert(r)
    expect(await errOf(() => insert('gone'))).toBeTruthy()
    expect((await q(`select reason from public.api_tombstones order by id limit 4`)).map((r) => r.reason)).toEqual(before.map((r) => r.reason))
    const checks = await reasonChecks()
    expect(checks).toHaveLength(1)
    expect(checks[0].def).toContain("'archived'")
  })

  it('can be re-run, still leaving exactly one reason constraint', async () => {
    await applyMigrationFile(client, M042)
    expect(await reasonChecks()).toHaveLength(1)
  })

  it('refuses to run without migration 040', async () => {
    await client.query('alter table public.api_tombstones rename to api_tombstones_x')
    const e = await errOf(() => client.query(readFileSync(M042, 'utf8')))
    expect(String(e?.message)).toMatch(/apply 040 first/)
    await client.query('alter table public.api_tombstones_x rename to api_tombstones')
  })
})

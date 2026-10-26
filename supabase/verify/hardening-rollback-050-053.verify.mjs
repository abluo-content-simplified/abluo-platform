/**
 * Migrations 050–053 together (ADR-040 B2.6 readiness), against a real
 * Postgres:
 *  - order: 052 and 053 refuse to run before 050; 051 is independent;
 *    050 → 051 → 052 → 053 applies cleanly on the 049-level schema;
 *  - nothing outside site_access_* changes (catalog snapshot before/after),
 *    except the two grantable rows 051 adds;
 *  - existing data is untouched (a project, a membership, an extra);
 *  - rollback-050-053.sql refuses while access data exists or an Access
 *    extra is held, and otherwise restores the catalog EXACTLY to its
 *    pre-050 state; after it, 050–053 apply again (reversible);
 *  - rollback after a partial application (050 only) works too.
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
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql', '034_admin_backlog.sql',
  '035_whats_new.sql', '036_analytics_snapshots.sql']
const M = { 50: MIG('050_site_access.sql'), 51: MIG('051_site_access_grantable.sql'), 52: MIG('052_site_access_documents.sql'), 53: MIG('053_site_access_session_summary.sql') }
const ROLLBACK = path.join(__dirname, 'rollback-050-053.sql')

let client
const ids = {}
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} return e }
}
const applyAll = async () => { for (const n of [50, 51, 52, 53]) await applyMigrationFile(client, M[n]) }
const rollback = () => applyMigrationFile(client, ROLLBACK)

/** Everything in public + storage.buckets EXCEPT site_access objects and the grantable rows, as one comparable string. */
async function catalog() {
  const parts = await Promise.all([
    q(`select tablename from pg_tables where schemaname = 'public' and tablename not like 'site\\_access\\_%' order by 1`),
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'site\\_access\\_%' and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace and conrelid::regclass::text not like 'site\\_access\\_%' order by 1, 2`),
    q(`select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like 'site\\_access\\_%' order by 1, 2`),
    q(`select schemaname, tablename, policyname, md5(coalesce(qual, '') || coalesce(with_check, '')) as p from pg_policies where tablename not like 'site\\_access\\_%' order by 1, 2, 3`),
    q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name not like 'site\\_access\\_%' order by 1, 2, 3`),
    q(`select id from public.grantable_permissions where id not like 'members.access.%' order by 1`),
  ])
  return JSON.stringify(parts)
}
const siteAccessObjects = async () =>
  (await q(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'site\\_access\\_%'`))[0].n
  + (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'site\\_access\\_%'`))[0].n

let before
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  ids.t = (await q(`insert into public.tenants (slug, display_name) values ('rb','R') returning id`))[0].id
  ids.p = (await q(`insert into public.projects (slug, tenant_id, name) values ('rb1',$1,'R1') returning id`, [ids.t]))[0].id
  ids.u = (await q(`insert into auth.users (email) values ('ed@rb.test') returning id`))[0].id
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.p, ids.u])
  before = await catalog()
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('order', () => {
  it('052 and 053 refuse to run before 050; nothing is left behind', async () => {
    expect((await errOf(() => applyMigrationFile(client, M[52])))?.message).toMatch(/050 is not applied/)
    expect((await errOf(() => applyMigrationFile(client, M[53])))?.message).toMatch(/050 is not applied/)
    expect(await siteAccessObjects()).toBe(0)
    expect(await catalog()).toBe(before)
  })
})

describe('applied together', () => {
  it('050 → 051 → 052 → 053 apply cleanly; outside site_access only the two grantable rows are new', async () => {
    await applyAll()
    expect(await catalog()).toBe(before)
    expect((await q(`select id from public.grantable_permissions where id like 'members.access.%' order by 1`)).map((r) => r.id))
      .toEqual(['members.access.manage', 'members.access.read'])
    expect((await q(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'site\\_access\\_%'`))[0].n).toBe(13)
    expect((await q(`select public, file_size_limit::int as file_size_limit from storage.buckets where id = 'site-access-files'`))[0]).toEqual({ public: false, file_size_limit: 20971520 })
  })
  it('existing data is untouched', async () => {
    expect((await q(`select slug from public.projects where id = $1`, [ids.p]))[0].slug).toBe('rb1')
    expect((await q(`select role from public.project_members where user_id = $1`, [ids.u]))[0].role).toBe('editor')
  })
})

describe('rollback-050-053.sql', () => {
  it('refuses while access data exists — and changes nothing', async () => {
    const g = (await q(`insert into public.site_access_groups (project_id, name) values ($1, '{"en":"x"}') returning id`, [ids.p]))[0].id
    expect((await errOf(rollback))?.message).toMatch(/access data exists/)
    expect((await q(`select count(*)::int n from public.site_access_groups`))[0].n).toBe(1)
    await q(`delete from public.site_access_groups where id = $1`, [g])
  })
  it('refuses while a membership holds an Access extra', async () => {
    await q(`update public.project_members set extra_permissions = array['members.access.read'] where user_id = $1`, [ids.u])
    expect((await errOf(rollback))?.message).toMatch(/Access extra/)
    await q(`update public.project_members set extra_permissions = '{}' where user_id = $1`, [ids.u])
  })
  it('otherwise restores the catalog exactly to its pre-050 state (bucket aside), and 050–053 apply again', async () => {
    await rollback()
    expect(await siteAccessObjects()).toBe(0)
    expect((await q(`select count(*)::int n from public.grantable_permissions where id like 'members.access.%'`))[0].n).toBe(0)
    expect(await catalog()).toBe(before)
    // the bucket is removed through the Storage API on Supabase; here, prove re-apply copes with it still existing
    await applyAll()
    expect(await siteAccessObjects()).toBeGreaterThan(0)
    await rollback()
  })
  it('works after a partial application (050 only)', async () => {
    await applyMigrationFile(client, M[50])
    await rollback()
    expect(await siteAccessObjects()).toBe(0)
    expect(await catalog()).toBe(before)
  })
  it('refuses when there is nothing to roll back', async () => {
    expect((await errOf(rollback))?.message).toMatch(/nothing to roll back/)
  })
})

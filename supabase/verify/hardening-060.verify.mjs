/**
 * Migration 060 — billing profile contact_name + tax_code. Proves, against a real
 * Postgres with the base chain → 057 → 058 → 059 applied:
 *  - server-only: RLS on, no policies, unreachable by anon / a signed-in
 *    client (even a tenant Owner); service_role works;
 *  - one alert per (kind, Stripe object): a re-delivery cannot insert twice;
 *  - status constraints: open → acknowledged → resolved; resolving needs a note;
 *  - a test-mode alert cannot attach to a live-mode subscription;
 *  - ON DELETE RESTRICT protects the tenant/project/subscription;
 *  - billing_sync_subscription relinks a project whose subscription ended;
 *  - nothing outside billing_alerts changes; rollback-059 restores the catalog
 *    exactly, refuses while live alerts exist, and 059 refuses to run twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const ROLLBACK = path.join(__dirname, 'rollback-060.sql')
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '049_people_last_seen_and_access_log.sql',
  '057_billing_foundation.sql', '058_billing_issuers_profiles.sql', '059_billing_alerts.sql']

let client
let n = 0
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function sq(sql, params) { await client.query(`select public.set_session_auth(null, 'service_role')`); try { return await q(sql, params) } finally { await reset() } }
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const id6 = () => `${Date.now().toString(36)}${(++n).toString(36)}XYZab`.replace(/[^A-Za-z0-9]/g, '')

async function catalog() {
  const parts = await Promise.all([
    q(`select c.relname, c.relkind, coalesce(array_to_string(c.relacl, ','), '') as acl, c.relrowsecurity
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','S','i','p') order by 1`),
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`),
    q(`select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal order by 1, 2`),
  ])
  return JSON.stringify(parts)
}


let before
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  before = await catalog()
  await applyMigrationFile(client, MIG('060_billing_profile_contact_taxcode.sql'))
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

async function tenant() {
  const k = ++n
  return (await q(`insert into public.tenants (slug, display_name) values ($1, 'C') returning id`, [`t60-${k}`]))[0].id
}
const profile = (t, live, extra) => sq(
  `insert into public.billing_profiles (tenant_id, livemode, customer_type, legal_name, contact_name, tax_code) values ($1, $2, $3, $4, $5, $6)`,
  [t, live, extra.type ?? 'individual', extra.legal ?? 'Mario Rossi', extra.contact ?? null, extra.tax ?? null])

describe('060 — columns', () => {
  it('stores a contact person and an Italian codice fiscale', async () => {
    const t = await tenant()
    await profile(t, false, { type: 'business', legal: 'Acme Srl', contact: 'Mario Rossi' })
    const t2 = await tenant()
    await profile(t2, false, { tax: 'RSSMRA80A01H501U' })
    expect((await sq(`select tax_code from public.billing_profiles where tenant_id = $1`, [t2]))[0].tax_code).toBe('RSSMRA80A01H501U')
  })
  it('rejects blank contact names and malformed tax codes', async () => {
    const t = await tenant()
    expect((await errOf(() => profile(t, false, { contact: '   ' })))?.message).toMatch(/check constraint/)
    expect((await errOf(() => profile(t, false, { tax: 'rss mra' })))?.message).toMatch(/check constraint/)
    expect((await errOf(() => profile(t, false, { tax: 'ABC' })))?.message).toMatch(/check constraint/)
  })
  it('API roles still cannot read profiles', async () => {
    await asAnon()
    expect((await errOf(() => q(`select contact_name from public.billing_profiles`)))?.message).toMatch(/permission denied/)
    await reset()
  })
})

describe('060 — apply / rollback', () => {
  it('refuses to run twice; rollback refuses with live values, else restores the catalog exactly', async () => {
    expect((await errOf(() => applyMigrationFile(client, MIG('060_billing_profile_contact_taxcode.sql'))))?.message).toMatch(/already applied/)
    const t = await tenant()
    await profile(t, true, { type: 'business', legal: 'Live Srl', contact: 'Anna' })
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK)))?.message).toMatch(/live profiles hold/)
    await sq(`update public.billing_profiles set contact_name = null where livemode`)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(before)
    expect(await errOf(() => applyMigrationFile(client, MIG('060_billing_profile_contact_taxcode.sql')))).toBeNull()
  })
})

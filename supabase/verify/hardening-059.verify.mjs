/**
 * Migration 059 — billing risk alerts (ADR-041 D15). Proves, against a real
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
const ROLLBACK = path.join(__dirname, 'rollback-059.sql')
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '049_people_last_seen_and_access_log.sql',
  '057_billing_foundation.sql', '058_billing_issuers_profiles.sql']

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

async function world() {
  const k = ++n
  const t = (await q(`insert into public.tenants (slug, display_name) values ($1, 'C') returning id`, [`t59-${k}`]))[0].id
  const p = (await q(`insert into public.projects (slug, tenant_id, name) values ($1, $2, 'P') returning id`, [`t59-${k}-p`, t]))[0].id
  const owner = (await q(`insert into auth.users (email) values ($1) returning id`, [`o-${k}@t59.test`]))[0].id
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`, [t, owner])
  const iss = (await q(`select id from public.billing_issuers where key = 'tmz-de'`))[0]?.id
    ?? (await sq(`insert into public.billing_issuers (key, legal_name, country, vat_id, status, active_from)
                  values ('tmz-de', 'TMZ (test)', 'DE', 'DE123456789', 'active', current_date) returning id`))[0].id
  const out = { t, p, owner, subs: {} }
  for (const live of [true, false]) {
    await sq(`insert into public.billing_customers (tenant_id, issuer_id, livemode, stripe_customer_id) values ($1, $2, $3, $4)`, [t, iss, live, `cus_${id6()}`])
    out.subs[live] = (await sq(`select public.billing_sync_subscription($1::jsonb) as id`,
      [JSON.stringify({ tenant_id: t, issuer_id: iss, livemode: live, stripe_subscription_id: `sub_${id6()}`, status: 'active' })]))[0].id
  }
  return out
}
const alert = (w, live, extra = {}) => sq(
  `insert into public.billing_alerts (livemode, kind, stripe_object_id, tenant_id, project_id, subscription_id, amount_cents, currency)
   values ($1, $2, $3, $4, $5, $6, 1000, 'eur') returning id`,
  [live, extra.kind ?? 'dispute', extra.object ?? `du_${id6()}`, w.t, 'project' in extra ? extra.project : w.p, 'sub' in extra ? extra.sub : w.subs[live]])

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

let before059
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  before059 = await catalog()
  await applyMigrationFile(client, MIG('059_billing_alerts.sql'))
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('059 — server-only', () => {
  it('RLS on, no policies', async () => {
    expect((await q(`select relrowsecurity from pg_class where oid = 'public.billing_alerts'::regclass`))[0].relrowsecurity).toBe(true)
    expect((await q(`select count(*)::int as c from pg_policies where schemaname = 'public' and tablename = 'billing_alerts'`))[0].c).toBe(0)
  })
  it('anon and a signed-in tenant Owner cannot read or write; service_role can', async () => {
    const w = await world()
    await alert(w, false)
    for (const who of ['anon', 'owner']) {
      const as = () => (who === 'anon' ? asAnon() : asUser(w.owner))
      for (const sql of [`select * from public.billing_alerts`, `update public.billing_alerts set status = 'resolved'`, `delete from public.billing_alerts`,
        `insert into public.billing_alerts (livemode, kind, stripe_object_id, tenant_id) values (false, 'dispute', 'du_x0000001', '${w.t}')`]) {
        await as()
        expect((await errOf(() => q(sql)))?.message).toMatch(/permission denied/)
      }
      await reset()
    }
    expect((await sq(`select count(*)::int as c from public.billing_alerts`))[0].c).toBeGreaterThan(0)
  })
})

describe('059 — constraints', () => {
  it('one alert per (kind, Stripe object); the same id under another kind is a different alert', async () => {
    const w = await world()
    await alert(w, false, { object: 'du_same0001' })
    expect((await errOf(() => alert(w, false, { object: 'du_same0001' })))?.message).toMatch(/duplicate key/)
    // the webhook's idempotent insert
    const r = await sq(`insert into public.billing_alerts (livemode, kind, stripe_object_id, tenant_id) values (false, 'dispute', 'du_same0001', $1)
                        on conflict (kind, stripe_object_id) do nothing returning id`, [w.t])
    expect(r).toHaveLength(0)
    await alert(w, false, { kind: 'refund', object: 'du_same0001' })
  })
  it('kind and status are restricted', async () => {
    const w = await world()
    expect((await errOf(() => alert(w, false, { kind: 'chargeback' })))?.message).toMatch(/check constraint/)
    const [{ id }] = await alert(w, false)
    expect((await errOf(() => sq(`update public.billing_alerts set status = 'closed' where id = $1`, [id])))?.message).toMatch(/check constraint/)
  })
  it('open → acknowledged → resolved; resolving needs a real note', async () => {
    const w = await world()
    const [{ id }] = await alert(w, false)
    expect((await errOf(() => sq(`update public.billing_alerts set status = 'acknowledged' where id = $1`, [id])))?.message).toMatch(/check constraint/)
    await sq(`update public.billing_alerts set status = 'acknowledged', acknowledged_at = now() where id = $1`, [id])
    expect((await errOf(() => sq(`update public.billing_alerts set status = 'resolved', resolved_at = now() where id = $1`, [id])))?.message).toMatch(/check constraint/)
    expect((await errOf(() => sq(`update public.billing_alerts set status = 'resolved', resolved_at = now(), resolution_note = '   ' where id = $1`, [id])))?.message).toMatch(/check constraint/)
    await sq(`update public.billing_alerts set status = 'resolved', resolved_at = now(), resolution_note = 'Won the dispute' where id = $1`, [id])
    expect((await sq(`select status from public.billing_alerts where id = $1`, [id]))[0].status).toBe('resolved')
    // an open alert cannot carry resolution data
    const [{ id: id2 }] = await alert(w, false)
    expect((await errOf(() => sq(`update public.billing_alerts set resolved_at = now() where id = $1`, [id2])))?.message).toMatch(/check constraint/)
  })
  it('a test-mode alert cannot attach to a live-mode subscription (composite FK)', async () => {
    const w = await world()
    expect((await errOf(() => alert(w, false, { sub: w.subs[true] })))?.message).toMatch(/foreign key/)
    await alert(w, true) // live ↔ live is fine
    await alert(w, false, { sub: null, project: null }) // unresolved subscription/project is allowed
  })
  it('ON DELETE RESTRICT: a tenant, project or subscription with alerts cannot be deleted', async () => {
    const w = await world()
    await alert(w, false)
    expect((await errOf(() => q(`delete from public.projects where id = $1`, [w.p])))?.message).toMatch(/foreign key/)
    expect((await errOf(() => q(`delete from public.tenants where id = $1`, [w.t])))?.message).toMatch(/foreign key/)
    expect((await errOf(() => sq(`delete from public.billing_subscriptions where id = $1`, [w.subs[false]])))?.message).toMatch(/foreign key/)
  })
  it('updated_at moves on update', async () => {
    const w = await world()
    const [{ id }] = await alert(w, false)
    const a = (await sq(`select updated_at from public.billing_alerts where id = $1`, [id]))[0].updated_at
    await new Promise((r) => setTimeout(r, 15))
    await sq(`update public.billing_alerts set status = 'acknowledged', acknowledged_at = now() where id = $1`, [id])
    expect((await sq(`select updated_at from public.billing_alerts where id = $1`, [id]))[0].updated_at.getTime()).toBeGreaterThan(a.getTime())
  })
})

describe('059 — re-subscribe relink', () => {
  async function setup() {
    const w = await world()
    const iss = (await q(`select id from public.billing_issuers where key = 'tmz-de'`))[0].id
    await sq(`insert into public.project_billing (project_id, livemode, arrangement, amount_cents, billing_interval, activation_due_at)
              values ($1, false, 'stripe', 1000, 'month', now())`, [w.p])
    const sync = (sub, status, project = w.p) => sq(`select public.billing_sync_subscription($1::jsonb) as id`,
      [JSON.stringify({ tenant_id: w.t, issuer_id: iss, livemode: false, stripe_subscription_id: sub, status, project_id: project })])
    const linked = async () => (await sq(`select billing_subscription_id as id from public.project_billing where project_id = $1 and not livemode`, [w.p]))[0].id
    return { w, sync, linked }
  }
  it('a project whose subscription ended takes the new one', async () => {
    const { sync, linked } = await setup()
    const a = `sub_${id6()}`, b = `sub_${id6()}`
    const [{ id: idA }] = await sync(a, 'active')
    expect(await linked()).toBe(idA)
    await sync(a, 'canceled')
    const [{ id: idB }] = await sync(b, 'incomplete')
    expect(await linked()).toBe(idB)
  })
  it('still refuses while the linked subscription is live, and an ended one never takes over', async () => {
    const { sync, linked } = await setup()
    const a = `sub_${id6()}`, b = `sub_${id6()}`, c = `sub_${id6()}`
    const [{ id: idA }] = await sync(a, 'past_due')
    expect((await errOf(() => sync(b, 'active')))?.message).toMatch(/project_not_linkable/)
    expect(await linked()).toBe(idA)
    await sync(a, 'canceled')
    expect((await errOf(() => sync(c, 'canceled')))?.message).toMatch(/project_not_linkable/)
    expect(await linked()).toBe(idA)
  })
})

describe('059 — apply / rollback', () => {
  it('refuses to run twice; changes nothing outside billing_alerts', async () => {
    expect((await errOf(() => applyMigrationFile(client, MIG('059_billing_alerts.sql'))))?.message).toMatch(/already applied/)
    await q(`delete from public.billing_alerts where livemode`)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(before059)
    await applyMigrationFile(client, MIG('059_billing_alerts.sql'))
  })
  it('rollback refuses while live alerts exist, drops test-only data, and 059 applies again', async () => {
    const w = await world()
    await alert(w, true)
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK)))?.message).toMatch(/live billing alerts exist/)
    expect((await q(`select to_regclass('public.billing_alerts') is not null as ok`))[0].ok).toBe(true)
    await q(`delete from public.billing_alerts where livemode`)
    await alert(w, false)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(before059)
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK)))?.message).toMatch(/059 is not applied/)
    expect((await errOf(() => applyMigrationFile(client, MIG('059_billing_alerts.sql'))))).toBeNull()
  })
})

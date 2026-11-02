/**
 * Migrations 057 + 058 — subscription billing foundation (ADR-041). Proves,
 * against a real Postgres with the base chain → 057 → 058 applied:
 *  - server-only: RLS on, no policies, no table or function reachable by anon
 *    or a signed-in client (even a tenant Owner);
 *  - test/live isolation: the same project holds independent test and live
 *    records; a test object can never attach to a live one (composite FKs);
 *  - tenant isolation: a project can only point at its own tenant's
 *    subscription; bundles within one tenant are possible;
 *  - agreement constraints (stripe needs price + due date, override needs a reason …);
 *  - one open Checkout session per project and mode; session id ↔ mode;
 *  - the 30-day first-payment window (longer only with a recorded reason);
 *  - a voided / uncollectible invoice settles its failure;
 *  - webhook idempotency (claim/finish/retry);
 *  - order-independent invoice recording (paid/failed in any order, unpaid
 *    recovery, earliest failure wins, first payment never un-set);
 *  - concurrent syncs of one subscription serialise (row lock);
 *  - ON DELETE RESTRICT protects billed projects/clients;
 *  - nothing outside the billing objects changes; rollback restores the
 *    catalog exactly, refuses with live data, and 057 applies again; 057
 *    refuses to run twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import path from 'node:path'
import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const M057 = path.join(__dirname, '..', 'migrations', '057_billing_foundation.sql')
const M058 = path.join(__dirname, '..', 'migrations', '058_billing_issuers_profiles.sql')
const ROLLBACK = path.join(__dirname, 'rollback-057.sql')
const ROLLBACK58 = path.join(__dirname, 'rollback-058.sql')
// Same production-faithful chain as hardening-056 (grants hardened by 028 …).
const CHAIN = ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
  '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
  '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
  '028_security_hardening.sql', '029_roles_extras_invitations.sql', '030_contact_requests_by_permission.sql',
  '031_project_member_archive.sql', '049_people_last_seen_and_access_log.sql']
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const TABLES = ['billing_issuers', 'billing_profiles', 'billing_customers', 'billing_subscriptions', 'project_billing', 'billing_checkout_sessions', 'stripe_webhook_events']
const FUNCS = [
  'stripe_event_claim(text, boolean, text, text, timestamptz)',
  'stripe_event_finish(text, text, text)',
  'billing_sync_subscription(jsonb)',
  'billing_record_invoice(text, boolean, text, text, timestamptz)',
]

let client, connectionString
let n = 0
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asService() { await client.query(`select public.set_session_auth(null, 'service_role')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
/** Run as service_role (what the app uses). */
async function sq(sql, params) { await asService(); try { return await q(sql, params) } finally { await reset() } }
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const id6 = () => `${Date.now().toString(36)}${(++n).toString(36)}XYZab`.replace(/[^A-Za-z0-9]/g, '')
const one = async (sql, p) => (await q(sql, p))[0].id

async function tenant(projects = 2) {
  const k = ++n
  const t = await one(`insert into public.tenants (slug, display_name) values ($1, 'C') returning id`, [`t57-${k}`])
  const ps = []
  for (let i = 0; i < projects; i++) {
    ps.push(await one(`insert into public.projects (slug, tenant_id, name) values ($1, $2, 'P') returning id`, [`t57-${k}-${i}`, t]))
  }
  const owner = await one(`insert into auth.users (email) values ($1) returning id`, [`o-${k}@t57.test`])
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1, $2, 'owner')`, [t, owner])
  return { t, ps, owner }
}
let ISSUER = null
async function issuer() {
  if (!ISSUER) {
    const r = await sq(`insert into public.billing_issuers (key, legal_name, country, vat_id, status, active_from)
                        values ('tmz-de', 'TMZ (test)', 'DE', 'DE123456789', 'active', current_date) returning id`)
    ISSUER = r[0].id
  }
  return ISSUER
}
const customer = async (t, live, iss = null) => sq(
  `insert into public.billing_customers (tenant_id, issuer_id, livemode, stripe_customer_id) values ($1, $2, $3, $4)`, [t, iss ?? await issuer(), live, `cus_${id6()}`])
const agreement = (p, live, extra = {}) => sq(
  `insert into public.project_billing (project_id, livemode, arrangement, amount_cents, billing_interval, activation_due_at)
   values ($1, $2, $3, $4, $5, $6)`,
  [p, live, extra.arrangement ?? 'stripe', 'amount' in extra ? extra.amount : 24000,
   'interval' in extra ? extra.interval : 'year', 'due' in extra ? extra.due : new Date().toISOString()])
const sync = async (snap) => sq(`select public.billing_sync_subscription($1::jsonb) as id`, [JSON.stringify({ issuer_id: await issuer(), ...snap })]).then((r) => r[0].id)
const sub = async (t, live, extra = {}) => {
  const sid = extra.sid ?? `sub_${id6()}`
  const id = await sync({ tenant_id: t, livemode: live, stripe_subscription_id: sid, status: extra.status ?? 'active', project_id: extra.project ?? null })
  return { id, sid }
}
const record = (sid, live, inv, outcome, at) =>
  sq(`select public.billing_record_invoice($1, $2, $3, $4, $5)`, [sid, live, inv, outcome, at])
const subRow = async (sid) => (await sq(`select * from public.billing_subscriptions where stripe_subscription_id = $1`, [sid]))[0]

async function catalog({ excludeBilling }) {
  const notBilling = excludeBilling
    ? `and c.relname not in (${TABLES.map((t) => `'${t}'`).join(',')})` : ''
  const parts = await Promise.all([
    q(`select c.relname, c.relkind, coalesce(array_to_string(c.relacl, ','), '') as acl, c.relrowsecurity
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','S','i','p') ${notBilling}
         ${excludeBilling ? "and c.relname not like 'billing\\_%' and c.relname not like 'project\\_billing%' and c.relname not like 'stripe\\_%'" : ''}
         order by 1`),
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body,
              coalesce(array_to_string(p.proacl, ','), '') as acl
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
         ${excludeBilling ? "and p.proname not like 'billing\\_%' and p.proname not like 'stripe\\_%' and p.proname not like 'project\\_billing\\_%'" : ''}
         order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace
         ${excludeBilling ? `and conrelid::regclass::text not in (${TABLES.map((t) => `'public.${t}','${t}'`).join(',')})` : ''}
         order by 1, 2`),
    q(`select tablename, policyname, md5(coalesce(qual,'') || coalesce(with_check,'')) as d from pg_policies where schemaname = 'public' order by 1, 2`),
    q(`select tgrelid::regclass::text as t, tgname from pg_trigger where not tgisinternal
         and tgrelid::regclass::text not in (${TABLES.map((t) => `'public.${t}','${t}'`).join(',')}) order by 1, 2`),
  ])
  return JSON.stringify(parts)
}

let before, after057
beforeAll(async () => {
  ;({ client, connectionString } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  before = await catalog({ excludeBilling: false })
  await applyMigrationFile(client, M057)
  after057 = await catalog({ excludeBilling: false })
  await applyMigrationFile(client, M058)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('057 — server-only', () => {
  it('RLS on and no policies on every billing table', async () => {
    for (const t of TABLES) {
      expect((await q(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].relrowsecurity).toBe(true)
      expect((await q(`select count(*)::int as c from pg_policies where schemaname = 'public' and tablename = $1`, [t]))[0].c).toBe(0)
    }
  })
  it('anon and a signed-in tenant Owner can neither read nor write any billing table', async () => {
    const c = await tenant()
    await customer(c.t, true)
    for (const as of [() => asAnon(), () => asUser(c.owner)]) {
      for (const t of TABLES) {
        await as()
        expect((await errOf(() => q(`select * from public.${t} limit 1`)))?.message).toMatch(/permission denied/)
        await as()
        expect((await errOf(() => q(`delete from public.${t}`)))?.message).toMatch(/permission denied/)
      }
      await as()
      expect((await errOf(() => q(`update public.billing_profiles set billing_email = 'x@y.z'`)))?.message).toMatch(/permission denied/)
      await as()
      expect((await errOf(() => q(`insert into public.project_billing (project_id, livemode, arrangement) values ($1, true, 'complimentary')`, [c.ps[0]])))?.message).toMatch(/permission denied/)
      await reset()
    }
  })
  it('anon and authenticated cannot execute any billing function; service_role can', async () => {
    for (const f of FUNCS) {
      for (const role of ['anon', 'authenticated']) {
        expect((await q(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, `public.${f}`]))[0].ok).toBe(false)
      }
      expect((await q(`select has_function_privilege('service_role', $1, 'EXECUTE') as ok`, [`public.${f}`]))[0].ok).toBe(true)
    }
  })
})

describe('057 — test vs live isolation for the same project', () => {
  it('one project holds a test and a live agreement independently', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], false, { amount: 100 })
    await agreement(c.ps[0], true, { amount: 24000 })
    const rows = await sq(`select livemode, amount_cents from public.project_billing where project_id = $1 order by livemode`, [c.ps[0]])
    expect(rows).toEqual([{ livemode: false, amount_cents: 100 }, { livemode: true, amount_cents: 24000 }])
    // a second record for the same project+mode is refused
    expect((await errOf(() => agreement(c.ps[0], true)))?.message).toMatch(/duplicate key/)
  })
  it('a test subscription cannot be created under a live-only customer, and vice versa', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    expect((await errOf(() => sub(c.t, false)))?.message).toMatch(/foreign key/)
    await customer(c.t, false)
    await sub(c.t, false) // now fine
  })
  it('a test subscription can never be linked to a live agreement (and the reverse)', async () => {
    const c = await tenant(1)
    await customer(c.t, true); await customer(c.t, false)
    await agreement(c.ps[0], true)
    const test = await sub(c.t, false)
    // via the sync function: no test agreement exists → refused
    expect((await errOf(() => sync({ tenant_id: c.t, livemode: false, stripe_subscription_id: test.sid, status: 'active', project_id: c.ps[0] })))?.message)
      .toMatch(/billing:project_not_linkable/)
    // directly: composite FK (subscription id, livemode) refuses
    expect((await errOf(() => sq(`update public.project_billing set billing_subscription_id = $1 where project_id = $2 and livemode`, [test.id, c.ps[0]])))
      ?.message).toMatch(/foreign key/)
    const live = await sub(c.t, true, { project: c.ps[0] })
    const linked = await sq(`select billing_subscription_id from public.project_billing where project_id = $1 and livemode`, [c.ps[0]])
    expect(linked[0].billing_subscription_id).toBe(live.id)
  })
  it('a subscription can never change mode or tenant', async () => {
    const c = await tenant(1)
    await customer(c.t, true); await customer(c.t, false)
    const s = await sub(c.t, true)
    expect((await errOf(() => sq(`update public.billing_subscriptions set livemode = false where id = $1`, [s.id])))?.message).toMatch(/billing:immutable|foreign key/)
    const other = await tenant(1)
    await customer(other.t, true)
    expect((await errOf(() => sq(`update public.billing_subscriptions set tenant_id = $1 where id = $2`, [other.t, s.id])))?.message).toMatch(/billing:immutable/)
  })
  it('a checkout session id must match its row mode', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], false)
    const ins = (sid, live) => sq(`insert into public.billing_checkout_sessions (stripe_session_id, project_id, livemode, terms_version, expires_at)
                                   values ($1, $2, $3, 1, now() + interval '1 hour')`, [sid, c.ps[0], live])
    expect((await errOf(() => ins(`cs_live_${id6()}`, false)))?.message).toMatch(/check constraint/)
    await ins(`cs_test_${id6()}`, false)
  })
})

describe('057 — tenant isolation and bundles', () => {
  it('a project cannot point at another tenant\'s subscription', async () => {
    const a = await tenant(1); const b = await tenant(1)
    await customer(a.t, true); await customer(b.t, true)
    await agreement(a.ps[0], true)
    const sb = await sub(b.t, true)
    expect((await errOf(() => sync({ tenant_id: b.t, livemode: true, stripe_subscription_id: sb.sid, status: 'active', project_id: a.ps[0] })))
      ?.message).toMatch(/billing:tenant_mismatch/)
    expect((await errOf(() => sq(`update public.project_billing set billing_subscription_id = $1 where project_id = $2`, [sb.id, a.ps[0]])))
      ?.message).toMatch(/billing:tenant_mismatch/)
  })
  it('two projects of one tenant may share a subscription (future bundles); a linked project is not silently re-linked', async () => {
    const c = await tenant(2)
    await customer(c.t, true)
    await agreement(c.ps[0], true); await agreement(c.ps[1], true)
    const s = await sub(c.t, true, { project: c.ps[0] })
    await sync({ tenant_id: c.t, livemode: true, stripe_subscription_id: s.sid, status: 'active', project_id: c.ps[1] })
    const n2 = await sq(`select count(*)::int as c from public.project_billing where billing_subscription_id = $1`, [s.id])
    expect(n2[0].c).toBe(2)
    const s2 = await sub(c.t, true)
    expect((await errOf(() => sync({ tenant_id: c.t, livemode: true, stripe_subscription_id: s2.sid, status: 'active', project_id: c.ps[0] })))
      ?.message).toMatch(/billing:project_not_linkable/)
  })
  it('a non-stripe agreement cannot be linked to a subscription', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    await agreement(c.ps[0], true, { arrangement: 'complimentary', amount: null, interval: null, due: null })
    const s = await sub(c.t, true)
    expect((await errOf(() => sync({ tenant_id: c.t, livemode: true, stripe_subscription_id: s.sid, status: 'active', project_id: c.ps[0] })))
      ?.message).toMatch(/billing:project_not_linkable/)
  })
})

describe('057 — agreement constraints', () => {
  it('stripe needs amount, interval and a payment due date; manual needs amount; complimentary needs nothing', async () => {
    const c = await tenant(4)
    expect((await errOf(() => agreement(c.ps[0], true, { due: null })))?.message).toMatch(/check constraint/)
    expect((await errOf(() => agreement(c.ps[0], true, { amount: null })))?.message).toMatch(/check constraint/)
    expect((await errOf(() => agreement(c.ps[1], true, { arrangement: 'manual', amount: null, due: null })))?.message).toMatch(/check constraint/)
    await agreement(c.ps[1], true, { arrangement: 'manual', due: null })
    await agreement(c.ps[2], true, { arrangement: 'complimentary', amount: null, interval: null, due: null })
  })
  it('an override needs a reason and a time; clearing it clears the details', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], true)
    const set = (o, reason, at = 'now()') => sq(`update public.project_billing set override = $1, override_reason = $2, override_set_at = ${at} where project_id = $3`, [o, reason, c.ps[0]])
    expect((await errOf(() => set('allow', null)))?.message).toMatch(/check constraint/)
    expect((await errOf(() => set('allow', '   ')))?.message).toMatch(/check constraint/)
    await set('allow', 'Paid by bank transfer, Stripe pending')
    expect((await errOf(() => sq(`update public.project_billing set override = 'none' where project_id = $1`, [c.ps[0]])))?.message).toMatch(/check constraint/)
    await sq(`update public.project_billing set override = 'none', override_reason = null, override_until = null where project_id = $1`, [c.ps[0]])
  })
  it('a client billing profile (contact, legal and VAT details) exists before any Stripe customer, one per client and mode', async () => {
    const c = await tenant(1)
    await sq(`insert into public.billing_profiles (tenant_id, livemode, billing_email, customer_type, legal_name, country, vat_id)
              values ($1, true, 'amministrazione@example.it', 'business', 'Studio Esempio S.r.l.', 'IT', 'IT12345678901')`, [c.t])
    expect((await errOf(() => sq(`insert into public.billing_profiles (tenant_id, livemode, billing_email) values ($1, true, 'x@example.it')`, [c.t])))?.message).toMatch(/duplicate key/)
    expect((await errOf(() => sq(`update public.billing_profiles set billing_email = 'not-an-email' where tenant_id = $1`, [c.t])))?.message).toMatch(/check constraint/)
    expect((await errOf(() => sq(`update public.billing_profiles set legal_name = null where tenant_id = $1`, [c.t])))?.message).toMatch(/check constraint/) // a business needs its legal name
    expect((await errOf(() => sq(`update public.billing_profiles set vat_verification = 'verified' where tenant_id = $1`, [c.t])))?.message).toMatch(/check constraint/) // verified needs a time
    await sq(`update public.billing_profiles set vat_verification = 'verified', vat_verified_at = now() where tenant_id = $1`, [c.t])
    expect((await errOf(() => sq(`update public.billing_profiles set vat_id = null where tenant_id = $1`, [c.t])))?.message).toMatch(/check constraint/) // no status without a number
  })
  it('Stripe ids are validated', async () => {
    const c = await tenant(1)
    expect((await errOf(async () => sq(`insert into public.billing_customers (tenant_id, issuer_id, livemode, stripe_customer_id) values ($1, $2, true, 'acct_123456')`, [c.t, await issuer()])))
      ?.message).toMatch(/check constraint/)
  })
})

describe('057 — checkout sessions', () => {
  it('at most one open session per project and mode; an expired one frees the slot', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], true); await agreement(c.ps[0], false)
    const ins = (sid, live) => sq(`insert into public.billing_checkout_sessions (stripe_session_id, project_id, livemode, terms_version, expires_at)
                                   values ($1, $2, $3, 1, now() + interval '24 hours')`, [sid, c.ps[0], live])
    const first = `cs_live_${id6()}`
    await ins(first, true)
    await ins(`cs_test_${id6()}`, false) // other mode: independent
    expect((await errOf(() => ins(`cs_live_${id6()}`, true)))?.message).toMatch(/duplicate key/)
    await sq(`update public.billing_checkout_sessions set status = 'expired' where stripe_session_id = $1`, [first])
    await ins(`cs_live_${id6()}`, true)
  })
  it('a session needs an agreement in the same mode', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], false)
    expect((await errOf(() => sq(`insert into public.billing_checkout_sessions (stripe_session_id, project_id, livemode, terms_version, expires_at)
                                   values ($1, $2, true, 1, now() + interval '1 hour')`, [`cs_live_${id6()}`, c.ps[0]])))?.message).toMatch(/foreign key/)
  })
})

describe('057 — webhook idempotency', () => {
  it('claim → finish(processed) → duplicate delivery is not processed again', async () => {
    const ev = `evt_${id6()}`
    const claim = () => sq(`select public.stripe_event_claim($1, true, 'invoice.paid', 'in_abcdef1', now()) as ok`, [ev]).then((r) => r[0].ok)
    expect(await claim()).toBe(true)
    await sq(`select public.stripe_event_finish($1, 'processed')`, [ev])
    expect(await claim()).toBe(false)
    const row = (await sq(`select status, attempts, processed_at is not null as done from public.stripe_webhook_events where event_id = $1`, [ev]))[0]
    expect(row).toEqual({ status: 'processed', attempts: 2, done: true })
  })
  it('a failed event is claimable again (Stripe retry) and keeps its error until it succeeds', async () => {
    const ev = `evt_${id6()}`
    const claim = () => sq(`select public.stripe_event_claim($1, false, 'customer.subscription.updated', null, now()) as ok`, [ev]).then((r) => r[0].ok)
    expect(await claim()).toBe(true)
    await sq(`select public.stripe_event_finish($1, 'failed', 'stripe timeout')`, [ev])
    expect((await sq(`select last_error from public.stripe_webhook_events where event_id = $1`, [ev]))[0].last_error).toBe('stripe timeout')
    expect(await claim()).toBe(true)
    await sq(`select public.stripe_event_finish($1, 'ignored')`, [ev])
    expect(await claim()).toBe(false)
  })
  it('finishing an unknown event or with a bad status is refused', async () => {
    expect((await errOf(() => sq(`select public.stripe_event_finish('evt_nope000', 'processed')`)))?.message).toMatch(/billing:event_not_found/)
    expect((await errOf(() => sq(`select public.stripe_event_finish('evt_nope000', 'done')`)))?.message).toMatch(/billing:invalid_status/)
  })
})

describe('057 — invoice outcomes are order-independent', () => {
  async function fresh() {
    const c = await tenant(1)
    await customer(c.t, true)
    await agreement(c.ps[0], true)
    return sub(c.t, true, { project: c.ps[0], status: 'active' })
  }
  it('first payment: first_paid_at set once, earliest wins, never cleared', async () => {
    const s = await fresh()
    expect((await subRow(s.sid)).first_paid_at).toBeNull()
    await record(s.sid, true, 'in_first01', 'paid', '2026-01-10T10:00:00Z')
    await record(s.sid, true, 'in_renew02', 'paid', '2027-01-10T10:00:00Z')
    await record(s.sid, true, 'in_first01', 'paid', '2026-01-09T10:00:00Z') // late, earlier duplicate
    expect((await subRow(s.sid)).first_paid_at.toISOString()).toBe('2026-01-09T10:00:00.000Z')
  })
  it('failed → paid clears the clock (recovery of past_due AND unpaid)', async () => {
    for (const status of ['past_due', 'unpaid']) {
      const s = await fresh()
      await record(s.sid, true, 'in_aaaaaa1', 'paid', '2026-01-01T00:00:00Z')
      await sync({ tenant_id: (await subRow(s.sid)).tenant_id, livemode: true, stripe_subscription_id: s.sid, status })
      await record(s.sid, true, 'in_bbbbbb2', 'failed', '2027-01-01T00:00:00Z')
      expect((await subRow(s.sid)).payment_failed_at.toISOString()).toBe('2027-01-01T00:00:00.000Z')
      await record(s.sid, true, 'in_bbbbbb2', 'paid', '2027-01-20T00:00:00Z')
      await sync({ tenant_id: (await subRow(s.sid)).tenant_id, livemode: true, stripe_subscription_id: s.sid, status: 'active' })
      const r = await subRow(s.sid)
      expect([r.status, r.payment_failed_at, r.failed_invoice_id]).toEqual(['active', null, null])
    }
  })
  it('a late "failed" for an invoice already paid is ignored', async () => {
    const s = await fresh()
    await record(s.sid, true, 'in_cccccc3', 'paid', '2027-01-05T00:00:00Z')
    await record(s.sid, true, 'in_cccccc3', 'failed', '2027-01-01T00:00:00Z')
    expect((await subRow(s.sid)).payment_failed_at).toBeNull()
  })
  it('repeated failures keep the FIRST failure time (Smart Retries never extend the grace)', async () => {
    const s = await fresh()
    await record(s.sid, true, 'in_dddddd4', 'failed', '2027-01-03T00:00:00Z')
    await record(s.sid, true, 'in_dddddd4', 'failed', '2027-01-08T00:00:00Z')
    await record(s.sid, true, 'in_dddddd4', 'failed', '2027-01-01T00:00:00Z') // earlier attempt delivered late
    expect((await subRow(s.sid)).payment_failed_at.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
  it('paying a DIFFERENT invoice does not clear an older unresolved failure', async () => {
    const s = await fresh()
    await record(s.sid, true, 'in_eeeeee5', 'failed', '2027-01-01T00:00:00Z')
    await record(s.sid, true, 'in_ffffff6', 'paid', '2027-02-01T00:00:00Z')
    expect((await subRow(s.sid)).failed_invoice_id).toBe('in_eeeeee5')
  })
  it('an invoice for an unknown subscription, or in the other mode, is refused', async () => {
    const s = await fresh()
    expect((await errOf(() => record(s.sid, false, 'in_gggggg7', 'paid', '2027-01-01T00:00:00Z')))?.message).toMatch(/billing:subscription_not_found/)
    expect((await errOf(() => record('sub_unknown01', true, 'in_gggggg7', 'paid', '2027-01-01T00:00:00Z')))?.message).toMatch(/billing:subscription_not_found/)
  })
})

describe('057 — concurrency', () => {
  it('two concurrent syncs of one subscription serialise and leave one consistent row', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    await agreement(c.ps[0], true)
    const sid = `sub_${id6()}`
    const mk = async () => { const k = new pg.Client({ connectionString }); await k.connect(); await k.query(`select public.set_session_auth(null, 'service_role')`); return k }
    const [k1, k2] = await Promise.all([mk(), mk()])
    try {
      await k1.query('begin')
      await k1.query(`select public.billing_sync_subscription($1::jsonb)`, [JSON.stringify({ tenant_id: c.t, issuer_id: await issuer(), livemode: true, stripe_subscription_id: sid, status: 'past_due', project_id: c.ps[0] })])
      // k2 must wait on the advisory lock until k1 commits
      const p2 = k2.query(`select public.billing_sync_subscription($1::jsonb)`, [JSON.stringify({ tenant_id: c.t, issuer_id: await issuer(), livemode: true, stripe_subscription_id: sid, status: 'active' })])
      let settled = false; p2.then(() => { settled = true }, () => { settled = true })
      await new Promise((r) => setTimeout(r, 300))
      expect(settled).toBe(false)
      await k1.query('commit')
      await p2
      const rows = await sq(`select status from public.billing_subscriptions where stripe_subscription_id = $1`, [sid])
      expect(rows).toEqual([{ status: 'active' }])
    } finally { await k1.end(); await k2.end() }
  })
})

describe('057 — protects billed clients and projects; touches nothing else', () => {
  it('a project or client with billing records cannot be deleted', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    await agreement(c.ps[0], true)
    expect((await errOf(() => q(`delete from public.projects where id = $1`, [c.ps[0]])))?.message).toMatch(/foreign key/)
    expect((await errOf(() => q(`delete from public.tenants where id = $1`, [c.t])))?.message).toMatch(/foreign key/)
  })
  it('a project WITHOUT billing records deletes exactly as before', async () => {
    const c = await tenant(1)
    await q(`delete from public.tenants where id = $1`, [c.t])
    expect((await q(`select count(*)::int as c from public.projects where tenant_id = $1`, [c.t]))[0].c).toBe(0)
  })
  it('catalog outside the billing objects is unchanged by 057', async () => {
    const after = await catalog({ excludeBilling: true })
    // Rebuild the "before" view with the same exclusions applied: billing objects did not exist then.
    expect(JSON.parse(after)[0]).toEqual(JSON.parse(before)[0].filter((r) => !TABLES.some((t) => r.relname.startsWith(t))))
    expect(JSON.parse(after)[1]).toEqual(JSON.parse(before)[1])
    expect(JSON.parse(after)[2]).toEqual(JSON.parse(before)[2])
    expect(JSON.parse(after)[3]).toEqual(JSON.parse(before)[3])
    expect(JSON.parse(after)[4]).toEqual(JSON.parse(before)[4])
  })
})

describe('057 — first-payment window (30 days, longer only with a reason)', () => {
  const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString()
  it('a due date up to 30 days ahead needs no reason; beyond needs one', async () => {
    const c = await tenant(3)
    await agreement(c.ps[0], true, { due: inDays(29) })
    expect((await errOf(() => agreement(c.ps[1], true, { due: inDays(31) })))?.message).toMatch(/billing:activation_window/)
    await sq(`insert into public.project_billing (project_id, livemode, arrangement, amount_cents, billing_interval, activation_due_at, activation_extension_reason)
              values ($1, true, 'stripe', 24000, 'year', $2, 'Launch in March, agreed with the client')`, [c.ps[1], inDays(90)])
    expect((await errOf(() => sq(`insert into public.project_billing (project_id, livemode, arrangement, amount_cents, billing_interval, activation_due_at, activation_extension_reason)
              values ($1, true, 'stripe', 24000, 'year', $2, '   ')`, [c.ps[2], inDays(90)])))?.message).toMatch(/billing:activation_window/)
  })
  it('moving the due date later is checked again; editing other terms is not', async () => {
    const c = await tenant(1)
    await agreement(c.ps[0], true, { due: inDays(10) })
    expect((await errOf(() => sq(`update public.project_billing set activation_due_at = $1 where project_id = $2`, [inDays(45), c.ps[0]])))?.message)
      .toMatch(/billing:activation_window/)
    await sq(`update public.project_billing set amount_cents = 30000, terms_version = terms_version + 1 where project_id = $1`, [c.ps[0]])
    await sq(`update public.project_billing set activation_due_at = $1, activation_extension_reason = 'Client on holiday' where project_id = $2`, [inDays(45), c.ps[0]])
  })
})

describe('057 — a voided / uncollectible invoice settles a failure', () => {
  it('voided clears the failure for that invoice, never counts as a first payment, and a late failure is ignored', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    await agreement(c.ps[0], true)
    const s = await sub(c.t, true, { project: c.ps[0], status: 'past_due' })
    await record(s.sid, true, 'in_vvvvvv1', 'failed', '2027-03-01T00:00:00Z')
    await record(s.sid, true, 'in_vvvvvv1', 'voided', '2027-03-10T00:00:00Z')
    let r = await subRow(s.sid)
    expect([r.payment_failed_at, r.failed_invoice_id, r.first_paid_at, r.last_settled_invoice_id]).toEqual([null, null, null, 'in_vvvvvv1'])
    await record(s.sid, true, 'in_vvvvvv1', 'failed', '2027-03-02T00:00:00Z')
    r = await subRow(s.sid)
    expect(r.payment_failed_at).toBeNull()
  })
  it('an unknown outcome is refused', async () => {
    expect((await errOf(() => record('sub_x0000001', true, 'in_x000001', 'refunded', '2027-01-01T00:00:00Z')))?.message).toMatch(/billing:invalid_invoice_event/)
  })
})

describe('057 — issuers (the invoicing legal entity can change, history is kept)', () => {
  it('only one active issuer at a time; a retired one stays', async () => {
    await issuer()
    expect((await errOf(() => sq(`insert into public.billing_issuers (key, legal_name, country, status, active_from) values ('tmz-it', 'TMZ Italia', 'IT', 'active', current_date)`)))?.message).toMatch(/duplicate key/)
    await sq(`insert into public.billing_issuers (key, legal_name, country, vat_id) values ('tmz-it', 'TMZ Italia', 'IT', 'IT12345678901')`) // draft
    expect((await errOf(() => sq(`update public.billing_issuers set status = 'retired' where key = 'tmz-it'`)))?.message).toMatch(/check constraint/) // needs retired_on
  })
  it('one client can be a customer of two issuers; each subscription keeps its issuer for ever', async () => {
    const c = await tenant(1)
    const it_ = (await sq(`select id from public.billing_issuers where key = 'tmz-it'`))[0].id
    await customer(c.t, true)
    await customer(c.t, true, it_)
    const old = await sub(c.t, true)
    const neu = `sub_${id6()}`
    await sq(`select public.billing_sync_subscription($1::jsonb)`, [JSON.stringify({ tenant_id: c.t, issuer_id: it_, livemode: true, stripe_subscription_id: neu, status: 'active' })])
    expect((await subRow(neu)).issuer_id).toBe(it_)
    expect((await errOf(() => sq(`update public.billing_subscriptions set issuer_id = $1 where id = $2`, [it_, old.id])))?.message).toMatch(/billing:immutable|foreign key/)
    expect((await errOf(() => sq(`delete from public.billing_issuers where id = $1`, [it_])))?.message).toMatch(/foreign key/)
  })
  it('a subscription under an issuer the client is not a customer of is refused', async () => {
    const c = await tenant(1)
    await customer(c.t, true)
    const it_ = (await sq(`select id from public.billing_issuers where key = 'tmz-it'`))[0].id
    expect((await errOf(() => sq(`select public.billing_sync_subscription($1::jsonb)`, [JSON.stringify({ tenant_id: c.t, issuer_id: it_, livemode: true, stripe_subscription_id: `sub_${id6()}`, status: 'active' })])))?.message).toMatch(/foreign key/)
  })
  it('a snapshot without an issuer is refused', async () => {
    const c = await tenant(1)
    expect((await errOf(() => sq(`select public.billing_sync_subscription($1::jsonb)`, [JSON.stringify({ tenant_id: c.t, livemode: true, stripe_subscription_id: `sub_${id6()}`, status: 'active' })])))?.message).toMatch(/billing:invalid_snapshot/)
  })
})

describe('057 + 058 — apply / rollback', () => {
  it('057 and 058 each refuse to run twice; 058 refuses without 057', async () => {
    expect((await errOf(() => applyMigrationFile(client, M057)))?.message).toMatch(/already applied/)
    expect((await errOf(() => applyMigrationFile(client, M058)))?.message).toMatch(/already applied/)
  })
  it('rollback-058 refuses while billing data exists; rollback-057 refuses while 058 data is live', async () => {
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK58)))?.message).toMatch(/billing data exists/)
    expect((await q(`select to_regclass('public.billing_issuers') is not null as ok`))[0].ok).toBe(true)
  })
  it('with data cleared, rollback-058 restores the exact 057 catalog, rollback-057 the original, and both apply again', async () => {
    for (const t of ['billing_checkout_sessions', 'project_billing', 'billing_subscriptions', 'billing_customers', 'billing_profiles', 'stripe_webhook_events']) {
      await q(`delete from public.${t}`)
    }
    await q(`delete from public.billing_issuers`)
    await applyMigrationFile(client, ROLLBACK58)
    expect(await catalog({ excludeBilling: false })).toBe(after057)
    expect((await errOf(() => applyMigrationFile(client, ROLLBACK58)))?.message).toMatch(/058 is not applied/)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog({ excludeBilling: false })).toBe(before)
    expect((await errOf(() => applyMigrationFile(client, M058)))?.message).toMatch(/057 is not applied/)
    await applyMigrationFile(client, M057)
    await applyMigrationFile(client, M058)
    expect((await q(`select to_regclass('public.billing_issuers') is not null as ok`))[0].ok).toBe(true)
  })
  it('058 refuses to reshape non-empty billing tables', async () => {
    await applyMigrationFile(client, ROLLBACK58)
    const c = await tenant(1)
    await sq(`insert into public.billing_customers (tenant_id, livemode, stripe_customer_id) values ($1, false, 'cus_keepme001')`, [c.t])
    expect((await errOf(() => applyMigrationFile(client, M058)))?.message).toMatch(/not empty/)
    await q(`delete from public.billing_customers`)
    await applyMigrationFile(client, M058)
  })
})

#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Rehearsal of migrations 057 + 058 (billing foundation) — ABLUO SANDBOX ONLY.
//
// Runs the billing functions end to end against the sandbox, inside ONE
// transaction that is always rolled back (no rows are left behind), and checks
// the API roles cannot reach the tables. Refuses to run unless the database in
// .env.sandbox.local is the sandbox (same project ref as its API URL, and not
// the Abluo production project).
//
//   node supabase/verify/rehearse-057.mjs
//
// Needs .env.sandbox.local: SANDBOX_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Secrets never printed.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRODUCTION_REFS = ['xsdamzirepfqlutvqfbe'] // = src/lib/environments/supabase-target.ts
const env = Object.fromEntries(
  readFileSync(resolve(REPO, '.env.sandbox.local'), 'utf8').split('\n')
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
)
const dbRef = decodeURIComponent(new URL(env.SANDBOX_DATABASE_URL).username).split('.')[1] ?? ''
const apiRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]
if (!dbRef || PRODUCTION_REFS.includes(dbRef) || PRODUCTION_REFS.includes(apiRef) || dbRef !== apiRef) {
  console.error('Refusing: .env.sandbox.local does not point at the Abluo Sandbox.')
  process.exit(3)
}
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++ }
const c = new pg.Client({ connectionString: env.SANDBOX_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = (sql, p) => c.query(sql, p)
async function expectError(name, fn, text) {
  await q('savepoint s')
  try { await fn(); check(name, false, 'no error') } catch (e) {
    check(name, String(e.message).includes(text) || e.code === text, `${e.code} ${String(e.message).split('\n')[0]}`)
  }
  await q('rollback to savepoint s')
}
let ISS = null
const sync = (snap) => q(`select public.billing_sync_subscription($1::jsonb) as id`, [JSON.stringify({ issuer_id: ISS, ...snap })]).then((r) => r.rows[0].id)
const rec = (sid, live, inv, outcome, at) => q(`select public.billing_record_invoice($1,$2,$3,$4,$5)`, [sid, live, inv, outcome, at])
const subRow = async (sid) => (await q(`select * from public.billing_subscriptions where stripe_subscription_id = $1`, [sid])).rows[0]

try {
  const tables = (await q(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename = any($1)`,
    [['billing_issuers', 'billing_profiles', 'billing_customers', 'billing_subscriptions', 'project_billing', 'billing_checkout_sessions', 'stripe_webhook_events']])).rows[0].n
  check('7 billing tables exist', tables === 7)
  const rls = (await q(`select bool_and(relrowsecurity) ok from pg_class where relname in ('billing_issuers','billing_profiles','billing_customers','billing_subscriptions','project_billing','billing_checkout_sessions','stripe_webhook_events') and relnamespace = 'public'::regnamespace`)).rows[0].ok
  check('RLS on all billing tables', rls === true)
  const grants = (await q(`select count(*)::int n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated') and table_name in ('billing_issuers','billing_profiles','billing_customers','billing_subscriptions','project_billing','billing_checkout_sessions','stripe_webhook_events')`)).rows[0].n
  check('no table grants to anon/authenticated', grants === 0)
  const fx = (await q(`select bool_or(has_function_privilege(r, f, 'EXECUTE')) bad from unnest(array['anon','authenticated']) r,
     unnest(array['public.billing_sync_subscription(jsonb)','public.billing_record_invoice(text,boolean,text,text,timestamptz)','public.stripe_event_claim(text,boolean,text,text,timestamptz)','public.stripe_event_finish(text,text,text)']) f`)).rows[0].bad
  check('billing functions not executable by anon/authenticated', fx === false)
  const empty = (await q(`select (select count(*) from public.project_billing) + (select count(*) from public.billing_customers) + (select count(*) from public.billing_issuers) + (select count(*) from public.billing_profiles) n`)).rows[0].n
  check('no billing rows before the rehearsal', Number(empty) === 0)

  await q('begin')
  await expectError('057 refuses to run twice', () => q(readFileSync(resolve(REPO, 'supabase/migrations/057_billing_foundation.sql'), 'utf8').replace(/^\s*begin;|commit;\s*$/gim, '')), 'already applied')
  const t = (await q(`insert into public.tenants (slug, display_name) values ('zz-rehearse-057', 'Rehearsal') returning id`)).rows[0].id
  const pA = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r57-a', $1, 'A') returning id`, [t])).rows[0].id
  const pB = (await q(`insert into public.projects (slug, tenant_id, name) values ('zz-r57-b', $1, 'B') returning id`, [t])).rows[0].id
  const t2 = (await q(`insert into public.tenants (slug, display_name) values ('zz-rehearse-057-x', 'Other') returning id`)).rows[0].id
  await q('set local role service_role') // every billing step below runs exactly as the app will
  const iss = ISS = (await q(`insert into public.billing_issuers (key, legal_name, country, vat_id, status, active_from) values ('zz-r57-de', 'Rehearsal issuer', 'DE', 'DE123456789', 'active', current_date) returning id`)).rows[0].id
  await q(`insert into public.billing_profiles (tenant_id, livemode, billing_email, customer_type, legal_name, country, vat_id) values ($1, true, 'billing@example.it', 'business', 'Rehearsal S.r.l.', 'IT', 'IT12345678901')`, [t])
  for (const live of [false, true]) await q(`insert into public.billing_customers (tenant_id, issuer_id, livemode, stripe_customer_id) values ($1,$2,$3,$4)`, [t, iss, live, `cus_r57${live ? 'live' : 'test'}01`])
  await q(`insert into public.billing_customers (tenant_id, issuer_id, livemode, stripe_customer_id) values ($1,$2,true,'cus_r57other01')`, [t2, iss])
  const due = new Date().toISOString() // payment due now (≤ 30 days: no reason needed)
  for (const [p, live, amt] of [[pA, false, 100], [pA, true, 24000], [pB, true, 18000]]) {
    await q(`insert into public.project_billing (project_id, livemode, arrangement, amount_cents, billing_interval, activation_due_at) values ($1,$2,'stripe',$3,'year',$4)`, [p, live, amt, due])
  }
  check('same project: independent test (€1) and live (€240) agreements', (await q(`select count(*)::int n from public.project_billing where project_id = $1`, [pA])).rows[0].n === 2)

  const subA = await sync({ tenant_id: t, livemode: true, stripe_subscription_id: 'sub_r57liveA01', status: 'active', project_id: pA })
  const subT = await sync({ tenant_id: t, livemode: false, stripe_subscription_id: 'sub_r57testA01', status: 'active', project_id: pA })
  const links = (await q(`select livemode, billing_subscription_id from public.project_billing where project_id = $1 order by livemode`, [pA])).rows
  check('test and live subscriptions link to their own mode only', links[0].billing_subscription_id === subT && links[1].billing_subscription_id === subA)
  await expectError('a test subscription cannot attach to the live agreement', () => q(`update public.project_billing set billing_subscription_id = $1 where project_id = $2 and livemode`, [subT, pB]), '23503')
  await expectError('another client\'s subscription cannot attach', async () => {
    const x = await sync({ tenant_id: t2, livemode: true, stripe_subscription_id: 'sub_r57other01', status: 'active' })
    await q(`update public.project_billing set billing_subscription_id = $1 where project_id = $2 and livemode`, [x, pB])
  }, 'billing:tenant_mismatch')

  // Lifecycle inputs: first payment, failure on renewal, unpaid, recovery by paying the invoice.
  await rec('sub_r57liveA01', true, 'in_r57first01', 'paid', '2027-01-02T10:00:00Z')
  await rec('sub_r57liveA01', true, 'in_r57renew01', 'failed', '2028-01-02T10:00:00Z')
  await sync({ tenant_id: t, livemode: true, stripe_subscription_id: 'sub_r57liveA01', status: 'unpaid' })
  await rec('sub_r57liveA01', true, 'in_r57renew01', 'failed', '2028-01-05T10:00:00Z') // a later retry
  let r = await subRow('sub_r57liveA01')
  check('unpaid: failure clock = FIRST confirmed failure', r.status === 'unpaid' && r.payment_failed_at.toISOString() === '2028-01-02T10:00:00.000Z')
  await rec('sub_r57liveA01', true, 'in_r57renew01', 'paid', '2028-01-20T10:00:00Z')
  await sync({ tenant_id: t, livemode: true, stripe_subscription_id: 'sub_r57liveA01', status: 'active' })
  r = await subRow('sub_r57liveA01')
  check('paying the open invoice on an unpaid subscription clears the clock', r.status === 'active' && r.payment_failed_at === null && r.first_paid_at.toISOString() === '2027-01-02T10:00:00.000Z')
  const test = await subRow('sub_r57testA01')
  check('the test subscription was untouched by live events', test.first_paid_at === null && test.payment_failed_at === null)

  await rec('sub_r57liveA01', true, 'in_r57renew02', 'failed', '2029-01-02T10:00:00Z')
  await rec('sub_r57liveA01', true, 'in_r57renew02', 'voided', '2029-01-05T10:00:00Z')
  check('an invoice voided / marked uncollectible in Stripe settles the failure', (await subRow('sub_r57liveA01')).payment_failed_at === null)
  await expectError('a payment due date > 30 days ahead without a reason is refused', () =>
    q(`update public.project_billing set activation_due_at = now() + interval '45 days' where project_id = $1 and livemode`, [pB]), 'billing:activation_window')
  await q(`update public.project_billing set activation_due_at = now() + interval '45 days', activation_extension_reason = 'Rehearsal' where project_id = $1 and livemode`, [pB])
  check('a longer due date with a recorded reason is accepted', true)

  const ev = (await q(`select public.stripe_event_claim('evt_r57dup0001', true, 'invoice.paid', 'in_r57first01', now()) a`)).rows[0].a
  await q(`select public.stripe_event_finish('evt_r57dup0001', 'processed')`)
  const ev2 = (await q(`select public.stripe_event_claim('evt_r57dup0001', true, 'invoice.paid', 'in_r57first01', now()) a`)).rows[0].a
  check('duplicate webhook delivery is not processed twice', ev === true && ev2 === false)

  await q(`insert into public.billing_checkout_sessions (stripe_session_id, project_id, livemode, terms_version, expires_at) values ('cs_live_r57one0001', $1, true, 1, now() + interval '24 hours')`, [pB])
  await expectError('a second open checkout for the same project is refused', () =>
    q(`insert into public.billing_checkout_sessions (stripe_session_id, project_id, livemode, terms_version, expires_at) values ('cs_live_r57two0001', $1, true, 1, now() + interval '24 hours')`, [pB]), '23505')
  await q('reset role')
  await expectError('a billed project cannot be deleted', () => q(`delete from public.projects where id = $1`, [pB]), '23503')
} catch (e) {
  check('rehearsal ran', false, e.message)
} finally {
  await q('rollback').catch(() => {})
  const left = (await q(`select (select count(*) from public.tenants where slug like 'zz-rehearse-057%') + (select count(*) from public.project_billing) + (select count(*) from public.stripe_webhook_events) + (select count(*) from public.billing_issuers) n`)).rows[0].n
  check('nothing left behind', Number(left) === 0)
  await c.end()
}

// API roles over the Data API (PostgREST).
for (const [role, key, expectBlocked] of [['anon', env.NEXT_PUBLIC_SUPABASE_ANON_KEY, true], ['service_role', env.SUPABASE_SERVICE_ROLE_KEY, false]]) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/project_billing?select=project_id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  const blocked = res.status === 401 || res.status === 403 || res.status === 404
  check(`${role} reading project_billing via the API ${expectBlocked ? 'is refused' : 'works'}`, blocked === expectBlocked, `HTTP ${res.status}`)
}
{
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/billing_sync_subscription`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: {} }) })
  check('anon calling billing_sync_subscription via the API is refused', [401, 403, 404].includes(res.status), `HTTP ${res.status}`)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
process.exit(failed ? 1 : 0)

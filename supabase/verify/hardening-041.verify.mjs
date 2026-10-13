/**
 * Migration 041 — content audit log (ADR-032 D9, slice 3a).
 * Production shape: 014–036, 040, then 041. Proves: API roles (even a tenant
 * Owner) can neither read nor write the log while the service role can; only
 * known actions / actor kinds / outcomes are accepted; one record per Sanity
 * transaction per item (retries and dashboard+webhook can never double up),
 * while refusals without a transaction are unconstrained; rows survive the
 * deletion of the actor's account and of the project; and the migration
 * refuses to run twice.
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
  '035_whats_new.sql', '036_analytics_snapshots.sql', '040_connections.sql']
const M041 = MIG('041_content_audit_log.sql')

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
let n = 0
async function row(cols = {}) {
  n += 1
  const c = {
    project_id: ids.P,
    content_type: 'post',
    content_id: `post-${n}`,
    action: 'published',
    actor_kind: 'user',
    actor_id: ids.owner,
    outcome: 'ok',
    sanity_transaction_id: `abluo-dash-${n}`,
    detail: JSON.stringify({ state: { exists: true, publishedAt: '2026-10-13T08:00:00.000Z', expiresAt: null, archivedAt: null } }),
    ...cols,
  }
  const keys = Object.keys(c)
  return (await q(`insert into public.content_audit_log (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, keys.map((k) => c[k])))[0]
}

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M041)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('cal-t','T') returning id`)
  ids.P = await one(`insert into public.projects (slug, tenant_id, name) values ('cal-p',$1,'P') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('owner@cal.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('041 server-only access', () => {
  it('RLS on, no policies', async () => {
    const [r] = await q(`select relrowsecurity from pg_class where oid = 'public.content_audit_log'::regclass`)
    expect(r.relrowsecurity).toBe(true)
    expect((await q(`select 1 from pg_policies where schemaname='public' and tablename='content_audit_log'`)).length).toBe(0)
  })

  it('a tenant Owner and anon can neither read nor write', async () => {
    const r = await row()
    for (const who of [() => asUser(ids.owner), asAnon]) {
      await who()
      expect((await errOf(() => q(`select * from public.content_audit_log limit 1`)))?.code).toBe('42501')
      await who()
      expect((await errOf(() => q(
        `insert into public.content_audit_log (content_type, content_id, action, actor_kind, outcome) values ('post','x','published','user','ok')`,
      )))?.code).toBe('42501')
      await who()
      expect((await errOf(() => q(`update public.content_audit_log set outcome='failed' where id=$1`, [r.id])))?.code).toBe('42501')
      await who()
      expect((await errOf(() => q(`delete from public.content_audit_log where id=$1`, [r.id])))?.code).toBe('42501')
    }
  })

  it('the service role inserts, reads and deletes (retention sweep)', async () => {
    await asService()
    const r = await row()
    expect((await q(`select id from public.content_audit_log where id=$1`, [r.id])).length).toBe(1)
    await q(`delete from public.content_audit_log where id=$1`, [r.id])
    expect((await q(`select id from public.content_audit_log where id=$1`, [r.id])).length).toBe(0)
  })
})

describe('041 accepts known values only', () => {
  it('rejects unknown action, actor kind, outcome, content type shape, and a non-object detail', async () => {
    for (const bad of [
      { action: 'updated' },
      { actor_kind: 'robot' },
      { outcome: 'maybe' },
      { content_type: 'post; drop table' },
      { content_id: '' },
      { detail: JSON.stringify(['x']) },
    ]) {
      expect((await errOf(() => row(bad)))?.code, JSON.stringify(bad)).toBe('23514')
    }
  })

  it('accepts every documented action and actor kind', async () => {
    for (const action of ['created', 'published', 'scheduled', 'schedule_changed', 'unpublished', 'archived', 'restored', 'deleted', 'delete_refused']) {
      await row({ action })
    }
    for (const actor_kind of ['user', 'studio', 'system']) await row({ actor_kind, actor_id: null })
  })
})

describe('041 one record per transaction per item', () => {
  it('a second record of the same transaction for the same item is refused', async () => {
    await row({ sanity_transaction_id: 'abluo-dash-dup', content_id: 'post-dup' })
    expect((await errOf(() => row({ sanity_transaction_id: 'abluo-dash-dup', content_id: 'post-dup', actor_kind: 'studio', actor_id: null })))?.code).toBe('23505')
  })

  it('ON CONFLICT DO NOTHING makes a webhook retry harmless', async () => {
    await row({ sanity_transaction_id: 'txn-retry', content_id: 'post-retry' })
    await q(`insert into public.content_audit_log (content_type, content_id, action, actor_kind, outcome, sanity_transaction_id)
             values ('post','post-retry','published','studio','ok','txn-retry')
             on conflict (sanity_transaction_id, content_id) do nothing`)
    expect((await q(`select count(*)::int as c from public.content_audit_log where sanity_transaction_id='txn-retry'`))[0].c).toBe(1)
  })

  it('one transaction may touch several items', async () => {
    await row({ sanity_transaction_id: 'txn-multi', content_id: 'a' })
    await row({ sanity_transaction_id: 'txn-multi', content_id: 'b' })
  })

  it('refusals without a transaction are not constrained', async () => {
    await row({ sanity_transaction_id: null, content_id: 'post-refused', outcome: 'refused' })
    await row({ sanity_transaction_id: null, content_id: 'post-refused', outcome: 'refused' })
  })
})

describe('041 rows outlive what they describe', () => {
  it('deleting the actor keeps the row and nulls actor_id', async () => {
    const u = await one(`insert into auth.users (email) values ('gone@cal.test') returning id`)
    const r = await row({ actor_id: u })
    await q(`delete from auth.users where id=$1`, [u])
    const [after] = await q(`select actor_id from public.content_audit_log where id=$1`, [r.id])
    expect(after.actor_id).toBeNull()
  })

  it('deleting the project keeps the row and nulls project_id', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('cal-gone',$1,'G') returning id`, [ids.t])
    const r = await row({ project_id: p })
    await q(`delete from public.projects where id=$1`, [p])
    const [after] = await q(`select project_id from public.content_audit_log where id=$1`, [r.id])
    expect(after.project_id).toBeNull()
  })
})

describe('041 guard', () => {
  it('refuses to run twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M041))
    expect(String(e?.message)).toMatch(/041: already applied/)
  })
})

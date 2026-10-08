/**
 * Migration 035 — "What's new" product updates (ADR-030). Production shape:
 * 014–034, then 035. Proves: signed-in people read published updates only and
 * never write them; each person reads/marks only their OWN reads, only for a
 * published update, and cannot change or remove them; anon gets nothing;
 * published requires published_at; the public bucket exists; no re-run.
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
  '031_project_member_archive.sql', '032_avatars_bucket.sql', '033_admin_audit_log.sql', '034_admin_backlog.sql']
const M035 = MIG('035_whats_new.sql')

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
const visibleUpdates = async () => (await q(`select slug from public.product_updates order by slug`)).map((r) => r.slug)
const markRead = (user, upd) => q(`insert into public.product_update_reads (user_id, update_id) values ($1,$2)`, [user, upd])
const myReads = async () => (await q(`select user_id, update_id from public.product_update_reads order by update_id`))

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M035)
  ids.u1 = await one(`insert into auth.users (email) values ('u1@wn.test') returning id`)
  ids.u2 = await one(`insert into auth.users (email) values ('u2@wn.test') returning id`)
  ids.pub = await one(`insert into public.product_updates (slug, status, published_at, title) values ('pub','published',now(),'{"en":"P"}') returning id`)
  ids.pub2 = await one(`insert into public.product_updates (slug, status, published_at) values ('pub2','published',now()) returning id`)
  ids.draft = await one(`insert into public.product_updates (slug) values ('draft') returning id`)
  ids.arch = await one(`insert into public.product_updates (slug, status, published_at) values ('arch','archived',now()) returning id`)
  // u2 already read pub (written by the service role, like the app would not — but it proves isolation of reads)
  await q(`insert into public.product_update_reads (user_id, update_id) values ($1,$2)`, [ids.u2, ids.pub])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('035 product_updates', () => {
  it('authenticated sees published rows only', async () => {
    await asUser(ids.u1)
    expect(await visibleUpdates()).toEqual(['pub', 'pub2'])
  })
  it('authenticated cannot insert, update or delete', async () => {
    await asUser(ids.u1)
    expect((await errOf(() => q(`insert into public.product_updates (slug) values ('x-new')`)))?.code).toBe('42501')
    await asUser(ids.u1)
    expect((await errOf(() => q(`update public.product_updates set status = 'published', published_at = now() where id = $1`, [ids.draft])))?.code).toBe('42501')
    await asUser(ids.u1)
    expect((await errOf(() => q(`delete from public.product_updates where id = $1`, [ids.pub])))?.code).toBe('42501')
    await reset()
    expect(await visibleUpdates()).toEqual(['arch', 'draft', 'pub', 'pub2'])
    expect((await q(`select status from public.product_updates where id = $1`, [ids.draft]))[0].status).toBe('draft')
  })
  it('anon can neither read nor write', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.product_updates`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => q(`insert into public.product_updates (slug) values ('x-anon')`)))?.code).toBe('42501')
  })
  it('published requires published_at; drafts may omit it', async () => {
    expect((await errOf(() => q(`insert into public.product_updates (slug, status) values ('nodate','published')`)))?.code).toBe('23514')
    expect((await errOf(() => q(`update public.product_updates set published_at = null where id = $1`, [ids.pub])))?.code).toBe('23514')
  })
  it('slug, status, url and jsonb shape CHECKs', async () => {
    for (const bad of [`('Bad-Slug')`, `('a')`, `('-ab')`]) {
      expect((await errOf(() => q(`insert into public.product_updates (slug) values ${bad}`)))?.code).toBe('23514')
    }
    for (const [col, val] of [['status', 'live'], ['image_url', 'http://x'], ['cta_url', 'javascript:alert(1)']]) {
      expect((await errOf(() => q(`insert into public.product_updates (slug, ${col}) values ('ck-x', $1)`, [val])))?.code).toBe('23514')
    }
    for (const col of ['title', 'body', 'audience', 'cta_label']) {
      expect((await errOf(() => q(`insert into public.product_updates (slug, ${col}) values ('ck-y', '[]'::jsonb)`)))?.code).toBe('23514')
    }
  })
  it('the service role writes', async () => {
    await asService()
    const id = await one(`insert into public.product_updates (slug) values ('svc') returning id`)
    await q(`update public.product_updates set status = 'published', published_at = now() where id = $1`, [id])
    await q(`delete from public.product_updates where id = $1`, [id])
  })
})

describe('035 product_update_reads', () => {
  it('a person marks a published update read for themselves and sees only their own reads', async () => {
    await asUser(ids.u1)
    expect(await myReads()).toEqual([])
    await markRead(ids.u1, ids.pub)
    expect(await myReads()).toEqual([{ user_id: ids.u1, update_id: ids.pub }])
    await asUser(ids.u2)
    expect(await myReads()).toEqual([{ user_id: ids.u2, update_id: ids.pub }])
  })
  it('cannot mark a read for another person', async () => {
    await asUser(ids.u1)
    expect((await errOf(() => markRead(ids.u2, ids.pub2)))?.code).toBe('42501')
    await reset()
    expect((await q(`select count(*)::int as n from public.product_update_reads where user_id = $1 and update_id = $2`, [ids.u2, ids.pub2]))[0].n).toBe(0)
  })
  it('cannot mark a draft or archived update read', async () => {
    for (const upd of [ids.draft, ids.arch]) {
      await asUser(ids.u1)
      expect((await errOf(() => markRead(ids.u1, upd)))?.code).toBe('42501')
    }
  })
  it('cannot update or delete reads (own or others)', async () => {
    await asUser(ids.u1)
    expect((await errOf(() => q(`update public.product_update_reads set read_at = now() where user_id = $1`, [ids.u1])))?.code).toBe('42501')
    await asUser(ids.u1)
    expect((await errOf(() => q(`delete from public.product_update_reads where user_id = $1`, [ids.u1])))?.code).toBe('42501')
    await asUser(ids.u1)
    expect((await errOf(() => q(`update public.product_update_reads set user_id = $1 where user_id = $2`, [ids.u1, ids.u2])))?.code).toBe('42501')
    await reset()
    expect((await q(`select count(*)::int as n from public.product_update_reads`))[0].n).toBe(2)
  })
  it('a second read of the same update is a primary-key conflict', async () => {
    await asUser(ids.u1)
    expect((await errOf(() => markRead(ids.u1, ids.pub)))?.code).toBe('23505')
  })
  it('anon can neither read nor mark', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.product_update_reads`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => markRead(ids.u1, ids.pub2)))?.code).toBe('42501')
  })
  it('a read follows its update and its person (cascade)', async () => {
    const tmp = await one(`insert into public.product_updates (slug, status, published_at) values ('tmp','published',now()) returning id`)
    await asUser(ids.u1)
    await markRead(ids.u1, tmp)
    await reset()
    await q(`delete from public.product_updates where id = $1`, [tmp])
    expect((await q(`select count(*)::int as n from public.product_update_reads where update_id = $1`, [tmp]))[0].n).toBe(0)
  })
})

describe('035 bucket and re-run', () => {
  it('product-updates bucket exists, is public and limited to images ≤ 5 MB', async () => {
    expect(await q(`select public, file_size_limit::int as lim, allowed_mime_types as m from storage.buckets where id = 'product-updates'`))
      .toEqual([{ public: true, lim: 5242880, m: ['image/jpeg', 'image/png', 'image/webp'] }])
  })
  it('re-running the migration raises and changes nothing', async () => {
    const err = await errOf(() => applyMigrationFile(client, M035))
    expect(err?.message).toMatch(/035: already applied/)
    expect((await q(`select count(*)::int as n from pg_policies where schemaname='public' and tablename in ('product_updates','product_update_reads')`))[0].n).toBe(3)
  })
})

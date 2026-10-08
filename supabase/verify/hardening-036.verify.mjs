/**
 * Migration 036 — website analytics snapshots (ADR-029 §3.4, ADR-030 §5.2).
 * Production shape: 014–035, then 036. Proves who reads snapshots (Owner,
 * Site admin, the analytics.read extra on the site or on the client
 * membership; never another client's; never anon), that nobody but the
 * service role writes, the table CHECKs / unique key, that analytics.read is
 * grantable — and that the REDEFINED get_my_project_ids_with() answers
 * exactly as it did after 030 for every contact-request permission.
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
  '035_whats_new.sql']
const M036 = MIG('036_analytics_snapshots.sql')
const USERS = ['ownerA', 'adminA1', 'editorA1', 'editorFormsA1', 'editorAnA1', 'memberAnA', 'memberPlainA', 'ownerB']
const PERMS = ['forms.submission.read', 'forms.submission.update', 'analytics.read', 'blog.post.write', 'billing.invoice.read', '']

let client
const ids = {}
const before = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asService() { await client.query(`select public.set_session_auth(null, 'service_role')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
const one = async (sql, p) => (await q(sql, p))[0].id
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}
const sorted = (...a) => a.sort()
async function helper(who, perm) {
  await asUser(ids[who])
  const r = (await q(`select * from public.get_my_project_ids_with($1) as id`, [perm])).map((x) => x.id).sort()
  await reset()
  return r
}
async function contactRequestsSeen(who) {
  await asUser(ids[who])
  const r = {
    subs: (await q(`select project_id from public.form_submissions`)).map((x) => x.project_id).sort(),
    events: (await q(`select project_id from public.form_events`)).map((x) => x.project_id).sort(),
    inq: (await q(`select project_id from public.inquiries where project_id is not null`)).map((x) => x.project_id).sort(),
  }
  await reset()
  return r
}
const fnShape = async () => (await q(`select prosrc, prosecdef, provolatile, proconfig, proacl::text as acl
  from pg_proc where oid = 'public.get_my_project_ids_with(text)'::regprocedure`))[0]
const snapshotsSeen = async () => (await q(`select project_id from public.analytics_snapshots`)).map((r) => r.project_id).sort()
const snap = (project, cols = {}) => {
  const c = { project_id: project, source: 'ga4', period_start: '2026-09-10', period_end: '2026-10-07', status: 'ok', ...cols }
  const keys = Object.keys(c)
  return q(`insert into public.analytics_snapshots (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning id`,
    keys.map((k) => c[k]))
}

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))

  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('an-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('an-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('an-a1',$1,'A1') returning id`, [ids.tA])
  ids.A2 = await one(`insert into public.projects (slug, tenant_id, name) values ('an-a2',$1,'A2') returning id`, [ids.tA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('an-b1',$1,'B1') returning id`, [ids.tB])
  for (const u of USERS) ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@an.test`])
  await q(`insert into public.tenant_members (tenant_id, user_id, role, extra_permissions) values
    ($1,$2,'owner','{}'), ($3,$4,'owner','{}'), ($1,$5,'member','{forms.submission.read}'), ($1,$6,'member','{}')`,
    [ids.tA, ids.ownerA, ids.tB, ids.ownerB, ids.memberAnA, ids.memberPlainA])
  await q(`insert into public.project_members (project_id, user_id, role, extra_permissions) values
    ($1,$2,'admin','{}'), ($1,$3,'editor','{}'), ($1,$4,'editor','{forms.submission.read,forms.submission.update}'), ($1,$5,'editor','{}')`,
    [ids.A1, ids.adminA1, ids.editorA1, ids.editorFormsA1, ids.editorAnA1])
  for (const [t, p] of [[ids.tA, ids.A1], [ids.tA, ids.A2], [ids.tB, ids.B1]]) {
    const sub = await one(`insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
      values ($1,$2,'f',1,'{}') returning id`, [t, p])
    await q(`insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id) values ($1,$2,'f',1,$3)`, [t, p, sub])
    await q(`insert into public.inquiries (tenant_id, project_id, name, email) values ($1,$2,'n','e@x.y')`, [t, p])
  }

  // The 030 behaviour, recorded BEFORE 036 runs.
  for (const u of USERS) {
    before[u] = { cr: await contactRequestsSeen(u) }
    for (const p of PERMS) before[u][p] = await helper(u, p)
  }
  before.fn = await fnShape()
  before.policies = await q(`select tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and tablename in ('form_submissions','form_events','inquiries') order by 1,2`)

  await applyMigrationFile(client, M036)

  // analytics.read only became grantable now: give it after 036.
  await q(`update public.project_members set extra_permissions = '{analytics.read}' where user_id = $1`, [ids.editorAnA1])
  await q(`update public.tenant_members set extra_permissions = '{forms.submission.read,analytics.read}' where user_id = $1`, [ids.memberAnA])

  for (const p of [ids.A1, ids.A2, ids.B1]) await snap(p)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('036 leaves contact-request access exactly as 030 left it', () => {
  it('sanity: the recorded 030 answers are the expected ones', () => {
    expect(before.ownerA['forms.submission.read']).toEqual(sorted(ids.A1, ids.A2))
    expect(before.adminA1['forms.submission.update']).toEqual([ids.A1])
    expect(before.editorA1['forms.submission.read']).toEqual([])
    expect(before.editorFormsA1['forms.submission.update']).toEqual([ids.A1])
    expect(before.memberAnA['forms.submission.read']).toEqual(sorted(ids.A1, ids.A2))
    expect(before.memberAnA['forms.submission.update']).toEqual([])
    for (const u of USERS) expect(before[u]['analytics.read']).toEqual([])
  })
  for (const u of USERS) {
    it(`${u}: get_my_project_ids_with() is unchanged for every contact-request permission`, async () => {
      for (const p of PERMS.filter((x) => x !== 'analytics.read')) expect(await helper(u, p)).toEqual(before[u][p])
    })
    it(`${u}: submissions, form events and inquiries seen are unchanged`, async () => {
      expect(await contactRequestsSeen(u)).toEqual(before[u].cr)
    })
  }
  it('the analytics.read extra does not open contact requests', async () => {
    expect(await helper('editorAnA1', 'forms.submission.read')).toEqual([])
    expect(await helper('editorAnA1', 'forms.submission.update')).toEqual([])
  })
  it('the function body differs from 030 only by the added permission; security definer, search_path, volatility and grants unchanged', async () => {
    const after = await fnShape()
    expect(after.prosrc.replace(", 'analytics.read'", '')).toBe(before.fn.prosrc)
    expect(after.prosecdef).toBe(true)
    expect({ ...after, prosrc: null }).toEqual({ ...before.fn, prosrc: null })
  })
  it('contact-request policies are untouched', async () => {
    expect(await q(`select tablename, policyname, qual, with_check from pg_policies
      where schemaname = 'public' and tablename in ('form_submissions','form_events','inquiries') order by 1,2`)).toEqual(before.policies)
  })
})

describe('036 who reads analytics snapshots', () => {
  const cases = [
    ['ownerA', () => sorted(ids.A1, ids.A2)],
    ['adminA1', () => [ids.A1]],
    ['editorA1', () => []],
    ['editorFormsA1', () => []],
    ['editorAnA1', () => [ids.A1]],
    ['memberAnA', () => sorted(ids.A1, ids.A2)],
    ['memberPlainA', () => []],
    ['ownerB', () => [ids.B1]],
  ]
  for (const [who, expected] of cases) {
    it(`${who}`, async () => {
      await asUser(ids[who])
      expect(await snapshotsSeen()).toEqual(expected())
      expect(await helper(who, 'analytics.read')).toEqual(expected())
    })
  }
  it('nobody of client A reads project B, even by id', async () => {
    for (const who of ['ownerA', 'adminA1', 'editorAnA1', 'memberAnA']) {
      await asUser(ids[who])
      expect(await q(`select id from public.analytics_snapshots where project_id = $1`, [ids.B1])).toEqual([])
    }
  })
  it('the Editor loses access again when the extra is removed', async () => {
    await q(`update public.project_members set extra_permissions = '{}' where user_id = $1`, [ids.editorAnA1])
    await asUser(ids.editorAnA1)
    expect(await snapshotsSeen()).toEqual([])
    await reset()
    await q(`update public.project_members set extra_permissions = '{analytics.read}' where user_id = $1`, [ids.editorAnA1])
  })
  it('anon can neither read nor call the helper', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.analytics_snapshots`)))?.code).toBe('42501')
    await asAnon()
    expect((await errOf(() => q(`select * from public.get_my_project_ids_with('analytics.read')`)))?.code).toBe('42501')
  })
  it('authenticated cannot insert, update or delete (not even the Owner)', async () => {
    await asUser(ids.ownerA)
    expect((await errOf(() => snap(ids.A1, { period_end: '2026-10-08' })))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`update public.analytics_snapshots set status = 'error', error = 'x'`)))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`delete from public.analytics_snapshots`)))?.code).toBe('42501')
    await reset()
    expect((await q(`select count(*)::int as n from public.analytics_snapshots`))[0].n).toBe(3)
  })
  it('the service role writes', async () => {
    await asService()
    const [{ id }] = await snap(ids.A1, { source: 'gsc' })
    await q(`update public.analytics_snapshots set metrics = '{"clicks":1}' where id = $1`, [id])
    await q(`delete from public.analytics_snapshots where id = $1`, [id])
  })
})

describe('036 table rules and grantable extra', () => {
  it('analytics.read is a project-scoped grantable permission', async () => {
    expect(await q(`select applies_to, requires from public.grantable_permissions where id = 'analytics.read'`))
      .toEqual([{ applies_to: 'project', requires: null }])
  })
  it('the extra validation still rejects non-grantable / tenant-only ids on a site membership', async () => {
    expect((await errOf(() => q(`update public.project_members set extra_permissions = '{analytics.write}' where user_id = $1`, [ids.editorA1])))?.code).toBe('23514')
    expect((await errOf(() => q(`update public.project_members set extra_permissions = '{billing.invoice.read}' where user_id = $1`, [ids.editorA1])))?.code).toBe('23514')
  })
  it('one row per project, source and period_end', async () => {
    expect((await errOf(() => snap(ids.A1)))?.code).toBe('23505')
    const [{ id }] = await snap(ids.A1, { source: 'gsc' })
    const [{ id: id2 }] = await snap(ids.A1, { period_start: '2026-09-11', period_end: '2026-10-08' })
    await q(`delete from public.analytics_snapshots where id in ($1,$2)`, [id, id2])
  })
  it('status, source, period and error CHECKs', async () => {
    const pe = { period_end: '2026-01-01', period_start: '2025-12-01' }
    expect((await errOf(() => snap(ids.A2, { ...pe, status: 'pending' })))?.code).toBe('23514')
    expect((await errOf(() => snap(ids.A2, { ...pe, source: 'ua' })))?.code).toBe('23514')
    expect((await errOf(() => snap(ids.A2, { ...pe, status: 'ok', error: 'boom' })))?.code).toBe('23514')
    expect((await errOf(() => snap(ids.A2, { ...pe, status: 'not_connected', error: 'boom' })))?.code).toBe('23514')
    expect((await errOf(() => snap(ids.A2, { period_start: '2026-02-01', period_end: '2026-01-01' })))?.code).toBe('23514')
    const [{ id }] = await snap(ids.A2, { ...pe, status: 'error', error: 'quota' })
    const [{ id: id2 }] = await snap(ids.A2, { ...pe, source: 'gsc', status: 'not_connected' })
    await q(`delete from public.analytics_snapshots where id in ($1,$2)`, [id, id2])
  })
  it('snapshots follow their project (cascade)', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('an-tmp',$1,'T') returning id`, [ids.tA])
    await snap(p)
    await q(`delete from public.projects where id = $1`, [p])
    expect((await q(`select count(*)::int as n from public.analytics_snapshots where project_id = $1`, [p]))[0].n).toBe(0)
  })
  it('re-running the migration raises and changes nothing', async () => {
    const err = await errOf(() => applyMigrationFile(client, M036))
    expect(err?.message).toMatch(/036: already applied/)
    expect((await q(`select count(*)::int as n from public.grantable_permissions where id = 'analytics.read'`))[0].n).toBe(1)
  })
})

/**
 * Migration 030 — contact requests follow the permission (ADR-028 steps 3–4).
 * Production shape: … 027, 028, 029. Every person type is tried against
 * submissions, form events and inquiries of their own site, a sibling site of
 * the same client, and another client.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const M030 = MIG('030_contact_requests_by_permission.sql')

let client
const ids = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id, extra = {}) {
  await client.query(`select public.set_session_auth($1::uuid, 'authenticated', $2::jsonb)`, [id, JSON.stringify(extra)])
}
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
const one = async (sql, p) => (await q(sql, p))[0].id
const subsSeen = async () => (await q(`select project_id from public.form_submissions`)).map((r) => r.project_id).sort()
const eventsSeen = async () => (await q(`select project_id from public.form_events`)).map((r) => r.project_id).sort()
const inqSeen = async () => (await q(`select project_id from public.inquiries where project_id is not null`)).map((r) => r.project_id).sort()
const sorted = (...a) => a.sort()

async function trySetStatus(subId) {
  await q(`update public.form_submissions set status = 'archived' where id = $1`, [subId])
  await reset()
  const s = (await q(`select status from public.form_submissions where id = $1`, [subId]))[0].status
  await q(`update public.form_submissions set status = 'new' where id = $1`, [subId])
  return s === 'archived'
}

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
    '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
    '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
    '028_security_hardening.sql', '029_roles_extras_invitations.sql']) {
    await applyMigrationFile(client, MIG(f))
  }
  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('h-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('h-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-a1',$1,'A1') returning id`, [ids.tA])
  ids.A2 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-a2',$1,'A2') returning id`, [ids.tA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-b1',$1,'B1') returning id`, [ids.tB])
  for (const u of ['ownerA', 'adminA1', 'editorA1', 'editorReadA1', 'editorRwA1', 'memberA', 'memberPlainA', 'ownerB', 'viewerA1']) {
    ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@h.test`])
  }
  await q(`insert into public.tenant_members (tenant_id, user_id, role, extra_permissions) values
    ($1,$2,'owner','{}'), ($3,$4,'owner','{}'), ($1,$5,'member','{forms.submission.read}'), ($1,$6,'member','{}')`,
    [ids.tA, ids.ownerA, ids.tB, ids.ownerB, ids.memberA, ids.memberPlainA])
  await q(`insert into public.project_members (project_id, user_id, role, extra_permissions) values
    ($1,$2,'admin','{}'), ($1,$3,'editor','{}'), ($1,$4,'editor','{forms.submission.read}'),
    ($1,$5,'editor','{forms.submission.read,forms.submission.update}'), ($1,$6,'viewer','{}')`,
    [ids.A1, ids.adminA1, ids.editorA1, ids.editorReadA1, ids.editorRwA1, ids.viewerA1])
  for (const [t, p, k] of [[ids.tA, ids.A1, 'A1'], [ids.tA, ids.A2, 'A2'], [ids.tB, ids.B1, 'B1']]) {
    ids['sub' + k] = await one(`insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
      values ($1,$2,'f',1,'{}') returning id`, [t, p])
    await q(`insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id) values ($1,$2,'f',1,$3)`, [t, p, ids['sub' + k]])
    await q(`insert into public.inquiries (tenant_id, project_id, name, email) values ($1,$2,'n','e@x.y')`, [t, p])
    await q(`insert into public.translation_usage (project_id, provider, source_locale, target_locale, characters) values ($1,'deepl','it','en',1)`, [p])
  }
}, 120_000)

afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('030 refuses while legacy roles exist', () => {
  it('a Viewer row blocks the migration; nothing changes', async () => {
    let err
    try { await applyMigrationFile(client, M030) } catch (e) { err = e }
    try { await client.query('rollback') } catch {}
    expect(err?.message).toMatch(/legacy roles/)
    expect(await q(`select to_regprocedure('public.get_my_project_ids_with(text)') as f`)).toEqual([{ f: null }])
  })
  it('before 030, a plain Editor reads contact requests (the exposure being closed)', async () => {
    await asUser(ids.editorA1)
    expect(await subsSeen()).toEqual([ids.A1])
  })
  it('applies once the Viewer is gone', async () => {
    await q(`delete from public.project_members where user_id = $1`, [ids.viewerA1])
    await applyMigrationFile(client, M030)
  })
})

describe('who sees contact requests after 030', () => {
  const cases = [
    ['ownerA', () => sorted(ids.A1, ids.A2)],
    ['adminA1', () => [ids.A1]],
    ['editorA1', () => []],
    ['editorReadA1', () => [ids.A1]],
    ['editorRwA1', () => [ids.A1]],
    ['memberA', () => sorted(ids.A1, ids.A2)],
    ['memberPlainA', () => []],
    ['ownerB', () => [ids.B1]],
  ]
  for (const [who, expected] of cases) {
    it(`${who}: submissions, events and inquiries`, async () => {
      await asUser(ids[who])
      expect(await subsSeen()).toEqual(expected())
      expect(await eventsSeen()).toEqual(expected())
      expect(await inqSeen()).toEqual(expected())
    })
  }
  it('anon sees nothing and cannot call the helper', async () => {
    await asAnon()
    let err
    try { await q(`select * from public.get_my_project_ids_with('forms.submission.read')`) } catch (e) { err = e }
    expect(err?.code).toBe('42501')
  })
  it('the helper is closed for any other permission', async () => {
    await asUser(ids.ownerA)
    expect(await q(`select * from public.get_my_project_ids_with('blog.post.write')`)).toEqual([])
  })
})

describe('who may change a contact request status', () => {
  const can = [['ownerA', 'subA1', true], ['adminA1', 'subA1', true], ['editorRwA1', 'subA1', true],
    ['editorReadA1', 'subA1', false], ['editorA1', 'subA1', false], ['memberA', 'subA1', false],
    ['adminA1', 'subA2', false], ['ownerA', 'subB1', false]]
  for (const [who, sub, expected] of can) {
    it(`${who} on ${sub}: ${expected ? 'yes' : 'no'}`, async () => {
      await asUser(ids[who])
      expect(await trySetStatus(ids[sub])).toBe(expected)
    })
  }
})

describe('unchanged by 030', () => {
  it('a plain Editor still sees translation usage of their site', async () => {
    await asUser(ids.editorA1)
    expect((await q(`select project_id from public.translation_usage`)).map((r) => r.project_id)).toEqual([ids.A1])
  })
  it('legacy roles can no longer be written', async () => {
    let err
    try { await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'viewer')`, [ids.A2, ids.editorA1]) } catch (e) { err = e }
    expect(err?.code).toBe('23514')
  })
  it('028 refuses to re-run over 030', async () => {
    let err
    try { await applyMigrationFile(client, MIG('028_security_hardening.sql')) } catch (e) { err = e }
    try { await client.query('rollback') } catch {}
    expect(err?.message).toMatch(/superseded by 030/)
  })
  it('rollback-030 restores the 029 shape, and 030 applies again', async () => {
    await applyMigrationFile(client, path.join(__dirname, 'rollback-030.sql'))
    await asUser(ids.editorA1)
    expect(await subsSeen()).toEqual([ids.A1])
    await reset()
    await applyMigrationFile(client, M030)
    await asUser(ids.editorA1)
    expect(await subsSeen()).toEqual([])
  })
})

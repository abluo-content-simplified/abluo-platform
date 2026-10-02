/**
 * Migration 028 — security hardening. Proves every rule against a real
 * Postgres, as anon, as tenant A users, as tenant B, and as abluo_admin.
 *
 * The database is first brought to the PRODUCTION shape as of 2026-10-02
 * (014–019, 024, 026 drop leads, 027 translation_usage; 025 NOT applied), then
 * deliberately DRIFTED the way a Supabase project drifts (default privileges
 * granting ALL to anon/authenticated, an out-of-band permissive policy, a view
 * that bypasses RLS, a table with RLS off) — the live 2026-10-02 probe found
 * anon still holding INSERT/UPDATE/DELETE on project_members. 028 must converge
 * all of that onto the declared end state, atomically and idempotently.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const M028 = MIG('028_security_hardening.sql')

let client
const ids = {}

const APP_TABLES = {
  tenants: 'id', projects: 'id', tenant_members: 'id', project_members: 'id', profiles: 'id',
  inquiries: 'id', form_submissions: 'id', form_events: 'event_id', translation_usage: 'id',
}
const DRIFT_RELATIONS = { leak_v: 'id', unprotected_t: 'id' }

async function reset() { await client.query('select public.reset_session_auth()') }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asUser(id, extra = {}) {
  await client.query(`select public.set_session_auth($1::uuid, 'authenticated', $2::jsonb)`, [id, JSON.stringify(extra)])
}
async function asAdmin() { await asUser(ids.admin, { platform_role: 'abluo_admin', aal: 'aal2' }) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function denied(sql, params) {
  let err
  try { await client.query(sql, params) } catch (e) { err = e }
  expect(err, `expected 42501 for: ${sql}`).toBeDefined()
  expect(err.code).toBe('42501')
}
async function idsOf(table, col = 'id') { return (await q(`select ${col} as v from public.${table}`)).map((r) => r.v).sort() }
const sorted = (...a) => a.sort()

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
    '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
    '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql']) {
    await applyMigrationFile(client, MIG(f))
  }

  // ── fixtures (superuser) ──
  const one = async (sql, p) => (await q(sql, p))[0].id
  ids.tenantA = await one(`insert into public.tenants (slug, display_name) values ('h-a','A') returning id`)
  ids.tenantB = await one(`insert into public.tenants (slug, display_name) values ('h-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-a1',$1,'A1') returning id`, [ids.tenantA])
  ids.A2 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-a2',$1,'A2') returning id`, [ids.tenantA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-b1',$1,'B1') returning id`, [ids.tenantB])
  for (const u of ['ownerA', 'editorA1', 'viewerA1', 'tenantEditorA', 'ownerB', 'admin', 'nobody']) {
    ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@h.test`])
  }
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner'),($3,$4,'owner'),($1,$5,'editor')`,
    [ids.tenantA, ids.ownerA, ids.tenantB, ids.ownerB, ids.tenantEditorA])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor'),($1,$3,'viewer')`,
    [ids.A1, ids.editorA1, ids.viewerA1])
  const sub = (t, p) => one(`insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
    values ($1,$2,'f',1,'{"email":"x@y.z"}') returning id`, [t, p])
  ids.subA1 = await sub(ids.tenantA, ids.A1)
  ids.subA2 = await sub(ids.tenantA, ids.A2)
  ids.subB1 = await sub(ids.tenantB, ids.B1)
  const ev = async (t, p, s) => (await q(`insert into public.form_events (tenant_id, project_id, form_id, form_version, submission_id)
    values ($1,$2,'f',1,$3) returning event_id`, [t, p, s]))[0].event_id
  ids.evA1 = await ev(ids.tenantA, ids.A1, ids.subA1)
  ids.evB1 = await ev(ids.tenantB, ids.B1, ids.subB1)
  const inq = (t, p) => one(`insert into public.inquiries (tenant_id, project_id, name, email) values ($1,$2,'n','e@x.y') returning id`, [t, p])
  ids.inqA1 = await inq(ids.tenantA, ids.A1)
  ids.inqB1 = await inq(ids.tenantB, ids.B1)
  ids.inqALegacy = await inq(ids.tenantA, null)
  ids.inqPlatform = await inq(null, null)
  const tu = (p) => one(`insert into public.translation_usage (project_id, provider, source_locale, target_locale, characters)
    values ($1,'deepl','it','en',100) returning id`, [p])
  ids.tuA1 = await tu(ids.A1)
  ids.tuB1 = await tu(ids.B1)

  // ── drift: what a Supabase project accumulates outside the migration files ──
  await client.query(`
    grant all on all tables    in schema public to anon, authenticated;
    grant all on all sequences in schema public to anon, authenticated;
    grant execute on all functions in schema public to anon, public;
    create policy "rogue anon insert" on public.inquiries for insert with check (true);
    create policy "rogue anon read"   on public.form_submissions for select using (true);
    create view public.leak_v as select id, submission_data from public.form_submissions;
    grant select on public.leak_v to anon, authenticated;
    create table public.unprotected_t (id int);
    grant all on public.unprotected_t to anon, authenticated;
    grant select, insert, update on auth.users to supabase_auth_admin;
    grant usage on schema auth to supabase_auth_admin;
  `)
}, 120_000)

afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('028 (pre) — the drift is real exposure', () => {
  it('anon reads every tenant\'s submissions and can insert inquiries before 028', async () => {
    await asAnon()
    expect((await q('select id from public.form_submissions')).length).toBe(3)
    expect((await q('select id from public.leak_v')).length).toBe(3)
    await q(`insert into public.inquiries (name, email) values ('spam','s@x.y')`)
  })
})

describe('028 atomicity — a violation it cannot fix rolls EVERYTHING back', () => {
  it('raises on an anon-executable SECURITY DEFINER function and leaves state untouched', async () => {
    await q(`create function public.rogue_secdef() returns int language sql security definer as 'select 1'`)
    await q(`grant execute on function public.rogue_secdef() to anon`)
    let err
    try { await applyMigrationFile(client, M028) } catch (e) { err = e }
    try { await client.query('rollback') } catch {}
    expect(err?.message).toMatch(/028 self-check: anon can execute SECURITY DEFINER/)
    await asAnon()
    expect((await q('select id from public.form_submissions')).length).toBe(3) // nothing applied
    await reset()
    await q('drop function public.rogue_secdef()')
  })
})

describe('028 applies cleanly and is idempotent', () => {
  it('applies, then applies again with no error', async () => {
    await applyMigrationFile(client, M028)
    await applyMigrationFile(client, M028)
  })
})

describe('028 catalog — the declared end state', () => {
  it('RLS is enabled on every table in public', async () => {
    expect(await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where nspname='public' and relkind in ('r','p') and not relrowsecurity`)).toEqual([])
  })
  it('the rogue policies are gone and exactly the 21 canonical policies remain on the app tables', async () => {
    const rows = await q(`select tablename, policyname, cmd, roles::text[] as roles from pg_policies where schemaname='public'
      and tablename = any($1)`, [Object.keys(APP_TABLES)])
    expect(rows.length).toBe(21)
    expect(rows.map((r) => r.policyname)).not.toContain('rogue anon insert')
    expect(rows.map((r) => r.policyname)).not.toContain('rogue anon read')
    for (const r of rows) expect(r.roles).toEqual(['authenticated'])
    expect(rows.filter((r) => r.cmd !== 'SELECT').map((r) => `${r.tablename}:${r.cmd}`).sort())
      .toEqual(['form_submissions:UPDATE', 'profiles:UPDATE'])
  })
  it('authenticated has SELECT on the nine app tables and column UPDATE only on profiles.full_name + form_submissions.status', async () => {
    const t = await q(`select table_name, privilege_type from information_schema.role_table_grants
      where table_schema='public' and grantee='authenticated' order by 1,2`)
    expect(t).toEqual(Object.keys(APP_TABLES).sort().map((n) => ({ table_name: n, privilege_type: 'SELECT' })))
    const c = await q(`select table_name, column_name from information_schema.column_privileges
      where table_schema='public' and grantee='authenticated' and privilege_type='UPDATE' order by 1,2`)
    expect(c).toEqual([{ table_name: 'form_submissions', column_name: 'status' }, { table_name: 'profiles', column_name: 'full_name' }])
  })
  it('anon holds no privilege on any relation in public', async () => {
    expect(await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where nspname='public' and relkind in ('r','p','v','m') and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE'))`)).toEqual([])
  })
  it('default privileges no longer hand new tables to anon/authenticated', async () => {
    await q('create table public.future_t (id int)')
    const r = await q(`select has_table_privilege('anon','public.future_t','SELECT') a, has_table_privilege('authenticated','public.future_t','SELECT') b,
      has_table_privilege('service_role','public.future_t','SELECT') s`)
    expect(r[0]).toEqual({ a: false, b: false, s: true })
    await q('drop table public.future_t')
  })
})

describe('028 as anon — nothing, anywhere', () => {
  for (const [t, k] of Object.entries({ ...APP_TABLES, ...DRIFT_RELATIONS })) {
    it(`${t}: select / insert / update / delete all 42501`, async () => {
      await asAnon()
      await denied(`select 1 from public.${t} limit 1`)
      if (t !== 'leak_v') await denied(`insert into public.${t} (${k}) values (${t === 'unprotected_t' ? '1' : 'gen_random_uuid()'})`)
      await denied(`update public.${t} set ${k} = ${k} where false`)
      await denied(`delete from public.${t} where false`)
    })
  }
  it('cannot execute any RLS helper, the hook, or the usage total', async () => {
    await asAnon()
    for (const f of ['get_my_tenant_ids()', 'get_my_writable_tenant_ids()', 'get_my_owned_tenant_ids()',
      'get_my_project_ids()', 'get_my_writable_project_ids()', 'is_abluo_admin()',
      `translation_usage_month_total(gen_random_uuid(), now())`, `custom_access_token_hook('{}'::jsonb)`]) {
      await denied(`select public.${f}`)
    }
  })
})

describe('028 as tenant A — sees only its own, project grain', () => {
  it('owner A: own tenant, own projects, own submissions/events/usage/inquiries — none of B', async () => {
    await asUser(ids.ownerA)
    expect(await idsOf('tenants')).toEqual([ids.tenantA])
    expect(await idsOf('projects')).toEqual(sorted(ids.A1, ids.A2))
    expect(await idsOf('form_submissions')).toEqual(sorted(ids.subA1, ids.subA2))
    expect(await idsOf('form_events', 'event_id')).toEqual([ids.evA1])
    expect(await idsOf('translation_usage')).toEqual([ids.tuA1])
    expect(await idsOf('inquiries')).toEqual(sorted(ids.inqA1, ids.inqALegacy))
    expect(await idsOf('profiles')).toEqual([ids.ownerA])
    expect((await q('select tenant_id from public.tenant_members')).every((r) => r.tenant_id === ids.tenantA)).toBe(true)
    expect((await q('select project_id from public.project_members')).every((r) => r.project_id === ids.A1)).toBe(true)
    expect(await q(`select id from public.leak_v`).catch((e) => e.code)).toBe('42501')
  })
  it('project editor A1: A1 only — not A2 (project grain), not B', async () => {
    await asUser(ids.editorA1)
    expect(await idsOf('form_submissions')).toEqual([ids.subA1])
    expect(await idsOf('form_events', 'event_id')).toEqual([ids.evA1])
    expect(await idsOf('translation_usage')).toEqual([ids.tuA1])
    expect(await idsOf('inquiries')).toEqual([ids.inqA1])
    expect(await idsOf('tenants')).toEqual([])
    expect(await idsOf('projects')).toEqual([ids.A1])
  })
  it('tenant-level editor (no project grant): sees A\'s project rows, but NO submissions / inquiries / usage', async () => {
    await asUser(ids.tenantEditorA)
    expect(await idsOf('projects')).toEqual(sorted(ids.A1, ids.A2))
    expect(await idsOf('form_submissions')).toEqual([])
    expect(await idsOf('inquiries')).toEqual([])
    expect(await idsOf('translation_usage')).toEqual([])
  })
  it('editor A1 can change status of an A1 submission (updated_at trigger still fires)', async () => {
    await asUser(ids.editorA1)
    const before = (await q('select updated_at from public.form_submissions where id=$1', [ids.subA1]))[0].updated_at
    const r = await client.query(`update public.form_submissions set status='processed' where id=$1`, [ids.subA1])
    expect(r.rowCount).toBe(1)
    const after = await q('select status, updated_at from public.form_submissions where id=$1', [ids.subA1])
    expect(after[0].status).toBe('processed')
    expect(after[0].updated_at >= before).toBe(true)
  })
  it('editor A1 cannot touch A2 or B1, and cannot change any column but status', async () => {
    await asUser(ids.editorA1)
    expect((await client.query(`update public.form_submissions set status='archived' where id = any($1)`, [[ids.subA2, ids.subB1]])).rowCount).toBe(0)
    await denied(`update public.form_submissions set submission_data='{}' where id=$1`, [ids.subA1])
    await denied(`update public.form_submissions set project_id=$1 where id=$2`, [ids.B1, ids.subA1])
    await denied(`insert into public.form_submissions (form_id, form_version, project_id) values ('f',1,$1)`, [ids.A1])
    await denied(`delete from public.form_submissions where id=$1`, [ids.subA1])
  })
  it('viewer A1 reads A1 but cannot change status', async () => {
    await asUser(ids.viewerA1)
    expect(await idsOf('form_submissions')).toEqual([ids.subA1])
    expect((await client.query(`update public.form_submissions set status='archived' where id=$1`, [ids.subA1])).rowCount).toBe(0)
  })
  it('owner A has no direct write path on structure or metering tables', async () => {
    await asUser(ids.ownerA)
    await denied(`insert into public.projects (slug, tenant_id, name) values ('x',$1,'x')`, [ids.tenantA])
    await denied(`update public.projects set name='x' where id=$1`, [ids.A1])
    await denied(`delete from public.projects where id=$1`, [ids.A2])
    await denied(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tenantB, ids.ownerA])
    await denied(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.B1, ids.ownerA])
    await denied(`update public.tenants set display_name='x' where id=$1`, [ids.tenantA])
    await denied(`insert into public.translation_usage (project_id, provider, source_locale, target_locale, characters) values ($1,'deepl','it','en',0)`, [ids.A1])
    await denied(`delete from public.translation_usage where id=$1`, [ids.tuA1])
    await denied(`update public.inquiries set status='spam' where id=$1`, [ids.inqA1])
    await denied(`update public.form_events set status='dead' where event_id=$1`, [ids.evA1])
    await denied(`select public.translation_usage_month_total($1, now())`, [ids.A1])
  })
  it('profiles: own full_name only', async () => {
    await asUser(ids.ownerA)
    expect((await client.query(`update public.profiles set full_name='A' where id=$1`, [ids.ownerA])).rowCount).toBe(1)
    expect((await client.query(`update public.profiles set full_name='pwn' where id=$1`, [ids.ownerB])).rowCount).toBe(0)
    await denied(`update public.profiles set id=$1 where id=$2`, [ids.nobody, ids.ownerA])
  })
})

describe('028 as tenant B — mirror image', () => {
  it('owner B sees only B, cannot update A', async () => {
    await asUser(ids.ownerB)
    expect(await idsOf('tenants')).toEqual([ids.tenantB])
    expect(await idsOf('projects')).toEqual([ids.B1])
    expect(await idsOf('form_submissions')).toEqual([ids.subB1])
    expect(await idsOf('form_events', 'event_id')).toEqual([ids.evB1])
    expect(await idsOf('translation_usage')).toEqual([ids.tuB1])
    expect(await idsOf('inquiries')).toEqual([ids.inqB1])
    expect((await client.query(`update public.form_submissions set status='spam' where id=$1`, [ids.subA1])).rowCount).toBe(0)
  })
  it('a user with no memberships sees nothing but their own profile', async () => {
    await asUser(ids.nobody)
    for (const [t, k] of Object.entries(APP_TABLES)) {
      const got = await idsOf(t, k)
      expect(got).toEqual(t === 'profiles' ? [ids.nobody] : [])
    }
  })
})

describe('028 as abluo_admin — reads every dashboard ONLY with 2FA (aal2), writes nothing', () => {
  for (const [label, claims] of [['aal2 + top-level claim (hook)', { platform_role: 'abluo_admin', aal: 'aal2' }],
    ['aal2 + app_metadata claim', { app_metadata: { platform_role: 'abluo_admin' }, aal: 'aal2' }]]) {
    it(`${label}: reads exactly what the superuser sees, on every table but profiles`, async () => {
      const all = {}
      for (const [t, k] of Object.entries(APP_TABLES)) all[t] = await idsOf(t, k)
      await asUser(ids.admin, claims)
      for (const [t, k] of Object.entries(APP_TABLES)) {
        if (t === 'profiles') expect(await idsOf(t, k)).toEqual([ids.admin])
        else expect(await idsOf(t, k), t).toEqual(all[t])
      }
      expect((await idsOf('form_submissions')).length).toBeGreaterThanOrEqual(3)
      expect(await idsOf('inquiries')).toContain(ids.inqPlatform)
    })
  }
  for (const [label, claims] of [
    ['aal1 (password only), both flags', { platform_role: 'abluo_admin', app_metadata: { platform_role: 'abluo_admin' }, aal: 'aal1' }],
    ['no aal claim', { platform_role: 'abluo_admin', app_metadata: { platform_role: 'abluo_admin' } }],
    ['malformed aal', { platform_role: 'abluo_admin', aal: 'AAL2' }],
    ['aal2 in app_metadata only', { platform_role: 'abluo_admin', app_metadata: { aal: 'aal2' } }],
  ]) {
    it(`admin without a 2FA session (${label}) gets NO cross-tenant rows`, async () => {
      await asUser(ids.admin, claims)
      expect((await q('select public.is_abluo_admin() as v'))[0].v).toBe(false)
      for (const [t, k] of Object.entries(APP_TABLES)) {
        expect(await idsOf(t, k), t).toEqual(t === 'profiles' ? [ids.admin] : [])
      }
    })
  }
  it('tenant users are unaffected by aal: owner A reads the same rows at aal1 and aal2', async () => {
    const view = async (aal) => {
      await asUser(ids.ownerA, { aal })
      const out = {}
      for (const [t, k] of Object.entries(APP_TABLES)) out[t] = await idsOf(t, k)
      await reset()
      return out
    }
    const a1 = await view('aal1'); const a2 = await view('aal2')
    expect(a1).toEqual(a2)
    expect(a1.form_submissions).toEqual(sorted(ids.subA1, ids.subA2))
    expect(a1.tenants).toEqual([ids.tenantA])
  })
  it('tenant owner with aal2 and NO admin flag still sees only tenant A', async () => {
    await asUser(ids.ownerA, { aal: 'aal2', app_metadata: { platform_role: 'tenant_user' } })
    expect(await idsOf('tenants')).toEqual([ids.tenantA])
    expect(await idsOf('form_submissions')).toEqual(sorted(ids.subA1, ids.subA2))
  })
  it('admin cannot write', async () => {
    await asAdmin()
    expect((await client.query(`update public.form_submissions set status='spam' where id=$1`, [ids.subB1])).rowCount).toBe(0)
    await denied(`insert into public.tenants (slug, display_name) values ('x','x')`)
    await denied(`delete from public.form_submissions where id=$1`, [ids.subB1])
  })
  it('spoofed / malformed admin claims get nothing', async () => {
    for (const claims of [{ user_metadata: { platform_role: 'abluo_admin' }, aal: 'aal2' }, { platform_role: 'ABLUO_ADMIN', aal: 'aal2' },
      { platform_role: ' abluo_admin', aal: 'aal2' }, { app_metadata: { platform_role: 'abluo_admin ' }, aal: 'aal2' }]) {
      await asUser(ids.nobody, claims)
      expect(await idsOf('form_submissions')).toEqual([])
      expect(await idsOf('tenants')).toEqual([])
      await reset()
    }
  })
})

describe('028 keeps the server paths working', () => {
  it('service_role (server routes) can still insert a submission and an event', async () => {
    await client.query(`select public.set_session_auth(null, 'service_role')`)
    const s = await q(`insert into public.form_submissions (project_id, form_id, form_version) values ($1,'f',1) returning id`, [ids.B1])
    await q(`insert into public.form_events (project_id, form_id, form_version, submission_id) values ($1,'f',1,$2)`, [ids.B1, s[0].id])
    await q(`insert into public.translation_usage (project_id, provider, source_locale, target_locale, characters) values ($1,'deepl','it','en',1)`, [ids.B1])
    expect(Number((await q(`select public.translation_usage_month_total($1, now() - interval '1 day') as n`, [ids.B1]))[0].n)).toBe(101)
  })
  it('invite trigger still creates membership when fired by supabase_auth_admin (no EXECUTE needed)', async () => {
    await client.query('set role supabase_auth_admin')
    await client.query('begin')
    const { rows } = await client.query(`insert into auth.users (email, raw_user_meta_data) values ('inv@h.test', $1::jsonb) returning id`,
      [JSON.stringify({ project_id: ids.A2, role: 'viewer' })])
    await client.query(`update auth.users set invited_at = now() where id=$1`, [rows[0].id])
    await client.query('commit')
    await reset()
    expect((await q(`select role from public.project_members where user_id=$1`, [rows[0].id]))).toEqual([{ role: 'viewer' }])
    expect((await q(`select 1 from public.profiles where id=$1`, [rows[0].id])).length).toBe(1)
  })
})

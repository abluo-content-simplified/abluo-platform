/**
 * Migration 040 — Connections (ADR-031 V1 step 3).
 * Production shape: 014–036, then 040. Proves: API roles (even a tenant
 * Owner) can neither read nor write any of the six tables while the service
 * role can; secrets are hashes only; a connection belongs to exactly one
 * project of its own tenant and never moves; one live connection per app per
 * project; codes are single-use-shaped (PKCE S256, ≤ 10 minutes); tokens
 * rotate; cascades; and the migration refuses to run twice.
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
  '035_whats_new.sql', '036_analytics_snapshots.sql']
const M040 = MIG('040_connections.sql')
const TABLES = ['partner_apps', 'connections', 'connection_tokens', 'oauth_codes', 'api_tombstones', 'api_usage']

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
const HEX = (c) => c.repeat(64)
let n = 0
const hex = () => { n += 1; return n.toString(16).padStart(64, '0') }
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' // RFC 7636 example, 43 chars

async function app(cols = {}) {
  n += 1
  const c = {
    name: 'TableRes',
    client_id: `abluo_app_${String(n).padStart(16, 'a')}`,
    client_secret_hash: hex(),
    redirect_uris: ['https://app.tableres.test/oauth/callback'],
    ...cols,
  }
  const keys = Object.keys(c)
  return (await q(`insert into public.partner_apps (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, keys.map((k) => c[k])))[0]
}
async function conn(cols = {}) {
  const c = {
    app_id: ids.app,
    tenant_id: ids.tA,
    project_id: ids.A1,
    consent: JSON.stringify({ by: ids.owner, at: new Date().toISOString(), resources: { events: { fields: ['title'] } } }),
    ...cols,
  }
  const keys = Object.keys(c)
  return (await q(`insert into public.connections (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, keys.map((k) => c[k])))[0]
}
const inHour = () => new Date(Date.now() + 3600_000).toISOString()

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M040)
  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('cn-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('cn-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('cn-a1',$1,'A1') returning id`, [ids.tA])
  ids.A2 = await one(`insert into public.projects (slug, tenant_id, name) values ('cn-a2',$1,'A2') returning id`, [ids.tA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('cn-b1',$1,'B1') returning id`, [ids.tB])
  ids.owner = await one(`insert into auth.users (email) values ('owner@cn.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tA, ids.owner])
  ids.app = (await app({ status: 'approved', approved_at: new Date().toISOString() })).id
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('040 server-only access', () => {
  it('RLS on, no policies, for every table', async () => {
    for (const t of TABLES) {
      const [r] = await q(`select relrowsecurity from pg_class where oid = $1::regclass`, [`public.${t}`])
      expect(r.relrowsecurity, t).toBe(true)
      expect((await q(`select 1 from pg_policies where schemaname='public' and tablename=$1`, [t])).length, t).toBe(0)
    }
  })

  it('a tenant Owner and anon can neither read nor write any table', async () => {
    const c = await conn()
    for (const who of [() => asUser(ids.owner), asAnon]) {
      for (const t of TABLES) {
        await who()
        const e = await errOf(() => q(`select * from public.${t} limit 1`))
        expect(e?.code, `${t} select`).toBe('42501')
      }
      await who()
      expect((await errOf(() => q(`update public.connections set status='paused' where id=$1`, [c.id])))?.code).toBe('42501')
      await who()
      expect((await errOf(() => q(`delete from public.partner_apps`)))?.code).toBe('42501')
    }
    await q(`delete from public.connections where id=$1`, [c.id])
  })

  it('the service role reads and writes', async () => {
    await asService()
    const c = await conn()
    expect((await q(`select id from public.connections where id=$1`, [c.id])).length).toBe(1)
    await q(`insert into public.api_usage (connection_id, method, endpoint, status) values ($1,'GET','/api/v1/events',200)`, [c.id])
    await q(`insert into public.api_tombstones (project_id, resource, public_id, reason) values ($1,'event',gen_random_uuid(),'deleted')`, [ids.A1])
    await reset()
    await q(`delete from public.connections where id=$1`, [c.id])
  })
})

describe('040 secrets are hashes only', () => {
  it('client secret, token and code columns refuse anything but a 64-hex digest', async () => {
    for (const bad of ['abluo_cs_plaintextsecret', HEX('A'), HEX('a').slice(1), '']) {
      expect((await errOf(() => app({ client_secret_hash: bad })))?.code, bad).toBe('23514')
    }
    const c = await conn()
    for (const bad of ['abluo_at_live_token_value', HEX('Z')]) {
      expect((await errOf(() => q(
        `insert into public.connection_tokens (connection_id, kind, token_hash, token_prefix, expires_at) values ($1,'access',$2,'abluo_at_abcd',$3)`,
        [c.id, bad, inHour()],
      )))?.code, bad).toBe('23514')
    }
    expect((await errOf(() => q(
      `insert into public.oauth_codes (code_hash, app_id, connection_id, code_challenge, redirect_uri, expires_at) values ('plain-code',$1,$2,$3,'https://x.test/cb',now() + interval '5 minutes')`,
      [ids.app, c.id, CHALLENGE],
    )))?.code).toBe('23514')
    await q(`delete from public.connections where id=$1`, [c.id])
  })

  it('a token prefix shows its kind and only 4 characters', async () => {
    const c = await conn()
    const ins = (kind, prefix) => q(
      `insert into public.connection_tokens (connection_id, kind, token_hash, token_prefix, expires_at) values ($1,$2,$3,$4,$5)`,
      [c.id, kind, hex(), prefix, inHour()],
    )
    await ins('access', 'abluo_at_Ab12')
    await ins('refresh', 'abluo_rt_Ab12')
    for (const [kind, prefix] of [['access', 'abluo_rt_Ab12'], ['refresh', 'abluo_at_Ab12'], ['access', 'abluo_at_Ab12345678']]) {
      expect((await errOf(() => ins(kind, prefix)))?.code, `${kind} ${prefix}`).toBe('23514')
    }
    await q(`delete from public.connections where id=$1`, [c.id])
  })
})

describe('040 partner apps', () => {
  it('redirect URIs: exact https, or http://localhost only; no wildcards', async () => {
    await app({ redirect_uris: ['https://a.test/cb', 'http://localhost:3000/cb'] })
    for (const bad of [['http://a.test/cb'], ['https://*.a.test/cb'], ['javascript:alert(1)'], ['https://a.test/cb#x'], []]) {
      expect((await errOf(() => app({ redirect_uris: bad })))?.code, JSON.stringify(bad)).toBe('23514')
    }
  })
  it('pending ⇔ never approved', async () => {
    expect((await errOf(() => app({ status: 'approved' })))?.code).toBe('23514')
    expect((await errOf(() => app({ status: 'pending', approved_at: new Date().toISOString() })))?.code).toBe('23514')
    await app({ status: 'suspended', approved_at: new Date().toISOString() })
  })
  it('an app with connections cannot be deleted (suspend it instead)', async () => {
    const c = await conn()
    // ON DELETE RESTRICT → restrict_violation
    expect((await errOf(() => q(`delete from public.partner_apps where id=$1`, [ids.app])))?.code).toBe('23001')
    await q(`delete from public.connections where id=$1`, [c.id])
  })
})

describe('040 connections', () => {
  it('belongs to exactly one project of its own tenant', async () => {
    expect((await errOf(() => conn({ project_id: null })))?.code).toBe('23502')
    expect((await errOf(() => conn({ project_id: ids.B1 })))?.code).toBe('23514') // B1 is tenant B's
    const c = await conn({ tenant_id: ids.tB, project_id: ids.B1 })
    await q(`delete from public.connections where id=$1`, [c.id])
  })
  it('never moves to another app, tenant or project', async () => {
    const c = await conn()
    expect((await errOf(() => q(`update public.connections set project_id=$2 where id=$1`, [c.id, ids.A2])))?.code).toBe('23514')
    const other = await app({ status: 'approved', approved_at: new Date().toISOString() })
    expect((await errOf(() => q(`update public.connections set app_id=$2 where id=$1`, [c.id, other.id])))?.code).toBe('23514')
    await q(`delete from public.connections where id=$1`, [c.id])
  })
  it('one live connection per app per project; revoked ones are history and stay revoked', async () => {
    const c = await conn()
    expect((await errOf(() => conn()))?.code).toBe('23505')
    await q(`update public.connections set status='revoked', revoked_at=now() where id=$1`, [c.id])
    const again = await conn()
    expect((await errOf(() => q(`update public.connections set status='active', revoked_at=null where id=$1`, [c.id])))?.code).toBe('23514')
    await q(`delete from public.connections where id = any($1)`, [[c.id, again.id]])
  })
  it('needs a consent record; revoked ⇔ revoked_at; delivery is pull and/or push', async () => {
    expect((await errOf(() => conn({ consent: '{}' })))?.code).toBe('23514')
    expect((await errOf(() => conn({ status: 'revoked' })))?.code).toBe('23514')
    expect((await errOf(() => conn({ delivery: ['email'] })))?.code).toBe('23514')
    expect((await errOf(() => conn({ delivery: [] })))?.code).toBe('23514')
  })
  it('updated_at moves on update', async () => {
    const c = await conn()
    await q(`select pg_sleep(0.02)`)
    const [u] = await q(`update public.connections set status='paused' where id=$1 returning updated_at`, [c.id])
    expect(new Date(u.updated_at) > new Date(c.updated_at)).toBe(true)
    await q(`delete from public.connections where id=$1`, [c.id])
  })
  it('deleting a project removes its connections, tokens, codes, usage and tombstones', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('cn-tmp',$1,'T') returning id`, [ids.tA])
    const c = await conn({ project_id: p })
    await q(`insert into public.connection_tokens (connection_id, kind, token_hash, token_prefix, expires_at) values ($1,'access',$2,'abluo_at_abcd',$3)`, [c.id, hex(), inHour()])
    await q(`insert into public.oauth_codes (code_hash, app_id, connection_id, code_challenge, redirect_uri, expires_at) values ($1,$2,$3,$4,'https://x.test/cb',now() + interval '5 minutes')`, [hex(), ids.app, c.id, CHALLENGE])
    await q(`insert into public.api_usage (connection_id, method, endpoint, status) values ($1,'GET','/api/v1/events',200)`, [c.id])
    await q(`insert into public.api_tombstones (project_id, resource, public_id, reason) values ($1,'event',gen_random_uuid(),'unlisted')`, [p])
    await q(`delete from public.projects where id=$1`, [p])
    for (const [t, col, v] of [['connections', 'id', c.id], ['connection_tokens', 'connection_id', c.id], ['oauth_codes', 'connection_id', c.id], ['api_usage', 'connection_id', c.id], ['api_tombstones', 'project_id', p]]) {
      expect((await q(`select 1 from public.${t} where ${col}=$1`, [v])).length, t).toBe(0)
    }
  })
})

describe('040 codes and tokens', () => {
  it('codes: PKCE S256 only, ≤ 10 minutes', async () => {
    const c = await conn()
    const ins = (cols) => q(
      `insert into public.oauth_codes (code_hash, app_id, connection_id, code_challenge, code_challenge_method, redirect_uri, expires_at) values ($1,$2,$3,$4,$5,'https://x.test/cb',$6)`,
      [hex(), ids.app, c.id, cols.challenge ?? CHALLENGE, cols.method ?? 'S256', cols.expires ?? new Date(Date.now() + 300_000).toISOString()],
    )
    await ins({})
    expect((await errOf(() => ins({ method: 'plain' })))?.code).toBe('23514')
    expect((await errOf(() => ins({ challenge: 'short' })))?.code).toBe('23514')
    expect((await errOf(() => ins({ expires: new Date(Date.now() + 3600_000).toISOString() })))?.code).toBe('23514')
    await q(`delete from public.connections where id=$1`, [c.id])
  })
  it('refresh tokens rotate through replaced_by; access tokens never do', async () => {
    const c = await conn()
    const tok = async (kind, pre) => (await q(
      `insert into public.connection_tokens (connection_id, kind, token_hash, token_prefix, expires_at) values ($1,$2,$3,$4,$5) returning id`,
      [c.id, kind, hex(), pre, inHour()],
    ))[0].id
    const r1 = await tok('refresh', 'abluo_rt_aaaa')
    const r2 = await tok('refresh', 'abluo_rt_bbbb')
    await q(`update public.connection_tokens set replaced_by=$2, retired_at=now() where id=$1`, [r1, r2])
    const a1 = await tok('access', 'abluo_at_cccc')
    expect((await errOf(() => q(`update public.connection_tokens set replaced_by=$2 where id=$1`, [a1, r2])))?.code).toBe('23514')
    expect((await errOf(() => q(
      `insert into public.connection_tokens (connection_id, kind, token_hash, token_prefix, expires_at, created_at) values ($1,'access',$2,'abluo_at_dddd',now() - interval '1 hour', now())`,
      [c.id, hex()],
    )))?.code).toBe('23514')
    await q(`delete from public.connections where id=$1`, [c.id])
  })
})

describe('040 re-run', () => {
  it('refuses to run twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M040))
    expect(String(e?.message)).toMatch(/already applied/)
  })
})

describe('040 rollback', () => {
  it('refuses while partner apps exist (real consent records and credentials)', async () => {
    const e = await errOf(() => applyMigrationFile(client, path.join(__dirname, 'rollback-040.sql')))
    expect(String(e?.message)).toMatch(/refusing to drop real data/)
    expect((await q(`select to_regclass('public.connections') is not null as ok`))[0].ok).toBe(true)
  })
  it('drops everything once empty', async () => {
    await q(`delete from public.connections`)
    await q(`delete from public.partner_apps`)
    await applyMigrationFile(client, path.join(__dirname, 'rollback-040.sql'))
    for (const t of TABLES) expect((await q(`select to_regclass($1) is null as gone`, [`public.${t}`]))[0].gone, t).toBe(true)
  })
})

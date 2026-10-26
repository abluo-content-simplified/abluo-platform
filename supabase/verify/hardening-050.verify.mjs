/**
 * Migration 050 — Site Access (ADR-040). Proves, against a real Postgres:
 *  - nobody but the service role reads or writes any site_access table or calls
 *    any site_access function (anon, a project editor and the tenant Owner alike);
 *  - tenant isolation lives in the schema: composite foreign keys refuse a
 *    credential→group, document→group, grant→credential or file→document link
 *    across projects, and every function is keyed on the project it is given;
 *  - groups are resolved LIVE: OR across a visitor's credentials, a removed or
 *    archived group stops counting on the next resolve;
 *  - rotation and disabling revoke what they must and nothing else;
 *  - unlock rotates the session token (fixation), refuses a stale version;
 *  - expiry, logout, revoke-all; limits; private bucket; purge; no re-run;
 *  - B2.0: sessions are bound to their environment; the rate-limit reservation
 *    is atomic (20 parallel attempts from one IP on separate connections get
 *    exactly the allowance); abandoned reservations expire with the window;
 *    and the five concurrency scenarios of the B1 review, on two real
 *    connections.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import pg from 'pg'
import { createHash, randomBytes } from 'node:crypto'
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
const M050 = MIG('050_site_access.sql')
const TABLES = ['site_access_groups', 'site_access_credentials', 'site_access_credential_secrets',
  'site_access_credential_groups', 'site_access_sessions', 'site_access_session_grants', 'site_access_attempts',
  'site_access_documents', 'site_access_document_files', 'site_access_document_groups', 'site_access_events']
const HASH = 'scrypt$32768$8$1$c2FsdA$aGFzaA'   // shape only; the app verifies, not the DB
const DAY = 86400
const tok = () => randomBytes(32).toString('base64url')
const sha = (s) => createHash('sha256').update(s).digest('hex')

let client, CONN
const ids = {}
async function reset() { await client.query('select public.reset_session_auth()') }
async function asUser(id) { await client.query(`select public.set_session_auth($1::uuid, 'authenticated', '{}'::jsonb)`, [id]) }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asService() { await client.query(`select public.set_session_auth(null, 'service_role')`) }
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function sq(sql, params) { await asService(); try { return await q(sql, params) } finally { await reset() } }
const one = async (sql, p) => (await q(sql, p))[0].id
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} await reset(); return e }
}

async function group(project, name = 'Members') {
  return (await sq(`insert into public.site_access_groups (project_id, name) values ($1, $2::jsonb) returning id`,
    [project, JSON.stringify({ en: name })]))[0].id
}
async function credential(project, groupIds, label = 'pw') {
  return (await sq(`select public.site_access_create_credential($1, $2, $3, $4::uuid[], null, $5) as id`,
    [project, label, HASH, groupIds, ids.ownerA]))[0].id
}
async function version(credId) { return (await sq(`select secret_version v from public.site_access_credentials where id = $1`, [credId]))[0].v }
async function unlock(project, credId, currentToken = null, v = null, env = 'production') {
  const t = tok()
  const ver = v ?? await version(credId)
  await sq(`select public.site_access_unlock($1, $2, $3, $4, $5, $6, $7, null)`,
    [project, env, credId, ver, currentToken ? sha(currentToken) : null, sha(t), 30 * DAY])
  return t
}
async function resolve(project, token, env = 'production') {
  const rows = await sq(`select * from public.site_access_resolve($1, $2, $3)`, [project, sha(token), env])
  return rows[0] ?? null
}
const LIMITS = [900, 5, 2, 30, 50]   // window, per IP+project, under pressure, per IP all projects, project pressure
async function reserve(c, project, ipHash, limits = LIMITS) {
  return (await c.query(`select * from public.site_access_reserve_attempt($1, $2, $3, $4, $5, $6, $7)`, [project, ipHash, ...limits])).rows[0]
}
const sorted = (a) => [...a].sort()

beforeAll(async () => {
  ;({ client, connectionString: CONN } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M050)
  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('sa-a','A') returning id`)
  ids.tB = await one(`insert into public.tenants (slug, display_name) values ('sa-b','B') returning id`)
  ids.pA = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-a1',$1,'A1') returning id`, [ids.tA])
  ids.pA2 = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-a2',$1,'A2') returning id`, [ids.tA])
  ids.pB = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-b1',$1,'B1') returning id`, [ids.tB])
  for (const u of ['ownerA', 'editorA']) ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@sa.test`])
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tA, ids.ownerA])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.pA, ids.editorA])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('050 — locked to the service role', () => {
  it('anon, a project editor and the tenant Owner cannot read or write any table', async () => {
    const g = await group(ids.pA)
    await credential(ids.pA, [g])
    for (const t of TABLES) {
      for (const who of [() => asAnon(), () => asUser(ids.editorA), () => asUser(ids.ownerA)]) {
        await who()
        expect((await errOf(() => q(`select * from public.${t}`)))?.code, t).toBe('42501')
      }
    }
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`insert into public.site_access_groups (project_id, name) values ($1, '{"en":"x"}')`, [ids.pA])))?.code).toBe('42501')
  })

  it('no function is callable by anon or authenticated', async () => {
    const calls = [
      `select * from public.site_access_resolve('${ids.pA}', '${'0'.repeat(64)}', 'production')`,
      `select public.site_access_unlock('${ids.pA}', 'production', gen_random_uuid(), 1, null, '${'0'.repeat(64)}', 3600, null)`,
      `select * from public.site_access_reserve_attempt('${ids.pA}', '${'0'.repeat(64)}', 900, 5, 2, 30, 50)`,
      `select public.site_access_finish_attempt('${ids.pA}', 1, false)`,
      `select public.site_access_rotate_credential('${ids.pA}', gen_random_uuid(), '${HASH}', null)`,
      `select public.site_access_revoke_sessions('${ids.pA}', null, 'revoked_all', null)`,
      `select * from public.site_access_purge()`,
    ]
    for (const sql of calls) {
      for (const who of [() => asAnon(), () => asUser(ids.ownerA)]) {
        await who()
        expect((await errOf(() => q(sql)))?.code, sql).toBe('42501')
      }
    }
  })

  it('RLS is on and there are no policies', async () => {
    const rows = await q(`select relname, relrowsecurity from pg_class where relname = any($1)`, [TABLES])
    expect(rows).toHaveLength(TABLES.length)
    expect(rows.every((r) => r.relrowsecurity)).toBe(true)
    expect(await q(`select 1 from pg_policies where tablename = any($1)`, [TABLES])).toHaveLength(0)
  })
})

describe('050 — isolation is enforced by the schema', () => {
  it('a credential of project A cannot open a group of project B', async () => {
    const gB = await group(ids.pB)
    const e = await errOf(() => sq(`select public.site_access_create_credential($1, 'x', $2, $3::uuid[], null, null)`, [ids.pA, HASH, [gB]]))
    expect(e?.code).toBe('23503')
    // …and the whole call rolled back: no half-made credential left behind.
    expect(await sq(`select 1 from public.site_access_credentials where label = 'x' and project_id = $1`, [ids.pA])).toHaveLength(0)
  })

  it('not even within one tenant: project A2 cannot use a group of A', async () => {
    const gA = await group(ids.pA)
    const e = await errOf(() => sq(`select public.site_access_create_credential($1, 'y', $2, $3::uuid[], null, null)`, [ids.pA2, HASH, [gA]]))
    expect(e?.code).toBe('23503')
  })

  it('a document cannot allow another project\'s group, a file cannot sit under another project\'s document', async () => {
    const gB = await group(ids.pB)
    const doc = (await sq(`insert into public.site_access_documents (project_id, title) values ($1, '{"en":"Timetable"}') returning id`, [ids.pA]))[0].id
    expect((await errOf(() => sq(`insert into public.site_access_document_groups (document_id, group_id, project_id) values ($1,$2,$3)`, [doc, gB, ids.pA])))?.code).toBe('23503')
    expect((await errOf(() => sq(`insert into public.site_access_document_groups (document_id, group_id, project_id) values ($1,$2,$3)`, [doc, gB, ids.pB])))?.code).toBe('23503')
    expect((await errOf(() => sq(
      `insert into public.site_access_document_files (document_id, project_id, locale, storage_path, mime_type, size_bytes, sha256)
       values ($1, $2::uuid, 'en', $2::text || '/f.pdf', 'application/pdf', 10, $3)`, [doc, ids.pB, '0'.repeat(64)])))?.code).toBe('23503')
  })

  it('a file path must start with its own project id; PDF only; 20 MB max', async () => {
    const doc = (await sq(`insert into public.site_access_documents (project_id, title) values ($1, '{"en":"T"}') returning id`, [ids.pA]))[0].id
    const ins = (p, mime, size) => sq(
      `insert into public.site_access_document_files (document_id, project_id, locale, storage_path, mime_type, size_bytes, sha256)
       values ($1, $2, 'en', $3, $4, $5, $6)`, [doc, ids.pA, p, mime, size, '0'.repeat(64)])
    expect((await errOf(() => ins(`${ids.pB}/x.pdf`, 'application/pdf', 10)))?.code).toBe('23514')
    expect((await errOf(() => ins(`${ids.pA}/x.png`, 'image/png', 10)))?.code).toBe('23514')
    expect((await errOf(() => ins(`${ids.pA}/x.pdf`, 'application/pdf', 20971521)))?.code).toBe('23514')
    expect(await errOf(() => ins(`${ids.pA}/ok.pdf`, 'application/pdf', 20971520))).toBeNull()
  })

  it('a session token of project A resolves to nothing on project B', async () => {
    const g = await group(ids.pA)
    const c = await credential(ids.pA, [g])
    const t = await unlock(ids.pA, c)
    expect(await resolve(ids.pA, t)).not.toBeNull()
    expect(await resolve(ids.pB, t)).toBeNull()
    expect(await resolve(ids.pA2, t)).toBeNull()
  })

  it('unlocking project B with project A\'s credential is refused', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const e = await errOf(() => unlock(ids.pB, c))
    expect(e?.message).toContain('site_access:credential_unavailable')
  })

  it('an unlock on B never rotates or extends a session of A (fixation across projects)', async () => {
    const cA = await credential(ids.pA, [await group(ids.pA)])
    const cB = await credential(ids.pB, [await group(ids.pB)])
    const tA = await unlock(ids.pA, cA)
    const tB = await unlock(ids.pB, cB, tA)          // presents A's token on B
    expect(await resolve(ids.pA, tA)).not.toBeNull() // A untouched
    expect(await resolve(ids.pB, tB)).not.toBeNull() // B got its own new session
    expect((await resolve(ids.pB, tB)).session_id).not.toBe((await resolve(ids.pA, tA)).session_id)
  })

  it('revoke-all on A leaves B alone', async () => {
    const tA = await unlock(ids.pA, await credential(ids.pA, [await group(ids.pA)]))
    const tB = await unlock(ids.pB, await credential(ids.pB, [await group(ids.pB)]))
    await sq(`select public.site_access_revoke_sessions($1, null, 'revoked_all', $2)`, [ids.pA, ids.ownerA])
    expect(await resolve(ids.pA, tA)).toBeNull()
    expect(await resolve(ids.pB, tB)).not.toBeNull()
  })
})

describe('050 — groups resolve live', () => {
  it('one credential may open several groups; two credentials union their groups', async () => {
    const members = await group(ids.pA, 'Members'), teachers = await group(ids.pA, 'Teachers'), staff = await group(ids.pA, 'Staff')
    const teacherPw = await credential(ids.pA, [teachers, members])
    const staffPw = await credential(ids.pA, [staff])
    const t1 = await unlock(ids.pA, teacherPw)
    expect(sorted((await resolve(ids.pA, t1)).group_ids)).toEqual(sorted([teachers, members]))
    const t2 = await unlock(ids.pA, staffPw, t1)
    const r = await resolve(ids.pA, t2)
    expect(sorted(r.group_ids)).toEqual(sorted([teachers, members, staff]))
    expect(sorted(r.credential_ids)).toEqual(sorted([teacherPw, staffPw]))
  })

  it('changing a credential\'s groups takes effect on the next resolve', async () => {
    const a = await group(ids.pA), b = await group(ids.pA)
    const c = await credential(ids.pA, [a, b])
    const t = await unlock(ids.pA, c)
    await sq(`select public.site_access_set_credential_groups($1, $2, $3::uuid[], $4)`, [ids.pA, c, [b], ids.ownerA])
    expect((await resolve(ids.pA, t)).group_ids).toEqual([b])
  })

  it('an archived group stops counting immediately; the session itself survives', async () => {
    const a = await group(ids.pA), b = await group(ids.pA)
    const t = await unlock(ids.pA, await credential(ids.pA, [a, b]))
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [a])
    const r = await resolve(ids.pA, t)
    expect(r.group_ids).toEqual([b])
  })

  it('a credential with no live groups gives a session with no groups (deny by default)', async () => {
    const a = await group(ids.pA)
    const t = await unlock(ids.pA, await credential(ids.pA, [a]))
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [a])
    expect((await resolve(ids.pA, t)).group_ids).toEqual([])
  })

  it('an expired credential stops granting', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const t = await unlock(ids.pA, c)
    await sq(`update public.site_access_credentials set expires_at = now() - interval '1 second' where id = $1`, [c])
    expect((await resolve(ids.pA, t)).group_ids).toEqual([])
  })
})

describe('050 — password-prompt candidates', () => {
  it('lists usable credentials of THIS project with live groups and hashes; filters by the resource\'s groups', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-cand',$1,'C') returning id`, [ids.tA])
    const m = await group(p, 'Members'), t = await group(p, 'Teachers'), old = await group(p, 'Old')
    const memberPw = await credential(p, [m]), teacherPw = await credential(p, [t, m, old])
    const off = await credential(p, [m])
    await sq(`select public.site_access_set_credential_disabled($1, $2, true, null)`, [p, off])
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [old])
    await credential(ids.pB, [await group(ids.pB)])  // another project's — never listed
    const all = await sq(`select * from public.site_access_candidate_credentials($1)`, [p])
    expect(all.map((r) => r.credential_id)).toEqual([memberPw, teacherPw])
    expect(all.every((r) => r.password_hash.startsWith('scrypt$'))).toBe(true)
    expect(sorted(all[1].group_ids)).toEqual(sorted([t, m]))
    const onlyTeachers = await sq(`select credential_id from public.site_access_candidate_credentials($1, $2::uuid[])`, [p, [t]])
    expect(onlyTeachers.map((r) => r.credential_id)).toEqual([teacherPw])
    const viaArchived = await sq(`select credential_id from public.site_access_candidate_credentials($1, $2::uuid[])`, [p, [old]])
    expect(viaArchived).toHaveLength(0)
  })
  it('is not callable by anon or authenticated', async () => {
    await asAnon()
    expect((await errOf(() => q(`select * from public.site_access_candidate_credentials('${ids.pA}')`)))?.code).toBe('42501')
  })
})

describe('050 — rotation, disabling, revocation', () => {
  it('rotation bumps the version, revokes sessions that held only that password, keeps other grants', async () => {
    const m = await group(ids.pA), s = await group(ids.pA)
    const memberPw = await credential(ids.pA, [m]), staffPw = await credential(ids.pA, [s])
    const onlyMember = await unlock(ids.pA, memberPw)
    const both = await unlock(ids.pA, staffPw, await unlock(ids.pA, memberPw))
    const revoked = (await sq(`select public.site_access_rotate_credential($1, $2, $3, $4) as n`, [ids.pA, memberPw, HASH, ids.ownerA]))[0].n
    expect(revoked).toBe(1)
    expect(await version(memberPw)).toBe(2)
    expect(await resolve(ids.pA, onlyMember)).toBeNull()
    expect((await resolve(ids.pA, both)).group_ids).toEqual([s])
    const reason = await sq(`select revoked_reason from public.site_access_sessions where token_hash = $1`, [sha(onlyMember)])
    expect(reason[0].revoked_reason).toBe('credential_rotated')
  })

  it('an unlock checked against the OLD version is refused after rotation (race)', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    await sq(`select public.site_access_rotate_credential($1, $2, $3, null)`, [ids.pA, c, HASH])
    const e = await errOf(() => unlock(ids.pA, c, null, 1))
    expect(e?.message).toContain('site_access:credential_unavailable')
  })

  it('rotation is project-scoped: rotating with the wrong project id does nothing', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const t = await unlock(ids.pA, c)
    const e = await errOf(() => sq(`select public.site_access_rotate_credential($1, $2, $3, null)`, [ids.pB, c, HASH]))
    expect(e?.message).toContain('site_access:not_found')
    expect(await resolve(ids.pA, t)).not.toBeNull()
    expect(await version(c)).toBe(1)
  })

  it('disabling drops grants; re-enabling does not bring old sessions back', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const t = await unlock(ids.pA, c)
    await sq(`select public.site_access_set_credential_disabled($1, $2, true, $3)`, [ids.pA, c, ids.ownerA])
    expect(await resolve(ids.pA, t)).toBeNull()
    expect((await errOf(() => unlock(ids.pA, c)))?.message).toContain('site_access:credential_unavailable')
    await sq(`select public.site_access_set_credential_disabled($1, $2, false, $3)`, [ids.pA, c, ids.ownerA])
    expect(await resolve(ids.pA, t)).toBeNull()
    expect(await resolve(ids.pA, await unlock(ids.pA, c))).not.toBeNull()
  })

  it('unlock replaces the token of the current session (fixation defence)', async () => {
    const c1 = await credential(ids.pA, [await group(ids.pA)]), c2 = await credential(ids.pA, [await group(ids.pA)])
    const first = await unlock(ids.pA, c1)
    const sessionId = (await resolve(ids.pA, first)).session_id
    const second = await unlock(ids.pA, c2, first)
    expect(await resolve(ids.pA, first)).toBeNull()
    expect((await resolve(ids.pA, second)).session_id).toBe(sessionId)
  })

  it('logout revokes one session only', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const t1 = await unlock(ids.pA, c), t2 = await unlock(ids.pA, c)
    const sid = (await resolve(ids.pA, t1)).session_id
    await sq(`select public.site_access_revoke_sessions($1, $2, 'logout', null)`, [ids.pA, sid])
    expect(await resolve(ids.pA, t1)).toBeNull()
    expect(await resolve(ids.pA, t2)).not.toBeNull()
  })

  it('an expired session resolves to nothing', async () => {
    const t = await unlock(ids.pA, await credential(ids.pA, [await group(ids.pA)]))
    await sq(`update public.site_access_sessions set expires_at = now() - interval '1 second' where token_hash = $1`, [sha(t)])
    expect(await resolve(ids.pA, t)).toBeNull()
  })

  it('management changes are audited without any secret', async () => {
    const rows = await sq(`select action, detail::text d from public.site_access_events where project_id = $1`, [ids.pA])
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['credential_created', 'credential_rotated', 'credential_disabled', 'sessions_revoked']))
    expect(rows.some((r) => r.d.includes('scrypt'))).toBe(false)
  })
})

describe('050 — rate-limit counts, limits, bucket, purge', () => {
  it('reservation layers: per IP+project, per IP across projects, project pressure tightens but never to zero', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-rl',$1,'RL') returning id`, [ids.tA])
    const p2 = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-rl2',$1,'RL2') returning id`, [ids.tA])
    await asService()
    const ip = sha('rl-ip-1')
    for (let i = 0; i < 5; i++) expect((await reserve(client, p, ip)).allowed).toBe(true)
    const refused = await reserve(client, p, ip)
    expect(refused).toMatchObject({ allowed: false, attempt_id: null, retry_after_seconds: 900 })
    expect((await reserve(client, p2, ip)).allowed).toBe(true)                      // other project: own allowance
    expect((await reserve(client, p2, ip, [900, 5, 2, 6, 50])).allowed).toBe(false) // …until the cross-project cap
    // pressure: 50 failures from other IPs → a fresh IP gets 2, not 0
    await client.query(`insert into public.site_access_attempts (project_id, ip_hash, succeeded) select $1, encode(sha256(g::text::bytea), 'hex'), false from generate_series(1, 50) g`, [p2])
    const fresh = sha('rl-fresh')
    const first = await reserve(client, p2, fresh)
    expect(first).toMatchObject({ allowed: true, under_pressure: true })
    expect((await reserve(client, p2, fresh)).allowed).toBe(true)
    expect((await reserve(client, p2, fresh)).allowed).toBe(false)
    // a succeeded attempt does not count
    const ok = sha('rl-ok'); const r = await reserve(client, p, ok)
    await client.query(`update public.site_access_attempts set succeeded = true where id = $1`, [r.attempt_id])
    for (let i = 0; i < 5; i++) expect((await reserve(client, p, ok)).allowed).toBe(true)
    await reset()
  })

  it('finish_attempt is project-scoped and final', async () => {
    await asService()
    const r = await reserve(client, ids.pA2, sha('fin-ip'))
    await client.query(`select public.site_access_finish_attempt($1, $2, false)`, [ids.pB, r.attempt_id])   // wrong project
    expect((await q(`select succeeded from public.site_access_attempts where id = $1`, [r.attempt_id]))[0].succeeded).toBeNull()
    await client.query(`select public.site_access_finish_attempt($1, $2, false)`, [ids.pA2, r.attempt_id])
    await client.query(`select public.site_access_finish_attempt($1, $2, true)`, [ids.pA2, r.attempt_id])   // cannot flip
    expect((await q(`select succeeded from public.site_access_attempts where id = $1`, [r.attempt_id]))[0].succeeded).toBe(false)
    await reset()
  })

  it('an abandoned (pending) reservation counts inside the window and never after it', async () => {
    await asService()
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-ab',$1,'AB') returning id`, [ids.tA])
    const ip = sha('abandoned-ip')
    for (let i = 0; i < 5; i++) await reserve(client, p, ip)       // never finished
    expect((await reserve(client, p, ip)).allowed).toBe(false)
    await client.query(`update public.site_access_attempts set created_at = now() - interval '16 minutes' where project_id = $1`, [p])
    expect((await reserve(client, p, ip)).allowed).toBe(true)
    await reset()
  })

  it('unlock marks its reservation succeeded (project-scoped)', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    await asService()
    const r = await reserve(client, ids.pA, sha('unlock-ip'))
    await client.query(`select public.site_access_unlock($1, 'production', $2, 1, null, $3, 3600, $4)`, [ids.pA, c, sha(tok()), r.attempt_id])
    expect((await q(`select succeeded from public.site_access_attempts where id = $1`, [r.attempt_id]))[0].succeeded).toBe(true)
    await reset()
  })

  it('rejects malformed limits and IP hashes', async () => {
    await asService()
    expect((await errOf(() => reserve(client, ids.pA, 'not-a-hash')))?.message).toContain('site_access:invalid_rate_limit')
    expect((await errOf(() => reserve(client, ids.pA, sha('x'), [900, 0, 2, 30, 50])))?.message).toContain('site_access:invalid_rate_limit')
  })

  it('caps groups per project and grants per session', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-lim',$1,'L') returning id`, [ids.tA])
    await sq(`insert into public.site_access_groups (project_id, name) select $1, '{"en":"g"}' from generate_series(1, 100)`, [p])
    expect((await errOf(() => group(p)))?.message).toContain('site_access:too_many_groups')
    const gs = (await sq(`select id from public.site_access_groups where project_id = $1 limit 21`, [p])).map((r) => r.id)
    let t = null
    for (let i = 0; i < 20; i++) t = await unlock(p, await credential(p, [gs[i]]), t)
    const c21 = await credential(p, [gs[20]])
    expect((await errOf(() => unlock(p, c21, t)))?.message).toContain('site_access:too_many_grants')
  })

  it('the bucket is private, PDF only, 20 MB', async () => {
    const b = (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'site-access-files'`))[0]
    expect(b).toEqual({ public: false, file_size_limit: '20971520', allowed_mime_types: ['application/pdf'] })
  })

  it('purge removes old attempts and long-dead sessions only', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const live = await unlock(ids.pA, c)
    const dead = await unlock(ids.pA, c)
    await sq(`update public.site_access_sessions set expires_at = now() - interval '100 days' where token_hash = $1`, [sha(dead)])
    await sq(`insert into public.site_access_attempts (project_id, ip_hash, succeeded, created_at) values ($1, $2, false, now() - interval '40 days'), ($1, $2, null, now() - interval '40 days')`, [ids.pA, sha('old')])
    const r = (await sq(`select * from public.site_access_purge(30, 90)`))[0]
    expect(r.attempts_deleted).toBeGreaterThanOrEqual(2)   // abandoned pending rows are purged too
    expect(r.sessions_deleted).toBe(1)
    expect(await resolve(ids.pA, live)).not.toBeNull()
  })

  it('refuses to run twice', async () => {
    const e = await errOf(() => applyMigrationFile(client, M050))
    expect(e?.message).toContain('050: already applied')
  })
})

describe('B2.0 — sessions are bound to their environment', () => {
  it('a session resolves only in the environment that created it', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const t = await unlock(ids.pA, c, null, null, 'dev')
    expect(await resolve(ids.pA, t, 'dev')).not.toBeNull()
    for (const env of ['production', 'preview', 'local']) expect(await resolve(ids.pA, t, env)).toBeNull()
  })
  it('an unlock in production presenting a dev token never rotates or extends the dev session', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    const dev = await unlock(ids.pA, c, null, null, 'dev')
    const prod = await unlock(ids.pA, c, dev, null, 'production')
    expect(await resolve(ids.pA, dev, 'dev')).not.toBeNull()
    expect((await resolve(ids.pA, prod, 'production')).session_id).not.toBe((await resolve(ids.pA, dev, 'dev')).session_id)
  })
  it('an unknown or missing environment is refused by the database', async () => {
    const c = await credential(ids.pA, [await group(ids.pA)])
    for (const env of ['staging', null, 'Production']) {
      expect((await errOf(() => unlock(ids.pA, c, null, null, env)))?.message).toContain('site_access:invalid_environment')
    }
    expect((await errOf(() => sq(`insert into public.site_access_sessions (project_id, token_hash, environment, expires_at) values ($1, $2, 'staging', now() + interval '1 day')`, [ids.pA, sha(tok())])))?.code).toBe('23514')
  })
  it('project-level data is shared: rotation and sign-out-everyone reach every environment', async () => {
    const c = await credential(ids.pA2, [await group(ids.pA2)])
    const dev = await unlock(ids.pA2, c, null, null, 'dev'), prod = await unlock(ids.pA2, c, null, null, 'production')
    await sq(`select public.site_access_rotate_credential($1, $2, $3, null)`, [ids.pA2, c, HASH])
    expect(await resolve(ids.pA2, dev, 'dev')).toBeNull()
    expect(await resolve(ids.pA2, prod, 'production')).toBeNull()
    const c2 = await credential(ids.pA2, [await group(ids.pA2)])
    const d2 = await unlock(ids.pA2, c2, null, null, 'preview'), p2 = await unlock(ids.pA2, c2, null, null, 'production')
    await sq(`select public.site_access_revoke_sessions($1, null, 'revoked_all', null)`, [ids.pA2])
    expect(await resolve(ids.pA2, d2, 'preview')).toBeNull()
    expect(await resolve(ids.pA2, p2, 'production')).toBeNull()
  })
})

describe('B2.0 — concurrency on real parallel connections (regression)', () => {
  let conns = []
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const svc = (c) => c.query(`select public.set_session_auth(null, 'service_role')`)
  beforeAll(async () => {
    for (let i = 0; i < 6; i++) {
      const c = new pg.Client({ connectionString: CONN })
      await c.connect(); await svc(c); conns.push(c)
    }
  })
  afterAll(async () => { for (const c of conns) await c.end() })
  const unlockOn = (c, project, cred, ver, cur, nw) =>
    c.query(`select public.site_access_unlock($1, 'production', $2, $3, $4, $5, 2592000, null) id`, [project, cred, ver, cur, nw])

  it('1. 20 parallel reservations from one IP on 6 connections: exactly 5 allowed', async () => {
    const p = await one(`insert into public.projects (slug, tenant_id, name) values ('sa-par',$1,'PAR') returning id`, [ids.tA])
    const ip = sha('parallel-ip')
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(conns[i % conns.length], p, ip)))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
    expect(await sq(`select count(*)::int n from public.site_access_attempts where project_id = $1`, [p])).toEqual([{ n: 5 }])
  })

  it('2. rotation committed while an unlock with the OLD version waits → the unlock is refused', async () => {
    const cred = await credential(ids.pA, [await group(ids.pA)])
    const [a, b] = conns
    await a.query('begin'); await a.query(`select public.site_access_rotate_credential($1, $2, $3, null)`, [ids.pA, cred, HASH])
    let settled = false, err = null
    const pending = unlockOn(b, ids.pA, cred, 1, null, sha(tok())).then(() => { settled = true }, (e) => { settled = true; err = e })
    await sleep(300); expect(settled).toBe(false)         // blocked on the credential row
    await a.query('commit'); await pending
    expect(err?.message).toContain('site_access:credential_unavailable')
  })

  it('3. unlock in flight; a rotation waits for it, then revokes the new session', async () => {
    const cred = await credential(ids.pA, [await group(ids.pA)]); const t = tok()
    const [a, b] = conns
    await a.query('begin'); await unlockOn(a, ids.pA, cred, 1, null, sha(t))
    let done = false
    const rot = b.query(`select public.site_access_rotate_credential($1, $2, $3, null) n`, [ids.pA, cred, HASH]).then((r) => { done = true; return r })
    await sleep(300); expect(done).toBe(false)
    await a.query('commit'); const r = await rot
    expect(r.rows[0].n).toBe(1)
    expect(await resolve(ids.pA, t)).toBeNull()
  })

  it('4. sign-out-everyone racing an unlock that rotates an existing token → the session ends up revoked', async () => {
    const cred = await credential(ids.pA, [await group(ids.pA)]); const t1 = tok(), t2 = tok()
    const [a, b] = conns
    await unlockOn(a, ids.pA, cred, 1, null, sha(t1))
    await a.query('begin'); await unlockOn(a, ids.pA, cred, 1, sha(t1), sha(t2))
    const rev = b.query(`select public.site_access_revoke_sessions($1, null, 'revoked_all', null)`, [ids.pA])
    await sleep(300); await a.query('commit'); await rev
    expect(await resolve(ids.pA, t2)).toBeNull()
    expect(await resolve(ids.pA, t1)).toBeNull()
  })

  it('5. two parallel unlocks presenting the same token → the old token dies; each caller holds a valid session', async () => {
    const cred = await credential(ids.pA, [await group(ids.pA)]); const t0 = tok(), x = tok(), y = tok()
    const [a, b] = conns
    await unlockOn(a, ids.pA, cred, 1, null, sha(t0))
    await Promise.all([unlockOn(a, ids.pA, cred, 1, sha(t0), sha(x)), unlockOn(b, ids.pA, cred, 1, sha(t0), sha(y))])
    expect(await resolve(ids.pA, t0)).toBeNull()
    expect(await resolve(ids.pA, x)).not.toBeNull()
    expect(await resolve(ids.pA, y)).not.toBeNull()
    // at most one of them rotated the original session; the other started a fresh one
    expect((await resolve(ids.pA, x)).session_id).not.toBe((await resolve(ids.pA, y)).session_id)
  })
})

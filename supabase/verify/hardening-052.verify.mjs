/**
 * Migration 052 — Site Access protected documents (ADR-040 B2.4). Proves,
 * against a real Postgres:
 *  - the new tables and every new function are service-role only;
 *  - isolation in the schema: a document cannot use another project's group,
 *    an upload / finish / delivery read keyed on another project finds nothing;
 *  - uploads: the database chooses the path; finish refuses a size or hash that
 *    differs from the declaration, an expired, finished or failed upload, an
 *    archived document; replacing a language queues the old object; the 20-
 *    pending limit;
 *  - delivery: language order with fallback, archived flag, archived groups
 *    dropped, unknown → zero rows;
 *  - sweep: expired uploads are queued; an ACTIVE file is never handed out for
 *    removal, even if it was wrongly queued; trash_done keeps active paths;
 *  - no re-run.
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
  '035_whats_new.sql', '036_analytics_snapshots.sql', '050_site_access.sql']
const M052 = MIG('052_site_access_documents.sql')
const SHA = (c) => c.repeat(64)
const MB = 1024 * 1024

let client
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

const group = async (p, name = 'Members') => (await sq(`insert into public.site_access_groups (project_id, name) values ($1, $2::jsonb) returning id`, [p, JSON.stringify({ en: name })]))[0].id
const doc = async (p, groups) => (await sq(`select public.site_access_create_document($1, '{"en":"Timetable"}'::jsonb, $2::uuid[], $3) as id`, [p, groups, ids.owner]))[0].id
const begin = async (p, d, locale = 'en', size = MB, sha = SHA('a'), ttl = 3600) =>
  (await sq(`select * from public.site_access_begin_upload($1, $2, $3, $4, $5, 'timetable.pdf', $6, $7)`, [p, d, locale, size, sha, ids.owner, ttl]))[0]
const finish = async (p, u, size = MB, sha = SHA('a')) => (await sq(`select public.site_access_finish_upload($1, $2, $3, $4, $5) as old`, [p, u, size, sha, ids.owner]))[0].old
const deliver = async (p, d, locales) => (await sq(`select * from public.site_access_document_for_delivery($1, $2, $3::text[])`, [p, d, locales]))[0] ?? null

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M052)
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('d52','D') returning id`)
  ids.pA = await one(`insert into public.projects (slug, tenant_id, name) values ('d52a',$1,'A') returning id`, [ids.t])
  ids.pB = await one(`insert into public.projects (slug, tenant_id, name) values ('d52b',$1,'B') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('o@d52.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('052 — locked to the service role', () => {
  it('anon and the tenant Owner cannot touch the new tables or call the new functions', async () => {
    for (const t of ['site_access_uploads', 'site_access_storage_trash']) {
      for (const who of [() => asAnon(), () => asUser(ids.owner)]) {
        await who()
        expect((await errOf(() => q(`select * from public.${t}`)))?.code, t).toBe('42501')
      }
    }
    const calls = [
      `select public.site_access_create_document('${ids.pA}', '{"en":"x"}', '{}', null)`,
      `select * from public.site_access_begin_upload('${ids.pA}', gen_random_uuid(), 'en', 1, '${SHA('a')}', null, null, 3600)`,
      `select public.site_access_finish_upload('${ids.pA}', gen_random_uuid(), 1, '${SHA('a')}', null)`,
      `select * from public.site_access_document_for_delivery('${ids.pA}', gen_random_uuid(), array['en'])`,
      `select public.site_access_expire_uploads()`,
      `select * from public.site_access_trash_batch()`,
    ]
    for (const sql of calls) {
      for (const who of [() => asAnon(), () => asUser(ids.owner)]) {
        await who()
        expect((await errOf(() => q(sql)))?.code, sql).toBe('42501')
      }
    }
  })
})

describe('052 — isolation', () => {
  it('a document cannot be given another project\'s group', async () => {
    const gB = await group(ids.pB)
    const e = await errOf(() => sq(`select public.site_access_create_document($1, '{"en":"x"}', $2::uuid[], null)`, [ids.pA, [gB]]))
    expect(e?.code).toBe('23503')
  })
  it('upload, finish and delivery keyed on the wrong project find nothing', async () => {
    const d = await doc(ids.pA, [await group(ids.pA)])
    expect((await errOf(() => begin(ids.pB, d)))?.message).toContain('site_access:not_found')
    const u = await begin(ids.pA, d)
    expect((await errOf(() => finish(ids.pB, u.upload_id)))?.message).toContain('site_access:upload_unavailable')
    await finish(ids.pA, u.upload_id)
    expect(await deliver(ids.pB, d, ['en'])).toBeNull()
    expect((await deliver(ids.pA, d, ['en'])).storage_path).toBe(u.storage_path)
  })
})

describe('052 — uploads', () => {
  it('the database chooses a project-prefixed, opaque path; expiry follows the ttl', async () => {
    const d = await doc(ids.pA, [])
    const u = await begin(ids.pA, d)
    expect(u.storage_path).toMatch(new RegExp(`^${ids.pA}/[0-9a-f-]{36}\\.pdf$`))
    expect(new Date(u.expires_at).getTime() - Date.now()).toBeGreaterThan(3500_000)
  })
  it('refuses declarations outside the rules (size, hash, locale, ttl)', async () => {
    const d = await doc(ids.pA, [])
    expect((await errOf(() => begin(ids.pA, d, 'en', 20 * MB + 1)))?.code).toBe('23514')
    expect((await errOf(() => begin(ids.pA, d, 'en', 0)))?.code).toBe('23514')
    expect((await errOf(() => begin(ids.pA, d, 'en', MB, 'xyz')))?.code).toBe('23514')
    expect((await errOf(() => begin(ids.pA, d, 'english')))?.code).toBe('23514')
    expect((await errOf(() => begin(ids.pA, d, 'en', MB, SHA('a'), 10)))?.message).toContain('invalid_ttl')
  })
  it('finish refuses a size or hash different from the declaration', async () => {
    const d = await doc(ids.pA, [])
    const u = await begin(ids.pA, d)
    expect((await errOf(() => finish(ids.pA, u.upload_id, MB + 1)))?.message).toContain('upload_mismatch')
    expect((await errOf(() => finish(ids.pA, u.upload_id, MB, SHA('b'))))?.message).toContain('upload_mismatch')
  })
  it('finish refuses an expired, already finished or failed upload, and an archived document', async () => {
    const d = await doc(ids.pA, [])
    const u1 = await begin(ids.pA, d)
    await sq(`update public.site_access_uploads set expires_at = now() - interval '1 second' where id = $1`, [u1.upload_id])
    expect((await errOf(() => finish(ids.pA, u1.upload_id)))?.message).toContain('upload_unavailable')
    const u2 = await begin(ids.pA, d)
    await finish(ids.pA, u2.upload_id)
    expect((await errOf(() => finish(ids.pA, u2.upload_id)))?.message).toContain('upload_unavailable')
    const u3 = await begin(ids.pA, d, 'it')
    await sq(`select public.site_access_fail_upload($1, $2)`, [ids.pA, u3.upload_id])
    expect((await errOf(() => finish(ids.pA, u3.upload_id)))?.message).toContain('upload_unavailable')
    const u4 = await begin(ids.pA, d, 'de')
    await sq(`select public.site_access_set_document_archived($1, $2, true, null)`, [ids.pA, d])
    expect((await errOf(() => finish(ids.pA, u4.upload_id)))?.message).toContain('not_found')
    expect((await errOf(() => begin(ids.pA, d)))?.message).toContain('not_found')
  })
  it('replacing a language swaps the row atomically and queues the old object; a failed upload is queued too', async () => {
    const d = await doc(ids.pA, [])
    const u1 = await begin(ids.pA, d)
    expect(await finish(ids.pA, u1.upload_id)).toBeNull()
    const u2 = await begin(ids.pA, d, 'en', 2 * MB, SHA('c'))
    expect(await finish(ids.pA, u2.upload_id, 2 * MB, SHA('c'))).toBe(u1.storage_path)
    const files = await sq(`select storage_path, size_bytes from public.site_access_document_files where document_id = $1`, [d])
    expect(files).toEqual([{ storage_path: u2.storage_path, size_bytes: 2 * MB }])
    const trash = await sq(`select storage_path, reason from public.site_access_storage_trash where project_id = $1`, [ids.pA])
    expect(trash).toContainEqual({ storage_path: u1.storage_path, reason: 'replaced' })
    const u3 = await begin(ids.pA, d, 'fr')
    await sq(`select public.site_access_fail_upload($1, $2)`, [ids.pA, u3.upload_id])
    expect(await sq(`select reason from public.site_access_storage_trash where storage_path = $1`, [u3.storage_path])).toEqual([{ reason: 'failed_upload' }])
    const ev = await sq(`select action from public.site_access_events where target_id = $1 order by id`, [d])
    expect(ev.map((e) => e.action)).toEqual(['document_created', 'document_file_uploaded', 'document_file_replaced'])
  })
  it('at most 20 pending uploads per project', async () => {
    const pC = await one(`insert into public.projects (slug, tenant_id, name) values ('d52c',$1,'C') returning id`, [ids.t])
    const d = await doc(pC, [])
    for (let i = 0; i < 20; i++) await begin(pC, d)
    expect((await errOf(() => begin(pC, d)))?.message).toContain('too_many_uploads')
  })
})

describe('052 — delivery read', () => {
  it('first language with a file, in the order asked; archived groups dropped; archived flagged', async () => {
    const g1 = await group(ids.pA, 'G1'); const g2 = await group(ids.pA, 'G2')
    const d = await doc(ids.pA, [g1, g2])
    const it = await begin(ids.pA, d, 'it'); await finish(ids.pA, it.upload_id)
    expect((await deliver(ids.pA, d, ['de', 'it', 'en'])).locale).toBe('it')
    expect(await deliver(ids.pA, d, ['de', 'fr'])).toBeNull()
    expect((await deliver(ids.pA, d, ['it'])).group_ids.sort()).toEqual([g1, g2].sort())
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [g2])
    expect((await deliver(ids.pA, d, ['it'])).group_ids).toEqual([g1])
    await sq(`select public.site_access_set_document_archived($1, $2, true, null)`, [ids.pA, d])
    expect((await deliver(ids.pA, d, ['it'])).archived).toBe(true)
  })
  it('an unknown id is zero rows', async () => {
    expect(await deliver(ids.pA, '00000000-0000-4000-8000-000000000000', ['en'])).toBeNull()
  })
})

describe('052 — sweep never removes an active file', () => {
  it('expired uploads are queued; active files are never handed out, even if wrongly queued', async () => {
    const d = await doc(ids.pA, [])
    const stale = await begin(ids.pA, d, 'nl')
    await sq(`update public.site_access_uploads set expires_at = now() - interval '1 hour' where id = $1`, [stale.upload_id])
    expect((await sq(`select public.site_access_expire_uploads() as n`))[0].n).toBeGreaterThanOrEqual(1)
    const live = await begin(ids.pA, d, 'pt'); await finish(ids.pA, live.upload_id)
    // a bug queues the ACTIVE object:
    await sq(`insert into public.site_access_storage_trash (storage_path, project_id, reason) values ($1, $2, 'replaced')`, [live.storage_path, ids.pA])
    const batch = (await sq(`select * from public.site_access_trash_batch(1000)`)).map((r) => r.storage_path)
    expect(batch).toContain(stale.storage_path)
    expect(batch).not.toContain(live.storage_path)
    expect(await sq(`select 1 from public.site_access_storage_trash where storage_path = $1`, [live.storage_path])).toEqual([])
    expect((await sq(`select public.site_access_trash_done($1::text[]) as n`, [[stale.storage_path, live.storage_path]]))[0].n).toBe(1)
    expect(await sq(`select storage_path from public.site_access_document_files where storage_path = $1`, [live.storage_path])).toHaveLength(1)
  })
  it('a pending, unexpired upload is not handed out', async () => {
    const d = await doc(ids.pA, [])
    const u = await begin(ids.pA, d, 'es')
    await sq(`insert into public.site_access_storage_trash (storage_path, project_id, reason) values ($1, $2, 'failed_upload')`, [u.storage_path, ids.pA])
    expect((await sq(`select * from public.site_access_trash_batch(1000)`)).map((r) => r.storage_path)).not.toContain(u.storage_path)
  })
})

describe('052 — no re-run', () => {
  it('refuses to run twice', async () => {
    expect((await errOf(() => applyMigrationFile(client, M052)))?.message).toContain('052: already applied')
  })
})

/**
 * Migration 055 — Documents: permanent delete (ADR-040 §15.10, R9.3). Proves,
 * against a real Postgres with 050 → … → 054 → 055 applied:
 *  - the function is service-role only;
 *  - only ARCHIVED documents of THIS project, all or nothing, at most 100;
 *  - files, groups, placements and uploads go; every stored object is queued
 *    for the sweep (and the sweep's batch hands it out); other documents and
 *    projects are untouched;
 *  - one `document_deleted` event per document, no title kept;
 *  - rollback-055 restores the catalog exactly, refuses once a delete happened,
 *    and 055 applies again; 055 refuses to run twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
  '035_whats_new.sql', '036_analytics_snapshots.sql', '050_site_access.sql', '051_site_access_grantable.sql',
  '052_site_access_documents.sql', '053_site_access_session_summary.sql', '054_documents_module.sql']
const M055 = MIG('055_documents_delete.sql')
const ROLLBACK = path.join(__dirname, 'rollback-055.sql')
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

const group = async (p) => (await sq(`insert into public.site_access_groups (project_id, name) values ($1, '{"en":"G"}'::jsonb) returning id`, [p]))[0].id
const doc = async (p, groups) =>
  (await sq(`select public.site_access_create_document_v2($1, '{"en":"Calendar 2024"}'::jsonb, null, $2, $3::uuid[], null, '{}'::text[], $4) as id`,
    [p, groups ? 'groups' : 'everyone', groups ?? [], ids.owner]))[0].id
const upload = async (p, d, sha = SHA('a')) => {
  const u = (await sq(`select * from public.site_access_begin_upload_v2($1, $2, '{en}'::text[], 'application/pdf', $3, $4, 'f', $5, 3600)`, [p, d, MB, sha, ids.owner]))[0]
  await sq(`select public.site_access_finish_upload($1, $2, $3, $4, $5)`, [p, u.upload_id, MB, sha, ids.owner])
  return u.storage_path
}
const pending = async (p, d) => (await sq(`select * from public.site_access_begin_upload_v2($1, $2, '{en}'::text[], 'application/pdf', $3, $4, 'f', $5, 3600)`, [p, d, MB, SHA('c'), ids.owner]))[0].storage_path
const archive = (p, d) => sq(`select public.site_access_set_document_archived($1, $2, true, $3)`, [p, d, ids.owner])
const del = (p, docs) => sq(`select public.site_access_delete_documents($1, $2::uuid[], $3) as n`, [p, docs, ids.owner]).then((r) => r[0].n)
const exists = async (d) => (await sq(`select count(*)::int as n from public.site_access_documents where id = $1`, [d]))[0].n === 1

async function catalog() {
  const parts = await Promise.all([
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body,
              coalesce(array_to_string(p.proacl, ','), '') as acl
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`),
  ])
  return JSON.stringify(parts)
}

let before054
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('d55','D') returning id`)
  ids.pA = await one(`insert into public.projects (slug, tenant_id, name) values ('d55a',$1,'A') returning id`, [ids.t])
  ids.pB = await one(`insert into public.projects (slug, tenant_id, name) values ('d55b',$1,'B') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('o@d55.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
  before054 = await catalog()
  await applyMigrationFile(client, M055)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('055 — locked to the service role', () => {
  it('anon and the tenant Owner cannot call it', async () => {
    for (const as of [() => asAnon(), () => asUser(ids.owner)]) {
      await as()
      const e = await errOf(() => q(`select public.site_access_delete_documents($1, $2::uuid[], $3)`, [ids.pA, [ids.pA], ids.owner]))
      expect(e?.message).toMatch(/permission denied/)
      await reset()
    }
  })
})

describe('055 — rules', () => {
  it('a document that is not archived is refused, and nothing changes', async () => {
    const d = await doc(ids.pA)
    await upload(ids.pA, d)
    expect((await errOf(() => del(ids.pA, [d])))?.message).toMatch(/site_access:not_archived/)
    expect(await exists(d)).toBe(true)
  })
  it('all or nothing: one unknown or other-project id refuses the whole batch', async () => {
    const a = await doc(ids.pA); await archive(ids.pA, a)
    const b = await doc(ids.pB); await archive(ids.pB, b)
    expect((await errOf(() => del(ids.pA, [a, b])))?.message).toMatch(/site_access:not_found/)
    expect((await errOf(() => del(ids.pA, [a, '00000000-0000-4000-8000-000000000000'])))?.message).toMatch(/site_access:not_found/)
    expect(await exists(a)).toBe(true)
    expect(await exists(b)).toBe(true)
  })
  it('empty or more than 100 is refused', async () => {
    expect((await errOf(() => del(ids.pA, [])))?.message).toMatch(/invalid_documents/)
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    expect((await errOf(() => del(ids.pA, many)))?.message).toMatch(/invalid_documents/)
  })
})

describe('055 — what goes, what stays', () => {
  it('files, groups, placements and uploads go; every object is queued and handed to the sweep; others untouched', async () => {
    const g = await group(ids.pA)
    const d = await doc(ids.pA, [g])
    const path1 = await upload(ids.pA, d, SHA('a'))
    const path2 = await pending(ids.pA, d)
    await sq(`select public.site_access_set_document_placements($1, $2, '{page-1}'::text[], $3)`, [ids.pA, d, ids.owner])
    const keep = await doc(ids.pA); const keepPath = await upload(ids.pA, keep, SHA('b'))
    await archive(ids.pA, d)
    expect(await del(ids.pA, [d, d])).toBe(1) // duplicates count once
    expect(await exists(d)).toBe(false)
    for (const t of ['site_access_document_files', 'site_access_document_groups', 'site_access_document_placements', 'site_access_uploads']) {
      expect((await sq(`select count(*)::int as n from public.${t} where document_id = $1`, [d]))[0].n, t).toBe(0)
    }
    const trash = (await sq(`select storage_path, reason from public.site_access_storage_trash where project_id = $1`, [ids.pA])).filter((r) => r.reason === 'document_deleted').map((r) => r.storage_path).sort()
    expect(trash).toEqual([path1, path2].sort())
    const batch = (await sq(`select storage_path from public.site_access_trash_batch(500)`)).map((r) => r.storage_path)
    expect(batch).toEqual(expect.arrayContaining([path1, path2]))
    expect(batch).not.toContain(keepPath)
    expect(await exists(keep)).toBe(true)
    expect((await sq(`select count(*)::int as n from public.site_access_groups where id = $1`, [g]))[0].n).toBe(1) // the group stays
  })
  it('one audit event per document, without a title', async () => {
    const a = await doc(ids.pA); await archive(ids.pA, a)
    const b = await doc(ids.pA); await archive(ids.pA, b)
    expect(await del(ids.pA, [a, b])).toBe(2)
    const ev = await sq(`select target_id, actor_user_id, detail from public.site_access_events where action = 'document_deleted' and target_id = any ($1::uuid[])`, [[a, b]])
    expect(ev).toHaveLength(2)
    for (const e of ev) {
      expect(e.actor_user_id).toBe(ids.owner)
      expect(e.detail).toEqual({})
    }
  })
})

describe('055 — rollback and re-run', () => {
  it('refuses to apply twice', async () => {
    expect((await errOf(() => applyMigrationFile(client, M055)))?.message).toMatch(/already applied/)
  })
  it('rollback refuses once documents were deleted, and changes nothing', async () => {
    const e = await errOf(() => applyMigrationFile(client, ROLLBACK))
    expect(e?.message).toMatch(/rollback-055: documents were deleted/)
    expect(await q(`select to_regprocedure('public.site_access_delete_documents(uuid, uuid[], uuid)') is not null as ok`)).toEqual([{ ok: true }])
  })
  it('without such history it restores 054 exactly, and 055 applies again', async () => {
    await sq(`delete from public.site_access_events where action = 'document_deleted'`)
    await sq(`delete from public.site_access_storage_trash where reason = 'document_deleted'`)
    await applyMigrationFile(client, ROLLBACK)
    expect(await catalog()).toBe(before054)
    await applyMigrationFile(client, M055)
    expect(await q(`select to_regprocedure('public.site_access_delete_documents(uuid, uuid[], uuid)') is not null as ok`)).toEqual([{ ok: true }])
  })
})

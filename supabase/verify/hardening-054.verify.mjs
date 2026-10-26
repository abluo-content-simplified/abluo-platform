/**
 * Migration 054 — Documents module (ADR-040 §15, R9). Proves, against a real
 * Postgres with 050 → 051 → 052 → 053 → 054 applied:
 *  - the new table and every new function are service-role only;
 *  - B2.5 code paths still behave exactly as before (old create / begin /
 *    finish / delivery), and existing documents stay group documents;
 *  - who can open it: everyone XOR one or more LIVE groups of THIS project;
 *  - one upload for several languages = one stored object, honest language
 *    in delivery; replacing one language keeps the others; a shared object is
 *    never handed to the sweep while any language still uses it;
 *  - removing languages: never the last one; queued only when unused;
 *  - placements: set / keep order / new at end / reorder must match exactly;
 *    page listing skips archived and file-less documents, never shows paths,
 *    never crosses projects;
 *  - image types: extension follows type, per-type size limit, bad type refused;
 *  - grantable extras + bucket types; no re-run.
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
  '035_whats_new.sql', '036_analytics_snapshots.sql', '050_site_access.sql', '051_site_access_grantable.sql',
  '052_site_access_documents.sql', '053_site_access_session_summary.sql']
const M054 = MIG('054_documents_module.sql')
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
const docV2 = async (p, { visibility = 'groups', groups = [], note = null, category = null, tags = [] } = {}) =>
  (await sq(`select public.site_access_create_document_v2($1, '{"en":"Timetable"}'::jsonb, $2::jsonb, $3, $4::uuid[], $5, $6::text[], $7) as id`,
    [p, note ? JSON.stringify(note) : null, visibility, groups, category, tags, ids.owner]))[0].id
const beginV2 = async (p, d, locales = ['en'], mime = 'application/pdf', size = MB, sha = SHA('a')) =>
  (await sq(`select * from public.site_access_begin_upload_v2($1, $2, $3::text[], $4, $5, $6, 'file', $7, 3600)`, [p, d, locales, mime, size, sha, ids.owner]))[0]
const finish = async (p, u, size = MB, sha = SHA('a')) => (await sq(`select public.site_access_finish_upload($1, $2, $3, $4, $5) as old`, [p, u, size, sha, ids.owner]))[0].old
const upload = async (p, d, locales, opts = {}) => {
  const u = await beginV2(p, d, locales, opts.mime ?? 'application/pdf', opts.size ?? MB, opts.sha ?? SHA('a'))
  await finish(p, u.upload_id, opts.size ?? MB, opts.sha ?? SHA('a'))
  return u
}
const deliverV2 = async (p, d, locales) => (await sq(`select * from public.site_access_document_for_delivery_v2($1, $2, $3::text[])`, [p, d, locales]))[0] ?? null
const files = async (d) => sq(`select locale, storage_path, mime_type from public.site_access_document_files where document_id = $1 order by locale`, [d])
const place = async (p, d, pages) => sq(`select public.site_access_set_document_placements($1, $2, $3::text[], $4)`, [p, d, pages, ids.owner])
const pageDocs = async (p, pages) => sq(`select * from public.site_access_page_documents($1, $2::text[])`, [p, pages])

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  ids.t = await one(`insert into public.tenants (slug, display_name) values ('d54','D') returning id`)
  ids.pA = await one(`insert into public.projects (slug, tenant_id, name) values ('d54a',$1,'A') returning id`, [ids.t])
  ids.pB = await one(`insert into public.projects (slug, tenant_id, name) values ('d54b',$1,'B') returning id`, [ids.t])
  ids.owner = await one(`insert into auth.users (email) values ('o@d54.test') returning id`)
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.t, ids.owner])
  // A B2.5 document that exists BEFORE 054 (the TMZ test data case).
  ids.gOld = await group(ids.pA, 'Family')
  ids.dOld = (await sq(`select public.site_access_create_document($1, '{"en":"INV"}'::jsonb, $2::uuid[], null) as id`, [ids.pA, [ids.gOld]]))[0].id
  const u = (await sq(`select * from public.site_access_begin_upload($1, $2, 'en', $3, $4, 'inv.pdf', null, 3600)`, [ids.pA, ids.dOld, MB, SHA('e')]))[0]
  await sq(`select public.site_access_finish_upload($1, $2, $3, $4, null)`, [ids.pA, u.upload_id, MB, SHA('e')])
  ids.dOldPath = u.storage_path
  await applyMigrationFile(client, M054)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('054 — locked to the service role', () => {
  it('anon and the tenant Owner cannot read placements or call any new function', async () => {
    for (const who of [() => asAnon(), () => asUser(ids.owner)]) {
      await who()
      expect((await errOf(() => q(`select * from public.site_access_document_placements`)))?.code).toBe('42501')
    }
    const calls = [
      `select public.site_access_create_document_v2('${ids.pA}', '{"en":"x"}', null, 'everyone', '{}', null, '{}', null)`,
      `select public.site_access_update_document_v2('${ids.pA}', gen_random_uuid(), '{"en":"x"}', null, null, '{}', null)`,
      `select public.site_access_set_document_access('${ids.pA}', gen_random_uuid(), 'everyone', '{}', null)`,
      `select public.site_access_set_document_placements('${ids.pA}', gen_random_uuid(), array['p1'], null)`,
      `select public.site_access_reorder_page_documents('${ids.pA}', 'p1', '{}', null)`,
      `select public.site_access_remove_document_languages('${ids.pA}', gen_random_uuid(), array['en'], null)`,
      `select * from public.site_access_begin_upload_v2('${ids.pA}', gen_random_uuid(), array['en'], 'application/pdf', 1, '${SHA('a')}', null, null, 3600)`,
      `select * from public.site_access_page_documents('${ids.pA}', array['p1'])`,
      `select * from public.site_access_document_for_delivery_v2('${ids.pA}', gen_random_uuid(), array['en'])`,
    ]
    for (const sql of calls) {
      for (const who of [() => asAnon(), () => asUser(ids.owner)]) {
        await who()
        expect((await errOf(() => q(sql)))?.code, sql).toBe('42501')
      }
    }
  })
})

describe('054 — B2.5 code paths unchanged', () => {
  it('the existing document stays a group document with its file and groups', async () => {
    const d = await deliverV2(ids.pA, ids.dOld, ['en'])
    expect(d).toMatchObject({ visibility: 'groups', group_ids: [ids.gOld], locale: 'en', storage_path: ids.dOldPath, mime_type: 'application/pdf' })
    const old = (await sq(`select * from public.site_access_document_for_delivery($1, $2, array['en'])`, [ids.pA, ids.dOld]))[0]
    expect(old).toMatchObject({ archived: false, group_ids: [ids.gOld], locale: 'en', storage_path: ids.dOldPath })
  })
  it('old create / begin / finish still work and write a PDF for one language', async () => {
    const d = (await sq(`select public.site_access_create_document($1, '{"en":"Old"}'::jsonb, $2::uuid[], null) as id`, [ids.pA, [ids.gOld]]))[0].id
    const u = (await sq(`select * from public.site_access_begin_upload($1, $2, 'it', $3, $4, 'x.pdf', null, 3600)`, [ids.pA, d, MB, SHA('f')]))[0]
    expect(u.storage_path).toMatch(/\.pdf$/)
    expect(await finish(ids.pA, u.upload_id, MB, SHA('f'))).toBeNull()
    expect(await files(d)).toEqual([{ locale: 'it', storage_path: u.storage_path, mime_type: 'application/pdf' }])
    expect((await sq(`select visibility from public.site_access_documents where id = $1`, [d]))[0].visibility).toBe('groups')
  })
})

describe('054 — who can open it', () => {
  it('everyone takes no groups; groups needs at least one live group of THIS project', async () => {
    const gA = await group(ids.pA); const gB = await group(ids.pB)
    expect((await errOf(() => docV2(ids.pA, { visibility: 'everyone', groups: [gA] })))?.message).toContain('groups_with_everyone')
    expect((await errOf(() => docV2(ids.pA, { visibility: 'groups' })))?.message).toContain('no_groups')
    expect((await errOf(() => docV2(ids.pA, { groups: [gB] })))?.message).toContain('unknown_group')
    const gArch = await group(ids.pA)
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [gArch])
    expect((await errOf(() => docV2(ids.pA, { groups: [gArch] })))?.message).toContain('unknown_group')
    expect((await errOf(() => docV2(ids.pA, { visibility: 'members' })))?.code).toBe('23514')
  })
  it('switching to everyone clears the groups; delivery returns no groups for everyone', async () => {
    const g = await group(ids.pA)
    const d = await docV2(ids.pA, { groups: [g] })
    await upload(ids.pA, d, ['en'])
    expect((await deliverV2(ids.pA, d, ['en'])).group_ids).toEqual([g])
    await sq(`select public.site_access_set_document_access($1, $2, 'everyone', '{}', null)`, [ids.pA, d])
    expect(await sq(`select * from public.site_access_document_groups where document_id = $1`, [d])).toEqual([])
    expect(await deliverV2(ids.pA, d, ['en'])).toMatchObject({ visibility: 'everyone', group_ids: [] })
    await sq(`select public.site_access_set_document_access($1, $2, 'groups', $3::uuid[], null)`, [ids.pA, d, [g]])
    expect(await deliverV2(ids.pA, d, ['en'])).toMatchObject({ visibility: 'groups', group_ids: [g] })
    expect((await errOf(() => sq(`select public.site_access_set_document_access($1, $2, 'everyone', '{}', null)`, [ids.pB, d])))?.message).toContain('not_found')
  })
  it('note, category and tags are stored and validated', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone', note: { en: 'Updated' }, category: 'term-docs-1', tags: ['t1', 't2'] })
    expect((await sq(`select note, category_term_id, tag_term_ids from public.site_access_documents where id = $1`, [d]))[0])
      .toEqual({ note: { en: 'Updated' }, category_term_id: 'term-docs-1', tag_term_ids: ['t1', 't2'] })
    expect((await errOf(() => docV2(ids.pA, { visibility: 'everyone', category: 'drafts.x' })))?.code).toBe('23514')
    expect((await errOf(() => docV2(ids.pA, { visibility: 'everyone', tags: ['bad id'] })))?.code).toBe('23514')
    await sq(`select public.site_access_update_document_v2($1, $2, '{"en":"New"}', null, null, '{}', null)`, [ids.pA, d])
    expect((await sq(`select title, note, category_term_id, tag_term_ids from public.site_access_documents where id = $1`, [d]))[0])
      .toEqual({ title: { en: 'New' }, note: null, category_term_id: null, tag_term_ids: [] })
  })
})

describe('054 — one file for several languages', () => {
  it('one upload, three languages, one stored object; delivery labels the real language', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    const u = await upload(ids.pA, d, ['en', 'de', 'it'])
    const f = await files(d)
    expect(f.map((r) => r.locale)).toEqual(['de', 'en', 'it'])
    expect(new Set(f.map((r) => r.storage_path))).toEqual(new Set([u.storage_path]))
    expect((await deliverV2(ids.pA, d, ['fr', 'it', 'en'])).locale).toBe('it')
    expect(await deliverV2(ids.pA, d, ['fr'])).toBeNull()
  })
  it('replacing one language keeps the others; the shared object is never handed to the sweep while used', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    const shared = await upload(ids.pA, d, ['en', 'de'])
    const enOnly = await upload(ids.pA, d, ['en'], { sha: SHA('b') })
    const f = await files(d)
    expect(f).toEqual([
      { locale: 'de', storage_path: shared.storage_path, mime_type: 'application/pdf' },
      { locale: 'en', storage_path: enOnly.storage_path, mime_type: 'application/pdf' },
    ])
    const batch = (await sq(`select * from public.site_access_trash_batch(1000)`)).map((r) => r.storage_path)
    expect(batch).not.toContain(shared.storage_path)
    // Once German is replaced too, the shared object is free and goes.
    await upload(ids.pA, d, ['de'], { sha: SHA('c') })
    const batch2 = (await sq(`select * from public.site_access_trash_batch(1000)`)).map((r) => r.storage_path)
    expect(batch2).toContain(shared.storage_path)
  })
  it('languages must be valid and distinct', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    expect((await errOf(() => beginV2(ids.pA, d, [])))?.message).toContain('invalid_locale')
    expect((await errOf(() => beginV2(ids.pA, d, ['en', 'en'])))?.message).toContain('invalid_locale')
    expect((await errOf(() => beginV2(ids.pA, d, ['english'])))?.message).toContain('invalid_locale')
  })
})

describe('054 — removing languages', () => {
  it('never the last language; a still-used object is not queued, an unused one is', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    const shared = await upload(ids.pA, d, ['en', 'de'])
    const itOnly = await upload(ids.pA, d, ['it'], { sha: SHA('d') })
    expect((await sq(`select public.site_access_remove_document_languages($1, $2, array['de'], null) as n`, [ids.pA, d]))[0].n).toBe(1)
    expect(await sq(`select 1 from public.site_access_storage_trash where storage_path = $1`, [shared.storage_path])).toEqual([])
    await sq(`select public.site_access_remove_document_languages($1, $2, array['it'], null)`, [ids.pA, d])
    expect(await sq(`select reason from public.site_access_storage_trash where storage_path = $1`, [itOnly.storage_path])).toEqual([{ reason: 'language_removed' }])
    expect((await errOf(() => sq(`select public.site_access_remove_document_languages($1, $2, array['en'], null)`, [ids.pA, d])))?.message).toContain('last_language')
    expect((await files(d)).map((r) => r.locale)).toEqual(['en'])
  })
})

describe('054 — placements and the page listing', () => {
  it('set keeps existing positions and appends new documents at the end of each page', async () => {
    const d1 = await docV2(ids.pA, { visibility: 'everyone' }); await upload(ids.pA, d1, ['en'])
    const d2 = await docV2(ids.pA, { visibility: 'everyone' }); await upload(ids.pA, d2, ['en'])
    const d3 = await docV2(ids.pA, { visibility: 'everyone' }); await upload(ids.pA, d3, ['en'])
    await place(ids.pA, d1, ['contact'])
    await place(ids.pA, d2, ['contact', 'downloads'])
    await place(ids.pA, d3, ['contact'])
    expect((await pageDocs(ids.pA, ['contact'])).map((r) => r.document_id)).toEqual([d1, d2, d3])
    await place(ids.pA, d2, ['downloads'])                    // removed from contact only
    expect((await pageDocs(ids.pA, ['contact'])).map((r) => r.document_id)).toEqual([d1, d3])
    await place(ids.pA, d2, ['downloads', 'contact'])         // back: at the end
    expect((await pageDocs(ids.pA, ['contact'])).map((r) => r.document_id)).toEqual([d1, d3, d2])
    await sq(`select public.site_access_reorder_page_documents($1, 'contact', $2::uuid[], null)`, [ids.pA, [d2, d1, d3]])
    expect((await pageDocs(ids.pA, ['contact'])).map((r) => r.document_id)).toEqual([d2, d1, d3])
    expect((await errOf(() => sq(`select public.site_access_reorder_page_documents($1, 'contact', $2::uuid[], null)`, [ids.pA, [d2, d1]])))?.message).toContain('order_mismatch')
    expect((await errOf(() => sq(`select public.site_access_reorder_page_documents($1, 'contact', $2::uuid[], null)`, [ids.pA, [d2, d2, d1]])))?.message).toContain('order_mismatch')
  })
  it('the listing skips archived and file-less documents, shows no paths, and never crosses projects', async () => {
    const live = await docV2(ids.pA, { visibility: 'everyone' }); await upload(ids.pA, live, ['en'])
    const noFile = await docV2(ids.pA, { visibility: 'everyone' })
    const archived = await docV2(ids.pA, { visibility: 'everyone' }); await upload(ids.pA, archived, ['en'])
    for (const d of [live, noFile, archived]) await place(ids.pA, d, ['list-page'])
    await sq(`select public.site_access_set_document_archived($1, $2, true, null)`, [ids.pA, archived])
    const rows = await pageDocs(ids.pA, ['list-page'])
    expect(rows.map((r) => r.document_id)).toEqual([live])
    expect(JSON.stringify(rows)).not.toContain(ids.pA + '/')
    expect(rows[0].files).toEqual([expect.objectContaining({ locale: 'en', mimeType: 'application/pdf', sizeBytes: MB })])
    expect(await pageDocs(ids.pB, ['list-page'])).toEqual([])
    expect((await errOf(() => place(ids.pB, live, ['x'])))?.message).toContain('not_found')
  })
  it('page ids must be published Sanity ids; an archived document cannot be placed', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    expect((await errOf(() => place(ids.pA, d, ['drafts.abc'])))?.message).toContain('invalid_page')
    expect((await errOf(() => place(ids.pA, d, ['has space'])))?.message).toContain('invalid_page')
    await sq(`select public.site_access_set_document_archived($1, $2, true, null)`, [ids.pA, d])
    expect((await errOf(() => place(ids.pA, d, ['ok-page'])))?.message).toContain('not_found')
  })
  it('group documents carry only live groups in the listing', async () => {
    const g1 = await group(ids.pA); const g2 = await group(ids.pA)
    const d = await docV2(ids.pA, { groups: [g1, g2] }); await upload(ids.pA, d, ['en'])
    await place(ids.pA, d, ['members'])
    await sq(`update public.site_access_groups set archived_at = now() where id = $1`, [g2])
    expect((await pageDocs(ids.pA, ['members']))[0]).toMatchObject({ visibility: 'groups', group_ids: [g1] })
  })
})

describe('054 — file types', () => {
  it('the extension follows the type; images up to 10 MB; other types refused', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    expect((await beginV2(ids.pA, d, ['en'], 'image/jpeg')).storage_path).toMatch(/\.jpg$/)
    expect((await beginV2(ids.pA, d, ['en'], 'image/png')).storage_path).toMatch(/\.png$/)
    expect((await beginV2(ids.pA, d, ['en'], 'image/webp')).storage_path).toMatch(/\.webp$/)
    expect((await errOf(() => beginV2(ids.pA, d, ['en'], 'image/svg+xml')))?.message).toContain('invalid_type')
    expect((await errOf(() => beginV2(ids.pA, d, ['en'], 'image/png', 10 * MB + 1)))?.message).toContain('too_large')
    expect((await beginV2(ids.pA, d, ['en'], 'application/pdf', 20 * MB)).storage_path).toMatch(/\.pdf$/)
    expect((await errOf(() => beginV2(ids.pA, d, ['en'], 'application/pdf', 20 * MB + 1)))?.message).toContain('too_large')
  })
  it('a finished image upload records its type', async () => {
    const d = await docV2(ids.pA, { visibility: 'everyone' })
    await upload(ids.pA, d, ['en'], { mime: 'image/png' })
    expect((await files(d))[0].mime_type).toBe('image/png')
    expect((await deliverV2(ids.pA, d, ['en'])).mime_type).toBe('image/png')
  })
})

describe('054 — catalogue rows, bucket, no re-run', () => {
  it('the two grantable extras exist; the bucket accepts the four types and stays private at 20 MB', async () => {
    expect((await q(`select id, requires from public.grantable_permissions where id like 'documents.%' order by id`)))
      .toEqual([{ id: 'documents.document.manage', requires: 'documents.document.read' }, { id: 'documents.document.read', requires: null }])
    const b = (await q(`select public, file_size_limit::int as l, allowed_mime_types as t from storage.buckets where id = 'site-access-files'`))[0]
    expect(b).toEqual({ public: false, l: 20971520, t: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] })
  })
  it('refuses to apply twice', async () => {
    expect((await errOf(() => applyMigrationFile(client, M054)))?.message).toMatch(/already applied/)
  })
})

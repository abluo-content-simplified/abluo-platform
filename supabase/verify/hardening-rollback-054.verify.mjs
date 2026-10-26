/**
 * rollback-054.sql (ADR-040 §15), against a real Postgres with 050–053 applied:
 *  - it refuses while 054-only data exists (each kind separately) and while a
 *    membership holds a documents.* extra — and changes nothing then;
 *  - otherwise it restores the catalog EXACTLY to its 053 state, INCLUDING the
 *    site_access_* objects (tables, columns, constraints, function bodies,
 *    grants) and the bucket type list; B2.5 data survives untouched;
 *  - 054 applies again afterwards (reversible).
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
  '052_site_access_documents.sql', '053_site_access_session_summary.sql']
const M054 = MIG('054_documents_module.sql')
const ROLLBACK = path.join(__dirname, 'rollback-054.sql')
const SHA = (c) => c.repeat(64)

let client
const ids = {}
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function errOf(fn) {
  try { await fn(); return null } catch (e) { try { await client.query('rollback') } catch {} return e }
}
const rollback = () => applyMigrationFile(client, ROLLBACK)

/** The whole public schema + the bucket, as one comparable string. */
async function catalog() {
  const parts = await Promise.all([
    q(`select table_name, column_name, data_type, column_default, is_nullable from information_schema.columns
        where table_schema = 'public' order by 1, 2`),
    q(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f, md5(pg_get_functiondef(p.oid)) as body,
              coalesce(array_to_string(p.proacl, ','), '') as acl
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`),
    q(`select conrelid::regclass::text as t, conname, md5(pg_get_constraintdef(oid)) as d from pg_constraint
         where connamespace = 'public'::regnamespace order by 1, 2`),
    q(`select tablename, indexname, md5(indexdef) as d from pg_indexes where schemaname = 'public' order by 1, 2`),
    q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by 1, 2, 3`),
    q(`select id from public.grantable_permissions order by 1`),
    q(`select id, public, file_size_limit::text, allowed_mime_types from storage.buckets order by id`),
  ])
  return JSON.stringify(parts)
}

let before
beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  ids.t = (await q(`insert into public.tenants (slug, display_name) values ('rb54','R') returning id`))[0].id
  ids.p = (await q(`insert into public.projects (slug, tenant_id, name) values ('rb54a',$1,'R') returning id`, [ids.t]))[0].id
  ids.u = (await q(`insert into auth.users (email) values ('ed@rb54.test') returning id`))[0].id
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.p, ids.u])
  // B2.5 data that must survive a rollback
  ids.g = (await q(`insert into public.site_access_groups (project_id, name) values ($1, '{"en":"Family"}') returning id`, [ids.p]))[0].id
  ids.d = (await q(`select public.site_access_create_document($1, '{"en":"INV"}'::jsonb, $2::uuid[], null) as id`, [ids.p, [ids.g]]))[0].id
  const up = (await q(`select * from public.site_access_begin_upload($1, $2, 'en', 1000, $3, 'a.pdf', null, 3600)`, [ids.p, ids.d, SHA('a')]))[0]
  await q(`select public.site_access_finish_upload($1, $2, 1000, $3, null)`, [ids.p, up.upload_id, SHA('a')])
  ids.path = up.storage_path
  before = await catalog()
  await applyMigrationFile(client, M054)
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)

describe('rollback-054.sql refuses while 054 data exists', () => {
  const cases = [
    ['a public document', `update public.site_access_documents set visibility = 'everyone' where id = '%D%'`, `update public.site_access_documents set visibility = 'groups' where id = '%D%'`],
    ['a note', `update public.site_access_documents set note = '{"en":"n"}' where id = '%D%'`, `update public.site_access_documents set note = null where id = '%D%'`],
    ['tags', `update public.site_access_documents set tag_term_ids = array['t1'] where id = '%D%'`, `update public.site_access_documents set tag_term_ids = '{}' where id = '%D%'`],
    ['a placement', `insert into public.site_access_document_placements (document_id, project_id, page_id) values ('%D%', '%P%', 'page1')`, `delete from public.site_access_document_placements`],
    ['an image file', `update public.site_access_document_files set mime_type = 'image/png' where document_id = '%D%'`, `update public.site_access_document_files set mime_type = 'application/pdf' where document_id = '%D%'`],
    ['a shared object', `insert into public.site_access_document_files (document_id, project_id, locale, storage_path, mime_type, size_bytes, sha256) values ('%D%', '%P%', 'de', '%PATH%', 'application/pdf', 1000, '${SHA('a')}')`, `delete from public.site_access_document_files where locale = 'de'`],
    ['a 054 event', `insert into public.site_access_events (project_id, action) values ('%P%', 'document_access_changed')`, `delete from public.site_access_events where action = 'document_access_changed'`],
  ]
  for (const [label, make, undo] of cases) {
    it(`refuses with ${label}, and changes nothing`, async () => {
      const sub = (s) => s.replaceAll('%D%', ids.d).replaceAll('%P%', ids.p).replaceAll('%PATH%', ids.path)
      await q(sub(make))
      expect((await errOf(rollback))?.message).toMatch(/054 data exists/)
      expect((await q(`select count(*)::int n from information_schema.columns where table_name = 'site_access_documents' and column_name = 'visibility'`))[0].n).toBe(1)
      await q(sub(undo))
    })
  }
  it('refuses while a membership holds a documents extra', async () => {
    await q(`update public.project_members set extra_permissions = array['documents.document.read'] where user_id = $1`, [ids.u])
    expect((await errOf(rollback))?.message).toMatch(/documents extra/)
    await q(`update public.project_members set extra_permissions = '{}' where user_id = $1`, [ids.u])
  })
})

describe('rollback-054.sql restores 053 exactly', () => {
  it('catalog identical to before 054 (incl. site_access objects and the bucket); B2.5 data untouched', async () => {
    await rollback()
    expect(await catalog()).toBe(before)
    const d = (await q(`select * from public.site_access_document_for_delivery($1, $2, array['en'])`, [ids.p, ids.d]))[0]
    expect(d).toMatchObject({ archived: false, group_ids: [ids.g], storage_path: ids.path })
  })
  it('054 applies again afterwards', async () => {
    await applyMigrationFile(client, M054)
    expect((await q(`select visibility from public.site_access_documents where id = $1`, [ids.d]))[0].visibility).toBe('groups')
  })
})

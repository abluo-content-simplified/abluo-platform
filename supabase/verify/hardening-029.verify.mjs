/**
 * Migration 029 — roles, extras, invitations (ADR-028 step 2). Proven against
 * a real Postgres brought to the PRODUCTION shape of 2026-10-07 (… 027, then
 * 028 applied), with Supabase's habit of default-granting new tables to
 * `authenticated` simulated, so 029's own revokes are what is tested.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startHarness, stopHarness, applyMigrationFile } from './lib/harness.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIG = (f) => path.join(__dirname, '..', 'migrations', f)
const M029 = MIG('029_roles_extras_invitations.sql')
const TOKEN = 'x'.repeat(43)

let client
const ids = {}

async function reset() { await client.query('select public.reset_session_auth()') }
async function asAnon() { await client.query(`select public.set_session_auth(null, 'anon')`) }
async function asUser(id, extra = {}) {
  await client.query(`select public.set_session_auth($1::uuid, 'authenticated', $2::jsonb)`, [id, JSON.stringify(extra)])
}
async function q(sql, params) { return (await client.query(sql, params)).rows }
async function fails(sql, params, code, pattern) {
  let err
  try { await client.query(sql, params) } catch (e) { err = e }
  expect(err, `expected an error for: ${sql}`).toBeDefined()
  if (code) expect(err.code).toBe(code)
  if (pattern) expect(err.message).toMatch(pattern)
}
const one = async (sql, p) => (await q(sql, p))[0].id

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of ['014_inquiries_authz.sql', '015_profiles_select_grant.sql', '016_form_submissions.sql',
    '017_form_events.sql', '018_form_tables_service_role_grants.sql', '019_form_events_env_and_status.sql',
    '024_handle_new_user_invite_only.sql', '026_drop_leads.sql', '027_translation_usage.sql',
    '028_security_hardening.sql']) {
    await applyMigrationFile(client, MIG(f))
  }
  ids.tenantA = await one(`insert into public.tenants (slug, display_name) values ('h-a','A') returning id`)
  ids.tenantB = await one(`insert into public.tenants (slug, display_name) values ('h-b','B') returning id`)
  ids.A1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-a1',$1,'A1') returning id`, [ids.tenantA])
  ids.B1 = await one(`insert into public.projects (slug, tenant_id, name) values ('h-b1',$1,'B1') returning id`, [ids.tenantB])
  for (const u of ['ownerA', 'owner2A', 'editorA1', 'viewerA1', 'adminA1', 'memberA', 'ownerB', 'x1', 'x2']) {
    ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@h.test`])
  }
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner'),($3,$4,'owner')`,
    [ids.tenantA, ids.ownerA, ids.tenantB, ids.ownerB])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor'),($1,$3,'viewer')`,
    [ids.A1, ids.editorA1, ids.viewerA1])
  ids.subA1 = await one(`insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
    values ($1,$2,'f',1,'{}') returning id`, [ids.tenantA, ids.A1])
  ids.subB1 = await one(`insert into public.form_submissions (tenant_id, project_id, form_id, form_version, submission_data)
    values ($1,$2,'f',1,'{}') returning id`, [ids.tenantB, ids.B1])
  // Supabase default-grants new tables to API roles; 029 must revoke on its own.
  await q(`alter default privileges in schema public grant all on tables to authenticated`)
  await applyMigrationFile(client, M029)
}, 120_000)

afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('029 applies once', () => {
  it('a second apply refuses and changes nothing', async () => {
    let err
    try { await applyMigrationFile(client, M029) } catch (e) { err = e }
    try { await client.query('rollback') } catch {}
    expect(err?.message).toMatch(/029: already applied/)
  })
  it('existing memberships are untouched', async () => {
    expect(await q(`select role, extra_permissions from public.project_members where user_id = $1`, [ids.viewerA1]))
      .toEqual([{ role: 'viewer', extra_permissions: [] }])
  })
})

describe('role values', () => {
  it('accepts Site admin and tenant Member, rejects anything else', async () => {
    await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'admin')`, [ids.A1, ids.adminA1])
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'member')`, [ids.tenantA, ids.memberA])
    await fails(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'owner')`, [ids.A1, ids.x1], '23514')
    await fails(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'admin')`, [ids.tenantA, ids.x1], '23514')
  })
  it('a tenant membership must name its role — nobody becomes Owner by omission', async () => {
    await fails(`insert into public.tenant_members (tenant_id, user_id) values ($1,$2)`, [ids.tenantA, ids.x1], '23502')
  })
})

describe('extra_permissions validation', () => {
  it('project: contact requests ok; read+update ok', async () => {
    await q(`update public.project_members set extra_permissions = '{forms.submission.read}' where user_id = $1`, [ids.editorA1])
    await q(`update public.project_members set extra_permissions = '{forms.submission.read,forms.submission.update}' where user_id = $1`, [ids.editorA1])
  })
  it('project: invoices, unknown ids, update-without-read and duplicates are refused', async () => {
    for (const bad of ['{billing.invoice.read}', '{lead.read}', '{forms.submission.update}',
      '{forms.submission.read,forms.submission.read}', '{blog.post.write}', '{users.manage}']) {
      await fails(`update public.project_members set extra_permissions = $2 where user_id = $1`, [ids.editorA1, bad], '23514')
    }
  })
  it('tenant: invoices and project-scoped extras ok; non-grantable refused', async () => {
    await q(`update public.tenant_members set extra_permissions = '{billing.invoice.read,forms.submission.read}' where user_id = $1`, [ids.memberA])
    await fails(`update public.tenant_members set extra_permissions = '{billing.manage}' where user_id = $1`, [ids.memberA], '23514')
  })
})

describe('last Owner', () => {
  it('the only Owner cannot be removed or demoted', async () => {
    await fails(`delete from public.tenant_members where user_id = $1`, [ids.ownerB], '23514', /at least one Owner/)
    await fails(`update public.tenant_members set role = 'member' where user_id = $1`, [ids.ownerB], '23514', /at least one Owner/)
  })
  it('with a second Owner, one can leave', async () => {
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tenantA, ids.owner2A])
    await q(`delete from public.tenant_members where user_id = $1`, [ids.owner2A])
    await fails(`delete from public.tenant_members where user_id = $1`, [ids.ownerA], '23514')
  })
  it('deleting the client itself still cascades', async () => {
    const t = await one(`insert into public.tenants (slug, display_name) values ('h-gone','G') returning id`)
    await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [t, ids.x2])
    await q(`delete from public.tenants where id = $1`, [t])
    expect(await q(`select 1 from public.tenant_members where tenant_id = $1`, [t])).toEqual([])
  })
})

describe('invitations — shape', () => {
  const inv = (cols, vals, p) => q(`insert into public.invitations (${cols}) values (${vals}) returning id`, p)
  it('valid tenant and project invitations are accepted', async () => {
    await inv(`email, scope_type, tenant_id, role, token_hash`, `'m@x.y','tenant',$1,'member',$2`, [ids.tenantA, 'a' + TOKEN])
    await inv(`email, scope_type, project_id, role, extra_permissions, token_hash`,
      `'e@x.y','project',$1,'editor','{forms.submission.read}',$2`, [ids.A1, 'b' + TOKEN])
  })
  it('scope/role mismatches, retired roles, bad emails, long expiry and bad extras are refused', async () => {
    const bad = [
      [`'v@x.y','project',null,$1,'viewer'`, [ids.A1]],
      [`'v@x.y','project',null,$1,'owner'`, [ids.A1]],
      [`'v@x.y','tenant',$1,null,'editor'`, [ids.tenantA]],
      [`'v@x.y','tenant',$1,null,'admin'`, [ids.tenantA]],
      [`'V@X.Y','tenant',$1,null,'member'`, [ids.tenantA]],
    ]
    for (const [vals, p] of bad) {
      await fails(`insert into public.invitations (email, scope_type, tenant_id, project_id, role, token_hash)
        values (${vals}, '${'c' + TOKEN}')`, p, '23514')
    }
    await fails(`insert into public.invitations (email, scope_type, project_id, role, token_hash, expires_at)
      values ('l@x.y','project',$1,'editor',$2, now() + interval '60 days')`, [ids.A1, 'd' + TOKEN], '23514')
    await fails(`insert into public.invitations (email, scope_type, project_id, role, token_hash, extra_permissions)
      values ('l@x.y','project',$1,'editor',$2,'{billing.invoice.read}')`, [ids.A1, 'e' + TOKEN], '23514')
    await fails(`insert into public.invitations (email, scope_type, project_id, role, token_hash)
      values ('s@x.y','project',$1,'editor','short')`, [ids.A1], '23514')
  })
  it('one pending invitation per person and place; a revoked one frees the slot', async () => {
    await fails(`insert into public.invitations (email, scope_type, project_id, role, token_hash)
      values ('e@x.y','project',$1,'editor',$2)`, [ids.A1, 'f' + TOKEN], '23505')
    await q(`update public.invitations set revoked_at = now() where email = 'e@x.y'`)
    await inv(`email, scope_type, project_id, role, token_hash`, `'e@x.y','project',$1,'editor',$2`, [ids.A1, 'g' + TOKEN])
  })
  it('accepted and revoked at once is refused', async () => {
    await fails(`update public.invitations set accepted_at = now(), accepted_by = $1, revoked_at = now() where email = 'm@x.y'`,
      [ids.x1], '23514')
  })
})

describe('server-only: no API role can touch the new tables', () => {
  for (const t of ['invitations', 'grantable_permissions']) {
    it(`${t}: anon and authenticated are denied`, async () => {
      await asAnon()
      await fails(`select * from public.${t}`, [], '42501')
      await asUser(ids.ownerA)
      await fails(`select * from public.${t}`, [], '42501')
      await fails(`delete from public.${t}`, [], '42501')
    })
  }
  it('an owner cannot write memberships or extras through the API', async () => {
    await asUser(ids.ownerA)
    await fails(`update public.project_members set extra_permissions = '{forms.submission.read}'`, [], '42501')
    await fails(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tenantA, ids.ownerA], '42501')
  })
  it('the new functions are not callable by API roles', async () => {
    await asAnon()
    await fails(`select public.validate_extra_permissions('{}', 'project')`, [], '42501')
    await asUser(ids.ownerA)
    await fails(`select public.validate_extra_permissions('{}', 'project')`, [], '42501')
  })
})

describe('Site admin is a writer on its own project only', () => {
  it('can update contact-request status on A1, not on B1', async () => {
    await asUser(ids.adminA1)
    expect((await q(`select id from public.get_my_writable_project_ids() id`)).map((r) => r.id)).toEqual([ids.A1])
    await q(`update public.form_submissions set status = 'archived' where id = $1`, [ids.subA1])
    await q(`update public.form_submissions set status = 'archived' where id = $1`, [ids.subB1]) // RLS: 0 rows
    await reset()
    expect((await q(`select status from public.form_submissions where id = $1`, [ids.subB1]))[0].status).not.toBe('archived')
  })
})

describe('rollback-029 restores the pre-029 shape (when no new data exists)', () => {
  it('refuses while 029-only data exists, then undoes cleanly once it is removed', async () => {
    const R = path.join(__dirname, 'rollback-029.sql')
    let err
    try { await applyMigrationFile(client, R) } catch (e) { err = e }
    try { await client.query('rollback') } catch {}
    expect(err?.message).toMatch(/rollback-029: data created since 029 exists/)
    await q(`delete from public.invitations`)
    await q(`delete from public.project_members where role = 'admin'`)
    await q(`update public.project_members set extra_permissions = '{}'`)
    await q(`update public.tenant_members set extra_permissions = '{}'`)
    await q(`delete from public.tenant_members where role = 'member'`)
    await applyMigrationFile(client, R)
    expect(await q(`select to_regclass('public.invitations') as t`)).toEqual([{ t: null }])
    // And 029 applies again on top.
    await applyMigrationFile(client, M029)
  })
})

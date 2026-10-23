/**
 * Migration 046 — support tickets (ADR-039). Proves: nobody but the service
 * role reads or writes any ticket table (clients reach tickets only through
 * server code); the write functions are service-role only; create is
 * idempotent per submit token and rate-limited; the status rules (client reply
 * on waiting_for_user → open, reopen within 14 days, refused after); resolving
 * starts the screenshot retention clock and reopening stops it; severity
 * changes are internal events; redaction really removes the text; the outbox
 * gets one row per notifying event; the bucket is private; no re-run.
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
const M046 = MIG('046_support_tickets.sql')
const TABLES = ['support_tickets', 'support_ticket_messages', 'support_ticket_notes', 'support_ticket_attachments',
  'support_ticket_events', 'support_ticket_reads', 'support_ticket_outbox']

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
let n = 0
async function create(user = null, token = null, project = ids.pA1) {
  // A fresh person per ticket unless one is given, so the per-person hourly cap does not interfere.
  if (!user) { await reset(); user = await one(`insert into auth.users (email) values ($1) returning id`, [`u${++n}@st.test`]) }
  await asService()
  const r = (await q(`select * from public.support_ticket_create($1, $2, 'Publish button', 'It does nothing', '{"page":"/x"}'::jsonb, $3, 'production')`, [project, user, token]))[0]
  await reset()
  return r
}
const reply = async (ticket, author, kind, body = 'more info') => { await asService(); const r = await q(`select public.support_ticket_reply($1, $2, $3, $4, 'production') as id`, [ticket, author, kind, body]); await reset(); return r[0].id }
const setStatus = async (ticket, status) => { await asService(); await q(`select public.support_ticket_set_status($1, $2, $3, 'production')`, [ticket, ids.admin, status]); await reset() }
const ticket = async (id) => (await q(`select * from public.support_tickets where id = $1`, [id]))[0]

beforeAll(async () => {
  ;({ client } = await startHarness())
  for (const f of CHAIN) await applyMigrationFile(client, MIG(f))
  await applyMigrationFile(client, M046)
  ids.tA = await one(`insert into public.tenants (slug, display_name) values ('st-a','A') returning id`)
  ids.pA1 = await one(`insert into public.projects (slug, tenant_id, name) values ('st-a1',$1,'A1') returning id`, [ids.tA])
  for (const u of ['admin', 'ownerA', 'editorA1', 'spammer']) {
    ids[u] = await one(`insert into auth.users (email) values ($1) returning id`, [`${u}@st.test`])
  }
  await q(`insert into public.tenant_members (tenant_id, user_id, role) values ($1,$2,'owner')`, [ids.tA, ids.ownerA])
  await q(`insert into public.project_members (project_id, user_id, role) values ($1,$2,'editor')`, [ids.pA1, ids.editorA1])
}, 120_000)
afterAll(async () => { await stopHarness(client) }, 30_000)
beforeEach(async () => { await reset() })

describe('046 — locked to the service role', () => {
  it('a member (even the Owner) and anon cannot read or write any ticket table', async () => {
    await create()
    for (const t of TABLES) {
      await asUser(ids.ownerA)
      expect((await errOf(() => q(`select * from public.${t}`)))?.code, t).toBe('42501')
      await asAnon()
      expect((await errOf(() => q(`select * from public.${t}`)))?.code, t).toBe('42501')
    }
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`insert into public.support_ticket_notes (ticket_id, body) values (gen_random_uuid(), 'x')`)))?.code).toBe('42501')
  })
  it('members cannot call the write functions', async () => {
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`select * from public.support_ticket_create($1, $2, 't', 'b', '{}'::jsonb, null, 'production')`, [ids.pA1, ids.ownerA])))?.code).toBe('42501')
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`select public.support_ticket_set_status(gen_random_uuid(), $1, 'resolved', 'production')`, [ids.ownerA])))?.code).toBe('42501')
  })
  it('the bucket exists and is private; support.tickets.read is grantable on projects', async () => {
    expect((await q(`select public from storage.buckets where id = 'support-attachments'`))[0].public).toBe(false)
    expect((await q(`select applies_to from public.grantable_permissions where id = 'support.tickets.read'`))[0].applies_to).toBe('project')
  })
  it('cannot be applied twice', async () => {
    expect(await errOf(() => applyMigrationFile(client, M046))).not.toBeNull()
  })
})

describe('046 — create', () => {
  it('creates ticket + first message + created event + outbox row; numbers increase', async () => {
    const a = await create()
    const b = await create()
    expect(a.created).toBe(true)
    expect(Number(b.number)).toBe(Number(a.number) + 1)
    const t = await ticket(a.id)
    expect(t.status).toBe('open')
    expect(t.severity).toBe('normal')
    expect((await q(`select author_kind, body from public.support_ticket_messages where ticket_id = $1`, [a.id]))).toEqual([{ author_kind: 'client', body: 'It does nothing' }])
    expect((await q(`select event_type from public.support_ticket_outbox where ticket_id = $1`, [a.id]))).toEqual([{ event_type: 'ticket.created' }])
  })
  it('the same submit token returns the first ticket instead of creating a second', async () => {
    const token = '11111111-1111-1111-1111-111111111111'
    const a = await create(ids.editorA1, token)
    const b = await create(ids.editorA1, token)
    expect(b.id).toBe(a.id)
    expect(b.created).toBe(false)
    expect((await q(`select count(*)::int as n from public.support_tickets where submit_token = $1`, [token]))[0].n).toBe(1)
  })
  it('the 6th ticket within an hour is refused', async () => {
    for (let i = 0; i < 5; i++) await create(ids.spammer)
    const e = await errOf(() => create(ids.spammer))
    expect(e?.message).toContain('support_ticket:rate_limited')
  })
  it('CHECKs: empty title, unknown status/severity', async () => {
    await asService()
    expect((await errOf(() => q(`select * from public.support_ticket_create($1, $2, '   ', 'b', '{}'::jsonb, null, 'production')`, [ids.pA1, ids.ownerA])))?.code).toBe('23514')
    const a = await create()
    expect((await errOf(() => q(`update public.support_tickets set severity = 'critical' where id = $1`, [a.id])))?.code).toBe('23514')
    expect((await errOf(() => q(`update public.support_tickets set status = 'closed' where id = $1`, [a.id])))?.code).toBe('23514')
  })
})

describe('046 — status rules', () => {
  it('client reply on waiting_for_user → open, with a public status event', async () => {
    const a = await create()
    await setStatus(a.id, 'waiting_for_user')
    await reply(a.id, ids.ownerA, 'client')
    expect((await ticket(a.id)).status).toBe('open')
    const ev = await q(`select kind, from_value, to_value, visibility from public.support_ticket_events where ticket_id = $1 order by created_at`, [a.id])
    expect(ev.at(-1)).toEqual({ kind: 'status_changed', from_value: 'waiting_for_user', to_value: 'open', visibility: 'public' })
  })
  it('client reply on in_progress leaves the status; support reply never changes it', async () => {
    const a = await create()
    await setStatus(a.id, 'in_progress')
    await reply(a.id, ids.ownerA, 'client')
    expect((await ticket(a.id)).status).toBe('in_progress')
    await setStatus(a.id, 'waiting_for_user')
    await reply(a.id, ids.admin, 'support')
    expect((await ticket(a.id)).status).toBe('waiting_for_user')
  })
  it('resolve sets resolved_at, retention clock and a ticket.resolved email; reopen clears them', async () => {
    const a = await create()
    await q(`insert into public.support_ticket_attachments (ticket_id, storage_path, mime, bytes) values ($1, $2, 'image/png', 100)`, [a.id, `${a.id}/x.png`])
    await setStatus(a.id, 'resolved')
    let t = await ticket(a.id)
    expect(t.resolved_at).not.toBeNull()
    const exp = (await q(`select expires_at from public.support_ticket_attachments where ticket_id = $1`, [a.id]))[0].expires_at
    expect(Math.round((new Date(exp) - new Date(t.resolved_at)) / 86400000)).toBe(90)
    expect((await q(`select event_type from public.support_ticket_outbox where ticket_id = $1 order by created_at`, [a.id])).map((r) => r.event_type)).toEqual(['ticket.created', 'ticket.resolved'])
    await setStatus(a.id, 'in_progress')
    t = await ticket(a.id)
    expect(t.resolved_at).toBeNull()
    expect((await q(`select expires_at from public.support_ticket_attachments where ticket_id = $1`, [a.id]))[0].expires_at).toBeNull()
  })
  it('client reply within 14 days reopens a resolved ticket; after 14 days it is refused', async () => {
    const a = await create()
    await setStatus(a.id, 'resolved')
    await reply(a.id, ids.ownerA, 'client')
    expect((await ticket(a.id)).status).toBe('open')
    expect((await q(`select kind from public.support_ticket_events where ticket_id = $1 and kind = 'reopened_by_reply'`, [a.id])).length).toBe(1)
    await setStatus(a.id, 'resolved')
    await q(`update public.support_tickets set resolved_at = now() - interval '15 days' where id = $1`, [a.id])
    const e = await errOf(() => reply(a.id, ids.ownerA, 'client'))
    expect(e?.message).toContain('support_ticket:closed')
    expect((await ticket(a.id)).status).toBe('resolved')
  })
  it('replies write the right outbox event', async () => {
    const a = await create()
    await reply(a.id, ids.admin, 'support')
    await reply(a.id, ids.ownerA, 'client')
    expect((await q(`select event_type from public.support_ticket_outbox where ticket_id = $1 order by created_at`, [a.id])).map((r) => r.event_type))
      .toEqual(['ticket.created', 'ticket.support_replied', 'ticket.client_replied'])
  })
  it('severity change is an internal event and never emails', async () => {
    const a = await create()
    await asService()
    await q(`select public.support_ticket_set_severity($1, $2, 'high')`, [a.id, ids.admin])
    await reset()
    expect((await ticket(a.id)).severity).toBe('high')
    expect((await q(`select visibility from public.support_ticket_events where ticket_id = $1 and kind = 'severity_changed'`, [a.id]))[0].visibility).toBe('internal')
    expect((await q(`select count(*)::int as n from public.support_ticket_outbox where ticket_id = $1`, [a.id]))[0].n).toBe(1)
  })
  it('redaction removes the text and logs an internal event', async () => {
    const a = await create()
    const m = await reply(a.id, ids.ownerA, 'client', 'patient Mario Rossi')
    await asService()
    await q(`select public.support_ticket_redact_message($1, $2)`, [m, ids.admin])
    await reset()
    const row = (await q(`select body, redacted_at from public.support_ticket_messages where id = $1`, [m]))[0]
    expect(row.body).toBe('')
    expect(row.redacted_at).not.toBeNull()
    expect((await q(`select count(*)::int as n from public.support_ticket_events where ticket_id = $1 and kind = 'message_redacted'`, [a.id]))[0].n).toBe(1)
  })
})

describe('047 — round 2', () => {
  it('applies on top of 046', async () => {
    await applyMigrationFile(client, MIG('047_support_tickets_round2.sql'))
    expect(await errOf(() => applyMigrationFile(client, MIG('047_support_tickets_round2.sql')))).not.toBeNull()
  })
  it('read marks are per side', async () => {
    const a = await create()
    await q(`insert into public.support_ticket_reads (ticket_id, user_id, side) values ($1, $2, 'client'), ($1, $2, 'support')`, [a.id, ids.admin])
    expect((await q(`select count(*)::int as n from public.support_ticket_reads where ticket_id = $1`, [a.id]))[0].n).toBe(2)
  })
  it('waiting_for_user without a recent reply queues an email; with a recent reply it does not', async () => {
    const a = await create()
    await setStatus(a.id, 'waiting_for_user')
    expect((await q(`select event_type from public.support_ticket_outbox where ticket_id = $1 order by created_at`, [a.id])).map((r) => r.event_type)).toEqual(['ticket.created', 'ticket.waiting_for_user'])
    const b = await create()
    await reply(b.id, ids.admin, 'support')
    await setStatus(b.id, 'waiting_for_user')
    expect((await q(`select event_type from public.support_ticket_outbox where ticket_id = $1 order by created_at`, [b.id])).map((r) => r.event_type)).toEqual(['ticket.created', 'ticket.support_replied'])
  })
  it('a reply right after "waiting" skips the pending waiting email', async () => {
    const a = await create()
    await setStatus(a.id, 'waiting_for_user')
    await reply(a.id, ids.admin, 'support')
    const rows = await q(`select event_type, status from public.support_ticket_outbox where ticket_id = $1 order by created_at`, [a.id])
    expect(rows).toEqual([{ event_type: 'ticket.created', status: 'pending' }, { event_type: 'ticket.waiting_for_user', status: 'skipped' }, { event_type: 'ticket.support_replied', status: 'pending' }])
  })
  it('members still cannot call the functions', async () => {
    await asUser(ids.ownerA)
    expect((await errOf(() => q(`select public.support_ticket_set_status(gen_random_uuid(), $1, 'resolved', 'production')`, [ids.ownerA])))?.code).toBe('42501')
  })
})

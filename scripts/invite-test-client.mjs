#!/usr/bin/env node
// Invite a TEST tenant OWNER — exactly what POST /api/tenants/[tenantId]/invite
// does, without needing an admin session in a browser.
//
//   node scripts/invite-test-client.mjs <email> [projectSlug] [--tenant-id <uuid>]
//                                       [--origin <url>] [--invited-by <uuid>] [--send]
//
//   projectSlug   defaults to "abluo". The invite is for the TENANT that owns
//                 that project (owners are tenant-level, ADR-017 Decision 2).
//                 Project slugs are unique per tenant (migration 023), so if
//                 more than one tenant has a project with that slug, pass
//                 --tenant-id to pick one.
//   --origin      where the invite lands; default https://dev.abluo.app
//                 (or $INVITE_ORIGIN). redirectTo = <origin>/invite/accept —
//                 the same target the API route builds from its request origin.
//                 That URL must be on the Supabase Auth redirect allowlist.
//   --invited-by  the abluo_admin user id recorded as `invited_by`; default:
//                 the single abluo_admin found (the API route records the
//                 calling admin).
//   --send        actually send. WITHOUT it this is a DRY RUN: it only reads
//                 (project, tenant, admin, whether the email already exists)
//                 and prints what it would send.
//
// Metadata is identical to the API route — { tenant_id, role: 'owner',
// invited_by } — which is what handle_user_invited() (migration 024) turns into
// a tenant_members row once GoTrue stamps auth.users.invited_at. This script
// never writes tenant_members itself.
//
// Uses SUPABASE_SERVICE_ROLE_KEY from .env.local. Prints only non-secret
// values: email, ids, slugs, names, the redirect URL and HTTP statuses.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const l of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flags = {}
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--send') flags.send = true
  else if (a === '--tenant-id' || a === '--origin' || a === '--invited-by') flags[a.slice(2)] = argv[++i]
  else if (a.startsWith('--')) { console.error(`Unknown flag ${a}`); process.exit(2) }
  else positional.push(a)
}
const email = (positional[0] ?? '').trim()
const projectSlug = (positional[1] ?? 'abluo').trim()
const origin = (flags.origin ?? env.INVITE_ORIGIN ?? process.env.INVITE_ORIGIN ?? 'https://dev.abluo.app').replace(/\/+$/, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/invite-test-client.mjs <email> [projectSlug] [--tenant-id <uuid>] [--origin <url>] [--invited-by <uuid>] [--send]')
  process.exit(2)
}
for (const k of ['tenant-id', 'invited-by']) {
  if (flags[k] !== undefined && !UUID.test(flags[k])) { console.error(`--${k} must be a uuid`); process.exit(2) }
}
try { new URL(origin) } catch { console.error(`--origin is not a URL: ${origin}`); process.exit(2) }

// ── http ────────────────────────────────────────────────────────────────────
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
async function call(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  let j = null
  try { j = await r.json() } catch { /* empty body */ }
  if (!r.ok) {
    // Auth/PostgREST error messages carry no secrets; never print headers.
    const msg = j?.msg ?? j?.message ?? j?.error_description ?? j?.error ?? ''
    throw new Error(`${method} ${new URL(url).pathname} → HTTP ${r.status}${msg ? ` (${msg})` : ''}`)
  }
  return j
}
const rest = (p) => `${SUPABASE_URL}/rest/v1/${p}`
const auth = (p) => `${SUPABASE_URL}/auth/v1/${p}`

// ── resolve project → tenant ────────────────────────────────────────────────
let projects = await call('GET', rest(`projects?slug=eq.${encodeURIComponent(projectSlug)}&select=id,slug,name,status,tenant_id`))
if (flags['tenant-id']) projects = projects.filter((p) => p.tenant_id === flags['tenant-id'])
if (projects.length === 0) {
  console.error(`No project with slug "${projectSlug}"${flags['tenant-id'] ? ` under tenant ${flags['tenant-id']}` : ''}.`)
  process.exit(1)
}
if (projects.length > 1) {
  console.error(`Slug "${projectSlug}" exists under ${projects.length} tenants — pass --tenant-id:`)
  for (const p of projects) console.error(`  tenant ${p.tenant_id}  project ${p.id}  (${p.name})`)
  process.exit(1)
}
const project = projects[0]
const [tenant] = await call('GET', rest(`tenants?id=eq.${project.tenant_id}&select=*`))
if (!tenant) { console.error(`Tenant ${project.tenant_id} not found.`); process.exit(1) }

// ── admin (invited_by) + does the email already exist? ──────────────────────
const admins = []
let existing = null
for (let page = 1; ; page++) {
  const j = await call('GET', auth(`admin/users?page=${page}&per_page=200`))
  const users = j.users || []
  for (const u of users) {
    if (u.app_metadata?.platform_role === 'abluo_admin') admins.push(u)
    if ((u.email ?? '').toLowerCase() === email.toLowerCase()) existing = u
  }
  if (users.length < 200) break
}
let invitedBy = flags['invited-by']
if (!invitedBy) {
  if (admins.length !== 1) {
    console.error(`Found ${admins.length} abluo_admin users — pass --invited-by <uuid>.`)
    process.exit(1)
  }
  invitedBy = admins[0].id
}

const redirectTo = `${origin}/invite/accept`
const data = { tenant_id: project.tenant_id, role: 'owner', invited_by: invitedBy }

console.log(JSON.stringify({
  mode: flags.send ? 'SEND' : 'DRY RUN',
  email,
  project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
  tenant: { id: tenant.id, name: tenant.name ?? null },
  metadata: data,
  redirectTo,
  existingUser: existing ? { id: existing.id, invited_at: existing.invited_at ?? null, confirmed: Boolean(existing.email_confirmed_at) } : null,
}, null, 1))

if (existing) {
  // GoTrue's re-invite path MERGES `data` into the existing user's metadata
  // and does not re-fire the membership trigger for an already-stamped user
  // (migration 024 header). Refuse rather than half-work.
  console.error('That email already has an auth user. Use a fresh address (e.g. a +alias) for a test client.')
  process.exit(1)
}

if (!flags.send) {
  console.log('Dry run — nothing sent. Re-run with --send to send the invite.')
  process.exit(0)
}

const qs = new URLSearchParams({ redirect_to: redirectTo })
const user = await call('POST', `${auth('invite')}?${qs}`, { email, data })
console.log(JSON.stringify({ sent: true, userId: user?.id ?? null, email }, null, 1))
console.log(`Invite sent. The link lands on ${redirectTo}; after setting a password the user is sent to /auth/continue → /<locale>/account.`)

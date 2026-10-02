#!/usr/bin/env node
// Post-apply check for migration 028 against the LIVE project.
// Uses ONLY the public anon key from .env.local (never prints it). Read-only:
// INSERT probes send an empty array, UPDATE/DELETE use a filter that matches
// nothing, so no row can be written or removed.
//
//   node supabase/verify/post-apply-028.mjs
//   # optional, signed-in checks (a real tenant user / Tom's admin user):
//   ABLUO_USER_EMAIL=… ABLUO_USER_PASSWORD=… node supabase/verify/post-apply-028.mjs
//   # admin with 2FA: add the current 6-digit code from the authenticator app
//   ABLUO_USER_EMAIL=… ABLUO_USER_PASSWORD=… ABLUO_USER_TOTP=123456 node supabase/verify/post-apply-028.mjs
// Without ABLUO_USER_TOTP an admin session is aal1 and must see NO cross-tenant rows.
//
// Exit code 0 = every check passed.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = {}
for (const l of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) { console.error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing in .env.local'); process.exit(2) }

const NIL = '00000000-0000-0000-0000-000000000000'
const TABLES = { tenants: 'id', projects: 'id', tenant_members: 'id', project_members: 'id', profiles: 'id',
  inquiries: 'id', form_submissions: 'id', form_events: 'event_id', translation_usage: 'id' }
let fails = 0
const ok = (cond, label, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`); if (!cond) fails++ }
const call = async (method, p, { body, token = ANON, prefer } = {}) => {
  const h = { apikey: ANON, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  if (prefer) h.Prefer = prefer
  const r = await fetch(URL_ + p, { method, headers: h, body })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
const isDenied = (r, table) => r.body?.code === '42501' && (!table || String(r.body.message).includes(`table ${table}`))

console.log('── anon: every table, every verb ──')
for (const [t, k] of Object.entries(TABLES)) {
  ok(isDenied(await call('GET', `/rest/v1/${t}?select=*&limit=1`), t), `anon SELECT ${t} denied`)
  ok(isDenied(await call('POST', `/rest/v1/${t}`, { body: '[]', prefer: 'return=minimal' }), t), `anon INSERT ${t} denied`)
  ok(isDenied(await call('PATCH', `/rest/v1/${t}?${k}=eq.${NIL}`, { body: JSON.stringify({ [k]: NIL }), prefer: 'return=minimal' }), t), `anon UPDATE ${t} denied (on ${t} itself)`)
  ok(isDenied(await call('DELETE', `/rest/v1/${t}?${k}=eq.${NIL}`, { prefer: 'return=minimal' }), t), `anon DELETE ${t} denied (on ${t} itself)`)
}
ok((await call('GET', '/rest/v1/leads?select=id&limit=1')).status === 404, 'leads table is gone (026)')

console.log('── anon: RPC ──')
for (const f of ['get_my_tenant_ids', 'get_my_writable_tenant_ids', 'get_my_owned_tenant_ids', 'get_my_project_ids',
  'get_my_writable_project_ids', 'is_abluo_admin']) {
  const r = await call('POST', `/rest/v1/rpc/${f}`, { body: '{}' })
  ok(isDenied(r), `anon cannot execute ${f}()`, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
}
ok(isDenied(await call('POST', '/rest/v1/rpc/translation_usage_month_total', { body: JSON.stringify({ p_project_id: NIL, p_since: '2026-01-01T00:00:00Z' }) })), 'anon cannot execute translation_usage_month_total()')
ok(isDenied(await call('POST', '/rest/v1/rpc/custom_access_token_hook', { body: JSON.stringify({ event: {} }) })), 'anon cannot execute custom_access_token_hook()')

console.log('── auth + storage ──')
const s = (await call('GET', '/auth/v1/settings')).body
ok(s.disable_signup === true, 'self-signup disabled', `disable_signup=${s.disable_signup}`)
const ext = Object.entries(s.external || {}).filter(([k, v]) => v && k !== 'email').map(([k]) => k)
ok(ext.length === 0, 'no social sign-in providers enabled', ext.join(','))
const b = await call('GET', '/storage/v1/bucket')
ok(Array.isArray(b.body) && b.body.length === 0, 'anon sees no storage buckets', JSON.stringify(b.body).slice(0, 120))
const g = await call('POST', '/graphql/v1', { body: JSON.stringify({ query: '{__typename}' }) })
ok(JSON.stringify(g.body).includes('not enabled') || g.status === 404, 'pg_graphql not exposed', JSON.stringify(g.body).slice(0, 120))

if (process.env.ABLUO_USER_EMAIL) {
  console.log('── signed-in user ──')
  const email = process.env.ABLUO_USER_EMAIL, password = process.env.ABLUO_USER_PASSWORD
  const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json())
  if (!tok.access_token) { ok(false, 'sign-in', tok.error_description || tok.msg || 'no token') }
  else {
    let T = tok.access_token
    const role = tok.user?.app_metadata?.platform_role
    const claim = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).aal
    if (process.env.ABLUO_USER_TOTP) {
      const totp = (tok.user?.factors || []).find((f) => f.factor_type === 'totp' && f.status === 'verified')
      if (!totp) ok(false, 'MFA', 'no verified TOTP factor on this user')
      else {
        const ah = { apikey: ANON, Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }
        const ch = await fetch(`${URL_}/auth/v1/factors/${totp.id}/challenge`, { method: 'POST', headers: ah, body: '{}' }).then((r) => r.json())
        const v = await fetch(`${URL_}/auth/v1/factors/${totp.id}/verify`, { method: 'POST', headers: ah,
          body: JSON.stringify({ challenge_id: ch.id, code: process.env.ABLUO_USER_TOTP }) }).then((r) => r.json())
        if (v.access_token) T = v.access_token
        ok(claim(T) === 'aal2', 'MFA verify → aal2 session', v.error_description || v.msg || claim(T))
      }
    }
    const aal = claim(T)
    console.log(`   session: platform_role=${role ?? '-'} aal=${aal}`)
    const adminActive = role === 'abluo_admin' && aal === 'aal2'
    const myProjects = new Set((await call('POST', '/rest/v1/rpc/get_my_project_ids', { body: '{}', token: T })).body)
    const myTenants = new Set((await call('POST', '/rest/v1/rpc/get_my_tenant_ids', { body: '{}', token: T })).body)
    const isAdmin = (await call('POST', '/rest/v1/rpc/is_abluo_admin', { body: '{}', token: T })).body
    ok(isAdmin === adminActive, `is_abluo_admin() = ${adminActive} (admin flag AND aal2 required)`, JSON.stringify(isAdmin))
    for (const t of Object.keys(TABLES)) {
      const r = await call('GET', `/rest/v1/${t}?select=*`, { token: T })
      ok(Array.isArray(r.body), `${email} can read ${t} (no 42501)`, JSON.stringify(r.body).slice(0, 120))
      if (!Array.isArray(r.body)) continue
      if (t === 'profiles') ok(r.body.length === 1 && r.body[0].id === tok.user.id, 'profiles: only my own')
      if (adminActive) { console.log(`   ${t}: ${r.body.length} rows visible to admin`); continue }
      if (['form_submissions', 'form_events', 'translation_usage'].includes(t))
        ok(r.body.every((x) => myProjects.has(x.project_id)), `${t}: every row is in one of my projects`)
      if (t === 'tenants') ok(r.body.every((x) => myTenants.has(x.id)), 'tenants: only my tenants')
    }
    ok(isDenied(await call('POST', '/rest/v1/form_submissions', { body: '[]', token: T, prefer: 'return=minimal' })), 'signed-in INSERT form_submissions denied')
    ok(isDenied(await call('DELETE', `/rest/v1/form_submissions?id=eq.${NIL}`, { token: T, prefer: 'return=minimal' })), 'signed-in DELETE form_submissions denied')
    ok(isDenied(await call('PATCH', `/rest/v1/form_submissions?id=eq.${NIL}`, { token: T, body: JSON.stringify({ submission_data: {} }), prefer: 'return=minimal' })), 'signed-in UPDATE of submission_data denied (status only)')
  }
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed.')
process.exit(fails ? 1 : 0)

#!/usr/bin/env node
// Read-only: which auth users carry app_metadata.platform_role = "abluo_admin",
// and whether each has a VERIFIED TOTP factor (needed for aal2, which 028's
// is_abluo_admin() requires). Uses SUPABASE_SERVICE_ROLE_KEY from .env.local
// for GETs on the Auth admin API (list users, then each admin's factors);
// prints only email, role and factor status — never a key or token.
//   node supabase/verify/check-admin-flag.mjs
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = {}
for (const l of readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !K) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}
const H = { apikey: K, Authorization: 'Bearer ' + K }

async function getJson(url) {
  const r = await fetch(url, { headers: H })
  // Never echo the response body on failure — only the status.
  if (!r.ok) throw new Error(`GET ${new URL(url).pathname} → HTTP ${r.status}`)
  return r.json()
}

// The list-users payload does NOT include MFA factors, so the old check
// (`u.factors`) always read "no factor" — even for an admin with a verified
// TOTP. Factors come from the per-user admin endpoint:
//   GET /auth/v1/admin/users/{id}/factors   (what supabase-js
//   auth.admin.mfa.listFactors({ userId }) calls)
// It has answered both as a bare array and as { factors: [...] } across
// GoTrue versions; accept either.
async function factorsFor(userId) {
  const j = await getJson(`${URL_}/auth/v1/admin/users/${encodeURIComponent(userId)}/factors`)
  return Array.isArray(j) ? j : Array.isArray(j?.factors) ? j.factors : []
}

const admins = []
for (let page = 1; ; page++) {
  const j = await getJson(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`)
  const users = j.users || []
  for (const u of users) {
    if (u.app_metadata?.platform_role !== 'abluo_admin') continue
    const factors = await factorsFor(u.id)
    admins.push({
      email: u.email,
      platform_role: 'abluo_admin',
      verified_totp: factors.some((f) => f.factor_type === 'totp' && f.status === 'verified'),
      factors: factors.map((f) => `${f.factor_type}:${f.status}`),
    })
  }
  if (users.length < 200) break
}
console.log(JSON.stringify(admins, null, 1))
const ready = admins.some((a) => a.verified_totp)
console.log(ready ? 'OK: at least one abluo_admin has a verified TOTP factor.'
  : 'NOT READY: no abluo_admin has a verified TOTP factor — enrol 2FA before applying 028.')
process.exit(admins.length && ready ? 0 : 1)

#!/usr/bin/env node
// Read-only: which auth users carry app_metadata.platform_role = "abluo_admin",
// and whether each has a VERIFIED TOTP factor (needed for aal2, which 028's
// is_abluo_admin() requires). Uses SUPABASE_SERVICE_ROLE_KEY from .env.local
// for one GET on the Auth admin API; prints only email, role and factor status.
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
const H = { apikey: K, Authorization: 'Bearer ' + K }
const admins = []
for (let page = 1; ; page++) {
  const j = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H }).then((r) => r.json())
  const users = j.users || []
  for (const u of users) if (u.app_metadata?.platform_role === 'abluo_admin')
    admins.push({ email: u.email, platform_role: 'abluo_admin',
      verified_totp: (u.factors || []).some((f) => f.factor_type === 'totp' && f.status === 'verified'),
      factors: (u.factors || []).map((f) => `${f.factor_type}:${f.status}`) })
  if (users.length < 200) break
}
console.log(JSON.stringify(admins, null, 1))
const ready = admins.some((a) => a.verified_totp)
console.log(ready ? 'OK: at least one abluo_admin has a verified TOTP factor.'
  : 'NOT READY: no abluo_admin has a verified TOTP factor — enrol 2FA before applying 028.')
process.exit(admins.length && ready ? 0 : 1)

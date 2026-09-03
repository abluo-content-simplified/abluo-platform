#!/usr/bin/env node
/**
 * Abluo — POST-DEPLOY LIVE PROBE
 *
 * ── Why this exists, when 2051 unit tests already pass ──────────────────────
 * On 2026-09-02 `preview.abluo.app/en/dashboard` served 200 to an anonymous
 * request, with every project name and UUID in the payload. The suite was
 * green. It was found by typing a URL into curl.
 *
 * Tests prove the code is right. They cannot prove that the code which is
 * RUNNING is the code that was tested: a build can be stale, an alias can point
 * at an old deployment, a Vercel setting can rewrite ahead of the middleware,
 * an env var can be missing so a gate fails open. Every one of those is
 * invisible to vitest and visible to curl.
 *
 * So this asserts the same invariants as `src/lib/proxy/__tests__/` — against
 * the deployed system, over the network, as an anonymous visitor.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   node scripts/probe-live.mjs                  # production hosts
 *   node scripts/probe-live.mjs --staging        # dev + preview too
 *   node scripts/probe-live.mjs --host x.com     # one host
 *   node scripts/probe-live.mjs --expect-commit 2a82842
 *
 * Exit 0 = every invariant held. Exit 1 = at least one failed. Exit 2 = could
 * not run (network, bad arguments). Run it after every promotion.
 *
 * Read-only: GETs and HEADs, no cookies, no credentials, no writes.
 */

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }

const TIMEOUT_MS = 20000
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }

/** Public customer sites. These must SERVE. */
const CUSTOMER_HOSTS = [
  'livener.net',
  'www.studiomartegani.com',
  'nologo.cloud',
  'ch-psicoterapeuta.com',
  'abluo.app',
]

/** Platform hosts that path-route. Also must serve. */
const PLATFORM_HOSTS = ['preview.abluo.app', 'dev.abluo.app']

/**
 * Gated surfaces. An anonymous request must NEVER get 200 on any of these, on
 * ANY host. Both bare and locale-prefixed: the locale-prefixed spelling is the
 * one that actually leaked, because it took a different middleware branch.
 */
const GATED = [
  '/dashboard', '/clients', '/content', '/media', '/projects', '/settings', '/account',
  '/en/dashboard', '/en/clients', '/en/content', '/en/media', '/en/projects', '/en/settings',
  '/it/dashboard', '/it/clients', '/de/dashboard',
  '/studio', '/studio/structure',
]

/** Strings that must never appear in an anonymous response body. */
const NEVER_IN_BODY = [
  { label: 'a project UUID', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  { label: 'the string SUPABASE_SERVICE_ROLE', re: /SUPABASE_SERVICE_ROLE/ },
  { label: 'a sanity write token', re: /sk[A-Za-z0-9]{40,}/ },
]

let pass = 0, fail = 0
const failures = []

function ok(msg)   { pass++; console.log(`  ${C.g}✓${C.x} ${C.d}${msg}${C.x}`) }
function bad(msg, detail) {
  fail++; failures.push({ msg, detail })
  console.log(`  ${C.r}✗ ${msg}${C.x}`)
  if (detail) console.log(`      ${C.r}${detail}${C.x}`)
}

async function get(url, { redirect = 'manual' } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { redirect, signal: ctl.signal, headers: { 'user-agent': 'abluo-probe/1' } })
    const body = res.status === 200 ? await res.text() : ''
    return { status: res.status, location: res.headers.get('location'), body, headers: res.headers, finalUrl: res.url }
  } finally { clearTimeout(t) }
}

async function probeGated(host) {
  console.log(`\n${C.b}${host}${C.x} — gated surfaces must not serve`)
  for (const path of GATED) {
    const url = `https://${host}${path}`
    let r
    // FOLLOW redirects and judge the DESTINATION. An apex→www 301 is
    // canonicalisation, not an auth decision; judging the first hop reported
    // every customer domain as broken. What matters is where an anonymous
    // visitor ENDS UP, and whether anything was served on the way.
    try { r = await get(url, { redirect: 'follow' }) } catch (e) { bad(`${path} — request failed`, e.message); continue }

    const landed = r.finalUrl || url
    const atLogin = /\/login/.test(landed)
    const atUnauthorized = /\/unauthorized/.test(landed)

    if (r.status === 200 && (atLogin || atUnauthorized)) {
      ok(`${path} → ${atLogin ? 'login' : 'unauthorized'}`)
      continue
    }
    if (r.status === 200) {
      const leaks = NEVER_IN_BODY.filter((n) => n.re.test(r.body)).map((n) => n.label)
      bad(`${path} served 200 to an anonymous request`,
        leaks.length
          ? `BODY CONTAINS ${leaks.join(', ')} — LIVE DATA LEAK (landed on ${landed})`
          : `landed on ${landed}; no obvious leak in the body, but a gated path must not be 200`)
      continue
    }
    if (r.status === 404 || r.status === 401 || r.status === 403) { ok(`${path} → ${r.status}`); continue }
    bad(`${path} unexpected final status`, `got ${r.status} at ${landed}`)
  }
}

async function probeServes(host, { label = 'must serve' } = {}) {
  console.log(`\n${C.b}${host}${C.x} — ${label}`)
  try {
    const r = await get(`https://${host}/`, { redirect: 'follow' })
    if (r.status === 200) {
      if (r.body.length < 2000) bad(`/ returned 200 but the body is ${r.body.length} bytes — looks like an empty shell`)
      else ok(`/ → 200 (${Math.round(r.body.length / 1024)}KB)`)
    } else bad(`/ did not serve`, `got ${r.status}`)
  } catch (e) { bad(`/ request failed`, e.message) }
}

async function probeUnknownHostIsolation() {
  console.log(`\n${C.b}unknown-host isolation${C.x} — a stranger's Host header must not reach a project`)
  // Sent to a real deployment with a Host header the route table does not know.
  for (const seg of ['livener', 'studiomartegani', 'nologo']) {
    const url = `https://abluo.app/${seg}`
    try {
      const r = await get(url)
      // abluo.app resolves to the `abluo` project, so a project segment under it
      // must NOT serve another project's site.
      if (r.status === 200 && /livener|martegani/i.test(r.body) && seg !== 'abluo') {
        bad(`abluo.app/${seg} served another project's content`)
      } else ok(`abluo.app/${seg} → ${r.status}`)
    } catch (e) { bad(`abluo.app/${seg} failed`, e.message) }
  }
}

async function probeStagingNoindex() {
  console.log(`\n${C.b}staging noindex${C.x} — dev/preview must not be indexable, production must be`)
  for (const h of ['dev.abluo.app', 'preview.abluo.app']) {
    try {
      const r = await get(`https://${h}/`, { redirect: 'follow' })
      const xr = r.headers.get('x-robots-tag') || ''
      if (/noindex/i.test(xr)) ok(`${h} sends x-robots-tag: ${xr}`)
      else bad(`${h} is MISSING the noindex header`, `x-robots-tag: ${xr || '(absent)'} — a full copy of every client site is indexable`)
    } catch (e) { bad(`${h} failed`, e.message) }
  }
  for (const h of ['livener.net', 'www.studiomartegani.com']) {
    try {
      const r = await get(`https://${h}/`, { redirect: 'follow' })
      const xr = r.headers.get('x-robots-tag') || ''
      if (/noindex/i.test(xr)) bad(`${h} is sending NOINDEX`, `a live customer site would be deindexed: ${xr}`)
      else ok(`${h} is indexable`)
    } catch (e) { bad(`${h} failed`, e.message) }
  }
}

async function probeSanityWrite() {
  console.log(`\n${C.b}sanity${C.x} — anonymous writes must be refused`)
  const pid = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3'
  const ds = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
  try {
    const res = await fetch(`https://${pid}.api.sanity.io/v2024-01-01/data/mutate/${ds}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations: [{ create: { _type: 'page', title: 'probe-must-fail' } }] }),
    })
    const j = await res.json()
    if (res.ok && !j.error) bad('an ANONYMOUS WRITE TO SANITY SUCCEEDED', 'the dataset accepts unauthenticated mutations')
    else ok('anonymous write refused')
  } catch (e) { bad('sanity write probe failed', e.message) }
}

async function probeCommit(host, expected) {
  try {
    const r = await get(`https://${host}/api/version`, { redirect: 'follow' })
    const j = JSON.parse(r.body || '{}')
    if (!expected) { console.log(`  ${C.d}${host} is serving ${j.commit} (${j.branch})${C.x}`); return }
    if (j.commit === expected) ok(`${host} is serving ${expected}`)
    else bad(`${host} is serving ${j.commit}, not ${expected}`, 'the build is stale — every result below describes OLD code')
  } catch { bad(`${host} /api/version unreadable`) }
}

async function main() {
  const one = val('--host')
  const staging = has('--staging')
  const expectCommit = val('--expect-commit')

  const hosts = one ? [one] : [...CUSTOMER_HOSTS, ...(staging ? PLATFORM_HOSTS : ['preview.abluo.app'])]

  console.log(`${C.b}Abluo live probe${C.x} — ${new Date().toISOString()}`)
  console.log(`${C.d}anonymous, read-only, ${hosts.length} host(s)${C.x}`)

  console.log(`\n${C.b}deployed build${C.x}`)
  for (const h of ['abluo.app', 'preview.abluo.app', 'dev.abluo.app']) await probeCommit(h, expectCommit)

  for (const h of hosts) await probeGated(h)
  for (const h of (one ? [one] : CUSTOMER_HOSTS)) await probeServes(h)
  await probeUnknownHostIsolation()
  await probeStagingNoindex()
  await probeSanityWrite()

  console.log(`\n${'─'.repeat(60)}`)
  if (fail === 0) {
    console.log(`${C.g}${C.b}PASS${C.x} — ${pass} checks, no invariant broken.`)
    process.exit(0)
  }
  console.log(`${C.r}${C.b}FAIL${C.x} — ${fail} of ${pass + fail} checks failed:\n`)
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.msg}${f.detail ? `\n     ${f.detail}` : ''}`))
  process.exit(1)
}

main().catch((e) => { console.error(`${C.r}probe could not run:${C.x} ${e.message}`); process.exit(2) })

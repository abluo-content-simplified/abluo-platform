#!/usr/bin/env node
/**
 * Generate `src/lib/tenancy/generated/route-config.ts` from Supabase.
 *
 * ── Why this script exists ───────────────────────────────────────────────────
 * Edge middleware cannot query Supabase per request. Something host-shaped has
 * to be resident in the edge bundle, so a COPY of the routing data near the
 * edge is unavoidable. That is not the defect. The defect is that today there
 * are THREE such copies and every one of them is typed by a human:
 *
 *   - `domainMap`               (src/proxy.ts ~:32)  host → URL slug
 *   - `resolveSanityProjectSlug`(src/proxy.ts ~:56)  an incomplete second copy
 *                                                    of TENANT_TO_PROJECT
 *   - `resolveDefaultLocale`    (src/proxy.ts ~:73)  slug → locale, whose own
 *                                                    comment says "Keep in sync
 *                                                    with the projects table in
 *                                                    Supabase"
 *
 * They are already out of sync with each other and with Supabase. Concrete,
 * verified as of 2026-08-31: `ch-psicoterapeuta.com` is a live `custom_domain`
 * on project `hoffmann` and appears in NONE of the three maps; project `amelie`
 * exists and appears in none of them; `resolveSanityProjectSlug` knows two of
 * the five entries `TENANT_TO_PROJECT` knows.
 *
 * The rule this script establishes: ONE source of truth (the Supabase
 * `projects`/`tenants` tables); every other copy is GENERATED at build time and
 * checked in, never typed by a human. A human editing the generated file is the
 * failure this whole exercise removes, which is why the file carries a
 * DO-NOT-EDIT header and why `--check` exists.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   node scripts/generate-route-config.mjs            # write the file
 *   node scripts/generate-route-config.mjs --check    # exit 1 if it has drifted
 *   node scripts/generate-route-config.mjs --stdout   # print, write nothing
 *
 * ── Credentials ──────────────────────────────────────────────────────────────
 * Read directly out of `.env.local` (NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY), the same way the repo's other one-off Supabase
 * scripts do. The service-role key is needed because RLS on `projects` is
 * member-scoped and a build machine is not a member of any tenant. NOTHING here
 * ever prints a secret: the only values that reach stdout are slugs, hosts,
 * locales and project UUIDs, all of which are already public routing facts.
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 * The output is a pure function of the database rows. Everything is sorted by a
 * stable key before emission and there is deliberately NO generation timestamp
 * — a timestamp would make every regeneration a diff and would make `--check`
 * useless as a drift guard. `release.json` can afford a `releasedAt`; a file
 * that exists to be diffed against the database cannot.
 *
 * ── Host shapes ──────────────────────────────────────────────────────────────
 * Derived from what `src/proxy.ts` actually serves TODAY, not from what a host
 * model says it ought to serve. See HOST_SHAPES below for the derivation of
 * each one and the proxy.ts line it came from.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_PATH = path.join(REPO_ROOT, 'src/lib/tenancy/generated/route-config.ts')
const OUT_REL = 'src/lib/tenancy/generated/route-config.ts'

// ─── Structural platform hosts ───────────────────────────────────────────────
/**
 * Hosts `src/proxy.ts` serves that resolve to NO project, ever.
 *
 * This list is hand-written and that is correct: these are properties of the
 * PLATFORM, not of any customer. They cannot drift when a customer is
 * onboarded, which is the only drift this script exists to prevent. They are
 * emitted so that a caller can tell "known platform host" apart from "host I
 * have never heard of" — both resolve to null, but only one of them is a bug.
 *
 *   - `admin.abluo.app`   — proxy.ts:221, admin-only surface, gated before
 *                           resolveTenant() is ever consulted.
 *   - `preview.abluo.app` — proxy.ts:271, PATH-based project routing
 *                           (preview.abluo.app/<slug>), not host-based. A bare
 *                           preview host carries no project identity.
 *   - `localhost`         — bare localhost is the platform dev host;
 *                           `<slug>.localhost` is the per-project dev host.
 */
const PLATFORM_HOSTS = ['admin.abluo.app', 'localhost', 'preview.abluo.app']

/**
 * The apex domain of the platform's own website. `proxy.ts`'s `domainMap`
 * contains BOTH `abluo.app` and `dev.abluo.app` pointing at the same project;
 * `dev.abluo.app` is the staging alias of whichever project owns the platform
 * apex. Encoding it as "the dev alias of the project whose custom_domain is
 * PLATFORM_APEX" keeps it derived from the database rather than typed twice.
 */
const PLATFORM_APEX = 'abluo.app'
const PLATFORM_DEV_ALIAS = 'dev.abluo.app'

/** Suffix for Abluo-managed per-project preview hosts (proxy.ts:26). */
const PREVIEW_SUFFIX = '.preview.abluo.app'
/** Suffix for the per-project dev convention (proxy.ts:43). */
const LOCALHOST_SUFFIX = '.localhost'

// ─── Env ─────────────────────────────────────────────────────────────────────

/**
 * Parse `.env.local` by hand rather than pulling in dotenv. Values may be
 * quoted; `#` comment lines and blank lines are skipped. Returns a plain
 * object. The caller must never log it.
 */
function readEnvLocal() {
  const file = path.join(REPO_ROOT, '.env.local')
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
}

/**
 * Fetch every row of a PostgREST table. Throws with the response BODY on a
 * non-2xx — PostgREST error bodies contain column names and hints, never the
 * key, so this is safe to surface.
 */
async function fetchTable(baseUrl, key, query) {
  const res = await fetch(`${baseUrl}/rest/v1/${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${query}: ${text}`)
  return JSON.parse(text)
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * Normalise a host the same way the runtime resolver does, so that a value
 * stored badly in `custom_domain` (mixed case, a stray `www.`, a trailing dot,
 * a scheme someone pasted in) cannot produce a table key the resolver can never
 * look up. This MUST stay behaviourally identical to `normalizeHost()` in
 * `src/lib/tenancy/host-scope.ts`; the drift test asserts they agree.
 */
function normalizeHost(raw) {
  let h = String(raw).trim().toLowerCase()
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme, if a URL was stored
  h = h.split('/')[0]
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close !== -1) h = h.slice(0, close + 1)
  } else {
    h = h.split(':')[0]
  }
  h = h.replace(/\.$/, '')
  h = h.replace(/^www\./, '')
  return h
}

/**
 * Build the host → scope rows for one project.
 *
 * `hostKind` is carried through so a reader of the generated file can see WHY a
 * host is in the table without re-deriving it from proxy.ts, and so a future
 * consumer can treat (say) preview hosts differently from paying custom domains
 * without re-parsing the string.
 */
function hostsForProject(project, tenant) {
  const rows = []
  const add = (host, hostKind) =>
    rows.push({
      host: normalizeHost(host),
      hostKind,
      tenantSlug: tenant.slug,
      projectSlug: project.slug,
      projectId: project.id,
      defaultLocale: project.default_locale,
      status: project.status,
    })

  // 1. The paying custom domain (proxy.ts `domainMap` keys). `www.` is NOT
  //    emitted as a second row: proxy.ts strips it before lookup (proxy.ts:22)
  //    and so does the runtime resolver, so a second row would be dead weight
  //    and a second thing to keep consistent.
  if (project.custom_domain) {
    add(project.custom_domain, 'custom-domain')

    // 2. The platform's own dev alias. Derived, not typed: proxy.ts's domainMap
    //    maps dev.abluo.app to the same project as abluo.app.
    if (normalizeHost(project.custom_domain) === PLATFORM_APEX) {
      add(PLATFORM_DEV_ALIAS, 'platform-alias')
    }
  }

  // 3. Abluo-managed preview host (proxy.ts:26).
  add(`${project.slug}${PREVIEW_SUFFIX}`, 'preview-subdomain')

  // 4. Dev convention (proxy.ts:43).
  add(`${project.slug}${LOCALHOST_SUFFIX}`, 'localhost-subdomain')

  return rows
}

/**
 * Turn the two tables into the sorted, collision-checked host table.
 *
 * A host collision is thrown, never resolved by precedence. Decision D-2 is
 * ONE PROJECT = ONE HOST; two projects claiming one host means the database is
 * in a state the routing model cannot express, and silently picking a winner
 * would serve one customer's site on another customer's domain. Failing the
 * build is the correct outcome.
 */
function buildRows(projects, tenants) {
  const tenantById = new Map(tenants.map((t) => [t.id, t]))
  const rows = []
  const orphans = []

  for (const project of projects) {
    const tenant = tenantById.get(project.tenant_id)
    if (!tenant) {
      // A project with no tenant has no resolvable ownership. It is skipped
      // rather than guessed — the same "null means select nothing" rule
      // project-scope.ts enforces.
      orphans.push(project.slug)
      continue
    }
    rows.push(...hostsForProject(project, tenant))
  }

  const seen = new Map()
  for (const row of rows) {
    const prev = seen.get(row.host)
    if (prev && prev.projectId !== row.projectId) {
      throw new Error(
        `Host collision: "${row.host}" is claimed by both project "${prev.projectSlug}" ` +
          `and project "${row.projectSlug}". Decision D-2 is one project = one host. ` +
          `Fix the projects table (custom_domain or slug) before regenerating.`
      )
    }
    seen.set(row.host, row)
  }

  // Stable sort: host is unique, so this is a total order and regeneration can
  // never produce a spurious diff.
  rows.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
  return { rows, orphans }
}

// ─── Emission ────────────────────────────────────────────────────────────────

const q = (s) => JSON.stringify(String(s))

function renderModule(rows) {
  const entries = rows
    .map(
      (r) =>
        `  {\n` +
        `    host: ${q(r.host)},\n` +
        `    hostKind: ${q(r.hostKind)},\n` +
        `    tenantSlug: ${q(r.tenantSlug)},\n` +
        `    projectSlug: ${q(r.projectSlug)},\n` +
        `    projectId: ${q(r.projectId)},\n` +
        `    defaultLocale: ${q(r.defaultLocale)},\n` +
        `    status: ${q(r.status)},\n` +
        `  },`
    )
    .join('\n')

  const platform = PLATFORM_HOSTS.slice().sort().map((h) => `  ${q(h)},`).join('\n')

  return `/**
 * GENERATED — DO NOT EDIT BY HAND, run scripts/generate-route-config.mjs
 *
 * Source of truth: the \`projects\` and \`tenants\` tables in Supabase.
 * This file is the build-time COPY of that data that the edge can read
 * synchronously. It is checked in so the edge bundle needs no network, and it
 * is regenerated — never edited — so it cannot drift from the database.
 *
 * If you are here because a host is missing or wrong: fix the row in Supabase,
 * then run \`node scripts/generate-route-config.mjs\`. Editing this file makes
 * the database and the edge disagree, which is the exact failure the three
 * hand-maintained maps in \`src/proxy.ts\` are being retired for.
 *
 * There is deliberately no generation timestamp: this file must be diffable
 * against a fresh generation (\`--check\`) as a drift guard, and a timestamp
 * would make every regeneration a diff.
 *
 * NOTHING IMPORTS THIS YET. See \`src/lib/tenancy/host-scope.ts\` for why
 * (expand phase — built, callable, uncalled).
 */

/** How a host came to be in this table. See scripts/generate-route-config.mjs. */
export type GeneratedHostKind =
  | 'custom-domain'
  | 'platform-alias'
  | 'preview-subdomain'
  | 'localhost-subdomain'

/** One normalised host and the project scope it serves. */
export interface GeneratedHostRoute {
  /** Normalised: lowercase, no port, no trailing dot, no leading \`www.\`. */
  host: string
  hostKind: GeneratedHostKind
  /** \`tenants.slug\` — the CUSTOMER. */
  tenantSlug: string
  /** \`projects.slug\` — the WEBSITE. */
  projectSlug: string
  /** \`projects.id\` — the stable UUID; slugs are renameable, this is not. */
  projectId: string
  /** \`projects.default_locale\`. */
  defaultLocale: string
  /** \`projects.status\`. Only 'active' is served; see host-scope.ts. */
  status: string
}

/** Sorted by host. Host is unique across the table — collisions throw at generation. */
export const GENERATED_HOST_ROUTES: readonly GeneratedHostRoute[] = [
${entries}
] as const

/**
 * Hosts the platform serves that resolve to NO project, ever. Present so a
 * caller can distinguish "known platform host" from "host I have never heard
 * of" — both resolve to null, but only the second one is a bug.
 */
export const GENERATED_PLATFORM_HOSTS: readonly string[] = [
${platform}
] as const
`
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Exported so the drift test can regenerate in-process without shelling out
 * and without duplicating any of the derivation above.
 */
export async function generateRouteConfigSource() {
  const env = readEnvLocal()
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    // Deliberately names the VARIABLES, never their values.
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY ' +
        '(looked in .env.local and process.env).'
    )
  }

  const [projects, tenants] = await Promise.all([
    fetchTable(url, key, 'projects?select=id,slug,tenant_id,custom_domain,default_locale,status&order=slug'),
    fetchTable(url, key, 'tenants?select=id,slug,domain&order=slug'),
  ])

  const { rows, orphans } = buildRows(projects, tenants)
  return { source: renderModule(rows), rows, orphans, projectCount: projects.length }
}

export { normalizeHost, PLATFORM_HOSTS, OUT_REL }

async function main() {
  const args = new Set(process.argv.slice(2))
  const { source, rows, orphans, projectCount } = await generateRouteConfigSource()

  if (args.has('--stdout')) {
    process.stdout.write(source)
    return
  }

  if (args.has('--check')) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : ''
    if (current !== source) {
      console.error(
        `DRIFT: ${OUT_REL} does not match what Supabase would produce.\n` +
          `Run: node scripts/generate-route-config.mjs`
      )
      process.exitCode = 1
      return
    }
    console.log(`OK: ${OUT_REL} matches Supabase (${rows.length} hosts, ${projectCount} projects).`)
    return
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, source)
  console.log(`Wrote ${OUT_REL}: ${rows.length} hosts from ${projectCount} projects.`)
  for (const slug of orphans) {
    console.warn(`  skipped project "${slug}": no matching tenants row (tenant_id has no owner).`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}

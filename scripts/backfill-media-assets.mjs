#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — backfill-media-assets.mjs
//
// Files every image that content uses DIRECTLY (an image field pointing at a
// Sanity `image-…` asset) into the project's Media Library, by creating the
// missing `mediaAsset` documents.
//
// WHY THIS EXISTS
//   Standing rule: every image exists as a Media Library asset (`mediaAsset`,
//   scoped by `projectSlug`) before it is used. Images placed before that rule
//   have no `mediaAsset`, so the client dashboard's Media screen does not show
//   them and "Used in" cannot find them.
//
// WHAT IT DOES
//   For each project: reads every tenant document of that projectSlug
//   (published + drafts; pages, homePage, posts, events, siteConfig, galleries,
//   designSystem, … — every type), walks each document in JS (GROQ cannot
//   deep-search), collects every referenced image asset, and plans a
//   `mediaAsset` for each one the project's Media Library does not file yet —
//   same field set as the app's upload (src/lib/media/create-media-asset.ts),
//   with the hotspot and alt text taken from the content when present.
//   The pure planner is scripts/lib/media-backfill.mjs (unit-tested).
//
// USAGE
//   node scripts/backfill-media-assets.mjs --project livener   # dry run, one project
//   node scripts/backfill-media-assets.mjs --all               # dry run, every project
//   node scripts/backfill-media-assets.mjs --all --json        # plan as JSON on stdout
//   node scripts/backfill-media-assets.mjs --all --public      # dry run with NO token
//   node scripts/backfill-media-assets.mjs --project livener --apply
//   node scripts/backfill-media-assets.mjs --all --exclude-type siteConfig,designSystem
//
// --exclude-type leaves out images found ONLY in those document types — e.g.
// logos, favicons and Open Graph images in siteConfig and design-system
// artwork, which Abluo manages and a client never edits. (An image also used
// in a page or post is still filed; its usage list then omits those types.)
//
// DRY RUN (default) is read-only. It uses SANITY_API_READ_TOKEN, else the write
// token for reading, else no token (`--public` forces no token). Without a
// token only PUBLISHED documents are visible (public dataset), so images used
// only in drafts are not listed — the report says so.
//
// --apply writes ONLY `createIfNotExists` mutations of new `mediaAsset`
// documents with a deterministic id (`mediaAsset-backfill-<projectSlug>-<assetId>`),
// in one transaction per project. Idempotent: a re-run creates nothing new.
// Content documents are never modified. Needs SANITY_API_WRITE_TOKEN (or
// SANITY_AUTH_TOKEN).
//
// EXIT CODES
//   0  nothing to create, or --apply succeeded
//   1  dry run found mediaAssets to create (or a project is blocked)
//   2  could not run (bad arguments, no credentials for --apply, network)
//
// Env is read from .env.local / .env in the repo root (never copied, token
// values never printed).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planMediaBackfill, backfillMutations } from './lib/media-backfill.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '..')

// ─── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
if (has('--help') || has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
    .filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  process.exit(0)
}
const APPLY = has('--apply')
const JSON_OUT = has('--json')
const PUBLIC = has('--public')
const ALL = has('--all')
const ONE = val('--project')
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const EXCLUDE_TYPES = (val('--exclude-type') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

const tty = process.stderr.isTTY && !process.env.NO_COLOR
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s))
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36)
const say = (...a) => console.error(...a)

if ((!ALL && !ONE) || (ALL && ONE) || (ONE && !SLUG.test(ONE))) {
  say('Usage: node scripts/backfill-media-assets.mjs (--project <projectSlug> | --all) [--exclude-type a,b] [--apply] [--json] [--public]')
  process.exit(2)
}
if (APPLY && PUBLIC) {
  say(red('--apply and --public cannot be combined.'))
  process.exit(2)
}

// ─── .env.local (never printed) ──────────────────────────────────────────────
function loadEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, eq).trim()] = v
  }
  return out
}
const fileEnv = { ...loadEnvFile(join(REPO_ROOT, '.env')), ...loadEnvFile(join(REPO_ROOT, '.env.local')) }
const env = (k) => process.env[k] || fileEnv[k] || ''

const PROJECT_ID = env('NEXT_PUBLIC_SANITY_PROJECT_ID') || '3n7t84j3'
const DATASET = env('NEXT_PUBLIC_SANITY_DATASET') || 'production'
const API_VERSION = '2026-05-21' // = SANITY_API_VERSION in src/lib/sanity/config.ts
const WRITE_TOKEN = env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
const READ_TOKEN = PUBLIC ? '' : env('SANITY_API_READ_TOKEN') || WRITE_TOKEN

if (APPLY && !WRITE_TOKEN) {
  say(red('--apply needs SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN) in .env.local.'))
  process.exit(2)
}

// ─── Sanity HTTP (no SDK, like check-content-shape.mjs) ─────────────────────
const API_BASE = `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}`

async function sanity(path, body, token) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Sanity API ${res.status} on ${path.split('?')[0]}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

// `raw`: published documents AND drafts (drafts need a token to be visible).
const query = (q, params = {}) =>
  sanity(`/data/query/${DATASET}?perspective=raw`, { query: q, params }, READ_TOKEN).then((r) => r.result)

async function readProject(projectSlug) {
  const r = await query(
    `{
      "documents": *[projectSlug == $slug && _type != "mediaAsset" && !(_id in path("versions.**"))],
      "mediaAssets": *[_type == "mediaAsset" && projectSlug == $slug]{ _id, projectSlug, "ref": image.asset._ref },
      "projects": *[_type == "project" && projectSlug == $slug && !(_id in path("drafts.**"))]{ _id, "clientId": clientRef._ref },
      "defaultLocale": coalesce(
        *[_type == "siteConfig" && projectSlug == $slug && !(_id in path("drafts.**"))][0].defaultLocale,
        *[_type == "project" && projectSlug == $slug && !(_id in path("drafts.**"))][0].defaultLocale
      )
    }`,
    { slug: projectSlug }
  )
  return r ?? {}
}

async function readImageAssets(ids) {
  if (!ids.length) return {}
  const rows = await query(`*[_type == "sanity.imageAsset" && _id in $ids]{ _id, originalFilename, url }`, { ids })
  return Object.fromEntries((rows ?? []).map((r) => [r._id, r]))
}

// ─── report ──────────────────────────────────────────────────────────────────
function printPlan(plan) {
  const counts = { create: 0, exists: 0, blocked: 0 }
  for (const i of plan.items) counts[i.status]++
  say('')
  say(bold(cyan(`Project ${plan.projectSlug}`)) + dim(`  — ${plan.items.length} image asset(s) used in content`))
  if (plan.blocked) say(red(`  BLOCKED: ${plan.blocked}`))
  if (!plan.items.length) {
    say(dim('  (no image fields reference an image asset directly)'))
    return counts
  }
  for (const item of plan.items) {
    const tag =
      item.status === 'create' ? yellow('CREATE ') : item.status === 'exists' ? green('exists ') : red('blocked')
    say(`  ${tag} ${item.assetId}  ${dim(item.filename ?? '(no original filename)')}`)
    for (const u of item.usages) {
      say(dim(`           used in ${u.type} ${u.docId}${u.draft ? ' [draft]' : ''}${u.title ? ` "${u.title}"` : ''} → ${u.path}`))
    }
    if (item.status === 'exists') say(dim(`           mediaAsset: ${item.existingMediaAssetIds.join(', ')}`))
    if (item.status === 'create') {
      const d = item.doc
      const alt = d.altText ? Object.entries(d.altText).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `${k}: ${v}`).join(' | ') : '—'
      say(dim(`           plan: _id ${d._id}`))
      say(dim(`                 name "${d.name ?? ''}"  alt ${alt}  hotspot ${d.image.hotspot ? 'yes' : 'no'}  tenant ${d.tenant._ref}  project ${d.project._ref}`))
    }
  }
  say(`  ${yellow(counts.create)} to create · ${green(counts.exists)} already in the Media Library${counts.blocked ? ` · ${red(counts.blocked)} blocked` : ''}`)
  return counts
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  say(bold('Abluo — Media Library backfill') + dim(`  ${PROJECT_ID}/${DATASET}  ${APPLY ? 'APPLY' : 'dry run'}`))
  if (EXCLUDE_TYPES.length) say(dim(`Leaving out images used only in: ${EXCLUDE_TYPES.join(', ')}`))
  if (!READ_TOKEN) say(yellow('⚠ No token: published documents only — images used only in drafts are not listed.'))

  let slugs
  if (ALL) {
    const rows = await query(`array::unique(*[_type == "project" && defined(projectSlug) && !(_id in path("drafts.**"))].projectSlug)`)
    slugs = (rows ?? []).filter((s) => typeof s === 'string' && SLUG.test(s)).sort()
  } else {
    slugs = [ONE]
  }

  const plans = []
  for (const projectSlug of slugs) {
    const data = await readProject(projectSlug)
    const input = { projectSlug, ...data, defaultLocale: data.defaultLocale || 'en', excludeTypes: EXCLUDE_TYPES }
    // First pass only to learn which assets are used; the second adds their file names.
    const assetIds = planMediaBackfill(input).items.map((i) => i.assetId)
    plans.push(planMediaBackfill({ ...input, imageAssets: await readImageAssets(assetIds) }))
  }

  if (JSON_OUT) console.log(JSON.stringify(plans, null, 2))

  let toCreate = 0
  let blocked = 0
  for (const plan of plans) {
    const counts = printPlan(plan)
    toCreate += counts.create
    blocked += counts.blocked
  }
  say('')
  say(bold(`Total: ${toCreate} mediaAsset(s) to create across ${plans.length} project(s)${blocked ? `, ${blocked} blocked` : ''}.`))

  if (!APPLY) {
    if (toCreate) say(dim('Dry run — nothing written. Re-run with --apply to create them.'))
    return toCreate || blocked ? 1 : 0
  }

  for (const plan of plans) {
    const mutations = backfillMutations(plan)
    if (!mutations.length) continue
    const res = await sanity(`/data/mutate/${DATASET}?returnIds=true&visibility=sync`, { mutations }, WRITE_TOKEN)
    const created = (res.results ?? []).filter((r) => r.operation === 'create').length
    say(green(`✓ ${plan.projectSlug}: ${created} created, ${mutations.length - created} already existed (transaction ${res.transactionId ?? '?'})`))
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    say(red(`✗ ${error?.message ?? error}`))
    process.exit(2)
  }
)

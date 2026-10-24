#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — backfill-internal-tag-lists.mjs
//
// Puts every tag that photos (`mediaAsset`) and galleries (`gallery`) carry
// today on the project's `internalTagList` for that scope, so a tag stays in
// Categories & Tags even after its last photo or gallery drops it.
//
// WHY: from 2026-10-24 the app adds every tag it writes to the list
// (src/lib/tags/list-sync.ts). Tags written before that live only on the
// items; until this runs, the manager still shows them (it unions item tags
// with the list), but one that loses its last item would vanish.
//
// USAGE
//   node scripts/backfill-internal-tag-lists.mjs --project amelie        # dry run, one project
//   node scripts/backfill-internal-tag-lists.mjs --all                   # dry run, every project
//   node scripts/backfill-internal-tag-lists.mjs --all --json            # plan as JSON on stdout
//   node scripts/backfill-internal-tag-lists.mjs --project amelie --apply
//
// DRY RUN (default) is read-only. --apply writes ONLY `internalTagList`
// documents (create, or a revision-guarded patch that appends names), one
// transaction per project; photos and galleries are never modified.
// Idempotent: a re-run appends nothing new. At most 500 names per list (the
// app's cap); the most used tags go first. Pure planner:
// scripts/lib/internal-tag-lists-backfill.mjs (unit-tested).
//
// Reads with SANITY_API_READ_TOKEN, else the write token; --apply needs
// SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN). Env from .env.local / .env
// (token values never printed).
//
// EXIT CODES  0 nothing to add / applied · 1 dry run found names to add · 2 could not run
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planTagListBackfill, backfillMutations, INTERNAL_TAG_LIST_TYPE } from './lib/internal-tag-lists-backfill.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '..')

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
const ALL = has('--all')
const ONE = val('--project')
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const say = (...a) => console.error(...a)

if ((!ALL && !ONE) || (ALL && ONE) || (ONE && !SLUG.test(ONE))) {
  say('Usage: node scripts/backfill-internal-tag-lists.mjs (--project <projectSlug> | --all) [--apply] [--json]')
  process.exit(2)
}

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
const API_VERSION = '2026-05-21'
const WRITE_TOKEN = env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
const READ_TOKEN = env('SANITY_API_READ_TOKEN') || WRITE_TOKEN

if (APPLY && !WRITE_TOKEN) {
  say('--apply needs SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN) in .env.local.')
  process.exit(2)
}
if (!READ_TOKEN) say('⚠ No token: only published galleries are visible (gallery drafts are not read).')

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
const query = (q, params = {}) => sanity(`/data/query/${DATASET}?perspective=raw`, { query: q, params }, READ_TOKEN).then((r) => r.result)

async function readProject(projectSlug) {
  const r = await query(
    `{
      "items": *[_type in ["mediaAsset", "gallery"] && projectSlug == $slug && count(tags) > 0 && !(_id in path("versions.**"))]{ _id, _type, tags },
      "lists": *[_type == "${INTERNAL_TAG_LIST_TYPE}" && projectSlug == $slug]{ _id, _rev, projectSlug, tags }
    }`,
    { slug: projectSlug }
  )
  return r ?? { items: [], lists: [] }
}

async function main() {
  say(`Abluo — internal tag lists backfill  ${PROJECT_ID}/${DATASET}  ${APPLY ? 'APPLY' : 'dry run'}`)
  let slugs
  if (ALL) {
    const rows = await query(`array::unique(*[_type == "project" && defined(projectSlug) && !(_id in path("drafts.**"))].projectSlug)`)
    slugs = (rows ?? []).filter((s) => typeof s === 'string').sort()
  } else slugs = [ONE]

  const plans = []
  for (const projectSlug of slugs) plans.push(planTagListBackfill({ projectSlug, ...(await readProject(projectSlug)) }))
  if (JSON_OUT) console.log(JSON.stringify(plans, null, 2))

  let toAdd = 0
  for (const plan of plans) {
    for (const s of plan.scopes) {
      if (s.blocked) {
        say(`  ${plan.projectSlug} · ${s.scope}: BLOCKED — ${s.blocked}`)
        continue
      }
      toAdd += s.add.length
      if (s.add.length || s.capped) {
        say(`  ${plan.projectSlug} · ${s.scope}: ${s.add.length} to add${s.create ? ' (new list)' : ''} — ${s.add.join(', ')}${s.capped ? '  [list full: the rest is left out]' : ''}`)
      }
    }
  }
  say(`Total: ${toAdd} tag name(s) to add across ${plans.length} project(s).`)
  if (!APPLY) {
    if (toAdd) say('Dry run — nothing written. Re-run with --apply to write them.')
    return toAdd ? 1 : 0
  }
  for (const plan of plans) {
    const mutations = backfillMutations(plan)
    if (!mutations.length) continue
    const res = await sanity(`/data/mutate/${DATASET}?returnIds=true&visibility=sync`, { mutations }, WRITE_TOKEN)
    say(`✓ ${plan.projectSlug}: ${mutations.length} list(s) written (transaction ${res.transactionId ?? '?'})`)
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    say(`✗ ${error?.message ?? error}`)
    process.exit(2)
  }
)

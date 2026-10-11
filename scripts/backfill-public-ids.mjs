#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — backfill-public-ids.mjs   (ADR-031 D3)
//
// Gives every existing shareable document a `publicId`: an opaque UUID that
// connected apps see instead of the Sanity `_id` (which, for script-imported
// content, embeds tenant and content names, e.g. `cyce-event-pranayama`).
// New documents get one automatically (field initialValue + Studio template +
// the client dashboard's createEvent); this covers what existed before.
//
// RULES
//   - Additive only: `setIfMissing({ publicId })`. An existing publicId is never
//     changed — it is permanent by definition.
//   - A published document and its draft (`drafts.<id>`) get the SAME id.
//   - Run it AFTER the code that declares the field is deployed (2026-08-14
//     rule: never migrate data ahead of the code that reads it). Nothing reads
//     publicId on the website, so order is safe either way — the rule is kept.
//
// USAGE
//   node scripts/backfill-public-ids.mjs                     # dry run, all types
//   node scripts/backfill-public-ids.mjs --type event        # dry run, one type
//   node scripts/backfill-public-ids.mjs --apply             # write
//   node scripts/backfill-public-ids.mjs --dataset staging   # another dataset
//
// Types covered by default: event, eventVenue. Add more with --type a,b as
// they become shareable (Menu module: menu, menuSection, menuItem).
//
// EXIT CODES  0 nothing to do / applied · 1 dry run found work · 2 could not run
// Env from .env.local / .env (token values never printed).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(HERE, '..')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const APPLY = has('--apply')
const TYPES = (val('--type') ?? 'event,eventVenue').split(',').map((t) => t.trim()).filter(Boolean)
if (TYPES.some((t) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(t))) {
  console.error('Bad --type value.')
  process.exit(2)
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}
const fileEnv = { ...loadEnvFile(join(REPO_ROOT, '.env')), ...loadEnvFile(join(REPO_ROOT, '.env.local')) }
const env = (k) => process.env[k] || fileEnv[k] || ''

const PROJECT_ID = env('NEXT_PUBLIC_SANITY_PROJECT_ID') || '3n7t84j3'
const DATASET = val('--dataset') || env('NEXT_PUBLIC_SANITY_DATASET') || 'production'
const WRITE_TOKEN = env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
const READ_TOKEN = env('SANITY_API_READ_TOKEN') || WRITE_TOKEN
if (!READ_TOKEN) {
  console.error('No Sanity token in .env.local (datasets are private since 2026-10-11).')
  process.exit(2)
}
if (APPLY && !WRITE_TOKEN) {
  console.error('--apply needs SANITY_API_WRITE_TOKEN (or SANITY_AUTH_TOKEN) in .env.local.')
  process.exit(2)
}

const API = `https://${PROJECT_ID}.api.sanity.io/v2026-05-21`

async function query(groq, params) {
  const url = new URL(`${API}/data/query/${DATASET}`)
  url.searchParams.set('query', groq)
  url.searchParams.set('perspective', 'raw') // drafts too
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`$${k}`, JSON.stringify(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${READ_TOKEN}` } })
  if (!res.ok) throw new Error(`query failed: HTTP ${res.status}`)
  return (await res.json()).result
}

async function mutate(mutations) {
  const res = await fetch(`${API}/data/mutate/${DATASET}?returnIds=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WRITE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutations }),
  })
  if (!res.ok) throw new Error(`mutate failed: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

const baseId = (id) => id.replace(/^drafts\./, '')

try {
  const docs = await query(
    `*[_type in $types && defined(projectSlug)]{ _id, _type, projectSlug, publicId }`,
    { types: TYPES },
  )

  // Group published + draft by base id; reuse an id either half already has.
  const groups = new Map()
  for (const d of docs) {
    const k = baseId(d._id)
    const g = groups.get(k) ?? { type: d._type, project: d.projectSlug, ids: [], existing: null }
    g.ids.push(d._id)
    if (d.publicId && !g.existing) g.existing = d.publicId
    if (d.publicId && g.existing && d.publicId !== g.existing) g.conflict = true
    groups.set(k, g)
  }

  const plan = []
  for (const [k, g] of groups) {
    const missing = docs.filter((d) => baseId(d._id) === k && !d.publicId).map((d) => d._id)
    if (missing.length === 0) continue
    plan.push({ base: k, type: g.type, project: g.project, publicId: g.existing ?? randomUUID(), docs: missing })
  }
  const conflicts = [...groups.entries()].filter(([, g]) => g.conflict).map(([k]) => k)

  console.log(`Dataset ${DATASET} · types ${TYPES.join(', ')} · ${groups.size} documents (published+draft pairs)`)
  for (const p of plan) console.log(`  ${p.project.padEnd(18)} ${p.type.padEnd(12)} ${p.base} → ${p.publicId}${p.docs.length > 1 ? ' (published + draft)' : ''}`)
  if (conflicts.length) console.log(`⚠ draft and published disagree on publicId (left alone): ${conflicts.join(', ')}`)
  console.log(plan.length === 0 ? 'Nothing to do.' : `${plan.length} to set.`)

  if (!APPLY) process.exit(plan.length === 0 ? 0 : 1)
  if (plan.length === 0) process.exit(0)

  const mutations = plan.flatMap((p) => p.docs.map((id) => ({ patch: { id, setIfMissing: { publicId: p.publicId } } })))
  for (let i = 0; i < mutations.length; i += 100) await mutate(mutations.slice(i, i + 100))
  console.log(`Applied ${mutations.length} patches.`)
  process.exit(0)
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(2)
}

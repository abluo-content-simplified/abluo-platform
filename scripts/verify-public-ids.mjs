#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — verify-public-ids.mjs   (ADR-038 D2) — READ-ONLY
//
// Before `publicId` becomes the link between a Sanity event and its Supabase
// schedule, it must identify exactly one document. This lists, for every
// document type that carries a publicId:
//   - DUPLICATES: one publicId on two different documents (a draft and its
//     published version are the same document and are NOT a duplicate);
//   - MISMATCH: a draft and its published version with different publicIds;
//   - MISSING:  a shareable document (event, eventVenue) without a publicId.
// It never writes. Fix duplicates by hand (new UUID on the copy) before any
// scheduling migration.
//
// USAGE   node scripts/verify-public-ids.mjs [--dataset staging]
// EXIT    0 clean · 1 problems found · 2 could not run
// Env from .env.local / .env (token values never printed).
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null }

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
const TOKEN = env('SANITY_API_READ_TOKEN') || env('SANITY_API_WRITE_TOKEN') || env('SANITY_AUTH_TOKEN')
if (!TOKEN) { console.error('No Sanity token in .env.local (datasets are private).'); process.exit(2) }

// Same rule as baseDocumentId() in src/lib/sanity/fields/public-id.ts (tested there).
const baseId = (id) => {
  if (id.startsWith('drafts.')) return id.slice(7)
  if (id.startsWith('versions.')) { const r = id.slice(9); const d = r.indexOf('.'); return d === -1 ? r : r.slice(d + 1) }
  return id
}

async function query(groq) {
  const url = new URL(`https://${PROJECT_ID}.api.sanity.io/v2026-05-21/data/query/${DATASET}`)
  url.searchParams.set('query', groq)
  url.searchParams.set('perspective', 'raw')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
  if (!res.ok) throw new Error(`query failed: HTTP ${res.status}`)
  return (await res.json()).result
}

try {
  const rows = await query(`*[defined(publicId) || _type in ["event", "eventVenue"]]{ _id, _type, projectSlug, publicId }`)
  const byPublicId = new Map()
  const byDoc = new Map()
  const missing = []
  for (const r of rows) {
    if (!r.publicId) { missing.push(r); continue }
    const owners = byPublicId.get(r.publicId) ?? new Set()
    owners.add(baseId(r._id)); byPublicId.set(r.publicId, owners)
    const ids = byDoc.get(baseId(r._id)) ?? new Set()
    ids.add(r.publicId); byDoc.set(baseId(r._id), ids)
  }
  const dupes = [...byPublicId].filter(([, o]) => o.size > 1)
  const mismatch = [...byDoc].filter(([, ids]) => ids.size > 1)
  const types = [...new Set(rows.map((r) => r._type))].sort()

  console.log(`Dataset ${DATASET} · ${rows.length} rows · ${byDoc.size} documents · types: ${types.join(', ')}`)
  console.log(`Duplicates (one publicId, several documents): ${dupes.length}`)
  for (const [p, o] of dupes) console.log(`  ${p}: ${[...o].join(', ')}`)
  console.log(`Draft/published mismatch: ${mismatch.length}`)
  for (const [d, ids] of mismatch) console.log(`  ${d}: ${[...ids].join(', ')}`)
  console.log(`Missing publicId: ${missing.length}`)
  for (const r of missing) console.log(`  ${r._type} ${r._id} (${r.projectSlug ?? '—'})`)
  process.exit(dupes.length || mismatch.length || missing.length ? 1 : 0)
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(2)
}

#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — report-profile-applicability.mjs   (Catalogue V2, D-22 / C1.12) — READ-ONLY
//
// Lists every catalogueItem copy (published and drafts.*) whose categories (primary AND
// additional), tags or attached option lists are not used for the item's type ("Use for"),
// per project. The rule itself is src/lib/modules/catalogue/taxonomy/profile-applicability.ts
// (the same pure function the dashboard writer, the publish gate and Studio run), so this file
// only loads documents and prints. It has NO write mode — nothing is ever replaced or removed
// (D-22: incompatible assignments are fixed by a person, never automatically).
//
// USAGE
//   npx tsx scripts/catalogue/report-profile-applicability.mjs --dataset <name> [--project <slug>] [--before <file>] [--json]
//
//   --dataset <name>   REQUIRED, no default (e.g. production, staging).
//   --project <slug>   Only this projectSlug.
//   --before <file>    An export (NDJSON or JSON array) instead of the live dataset.
//   --json             Print the full report as JSON.
//
// Live reads use NEXT_PUBLIC_SANITY_PROJECT_ID + SANITY_API_READ_TOKEN (read-only) from the
// environment, .env.local or .env; token values are never printed.
//
// EXIT    0 nothing incompatible · 1 findings listed · 2 could not run
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileApplicabilityReport } from '../../src/lib/modules/catalogue/taxonomy/profile-applicability-docs.ts'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const flag = (f) => argv.includes(f)

const DATASET = val('--dataset')
if (!DATASET) {
  console.error('--dataset is required (no default). Example: --dataset production')
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

function readSnapshot(path) {
  const raw = readFileSync(path, 'utf8').trim()
  if (raw.startsWith('[')) return JSON.parse(raw)
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function readLive() {
  const projectId = env('NEXT_PUBLIC_SANITY_PROJECT_ID')
  const token = env('SANITY_API_READ_TOKEN')
  if (!projectId || !token) {
    console.error('Live read needs NEXT_PUBLIC_SANITY_PROJECT_ID and SANITY_API_READ_TOKEN (a read-only token).')
    process.exit(2)
  }
  const url = new URL(`https://${projectId}.api.sanity.io/v2026-05-21/data/query/${DATASET}`)
  url.searchParams.set('query', '*[_type in ["catalogueItem", "catalogueTaxonomy", "catalogueOptionList"]]{ _id, _type, projectSlug, itemProfile, primaryCategory, additionalCategories, categories, tags, optionLists, useFor, name }')
  url.searchParams.set('perspective', 'raw')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`query failed: HTTP ${res.status}`)
  return (await res.json()).result
}

let docs
try {
  docs = val('--before') ? readSnapshot(val('--before')) : await readLive()
} catch (e) {
  console.error(`could not read documents: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(2)
}
const reports = profileApplicabilityReport(docs, { project: val('--project') ?? undefined })

if (flag('--json')) console.log(JSON.stringify({ dataset: DATASET, reports }, null, 2))
else {
  for (const r of reports) {
    const types = Object.entries(r.profiles).map(([p, n]) => `${p}=${n}`).join(' ')
    console.log(`\n[${r.project}] dataset=${DATASET} items=${r.items} ${types} without type=${r.withoutProfile}`)
    if (r.withoutProfile > 0) console.log('  note: items without a type produce no findings until they get one.')
    if (!r.rows.length) console.log('  none — every assignment fits its item type')
    for (const row of r.rows) {
      for (const f of row.findings) console.log(`  ${row.draft ? 'DRAFT' : 'LIVE '} ${row.id}  ${row.profile}  ${f.kind} "${f.key}"${f.kind === 'primary' || f.kind === 'additional' ? ` (root ${f.root})` : ''} is used for: ${f.useFor.join(', ') || 'nothing (corrupt value)'}`)
    }
  }
}
process.exit(reports.some((r) => r.rows.length > 0) ? 1 : 0)

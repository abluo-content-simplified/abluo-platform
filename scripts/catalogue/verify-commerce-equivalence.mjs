#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — verify-commerce-equivalence.mjs   (Catalogue V2, contract C10-5) — READ-ONLY
//
// Compares the OLD and NEW public, visitor-visible commerce outcomes of every
// catalogueItem document (published, drafts.* and versions.*), per project,
// context (every configured channel + general) and fixed instant, and prints
// a diff report (D-7). Price-window gap cases (class W) are listed separately:
// they must be empty for the run to pass unless Tom accepts each listed case.
//
// The comparison itself is src/lib/modules/catalogue/commerce/equivalence.ts
// (the same code the synthetic suite commerce-equivalence.test.ts runs), so
// this file only loads documents and prints. It NEVER writes.
//
// USAGE
//   npx tsx scripts/catalogue/verify-commerce-equivalence.mjs --dataset <name> [options]
//
//   --dataset <name>    REQUIRED, no default. The dataset the documents belong to
//                       (e.g. staging). Never assumed — D-11: staging never touches production.
//   --before <file>     An export (NDJSON or JSON array) to read instead of the live dataset.
//   --after <file>      A second snapshot (after a data step). Absent = R1 dual-read:
//                       AFTER = BEFORE read through commerceOf.
//   --project <slug>    Only this projectSlug.
//   --accept-versions   versions.* documents are mapped explicitly (REVIEW C-6); otherwise they fail the run.
//   --json              Print the full report as JSON.
//
// Without --before the documents are read from Sanity in the raw perspective
// (read token from .env.local / .env; token values are never printed).
//
// EXIT    0 pass · 1 diffs, refusals or unmapped versions · 2 could not run
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareCommerce } from '../../src/lib/modules/catalogue/commerce/equivalence.ts'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const val = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const flag = (f) => argv.includes(f)

const DATASET = val('--dataset')
if (!DATASET) {
  console.error('--dataset is required (no default). Example: --dataset staging')
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
  const groq = `*[_type in ["catalogueItem", "siteConfig"] || (_type == "project" && count(moduleInstallations[moduleId == "catalogue"]) > 0)]`
  const url = new URL(`https://${projectId}.api.sanity.io/v2026-05-21/data/query/${DATASET}`)
  url.searchParams.set('query', groq)
  url.searchParams.set('perspective', 'raw')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`query failed: HTTP ${res.status}`)
  return (await res.json()).result
}

const before = val('--before') ? readSnapshot(val('--before')) : await readLive()
const after = val('--after') ? readSnapshot(val('--after')) : null
const onlyProject = val('--project')

const isPublishedSite = (d) => d._type === 'siteConfig' && !String(d._id).startsWith('drafts.')
const projectsOf = (docs) =>
  new Map(
    docs
      .filter((d) => d._type === 'project' && !String(d._id).startsWith('drafts.'))
      .map((p) => [p.projectSlug, (p.moduleInstallations ?? []).find((m) => m.moduleId === 'catalogue')?.config ?? {}]),
  )
const projectsBefore = projectsOf(before)
const projectsAfter = after ? projectsOf(after) : projectsBefore
const afterById = new Map((after ?? before).map((d) => [d._id, d]))

let failed = false
const all = []
for (const [slug, config] of projectsBefore) {
  if (onlyProject && slug !== onlyProject) continue
  const site = before.find((d) => isPublishedSite(d) && d.projectSlug === slug) ?? {}
  if (!site.timeZone) {
    console.error(`[${slug}] siteConfig.timeZone missing — instants cannot be evaluated; skipped (fix the site zone first).`)
    failed = true
    continue
  }
  const items = before.filter((d) => d._type === 'catalogueItem' && d.projectSlug === slug)
  const pairs = items.map((d) => ({ before: d, after: afterById.get(d._id) ?? d }))
  const locale = site.defaultLocale || 'en'
  const report = compareCommerce(
    pairs,
    {
      channelsBefore: config.serviceChannels ?? null,
      channelsAfter: projectsAfter.get(slug)?.serviceChannels ?? null,
      currency: (config.currency || 'EUR').toUpperCase(),
      timeZone: site.timeZone,
      locale,
      defaultLocale: locale,
    },
    { acceptVersions: flag('--accept-versions') },
  )
  all.push({ project: slug, dataset: DATASET, ...report })
  if (!report.pass || report.classW.length > 0) failed = true
  if (!flag('--json')) {
    const c = report.counts
    console.log(`\n[${slug}] dataset=${DATASET} published=${c.published} drafts=${c.drafts} versions=${c.versions} total=${c.total}`)
    console.log(`  diffs: ${report.diffs.length}   class W: ${report.classW.length}   pre-flight refusals: ${report.refusals.length}   ${report.pass ? 'PASS' : 'FAIL'}`)
    if (c.versions > 0 && !flag('--accept-versions')) console.log('  versions.* present and not mapped explicitly (--accept-versions) → FAIL')
    for (const d of report.diffs.slice(0, 50)) console.log(`  DIFF ${d.check} ${d.id}${d.context ? ` ctx=${d.context}` : ''}${d.at ? ` at=${d.at}` : ''}\n    old: ${JSON.stringify(d.old)}\n    new: ${JSON.stringify(d.new)}`)
    if (report.diffs.length > 50) console.log(`  … ${report.diffs.length - 50} more diffs (use --json)`)
    for (const r of report.refusals) console.log(`  REFUSE ${r.id} ${JSON.stringify(r.refusal)}`)
    for (const w of report.classW.slice(0, 50)) console.log(`  W ${w.id} ctx=${w.context} at=${w.at} offers=${w.offerKeys.join(',')} new=${w.newOutcome}`)
  }
}
if (flag('--json')) console.log(JSON.stringify(all, null, 2))
process.exit(failed ? 1 : 0)

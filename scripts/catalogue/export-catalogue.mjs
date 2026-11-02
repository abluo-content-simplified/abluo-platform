#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — export-catalogue.mjs   (Catalogue V2, C10-6 steps P and P′) — READ-ONLY
//
// One export of every Catalogue-relevant document — catalogueItem,
// catalogueCollection, catalogueOptionList, cataloguePage, catalogueTaxonomy,
// cataloguePackHistory, Catalogue taxonomyTerm, the `project` documents with a
// Catalogue installation and their siteConfig — in the raw perspective
// (published, drafts.*, versions.*). It is THE rollback artefact: P for the
// staging rehearsal, P′ for the production data steps. Keep it untouched until
// R3 is accepted.
//
// Output: backups/catalogue/<label>-<dataset>-<yyyymmddhhmm>/
//           catalogue.ndjson   one document per line, sorted by _id
//           manifest.json      counts per type and id class, per project, sha256
// (backups/ is git-ignored: exports hold real content.)
//
// USAGE
//   npx tsx scripts/catalogue/export-catalogue.mjs --dataset production --label p
//
//   --dataset <name>   REQUIRED, no default.
//   --label <name>     e.g. p (rehearsal) or p-prime (before production D1). Default "export".
//   --out <dir>        Output folder (default as above). Refuses to overwrite.
//
// Token: SANITY_API_READ_TOKEN (read-only). Never writes to Sanity.
// EXIT  0 written · 2 could not run
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BACKUPS_DIR, REPO_ROOT, die, env, parseArgs } from './lib/cli.ts'
import { createHttpClient } from './lib/sanity-http.ts'
import { EXPORT_FILE, MANIFEST_FILE, buildManifest, toNdjson } from './lib/export.ts'
import { defaultMigrationId } from './lib/guards.ts'

const args = parseArgs(process.argv.slice(2))
const dataset = args.get('--dataset')
if (!dataset) die('--dataset is required (no default). Example: --dataset production --label p')
const label = (args.get('--label') ?? 'export').toLowerCase()
if (!/^[a-z0-9-]{1,24}$/.test(label)) die('--label: lowercase letters, digits and hyphens')
const projectId = env('NEXT_PUBLIC_SANITY_PROJECT_ID')
const readToken = env('SANITY_API_READ_TOKEN')
if (!projectId || !readToken) die('Needs NEXT_PUBLIC_SANITY_PROJECT_ID and SANITY_API_READ_TOKEN (a read-only token).')

const out = args.get('--out') ?? join(BACKUPS_DIR, defaultMigrationId(label, dataset, new Date()))
if (existsSync(join(out, MANIFEST_FILE))) die(`refusing to overwrite an existing export: ${out}`)

const client = createHttpClient({ projectId, dataset, readToken })
const docs = await client.readAll()
const ndjson = toNdjson(docs)
const manifest = buildManifest(docs, ndjson, { label, dataset, sanityProjectId: projectId, exportedAt: new Date().toISOString() })
mkdirSync(out, { recursive: true })
writeFileSync(join(out, EXPORT_FILE), ndjson)
writeFileSync(join(out, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')

console.log(`export "${label}" of dataset ${dataset}: ${manifest.documents} documents, sha256 ${manifest.sha256}`)
for (const [type, c] of Object.entries(manifest.byType)) console.log(`  ${type.padEnd(22)} published=${c.published} drafts=${c.drafts} versions=${c.versions}`)
for (const p of manifest.projects) console.log(`  project ${p.slug}: ${p.items} catalogueItem documents`)
console.log(`written to ${out.replace(REPO_ROOT + '/', '')}`)

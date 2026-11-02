#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — import-to-staging.mjs   (Catalogue V2, C10-6 step S)
//
// Imports a Catalogue export (export-catalogue.mjs) into the `staging` dataset
// for the rehearsal. D-11: the rehearsal must never write to production — this
// script refuses any --dataset other than `staging` and asserts the client is
// bound to `staging` before its first mutation. The export's checksum is
// checked against its manifest first.
//
// USAGE
//   npx tsx scripts/catalogue/import-to-staging.mjs --dataset staging --from backups/catalogue/<P export>          (dry run)
//   npx tsx scripts/catalogue/import-to-staging.mjs --dataset staging --from backups/catalogue/<P export> --apply
//
//   --replace   Allow overwriting documents that already exist in staging (a repeated rehearsal).
//
// Token: SANITY_MIGRATION_TOKEN with write access to `staging` ONLY (RUNBOOK §Tokens).
// Report: docs/engineering/catalogue-module/rollout/reports/import-staging-<stamp>.json
// EXIT  0 imported (or dry run clean) · 1 refused / mismatch · 2 could not run
// ---------------------------------------------------------------------------

import { REPO_ROOT, die, parseArgs, readExport, sanityClient, writeReport } from './lib/cli.ts'
import { runImport } from './lib/import.ts'
import { defaultMigrationId } from './lib/guards.ts'

const args = parseArgs(process.argv.slice(2))
const dataset = args.get('--dataset')
if (!dataset) die('--dataset is required (no default) and must be staging.')
if (dataset !== 'staging') die(`import-to-staging writes only to the staging dataset (got "${dataset}").`)
const from = args.get('--from')
if (!from) die('--from <export folder> is required.')
const source = readExport(from)
const apply = args.has('--apply')

const report = await runImport({
  client: sanityClient(dataset, { write: apply }),
  dataset,
  apply,
  replace: args.has('--replace'),
  docs: source.docs,
  source: { sha256: source.manifest.sha256, exportedAt: source.manifest.exportedAt, dataset: source.manifest.dataset, documents: source.manifest.documents },
  migrationId: defaultMigrationId('import', dataset, new Date()),
})
const path = writeReport(report.reportId, report)
console.log(`\nimport into ${dataset} (${report.mode}) of ${source.manifest.documents} documents from ${source.manifest.dataset} export ${source.manifest.exportedAt}`)
console.log(`  transactions: ${report.transactions.length}   references left weak (target not exported): ${report.leftWeak.length}`)
for (const r of report.refusals) console.log(`  REFUSE ${r.code}${r.id ? ` ${r.id}` : ''}${r.detail ? ` ${JSON.stringify(r.detail)}` : ''}`)
for (const m of report.mismatches.slice(0, 20)) console.log(`  MISMATCH ${m}`)
if (report.error) console.log(`  ${report.error}`)
console.log(`  ${report.green ? 'OK' : 'NOT OK'}   report: ${path.replace(REPO_ROOT + '/', '')}`)
process.exit(report.green ? 0 : 1)

#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — verify-data-step.mjs   (Catalogue V2, C10-6 verification column) — READ-ONLY
//
// Runs the verification of one data step with before = an export and after =
// the live dataset (or a second export):
//   taxonomy      C1.9 step 3: assignment = legacy set, primary = first existing
//                 category, vocabulary labels per locale equal, `categories` kept,
//                 nothing else changed
//   commerce      C10-5 E1–E9 (compareCommerce), class W empty, `offers` kept,
//                 channel entries = migrateChannelEntries(before), nothing else changed
//   pack-history  C7 guard/legacy-preset against the real record, setup complete,
//                 nothing else changed
//   public-name   C11 public-name.preserved, navLabel unset, an existing publicName
//                 untouched, nothing else changed
// (website-output.unchanged — C11 proof 2 — is snapshot-public-output.mjs.)
//
// USAGE
//   npx tsx scripts/catalogue/verify-data-step.mjs --step taxonomy --dataset staging --before backups/catalogue/<P export>
//
//   --step <taxonomy|commerce|pack-history|public-name>   REQUIRED.
//   --dataset <name>   REQUIRED, no default (the "after" side when --after is absent).
//   --before <dir>     REQUIRED: the export taken before the step (P or P′).
//   --after <dir>      A second export instead of the live dataset.
//   --project <slug>   Only this project.   --accept-versions   versions.* mapped (REVIEW C-6).
//
// Report: docs/engineering/catalogue-module/rollout/reports/verify-<step>-<dataset>-<stamp>.json
// EXIT  0 pass · 1 fail · 2 could not run
// ---------------------------------------------------------------------------

import { REPO_ROOT, die, parseArgs, readExport, sanityClient, writeReport } from './lib/cli.ts'
import { DATA_STEPS } from './lib/preflight.ts'
import { STEP_LABEL } from './lib/step.ts'
import { defaultMigrationId } from './lib/guards.ts'

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const name = args.get('--step')
const step = DATA_STEPS.find((s) => STEP_LABEL[s.step].replace(/^d\d-/, '') === name)
if (!step) die('--step must be one of: taxonomy, commerce, pack-history, public-name')
const dataset = args.get('--dataset')
if (!dataset) die('--dataset is required (no default).')
if (!args.get('--before')) die('--before <export folder> is required (the export taken before the step).')
const before = readExport(args.get('--before'))
const after = args.get('--after') ? readExport(args.get('--after')).docs : await sanityClient(dataset, { write: false }).readAll()

const ctx = { now: new Date().toISOString(), migrationId: 'verify', project: args.get('--project') ?? undefined, acceptVersions: args.has('--accept-versions') }
const verification = step.verify(before.docs, after, ctx)
const reportId = defaultMigrationId(`verify-${name}`, dataset, new Date())
const path = writeReport(reportId, {
  reportId,
  kind: 'catalogue-verification',
  step: step.step,
  dataset,
  before: { dir: before.dir.replace(REPO_ROOT + '/', ''), sha256: before.manifest.sha256, exportedAt: before.manifest.exportedAt },
  after: args.get('--after') ? 'export' : 'live',
  green: verification.pass,
  verification,
})
console.log(`\nverify ${STEP_LABEL[step.step]} — before=${before.manifest.label} (${before.manifest.dataset}) after=${args.get('--after') ? 'export' : `live ${dataset}`}`)
for (const c of verification.checks) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass ? '' : ` (${c.diffs.length}) ${JSON.stringify(c.diffs.slice(0, 5))}`}`)
console.log(`  ${verification.pass ? 'PASS' : 'FAIL'}   report: ${path.replace(REPO_ROOT + '/', '')}`)
process.exit(verification.pass ? 0 : 1)

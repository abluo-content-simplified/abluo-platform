#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Abluo — preflight-catalogue.mjs   (Catalogue V2, C10-6 steps P and P′) — READ-ONLY
//
// In-memory dry runs of D1 → D2 → D3 → D4 over an export or the live dataset,
// each step planned on the state the previous one left and verified against its
// own before-state. Refusals (exit 1) are the contract's stops:
//   invalid offers · unknown-channel offers · offers with reserved fields
//   (currency, locationKey) · class W · taxonomy cycles / duplicates / orphans ·
//   non-conforming legacy channel entries · versions.* documents · missing site
//   time zone · a verification that would fail · the audit table missing (M0).
// Findings (printed, never silent): multi-category items and their D-15 primary,
// unknown category keys, colours not carried, stale config.categories, the
// navLabel → publicName plan (copy / drop / partial drop).
//
// USAGE
//   npx tsx scripts/catalogue/preflight-catalogue.mjs --dataset production --from backups/catalogue/<P export>
//   npx tsx scripts/catalogue/preflight-catalogue.mjs --dataset production          (reads live, read-only)
//
//   --dataset <name>   REQUIRED, no default (the dataset the export came from / is read from).
//   --from <dir>       An export folder (export-catalogue.mjs). Absent → live read.
//   --label <name>     Report label, e.g. p or p-prime (default "preflight").
//   --project <slug>   Only this project.
//   --accept-versions  versions.* mapped explicitly (REVIEW C-6).
//   --audit-for <staging|production>  Probe the audit table the coming run writes to
//                      (staging → Abluo Sandbox, .env.sandbox.local; production → Abluo, .env.local).
//   --json             Print the report as JSON.
//
// Report: docs/engineering/catalogue-module/rollout/reports/<label>-<dataset>-<stamp>.json
// EXIT  0 clean · 1 refusals · 2 could not run
// ---------------------------------------------------------------------------

import { REPO_ROOT, die, migrationAudit, parseArgs, readExport, sanityClient, writeReport } from './lib/cli.ts'
import { preflightAll } from './lib/preflight.ts'
import { defaultMigrationId } from './lib/guards.ts'

const args = parseArgs(process.argv.slice(2))
const dataset = args.get('--dataset')
if (!dataset) die('--dataset is required (no default). Example: --dataset production --from backups/catalogue/<export>')
const label = (args.get('--label') ?? 'preflight').toLowerCase()
const from = args.get('--from')
const source = from ? readExport(from) : null
if (source && source.manifest.dataset !== dataset) die(`the export is of dataset "${source.manifest.dataset}", not "${dataset}"`)
const docs = source ? source.docs : await sanityClient(dataset, { write: false }).readAll()

const now = new Date()
const report = {
  reportId: `${defaultMigrationId(label, dataset, now)}`,
  dataset,
  source: source ? { kind: 'export', dir: source.dir.replace(REPO_ROOT + '/', ''), sha256: source.manifest.sha256, exportedAt: source.manifest.exportedAt } : { kind: 'live' },
  createdAt: now.toISOString(),
  audit: null,
  ...preflightAll(docs, { now: now.toISOString(), project: args.get('--project') ?? undefined, acceptVersions: args.has('--accept-versions') }),
}

// The audit table the coming run writes to: Abluo Sandbox for the rehearsal, Abluo for production.
const auditFor = args.get('--audit-for')
if (auditFor && auditFor !== 'staging' && auditFor !== 'production') die('--audit-for must be staging or production')
const audit = auditFor ? migrationAudit(args, auditFor) : null
if (audit) {
  const probe = await audit.probe()
  report.audit = { target: audit.target, probe }
  if (!probe.ok) report.refusals.push({ step: 'export', code: `audit.${probe.code}`, detail: probe.message })
} else report.findings.push({ step: 'export', code: 'audit.notProbed', detail: auditFor ? `no Supabase credentials for ${auditFor} — the D-steps refuse to write until the audit table is reachable` : 'not probed (pass --audit-for staging|production) — the D-steps refuse to write until the audit table is reachable' })
report.green = report.refusals.length === 0

const path = writeReport(report.reportId, report)
if (args.has('--json')) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`\npre-flight "${label}" dataset=${dataset} source=${report.source.kind}`)
  console.log(`  items: published=${report.itemCounts.published} drafts=${report.itemCounts.drafts} versions=${report.itemCounts.versions}  projects: ${report.projects.join(', ')}`)
  for (const s of report.steps) {
    console.log(`  ${s.label}: ${s.projects.map((p) => `[${p.slug}] ${p.mutations} mutations ${JSON.stringify(p.counts)}`).join(' ')}; ${s.transactions} transaction(s); verification ${s.verification.pass ? 'ok' : 'FAIL'}`)
  }
  for (const x of report.refusals) console.log(`  REFUSE ${x.step}/${x.code}${x.project ? ` [${x.project}]` : ''}${x.id ? ` ${x.id}` : ''}${x.detail ? ` ${JSON.stringify(x.detail).slice(0, 300)}` : ''}`)
  for (const x of report.findings) console.log(`  NOTE   ${x.step}/${x.code}${x.project ? ` [${x.project}]` : ''}${x.id ? ` ${x.id}` : ''}${x.detail ? ` ${JSON.stringify(x.detail).slice(0, 300)}` : ''}`)
  console.log(`  ${report.green ? 'CLEAN' : 'REFUSED — stop, Tom decides'}   report: ${path.replace(REPO_ROOT + '/', '')}`)
}
process.exit(report.green ? 0 : 1)

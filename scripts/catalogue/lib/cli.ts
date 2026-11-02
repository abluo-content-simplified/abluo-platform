// ── Catalogue rollout scripts — shared CLI plumbing (env, files, reports) ─────
// Thin I/O around the pure cores. Paths resolve from the repo root, so every
// command runs from the repo root on Tom's Mac (`npx tsx scripts/catalogue/…`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { EXPORT_FILE, MANIFEST_FILE, checkExport, type ExportManifest } from './export'
import { REPORT_ID, auditTargetGuard, defaultMigrationId, type StepReportSummary } from './guards'
import { SANDBOX_ENV_FILE, assertSandboxSupabase, isProductionSupabase, supabaseRefOf } from '../../../src/lib/environments/supabase-target'
import { createHttpClient } from './sanity-http'
import { createMigrationAudit, type MigrationAudit, type MigrationAuditDb } from './audit'
import { runDataStep, type StepReport } from './runner'
import { STEP_LABEL, type StepDefinition } from './step'
import type { Doc } from './docs'

export const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
export const REPORTS_DIR = join(REPO_ROOT, 'docs', 'engineering', 'catalogue-module', 'rollout', 'reports')
export const BACKUPS_DIR = join(REPO_ROOT, 'backups', 'catalogue')

export type Args = { flags: Set<string>; values: Map<string, string[]>; get(name: string): string | null; all(name: string): string[]; has(name: string): boolean }

/** `--name value` and `--flag`; a value never starts with `--`. */
export function parseArgs(argv: readonly string[]): Args {
  const flags = new Set<string>()
  const values = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      values.set(a, [...(values.get(a) ?? []), next])
      i++
    } else flags.add(a)
  }
  return {
    flags,
    values,
    get: (n) => values.get(n)?.[0] ?? null,
    all: (n) => values.get(n) ?? [],
    has: (n) => flags.has(n) || values.has(n),
  }
}

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}
const fileEnv = { ...loadEnvFile(join(REPO_ROOT, '.env')), ...loadEnvFile(join(REPO_ROOT, '.env.local')) }
export const env = (k: string) => process.env[k] || fileEnv[k] || ''

export function die(message: string, code = 2): never {
  console.error(message)
  process.exit(code)
}

export function readReport(reportId: string): StepReportSummary | null {
  if (!REPORT_ID.test(reportId)) return null
  const path = join(REPORTS_DIR, `${reportId}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function writeReport(reportId: string, report: unknown): string {
  if (!REPORT_ID.test(reportId)) throw new Error(`invalid report id ${reportId}`)
  mkdirSync(REPORTS_DIR, { recursive: true })
  const path = join(REPORTS_DIR, `${reportId}.json`)
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n')
  return path
}

/** Read an export folder (or its manifest path); refuses a changed or incomplete export. */
export function readExport(dirOrFile: string): { docs: Doc[]; manifest: ExportManifest; dir: string } {
  const dir = resolvePath(dirOrFile.endsWith(MANIFEST_FILE) || dirOrFile.endsWith(EXPORT_FILE) ? dirname(dirOrFile) : dirOrFile)
  const nd = join(dir, EXPORT_FILE)
  const mf = join(dir, MANIFEST_FILE)
  if (!existsSync(nd) || !existsSync(mf)) die(`not an export folder (needs ${EXPORT_FILE} + ${MANIFEST_FILE}): ${dir}`)
  const r = checkExport(readFileSync(nd, 'utf8'), readFileSync(mf, 'utf8'))
  if (!r.ok) die(`export refused (${r.code}): ${r.message}`)
  return { docs: r.docs, manifest: r.manifest, dir }
}

export function sanityClient(dataset: string, opts: { write: boolean }) {
  const projectId = env('NEXT_PUBLIC_SANITY_PROJECT_ID')
  const writeToken = env('SANITY_MIGRATION_TOKEN')
  const readToken = writeToken || env('SANITY_API_READ_TOKEN')
  if (!projectId) die('NEXT_PUBLIC_SANITY_PROJECT_ID is not set (.env.local).')
  if (!readToken) die('No read token: set SANITY_API_READ_TOKEN (read-only) or SANITY_MIGRATION_TOKEN.')
  if (opts.write && !writeToken) die('--apply needs SANITY_MIGRATION_TOKEN: a token issued for this run only (see RUNBOOK §Tokens), never the app write token.')
  return createHttpClient({ projectId, dataset, readToken, writeToken: opts.write ? writeToken : null })
}

const sandboxEnv = loadEnvFile(join(REPO_ROOT, SANDBOX_ENV_FILE))

/**
 * The audit target is derived from the dataset, never chosen by hand (ADR-038 D8):
 * `staging` → Abluo Sandbox credentials from .env.sandbox.local (assertSandboxSupabase);
 * `production` → the app credentials (.env.local), which must be the production project.
 * null when the credentials are missing (an apply then refuses before any mutation).
 */
export function migrationAudit(args: Args, dataset: string): MigrationAudit | null {
  const fromSandbox = dataset !== 'production'
  const url = fromSandbox ? sandboxEnv.NEXT_PUBLIC_SUPABASE_URL : env('NEXT_PUBLIC_SUPABASE_URL')
  const key = fromSandbox ? sandboxEnv.SUPABASE_SERVICE_ROLE_KEY : env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  const target = auditTargetGuard(dataset, url, { isProduction: isProductionSupabase, assertSandbox: assertSandboxSupabase })
  if (!target.ok) die(`audit target refused (${target.code}): ${target.message}`)
  const overrides: Record<string, string> = {}
  for (const pair of args.all('--supabase-project')) {
    const [slug, id] = pair.split('=')
    if (slug && id) overrides[slug] = id
  }
  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) as unknown as MigrationAuditDb
  return createMigrationAudit(db, { target: `${fromSandbox ? 'sandbox' : 'production'}:${supabaseRefOf(url) ?? new URL(url).host}`, overrides })
}

export function printStepReport(r: StepReport, path: string | null) {
  console.log(`\n${r.label} — dataset=${r.dataset} mode=${r.mode} migrationId=${r.migrationId}`)
  console.log(`  items: published=${r.itemCounts.published} drafts=${r.itemCounts.drafts} versions=${r.itemCounts.versions}`)
  for (const p of r.projects) console.log(`  [${p.slug}] ${JSON.stringify(p.counts)} transactions=${p.transactions.length} marker=${p.marker ?? '-'} audit=${p.audit}`)
  console.log(`  transactions: ${r.transactions.length}${r.transactions.length ? ' (' + r.transactions.map((t) => t.transactionId).join(', ') + ')' : ''}`)
  for (const x of r.refusals) console.log(`  REFUSE ${x.code}${x.project ? ` [${x.project}]` : ''}${x.id ? ` ${x.id}` : ''}${x.detail ? ` ${JSON.stringify(x.detail)}` : ''}`)
  for (const x of r.findings) console.log(`  NOTE   ${x.code}${x.project ? ` [${x.project}]` : ''}${x.id ? ` ${x.id}` : ''}${x.detail ? ` ${JSON.stringify(x.detail)}` : ''}`)
  for (const c of r.verification?.checks ?? []) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}${c.pass ? '' : ` ${JSON.stringify(c.diffs.slice(0, 5))}`}`)
  if (r.audit.probe) console.log(`  audit: ${r.audit.target ?? '-'} ${r.audit.probe.ok ? 'table ok' : r.audit.probe.code}`)
  if (r.error) console.log(`  stopped at ${r.stoppedAt}: ${r.error}`)
  console.log(`  ${r.green ? 'GREEN' : 'NOT GREEN'}${path ? `  report: ${path.replace(REPO_ROOT + '/', '')}` : ''}`)
}

const USAGE = (label: string, script: string) => `
${label}
  npx tsx scripts/catalogue/${script} --dataset <staging|production> [options]

  --dataset <name>        REQUIRED, no default. The only dataset read and written.
  --apply                 Write. Without it: dry run (plan + in-memory verification, nothing written).
  --approval <report id>  REQUIRED for --dataset production: the id of the GREEN staging report of this step.
  --before <export dir>   Verify against this export (S: the P export; production: the P′ export).
  (audit rows: staging → Abluo Sandbox from .env.sandbox.local; production → Abluo from .env.local)
  --supabase-project <slug>=<uuid>   Supabase project id when the slug is not unique (repeatable).
  --project <slug>        Only this project.
  --migration-id <id>     Default <step>-<dataset>-<yyyymmddhhmm>.
  --revert [--rollback <P′ export dir>] [--accept-lossy]   C10-7 data revert of this step.
  --accept-versions       versions.* documents mapped explicitly (REVIEW C-6).
  --json                  Print the report as JSON.
`

/** The whole CLI of a migrate-*.mjs script. */
export async function runStepCli(step: StepDefinition, script: string, argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.has('--help')) {
    console.log(USAGE(STEP_LABEL[step.step], script))
    return
  }
  const dataset = args.get('--dataset')
  if (!dataset) die(`--dataset is required (no default).${USAGE(STEP_LABEL[step.step], script)}`)
  const apply = args.has('--apply')
  const revert = args.has('--revert')
  const migrationId = args.get('--migration-id') ?? defaultMigrationId(STEP_LABEL[step.step], dataset, new Date())
  const before = args.get('--before') ? readExport(args.get('--before')!) : null
  const rollback = args.get('--rollback') ? readExport(args.get('--rollback')!) : null
  if (before && before.manifest.dataset !== (dataset === 'staging' ? before.manifest.dataset : dataset))
    die(`--before export is of dataset "${before.manifest.dataset}", the run is on "${dataset}" — production steps verify against the P′ export of production.`)
  const report = await runDataStep({
    step,
    client: sanityClient(dataset, { write: apply }),
    audit: revert ? null : migrationAudit(args, dataset),
    dataset,
    apply,
    revert,
    approval: args.get('--approval'),
    readReport,
    migrationId,
    before: before?.docs,
    beforeSource: before ? `${before.manifest.label} export ${before.manifest.exportedAt} sha256=${before.manifest.sha256.slice(0, 12)}` : undefined,
    rollback: rollback?.docs,
    project: args.get('--project') ?? undefined,
    acceptVersions: args.has('--accept-versions'),
    acceptLossy: args.has('--accept-lossy'),
    log: (l) => console.log(`  ${l}`),
  })
  const path = report.stoppedAt === 'guard' ? null : writeReport(report.reportId, report)
  if (args.has('--json')) console.log(JSON.stringify(report, null, 2))
  else printStepReport(report, path)
  process.exit(report.green ? 0 : 1)
}

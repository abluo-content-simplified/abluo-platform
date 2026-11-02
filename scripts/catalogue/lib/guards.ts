// ── Catalogue rollout scripts — dataset and approval guards (C10-6, D-11) ─────
// Pure. "Staging never writes to production": every script takes an explicit
// --dataset (no default) and writes only there; a write to production requires
// --dataset production --approval <ref> and refuses when the referenced S
// (staging rehearsal) report is missing or not green.

import type { StepName } from './step'

export const WRITABLE_DATASETS = ['staging', 'production'] as const
export type WritableDataset = (typeof WRITABLE_DATASETS)[number]

/** Report ids are file names under the reports folder: no path separators, no dots. */
export const REPORT_ID = /^[a-z0-9][a-z0-9-]{0,95}$/

export type StepReportSummary = { reportId?: string; step?: string; dataset?: string; mode?: string; green?: boolean }

export type GuardResult = { ok: true } | { ok: false; code: string; message: string }

const refuse = (code: string, message: string): GuardResult => ({ ok: false, code, message })

/**
 * The write guard. Dry runs (no --apply) are always allowed on any named dataset
 * (they never mutate). Writes: only `staging` or `production`; production needs an
 * approval that names a GREEN staging apply report of the SAME step. Reverts on
 * production need an approval reference too (Tom's decision id), but no staging report.
 */
export function writeGuard(input: {
  dataset: string | null | undefined
  apply: boolean
  mode?: 'migrate' | 'revert' | 'import'
  step?: StepName
  approval?: string | null
  readReport: (reportId: string) => StepReportSummary | null
}): GuardResult {
  const { dataset, apply } = input
  if (!dataset) return refuse('dataset.required', '--dataset is required (no default). Example: --dataset staging')
  if (!apply) return { ok: true }
  if (!(WRITABLE_DATASETS as readonly string[]).includes(dataset)) return refuse('dataset.notWritable', `writes are allowed only to ${WRITABLE_DATASETS.join(' or ')} (got "${dataset}")`)
  if (input.mode === 'import' && dataset !== 'staging') return refuse('import.stagingOnly', 'import-to-staging writes only to --dataset staging')
  if (dataset !== 'production') return { ok: true }
  const approval = input.approval ?? ''
  if (!approval) return refuse('approval.required', 'a production write needs --approval <staging report id>')
  if (input.mode === 'revert') return REPORT_ID.test(approval) ? { ok: true } : refuse('approval.invalid', 'invalid --approval reference')
  if (!REPORT_ID.test(approval)) return refuse('approval.invalid', `--approval must be a report id (${REPORT_ID})`)
  const report = input.readReport(approval)
  if (!report) return refuse('approval.reportMissing', `staging report "${approval}" not found under docs/engineering/catalogue-module/rollout/reports/`)
  if (report.dataset !== 'staging') return refuse('approval.notStaging', `report "${approval}" is for dataset "${report.dataset}", not staging`)
  if (report.mode !== 'apply') return refuse('approval.notApplied', `report "${approval}" is a ${report.mode ?? 'unknown'} run, not an applied rehearsal`)
  if (input.step && report.step !== input.step) return refuse('approval.wrongStep', `report "${approval}" is for step "${report.step}", not "${input.step}"`)
  if (report.green !== true) return refuse('approval.notGreen', `report "${approval}" is not green`)
  return { ok: true }
}

/**
 * The audit rows of a run go to the Supabase that matches its dataset (ADR-038 D8):
 * a staging rehearsal → Abluo Sandbox (never the production project — the
 * repo-wide `assertSandboxSupabase` rule for rehearsal scripts that write);
 * production → the Abluo production project.
 */
export function auditTargetGuard(dataset: string, supabaseUrl: string | null | undefined, refs: { isProduction: (url: string) => boolean; assertSandbox: (url: string, purpose: string) => string }): GuardResult {
  if (!supabaseUrl) return refuse('audit.unconfigured', dataset === 'production' ? 'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local) are needed for the production audit rows' : 'the rehearsal audits into Abluo Sandbox: put its credentials in .env.sandbox.local')
  if (dataset === 'production') return refs.isProduction(supabaseUrl) ? { ok: true } : refuse('audit.notProduction', 'a production data step must audit into the Abluo production Supabase project')
  try {
    refs.assertSandbox(supabaseUrl, `catalogue rehearsal on ${dataset}`)
    return { ok: true }
  } catch (e) {
    return refuse('audit.notSandbox', e instanceof Error ? e.message : String(e))
  }
}

export class DatasetMismatchError extends Error {
  constructor(public expected: string, public actual: string) {
    super(`refusing to write: the client is bound to dataset "${actual}", the run targets "${expected}"`)
  }
}

/** Asserted immediately before the first mutation (and before every transaction). */
export function assertClientDataset(client: { dataset: string }, expected: string) {
  if (client.dataset !== expected) throw new DatasetMismatchError(expected, client.dataset)
}

/** `<step>-<dataset>-<yyyymmddhhmm>` — valid for catalogueTransactionId (≤ 48, [a-z0-9-]). */
export function defaultMigrationId(label: string, dataset: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12)
  return `${label}-${dataset}-${stamp}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 48)
}

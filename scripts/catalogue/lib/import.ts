// ── Catalogue rollout scripts — import an export into `staging` (C10-6 S) ─────
//
// The rehearsal copies the P export into the `staging` dataset and runs D1–D4
// there. D-11: "The staging rehearsal must not write to production" — this
// importer refuses unless --dataset staging AND asserts the client is bound to
// `staging` before its first mutation. Two phases: (1) every document with its
// strong references weakened (targets such as image assets are not exported),
// (2) documents whose references all point inside the export are restored
// exactly. References left weak are listed; every verification ignores `_weak`.

import { batchGroups, type MutationGroup } from './mutations'
import { assertClientDataset, writeGuard } from './guards'
import { planImport, type WeakRef } from './export'
import { baseIdOf, sameValue, sortDocs, type Doc } from './docs'
import type { MigrationClient } from './runner'

export type ImportReport = {
  reportId: string
  kind: 'catalogue-import'
  dataset: string
  mode: 'dry-run' | 'apply'
  source: { sha256: string; exportedAt: string; dataset: string; documents: number }
  green: boolean
  error: string | null
  refusals: { code: string; id?: string; detail?: unknown }[]
  transactions: string[]
  leftWeak: WeakRef[]
  /** Imported documents that differ from the export after import (ignoring _weak and system fields). */
  mismatches: string[]
}

export async function runImport(o: {
  client: MigrationClient
  dataset: string
  apply: boolean
  replace: boolean
  docs: readonly Doc[]
  source: ImportReport['source']
  migrationId: string
  limit?: number
}): Promise<ImportReport> {
  const report: ImportReport = { reportId: `${o.migrationId}${o.apply ? '' : '-dry-run'}`, kind: 'catalogue-import', dataset: o.dataset, mode: o.apply ? 'apply' : 'dry-run', source: o.source, green: false, error: null, refusals: [], transactions: [], leftWeak: [], mismatches: [] }
  // The importer is staging-only even for a dry run: there is no reason to name another dataset.
  const guard = writeGuard({ dataset: o.dataset, apply: true, mode: 'import', readReport: () => null })
  if (!guard.ok) {
    report.refusals.push({ code: guard.code, detail: guard.message })
    report.error = guard.message
    return report
  }
  assertClientDataset(o.client, 'staging')
  const existing = await o.client.readAll()
  const plan = planImport(o.docs, { existingIds: new Set(existing.map((d) => d._id)), replace: o.replace })
  report.refusals.push(...plan.refusals)
  report.leftWeak = plan.leftWeak
  if (report.refusals.length) {
    report.error = 'refusals — nothing was written'
    return report
  }
  const groups = (mutations: typeof plan.create, phase: string): MutationGroup[] => {
    const byBase = new Map<string, typeof plan.create>()
    for (const m of mutations) {
      const id = 'createOrReplace' in m ? m.createOrReplace._id : ''
      byBase.set(baseIdOf(id), [...(byBase.get(baseIdOf(id)) ?? []), m])
    }
    return [...byBase].map(([base, ms]) => ({ key: `${phase}:${base}`, mutations: ms }))
  }
  const phase1 = batchGroups(groups(plan.create, 'import'), { migrationId: o.migrationId, limit: o.limit })
  const phase2 = batchGroups(groups(plan.strengthen, 'strengthen'), { migrationId: o.migrationId, limit: o.limit, startAt: phase1.length + 1 })
  if (!o.apply) {
    report.transactions = [...phase1, ...phase2].map((t) => t.transactionId)
    report.green = true
    return report
  }
  for (const t of [...phase1, ...phase2]) {
    assertClientDataset(o.client, 'staging')
    try {
      await o.client.mutate(t.mutations, { transactionId: t.transactionId })
    } catch (e) {
      report.error = `${t.transactionId}: ${e instanceof Error ? e.message : String(e)}`
      return report
    }
    report.transactions.push(t.transactionId)
  }
  const after = new Map((await o.client.readAll()).map((d) => [d._id, d]))
  for (const d of sortDocs(o.docs)) if (!sameValue(d, after.get(d._id) ?? null)) report.mismatches.push(d._id)
  report.green = report.mismatches.length === 0
  if (!report.green) report.error = 'imported documents differ from the export'
  return report
}

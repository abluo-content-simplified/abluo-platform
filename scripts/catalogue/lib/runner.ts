// ── Catalogue rollout scripts — the data-step runner (C10-6 D1–D4, C10-7) ─────
//
// The only place that does I/O for a data step, through two injected seams (a
// Sanity client bound to ONE dataset and the C12 audit), so the whole flow is
// unit-tested with an in-memory client. Order (fixed):
//
//   guard (dataset, approval) → assert client dataset → read live state →
//   plan (= the step's own pre-flight on live data, REVIEW C-19) + preconditions →
//   any refusal: STOP → [apply] audit probe + project ids (audit is required) →
//   transactions (batched, `abluo-migr-<migrationId>-<n>`, draft/published pairs
//   never split, ifRevisionID on every document; a conflict re-reads and re-plans,
//   which is safe because every planner is idempotent) → re-read → verification →
//   marker (only when verification passed) → audit rows → report.
//
// Dry run (default): the same plan applied in memory, verified, nothing written.

import { ConflictError, batchGroups, simulate, type Mutation } from './mutations'
import { catalogueProjects, docsOfType, idCounts, type Doc } from './docs'
import { assertClientDataset, writeGuard, type StepReportSummary } from './guards'
import { migrationEntry, type MigrationAudit, type ProbeResult } from './audit'
import { STEP_LABEL, hasMarker, markerGroup, type Finding, type Refusal, type StepContext, type StepDefinition, type StepPlan, type Verification } from './step'

export type MigrationClient = {
  /** The dataset this client is bound to (asserted before every transaction). */
  dataset: string
  /** Every document of the export scope, raw perspective (published, drafts.*, versions.*). */
  readAll(): Promise<Doc[]>
  /** One transaction. Must throw ConflictError on a revision conflict (HTTP 409). */
  mutate(mutations: Mutation[], opts: { transactionId: string }): Promise<void>
}

export type ProjectOutcome = { slug: string; counts: Record<string, number>; transactions: string[]; marker: string | null; audit: 'recorded' | 'failed' | 'none' | 'simulated' }

export type StepReport = {
  reportId: string
  kind: 'catalogue-data-step'
  step: string
  label: string
  dataset: string
  mode: 'dry-run' | 'apply' | 'revert-dry-run' | 'revert'
  migrationId: string
  approval: string | null
  beforeSource: string
  startedAt: string
  finishedAt: string
  green: boolean
  stoppedAt: null | 'guard' | 'preflight' | 'audit' | 'conflict' | 'mutate' | 'verification'
  error: string | null
  itemCounts: ReturnType<typeof idCounts>
  refusals: Refusal[]
  findings: Finding[]
  projects: ProjectOutcome[]
  transactions: { transactionId: string; groups: string[]; mutations: number }[]
  verification: Verification | null
  audit: { target: string | null; probe: ProbeResult | null; pending: unknown[] }
}

export type RunOptions = {
  step: StepDefinition
  client: MigrationClient
  audit: MigrationAudit | null
  dataset: string
  apply: boolean
  revert?: boolean
  approval?: string | null
  readReport: (reportId: string) => StepReportSummary | null
  migrationId: string
  now?: () => Date
  /** The export to verify against (C10-6 S: before = export). Absent → the live state read at the start. */
  before?: readonly Doc[]
  beforeSource?: string
  /** The P′ export, for reverts that restore a pre-step value. */
  rollback?: readonly Doc[]
  project?: string
  acceptVersions?: boolean
  acceptLossy?: boolean
  /** Test seam for SANITY_MUTATION_MAX_BYTES. */
  limit?: number
  maxAttempts?: number
  log?: (line: string) => void
}

const groupOwner = (plan: StepPlan) => {
  const m = new Map<string, string>()
  for (const p of plan.projects) for (const g of p.groups) m.set(g.key, p.slug)
  return m
}

export async function runDataStep(o: RunOptions): Promise<StepReport> {
  const now = o.now ?? (() => new Date())
  const log = o.log ?? (() => {})
  const startedAt = now().toISOString()
  const mode: StepReport['mode'] = o.revert ? (o.apply ? 'revert' : 'revert-dry-run') : o.apply ? 'apply' : 'dry-run'
  const report: StepReport = {
    reportId: `${o.migrationId}${o.revert ? '-revert' : ''}${o.apply ? '' : '-dry-run'}`,
    kind: 'catalogue-data-step',
    step: o.step.step,
    label: STEP_LABEL[o.step.step],
    dataset: o.dataset,
    mode,
    migrationId: o.migrationId,
    approval: o.approval ?? null,
    beforeSource: o.beforeSource ?? (o.before ? 'export' : 'live (read at start)'),
    startedAt,
    finishedAt: startedAt,
    green: false,
    stoppedAt: null,
    error: null,
    itemCounts: idCounts([]),
    refusals: [],
    findings: [],
    projects: [],
    transactions: [],
    verification: null,
    audit: { target: o.audit?.target ?? null, probe: null, pending: [] },
  }
  const finish = (stoppedAt: StepReport['stoppedAt'], error: string | null = null) => {
    report.stoppedAt = stoppedAt
    report.error = error
    report.finishedAt = now().toISOString()
    report.green = stoppedAt === null && report.refusals.length === 0 && (report.verification?.pass ?? false) && report.audit.pending.length === 0
    return report
  }

  // 1. guard
  const guard = writeGuard({ dataset: o.dataset, apply: o.apply, mode: o.revert ? 'revert' : 'migrate', step: o.step.step, approval: o.approval, readReport: o.readReport })
  if (!guard.ok) {
    report.refusals.push({ step: o.step.step, code: guard.code, detail: guard.message })
    return finish('guard', guard.message)
  }
  assertClientDataset(o.client, o.dataset)

  // 2. live state + plan (the step's own pre-flight on live data)
  const ctx: StepContext = { now: startedAt, migrationId: o.migrationId, project: o.project, acceptVersions: o.acceptVersions }
  const planOf = (docs: readonly Doc[]) => (o.revert ? o.step.revert(docs, { ...ctx, rollback: o.rollback, acceptLossy: o.acceptLossy }) : o.step.plan(docs, ctx))
  let live = await o.client.readAll()
  const first = live
  report.itemCounts = idCounts(docsOfType(live, 'catalogueItem').filter((d) => !o.project || d.projectSlug === o.project))
  let plan = planOf(live)
  const preconditions = (docs: readonly Doc[]): Refusal[] =>
    o.revert
      ? []
      : catalogueProjects(docs)
          .filter((v) => !o.project || v.slug === o.project)
          .flatMap((v) => o.step.requires.filter((s) => !hasMarker(v.config, s)).map((s) => ({ step: o.step.step, code: 'precondition.markerMissing', project: v.slug, detail: { requires: s, note: `run and verify ${STEP_LABEL[s]} for this project first` } })))
  report.refusals.push(...plan.refusals, ...preconditions(live))
  report.findings.push(...plan.findings)
  report.projects = plan.projects.map((p) => ({ slug: p.slug, counts: p.counts, transactions: [], marker: null, audit: 'none' }))
  if (report.refusals.length) return finish('preflight', 'refusals — nothing was written')

  const before = o.before ?? first
  const outcome = (slug: string) => report.projects.find((p) => p.slug === slug)

  // 3. dry run
  if (!o.apply) {
    if (o.audit && !o.revert) {
      report.audit.probe = await o.audit.probe()
      if (!report.audit.probe.ok) report.findings.push({ step: o.step.step, code: `audit.${report.audit.probe.code}`, detail: report.audit.probe.message })
    }
    let sim: Doc[]
    try {
      sim = simulate(live, plan.projects.flatMap((p) => p.groups))
      for (const t of batchGroups(plan.projects.flatMap((p) => p.groups), { migrationId: o.migrationId, limit: o.limit }))
        report.transactions.push({ transactionId: t.transactionId, groups: t.groups, mutations: t.mutations.length })
    } catch (e) {
      return finish('mutate', e instanceof Error ? e.message : String(e))
    }
    report.verification = o.revert ? revertCheck(planOf(sim)) : o.step.verify(before, sim, ctx)
    if (!o.revert && report.verification.pass) {
      // What --apply would do next: the marker (kept if already set) and one audit row per project with work.
      for (const v of catalogueProjects(sim)) {
        const p = outcome(v.slug)
        if (!p) continue
        p.marker = hasMarker(v.config, o.step.step) ? String((v.config.catalogueMigrations as Record<string, unknown>)[o.step.step]) : startedAt
        p.audit = 'simulated'
      }
    }
    return finish(report.verification.pass ? null : 'verification')
  }

  // 4. apply: audit is required (K-2 / D-12) — before ANY mutation
  const projectIds = new Map<string, string>()
  if (!o.revert) {
    if (!o.audit) return finish('audit', 'audit is required for migrations: staging needs the Abluo Sandbox credentials in .env.sandbox.local, production the Abluo credentials in .env.local')
    report.audit.probe = await o.audit.probe()
    if (!report.audit.probe.ok) return finish('audit', report.audit.probe.message)
    for (const p of plan.projects) {
      const r = await o.audit.projectIdFor(p.slug)
      if ('id' in r) projectIds.set(p.slug, r.id)
      else {
        report.refusals.push({ step: o.step.step, code: `audit.project.${r.error}`, project: p.slug, detail: r.message })
      }
    }
    if (report.refusals.length) return finish('audit', 'Supabase project ids could not be resolved — nothing was written')
  }

  // 5. transactions
  let n = 1
  let attempts = 0
  const maxAttempts = o.maxAttempts ?? 3
  for (;;) {
    const owner = groupOwner(plan)
    let txns
    try {
      txns = batchGroups(plan.projects.flatMap((p) => p.groups), { migrationId: o.migrationId, limit: o.limit, startAt: n })
    } catch (e) {
      return finish('mutate', e instanceof Error ? e.message : String(e))
    }
    let conflicted = false
    for (const t of txns) {
      assertClientDataset(o.client, o.dataset)
      try {
        await o.client.mutate(t.mutations, { transactionId: t.transactionId })
      } catch (e) {
        if (e instanceof ConflictError) {
          conflicted = true
          log(`conflict in ${t.transactionId} (${e.id}) — re-reading and re-planning`)
          break
        }
        return finish('mutate', `${t.transactionId}: ${e instanceof Error ? e.message : String(e)}`)
      }
      n++
      report.transactions.push({ transactionId: t.transactionId, groups: t.groups, mutations: t.mutations.length })
      for (const g of t.groups) {
        const p = outcome(owner.get(g) ?? '')
        if (p && !p.transactions.includes(t.transactionId)) p.transactions.push(t.transactionId)
      }
      log(`committed ${t.transactionId} (${t.mutations.length} mutations)`)
    }
    if (!conflicted) break
    n++ // never reuse a transaction id
    if (++attempts >= maxAttempts) return finish('conflict', `still conflicting after ${attempts} attempts — re-run the step (it is idempotent)`)
    live = await o.client.readAll()
    plan = planOf(live)
    report.refusals.push(...plan.refusals)
    if (plan.refusals.length) return finish('preflight', 'refusals after re-reading — the remaining work was not written')
  }

  // 6. verification on the re-read state
  const after = await o.client.readAll()
  report.verification = o.revert ? revertCheck(planOf(after)) : o.step.verify(before, after, ctx)
  if (o.revert) return finish(report.verification.pass ? null : 'verification')

  // 7. markers — only after verification passed
  const markerTx = new Map<string, string>()
  if (report.verification.pass) {
    const views = catalogueProjects(after).filter((v) => !o.project || v.slug === o.project)
    const groups = views.map((v) => markerGroup(v, o.step.step, startedAt, report.refusals))
    if (report.refusals.length) return finish('preflight', 'marker could not be planned')
    for (const v of views) {
      const p = outcome(v.slug)
      if (p) p.marker = hasMarker(v.config, o.step.step) ? String((v.config.catalogueMigrations as Record<string, unknown>)[o.step.step]) : null
    }
    for (const t of batchGroups(groups, { migrationId: o.migrationId, limit: o.limit, startAt: n })) {
      assertClientDataset(o.client, o.dataset)
      try {
        await o.client.mutate(t.mutations, { transactionId: t.transactionId })
      } catch (e) {
        return finish('mutate', `marker ${t.transactionId}: ${e instanceof Error ? e.message : String(e)}`)
      }
      n++
      report.transactions.push({ transactionId: t.transactionId, groups: t.groups, mutations: t.mutations.length })
      for (const g of t.groups) {
        const slug = g.slice('marker:'.length)
        markerTx.set(slug, t.transactionId)
        const p = outcome(slug)
        if (p) {
          p.marker = startedAt
          p.transactions.push(t.transactionId)
        }
      }
    }
  }

  // 8. audit rows (after the Sanity commit, keyed by its transaction id)
  for (const p of report.projects) {
    const lastTx = markerTx.get(p.slug) ?? p.transactions[p.transactions.length - 1]
    if (!lastTx) continue // nothing written for this project in this run (idempotent re-run)
    const detail = o.step.auditDetail(p.slug, before, after, { ...ctx, verification: report.verification })
    if (!detail) continue
    const entry = migrationEntry(o.step.auditKind, { projectId: projectIds.get(p.slug)!, transactionId: lastTx, migrationId: o.migrationId, detail, occurredAt: now().toISOString() })
    const ok = await o.audit!.record(entry)
    p.audit = ok ? 'recorded' : 'failed'
    if (!ok) report.audit.pending.push(entry)
  }
  if (report.audit.pending.length) return finish('audit', 'audit rows could not be written after the commit — see audit.pending; re-record them before continuing')
  return finish(report.verification.pass ? null : 'verification')
}

/** A revert is verified by idempotency: planning it again on the result writes nothing. */
function revertCheck(plan: StepPlan): Verification {
  const left = plan.projects.flatMap((p) => p.groups.map((g) => g.key))
  return { pass: left.length === 0 && plan.refusals.length === 0, checks: [{ name: 'revert.complete', pass: left.length === 0, diffs: left }] }
}


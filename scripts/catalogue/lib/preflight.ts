// ── Catalogue rollout scripts — pre-flight (C10-6 steps P and P′) ─────────────
// Pure. In-memory dry runs of D1 → D2 → D3 → D4 over one snapshot (an export or
// the live dataset), each step planned on the state the previous simulated
// step left (markers included), each verified against its own before-state.
// Refusals are exactly the contract's stops; findings are what Tom reads but
// the contract already decides (D-15 multi-category, D-12 copy/drop plans).

import { batchGroups, simulate } from './mutations'
import { catalogueProjects, idClassOf, idCounts, docsOfType, type Doc } from './docs'
import { STEP_LABEL, markerGroup, type Finding, type Refusal, type StepContext, type StepDefinition, type Verification } from './step'
import { taxonomyStep } from './step-taxonomy'
import { commerceStep } from './step-commerce'
import { packHistoryStep } from './step-pack-history'
import { publicNameStep } from './step-public-name'

export const DATA_STEPS: readonly StepDefinition[] = [taxonomyStep, commerceStep, packHistoryStep, publicNameStep]

export type PreflightStepResult = {
  step: string
  label: string
  projects: { slug: string; counts: Record<string, number>; mutations: number }[]
  transactions: number
  refusals: Refusal[]
  findings: Finding[]
  verification: Verification
}

export type PreflightReport = {
  kind: 'catalogue-preflight'
  itemCounts: ReturnType<typeof idCounts>
  documentCounts: Record<string, number>
  projects: string[]
  steps: PreflightStepResult[]
  refusals: Refusal[]
  findings: Finding[]
  green: boolean
}

export function preflightAll(docs: readonly Doc[], opts: { now: string; project?: string; acceptVersions?: boolean; limit?: number }): PreflightReport {
  let state: Doc[] = [...docs]
  const steps: PreflightStepResult[] = []
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const versions = docs.filter((d) => idClassOf(d._id) === 'version' && (!opts.project || d.projectSlug === opts.project))
  if (versions.length && !opts.acceptVersions) refusals.push({ step: 'export', code: 'export.versionsPresent', detail: { ids: versions.map((d) => d._id) } })

  for (const step of DATA_STEPS) {
    const ctx: StepContext = { now: opts.now, migrationId: `${STEP_LABEL[step.step]}-preflight`, project: opts.project, acceptVersions: opts.acceptVersions }
    const plan = step.plan(state, ctx)
    const groups = plan.projects.flatMap((p) => p.groups)
    let transactions = 0
    let sim = state
    let verification: Verification
    try {
      transactions = batchGroups(groups, { migrationId: ctx.migrationId, limit: opts.limit }).length
      sim = simulate(state, groups)
      verification = step.verify(state, sim, ctx)
    } catch (e) {
      verification = { pass: false, checks: [{ name: 'simulation', pass: false, diffs: [e instanceof Error ? e.message : String(e)] }] }
    }
    const stepRefusals = [...plan.refusals]
    for (const c of verification.checks) if (!c.pass) stepRefusals.push({ step: step.step, code: `verification.${c.name}`, detail: c.diffs.slice(0, 20) })
    // Markers as the real run writes them after a passing verification, so the next step's preconditions hold.
    const markerRefusals: Refusal[] = []
    const markers = catalogueProjects(sim).filter((v) => !opts.project || v.slug === opts.project).map((v) => markerGroup(v, step.step, opts.now, markerRefusals))
    try {
      sim = simulate(sim, markers)
    } catch (e) {
      stepRefusals.push({ step: step.step, code: 'marker.simulation', detail: e instanceof Error ? e.message : String(e) })
    }
    stepRefusals.push(...markerRefusals)
    steps.push({
      step: step.step,
      label: STEP_LABEL[step.step],
      projects: plan.projects.map((p) => ({ slug: p.slug, counts: p.counts, mutations: p.groups.reduce((n, g) => n + g.mutations.length, 0) })),
      transactions,
      refusals: stepRefusals,
      findings: plan.findings,
      verification,
    })
    refusals.push(...stepRefusals)
    findings.push(...plan.findings)
    state = sim
  }
  const documentCounts: Record<string, number> = {}
  for (const d of docs) documentCounts[d._type] = (documentCounts[d._type] ?? 0) + 1
  return {
    kind: 'catalogue-preflight',
    itemCounts: idCounts(docsOfType(docs, 'catalogueItem').filter((d) => !opts.project || d.projectSlug === opts.project)),
    documentCounts,
    projects: catalogueProjects(docs).map((v) => v.slug),
    steps,
    refusals,
    findings,
    green: refusals.length === 0,
  }
}

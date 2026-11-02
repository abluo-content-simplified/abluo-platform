// ── D3 — appliedPreset → cataloguePackHistory (C7 D3, C10-6 D3) ───────────────
// Pure. Mapping: legacyPresetRecord (packs/history.ts — the same function the
// R1 reader uses for the virtual `bookshop@1` entry), so D3 only makes that
// entry permanent. In the same transaction: module config
// `setupCompletedAt = appliedAt`, `setupSource = 'pack'` where unset (D-14).
// `appliedPreset` is KEPT (inert until R3).

import { legacyPresetRecord, packHistoryId, readPackHistory } from '../../../src/lib/modules/catalogue/packs/history'
import { isSetupComplete, readSetupState } from '../../../src/lib/modules/catalogue/packs/setup-state'
import type { AppliedPackRecord } from '../../../src/lib/modules/catalogue/packs/types'
import { catalogueProjects, sameValue, unchangedExcept, type Doc } from './docs'
import { allowedFor, check, checksResult, configGroup, unmarkGroup, type Finding, type ProjectPlan, type Refusal, type StepContext, type StepDefinition, type StepPlan } from './step'
import { scoped } from './step-taxonomy'

/** The stored history entry (catalogueAppliedPack): `mapped` as rows, never a map (attribute-path budget). */
export function storedEntry(rec: AppliedPackRecord): Record<string, unknown> {
  return {
    _key: rec._key,
    _type: 'catalogueAppliedPack',
    id: rec.id,
    version: rec.version,
    appliedAt: rec.appliedAt,
    appliedBy: rec.appliedBy,
    added: rec.added,
    mapped: Object.entries(rec.mapped).map(([from, to]) => ({ _key: from.replace(/[^A-Za-z0-9_-]/g, '-'), from, to })),
    skipped: rec.skipped,
  }
}

const historyOf = (docs: readonly Doc[], slug: string) => docs.find((d) => d._id === packHistoryId(slug)) ?? null
const appliedOf = (doc: Doc | null) => (Array.isArray(doc?.applied) ? (doc!.applied as Record<string, unknown>[]) : [])

function setupPatch(config: Record<string, unknown>, appliedAt: string): Record<string, unknown> | null {
  if (isSetupComplete(config)) return null
  return { ...config, setupCompletedAt: appliedAt, ...(config.setupSource === undefined || config.setupSource === null || config.setupSource === '' ? { setupSource: 'pack' } : {}) }
}

function plan(docs: readonly Doc[], ctx: StepContext): StepPlan {
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const slug = view.slug
    const preset = view.config.appliedPreset
    if (preset === undefined || preset === null) {
      projects.push({ slug, groups: [], counts: { converted: 0 } })
      continue
    }
    const rec = legacyPresetRecord(preset)
    if (!rec) {
      refusals.push({ step: 'packHistory', code: 'packHistory.invalidPreset', project: slug, detail: preset })
      continue
    }
    if (!rec.appliedAt || Number.isNaN(Date.parse(rec.appliedAt))) refusals.push({ step: 'packHistory', code: 'packHistory.appliedAtInvalid', project: slug, detail: { appliedAt: rec.appliedAt } })
    const hist = historyOf(docs, slug)
    const applied = appliedOf(hist)
    const mutations: ProjectPlan['groups'][number]['mutations'] = []
    if (!applied.some((e) => e?._key === rec._key)) {
      mutations.push(
        hist
          ? { patch: { id: hist._id, ...(hist._rev ? { ifRevisionID: hist._rev } : {}), set: { applied: [...applied, storedEntry(rec)] } } }
          : { create: { _id: packHistoryId(slug), _type: 'cataloguePackHistory', projectSlug: slug, applied: [storedEntry(rec)] } },
      )
    } else findings.push({ step: 'packHistory', code: 'packHistory.alreadyConverted', project: slug, detail: { key: rec._key } })
    // Same transaction (C10-6 D3): setup completion where unset.
    const cfg = configGroup(view, `config:${slug}`, (config) => setupPatch(config, rec.appliedAt), refusals, 'packHistory')
    const group = { key: `pack:${slug}`, mutations: [...mutations, ...cfg.mutations] }
    projects.push({ slug, groups: group.mutations.length ? [group] : [], counts: { converted: mutations.length } })
  }
  return { step: 'packHistory', projects, refusals, findings }
}

function verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext) {
  const histDiffs: unknown[] = []
  const setupDiffs: unknown[] = []
  const afterViews = new Map(catalogueProjects(after).map((v) => [v.slug, v]))
  for (const view of catalogueProjects(before)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const rec = legacyPresetRecord(view.config.appliedPreset)
    const a = afterViews.get(view.slug)
    if (!rec || !a) continue
    // guard/legacy-preset against the real record: the history lists exactly the legacy record, now stored.
    const beforeApplied = appliedOf(historyOf(before, view.slug))
    const afterApplied = appliedOf(historyOf(after, view.slug))
    const history = readPackHistory({ applied: afterApplied, appliedPreset: a.config.appliedPreset })
    const entry = history.find((h) => h._key === rec._key)
    if (!entry || entry.source !== 'history') histDiffs.push({ project: view.slug, missing: rec._key })
    else {
      const { source: _s, ...stored } = entry
      void _s
      if (!sameValue(stored, rec) && !beforeApplied.some((e) => e?._key === rec._key)) histDiffs.push({ project: view.slug, expected: rec, got: stored })
    }
    const expectedKeys = [...new Set([...beforeApplied.map((e) => e?._key), rec._key])].sort()
    const gotKeys = afterApplied.map((e) => e?._key).sort()
    if (expectedKeys.join(',') !== gotKeys.join(',')) histDiffs.push({ project: view.slug, keys: { expected: expectedKeys, got: gotKeys } })
    if (!sameValue(view.config.appliedPreset, a.config.appliedPreset)) histDiffs.push({ project: view.slug, note: 'appliedPreset must be kept until R3' })
    if (!isSetupComplete(a.config)) setupDiffs.push({ project: view.slug, setup: readSetupState(a.config) })
    if (!isSetupComplete(view.config)) {
      const sourceWasUnset = view.config.setupSource === undefined || view.config.setupSource === null || view.config.setupSource === ''
      if (a.config.setupCompletedAt !== rec.appliedAt || (sourceWasUnset && a.config.setupSource !== 'pack'))
        setupDiffs.push({ project: view.slug, expected: { completedAt: rec.appliedAt, source: 'pack' }, got: readSetupState(a.config) })
    }
  }
  return checksResult([
    check('packHistory.legacyPreset', histDiffs),
    check('packHistory.setupComplete', setupDiffs),
    check('packHistory.unchangedElsewhere', unchangedExcept(scoped(before, ctx), scoped(after, ctx), allowedFor('packHistory', after, ctx.project))),
  ])
}

function revert(docs: readonly Doc[], ctx: StepContext): StepPlan {
  // C10-7 after D3: delete the cataloguePackHistory document (appliedPreset was kept).
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const hist = historyOf(docs, view.slug)
    const groups: ProjectPlan['groups'] = []
    if (hist) {
      const other = appliedOf(hist).filter((e) => e?.appliedBy !== 'migration')
      if (other.length) refusals.push({ step: 'packHistory', code: 'revert.historyHasPackApplications', project: view.slug, detail: { keys: other.map((e) => e?._key) } })
      else groups.push({ key: `pack:${view.slug}`, mutations: [{ delete: { id: hist._id } }] })
    }
    const unmark = unmarkGroup(view, 'packHistory', refusals)
    if (unmark.mutations.length) groups.push(unmark)
    projects.push({ slug: view.slug, groups, counts: { deleted: hist ? 1 : 0 } })
  }
  return { step: 'packHistory', projects, refusals, findings }
}

export const packHistoryStep: StepDefinition<'migration.pack_history'> = {
  step: 'packHistory',
  auditKind: 'migration.pack_history',
  requires: [],
  plan,
  verify,
  auditDetail(slug, before, _after, ctx) {
    const view = catalogueProjects(before).find((v) => v.slug === slug)
    const rec = legacyPresetRecord(view?.config.appliedPreset)
    return { migrationId: ctx.migrationId, converted: rec ? [{ packId: rec.id, packVersion: rec.version }] : [] }
  },
  revert,
}


// ── D3 — appliedPreset → cataloguePackHistory (C7 D3, C10-6 D3) ───────────────
// Pure. Mapping: legacyPresetRecord (packs/history.ts — the same function the
// R1 reader uses for the virtual `bookshop@1` entry), so D3 only makes that
// entry permanent. In the same transaction: module config
// `setupCompletedAt = appliedAt`, `setupSource = 'pack'` where unset (D-14).
// `appliedPreset` is KEPT (inert until R3).
//
// D-13 part 4 (C7.6, fixture image-shape/tmz-fallback): the legacy preset's
// image-shape fallback is replaced by module config BEFORE the field goes. Where
// the legacy preset gave a frame shape that `defaultItemProfile` would not
// (bookshop → portrait; tmz keeps `product` → landscape), D3 writes the hidden
// `itemImageShape` once, in the same patch, so items without a profile keep
// their frame — never a behaviour change. Revert keeps it (inert, and removing
// it would change the dashboard covers).

import { legacyPresetRecord, packHistoryId, readPackHistory } from '../../../src/lib/modules/catalogue/packs/history'
import { isSetupComplete, readSetupState } from '../../../src/lib/modules/catalogue/packs/setup-state'
import type { AppliedPackRecord } from '../../../src/lib/modules/catalogue/packs/types'
import { catalogueImageShape, isImageShape, type ImageShape } from '../../../src/lib/modules/catalogue/list-model'
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

/** The list-image frame each legacy preset gave items without a profile (the removed `presetId` fallback). */
export const LEGACY_PRESET_IMAGE_SHAPE: Readonly<Record<string, ImageShape>> = { bookshop: 'portrait' }

/** D-13 part 4: the explicit frame D3 must write, or null when module config already gives the legacy shape. */
export function imageShapeToWrite(config: Record<string, unknown>, presetId: string): ImageShape | null {
  const legacy = LEGACY_PRESET_IMAGE_SHAPE[presetId]
  if (!legacy || isImageShape(config.itemImageShape)) return null
  const fromConfig = catalogueImageShape({ defaultItemProfile: typeof config.defaultItemProfile === 'string' ? config.defaultItemProfile : null })
  return fromConfig === legacy ? null : legacy
}

function setupPatch(config: Record<string, unknown>, appliedAt: string, presetId: string): Record<string, unknown> | null {
  const shape = imageShapeToWrite(config, presetId)
  const complete = isSetupComplete(config)
  if (complete && !shape) return null
  return {
    ...config,
    ...(!complete && { setupCompletedAt: appliedAt, ...(config.setupSource === undefined || config.setupSource === null || config.setupSource === '' ? { setupSource: 'pack' } : {}) }),
    ...(shape && { itemImageShape: shape }),
  }
}

function plan(docs: readonly Doc[], ctx: StepContext): StepPlan {
  const refusals: Refusal[] = []
  const findings: Finding[] = []
  const projects: ProjectPlan[] = []
  for (const view of catalogueProjects(docs)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const slug = view.slug
    const preset = view.appliedPreset
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
    const cfg = configGroup(view, `config:${slug}`, (config) => setupPatch(config, rec.appliedAt, rec.id), refusals, 'packHistory')
    const group = { key: `pack:${slug}`, mutations: [...mutations, ...cfg.mutations] }
    projects.push({ slug, groups: group.mutations.length ? [group] : [], counts: { converted: mutations.length } })
  }
  return { step: 'packHistory', projects, refusals, findings }
}

function verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext) {
  const histDiffs: unknown[] = []
  const setupDiffs: unknown[] = []
  const shapeDiffs: unknown[] = []
  const afterViews = new Map(catalogueProjects(after).map((v) => [v.slug, v]))
  for (const view of catalogueProjects(before)) {
    if (ctx.project && view.slug !== ctx.project) continue
    const rec = legacyPresetRecord(view.appliedPreset)
    const a = afterViews.get(view.slug)
    if (!rec || !a) continue
    // guard/legacy-preset against the real record: the history lists exactly the legacy record, now stored.
    const beforeApplied = appliedOf(historyOf(before, view.slug))
    const afterApplied = appliedOf(historyOf(after, view.slug))
    const history = readPackHistory({ applied: afterApplied, appliedPreset: a.appliedPreset })
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
    if (!sameValue(view.appliedPreset, a.appliedPreset)) histDiffs.push({ project: view.slug, note: 'appliedPreset must be kept until R3' })
    // image-shape/tmz-fallback: items without a profile resolve to the same frame as the legacy preset gave.
    const legacyShape = LEGACY_PRESET_IMAGE_SHAPE[rec.id]
    if (legacyShape) {
      const got = catalogueImageShape({ defaultItemProfile: a.config.defaultItemProfile as string | null, itemImageShape: a.config.itemImageShape as string | null })
      if (got !== legacyShape) shapeDiffs.push({ project: view.slug, expected: legacyShape, got })
    }
    if (a.config.defaultItemProfile !== view.config.defaultItemProfile) shapeDiffs.push({ project: view.slug, note: 'defaultItemProfile must never change (D-13 part 3)' })
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
    check('packHistory.imageShape', shapeDiffs),
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
    const rec = legacyPresetRecord(view?.appliedPreset)
    return { migrationId: ctx.migrationId, converted: rec ? [{ packId: rec.id, packVersion: rec.version }] : [] }
  },
  revert,
}


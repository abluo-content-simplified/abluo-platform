// ── Catalogue rollout scripts — the data-step contract (C10-6) ────────────────
// Pure. Each data step D1–D4 is a StepDefinition: a planner (live state →
// mutation groups, refusals, findings), a verification (before, after → checks),
// the C12 audit payload, and a revert planner (C10-7). The runner (runner.ts)
// does the I/O around them; the pre-flight chains the planners in memory.

import type { CatalogueAuditKind, CatalogueAuditPayload } from '../../../src/lib/modules/catalogue/audit/events'
import { catalogueInstallation, catalogueProjects, type AllowedChanges, type Doc, type ProjectView } from './docs'
import { configPath, type MutationGroup } from './mutations'

export type StepName = 'taxonomy' | 'commerce' | 'packHistory' | 'publicName'
export const STEP_ORDER: readonly StepName[] = ['taxonomy', 'commerce', 'packHistory', 'publicName']
/** File/CLI label per step (migration ids, reports). */
export const STEP_LABEL: Record<StepName, string> = { taxonomy: 'd1-taxonomy', commerce: 'd2-commerce', packHistory: 'd3-pack-history', publicName: 'd4-public-name' }

/** A reason the run must stop (C10-6: "Any refusal → stop, Tom decides"). */
export type Refusal = { step: StepName | 'export' | 'import'; code: string; project?: string; id?: string; detail?: unknown }
/** Something Tom must read, but that the contract already decides (e.g. D-15 multi-category drafts). */
export type Finding = Refusal

export type ProjectPlan = {
  slug: string
  groups: MutationGroup[]
  counts: Record<string, number>
}

export type StepPlan = { step: StepName; projects: ProjectPlan[]; refusals: Refusal[]; findings: Finding[] }

export type Check = { name: string; pass: boolean; diffs: unknown[] }
export type Verification = { pass: boolean; checks: Check[] }

export type StepContext = {
  now: string
  migrationId: string
  /** Only this projectSlug (CLI --project). */
  project?: string
  /** versions.* documents mapped explicitly (REVIEW C-6). */
  acceptVersions?: boolean
}

export type RevertContext = StepContext & {
  /** The P′ export (rollback artefact): where a revert needs the pre-step value. */
  rollback?: readonly Doc[]
  acceptLossy?: boolean
}

export type MigrationAuditKind = Extract<CatalogueAuditKind, 'migration.taxonomy' | 'migration.commerce' | 'migration.pack_history' | 'public_name.migrated'>

export type StepDefinition<K extends MigrationAuditKind = MigrationAuditKind> = {
  step: StepName
  auditKind: K
  /** Markers that must be set on the project before this step may write (C10-6 preconditions). */
  requires: readonly StepName[]
  plan(docs: readonly Doc[], ctx: StepContext): StepPlan
  verify(before: readonly Doc[], after: readonly Doc[], ctx: StepContext): Verification
  /** C12 payload for one project, from the before/after state (so a resumed run records the same thing). null = nothing to record. */
  auditDetail(slug: string, before: readonly Doc[], after: readonly Doc[], ctx: StepContext & { verification: Verification }): CatalogueAuditPayload[K] | null
  revert(docs: readonly Doc[], ctx: RevertContext): StepPlan
}

export const checksResult = (checks: Check[]): Verification => ({ pass: checks.every((c) => c.pass), checks })
export const check = (name: string, diffs: unknown[]): Check => ({ name, pass: diffs.length === 0, diffs: diffs.slice(0, 200) })

// ── module config writes (one function for the published and the draft copy) ──

/**
 * A group that rewrites the Catalogue installation's `config` on every copy of the
 * project document (published + draft) with the same pure function, each guarded by
 * its own revision. `next` returns null for "no change".
 */
export function configGroup(view: ProjectView, key: string, next: (config: Record<string, unknown>, doc: Doc) => Record<string, unknown> | null, refusals: Refusal[], step: StepName): MutationGroup {
  const mutations: MutationGroup['mutations'] = []
  for (const doc of view.docs) {
    const inst = catalogueInstallation(doc)
    if (!inst) continue
    const cfg = next(inst.config, doc)
    if (cfg === null) continue
    if (!inst.key) {
      refusals.push({ step, code: 'project.installationWithoutKey', project: view.slug, id: doc._id })
      continue
    }
    mutations.push({ patch: { id: doc._id, ...(doc._rev ? { ifRevisionID: doc._rev } : {}), set: { [configPath(inst.key)]: cfg } } })
  }
  return { key, mutations }
}

export const markersOf = (config: Record<string, unknown>): Record<string, unknown> =>
  config.catalogueMigrations && typeof config.catalogueMigrations === 'object' && !Array.isArray(config.catalogueMigrations) ? (config.catalogueMigrations as Record<string, unknown>) : {}

export const hasMarker = (config: Record<string, unknown>, step: StepName) => typeof markersOf(config)[step] === 'string' && (markersOf(config)[step] as string) !== ''

/** The marker write (C10-6 "Per-project migration markers"): only after verification; never overwrites an earlier timestamp. */
export function markerGroup(view: ProjectView, step: StepName, now: string, refusals: Refusal[]): MutationGroup {
  return configGroup(view, `marker:${view.slug}`, (config) => (hasMarker(config, step) ? null : { ...config, catalogueMigrations: { ...markersOf(config), [step]: now } }), refusals, step)
}

/** The config without this step's marker (pure; null = no marker). */
export function withoutMarker(config: Record<string, unknown>, step: StepName): Record<string, unknown> | null {
  if (!hasMarker(config, step)) return null
  const { [step]: _drop, ...rest } = markersOf(config)
  void _drop
  return { ...config, catalogueMigrations: rest }
}

/**
 * Revert of the marker (C10-7 data reverts leave no marker behind), composed with the
 * step's own config revert so ONE patch rewrites the config (two whole-config patches
 * computed from the same state would undo each other).
 */
export function unmarkGroup(view: ProjectView, step: StepName, refusals: Refusal[], revertConfig?: (config: Record<string, unknown>) => Record<string, unknown> | null): MutationGroup {
  return configGroup(
    view,
    `config:${view.slug}`,
    (config) => {
      const reverted = revertConfig?.(config) ?? null
      const base = reverted ?? config
      return withoutMarker(base, step) ?? reverted
    },
    refusals,
    step,
  )
}

/** A patch guarded by the document's revision (draft and published each carry their own). */
export const guardedPatch = (doc: Doc, body: { set?: Record<string, unknown>; unset?: string[] }) => ({
  patch: { id: doc._id, ...(doc._rev ? { ifRevisionID: doc._rev } : {}), ...body },
})

// ── what each step may change (the "nothing else changed" check) ─────────────

/** The fields each data step writes. Everything else must stay byte-equal (system fields and `_weak` aside). */
export const STEP_CHANGES: Record<StepName, AllowedChanges> = {
  taxonomy: { itemFields: ['primaryCategory', 'additionalCategories'], configKeys: ['catalogueMigrations'], docIdPrefixes: ['catalogue-taxonomy.'] },
  commerce: { itemFields: ['formats', 'channelAvailability'], configKeys: ['catalogueMigrations', 'serviceChannels'] },
  packHistory: { configKeys: ['catalogueMigrations', 'setupCompletedAt', 'setupSource'], docIdPrefixes: ['catalogue-packs.'] },
  publicName: { configKeys: ['catalogueMigrations', 'publicName', 'navLabel'] },
}

/**
 * Allowed changes when verifying `step` against an export taken before the WHOLE
 * plan (C10-6 S: before = export): this step's fields plus those of every step
 * whose marker the after-state already carries (they ran and were verified).
 */
export function allowedFor(step: StepName, after: readonly Doc[], project?: string): AllowedChanges {
  const ran = new Set<StepName>([step])
  for (const v of catalogueProjects(after)) if (!project || v.slug === project) for (const s of STEP_ORDER) if (hasMarker(v.config, s)) ran.add(s)
  const pick = (k: keyof AllowedChanges) => [...new Set([...ran].flatMap((s) => STEP_CHANGES[s][k] ?? []))]
  return { itemFields: pick('itemFields'), configKeys: pick('configKeys'), docIdPrefixes: pick('docIdPrefixes') }
}

// ── Catalogue migration markers at installation (C10-6 step 7) ───────────────
//
// "Projects created after R2 are born migrated (the install flow writes the
// markers)." A NEW Catalogue installation has no legacy data at all: its
// categories are written by CatalogueTaxonomyService into the taxonomy
// document and its items by the R2 writers (formats + primary/additional),
// so the taxonomy and commerce data steps (D1, D2) have nothing to do and the
// model-dependent readiness rules apply from the first item (C6 §6.13 item 2).
//
// Pure. The installation flow (Studio Modules pane, first enable only) merges
// this into the new installation's config; an existing installation is never
// touched — its markers are written only by the verified data steps.

import type { CatalogueMigrationState } from './schema-commerce'

export const CATALOGUE_MIGRATION_MARKERS_TYPE = 'catalogueMigrationMarkers'

/** The markers a brand-new Catalogue installation is born with: taxonomy + commerce, stamped now. */
export function bornMigratedMarkers(now: Date): CatalogueMigrationState & { _type: typeof CATALOGUE_MIGRATION_MARKERS_TYPE } {
  const at = now.toISOString()
  return { _type: CATALOGUE_MIGRATION_MARKERS_TYPE, taxonomy: at, commerce: at }
}

/** Config a module's FIRST installation adds on top of what the admin entered (only the Catalogue has any). */
export function installTimeConfig(moduleId: string, now: Date): Record<string, unknown> {
  return moduleId === 'catalogue' ? { catalogueMigrations: bornMigratedMarkers(now) } : {}
}

// ── Migration-pending guard (R2 ships before data steps D1–D4 run) ──────────
//
// While a project's data still awaits a verified data step (its marker in
// `catalogueMigrations` is missing), Setup must not change what that step
// depends on:
//   * commerce (D2): channel add / activate / default changes — D2 converts the
//     items' legacy offers using the channel list as stored. Pending when the
//     marker is missing AND there is something for D2 to convert: stored
//     channels, or items that still carry legacy `offers` without `formats`
//     (also with zero channels).
//   * publicName (D4): the legacy `navLabel` is still the current name. Setup
//     shows it and writes `publicName` + unsets `navLabel` in one patch, so D4
//     later finds the project migrated.
// Pure; the services read the facts and decide with this one function.

export type MigrationPendingStep = 'commerce' | 'publicName'
export type MigrationPendingFacts = {
  /** Item documents (drafts included) with legacy `offers` and no `formats`. */
  unconvertedOfferItems?: number
}

const markerSet = (config: Record<string, unknown> | null | undefined, step: MigrationPendingStep): boolean => {
  const m = config?.catalogueMigrations
  const v = m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>)[step] : undefined
  return typeof v === 'string' && v.trim() !== ''
}

const nonEmptyLabel = (v: unknown): boolean =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v as Record<string, unknown>).some(([k, x]) => !k.startsWith('_') && k !== 'translationStatus' && typeof x === 'string' && x.trim() !== '')

/** True while the data step `step` has not run for this project and Setup must wait for (or carry) it. */
export function migrationPending(config: Record<string, unknown> | null | undefined, step: MigrationPendingStep, facts: MigrationPendingFacts = {}): boolean {
  if (markerSet(config, step)) return false
  if (step === 'publicName') return nonEmptyLabel(config?.navLabel)
  const channels = Array.isArray(config?.serviceChannels) ? (config!.serviceChannels as unknown[]).filter((c) => c && typeof c === 'object').length : 0
  return channels > 0 || (facts.unconvertedOfferItems ?? 0) > 0
}

/** Rows `{ formats?, offers? }` that still carry legacy offers and no formats (the D2 work left). */
export function unconvertedOfferItems(rows: readonly { formats?: unknown; offers?: unknown }[]): number {
  return rows.filter((r) => Array.isArray(r.offers) && r.offers.some((o) => o !== null && o !== undefined) && !(Array.isArray(r.formats) && r.formats.length > 0)).length
}

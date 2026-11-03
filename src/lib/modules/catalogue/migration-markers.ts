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

/**
 * Migration 004 — Typed module installations
 *
 * ADR-020 Decision 1. Supersedes migration 002 (002-module-installations.ts),
 * which was written for ADR-011 Phase B1 and was never applied to the
 * production dataset — a pre-flight query on 2026-08-14 found
 * `moduleInstallations` null on every project document.
 *
 * Why 002 cannot simply be run now
 * --------------------------------
 * Two things changed under it:
 *
 * 1. `moduleInstallations` is no longer an array of anonymous objects. ADR-020
 *    generates one member type per module (`${camelId}ModuleInstallation`, see
 *    src/lib/modules/config-schema.ts), so every array member must carry a
 *    `_type` discriminator. Members written without one do not resolve in the
 *    Studio.
 * 2. The Forms module shipped after 002 was written and is absent from its
 *    hardcoded KNOWN_MODULE_VERSIONS map — livener-main has "forms" in
 *    enabledModules, so running 002 would silently drop it as "unknown".
 *
 * What this migration does
 * ------------------------
 * For every project document with a legacy `enabledModules: string[]`, writes
 * the equivalent typed `moduleInstallations` array:
 *
 *   _type       → `${camelId}ModuleInstallation` for that module
 *   _key        → stable, derived from the module id
 *   moduleId    → the string value
 *   version     → snapshot below (see VERSION NOTE)
 *   enabled     → true (the legacy array only ever listed enabled modules)
 *   installedAt → ISO 8601 timestamp of when this migration ran
 *   config      → {} — populated per module by migration 005
 *   provenance  → 'auto'
 *
 * `enabledModules` is NOT removed. It stays as a rollback bridge until the
 * dual-source read is retired and production has been promoted; removing the
 * legacy array and the code that reads it in one step would leave no way back.
 *
 * Idempotent: a project that already has a populated `moduleInstallations` is
 * skipped, so this is safe to re-run.
 *
 * VERSION NOTE: module versions are hardcoded, matching migration 002's
 * reasoning. A migration snapshots the state at the time it ran; importing the
 * live registry would carry whatever version the registry declares *today*
 * rather than the version that was installed when the migration ran.
 *
 * PRE-FLIGHT QUERY (run before applying):
 *   *[_type == "project"]{_id, projectSlug, enabledModules, moduleInstallations}
 *
 * Results at migration time (2026-08-14, dataset `production`):
 *   livener-main         → ["blog", "events", "live", "forms"]
 *   studiomartegani-main → ["blog"]
 *   abluo                → no enabledModules (two published docs share this
 *                          slug — see the duplicate-project note below)
 *
 * DUPLICATE PROJECT NOTE: two published `project` documents carry
 * projectSlug "abluo" (_id 38cf9381-… and 5bae4e91-…). Neither has
 * enabledModules, so this migration does not touch either. It is flagged
 * because any per-project write keyed on projectSlug rather than _id is
 * ambiguous for that slug until the duplicate is resolved.
 *
 * Run once, dry-run first:
 *   npx tsx src/lib/sanity/migrations/004-typed-module-installations.ts
 *   npx tsx src/lib/sanity/migrations/004-typed-module-installations.ts --apply
 *
 * Prerequisites:
 *   SANITY_API_TOKEN with write access, NEXT_PUBLIC_SANITY_PROJECT_ID,
 *   NEXT_PUBLIC_SANITY_DATASET.
 */

import { createClient } from '@sanity/client'

const DRY_RUN = !process.argv.includes('--apply')

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_TOKEN ?? '',
  useCdn: false,
})

// ─── Module snapshot ──────────────────────────────────────────────────────────
// Hardcoded at migration time. Do not replace with a live registry import.
// See VERSION NOTE in the file header.
//
// `installationType` mirrors moduleInstallationTypeName() in
// src/lib/modules/config-schema.ts. It is duplicated here rather than imported
// for the same reason the versions are: a migration must keep producing the
// shape it was written against, even if the generator's naming later changes.

const KNOWN_MODULES: Record<string, { version: string; installationType: string }> = {
  blog:   { version: '1.0.0', installationType: 'blogModuleInstallation' },
  events: { version: '1.0.0', installationType: 'eventsModuleInstallation' },
  live:   { version: '1.0.0', installationType: 'liveModuleInstallation' },
  forms:  { version: '1.0.0', installationType: 'formsModuleInstallation' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectDocument {
  _id: string
  projectSlug?: string
  enabledModules?: string[]
  moduleInstallations?: unknown[]
}

interface TypedModuleInstallation {
  _type: string
  _key: string
  moduleId: string
  version: string
  enabled: boolean
  installedAt: string
  config: Record<string, unknown>
  provenance: 'admin' | 'auto'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nMigration 004 — Typed module installations (ADR-020)`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`)
  console.log(`Dataset: ${client.config().dataset ?? 'unknown'}`)
  console.log('')

  const projects = await client.fetch<ProjectDocument[]>(
    `*[_type == "project" && defined(enabledModules) && !(_id in path("drafts.**"))]{
      _id,
      projectSlug,
      enabledModules,
      moduleInstallations
    }`
  )

  if (projects.length === 0) {
    console.log('No projects with enabledModules found. Nothing to migrate.')
    return
  }

  console.log(`Found ${projects.length} project(s) with enabledModules:\n`)

  const installedAt = new Date().toISOString()
  let migrated = 0
  let skippedAlreadyMigrated = 0
  let unknownModules = 0

  for (const project of projects) {
    const id = project.projectSlug ?? project._id

    // Idempotency: never overwrite installations that already exist. Doing so
    // would discard any config an admin has since set in the Modules pane.
    if (project.moduleInstallations && project.moduleInstallations.length > 0) {
      console.log(
        `  [SKIP]     ${id} — already has ${project.moduleInstallations.length} moduleInstallations record(s)`
      )
      skippedAlreadyMigrated++
      continue
    }

    const installations: TypedModuleInstallation[] = []
    const skipped: string[] = []

    for (const moduleId of project.enabledModules ?? []) {
      const known = KNOWN_MODULES[moduleId]
      if (!known) {
        console.warn(
          `  [UNKNOWN]  ${id} — module id "${moduleId}" is not in KNOWN_MODULES. Skipping.`
        )
        skipped.push(moduleId)
        unknownModules++
        continue
      }

      installations.push({
        _type: known.installationType,
        // Stable key derived from the module id: one installation per module
        // per project, so the module id is already unique within the array.
        // A stable key means re-running against a partially-written array
        // replaces rather than duplicates.
        _key: `module-${moduleId}`,
        moduleId,
        version: known.version,
        enabled: true,
        installedAt,
        config: {},
        provenance: 'auto',
      })
    }

    const summary = installations.map((i) => `${i.moduleId}@${i.version}`).join(', ')
    const skipNote = skipped.length > 0 ? ` [skipped: ${skipped.join(', ')}]` : ''

    if (DRY_RUN) {
      console.log(
        `  [DRY RUN]  ${id} → would write ${installations.length} installation(s): ${summary}${skipNote}`
      )
    } else {
      await client.patch(project._id).set({ moduleInstallations: installations }).commit()
      console.log(
        `  [MIGRATED] ${id} → wrote ${installations.length} installation(s): ${summary}${skipNote}`
      )
    }

    migrated++
  }

  console.log('')
  console.log(`Summary:`)
  console.log(`  Projects to migrate:          ${migrated}`)
  console.log(`  Already migrated (skipped):   ${skippedAlreadyMigrated}`)
  console.log(`  Unknown module IDs (skipped): ${unknownModules}`)

  if (DRY_RUN && migrated > 0) {
    console.log(`\nDry run complete. Run with --apply to write changes.`)
  } else if (!DRY_RUN && migrated > 0) {
    console.log(`\nMigration complete. Verify with:`)
    console.log(`  *[_type == "project"]{_id, projectSlug, moduleInstallations}`)
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

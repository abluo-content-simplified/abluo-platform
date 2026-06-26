/**
 * Migration 002 — Convert enabledModules to moduleInstallations
 *
 * ADR-011 Phase B1.
 *
 * For every project document that has an enabledModules: string[] array, this
 * migration writes a moduleInstallations: ModuleInstallation[] array alongside
 * it. enabledModules is NOT removed — it remains as a data bridge during the
 * transition window and for rollback purposes (see the Phase B1 roadmap entry).
 *
 * Each string entry in enabledModules becomes a full ModuleInstallation record:
 *   moduleId    → the string value
 *   version     → hardcoded to the manifest version at migration time (see note below)
 *   enabled     → true
 *   installedAt → ISO 8601 timestamp of when the migration ran
 *   config      → {}
 *   provenance  → 'auto'
 *
 * If enabledModules contains an id not in KNOWN_MODULE_VERSIONS (an unknown
 * module), the entry is skipped and logged — it is not written to
 * moduleInstallations. This matches the roadmap's "skip with a log entry"
 * requirement.
 *
 * VERSION NOTE: Module versions are intentionally hardcoded. A migration's job
 * is to snapshot the state at the time it ran. Importing the live registry would
 * carry forward whatever version the registry currently declares rather than the
 * version that was installed when the migration ran. Hardcoded values are the
 * correct approach for a one-time migration.
 *
 * PRE-FLIGHT QUERY (run before applying):
 *   *[_type == "project" && defined(enabledModules)]{_id, projectSlug, enabledModules}
 *
 * Results at migration time (2026-06-26):
 *   livener-main       → ["blog", "events", "live"]
 *   studiomartegani-main → ["blog"]
 *   All IDs are valid MODULE_REGISTRY entries — no unknown modules.
 *
 * Run once, dry-run first:
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/002-module-installations.ts
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/002-module-installations.ts --apply
 *
 * Prerequisites:
 *   SANITY_API_TOKEN must be set in your environment (token with write access).
 *   NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET must be set.
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

// ─── Module versions ──────────────────────────────────────────────────────────
// Hardcoded at migration time. Do not replace with a live registry import.
// See VERSION NOTE in the file header.

const KNOWN_MODULE_VERSIONS: Record<string, string> = {
  blog: '1.0.0',
  events: '1.0.0',
  live: '1.0.0',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectDocument {
  _id: string
  projectSlug: string
  enabledModules: string[]
  moduleInstallations?: ModuleInstallationRecord[]
}

interface ModuleInstallationRecord {
  _key: string         // Sanity requires a _key on array members
  moduleId: string
  version: string
  enabled: boolean
  installedAt: string
  config: Record<string, unknown>
  provenance: 'admin' | 'auto'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nMigration 002 — Convert enabledModules to moduleInstallations`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`)
  console.log(`Dataset: ${client.config().dataset ?? 'unknown'}`)
  console.log('')

  // Fetch all projects with enabledModules. Include already-migrated projects
  // so we can detect and skip them gracefully.
  const projects = await client.fetch<ProjectDocument[]>(
    `*[_type == "project" && defined(enabledModules)]{
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

    // Skip if moduleInstallations already exists and is populated.
    // This makes the migration idempotent — safe to re-run.
    if (project.moduleInstallations && project.moduleInstallations.length > 0) {
      console.log(`  [SKIP]    ${id} — already has ${project.moduleInstallations.length} moduleInstallations record(s)`)
      skippedAlreadyMigrated++
      continue
    }

    const installations: ModuleInstallationRecord[] = []
    const skipped: string[] = []

    for (const moduleId of project.enabledModules) {
      const version = KNOWN_MODULE_VERSIONS[moduleId]
      if (!version) {
        console.warn(`  [UNKNOWN] ${id} — module id "${moduleId}" is not in KNOWN_MODULE_VERSIONS. Skipping.`)
        skipped.push(moduleId)
        unknownModules++
        continue
      }

      installations.push({
        _key: `${moduleId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        moduleId,
        version,
        enabled: true,
        installedAt,
        config: {},
        provenance: 'auto',
      })
    }

    const summary = installations.map((i) => `${i.moduleId}@${i.version}`).join(', ')
    const skipNote = skipped.length > 0 ? ` [skipped: ${skipped.join(', ')}]` : ''

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${id} → would write ${installations.length} installation(s): ${summary}${skipNote}`)
    } else {
      await client
        .patch(project._id)
        .set({ moduleInstallations: installations })
        .commit()
      console.log(`  [MIGRATED] ${id} → wrote ${installations.length} installation(s): ${summary}${skipNote}`)
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
    console.log(`\nMigration complete. Verify in Sanity Studio or via:`)
    console.log(`  *[_type == "project" && defined(moduleInstallations)]{_id, projectSlug, moduleInstallations}`)
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

/**
 * Migration 006 — Install the Gallery module where galleries exist (ADR-022)
 *
 * (005 is the number ADR-020 reserved for the module-config backfill; it is
 * left free on purpose.)
 *
 * Why this must run BEFORE the ADR-022 code reaches an environment
 * ----------------------------------------------------------------
 * ADR-022 moves photoGallerySection into the new Gallery module, and module
 * sections are gated on installation (isSectionTypeAvailable). A project that
 * already shows a gallery but has no `gallery` installation would silently lose
 * that section the moment the new code deploys.
 *
 * Running it first is safe: the code in production today reads
 * `moduleInstallations[enabled != false].moduleId` and ignores ids it does not
 * know, so an early `gallery` entry changes nothing until the new code lands.
 * (The Studio of the old build shows the entry as an unknown type until then —
 * cosmetic, and gone after the deploy.)
 *
 * What it does
 * ------------
 * For every project that owns at least one `gallery` document, appends a typed
 * `galleryModuleInstallation` entry — unless one is already there. Drafts of
 * those project documents are patched too, so publishing an older draft cannot
 * drop the installation again. It never rewrites the array and never touches
 * another module's entry.
 *
 * PRE-FLIGHT (2026-09-28, dataset production): galleries exist for
 *   hoffmann (4, one used on the home page), studiomartegani (1, team page),
 *   tmz (1, unused). None of the three has a gallery installation.
 *
 * Run, dry-run first (tsx reads .env.local with --env-file):
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/006-install-gallery-module.ts
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/006-install-gallery-module.ts --apply
 *
 * Prerequisites: SANITY_API_WRITE_TOKEN (or SANITY_API_TOKEN) with write access,
 * NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET — all in .env.local.
 */

import { createClient } from '@sanity/client'

const DRY_RUN = !process.argv.includes('--apply')

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  // .env.local names it SANITY_API_WRITE_TOKEN; older scripts used SANITY_API_TOKEN.
  token: process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_TOKEN ?? '',
  useCdn: false,
})

// Snapshot, not a registry import — see the VERSION NOTE in migration 004.
const MODULE_ID = 'gallery'
const VERSION = '1.0.0'
const INSTALLATION_TYPE = 'galleryModuleInstallation'

interface ProjectDocument {
  _id: string
  projectSlug?: string
  installed: boolean
}

async function run() {
  console.log(`\nMigration 006 — Install the Gallery module (ADR-022)`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`)
  console.log(`Dataset: ${client.config().dataset ?? 'unknown'}\n`)

  const slugs = await client.fetch<string[]>(
    `array::unique(*[_type == "gallery" && defined(projectSlug) && !(_id in path("drafts.**"))].projectSlug)`
  )
  if (slugs.length === 0) {
    console.log('No galleries found. Nothing to install.')
    return
  }

  // Published AND draft project documents for those slugs.
  const projects = await client.fetch<ProjectDocument[]>(
    `*[_type == "project" && projectSlug in $slugs]{
      _id,
      projectSlug,
      "installed": count(moduleInstallations[moduleId == $moduleId]) > 0
    }`,
    { slugs, moduleId: MODULE_ID }
  )

  const installedAt = new Date().toISOString()
  let written = 0
  for (const p of projects) {
    const label = `${p.projectSlug ?? '?'} (${p._id})`
    if (p.installed) {
      console.log(`  [SKIP]     ${label} — already installed`)
      continue
    }
    const entry = {
      _type: INSTALLATION_TYPE,
      _key: `module-${MODULE_ID}`,
      moduleId: MODULE_ID,
      version: VERSION,
      enabled: true,
      installedAt,
      config: {},
      provenance: 'auto',
    }
    if (DRY_RUN) {
      console.log(`  [DRY RUN]  ${label} → would append ${MODULE_ID}@${VERSION}`)
    } else {
      await client
        .patch(p._id)
        .setIfMissing({ moduleInstallations: [] })
        .append('moduleInstallations', [entry])
        .commit()
      console.log(`  [INSTALLED] ${label} → ${MODULE_ID}@${VERSION}`)
    }
    written++
  }

  const missing = slugs.filter((s) => !projects.some((p) => p.projectSlug === s))
  if (missing.length) console.warn(`\n  [WARN] galleries exist for slugs with no project document: ${missing.join(', ')}`)

  console.log(`\n${DRY_RUN ? 'Would install' : 'Installed'} on ${written} project document(s).`)
  if (!DRY_RUN) console.log(`Verify: *[_type == "project"]{projectSlug, "mods": moduleInstallations[].moduleId}`)
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

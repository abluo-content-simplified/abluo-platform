/**
 * Migration 009 — Install the People module (ADR-043)
 *
 * ⚠ NOT RUN. Dry-run by default; Tom decides when and where.
 *
 * Why this is not "run before the deploy" like 006/007
 * ----------------------------------------------------
 * Nothing that renders today moves into the People module: teamSection stays
 * a platform section, posts keep their `author`, events their inline `hosts`
 * (ADR-043 D10.1 — readers prefer the new refs and fall back to the old data).
 * So no site loses anything when this code deploys without the installation.
 * The module is installed PER PROJECT when that project starts using People —
 * in the order of D10.3: CYCE first, then Studio Martegani, then the rest.
 *
 * What it does
 * ------------
 * Installs `people` on the projects named with --projects=a,b (and, so a
 * project that already has people can never lose them, on every project that
 * already holds a `person` document, re-queried at run time). For each it
 * appends a typed `peopleModuleInstallation` entry — unless one is already
 * there — to the published project document and to its draft, if any, so
 * publishing an older draft cannot drop it. It never rewrites the array and
 * never touches another module's entry. `config` starts empty: no profile
 * pages until a profileSegment is set (Studio → Modules → People).
 *
 * Run, dry-run first (tsx reads .env.local with --env-file):
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/009-install-people-module.ts --projects=cyce
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/009-install-people-module.ts --projects=cyce --apply
 *
 * Prerequisites: SANITY_API_WRITE_TOKEN (or SANITY_API_TOKEN) with write access,
 * NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET — all in .env.local.
 * Supabase migration 063 (person_private) is separate: without it the module
 * works, only private details cannot be stored yet.
 */

import { createClient } from '@sanity/client'

const DRY_RUN = !process.argv.includes('--apply')
const PROJECTS_ARG = process.argv.find((a) => a.startsWith('--projects='))
const REQUESTED = (PROJECTS_ARG?.slice('--projects='.length) ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN ?? process.env.SANITY_API_TOKEN ?? '',
  useCdn: false,
  // Drafts too: a draft person still means the project uses People.
  perspective: 'raw',
})

// Snapshot, not a registry import — see the VERSION NOTE in migration 004.
const MODULE_ID = 'people'
const VERSION = '1.0.0'
const INSTALLATION_TYPE = 'peopleModuleInstallation'

interface ProjectDocument {
  _id: string
  projectSlug?: string
  installed: boolean
}

async function run() {
  console.log(`\nMigration 009 — Install the People module (ADR-043)`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`)
  console.log(`Dataset: ${client.config().dataset ?? 'unknown'}\n`)

  const withPeople = await client.fetch<string[]>(
    `array::unique(*[_type == "person" && defined(projectSlug) && !(_id in path("versions.**"))].projectSlug)`
  )
  console.log(`  Requested:        ${REQUESTED.join(', ') || '—'}`)
  console.log(`  Already have people: ${withPeople.join(', ') || '—'}\n`)

  const slugs = [...new Set([...REQUESTED, ...withPeople])].sort()
  if (slugs.length === 0) {
    console.log('Nothing to install. Name projects with --projects=cyce,studiomartegani')
    return
  }

  const projects = await client.fetch<ProjectDocument[]>(
    `*[_type == "project" && projectSlug in $slugs && !(_id in path("versions.**"))]{
      _id,
      projectSlug,
      "installed": count(moduleInstallations[moduleId == $moduleId]) > 0
    } | order(projectSlug asc, _id asc)`,
    { slugs, moduleId: MODULE_ID }
  )

  const installedAt = new Date().toISOString()
  let written = 0
  for (const p of projects) {
    const label = `${p.projectSlug ?? '?'} (${p._id})`
    if (p.installed) {
      console.log(`  [SKIP]      ${label} — already installed`)
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
      console.log(`  [DRY RUN]   ${label} → would append ${MODULE_ID}@${VERSION}`)
    } else {
      await client.patch(p._id).setIfMissing({ moduleInstallations: [] }).append('moduleInstallations', [entry]).commit()
      console.log(`  [INSTALLED] ${label} → ${MODULE_ID}@${VERSION}`)
    }
    written++
  }

  const missing = slugs.filter((s) => !projects.some((p) => p.projectSlug === s))
  if (missing.length) console.warn(`\n  [WARN] no project document for: ${missing.join(', ')}`)

  console.log(`\n${DRY_RUN ? 'Would install' : 'Installed'} on ${written} project document(s).`)
  if (!DRY_RUN) console.log(`Verify: *[_type == "project"]{projectSlug, "mods": moduleInstallations[].moduleId}`)
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

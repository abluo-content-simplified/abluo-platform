/**
 * Migration 007 — Install the FAQ module where FAQs exist (ADR-037)
 *
 * Why this must run BEFORE the ADR-037 code reaches an environment
 * ----------------------------------------------------------------
 * ADR-037 moves faqSection into the new FAQ module, and module sections are
 * gated on installation (isSectionTypeAvailable). A project that shows an FAQ
 * section but has no `faq` installation would silently lose that section —
 * and its FAQPage structured data — the moment the new code deploys. The
 * imported Hoffmann post FAQs likewise render only where the module is on.
 *
 * Running it first is safe: the code in production today reads
 * `moduleInstallations[enabled != false].moduleId` and ignores ids it does not
 * know, so an early `faq` entry changes nothing until the new code lands.
 * (The Studio of the old build shows the entry as an unknown type until then —
 * cosmetic, and gone after the deploy.) Same pattern as migration 006.
 *
 * What it does
 * ------------
 * Re-queries the dataset AT RUN TIME for every project that has
 *   - an faqSection on any document with sections (pages, legacy home pages,
 *     module pages), or
 *   - a post with the imported legacy `faq` array, or
 *   - an faqSet,
 * counting published documents AND drafts. For each such project it appends a
 * typed `faqModuleInstallation` entry — unless one is already there — to the
 * published project document and to its draft, if any, so publishing an older
 * draft cannot drop the installation again. It never rewrites the array and
 * never touches another module's entry.
 *
 * PRE-FLIGHT (2026-10-19, dataset production, read-only): faqSection on 6
 * pages in abluo, cyce, hoffmann, nologo, studiomartegani; post.faq on 14
 * published Hoffmann posts + 1 draft; no faqSet yet. None of the five has a
 * faq installation. Expected: abluo, cyce, hoffmann, nologo, studiomartegani —
 * the run prints a warning when the live answer differs.
 *
 * Run, dry-run first (tsx reads .env.local with --env-file):
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/007-install-faq-module.ts
 *   npx tsx --env-file=.env.local src/lib/sanity/migrations/007-install-faq-module.ts --apply
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
  // Drafts too: a draft page with an FAQ section still needs the module once published.
  perspective: 'raw',
})

// Snapshot, not a registry import — see the VERSION NOTE in migration 004.
const MODULE_ID = 'faq'
const VERSION = '1.0.0'
const INSTALLATION_TYPE = 'faqModuleInstallation'
const EXPECTED = ['abluo', 'cyce', 'hoffmann', 'nologo', 'studiomartegani']

interface ProjectDocument {
  _id: string
  projectSlug?: string
  installed: boolean
}

async function run() {
  console.log(`\nMigration 007 — Install the FAQ module (ADR-037)`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (pass --apply to write)' : 'APPLY'}`)
  console.log(`Dataset: ${client.config().dataset ?? 'unknown'}\n`)

  const found = await client.fetch<{ sections: string[]; posts: string[]; sets: string[] }>(
    `{
      "sections": array::unique(*[defined(projectSlug) && count(sections[_type == "faqSection"]) > 0 && !(_id in path("versions.**"))].projectSlug),
      "posts": array::unique(*[_type == "post" && defined(projectSlug) && count(faq) > 0 && !(_id in path("versions.**"))].projectSlug),
      "sets": array::unique(*[_type == "faqSet" && defined(projectSlug) && !(_id in path("versions.**"))].projectSlug)
    }`
  )
  console.log(`  FAQ sections in: ${found.sections.join(', ') || '—'}`)
  console.log(`  Post FAQs in:    ${found.posts.join(', ') || '—'}`)
  console.log(`  FAQ sets in:     ${found.sets.join(', ') || '—'}\n`)

  const slugs = [...new Set([...found.sections, ...found.posts, ...found.sets])].sort()
  if (slugs.length === 0) {
    console.log('No FAQs found. Nothing to install.')
    return
  }
  const unexpected = slugs.filter((s) => !EXPECTED.includes(s))
  const absent = EXPECTED.filter((s) => !slugs.includes(s))
  if (unexpected.length || absent.length) {
    console.warn(`  [WARN] differs from the 2026-10-19 pre-flight — extra: ${unexpected.join(', ') || 'none'}; no longer found: ${absent.join(', ') || 'none'}\n`)
  }

  // Published AND draft project documents for those slugs.
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
  if (missing.length) console.warn(`\n  [WARN] FAQs exist for slugs with no project document: ${missing.join(', ')}`)

  console.log(`\n${DRY_RUN ? 'Would install' : 'Installed'} on ${written} project document(s).`)
  if (!DRY_RUN) console.log(`Verify: *[_type == "project"]{projectSlug, "mods": moduleInstallations[].moduleId}`)
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

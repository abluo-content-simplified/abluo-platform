/**
 * Migration 001 — Localize page, post, and event slugs
 *
 * Converts the flat slug format:
 *   { slug: { _type: 'slug', current: 'servizi' } }
 *
 * into the localized format, using the tenant's configured defaultLocale:
 *   { slug: { it: { _type: 'slug', current: 'servizi' } } }
 *
 * Run once, dry-run first:
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/001-localize-slugs.ts
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/001-localize-slugs.ts --apply
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface OldSlug {
  _type: 'slug'
  current: string
}

interface NewLocalizedSlug {
  [locale: string]: OldSlug
}

interface OldDocument {
  _id: string
  _type: string
  projectSlug?: string
  slug?: OldSlug
}

interface SiteConfig {
  projectSlug: string
  defaultLocale: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOldSlugFormat(slug: unknown): slug is OldSlug {
  if (!slug || typeof slug !== 'object') return false
  const s = slug as Record<string, unknown>
  // Old format: { _type: 'slug', current: '...' }
  // New format: { en: { _type: 'slug', current: '...' }, it: { ... } }
  return s._type === 'slug' && typeof s.current === 'string'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔄 Migration 001 — Localize slugs (${DRY_RUN ? 'DRY RUN' : 'APPLY'})\n`)

  // 1. Fetch all siteConfigs to build projectSlug → defaultLocale map
  const siteConfigs = await client.fetch<SiteConfig[]>(
    `*[_type == "siteConfig" && defined(projectSlug) && defined(defaultLocale)] {
      projectSlug,
      defaultLocale
    }`
  )

  const defaultLocaleByProject = new Map<string, string>()
  for (const cfg of siteConfigs) {
    defaultLocaleByProject.set(cfg.projectSlug, cfg.defaultLocale)
  }
  console.log(`Found ${siteConfigs.length} siteConfig(s):`)
  for (const [slug, locale] of defaultLocaleByProject) {
    console.log(`  ${slug} → defaultLocale: ${locale}`)
  }

  // 2. Fetch all page, post, and event documents that still have the OLD slug format
  const docs = await client.fetch<OldDocument[]>(
    `*[_type in ["page", "post", "event"] && defined(slug.current)] {
      _id,
      _type,
      projectSlug,
      slug
    }`
  )

  console.log(`\nFound ${docs.length} document(s) with old slug format.\n`)

  if (docs.length === 0) {
    console.log('✅ Nothing to migrate.')
    return
  }

  let migrated = 0
  let skipped = 0

  for (const doc of docs) {
    if (!isOldSlugFormat(doc.slug)) {
      console.log(`  SKIP ${doc._type} ${doc._id} — slug already migrated or malformed`)
      skipped++
      continue
    }

    const projectSlug = doc.projectSlug ?? ''
    const defaultLocale = defaultLocaleByProject.get(projectSlug) ?? 'en'
    const oldCurrent = doc.slug.current

    const newSlug: NewLocalizedSlug = {
      [defaultLocale]: {
        _type: 'slug',
        current: oldCurrent,
      },
    }

    console.log(
      `  ${DRY_RUN ? '[DRY]' : 'PATCH'} ${doc._type} ${doc._id} (${projectSlug}):\n` +
      `    slug.current = "${oldCurrent}" → slug.${defaultLocale}.current = "${oldCurrent}"`
    )

    if (!DRY_RUN) {
      await client
        .patch(doc._id)
        .set({ slug: newSlug })
        .commit()
    }

    migrated++
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN]' : '✅'} Done — ${migrated} migrated, ${skipped} skipped.`)
  if (DRY_RUN) {
    console.log('Run with --apply to execute the migration.')
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

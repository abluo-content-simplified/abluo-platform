/**
 * Migration 003 — ADR-016 Phase C, Step 2: unset the now-retired fixed
 * fields on the singleton module pages (livePage, eventsPage, blogPage)
 * after their content has been reproduced as sections[].
 *
 * ─── ORDERING CONSTRAINT — READ BEFORE RUNNING ──────────────────────────────
 *
 * This script must run ONLY AFTER BOTH of the following are true:
 *   1. Migration 002 (002-migrate-singleton-sections.ts) has been run with
 *      --apply against the target dataset, so every livePage/eventsPage/
 *      blogPage document already has an equivalent sections[] populated.
 *   2. The frontend redeploy that reads sections[] only (SectionRenderer via
 *      hydrateSections in live/page.tsx, events/page.tsx, blog/page.tsx) is
 *      live in the target environment.
 *
 * Running this script BEFORE both conditions hold will blank the affected
 * pages: the OLD rendering code (still deployed) reads the fixed fields
 * directly, and this script removes their values with nothing left for the
 * old code to render. There is no in-between-safe order — 002 apply, then
 * deploy, then 003 apply. See the release-engineering Standard Handoff for
 * the exact runbook and STOP gates.
 *
 * ─── What this script does ───────────────────────────────────────────────────
 *
 * For every livePage/eventsPage/blogPage document, `unset` the fixed fields
 * that have zero remaining runtime reads (verified by grep across the app —
 * see the Phase C Standard Handoff §1):
 *
 *   livePage:    heroTitle, heroSubtitle, betaNotice, introText, heroImage,
 *                cloudflareVideoId, featuredEvents
 *   eventsPage:  introText, heroImage, cloudflareVideoId
 *   blogPage:    eyebrow
 *
 * NOT touched (kept deliberately, never remove):
 *   - projectSlug, seoTitle, seoDescription, sections — on all three types.
 *   - eventsPage.heroTitle / eventsPage.heroSubtitle — still read as
 *     SEO-fallback strings by generateMetadata in events/page.tsx.
 *   - blogPage.heroTitle / blogPage.heroSubtitle — still read as
 *     SEO-fallback strings by generateMetadata in blog/page.tsx.
 *
 * ─── Schema Evolution Rules note (see CLAUDE.md) ─────────────────────────────
 *
 * Removing an optional field from a Sanity type while published documents
 * still contain a value for it does NOT cause a validation error — Studio
 * shows it as a harmless "unknown field" under the document's JSON, purely
 * cosmetic. (Validation errors only occur on a TYPE MISMATCH — e.g. the June
 * 2026 MetricsSection incident, where a field's TYPE changed under existing
 * content.) This migration exists to clear that cosmetic state, not to avoid
 * a validation error — the schema removal in modules/{live,events,blog}/
 * schema.ts is already safe to deploy on its own, before this script ever
 * runs, precisely because it's a field removal, not a type change.
 *
 * Idempotent: `unset` on a field that is already absent is a no-op. Safe to
 * re-run.
 *
 * Dry-run by default; run once, review carefully, then --apply:
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/003-unset-singleton-fixed-fields.ts
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/003-unset-singleton-fixed-fields.ts --apply
 *
 * Prerequisites:
 *   SANITY_API_TOKEN must be set in your environment (token with write access).
 *   NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET must be set.
 *
 * DO NOT RUN THIS SCRIPT AS PART OF THIS TASK. It is delivered for the
 * release-engineering runbook to execute at the correct point in the
 * deploy sequence (apply-002 → commit + deploy the schema/query/frontend
 * retirement → apply-003).
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

interface RawSingletonDoc {
  _id: string
  _type: 'livePage' | 'eventsPage' | 'blogPage'
  projectSlug?: string
  [field: string]: unknown
}

// ─── Per-type retirement lists ───────────────────────────────────────────────
// Field-name list per document type — matches the "What this script does"
// section in the header comment above. Kept as literal per-type maps (not a
// shared superset) so it's obvious at a glance which fields apply to which
// type, and so heroTitle/heroSubtitle are never accidentally unset on
// eventsPage/blogPage (they are still read by generateMetadata).

const RETIRED_FIELDS: Record<RawSingletonDoc['_type'], string[]> = {
  livePage: ['heroTitle', 'heroSubtitle', 'betaNotice', 'introText', 'heroImage', 'cloudflareVideoId', 'featuredEvents'],
  eventsPage: ['introText', 'heroImage', 'cloudflareVideoId'],
  blogPage: ['eyebrow'],
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔄 Migration 003 — Unset retired fixed fields on singleton pages (${DRY_RUN ? 'DRY RUN' : 'APPLY'})\n`)
  console.log(
    'ORDERING CONSTRAINT: only run after migration 002 has been applied AND the ' +
    'sections[]-only frontend has been deployed. See the header comment.\n'
  )

  const docs = await client.fetch<RawSingletonDoc[]>(
    `*[_type in ["livePage", "eventsPage", "blogPage"]] {
      _id,
      _type,
      projectSlug,
      heroTitle,
      heroSubtitle,
      betaNotice,
      introText,
      heroImage,
      cloudflareVideoId,
      featuredEvents,
      eyebrow
    }`
  )

  console.log(`Found ${docs.length} singleton document(s) across livePage/eventsPage/blogPage.\n`)

  if (docs.length === 0) {
    console.log('✅ Nothing to clean up.')
    return
  }

  let patched = 0
  let skipped = 0

  for (const doc of docs) {
    const candidateFields = RETIRED_FIELDS[doc._type]
    if (!candidateFields) {
      console.log(`  SKIP ${doc._id} — unrecognized _type "${doc._type}"`)
      skipped++
      continue
    }

    // Only unset fields that actually have a value on this doc — makes the
    // dry-run output an accurate preview of the real patch, not a blanket
    // list of every candidate field regardless of presence.
    const fieldsPresent = candidateFields.filter((f) => doc[f] !== undefined)

    if (fieldsPresent.length === 0) {
      console.log(`  SKIP ${doc._type} ${doc._id} (${doc.projectSlug ?? '?'}) — none of the retired fields are present.`)
      skipped++
      continue
    }

    console.log(`  ${DRY_RUN ? '[DRY]' : 'PATCH'} ${doc._type} ${doc._id} (${doc.projectSlug ?? '?'}) — would unset: ${fieldsPresent.join(', ')}`)

    if (!DRY_RUN) {
      await client.patch(doc._id).unset(fieldsPresent).commit()
    }

    patched++
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN]' : '✅'} Done — ${patched} document(s) patched, ${skipped} skipped.`)
  if (DRY_RUN) {
    console.log('Run with --apply to execute the cleanup.')
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

/**
 * Migration 002 — ADR-016 Phase C, Step 1: populate sections[] on the
 * singleton module pages (livePage, eventsPage, blogPage) from their
 * existing fixed fields.
 *
 * ADDITIVE AND REVERSIBLE. This script:
 *   - POPULATES sections[] with the equivalent section objects.
 *   - Does NOT unset, clear, or touch any fixed field (heroTitle, heroSubtitle,
 *     betaNotice, introText, heroImage, cloudflareVideoId, eyebrow, seoTitle,
 *     seoDescription, featuredEvents, etc.).
 *   - Does NOT retire any schema. Both the fixed fields and sections[] coexist
 *     after this migration runs, exactly as ADR-016 Phase A intended.
 *
 * WHY fixed fields must survive this step: production still renders the fixed
 * fields (LivePageContent, events/page.tsx, blog/page.tsx) until the frontend
 * is redeployed to read sections[] only. Removing fixed fields here would
 * blank the Livener /live page (and events/blog pages) during the deploy
 * window. That removal is a later, separately-gated step (schema/query
 * retirement + a cleanup migration), owned by a follow-up task — NOT this one.
 *
 * Idempotent-and-corrective re-apply contract: every section this script
 * writes carries a deterministic `_key` prefixed `migrated-` (e.g.
 * `migrated-hero`). On each run, a document's EXISTING sections[] is
 * inspected before writing:
 *   - Empty/absent sections[]              -> CREATE (set sections: built)
 *   - Non-empty, every _key starts with
 *     'migrated-' (no human edits yet)      -> REPLACE (set sections: built)
 *   - Non-empty, any _key does NOT start
 *     with 'migrated-' (human has edited)   -> SKIP, never overwritten
 * This means re-running --apply after a builder fix (e.g. a corrected
 * heroHeight/maxItems default) safely overwrites a prior auto-migration with
 * the corrected output, while any document a human has touched in Studio is
 * left completely alone.
 *
 * Dry-run by default; run once, review carefully, then --apply:
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/002-migrate-singleton-sections.ts
 *   npx ts-node --project tsconfig.json src/lib/sanity/migrations/002-migrate-singleton-sections.ts --apply
 *
 * Prerequisites:
 *   SANITY_API_TOKEN must be set in your environment (token with write access).
 *   NEXT_PUBLIC_SANITY_PROJECT_ID and NEXT_PUBLIC_SANITY_DATASET must be set.
 *
 * ─── Design decisions (see Standard Handoff for full rationale) ──────────────
 *
 * 1. Hero renders unconditionally (Tom's locked decision). A heroSection is
 *    always added for every livePage/eventsPage/blogPage document, even if
 *    the underlying fixed fields are sparse. NOTE: the current component-level
 *    fallback strings (e.g. "Welcome to Livener", "Events") are hardcoded in
 *    JSX, not stored in Sanity — they are NOT reproduced here. A document with
 *    no heroTitle produces a heroSection with an empty headline. This is a
 *    flagged parity gap for whichever document lacks the field (none of the
 *    4 known production docs are missing heroTitle today).
 *
 * 2. betaNotice (livePage only) becomes its own textSection immediately after
 *    the hero, converted from localizedString to a single-block localizedPortableText
 *    value per locale.
 *
 * 3. eventsPage.introText becomes its own textSection immediately after the hero,
 *    same block-wrapping conversion (localizedText -> localizedPortableText).
 *
 * 4. seoTitle/seoDescription are left untouched — they remain page metadata,
 *    never migrated into sections, per Tom's locked decision.
 *
 * 5. featuredEvents (livePage) and any other empty/dead fields are NOT migrated.
 *    If a document unexpectedly has featuredEvents populated, this script logs
 *    a warning — Tom's decision was to drop manual curation in favor of the
 *    generic "past events" listing section, so that curation is intentionally
 *    NOT preserved. Reviewed via the dry-run warning before --apply.
 *
 * 6. livePage always gets, in order after liveLatestSection:
 *      a. eventsListingSection(timeFilter:'live', _key:'migrated-more-live')
 *         — reproduces "More Live Productions" (additionalLiveEventsQuery).
 *         ADR-016 Phase C added the 'live' timeFilter value specifically for
 *         this. KNOWN PARITY DELTA: it does not exclude the specific event
 *         liveLatestSection is showing (additionalLiveEventsQuery does, via
 *         $featuredEventId != _id) — a generic section can't know that ID.
 *         Accepted edge case at Livener's scale. See Standard Handoff §8.
 *      b. eventsListingSection(timeFilter:'past', _key:'migrated-past-events')
 *         — the current /live route always attempts to render a "Past Live
 *         Events" grid (via pastEventsQuery fallback, since no tenant
 *         currently populates featuredEvents).
 *
 * 7. eventsPage.heroImage is copied into heroSection.heroImage as
 *    { _type: 'image', asset, hotspot, crop } only. localizedImage's per-locale
 *    alt/caption sub-fields are NOT copied, because heroSection.heroImage is a
 *    plain (non-localized-alt) image field in the section schema. This is a
 *    minor, intentional content-loss — flagged in the Standard Handoff.
 *
 * 8. cloudflareVideoId is NO LONGER migrated into heroSection's background
 *    video (mediaType:'video'/heroVideo). It now becomes its own platform
 *    videoSection(provider:'cloudflare', videoId:cloudflareVideoId) — a real,
 *    watchable player with controls, distinct from heroSection's muted/
 *    looping/no-controls background video. heroSection.heroImage (if present)
 *    is therefore always eligible independently of video — the old "prefer
 *    video, drop image" tradeoff no longer applies. For livePage the
 *    videoSection (_key:'migrated-video') is positioned after the hero and
 *    after the beta-notice textSection, before liveLatestSection — reproducing
 *    where the Cloudflare player appears in today's /live route. The builder
 *    is written generically (buildVideoSection) so any singleton type with
 *    cloudflareVideoId populated gets the same treatment; eventsPage is
 *    verified to have no video in any of the 4 known production docs, so in
 *    practice no eventsPage videoSection is emitted today, but the code path
 *    is live should that ever change.
 *
 * 9. blogPage listing layout is migrated as layout: 'featured' (not 'grid') —
 *    the old /blog route rendered one full-width featured card above a
 *    separate grid, which is what the blogListingSection 'featured' layout
 *    option reproduces. ('grid' was the initial, incorrect approximation;
 *    corrected here for parity.)
 *
 * 10. eventsPage listing section uses timeFilter: 'all' (not 'upcoming') —
 *     verified against eventsQuery in queries.ts, which has no time filter and
 *     orders by startDate desc (sortOrder: 'newest').
 *
 * 11. [dev STOP-gate fix] Every migrated heroSection now sets
 *     heroHeight: 'small' (schema.ts heroSectionType enum: small=50vh,
 *     medium=70vh, large=90vh, fullscreen=100vh). Root cause: with no
 *     heroHeight set, HeroSection.tsx's own component-level default ('large',
 *     90vh) applied, rendering a near-full-screen title-only header on pages
 *     that migrated with no heroImage/video. These four pages are listing
 *     headers, not marketing landing heroes, so 'small' — the most compact
 *     enum value — is correct for all of them (livePage, eventsPage,
 *     blogPage). Applied inside buildHeroSection() so it is automatic for
 *     every caller.
 *
 * 12. [dev STOP-gate fix] Every migrated eventsListingSection and
 *     blogListingSection now sets maxItems: 12 (schema max for both types).
 *     Root cause: with no maxItems set, hydrateSections() defaulted to 3,
 *     so listing pages showed only 3 items regardless of how much content
 *     existed. 12 covers current content with headroom (Livener: 7 posts /
 *     4 events; Martegani: 3 posts) and any near-term growth; a "View All"
 *     link is the intended mechanism for overflow beyond 12, not a small
 *     listing cap. Applied uniformly to ALL migrated listing sections —
 *     eventsPage's "all" listing, both blogPage listings, and livePage's
 *     "live" and "past" listings — replacing the previous inconsistent
 *     12/5 split with a single value across the board.
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

/** Raw locale-keyed string map, e.g. { en: 'Welcome', it: 'Benvenuti' }. */
type RawLocaleMap<T> = Record<string, T>

interface RawImage {
  _type?: string
  asset?: { _ref: string; _type: string }
  hotspot?: unknown
  crop?: unknown
  alt?: unknown
  caption?: unknown
}

interface RawSingletonDoc {
  _id: string
  _type: 'livePage' | 'eventsPage' | 'blogPage'
  projectSlug?: string
  sections?: unknown[]

  // livePage
  heroTitle?: RawLocaleMap<string>
  heroSubtitle?: RawLocaleMap<string>
  betaNotice?: RawLocaleMap<string>
  introText?: RawLocaleMap<string>
  heroImage?: RawImage
  cloudflareVideoId?: string
  featuredEvents?: unknown[]

  // eventsPage additionally uses heroTitle/heroSubtitle/introText/heroImage/cloudflareVideoId above

  // blogPage
  eyebrow?: RawLocaleMap<string>

  // shared, untouched
  seoTitle?: RawLocaleMap<string>
  seoDescription?: RawLocaleMap<string>
}

// Minimal shape of the section objects we build. Kept loose (not importing
// the full PageSection union) so this script has no compile-time dependency
// on the app's type module and stays a self-contained, reviewable artifact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SectionPatch = Record<string, any>

/** Prefix stamped on every `_key` this script generates (see re-apply contract above). */
const MIGRATED_KEY_PREFIX = 'migrated-'

type ReapplyAction = 'CREATE' | 'REPLACE' | 'SKIP'

/**
 * Classifies how this run should treat a document's EXISTING sections[]
 * (never the freshly-built array) per the re-apply contract documented at
 * the top of this file:
 *   - empty/absent                                -> CREATE
 *   - non-empty, every _key is 'migrated-'-prefixed -> REPLACE
 *   - non-empty, any _key is NOT 'migrated-'-prefixed -> SKIP (human-edited)
 */
function classifyReapplyAction(existingSections: unknown[] | undefined): ReapplyAction {
  if (!Array.isArray(existingSections) || existingSections.length === 0) return 'CREATE'
  const allMigrated = existingSections.every(
    (s) =>
      typeof s === 'object' &&
      s !== null &&
      typeof (s as { _key?: unknown })._key === 'string' &&
      (s as { _key: string })._key.startsWith(MIGRATED_KEY_PREFIX)
  )
  return allMigrated ? 'REPLACE' : 'SKIP'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A stored Sanity localized-wrapper object is shaped
 * `{ _type: 'localizedString'|'localizedText'|'localizedPortableText', en: T, it: T, ... }`.
 * `_type` (and any other `_`-prefixed key) is metadata, NOT a locale — it must
 * never be iterated as one. This wrapper type documents that shape for the
 * helpers below.
 */
type LocalizedWrapper<T> = { _type: string; [locale: string]: T | string }

/** True if `map` has at least one real-locale key (i.e. not `_type`/`_`-prefixed) with non-empty string content. */
function hasContent(map: RawLocaleMap<string> | undefined): boolean {
  return (
    !!map &&
    typeof map === 'object' &&
    Object.entries(map).some(([key, v]) => !key.startsWith('_') && typeof v === 'string' && v.length > 0)
  )
}

/**
 * Copies only the real-locale keys from a source localized wrapper (skipping
 * the source's own `_type` and any other `_`-prefixed metadata key) and stamps
 * the TARGET field's actual wrapper type. The source and target localized
 * types are not always the same (e.g. a `localizedString` source field may
 * feed a `localizedText` target field) — the caller must pass the target
 * field's real wrapper type name, not assume it matches the source.
 */
function copyLocaleMap(
  map: RawLocaleMap<string> | undefined,
  targetType: 'localizedString' | 'localizedText'
): LocalizedWrapper<string> | undefined {
  if (!hasContent(map)) return undefined
  const out: LocalizedWrapper<string> = { _type: targetType }
  for (const [locale, value] of Object.entries(map as RawLocaleMap<string>)) {
    if (locale.startsWith('_')) continue
    if (typeof value !== 'string' || value.length === 0) continue
    out[locale] = value
  }
  return out
}

/**
 * Converts a locale-keyed plain-string map (localizedString/localizedText shape)
 * into a localizedPortableText wrapper: one block per real locale, with a
 * single span carrying the original text. The source wrapper's own `_type`
 * key (and any other `_`-prefixed metadata) is skipped — it is not a locale —
 * and the returned wrapper's top-level `_type` is stamped explicitly as the
 * string `'localizedPortableText'`, which is what `textSection.content`
 * expects (schema.ts: `localizedPortableTextType`, name `'localizedPortableText'`).
 * Keys are deterministic (stable per doc + field + locale) so re-running the
 * script produces byte-identical output.
 */
function toLocalizedPortableText(
  map: RawLocaleMap<string> | undefined,
  keyPrefix: string
): LocalizedWrapper<Array<Record<string, unknown>>> | undefined {
  if (!hasContent(map)) return undefined
  const result: LocalizedWrapper<Array<Record<string, unknown>>> = { _type: 'localizedPortableText' }
  for (const [locale, text] of Object.entries(map as RawLocaleMap<string>)) {
    if (locale.startsWith('_')) continue
    if (typeof text !== 'string' || text.length === 0) continue
    result[locale] = [
      {
        _type: 'block',
        _key: `${keyPrefix}-blk-${locale}`,
        style: 'normal',
        markDefs: [],
        children: [
          {
            _type: 'span',
            _key: `${keyPrefix}-span-${locale}`,
            text,
            marks: [],
          },
        ],
      },
    ]
  }
  const hasAnyLocale = Object.keys(result).some((k) => k !== '_type')
  return hasAnyLocale ? result : undefined
}

/** Copies only the fields heroSection.heroImage actually supports (plain image, no locale sub-fields). */
function copyImageForHeroSection(image: RawImage | undefined): SectionPatch | undefined {
  if (!image || !image.asset) return undefined
  const out: SectionPatch = { _type: 'image', asset: image.asset }
  if (image.hotspot !== undefined) out.hotspot = image.hotspot
  if (image.crop !== undefined) out.crop = image.crop
  return out
}

// ─── Section builders ────────────────────────────────────────────────────────

interface HeroSectionInput {
  key: string
  eyebrow?: RawLocaleMap<string>
  headline?: RawLocaleMap<string>
  subheadline?: RawLocaleMap<string>
  heroImage?: RawImage
}

function buildHeroSection(input: HeroSectionInput): SectionPatch {
  const section: SectionPatch = {
    _type: 'heroSection',
    _key: input.key,
    // heroHeight (schema.ts heroSectionType: 'small'=50vh/'medium'=70vh/
    // 'large'=90vh/'fullscreen'=100vh) is REQUIRED here — dev STOP-gate
    // finding #1: with no heroHeight set, HeroSection.tsx's own default
    // ('large', 90vh) applied, rendering a near-full-screen title-only
    // header on these listing pages. These are listing-page headers, not
    // marketing landing heroes, so 'small' (the most compact option) is
    // correct across all four migrated pages (livePage/eventsPage/blogPage).
    heroHeight: 'small',
  }

  // heroSection field wrapper types (schema.ts: heroSectionType, lines 515-517):
  //   eyebrow     -> localizedString
  //   headline    -> localizedText
  //   subheadline -> localizedText
  // Source fields are NOT guaranteed to already be these types (e.g.
  // livePage/eventsPage.heroTitle and blogPage.heroTitle/eyebrow are
  // localizedString; blogPage.heroSubtitle is localizedText; livePage/
  // eventsPage.heroSubtitle are localizedString) — copyLocaleMap always
  // stamps the TARGET type, never passes through the source's `_type`.
  const eyebrow = copyLocaleMap(input.eyebrow, 'localizedString')
  if (eyebrow) section.eyebrow = eyebrow

  const headline = copyLocaleMap(input.headline, 'localizedText')
  if (headline) section.headline = headline

  const subheadline = copyLocaleMap(input.subheadline, 'localizedText')
  if (subheadline) section.subheadline = subheadline

  // NOTE: cloudflareVideoId is deliberately NOT handled here — video is now
  // migrated into its own platform videoSection (see buildVideoSection),
  // never into heroSection's background-video fields (mediaType/heroVideo).
  if (input.heroImage?.asset) {
    section.mediaType = 'image'
    section.heroImage = copyImageForHeroSection(input.heroImage)
  }

  return section
}

/**
 * Builds a platform videoSection from a singleton's cloudflareVideoId, or
 * returns null when no video is present. Generic across singleton types —
 * any livePage/eventsPage/blogPage document with cloudflareVideoId populated
 * gets the same treatment (design decision #8).
 */
function buildVideoSection(key: string, cloudflareVideoId: string | undefined): SectionPatch | null {
  if (!cloudflareVideoId) return null
  return {
    _type: 'videoSection',
    _key: key,
    provider: 'cloudflare',
    videoId: cloudflareVideoId,
  }
}

function buildTextSection(key: string, content: RawLocaleMap<string> | undefined): SectionPatch | null {
  const portableTextContent = toLocalizedPortableText(content, key)
  if (!portableTextContent) return null
  return {
    _type: 'textSection',
    _key: key,
    content: portableTextContent,
  }
}

function buildLiveLatestSection(key: string): SectionPatch {
  return {
    _type: 'liveLatestSection',
    _key: key,
  }
}

function buildLiveEventsListingSection(key: string): SectionPatch {
  // Mirrors additionalLiveEventsQuery: status == "live", order(startDate asc).
  // ADR-016 Phase C — reproduces the "More Live Productions" block via the
  // generic eventsListingSection(timeFilter:'live') rather than a bespoke
  // fixed field. KNOWN PARITY DELTA (see Standard Handoff §8 / schema.ts
  // comment): additionalLiveEventsQuery excludes the specific event the
  // co-located liveLatestSection is currently showing ($featuredEventId !=
  // _id); this generic section cannot know that ID, so it lists ALL
  // currently-live events with no exclusion. Accepted as an edge case at
  // Livener's scale (simultaneous multiple-live events are rare).
  // maxItems: 12 (schema max — dev STOP-gate finding #2) — see design
  // decision #11 below for the full rationale shared by all listing sections.
  return {
    _type: 'eventsListingSection',
    _key: key,
    timeFilter: 'live',
    filterMode: 'latest',
    sortOrder: 'oldest',
    layout: 'grid',
    maxItems: 12,
  }
}

function buildPastEventsListingSection(key: string): SectionPatch {
  // Mirrors pastEventsQuery: order(startDate desc)[0..4] -> newest first.
  // maxItems raised from the original 5 to 12 (schema max) for consistency —
  // see design decision #11.
  return {
    _type: 'eventsListingSection',
    _key: key,
    timeFilter: 'past',
    filterMode: 'latest',
    sortOrder: 'newest',
    layout: 'grid',
    maxItems: 12,
  }
}

function buildAllEventsListingSection(key: string): SectionPatch {
  // Mirrors eventsQuery: *[_type=="event"] order(startDate desc) — no time filter.
  // maxItems: 12 (schema max) — see design decision #11.
  return {
    _type: 'eventsListingSection',
    _key: key,
    timeFilter: 'all',
    filterMode: 'latest',
    sortOrder: 'newest',
    layout: 'grid',
    maxItems: 12,
  }
}

function buildBlogListingSection(key: string): SectionPatch {
  // Mirrors postsQuery: order(featured desc, publishedAt desc) — newest first.
  // Layout 'featured' reproduces the old /blog route's "one full-width
  // featured card above a separate grid" composite — see design decision #9.
  // maxItems: 12 (schema max) — see design decision #11.
  return {
    _type: 'blogListingSection',
    _key: key,
    filterMode: 'latest',
    sortOrder: 'newest',
    layout: 'featured',
    maxItems: 12,
  }
}

// ─── Per-type section array builders ─────────────────────────────────────────

function buildLivePageSections(doc: RawSingletonDoc, warnings: string[]): SectionPatch[] {
  const sections: SectionPatch[] = []

  sections.push(
    buildHeroSection({
      key: 'migrated-hero',
      headline: doc.heroTitle,
      subheadline: doc.heroSubtitle,
    })
  )

  const betaSection = buildTextSection('migrated-beta-notice', doc.betaNotice)
  if (betaSection) sections.push(betaSection)

  // Cloudflare Stream video — now its own watchable-player videoSection,
  // positioned after the hero and beta notice, before the live-latest
  // section (design decision #8). Only added when cloudflareVideoId is set.
  const videoSection = buildVideoSection('migrated-video', doc.cloudflareVideoId)
  if (videoSection) sections.push(videoSection)

  sections.push(buildLiveLatestSection('migrated-live-latest'))

  // "More Live Productions" — reproduces additionalLiveEventsQuery via the
  // generic timeFilter:'live' filter (ADR-016 Phase C). Positioned directly
  // after liveLatestSection, before the past-events listing, to reproduce
  // today's /live route order.
  sections.push(buildLiveEventsListingSection('migrated-more-live'))

  // Current /live route always attempts to render "Past Live Events" (via
  // pastEventsQuery fallback — no production tenant populates featuredEvents).
  sections.push(buildPastEventsListingSection('migrated-past-events'))

  if (Array.isArray(doc.featuredEvents) && doc.featuredEvents.length > 0) {
    warnings.push(
      `featuredEvents has ${doc.featuredEvents.length} entr${doc.featuredEvents.length === 1 ? 'y' : 'ies'} — ` +
      `Tom's locked decision drops manual curation in favor of the generic "past events" listing section. ` +
      `This document's hand-picked event list will NOT be reproduced by the migrated eventsListingSection.`
    )
  }

  warnings.push(
    `"More Live Productions" is now reproduced via eventsListingSection(timeFilter:'live') ` +
    `("migrated-more-live"), but WITHOUT additionalLiveEventsQuery's exclusion of the current ` +
    `liveLatestSection event — a generic section cannot know which event another section selected. ` +
    `Accepted parity delta at Livener's scale (simultaneous multiple-live events are an edge case).`
  )

  return sections
}

function buildEventsPageSections(doc: RawSingletonDoc, warnings: string[]): SectionPatch[] {
  const sections: SectionPatch[] = []

  sections.push(
    buildHeroSection({
      key: 'migrated-hero',
      headline: doc.heroTitle,
      subheadline: doc.heroSubtitle,
      heroImage: doc.heroImage,
    })
  )

  const introSection = buildTextSection('migrated-intro-text', doc.introText)
  if (introSection) sections.push(introSection)

  // Generic videoSection treatment (design decision #8) — none of the 4 known
  // production eventsPage docs have cloudflareVideoId set, so this is a no-op
  // in practice today, but the path is live should that ever change.
  const videoSection = buildVideoSection('migrated-video', doc.cloudflareVideoId)
  if (videoSection) {
    sections.push(videoSection)
    warnings.push(
      `eventsPage ${doc._id} has cloudflareVideoId set — this was NOT expected ` +
      `(verified: no known production eventsPage doc has a video). Added videoSection ` +
      `"migrated-video" after the hero/intro. Review before --apply.`
    )
  }

  sections.push(buildAllEventsListingSection('migrated-events-listing'))

  return sections
}

function buildBlogPageSections(doc: RawSingletonDoc): SectionPatch[] {
  const sections: SectionPatch[] = []

  sections.push(
    buildHeroSection({
      key: 'migrated-hero',
      eyebrow: doc.eyebrow,
      headline: doc.heroTitle,
      subheadline: doc.heroSubtitle,
    })
  )

  sections.push(buildBlogListingSection('migrated-blog-listing'))

  return sections
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔄 Migration 002 — Populate sections[] on singleton pages (${DRY_RUN ? 'DRY RUN' : 'APPLY'})\n`)
  console.log('ADDITIVE ONLY — fixed fields are never modified or removed by this script.\n')

  const docs = await client.fetch<RawSingletonDoc[]>(
    `*[_type in ["livePage", "eventsPage", "blogPage"]] {
      _id,
      _type,
      projectSlug,
      sections,
      heroTitle,
      heroSubtitle,
      betaNotice,
      introText,
      heroImage,
      cloudflareVideoId,
      featuredEvents,
      eyebrow,
      seoTitle,
      seoDescription
    }`
  )

  console.log(`Found ${docs.length} singleton document(s) across livePage/eventsPage/blogPage.\n`)

  if (docs.length === 0) {
    console.log('✅ Nothing to migrate.')
    return
  }

  let created = 0
  let replaced = 0
  let skipped = 0

  for (const doc of docs) {
    if (doc._type !== 'livePage' && doc._type !== 'eventsPage' && doc._type !== 'blogPage') {
      console.log(`  SKIP ${doc._id} — unrecognized _type`)
      skipped++
      continue
    }

    const action = classifyReapplyAction(doc.sections)

    if (action === 'SKIP') {
      console.log(
        `  SKIP ${doc._id} — contains non-migrated sections (human-edited), not overwriting.`
      )
      skipped++
      continue
    }

    const warnings: string[] = []
    let sections: SectionPatch[]

    switch (doc._type) {
      case 'livePage':
        sections = buildLivePageSections(doc, warnings)
        break
      case 'eventsPage':
        sections = buildEventsPageSections(doc, warnings)
        break
      case 'blogPage':
        sections = buildBlogPageSections(doc)
        break
    }

    console.log(
      `  ${DRY_RUN ? `[DRY: ${action}]` : action} ${doc._type} ${doc._id} (${doc.projectSlug ?? '?'}):`
    )
    console.log(JSON.stringify(sections, null, 2).split('\n').map((l) => `    ${l}`).join('\n'))
    if (warnings.length > 0) {
      console.log('    ⚠️  Warnings:')
      for (const w of warnings) console.log(`      - ${w}`)
    }

    if (!DRY_RUN) {
      // Both CREATE and REPLACE resolve to the same terminal state: sections
      // set to exactly the freshly-built array. setIfMissing covers CREATE's
      // undefined-field case; set() overwrites unconditionally for REPLACE.
      await client
        .patch(doc._id)
        .setIfMissing({ sections: [] })
        .set({ sections })
        .commit()
    }

    if (action === 'REPLACE') {
      replaced++
    } else {
      created++
    }
  }

  console.log(
    `\n${DRY_RUN ? '[DRY RUN]' : '✅'} Done — ${created} created, ${replaced} replaced, ${skipped} skipped.`
  )
  if (DRY_RUN) {
    console.log('Run with --apply to execute the migration.')
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

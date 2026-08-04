import { defineType, defineField } from 'sanity'
import { projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'

// ── Live module — Sanity schema types ─────────────────────────────────────────
//
// Owned by: live module (MODULE_REGISTRY id: 'live')
// Platform contract: 2 types
//   liveLatestSection — section object embedded in page.sections (ADR-016 Phase B)
//   livePage          — singleton document, one per project
//
// DESIGN PRINCIPLE — Platform-distributed section templates:
//   heroLiveCaptureSection and heroLensSection are globally available section
//   templates. Their availability in SectionRenderer is not conditioned on Live
//   module installation. They are registered in src/lib/sanity/schema.ts as
//   platform-owned types and are not listed in live.platformContract.schemaTypes
//   or live.platformContract.sectionTypes.
//
//   The Live module introduced these sections, but the platform distributes them.
//   Installing or uninstalling the Live module must not change which sections are
//   available to the SectionRenderer.
//
// Cross-module references:
//   livePage.featuredEvents → event (Events module, string ref — no TS import)
//
// ADR-011 Phase D1 — extracted from src/lib/sanity/schema.ts.
// ADR-016 Phase B — liveLatestSection added.

// ── Live Latest Section ───────────────────────────────────────────────────────
// ADR-016 Phase B — renders the current/active (or next upcoming) live event,
// hero-style. Does NOT list past events — past events are composed separately
// via an eventsListingSection (timeFilter: 'past'). "Current" selection reuses
// the same precedence as currentLiveEventQuery (src/lib/sanity/queries.ts):
// explicitly featured on live page (within its scheduling window) → any
// status: "live" event → next upcoming event.

const liveLatestSectionType = defineType({
  name: 'liveLatestSection',
  title: 'Live — Current Event',
  type: 'object',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'display', title: 'Display' },
  ],
  fields: [
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: {
        list: [
          { title: '⬜ Use Page Pattern', value: 'usePagePattern' },
          { title: '⬜ Surface 1', value: 'surface1' },
          { title: '⬜ Surface 2', value: 'surface2' },
          { title: '🟦 Surface 3', value: 'surface3' },
          { title: '🟢 Brand Surface', value: 'brandSurface' },
          { title: '◻ Transparent', value: 'transparent' },
          { title: '🔲 Glass', value: 'glass' },
        ],
      },
      initialValue: 'usePagePattern',
    }),
    // ── Content ──────────────────────────────────────────────────────────────
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString', group: 'content' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content' }),
    // ── Empty state (ADR-016 Phase B) ───────────────────────────────────────────
    // Semantics (frontend concern, see hydrateSections / the Live section component):
    //   no current/upcoming event + both fields empty → render nothing (today's behavior)
    //   no current/upcoming event + a field set        → render the localized empty block
    defineField({
      name: 'emptyStateHeading',
      title: 'Empty State Heading',
      type: 'localizedString',
      group: 'display',
      description: 'Shown when there is no current or upcoming live event. Leave empty to render nothing.',
    }),
    defineField({
      name: 'emptyStateBody',
      title: 'Empty State Body',
      type: 'localizedText',
      group: 'display',
      description: 'Optional supporting text below the empty state heading.',
    }),
  ],
  preview: {
    select: { titleEn: 'title.en' },
    prepare: ({ titleEn }: { titleEn?: string }) => ({
      title: titleEn ?? 'Live — Current Event',
      subtitle: 'Renders the current/next live event',
    }),
  },
})

// ── Live Page ─────────────────────────────────────────────────────────────────
// ADR-016 Phase A: additive `sections[]` composes below the fixed content
// above — no migration, no visual change until a section is actually added.
// Phase C migrates these fixed fields into equivalent sections and retires
// this fixed shape; until then both surfaces coexist.

const livePageType = defineType({
  name: 'livePage',
  title: 'Live Page',
  type: 'document',
  // ADR-016 Phase C — the fixed `content`/`video`/`events` groups were retired
  // along with the fields that populated them (heroTitle, heroSubtitle,
  // betaNotice, introText, heroImage, cloudflareVideoId, featuredEvents). All
  // are now expressed as sections (heroSection, liveLatestSection,
  // eventsListingSection) via sections[]. See migration 002 + 003.
  groups: [
    { name: 'meta', title: 'SEO / Meta', default: true },
    { name: 'sections', title: 'Sections' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      group: 'sections',
      of: PAGE_SECTIONS_OF,
      description: 'ADR-016 Phase A: optional, additive section composition. Renders below the fixed content above.',
    }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'Live Page', subtitle: slug }),
  },
})

// ── Exports ───────────────────────────────────────────────────────────────────

export const liveSchemaTypes = [
  liveLatestSectionType,
  livePageType,
]

import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'

// ── Live module — Sanity schema types ─────────────────────────────────────────
//
// Owned by: live module (MODULE_REGISTRY id: 'live')
// Platform contract: 1 type
//   livePage — singleton document, one per project
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

// ── Live Page ─────────────────────────────────────────────────────────────────
// ADR-016 Phase A: additive `sections[]` composes below the fixed content
// above — no migration, no visual change until a section is actually added.
// Phase C migrates these fixed fields into equivalent sections and retires
// this fixed shape; until then both surfaces coexist.

const livePageType = defineType({
  name: 'livePage',
  title: 'Live Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'video', title: 'Video' },
    { name: 'events', title: 'Featured Events' },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'sections', title: 'Sections' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'e.g. "Welcome to Livener"' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content', description: 'e.g. "Live video streaming, in the palm of your hands"' }),
    defineField({ name: 'betaNotice', title: 'Beta Notice', type: 'localizedString', group: 'content', description: 'e.g. "Currently in beta — tested live, in real environments."' }),
    defineField({ name: 'introText', title: 'Intro Text', type: 'localizedText', group: 'content' }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'video' }),
    defineField({
      name: 'cloudflareVideoId',
      title: 'Cloudflare Video ID',
      type: 'string',
      group: 'video',
      description: 'The video ID from Cloudflare Stream (e.g. "abc123xyz"). The embed URL is generated automatically.',
    }),
    defineField({
      name: 'featuredEvents',
      title: 'Featured Events',
      type: 'array',
      group: 'events',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'event' }], options: { filter: scopedRef } })],
      description: 'Events to show in the past events grid. If empty, past events are shown automatically.',
    }),
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
  livePageType,
]

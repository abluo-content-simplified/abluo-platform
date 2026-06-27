import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField } from '@/lib/sanity/fields/shared'

// ── Events module — Sanity schema types ───────────────────────────────────────
//
// Owned by: events module (MODULE_REGISTRY id: 'events')
// Platform contract: 2 types
//   eventsPage — singleton document, one per project
//   event      — collection document (routable)
//
// Cross-module references:
//   event is referenced by: livePageType.featuredEvents, blogListingSection.event,
//   postType.relatedEvent — all string-based, resolved by Sanity at runtime.
//   No TypeScript imports are required from those modules.
//
// ADR-011 Phase D1 — extracted from src/lib/sanity/schema.ts.

// ── Events Page ───────────────────────────────────────────────────────────────

const eventsPageType = defineType({
  name: 'eventsPage',
  title: 'Events Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'media', title: 'Media' },
    { name: 'meta', title: 'SEO / Meta' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'e.g. "Events"' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content' }),
    defineField({ name: 'introText', title: 'Intro Text', type: 'localizedText', group: 'content' }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'media' }),
    defineField({
      name: 'cloudflareVideoId',
      title: 'Cloudflare Video ID',
      type: 'string',
      group: 'media',
      description: 'The video ID from Cloudflare Stream (e.g. "abc123xyz"). The embed URL is generated automatically.',
    }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'Events Page', subtitle: slug }),
  },
})

// ── Event ─────────────────────────────────────────────────────────────────────

const eventType = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'placement', title: 'Placement' },
    { name: 'schedule', title: 'Schedule' },
    { name: 'media', title: 'Media' },
    { name: 'streaming', title: 'Streaming' },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'redirects', title: 'Redirects' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'localizedSlug', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'redirectFrom',
      title: 'Old Slugs (Redirects)',
      type: 'redirectFrom',
      group: 'redirects',
      description: 'Fill these only when you rename a slug. Old URLs here will 301-redirect to the current slug.',
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'content',
      options: { list: [{ title: '🟡 Upcoming', value: 'upcoming' }, { title: '🔴 Live', value: 'live' }, { title: '⚫ Past', value: 'past' }], layout: 'radio' },
      initialValue: 'upcoming',
      validation: (Rule) => Rule.required(),
    }),
    // ── Placement ──────────────────────────────────────────────────────────────
    // Live Page
    defineField({
      name: 'featuredOnLivePage',
      title: 'Feature on Live Page',
      type: 'boolean',
      group: 'placement',
      initialValue: false,
    }),
    defineField({
      name: 'livePageFeatureStartDate',
      title: 'Live Page Feature Start Date',
      type: 'datetime',
      group: 'placement',
      description: 'Leave empty to feature immediately when toggled on.',
    }),
    defineField({
      name: 'livePageFeatureEndDate',
      title: 'Live Page Feature End Date',
      type: 'datetime',
      group: 'placement',
      description: 'Leave empty to feature indefinitely.',
    }),
    // Home Page
    defineField({
      name: 'featuredOnHomePage',
      title: 'Feature on Home Page',
      type: 'boolean',
      group: 'placement',
      initialValue: false,
    }),
    defineField({
      name: 'homePageFeatureStartDate',
      title: 'Homepage Feature Start Date',
      type: 'datetime',
      group: 'placement',
      description: 'Leave empty to feature immediately when toggled on.',
    }),
    defineField({
      name: 'homePageFeatureEndDate',
      title: 'Homepage Feature End Date',
      type: 'datetime',
      group: 'placement',
      description: 'Leave empty to feature indefinitely.',
    }),
    // Deprecated — kept for backward compatibility with existing published documents.
    // Use featuredOnLivePage instead. Hidden from Studio UI.
    defineField({ name: 'isCurrentLiveEvent', title: 'Feature on /live page (deprecated)', type: 'boolean', hidden: true, initialValue: false }),
    defineField({ name: 'startDate', title: 'Start Date & Time', type: 'datetime', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'endDate', title: 'End Date & Time', type: 'datetime', group: 'content' }),
    defineField({ name: 'location', title: 'Location', type: 'localizedString', group: 'content' }),
    defineField({ name: 'shortDescription', title: 'Short Description', type: 'localizedText', group: 'content' }),
    defineField({ name: 'fullDescription', title: 'Full Description', type: 'localizedPortableText', group: 'content' }),
    defineField({ name: 'schedule', title: 'Schedule', type: 'array', group: 'schedule', of: [defineArrayMember({ type: 'scheduleItem' })] }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'media' }),
    defineField({ name: 'gallery', title: 'Gallery', type: 'array', group: 'media', of: [defineArrayMember({ type: 'localizedImage' })] }),
    // ── Embedded Player ────────────────────────────────────────────────────────
    defineField({
      name: 'embedPlayerEnabled',
      title: 'Enable Embedded Player',
      type: 'boolean',
      group: 'streaming',
      initialValue: false,
    }),
    defineField({
      name: 'embedVideoUrl',
      title: 'Video URL',
      type: 'string',
      group: 'streaming',
      description:
        'Paste a YouTube or Cloudflare Stream URL. The following formats are accepted:\n\n• youtube.com/watch?v=VIDEO_ID\n• youtu.be/VIDEO_ID\n• *.cloudflarestream.com/VIDEO_ID/watch\n\nChannel URLs and playlist URLs are not supported.',
    }),
    // ── External Stream CTAs ───────────────────────────────────────────────────
    defineField({
      name: 'primaryStreamLabel',
      title: 'Primary Stream Label',
      type: 'localizedString',
      group: 'streaming',
      description: 'e.g. "Watch Main Stage"',
    }),
    defineField({
      name: 'primaryStreamUrl',
      title: 'Primary Stream URL',
      type: 'url',
      group: 'streaming',
    }),
    defineField({
      name: 'secondaryStreamLabel',
      title: 'Secondary Stream Label',
      type: 'localizedString',
      group: 'streaming',
      description: 'e.g. "Watch Startup Stage"',
    }),
    defineField({
      name: 'secondaryStreamUrl',
      title: 'Secondary Stream URL',
      type: 'url',
      group: 'streaming',
    }),
    defineField({ name: 'youtubeChannelUrl', title: 'YouTube Channel URL', type: 'url', group: 'streaming', description: 'Used for the channel promotional link on the Live page.' }),
    // Deprecated — replaced by primaryStreamLabel/URL. Hidden from Studio UI.
    defineField({ name: 'youtubeUrl', title: 'YouTube Stream URL (deprecated)', type: 'url', hidden: true }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label (deprecated)', type: 'localizedString', hidden: true }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { title: 'title.en', subtitle: 'status', slug: 'projectSlug' },
    prepare: ({ title, subtitle, slug }) => ({ title: title ?? 'Untitled Event', subtitle: `${slug} · ${subtitle ?? '?'}` }),
  },
})

// ── Exports ───────────────────────────────────────────────────────────────────

export const eventsSchemaTypes = [
  eventsPageType,
  eventType,
]

import { defineType, defineField, defineArrayMember } from 'sanity'
import { CategorySelectInput } from '@/lib/sanity/fields/CategorySelectInput'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'

// ── Events module — Sanity schema types ───────────────────────────────────────
//
// Owned by: events module (MODULE_REGISTRY id: 'events')
// Platform contract: 4 types
//   eventsListingSection — section object embedded in page.sections (ADR-016 Phase B)
//   eventsPage           — singleton document, one per project
//   eventCategory        — collection document (taxonomy, non-routable — mirrors blogCategory)
//   event                — collection document (routable)
//
// Cross-module references:
//   event is referenced by: livePageType.featuredEvents, blogListingSection.event,
//   postType.relatedEvent — all string-based, resolved by Sanity at runtime.
//   No TypeScript imports are required from those modules.
//   eventCategory is referenced by: event.categories, eventsListingSection.category —
//   both string-based, same-module references.
//
// ADR-011 Phase D1 — extracted from src/lib/sanity/schema.ts.
// ADR-016 Phase B — eventsListingSection + eventCategory added.

// ── Events Listing Section ────────────────────────────────────────────────────
// ADR-016 Phase B — modeled on blogListingSection (src/lib/modules/blog/schema.ts).
// Adds a `timeFilter` (upcoming / live / past / all) alongside the shared
// filter/sort/display fields, since events carry a date dimension blog posts
// don't.
//
// ADR-016 Phase C — `timeFilter: 'live'` added so this generic section can
// reproduce the livePage's "More Live Productions" block (previously a fixed
// field backed by additionalLiveEventsQuery). Semantics: lists events with
// status == "live" (see eventsListingFilter in queries.ts). Known parity
// delta: this filter cannot know which event a co-located liveLatestSection
// is already showing, so — unlike additionalLiveEventsQuery — it does not
// exclude the "current" live event. At Livener's scale (rarely more than one
// simultaneous live event), this is an accepted edge case, not a defect to
// silently work around with cross-section coupling.

const eventsListingSectionType = defineType({
  name: 'eventsListingSection',
  title: 'Events Listing',
  type: 'object',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'filter', title: 'Filter & Sort' },
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
    defineField({ name: 'subtitle', title: 'Subtitle / Description', type: 'localizedString', group: 'content' }),
    // ── Filter & Sort ─────────────────────────────────────────────────────────
    defineField({
      name: 'timeFilter',
      title: 'Time Window',
      type: 'string',
      group: 'filter',
      options: {
        list: [
          { title: 'Upcoming', value: 'upcoming' },
          { title: 'Live now', value: 'live' },
          { title: 'Past', value: 'past' },
          { title: 'All', value: 'all' },
        ],
        layout: 'radio',
      },
      initialValue: 'upcoming',
      description: 'Restricts results to events whose startDate is in the future, currently live (status == "live"), in the past, or no restriction. Combined with the filter below.',
    }),
    defineField({
      name: 'filterMode',
      title: 'Filter',
      type: 'string',
      group: 'filter',
      options: {
        list: [
          { title: 'Latest', value: 'latest' },
          { title: 'Featured only', value: 'featured' },
          { title: 'By Category', value: 'byCategory' },
          { title: 'Manual selection', value: 'manual' },
        ],
        layout: 'radio',
      },
      initialValue: 'latest',
    }),
    defineField({
      name: 'sortOrder',
      title: 'Sort Order',
      type: 'string',
      group: 'filter',
      options: {
        list: [
          { title: 'Newest first', value: 'newest' },
          { title: 'Oldest first', value: 'oldest' },
          { title: 'Manual order', value: 'manual' },
        ],
        layout: 'radio',
      },
      initialValue: 'newest',
      description: '"Manual order" preserves the hand-picked array order below — only meaningful with "Manual selection" filter. "Newest"/"Oldest" sort by startDate.',
    }),
    defineField({
      name: 'categoryKey',
      title: 'Category',
      type: 'array',
      group: 'filter',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Show only entries in this category. Pick one.',
      hidden: ({ parent }) => parent?.filterMode !== 'byCategory',
      // Reuses the multi-select picker rather than inventing a single-select
      // twin; the consumer reads the first entry.
      components: { input: CategorySelectInput },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: { moduleId: 'events' } as any,
    }),
    defineField({
      name: 'events',
      title: 'Events',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'event' }], options: { filter: scopedRef } })],
      group: 'filter',
      description: 'Hand-pick events. Drag to reorder for manual sort order.',
      hidden: ({ parent }) => parent?.filterMode !== 'manual',
    }),
    // ── Display ───────────────────────────────────────────────────────────────
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'string',
      group: 'display',
      options: {
        list: [
          { title: 'Grid', value: 'grid' },
          { title: 'Featured', value: 'featured' },
          { title: 'Magazine', value: 'magazine' },
        ],
        layout: 'radio',
      },
      initialValue: 'grid',
      description: 'Grid: responsive card grid. Featured: one large card, always. Magazine: big card left + small cards right.',
    }),
    defineField({
      name: 'maxItems',
      title: 'Max Events',
      type: 'number',
      group: 'display',
      initialValue: 3,
      description: 'Maximum number of events to display (1–12). Default: 3.',
      validation: (Rule) => Rule.min(1).max(12).integer(),
    }),
    defineField({
      name: 'viewAllLabel',
      title: '"View All" Button Label',
      type: 'localizedString',
      group: 'display',
      description: 'Leave empty to hide the button. Shown when there are more events than Max Events.',
    }),
    defineField({
      name: 'viewAllHref',
      title: '"View All" Button URL',
      type: 'string',
      group: 'display',
      description: 'Where the "View All" button links to — e.g. /events',
    }),
    // ── Empty state (ADR-016 Phase B) ───────────────────────────────────────────
    // Semantics (frontend concern, see hydrateSections / EventsListingSection):
    //   zero items + both fields empty → render nothing (today's behavior)
    //   zero items + a field set       → render the localized empty block
    defineField({
      name: 'emptyStateHeading',
      title: 'Empty State Heading',
      type: 'localizedString',
      group: 'display',
      description: 'Shown instead of the grid when no events match the filter. Leave empty to render nothing.',
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
    select: {
      titleEn: 'title.en',
      filterMode: 'filterMode',
      timeFilter: 'timeFilter',
      layout: 'layout',
    },
    prepare: ({ titleEn, filterMode, timeFilter, layout }: { titleEn?: string; filterMode?: string; timeFilter?: string; layout?: string }) => ({
      title: titleEn ?? 'Events Listing',
      subtitle: `${layout ?? 'grid'} · ${filterMode ?? 'latest'} · ${timeFilter ?? 'upcoming'}`,
    }),
  },
})

// ── Events Page ───────────────────────────────────────────────────────────────
// ADR-016 Phase A: additive `sections[]` composes below the fixed content
// above — no migration, no visual change until a section is actually added.
// Phase C migrates these fixed fields into equivalent sections and retires
// this fixed shape; until then both surfaces coexist.

const eventsPageType = defineType({
  name: 'eventsPage',
  title: 'Events Page',
  type: 'document',
  // ADR-016 Phase C — the fixed `media` group (heroImage, cloudflareVideoId)
  // was retired: neither field had a remaining runtime read (the body is now
  // fully section-driven). `heroTitle`/`heroSubtitle` are KEPT — they are
  // still read as SEO-fallback strings by generateMetadata in
  // src/app/[locale]/(website)/[tenant]/events/page.tsx (title/description
  // fall back to them when seoTitle/seoDescription are unset). `introText`
  // had no remaining read and was retired along with `media`. See migration
  // 002 (populates equivalent sections) + 003 (unsets the retired fields).
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'sections', title: 'Sections' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'e.g. "Events". Kept as an SEO-title fallback — see generateMetadata in events/page.tsx.' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content', description: 'Kept as an SEO-description fallback — see generateMetadata in events/page.tsx.' }),
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
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      // ADR-020 Amendment B — choices come from Modules → Categories for this
      // website, so they cannot be a static options.list. Stores stable keys,
      // never labels, so renaming or translating a category leaves existing
      // content intact.
      components: { input: CategorySelectInput },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: { moduleId: 'events' } as any,
    }),
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
        'Paste a YouTube or Cloudflare Stream URL. The following formats are accepted:\n\n• youtube.com/watch?v=VIDEO_ID (optionally with &list=PLAYLIST_ID)\n• youtu.be/VIDEO_ID\n• youtube.com/playlist?list=PLAYLIST_ID\n• *.cloudflarestream.com/VIDEO_ID/watch\n\nChannel URLs are not supported.',
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

// ── Event Category ─────────────────────────────────────────────────────────────
// ADR-016 Phase B — mirrors blogCategory exactly (src/lib/modules/blog/schema.ts):
// same fields, same localization, same projectSlug scoping, same Studio treatment.
// Non-routable taxonomy type — no slug routing, no redirectFrom (blogCategory has
// neither). Tom's settled decision: follow blogCategory precisely.

const eventCategoryType = defineType({
  name: 'eventCategory',
  title: 'Event Category',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'title',
      title: 'Title',
      type: 'localizedString',
      validation: (Rule) => Rule.required(),
      description: 'e.g. "Conferences", "Workshops", "Webinars", "Product Launches"',
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'localizedSlug',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      name: 'color',
      title: 'Badge Color',
      type: 'string',
      description: 'Label color for category badges — e.g. "blue", "green", "#e94e1b"',
    }),
  ],
  preview: {
    select: { title: 'title.en', slugEn: 'slug.en.current', slugIt: 'slug.it.current' },
    prepare: ({ title, slugEn, slugIt }: { title?: string; slugEn?: string; slugIt?: string }) => ({
      title: title ?? '—',
      subtitle: slugEn ?? slugIt ? `/${slugEn ?? slugIt}` : '—',
    }),
  },
})

// ── Exports ───────────────────────────────────────────────────────────────────

export const eventsSchemaTypes = [
  eventsListingSectionType,
  eventsPageType,
  eventCategoryType,
  eventType,
]

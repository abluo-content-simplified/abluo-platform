import { defineType, defineField, defineArrayMember } from 'sanity'
import { CategorySelectInput } from '@/lib/sanity/fields/CategorySelectInput'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'

// ── News module — Sanity schema types ─────────────────────────────────────────
//
// Owned by: news module (MODULE_REGISTRY id: 'news')
// Platform contract: 4 types
//   newsListingSection — section object embedded in page.sections
//   newsPage           — singleton document, one per project
//   newsCategory       — collection document
//   newsArticle        — collection document (routable, /news/[slug])
//
// ADR-020 Decision "Build the News module (mirrors Blog)".
//
// ── Why News is a separate module and not a Blog category ─────────────────────
//
// The obvious objection to this file is that it looks like Blog with the words
// changed. It is a deliberate separation, for reasons that are editorial rather
// than technical:
//
//   • Different editorial lifecycle. A news item is dated and goes stale; a blog
//     post is evergreen. `expiresAt` matters here in a way it does not there,
//     and News carries no author — practices publish announcements as an
//     organisation, not as a person.
//   • Different URL space. /news/[slug] and /blog/[slug] are separate,
//     separately indexed, and a tenant may want one without the other.
//   • Independent installability, which is the entire point of a module: a
//     dentist may want News and no Blog; an agency the reverse. A category on a
//     shared `post` type cannot be switched off per website, cannot carry its
//     own page, and would drag Blog's authors and taxonomy along with it.
//
// News therefore deliberately does NOT reuse `post`. Where it mirrors Blog's
// field shapes it does so because those shapes are already the right answer, not
// by accident — and the differences above are the ones that matter.
//
// Cross-module references: none. News is self-contained (unlike Blog, whose
// listing section can filter by an Events-module event).

// ── News Listing Section ──────────────────────────────────────────────────────

const newsListingSectionType = defineType({
  name: 'newsListingSection',
  title: 'News Listing',
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
    // No 'byEvent' mode: that exists on the Blog listing because Blog integrates
    // with the Events module. News has no such integration, and offering a
    // filter that can never match anything would be a worse experience than
    // not offering it.
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
      description: '"Manual order" preserves the hand-picked array order below — only meaningful with "Manual selection" filter.',
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
      options: { moduleId: 'news' } as any,
    }),
    defineField({
      name: 'articles',
      title: 'News Items',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'newsArticle' }], options: { filter: scopedRef } })],
      group: 'filter',
      description: 'Hand-pick news items. Drag to reorder for manual sort order.',
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
      title: 'Max Items',
      type: 'number',
      group: 'display',
      initialValue: 3,
      description: 'Maximum number of news items to display (1–12). Default: 3.',
      validation: (Rule) => Rule.min(1).max(12).integer(),
    }),
    defineField({
      name: 'viewAllLabel',
      title: '"View All" Button Label',
      type: 'localizedString',
      group: 'display',
      description: 'Leave empty to hide the button. Shown when there are more items than Max Items.',
    }),
    defineField({
      name: 'viewAllHref',
      title: '"View All" Button URL',
      type: 'string',
      group: 'display',
      description: 'Where the "View All" button links to — e.g. /news',
    }),
    defineField({
      name: 'emptyStateHeading',
      title: 'Empty State Heading',
      type: 'localizedString',
      group: 'display',
      description: 'Shown instead of the grid when no news matches the filter. Leave empty to render nothing.',
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
      layout: 'layout',
    },
    prepare: ({ titleEn, filterMode, layout }: { titleEn?: string; filterMode?: string; layout?: string }) => ({
      title: titleEn ?? 'News Listing',
      subtitle: `${layout ?? 'grid'} · ${filterMode ?? 'latest'}`,
    }),
  },
})

// ── News Page ─────────────────────────────────────────────────────────────────
// Singleton document — one per project. Controls the hero, intro, and SEO of the
// /news listing route.
//
// Mirrors blogPage's post-ADR-016 shape: heroTitle/heroSubtitle are retained as
// SEO fallbacks read by generateMetadata, and the page body is composed from
// `sections[]`. Unlike blogPage there is no legacy fixed-field rendering to
// migrate away from — News is section-driven from the start.

const newsPageType = defineType({
  name: 'newsPage',
  title: 'News Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'sections', title: 'Sections' },
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'heroTitle',
      title: 'Title',
      type: 'localizedString',
      group: 'content',
      description: 'Page headline (e.g. "News & Announcements"). Also used as the SEO title fallback.',
    }),
    defineField({
      name: 'heroSubtitle',
      title: 'Subtitle',
      type: 'localizedText',
      group: 'content',
      description: 'Short intro beneath the headline. Also used as the SEO description fallback.',
    }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      group: 'sections',
      of: PAGE_SECTIONS_OF,
      description: 'The page body. Add a News Listing section to show the news items.',
    }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'News Page', subtitle: slug }),
  },
})

// ── News Category ─────────────────────────────────────────────────────────────

const newsCategoryType = defineType({
  name: 'newsCategory',
  title: 'News Category',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'title',
      title: 'Title',
      type: 'localizedString',
      validation: (Rule) => Rule.required(),
      description: 'e.g. "Announcements", "Press", "Awards", "Opening Hours"',
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

// ── News Article ──────────────────────────────────────────────────────────────
// Routable: /[locale]/[tenant]/news/[slug].
// Satisfies all five requirements of the Publicly Routable Content Pattern
// (CLAUDE.md): localizedSlug + redirectFrom here, three GROQ queries, the route
// with redirect handling and hreflang, sitemap entries, and — being a brand-new
// type with no existing documents — no slug migration to write.

const newsArticleType = defineType({
  name: 'newsArticle',
  title: 'News Item',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'media', title: 'Media' },
    { name: 'relations', title: 'Relations' },
    { name: 'seo', title: 'SEO' },
    { name: 'settings', title: 'Settings' },
    { name: 'redirects', title: 'Redirects' },
  ],
  fields: [
    projectSlugField,

    // ── Content ───────────────────────────────────────────────────────────────
    defineField({
      name: 'title',
      title: 'Title',
      type: 'localizedString',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'localizedSlug',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'redirectFrom',
      title: 'Old Slugs (Redirects)',
      type: 'redirectFrom',
      group: 'redirects',
      description: 'Fill these only when you rename a slug. Old URLs here will 301-redirect to the current slug.',
    }),
    defineField({
      name: 'excerpt',
      title: 'Excerpt',
      type: 'localizedText',
      group: 'content',
      description: 'Short summary shown in news listings and as the default SEO description',
    }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText', group: 'content' }),
    defineField({
      name: 'publishedAt',
      title: 'Go Live Date',
      type: 'datetime',
      group: 'content',
      description: 'The news item becomes visible on the website at this date and time. Leave empty to keep it as a draft.',
    }),

    // ── Media ─────────────────────────────────────────────────────────────────
    defineField({
      name: 'coverImage',
      title: 'Cover Image',
      type: 'localizedImage',
      group: 'media',
      description: 'Used in news listings, the article hero, and social sharing. Falls back to the global OG image if not set.',
    }),

    // ── Relations ─────────────────────────────────────────────────────────────
    // No author. News is published by the organisation, not by a person — which
    // is the main editorial difference from a blog post. If a tenant ever needs
    // bylined news, that is a field addition here, not a reason to merge the
    // two types.
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      group: 'relations',
      of: [defineArrayMember({ type: 'string' })],
      // ADR-020 Amendment B — choices come from Modules → Categories for this
      // website, so they cannot be a static options.list. Stores stable keys,
      // never labels, so renaming or translating a category leaves existing
      // content intact.
      components: { input: CategorySelectInput },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options: { moduleId: 'news' } as any,
    }),

    // ── SEO ───────────────────────────────────────────────────────────────────
    defineField({
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'localizedString',
      group: 'seo',
      description: 'Overrides the title in search results. Leave empty to use the item title.',
    }),
    defineField({
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'localizedText',
      group: 'seo',
      description: 'Overrides the excerpt in search results. Leave empty to use the excerpt.',
    }),
    defineField({
      name: 'seoImage',
      title: 'SEO / Open Graph Image',
      type: 'image',
      group: 'seo',
      options: { hotspot: false },
      description: 'Social sharing image — 1200 × 630px recommended. Falls back to Cover Image, then to the global OG image.',
    }),

    // ── Settings ──────────────────────────────────────────────────────────────
    defineField({
      name: 'expiresAt',
      title: 'Expiry Date',
      type: 'datetime',
      group: 'settings',
      description: 'Optional. The item is automatically hidden from the website after this date — useful for time-limited announcements. Leave empty to keep it live indefinitely.',
    }),
    defineField({
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      group: 'settings',
      initialValue: false,
      description: 'Pin this item at the top of news listings',
    }),
  ],
  preview: {
    select: {
      titleEn: 'title.en',
      titleIt: 'title.it',
      slug: 'projectSlug',
      publishedAt: 'publishedAt',
      media: 'coverImage',
    },
    prepare: ({ titleEn, titleIt, slug, publishedAt, media }: {
      titleEn?: string
      titleIt?: string
      slug?: string
      publishedAt?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      media?: any
    }) => {
      const title = titleEn ?? titleIt ?? 'Untitled'
      const date = publishedAt
        ? new Date(publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Draft'
      return { title, subtitle: `${slug ?? '?'} · ${date}`, media }
    },
  },
})

// ── Exports ───────────────────────────────────────────────────────────────────

export const newsSchemaTypes = [
  newsListingSectionType,
  newsPageType,
  newsCategoryType,
  newsArticleType,
]

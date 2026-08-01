import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'

// ── Blog module — Sanity schema types ─────────────────────────────────────────
//
// Owned by: blog module (MODULE_REGISTRY id: 'blog')
// Platform contract: 5 types
//   blogListingSection — section object embedded in page.sections
//   blogPage           — singleton document, one per project
//   postAuthor         — collection document
//   blogCategory       — collection document
//   post               — collection document (routable)
//
// Cross-module references:
//   blogListingSection.category → blogCategory (same module, string ref)
//   blogListingSection.event    → event (Events module, string ref — no TS import)
//   blogListingSection.posts    → post (same module, string ref)
//   post.author                 → postAuthor (same module, string ref)
//   post.categories             → blogCategory (same module, string ref)
//   post.relatedEvent           → event (Events module, string ref — no TS import)
//
// ADR-011 Phase D1 — extracted from src/lib/sanity/schema.ts.

// ── Blog Listing Section ──────────────────────────────────────────────────────

const blogListingSectionType = defineType({
  name: 'blogListingSection',
  title: 'Blog Listing',
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
      name: 'filterMode',
      title: 'Filter',
      type: 'string',
      group: 'filter',
      options: {
        list: [
          { title: 'Latest', value: 'latest' },
          { title: 'Featured only', value: 'featured' },
          { title: 'By Category', value: 'byCategory' },
          { title: 'By Event', value: 'byEvent' },
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
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{ type: 'blogCategory' }],
      group: 'filter',
      description: 'Choose a category to show only posts in that category.',
      hidden: ({ parent }) => parent?.filterMode !== 'byCategory',
      options: { filter: scopedRef },
    }),
    defineField({
      name: 'event',
      title: 'Event',
      type: 'reference',
      to: [{ type: 'event' }],
      group: 'filter',
      description: 'Show posts linked to this event.',
      hidden: ({ parent }) => parent?.filterMode !== 'byEvent',
      options: { filter: scopedRef },
    }),
    defineField({
      name: 'posts',
      title: 'Posts',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'post' }], options: { filter: scopedRef } })],
      group: 'filter',
      description: 'Hand-pick posts. Drag to reorder for manual sort order.',
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
      title: 'Max Articles',
      type: 'number',
      group: 'display',
      initialValue: 3,
      description: 'Maximum number of articles to display (1–12). Default: 3.',
      validation: (Rule) => Rule.min(1).max(12).integer(),
    }),
    defineField({
      name: 'viewAllLabel',
      title: '"View All" Button Label',
      type: 'localizedString',
      group: 'display',
      description: 'Leave empty to hide the button. Shown when there are more articles than Max Articles.',
    }),
    defineField({
      name: 'viewAllHref',
      title: '"View All" Button URL',
      type: 'string',
      group: 'display',
      description: 'Where the "View All" button links to — e.g. /blog',
    }),
  ],
  preview: {
    select: {
      titleEn: 'title.en',
      filterMode: 'filterMode',
      layout: 'layout',
    },
    prepare: ({ titleEn, filterMode, layout }: { titleEn?: string; filterMode?: string; layout?: string }) => ({
      title: titleEn ?? 'Blog Listing',
      subtitle: `${layout ?? 'grid'} · ${filterMode ?? 'latest'}`,
    }),
  },
})

// ── Blog Page ─────────────────────────────────────────────────────────────────
// Singleton document — one per project.
// Controls the hero, intro text, and SEO of the /blog listing route.
// ADR-016 Phase A: additive `sections[]` composes below the fixed content
// above — no migration, no visual change until a section is actually added.
// Phase C migrates these fixed fields into equivalent sections and retires
// this fixed shape; until then both surfaces coexist.
// Managed by Abluo admin; hidden from the "New Document" menu (ADR-009).

const blogPageType = defineType({
  name: 'blogPage',
  title: 'Blog Page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'sections', title: 'Sections' },
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'eyebrow',
      title: 'Eyebrow',
      type: 'localizedString',
      group: 'content',
      description: 'Small label above the headline (e.g. "Latest Updates")',
    }),
    defineField({
      name: 'heroTitle',
      title: 'Title',
      type: 'localizedString',
      group: 'content',
      description: 'Page headline (e.g. "News & Announcements")',
    }),
    defineField({
      name: 'heroSubtitle',
      title: 'Subtitle',
      type: 'localizedText',
      group: 'content',
      description: 'Short intro beneath the headline',
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
    prepare: ({ slug }) => ({ title: 'Blog Page', subtitle: slug }),
  },
})

// ── Post Author ───────────────────────────────────────────────────────────────

const postAuthorType = defineType({
  name: 'postAuthor',
  title: 'Author',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
      description: 'e.g. "Thomas", "Livener Team", "Studio Martegani"',
    }),
    defineField({
      name: 'role',
      title: 'Role / Title',
      type: 'localizedString',
      description: 'e.g. "Editor", "Founder", "Content Team"',
    }),
    defineField({ name: 'bio', title: 'Bio', type: 'localizedText' }),
    defineField({
      name: 'avatar',
      title: 'Avatar',
      type: 'image',
      options: { hotspot: true },
    }),
    defineField({
      name: 'supabaseUserId',
      title: 'Supabase User ID',
      type: 'string',
      readOnly: true,
      hidden: true,
      description: 'Linked Supabase profile — auto-populated by the platform when user management is connected',
    }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role.en', media: 'avatar' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ title, subtitle, media }: { title?: string; subtitle?: string; media?: any }) => ({
      title: title ?? '—',
      subtitle: subtitle ?? 'Author',
      media,
    }),
  },
})

// ── Blog Category ─────────────────────────────────────────────────────────────

const blogCategoryType = defineType({
  name: 'blogCategory',
  title: 'Category',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'title',
      title: 'Title',
      type: 'localizedString',
      validation: (Rule) => Rule.required(),
      description: 'e.g. "Events", "News", "Insights", "Product Updates"',
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

// ── Blog Post ─────────────────────────────────────────────────────────────────

const postType = defineType({
  name: 'post',
  title: 'Blog Post',
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
      description: 'Short summary shown in article listings and as the default SEO description',
    }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText', group: 'content' }),
    defineField({
      name: 'publishedAt',
      title: 'Go Live Date',
      type: 'datetime',
      group: 'content',
      description: 'The post becomes visible on the website at this date and time. Leave empty to keep it as a draft.',
    }),

    // ── Media ─────────────────────────────────────────────────────────────────
    defineField({
      name: 'coverImage',
      title: 'Cover Image',
      type: 'localizedImage',
      group: 'media',
      description: 'Used in article listings, the article hero, and social sharing. Falls back to the global OG image if not set.',
    }),
    defineField({
      name: 'featuredVideo',
      title: 'Featured Video',
      type: 'object',
      group: 'media',
      description: 'Optional video for video-focused articles — important for Livener and future video customers',
      fields: [
        defineField({
          name: 'provider',
          title: 'Video Provider',
          type: 'string',
          options: {
            list: [
              { title: 'YouTube', value: 'youtube' },
              { title: 'Cloudflare Stream', value: 'cloudflare' },
            ],
            layout: 'radio',
          },
          initialValue: 'youtube',
        }),
        defineField({
          name: 'youtubeUrl',
          title: 'YouTube URL',
          type: 'url',
          description:
            'Accepts youtube.com/watch?v=VIDEO_ID, youtu.be/VIDEO_ID, or youtube.com/playlist?list=PLAYLIST_ID.',
          hidden: ({ parent }: { parent?: { provider?: string } }) => parent?.provider !== 'youtube',
        }),
        defineField({
          name: 'cloudflareVideoId',
          title: 'Cloudflare Video ID',
          type: 'string',
          description: 'The video ID from Cloudflare Stream — e.g. "abc123xyz"',
          hidden: ({ parent }: { parent?: { provider?: string } }) => parent?.provider !== 'cloudflare',
        }),
      ],
    }),

    // ── Relations ─────────────────────────────────────────────────────────────
    defineField({
      name: 'author',
      title: 'Author',
      type: 'reference',
      to: [{ type: 'postAuthor' }],
      group: 'relations',
      options: { filter: scopedRef },
    }),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      group: 'relations',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'blogCategory' }], options: { filter: scopedRef } })],
    }),
    defineField({
      name: 'relatedEvent',
      title: 'Related Event',
      type: 'reference',
      to: [{ type: 'event' }],
      group: 'relations',
      description: 'Link this post to an event — e.g. event preview, live recap, or post-event summary',
      options: { filter: scopedRef },
    }),

    // ── SEO ───────────────────────────────────────────────────────────────────
    defineField({
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'localizedString',
      group: 'seo',
      description: 'Overrides the article title in search results. Leave empty to use the article title.',
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
      description: 'Optional. The post is automatically hidden from the website after this date. Leave empty to keep it live indefinitely.',
    }),
    defineField({
      name: 'featured',
      title: 'Featured Article',
      type: 'boolean',
      group: 'settings',
      initialValue: false,
      description: 'Pin this article at the top of the homepage, blog overview, and landing pages',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export const blogSchemaTypes = [
  blogListingSectionType,
  blogPageType,
  postAuthorType,
  blogCategoryType,
  postType,
]

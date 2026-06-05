import { defineType, defineField, defineArrayMember } from 'sanity'

// ─── Shared fields ────────────────────────────────────────────────────────────

// Localized image — reusable across all tenants
// Includes hotspot, alt text (localized), and optional caption (localized)
const localizedImageType = defineType({
  name: 'localizedImage',
  title: 'Image',
  type: 'image',
  options: { hotspot: true },
  fields: [
    defineField({
      name: 'alt',
      title: 'Alt Text',
      type: 'localizedString',
      description: 'Describe the image for screen readers and SEO',
    }),
    defineField({
      name: 'caption',
      title: 'Caption (optional)',
      type: 'localizedString',
    }),
  ],
})

// Navigation link — used in navLinks and footerLinks arrays
const navigationLinkType = defineType({
  name: 'navigationLink',
  title: 'Navigation Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString' }),
    defineField({ name: 'href', title: 'URL or Path', type: 'string' }),
    defineField({
      name: 'external',
      title: 'Open in new tab',
      type: 'boolean',
      initialValue: false,
    }),
  ],
  preview: {
    select: { title: 'label.en', subtitle: 'href' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

// Social link — platform + URL
const socialLinkType = defineType({
  name: 'socialLink',
  title: 'Social Link',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      options: {
        list: ['youtube', 'instagram', 'linkedin', 'facebook', 'x', 'tiktok', 'threads'],
      },
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'platform', subtitle: 'url' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Social', subtitle }),
  },
})

// Schedule item — used inside event.schedule
const scheduleItemType = defineType({
  name: 'scheduleItem',
  title: 'Schedule Item',
  type: 'object',
  fields: [
    defineField({ name: 'time', title: 'Time', type: 'string', description: 'e.g. 11:00' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'time', subtitle: 'title.en' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

const tenantSlugField = defineField({
  name: 'tenantSlug',
  title: 'Tenant',
  type: 'string',
  description: 'Which client this document belongs to (e.g. studiomartegani)',
  validation: (Rule) => Rule.required(),
})

// ─── Localized primitive types ────────────────────────────────────────────────
// Each text field has an Italian (it) and English (en) version.
// The frontend always falls back to Italian if English is missing.

const localizedStringType = defineType({
  name: 'localizedString',
  title: 'Localized String',
  type: 'object',
  fields: [
    defineField({ name: 'it', title: 'Italian', type: 'string' }),
    defineField({ name: 'en', title: 'English', type: 'string' }),
  ],
})

const localizedTextType = defineType({
  name: 'localizedText',
  title: 'Localized Text',
  type: 'object',
  fields: [
    defineField({ name: 'it', title: 'Italian', type: 'text', rows: 3 }),
    defineField({ name: 'en', title: 'English', type: 'text', rows: 3 }),
  ],
})

const localizedPortableTextType = defineType({
  name: 'localizedPortableText',
  title: 'Localized Rich Text',
  type: 'object',
  fields: [
    defineField({
      name: 'it',
      title: 'Italian',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    }),
    defineField({
      name: 'en',
      title: 'English',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    }),
  ],
})

// ─── Section object types ─────────────────────────────────────────────────────

const heroSectionType = defineType({
  name: 'heroSection',
  title: 'Hero Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedText' }),
    defineField({ name: 'subheadline', title: 'Subheadline', type: 'localizedText' }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'localizedString' }),
    defineField({ name: 'ctaHref', title: 'CTA Button Link', type: 'string' }),
  ],
  preview: {
    select: { title: 'headline.it' },
    prepare: ({ title }) => ({ title: title ?? 'Hero', subtitle: 'Hero Section' }),
  },
})

const contentSectionType = defineType({
  name: 'contentSection',
  title: 'Content Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText' }),
    defineField({
      name: 'imagePosition',
      title: 'Image Position',
      type: 'string',
      options: { list: ['left', 'right'] },
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Content', subtitle: 'Content Section' }),
  },
})

const treatmentCardType = defineType({
  name: 'treatmentCard',
  title: 'Treatment',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'localizedString' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'name.it' },
    prepare: ({ title }) => ({ title: title ?? 'Treatment' }),
  },
})

const treatmentsSectionType = defineType({
  name: 'treatmentsSection',
  title: 'Treatments Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'intro', title: 'Intro Text', type: 'localizedText' }),
    defineField({
      name: 'treatments',
      title: 'Treatments',
      type: 'array',
      of: [defineArrayMember({ type: 'treatmentCard' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Treatments', subtitle: 'Treatments Section' }),
  },
})

const teamMemberType = defineType({
  name: 'teamMemberObject',
  title: 'Team Member',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'role', title: 'Role', type: 'localizedString' }),
    defineField({ name: 'bio', title: 'Bio', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role.it' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Team Member', subtitle }),
  },
})

const teamSectionType = defineType({
  name: 'teamSection',
  title: 'Team Section',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText' }),
    defineField({
      name: 'members',
      title: 'Members',
      type: 'array',
      of: [defineArrayMember({ type: 'teamMemberObject' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Team', subtitle: 'Team Section' }),
  },
})

const textSectionType = defineType({
  name: 'textSection',
  title: 'Text Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'content', title: 'Content', type: 'localizedPortableText' }),
    defineField({
      name: 'backgroundColor',
      title: 'Background',
      type: 'string',
      options: { list: ['white', 'grey', 'dark'] },
      initialValue: 'white',
    }),
  ],
  preview: {
    select: { title: 'title.it', eyebrow: 'eyebrow.it' },
    prepare: ({ title, eyebrow }) => ({
      title: title ?? eyebrow ?? 'Text',
      subtitle: 'Text Section',
    }),
  },
})

const contactSectionType = defineType({
  name: 'contactSection',
  title: 'Contact Section',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText' }),
    defineField({
      name: 'mapEmbedUrl',
      title: 'Google Maps Embed URL',
      type: 'url',
      description: 'Paste the src URL from a Google Maps embed iframe',
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Contact', subtitle: 'Contact Section' }),
  },
})

const faqItemType = defineType({
  name: 'faqItem',
  title: 'FAQ Item',
  type: 'object',
  fields: [
    defineField({ name: 'question', title: 'Question', type: 'localizedString' }),
    defineField({ name: 'answer', title: 'Answer', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'question.it' },
    prepare: ({ title }) => ({ title: title ?? 'FAQ Item' }),
  },
})

const faqSectionType = defineType({
  name: 'faqSection',
  title: 'FAQ Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({
      name: 'items',
      title: 'Questions',
      type: 'array',
      of: [defineArrayMember({ type: 'faqItem' })],
    }),
  ],
  preview: {
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'FAQ', subtitle: 'FAQ Section' }),
  },
})

// ─── Document types ───────────────────────────────────────────────────────────

const siteConfigType = defineType({
  name: 'siteConfig',
  title: 'Site Config',
  type: 'document',
  groups: [
    { name: 'identity', title: 'Identity' },
    { name: 'locales', title: 'Languages' },
    { name: 'navigation', title: 'Navigation' },
    { name: 'contact', title: 'Contact' },
    { name: 'footer', title: 'Footer' },
    { name: 'social', title: 'Social' },
  ],
  fields: [
    tenantSlugField,

    // ── Identity ──
    defineField({
      name: 'siteName',
      title: 'Site Name',
      type: 'string',
      group: 'identity',
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'localizedString',
      group: 'identity',
    }),
    defineField({
      name: 'logo',
      title: 'Logo',
      type: 'localizedImage',
      group: 'identity',
      description: 'Primary logo (used on dark backgrounds)',
    }),
    defineField({
      name: 'logoLight',
      title: 'Logo (Light variant)',
      type: 'localizedImage',
      group: 'identity',
      description: 'Logo for use on light/white backgrounds',
    }),
    defineField({
      name: 'faviconSvg',
      title: 'Favicon (SVG)',
      type: 'image',
      group: 'identity',
      description: 'Favicon in SVG format (preferred for all devices)',
    }),
    defineField({
      name: 'faviconPng',
      title: 'Favicon (PNG)',
      type: 'image',
      group: 'identity',
      description: 'Favicon in PNG format (fallback)',
    }),

    // ── Language & locale ──
    defineField({
      name: 'defaultLocale',
      title: 'Default Language',
      type: 'string',
      group: 'locales',
      description: 'Primary language for this site. Used as fallback in GROQ queries.',
      options: {
        list: [
          { title: 'English', value: 'en' },
          { title: 'Italian', value: 'it' },
          { title: 'German', value: 'de' },
        ],
        layout: 'radio',
      },
      initialValue: 'en',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'supportedLocales',
      title: 'Supported Languages',
      type: 'array',
      group: 'locales',
      description: 'All languages available on this site (order matters — first is default).',
      of: [
        defineArrayMember({
          type: 'string',
          options: {
            list: [
              { title: 'English', value: 'en' },
              { title: 'Italian', value: 'it' },
              { title: 'German', value: 'de' },
            ],
          },
        }),
      ],
      validation: (Rule) => Rule.required().min(1),
    }),

    // ── Navigation ──
    defineField({
      name: 'navLinks',
      title: 'Navigation Links',
      type: 'array',
      group: 'navigation',
      of: [defineArrayMember({ type: 'navigationLink' })],
      description: 'Links shown in the main navigation bar',
    }),
    defineField({
      name: 'showLangSwitcherInNav',
      title: 'Show language switcher in nav',
      type: 'boolean',
      group: 'navigation',
      initialValue: false,
      description: 'If off, the language switcher appears in the footer only',
    }),
    defineField({
      name: 'ctaLabel',
      title: 'Nav CTA Button Label',
      type: 'localizedString',
      group: 'navigation',
    }),
    defineField({
      name: 'ctaHref',
      title: 'Nav CTA Button URL',
      type: 'string',
      group: 'navigation',
    }),

    // ── Contact ──
    defineField({ name: 'phone', title: 'Phone', type: 'string', group: 'contact' }),
    defineField({ name: 'email', title: 'Email', type: 'string', group: 'contact' }),
    defineField({ name: 'address', title: 'Address', type: 'text', rows: 2, group: 'contact' }),

    // ── Footer ──
    defineField({
      name: 'footerLinks',
      title: 'Footer Links',
      type: 'array',
      group: 'footer',
      of: [defineArrayMember({ type: 'navigationLink' })],
      description: 'Links shown in the footer (Privacy Policy, Cookie Policy, etc.)',
    }),
    defineField({
      name: 'footerCtaHeading',
      title: 'Footer CTA Heading',
      type: 'localizedString',
      group: 'footer',
      description: 'e.g. "Request early access" — leave empty to use FooterMinimal',
    }),
    defineField({
      name: 'footerCtaSubtext',
      title: 'Footer CTA Subtext',
      type: 'localizedString',
      group: 'footer',
    }),
    defineField({
      name: 'footerCtaInputPlaceholder',
      title: 'Footer CTA Input Placeholder',
      type: 'localizedString',
      group: 'footer',
    }),
    defineField({
      name: 'footerCtaButtonLabel',
      title: 'Footer CTA Button Label',
      type: 'localizedString',
      group: 'footer',
    }),
    defineField({
      name: 'legalName',
      title: 'Legal Company Name',
      type: 'string',
      group: 'footer',
      description: 'e.g. "Livener Ltd" — shown in footer copyright',
    }),
    defineField({
      name: 'legalAddress',
      title: 'Legal Address',
      type: 'text',
      rows: 2,
      group: 'footer',
    }),
    defineField({
      name: 'registrationInfo',
      title: 'Registration Info',
      type: 'string',
      group: 'footer',
      description: 'e.g. "Registered in England and Wales, company number: 12917008"',
    }),
    defineField({
      name: 'foundedYear',
      title: 'Founded Year',
      type: 'number',
      group: 'footer',
      description: 'Used in copyright line: © {foundedYear}–{currentYear}',
    }),

    // ── Social ──
    defineField({
      name: 'youtubeChannelUrl',
      title: 'YouTube Channel URL',
      type: 'url',
      group: 'social',
    }),
    defineField({
      name: 'socialLinks',
      title: 'Social Links',
      type: 'array',
      group: 'social',
      of: [defineArrayMember({ type: 'socialLink' })],
    }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'tenantSlug', locale: 'defaultLocale' },
    prepare: ({ title, slug, locale }) => ({
      title: title ?? slug ?? 'Site Config',
      subtitle: `${slug} · default: ${locale ?? '?'}`,
    }),
  },
})

// ─── Event document type ──────────────────────────────────────────────────────

const eventType = defineType({
  name: 'event',
  title: 'Event',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'schedule', title: 'Schedule' },
    { name: 'media', title: 'Media' },
    { name: 'streaming', title: 'Streaming' },
    { name: 'meta', title: 'SEO / Meta' },
  ],
  fields: [
    tenantSlugField,

    // ── Identity ──
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
      type: 'slug',
      group: 'content',
      options: { source: 'title.en', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'content',
      options: {
        list: [
          { title: '🟡 Upcoming', value: 'upcoming' },
          { title: '🔴 Live', value: 'live' },
          { title: '⚫ Past', value: 'past' },
        ],
        layout: 'radio',
      },
      initialValue: 'upcoming',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'isCurrentLiveEvent',
      title: 'Feature on /live page',
      type: 'boolean',
      group: 'content',
      initialValue: false,
      description: 'Editorial override: show this event on the /live page regardless of status',
    }),

    // ── Dates & location ──
    defineField({
      name: 'startDate',
      title: 'Start Date & Time',
      type: 'datetime',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'endDate',
      title: 'End Date & Time',
      type: 'datetime',
      group: 'content',
    }),
    defineField({
      name: 'location',
      title: 'Location',
      type: 'localizedString',
      group: 'content',
      description: 'e.g. "Rimini Expo Centre, Italy"',
    }),

    // ── Content ──
    defineField({
      name: 'shortDescription',
      title: 'Short Description',
      type: 'localizedText',
      group: 'content',
      description: 'Used on /events listing page',
    }),
    defineField({
      name: 'fullDescription',
      title: 'Full Description',
      type: 'localizedPortableText',
      group: 'content',
    }),

    // ── Schedule ──
    defineField({
      name: 'schedule',
      title: 'Schedule',
      type: 'array',
      group: 'schedule',
      of: [defineArrayMember({ type: 'scheduleItem' })],
    }),

    // ── Media ──
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'localizedImage',
      group: 'media',
    }),
    defineField({
      name: 'gallery',
      title: 'Gallery',
      type: 'array',
      group: 'media',
      of: [defineArrayMember({ type: 'localizedImage' })],
    }),

    // ── Streaming ──
    defineField({
      name: 'youtubeUrl',
      title: 'YouTube Stream / Video URL',
      type: 'url',
      group: 'streaming',
      description: 'Direct video or stream URL (for embed)',
    }),
    defineField({
      name: 'youtubeChannelUrl',
      title: 'YouTube Channel URL',
      type: 'url',
      group: 'streaming',
    }),
    defineField({
      name: 'ctaLabel',
      title: 'CTA Button Label',
      type: 'localizedString',
      group: 'streaming',
      description: 'e.g. "Watch Live" or "See Recording"',
    }),

    // ── SEO ──
    defineField({
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'localizedString',
      group: 'meta',
    }),
    defineField({
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'localizedText',
      group: 'meta',
    }),
  ],
  orderings: [
    {
      title: 'Start Date (newest first)',
      name: 'startDateDesc',
      by: [{ field: 'startDate', direction: 'desc' }],
    },
  ],
  preview: {
    select: {
      title: 'title.en',
      subtitle: 'status',
      slug: 'tenantSlug',
      media: 'heroImage',
    },
    prepare: ({ title, subtitle, slug }) => ({
      title: title ?? 'Untitled Event',
      subtitle: `${slug} · ${subtitle ?? '?'}`,
    }),
  },
})

const homePageType = defineType({
  name: 'homePage',
  title: 'Home Page',
  type: 'document',
  fields: [
    tenantSlugField,
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      of: [
        defineArrayMember({ type: 'heroSection' }),
        defineArrayMember({ type: 'contentSection' }),
        defineArrayMember({ type: 'treatmentsSection' }),
        defineArrayMember({ type: 'teamSection' }),
        defineArrayMember({ type: 'textSection' }),
        defineArrayMember({ type: 'faqSection' }),
        defineArrayMember({ type: 'contactSection' }),
      ],
    }),
  ],
  preview: {
    select: { slug: 'tenantSlug' },
    prepare: ({ slug }) => ({ title: `Home — ${slug ?? '?'}` }),
  },
})

const postType = defineType({
  name: 'post',
  title: 'Blog Post',
  type: 'document',
  fields: [
    tenantSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title.it' } }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'localizedText' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title.it', slug: 'tenantSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? 'Untitled', subtitle: slug }),
  },
})

// ─── Export ───────────────────────────────────────────────────────────────────

export const schemaTypes = [
  // Localized primitive types
  localizedStringType,
  localizedTextType,
  localizedPortableTextType,
  // Shared object types
  localizedImageType,
  navigationLinkType,
  socialLinkType,
  scheduleItemType,
  // Section object types (studiomartegani)
  heroSectionType,
  contentSectionType,
  treatmentCardType,
  treatmentsSectionType,
  teamMemberType,
  teamSectionType,
  textSectionType,
  contactSectionType,
  faqItemType,
  faqSectionType,
  // Document types
  siteConfigType,
  homePageType,
  postType,
  eventType,
]

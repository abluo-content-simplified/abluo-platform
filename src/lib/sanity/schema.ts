import { defineType, defineField, defineArrayMember } from 'sanity'

// ─── Shared primitive types ───────────────────────────────────────────────────

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

// ─── Shared object types ──────────────────────────────────────────────────────

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
    defineField({ name: 'caption', title: 'Caption (optional)', type: 'localizedString' }),
  ],
})

const navigationLinkType = defineType({
  name: 'navigationLink',
  title: 'Navigation Link',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString' }),
    defineField({ name: 'href', title: 'URL or Path', type: 'string' }),
    defineField({ name: 'external', title: 'Open in new tab', type: 'boolean', initialValue: false }),
  ],
  preview: {
    select: { title: 'label.en', subtitle: 'href' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

const socialLinkType = defineType({
  name: 'socialLink',
  title: 'Social Link',
  type: 'object',
  fields: [
    defineField({
      name: 'platform',
      title: 'Platform',
      type: 'string',
      options: { list: ['youtube', 'instagram', 'linkedin', 'facebook', 'x', 'tiktok', 'threads'] },
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
  ],
  preview: {
    select: { title: 'platform', subtitle: 'url' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Social', subtitle }),
  },
})

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

const whatsappSubjectType = defineType({
  name: 'whatsappSubject',
  title: 'WhatsApp Subject',
  type: 'object',
  fields: [
    defineField({ name: 'subject', title: 'Subject', type: 'localizedString' }),
  ],
  preview: {
    select: { title: 'subject.en' },
    prepare: ({ title }) => ({ title: title ?? '—' }),
  },
})

const emailSubjectType = defineType({
  name: 'emailSubject',
  title: 'Email Subject',
  type: 'object',
  fields: [
    defineField({ name: 'subject', title: 'Subject Line', type: 'localizedString' }),
    defineField({ name: 'firstLine', title: 'First Line of Email Body', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'subject.en' },
    prepare: ({ title }) => ({ title: title ?? '—' }),
  },
})

// ─── projectSlug — the shared linking field ───────────────────────────────────
const projectSlugField = defineField({
  name: 'projectSlug',
  title: 'Project',
  type: 'string',
  description: 'Which project this document belongs to (e.g. livener-main)',
  validation: (Rule) => Rule.required(),
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
    select: { title: 'title.it' },
    prepare: ({ title }) => ({ title: title ?? 'Text', subtitle: 'Text Section' }),
  },
})

const contactSectionType = defineType({
  name: 'contactSection',
  title: 'Contact Section',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText' }),
    defineField({ name: 'mapEmbedUrl', title: 'Google Maps Embed URL', type: 'url' }),
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

// ─── Platform document types (admin-only) ─────────────────────────────────────

const clientType = defineType({
  name: 'client',
  title: 'Client',
  type: 'document',
  fields: [
    defineField({ name: 'displayName', title: 'Display Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'tenantSlug', title: 'Tenant Slug', type: 'string', description: 'URL slug (e.g. livener)', validation: (Rule) => Rule.required() }),
    defineField({ name: 'tenantId', title: 'Tenant ID', type: 'string', description: 'UUID from Supabase' }),
    defineField({ name: 'plan', title: 'Plan', type: 'string', options: { list: ['starter', 'pro', 'enterprise'] }, initialValue: 'starter' }),
    defineField({ name: 'status', title: 'Status', type: 'string', options: { list: ['active', 'inactive', 'suspended'] }, initialValue: 'active' }),
  ],
  preview: {
    select: { title: 'displayName', subtitle: 'tenantSlug' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

const projectType = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  fields: [
    defineField({ name: 'clientRef', title: 'Client', type: 'reference', to: [{ type: 'client' }], validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectName', title: 'Project Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectSlug', title: 'Project Slug', type: 'string', description: 'Used to link all content (e.g. livener-main)', validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectId', title: 'Project ID', type: 'string', description: 'UUID from Supabase' }),
    defineField({ name: 'customDomain', title: 'Custom Domain', type: 'string' }),
    defineField({ name: 'defaultLocale', title: 'Default Locale', type: 'string', options: { list: [{ title: 'English', value: 'en' }, { title: 'Italian', value: 'it' }], layout: 'radio' }, initialValue: 'en' }),
    defineField({ name: 'status', title: 'Status', type: 'string', options: { list: ['active', 'inactive', 'archived'] }, initialValue: 'active' }),
  ],
  preview: {
    select: { title: 'projectName', subtitle: 'projectSlug' },
    prepare: ({ title, subtitle }) => ({ title: title ?? '—', subtitle }),
  },
})

// ─── Design System ────────────────────────────────────────────────────────────

const designSystemType = defineType({
  name: 'designSystem',
  title: 'Design System',
  type: 'document',
  groups: [
    { name: 'colors', title: 'Colors' },
    { name: 'typography', title: 'Typography' },
    { name: 'shape', title: 'Shape & Spacing' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'colorBackground', title: 'Background', type: 'string', group: 'colors' }),
    defineField({ name: 'colorForeground', title: 'Foreground (text)', type: 'string', group: 'colors' }),
    defineField({ name: 'colorPrimary', title: 'Primary', type: 'string', group: 'colors' }),
    defineField({ name: 'colorPrimaryForeground', title: 'Primary Foreground', type: 'string', group: 'colors' }),
    defineField({ name: 'colorAccent', title: 'Accent', type: 'string', group: 'colors' }),
    defineField({ name: 'colorMuted', title: 'Muted', type: 'string', group: 'colors' }),
    defineField({ name: 'colorBorder', title: 'Border', type: 'string', group: 'colors' }),
    defineField({ name: 'colorSurface', title: 'Surface (cards)', type: 'string', group: 'colors' }),
    defineField({ name: 'fontDisplay', title: 'Display Font', type: 'string', group: 'typography' }),
    defineField({ name: 'fontBody', title: 'Body Font', type: 'string', group: 'typography' }),
    defineField({ name: 'fontMono', title: 'Mono Font', type: 'string', group: 'typography' }),
    defineField({ name: 'radiusSm', title: 'Radius Small', type: 'string', group: 'shape' }),
    defineField({ name: 'radiusMd', title: 'Radius Medium', type: 'string', group: 'shape' }),
    defineField({ name: 'radiusLg', title: 'Radius Large', type: 'string', group: 'shape' }),
    defineField({ name: 'radiusFull', title: 'Radius Full (pill)', type: 'string', group: 'shape' }),
    defineField({ name: 'sectionPaddingY', title: 'Section Vertical Padding', type: 'string', group: 'shape' }),
    defineField({ name: 'containerMaxWidth', title: 'Container Max Width', type: 'string', group: 'shape' }),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: `Design System — ${slug ?? '?'}` }),
  },
})

// ─── Site Config ──────────────────────────────────────────────────────────────

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
    projectSlugField,
    defineField({ name: 'siteName', title: 'Site Name', type: 'string', group: 'identity' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString', group: 'identity' }),
    defineField({ name: 'logo', title: 'Logo', type: 'localizedImage', group: 'identity' }),
    defineField({ name: 'logoLight', title: 'Logo (Light variant)', type: 'localizedImage', group: 'identity' }),
    defineField({ name: 'faviconSvg', title: 'Favicon (SVG)', type: 'image', group: 'identity' }),
    defineField({ name: 'faviconPng', title: 'Favicon (PNG)', type: 'image', group: 'identity' }),
    defineField({
      name: 'defaultLocale',
      title: 'Default Language',
      type: 'string',
      group: 'locales',
      options: { list: [{ title: 'English', value: 'en' }, { title: 'Italian', value: 'it' }, { title: 'German', value: 'de' }], layout: 'radio' },
      initialValue: 'en',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'supportedLocales',
      title: 'Supported Languages',
      type: 'array',
      group: 'locales',
      of: [defineArrayMember({ type: 'string', options: { list: [{ title: 'English', value: 'en' }, { title: 'Italian', value: 'it' }, { title: 'German', value: 'de' }] } })],
      validation: (Rule) => Rule.required().min(1),
    }),
    defineField({ name: 'navLinks', title: 'Navigation Links', type: 'array', group: 'navigation', of: [defineArrayMember({ type: 'navigationLink' })] }),
    defineField({ name: 'showLangSwitcherInNav', title: 'Show language switcher in nav', type: 'boolean', group: 'navigation', initialValue: false }),
    defineField({ name: 'ctaLabel', title: 'Nav CTA Button Label', type: 'localizedString', group: 'navigation' }),
    defineField({ name: 'ctaHref', title: 'Nav CTA Button URL', type: 'string', group: 'navigation' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string', group: 'contact' }),
    defineField({ name: 'email', title: 'Email', type: 'string', group: 'contact' }),
    defineField({ name: 'address', title: 'Address', type: 'text', rows: 2, group: 'contact' }),
    defineField({ name: 'contactEmail', title: 'Contact Form Recipient Email', type: 'string', group: 'contact' }),
    defineField({ name: 'mobileNumber', title: 'Mobile Number', type: 'string', group: 'contact' }),
    defineField({ name: 'whatsappNumber', title: 'WhatsApp Number', type: 'string', group: 'contact' }),
    defineField({ name: 'whatsappSubjects', title: 'WhatsApp Subject Options', type: 'array', group: 'contact', of: [defineArrayMember({ type: 'whatsappSubject' })], validation: (Rule) => Rule.max(5) }),
    defineField({ name: 'emailSubjects', title: 'Email Subject Options', type: 'array', group: 'contact', of: [defineArrayMember({ type: 'emailSubject' })], validation: (Rule) => Rule.max(5) }),
    defineField({ name: 'footerLinks', title: 'Footer Links', type: 'array', group: 'footer', of: [defineArrayMember({ type: 'navigationLink' })] }),
    defineField({ name: 'footerCtaHeading', title: 'Footer CTA Heading', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaSubtext', title: 'Footer CTA Subtext', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaInputPlaceholder', title: 'Footer CTA Input Placeholder', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'footerCtaButtonLabel', title: 'Footer CTA Button Label', type: 'localizedString', group: 'footer' }),
    defineField({ name: 'legalName', title: 'Legal Company Name', type: 'string', group: 'footer' }),
    defineField({ name: 'legalAddress', title: 'Legal Address', type: 'text', rows: 2, group: 'footer' }),
    defineField({ name: 'registrationInfo', title: 'Registration Info', type: 'string', group: 'footer' }),
    defineField({ name: 'foundedYear', title: 'Founded Year', type: 'number', group: 'footer' }),
    defineField({ name: 'youtubeChannelUrl', title: 'YouTube Channel URL', type: 'url', group: 'social' }),
    defineField({ name: 'socialLinks', title: 'Social Links', type: 'array', group: 'social', of: [defineArrayMember({ type: 'socialLink' })] }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? slug ?? 'Site Config', subtitle: slug }),
  },
})

// ─── Event ────────────────────────────────────────────────────────────────────

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
    projectSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', group: 'content', options: { source: 'title.en', maxLength: 96 }, validation: (Rule) => Rule.required() }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'content',
      options: { list: [{ title: '🟡 Upcoming', value: 'upcoming' }, { title: '🔴 Live', value: 'live' }, { title: '⚫ Past', value: 'past' }], layout: 'radio' },
      initialValue: 'upcoming',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'isCurrentLiveEvent', title: 'Feature on /live page', type: 'boolean', group: 'content', initialValue: false }),
    defineField({ name: 'startDate', title: 'Start Date & Time', type: 'datetime', group: 'content', validation: (Rule) => Rule.required() }),
    defineField({ name: 'endDate', title: 'End Date & Time', type: 'datetime', group: 'content' }),
    defineField({ name: 'location', title: 'Location', type: 'localizedString', group: 'content' }),
    defineField({ name: 'shortDescription', title: 'Short Description', type: 'localizedText', group: 'content' }),
    defineField({ name: 'fullDescription', title: 'Full Description', type: 'localizedPortableText', group: 'content' }),
    defineField({ name: 'schedule', title: 'Schedule', type: 'array', group: 'schedule', of: [defineArrayMember({ type: 'scheduleItem' })] }),
    defineField({ name: 'heroImage', title: 'Hero Image', type: 'localizedImage', group: 'media' }),
    defineField({ name: 'gallery', title: 'Gallery', type: 'array', group: 'media', of: [defineArrayMember({ type: 'localizedImage' })] }),
    defineField({ name: 'youtubeUrl', title: 'YouTube Stream / Video URL', type: 'url', group: 'streaming' }),
    defineField({ name: 'youtubeChannelUrl', title: 'YouTube Channel URL', type: 'url', group: 'streaming' }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'localizedString', group: 'streaming' }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
  ],
  preview: {
    select: { title: 'title.en', subtitle: 'status', slug: 'projectSlug' },
    prepare: ({ title, subtitle, slug }) => ({ title: title ?? 'Untitled Event', subtitle: `${slug} · ${subtitle ?? '?'}` }),
  },
})

// ─── Home Page ────────────────────────────────────────────────────────────────

const homePageType = defineType({
  name: 'homePage',
  title: 'Home Page',
  type: 'document',
  fields: [
    projectSlugField,
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
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: `Home — ${slug ?? '?'}` }),
  },
})

// ─── Blog Post ────────────────────────────────────────────────────────────────

const postType = defineType({
  name: 'post',
  title: 'Blog Post',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title.it' } }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'localizedText' }),
    defineField({ name: 'body', title: 'Body', type: 'localizedPortableText' }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title.it', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? 'Untitled', subtitle: slug }),
  },
})

// ─── Export ───────────────────────────────────────────────────────────────────

export const schemaTypes = [
  localizedStringType,
  localizedTextType,
  localizedPortableTextType,
  localizedImageType,
  navigationLinkType,
  socialLinkType,
  scheduleItemType,
  whatsappSubjectType,
  emailSubjectType,
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
  clientType,
  projectType,
  designSystemType,
  siteConfigType,
  homePageType,
  postType,
  eventType,
]

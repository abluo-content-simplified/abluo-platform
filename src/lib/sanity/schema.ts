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
    defineField({ name: 'tenantSlug', title: 'Tenant Slug', type: 'string', description: 'URL slug (e.g. livener) — set by platform, do not edit', readOnly: true, validation: (Rule) => Rule.required() }),
    defineField({ name: 'tenantId', title: 'Tenant ID', type: 'string', description: 'UUID from Supabase — set by platform, do not edit', readOnly: true }),
    defineField({ name: 'createdAt', title: 'Created At', type: 'datetime', description: 'Set by platform on creation', readOnly: true }),
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
    defineField({ name: 'clientRef', title: 'Client', type: 'reference', to: [{ type: 'client' }], readOnly: true, validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectName', title: 'Project Name', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectSlug', title: 'Project Slug', type: 'string', description: 'Used to link all content (e.g. livener-main) — set by platform, do not edit', readOnly: true, validation: (Rule) => Rule.required() }),
    defineField({ name: 'projectId', title: 'Project ID', type: 'string', description: 'UUID from Supabase — set by platform, do not edit', readOnly: true }),
    defineField({ name: 'createdAt', title: 'Created At', type: 'datetime', description: 'Set by platform on creation', readOnly: true }),
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

const colorThemeType = defineType({
  name: 'colorTheme',
  title: 'Color Theme',
  type: 'object',
  fields: [
    defineField({ name: 'background', title: 'Background', type: 'string' }),
    defineField({ name: 'backgroundAlt', title: 'Background Alt', type: 'string' }),
    defineField({ name: 'primary', title: 'Primary', type: 'string' }),
    defineField({ name: 'secondary', title: 'Secondary', type: 'string' }),
    defineField({ name: 'accent', title: 'Accent', type: 'string' }),
    defineField({ name: 'textPrimary', title: 'Text Primary', type: 'string' }),
    defineField({ name: 'textSecondary', title: 'Text Secondary', type: 'string' }),
    defineField({ name: 'border', title: 'Border', type: 'string' }),
    defineField({ name: 'success', title: 'Success', type: 'string' }),
    defineField({ name: 'warning', title: 'Warning', type: 'string' }),
    defineField({ name: 'danger', title: 'Danger', type: 'string' }),
  ],
})

const typescaleType = defineType({
  name: 'typescale',
  title: 'Type Scale',
  type: 'object',
  fields: [
    defineField({ name: 'size', title: 'Size (px)', type: 'number' }),
    defineField({ name: 'weight', title: 'Weight', type: 'number' }),
    defineField({ name: 'lineHeight', title: 'Line Height', type: 'number' }),
  ],
})

const buttonStyleType = defineType({
  name: 'buttonStyle',
  title: 'Button Style',
  type: 'object',
  fields: [
    defineField({ name: 'background', title: 'Background', type: 'string' }),
    defineField({ name: 'text', title: 'Text Color', type: 'string' }),
    defineField({ name: 'borderRadius', title: 'Border Radius (px)', type: 'number' }),
  ],
})

const designSystemType = defineType({
  name: 'designSystem',
  title: 'Design System',
  type: 'document',
  groups: [
    { name: 'meta', title: 'Info' },
    { name: 'branding', title: 'Branding' },
    { name: 'colors', title: 'Colors' },
    { name: 'typography', title: 'Typography' },
    { name: 'shape', title: 'Shape & Spacing' },
    { name: 'components', title: 'Components' },
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'name', title: 'Name', type: 'string', group: 'meta' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 2, group: 'meta' }),

    // Branding
    defineField({
      name: 'branding',
      title: 'Branding',
      type: 'object',
      group: 'branding',
      fields: [
        defineField({ name: 'logo', title: 'Logo (dark background)', type: 'image', options: { hotspot: false } }),
        defineField({ name: 'logoLight', title: 'Logo (light background)', type: 'image', options: { hotspot: false } }),
        defineField({ name: 'favicon', title: 'Favicon', type: 'image', options: { hotspot: false } }),
      ],
    }),

    // Colors
    defineField({
      name: 'colors',
      title: 'Colors',
      type: 'object',
      group: 'colors',
      fields: [
        defineField({ name: 'lightTheme', title: 'Light Theme', type: 'colorTheme' }),
        defineField({ name: 'darkTheme', title: 'Dark Theme', type: 'colorTheme' }),
      ],
    }),

    // Typography
    defineField({
      name: 'typography',
      title: 'Typography',
      type: 'object',
      group: 'typography',
      fields: [
        defineField({ name: 'headingFont', title: 'Heading Font', type: 'string' }),
        defineField({ name: 'bodyFont', title: 'Body Font', type: 'string' }),
        defineField({ name: 'h1', title: 'H1', type: 'typescale' }),
        defineField({ name: 'h2', title: 'H2', type: 'typescale' }),
        defineField({ name: 'h3', title: 'H3', type: 'typescale' }),
        defineField({ name: 'body', title: 'Body', type: 'typescale' }),
        defineField({ name: 'small', title: 'Small', type: 'typescale' }),
      ],
    }),

    // Radius
    defineField({
      name: 'radius',
      title: 'Border Radius',
      type: 'object',
      group: 'shape',
      fields: [
        defineField({ name: 'small', title: 'Small (px)', type: 'number' }),
        defineField({ name: 'medium', title: 'Medium (px)', type: 'number' }),
        defineField({ name: 'large', title: 'Large (px)', type: 'number' }),
      ],
    }),

    // Spacing
    defineField({
      name: 'spacing',
      title: 'Spacing',
      type: 'object',
      group: 'shape',
      fields: [
        defineField({ name: 'xs', title: 'XS (px)', type: 'number' }),
        defineField({ name: 's', title: 'S (px)', type: 'number' }),
        defineField({ name: 'm', title: 'M (px)', type: 'number' }),
        defineField({ name: 'l', title: 'L (px)', type: 'number' }),
        defineField({ name: 'xl', title: 'XL (px)', type: 'number' }),
      ],
    }),

    // Buttons
    defineField({
      name: 'buttons',
      title: 'Buttons',
      type: 'object',
      group: 'components',
      fields: [
        defineField({ name: 'primary', title: 'Primary Button', type: 'buttonStyle' }),
        defineField({ name: 'secondary', title: 'Secondary Button', type: 'buttonStyle' }),
      ],
    }),

    // Cards
    defineField({
      name: 'cards',
      title: 'Cards',
      type: 'object',
      group: 'components',
      fields: [
        defineField({ name: 'background', title: 'Background', type: 'string' }),
        defineField({ name: 'border', title: 'Border', type: 'string' }),
      ],
    }),
  ],
  preview: {
    select: { title: 'name', slug: 'projectSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? `Design System — ${slug ?? '?'}`, subtitle: slug }),
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
    { name: 'live', title: 'Live Page' },
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
    defineField({ name: 'livePageHeadline', title: 'Live Page Headline', type: 'localizedString', group: 'live', description: 'e.g. "Welcome to Livener"' }),
    defineField({ name: 'livePageSubheadline', title: 'Live Page Subheadline', type: 'localizedString', group: 'live', description: 'e.g. "Live video streaming, in the palm of your hands"' }),
    defineField({ name: 'livePageBetaNotice', title: 'Live Page Beta Notice', type: 'localizedString', group: 'live', description: 'e.g. "Currently in beta — tested live, in real environments."' }),
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
  colorThemeType,
  typescaleType,
  buttonStyleType,
  designSystemType,
  siteConfigType,
  homePageType,
  postType,
  eventType,
]

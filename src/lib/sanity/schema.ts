import { defineType, defineField, defineArrayMember } from 'sanity'

// ─── Shared fields ────────────────────────────────────────────────────────────

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
  fields: [
    tenantSlugField,
    defineField({ name: 'siteName', title: 'Site Name', type: 'string' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'localizedString' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string' }),
    defineField({ name: 'email', title: 'Email', type: 'string' }),
    defineField({ name: 'address', title: 'Address', type: 'text', rows: 2 }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'tenantSlug' },
    prepare: ({ title, slug }) => ({ title: title ?? slug ?? 'Site Config' }),
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
  // Object types (used inside arrays)
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
]

import { defineType, defineField, defineArrayMember } from 'sanity'

// ─── Shared fields ────────────────────────────────────────────────────────────

const tenantSlugField = defineField({
  name: 'tenantSlug',
  title: 'Tenant',
  type: 'slug',
  description: 'Which client this document belongs to (e.g. studiomartegani)',
  validation: (Rule) => Rule.required(),
})

// ─── Section object types ─────────────────────────────────────────────────────

const heroSectionType = defineType({
  name: 'heroSection',
  title: 'Hero Section',
  type: 'object',
  fields: [
    defineField({ name: 'headline', title: 'Headline', type: 'text', rows: 2 }),
    defineField({ name: 'subheadline', title: 'Subheadline', type: 'text', rows: 2 }),
    defineField({ name: 'ctaLabel', title: 'CTA Button Label', type: 'string' }),
    defineField({ name: 'ctaHref', title: 'CTA Button Link', type: 'string' }),
  ],
  preview: {
    select: { title: 'headline' },
    prepare: ({ title }) => ({ title: title ?? 'Hero', subtitle: 'Hero Section' }),
  },
})

const contentSectionType = defineType({
  name: 'contentSection',
  title: 'Content Section',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    }),
    defineField({
      name: 'imagePosition',
      title: 'Image Position',
      type: 'string',
      options: { list: ['left', 'right'] },
    }),
  ],
  preview: {
    select: { title: 'title' },
    prepare: ({ title }) => ({ title: title ?? 'Content', subtitle: 'Content Section' }),
  },
})

const treatmentCardType = defineType({
  name: 'treatmentCard',
  title: 'Treatment',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'tagline', title: 'Tagline', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 3 }),
  ],
  preview: {
    select: { title: 'name' },
    prepare: ({ title }) => ({ title: title ?? 'Treatment' }),
  },
})

const treatmentsSectionType = defineType({
  name: 'treatmentsSection',
  title: 'Treatments Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'string' }),
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'intro', title: 'Intro Text', type: 'text', rows: 2 }),
    defineField({
      name: 'treatments',
      title: 'Treatments',
      type: 'array',
      of: [defineArrayMember({ type: 'treatmentCard' })],
    }),
  ],
  preview: {
    select: { title: 'title' },
    prepare: ({ title }) => ({ title: title ?? 'Treatments', subtitle: 'Treatments Section' }),
  },
})

const teamMemberType = defineType({
  name: 'teamMemberObject',
  title: 'Team Member',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'string' }),
    defineField({ name: 'role', title: 'Role', type: 'string' }),
    defineField({ name: 'bio', title: 'Bio', type: 'text', rows: 3 }),
  ],
  preview: {
    select: { title: 'name', subtitle: 'role' },
    prepare: ({ title, subtitle }) => ({ title: title ?? 'Team Member', subtitle }),
  },
})

const teamSectionType = defineType({
  name: 'teamSection',
  title: 'Team Section',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'string' }),
    defineField({
      name: 'members',
      title: 'Members',
      type: 'array',
      of: [defineArrayMember({ type: 'teamMemberObject' })],
    }),
  ],
  preview: {
    select: { title: 'title' },
    prepare: ({ title }) => ({ title: title ?? 'Team', subtitle: 'Team Section' }),
  },
})

const textSectionType = defineType({
  name: 'textSection',
  title: 'Text Section',
  type: 'object',
  fields: [
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'string' }),
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({
      name: 'content',
      title: 'Content',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    }),
    defineField({
      name: 'backgroundColor',
      title: 'Background',
      type: 'string',
      options: { list: ['white', 'grey', 'dark'] },
      initialValue: 'white',
    }),
  ],
  preview: {
    select: { title: 'title', eyebrow: 'eyebrow' },
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
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'text', rows: 2 }),
    defineField({
      name: 'mapEmbedUrl',
      title: 'Google Maps Embed URL',
      type: 'url',
      description: 'Paste the src URL from a Google Maps embed iframe',
    }),
  ],
  preview: {
    select: { title: 'title' },
    prepare: ({ title }) => ({ title: title ?? 'Contact', subtitle: 'Contact Section' }),
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
    defineField({ name: 'tagline', title: 'Tagline', type: 'string' }),
    defineField({ name: 'phone', title: 'Phone', type: 'string' }),
    defineField({ name: 'email', title: 'Email', type: 'string' }),
    defineField({ name: 'address', title: 'Address', type: 'text', rows: 2 }),
  ],
  preview: {
    select: { title: 'siteName', slug: 'tenantSlug.current' },
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
        defineArrayMember({ type: 'contactSection' }),
      ],
    }),
  ],
  preview: {
    select: { slug: 'tenantSlug.current' },
    prepare: ({ slug }) => ({ title: `Home — ${slug ?? '?'}` }),
  },
})

const postType = defineType({
  name: 'post',
  title: 'Blog Post',
  type: 'document',
  fields: [
    tenantSlugField,
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'title' } }),
    defineField({ name: 'excerpt', title: 'Excerpt', type: 'text', rows: 2 }),
    defineField({
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [defineArrayMember({ type: 'block' })],
    }),
    defineField({ name: 'publishedAt', title: 'Published At', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title', slug: 'tenantSlug.current' },
    prepare: ({ title, slug }) => ({ title: title ?? 'Untitled', subtitle: slug }),
  },
})

// ─── Export ───────────────────────────────────────────────────────────────────

export const schemaTypes = [
  // Object types (used inside arrays)
  heroSectionType,
  contentSectionType,
  treatmentCardType,
  treatmentsSectionType,
  teamMemberType,
  teamSectionType,
  textSectionType,
  contactSectionType,
  // Document types
  siteConfigType,
  homePageType,
  postType,
]

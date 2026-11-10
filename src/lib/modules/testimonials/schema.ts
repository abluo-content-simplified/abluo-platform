import { defineType, defineField, defineArrayMember } from 'sanity'
import { projectSlugField, anchorIdField, headlineAccentField, scopedRef, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'
import { validateUniquePublicId } from '@/lib/sanity/fields/public-id'
import { PUBLISHING_GROUP, archivedFields, publishingStatusField, unpublishOnField } from '@/lib/sanity/fields/publishing'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import {
  DEFAULT_TESTIMONIAL_LAYOUT,
  DEFAULT_TESTIMONIAL_LIMIT,
  DEFAULT_TESTIMONIAL_SELECTION,
  MAX_TESTIMONIAL_LIMIT,
  TESTIMONIAL_LAYOUTS,
  TESTIMONIAL_RATING,
  TESTIMONIAL_SELECTIONS,
  TESTIMONIAL_SOURCES,
} from './model'

// ── Testimonials module — Sanity schema types (ADR-048) ───────────────────────
//
// Owned by: testimonials module (MODULE_REGISTRY id: 'testimonials')
//   testimonial         — collection document: what one person said (D2). PUBLIC
//                         fields only: full name, email, phone and notes live in
//                         Supabase testimonial_private (migration 067, D3).
//   testimonialsSection — section object embedded in page.sections (D5). A
//                         section only PRESENTS testimonials; it owns none.
//
// Everything here is new: no existing field changes type.
//
// Every text field is localized (D6): `context`, `abstract` and `body` carry the
// hidden `translationStatus` of the shared localized types, so the Translate
// button works on them and the website can label machine text.

const SOURCE_TITLES: Record<(typeof TESTIMONIAL_SOURCES)[number], string> = {
  website: 'Our website',
  google: 'Google',
  facebook: 'Facebook',
  trustpilot: 'Trustpilot',
  other: 'Other',
}

const SELECTION_TITLES: Record<(typeof TESTIMONIAL_SELECTIONS)[number], string> = {
  featured: 'Featured testimonials',
  latest: 'The latest',
  tag: 'One tag',
  selected: 'Hand-picked',
}

const LAYOUT_TITLES: Record<(typeof TESTIMONIAL_LAYOUTS)[number], string> = {
  carousel: 'Carousel',
  grid: 'Grid',
}

// ── Testimonial ───────────────────────────────────────────────────────────────

const testimonialType = defineType({
  name: 'testimonial',
  title: 'Testimonial',
  type: 'document',
  groups: [
    { name: 'content', title: 'Testimonial', default: true },
    { name: 'details', title: 'Details' },
    PUBLISHING_GROUP,
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'publicId',
      title: 'Public ID',
      type: 'string',
      readOnly: true,
      group: 'details',
      description: 'Permanent id that links this testimonial to its private contact details. Set automatically; never changes.',
      validation: (Rule) => Rule.custom((value, context) => validateUniquePublicId(value, context)),
    }),
    // ── Testimonial ──────────────────────────────────────────────────────────
    defineField({
      name: 'displayName',
      title: 'Name as shown',
      type: 'string',
      group: 'content',
      description: 'As the person wants it shown: full name, a nickname or initials. Not translated.',
    }),
    defineField({
      name: 'anonymous',
      title: 'Show as anonymous',
      type: 'boolean',
      group: 'content',
      initialValue: false,
      description: 'The website shows "Anonymous" (in the visitor’s language) instead of the name.',
    }),
    defineField({
      name: 'context',
      title: 'Context',
      type: 'localizedString',
      group: 'content',
      description: 'Optional short line, e.g. "Member since 2019" or "Hatha course".',
    }),
    defineField({
      name: 'age',
      title: 'Age',
      type: 'number',
      group: 'content',
      description: 'Optional.',
      validation: (Rule) => Rule.integer().min(0).max(120),
    }),
    defineField({
      name: 'abstract',
      title: 'Short version',
      type: 'localizedText',
      group: 'content',
      description: 'Optional. Left empty, the first lines of the full text are shown on the card.',
    }),
    defineField({
      name: 'body',
      title: 'Testimonial',
      type: 'localizedText',
      group: 'content',
      description: 'The full testimonial, as plain paragraphs.',
    }),
    defineField({
      name: 'originalLocale',
      title: 'Written in',
      type: 'string',
      group: 'content',
      description: 'The language the person wrote it in. The website says "Translated from …" when it shows a machine translation.',
      options: { list: LOCALE_CODES.map((code) => ({ title: code.toUpperCase(), value: code })) },
    }),
    defineField({
      name: 'rating',
      title: 'Rating',
      type: 'number',
      group: 'content',
      description: 'Optional, 1 to 5. Never required of anyone.',
      options: { list: [1, 2, 3, 4, 5].map((n) => ({ title: String(n), value: n })) },
      validation: (Rule) => Rule.integer().min(TESTIMONIAL_RATING.min).max(TESTIMONIAL_RATING.max),
    }),
    defineField({
      name: 'photo',
      title: 'Photo',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      group: 'content',
      description: 'Optional. A Media Library image of the person, shown only when the website’s Testimonials setting "Show photos" is on. Only with the person’s agreement.',
      options: { filter: scopedRef },
    }),
    // ── Details ──────────────────────────────────────────────────────────────
    defineField({
      name: 'givenOn',
      title: 'Given on',
      type: 'date',
      group: 'details',
      description: 'When the person gave it.',
    }),
    defineField({
      name: 'source',
      title: 'Source',
      type: 'string',
      group: 'details',
      initialValue: 'website',
      description: 'Where it was given. Attribution only — never shown as "verified".',
      options: { list: TESTIMONIAL_SOURCES.map((value) => ({ title: SOURCE_TITLES[value], value })), layout: 'radio' },
    }),
    defineField({
      name: 'sourceUrl',
      title: 'Link to the original',
      type: 'url',
      group: 'details',
      validation: (Rule) => Rule.uri({ scheme: ['http', 'https'] }),
    }),
    defineField({
      // ADR-048 D2 / ADR-020 B — keys of the "Testimonials" tags in Categories & Tags (module testimonials, kind tag).
      name: 'tags',
      title: 'Tags',
      type: 'array',
      group: 'details',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Stable keys of the Testimonials tags (Categories & Tags). Renaming a tag never changes these.',
    }),
    // ── Publishing (Tom: every publishing field in one tab) ──────────────────
    publishingStatusField('optional'),
    defineField({
      name: 'permissionToPublish',
      title: 'Permission to publish',
      type: 'boolean',
      group: PUBLISHING_GROUP.name,
      initialValue: false,
      description: 'The person agreed to have this shown on the website. Without it, the testimonial can be saved but never published.',
    }),
    defineField({
      name: 'featured',
      title: 'Featured',
      type: 'boolean',
      group: PUBLISHING_GROUP.name,
      initialValue: false,
      description: 'Sections set to "Featured testimonials" show these.',
    }),
    // ADR-048 D2 — Draft · Published · Unpublished · Archived. No scheduling:
    // unpublishing sets this date to "now" (written by the dashboard).
    {
      ...unpublishOnField('Set when a testimonial is unpublished from the dashboard. Remove it to bring the testimonial back (it must still have permission to publish).'),
      readOnly: true,
    },
    ...archivedFields(),
  ],
  orderings: [
    { name: 'givenOnDesc', title: 'Given on, newest first', by: [{ field: 'givenOn', direction: 'desc' }] },
    { name: 'updatedDesc', title: 'Last edited', by: [{ field: '_updatedAt', direction: 'desc' }] },
  ],
  preview: {
    select: {
      name: 'displayName',
      anonymous: 'anonymous',
      body: 'body',
      rating: 'rating',
      permission: 'permissionToPublish',
      archivedAt: 'archivedAt',
      projectSlug: 'projectSlug',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ name, anonymous, body, rating, permission, archivedAt, projectSlug }: Record<string, any>) => {
      const text = body
        ? [body.en, ...LOCALE_CODES.map((c) => body[c])].find((v) => typeof v === 'string' && v.trim())
        : undefined
      const stars = typeof rating === 'number' ? '★'.repeat(Math.max(0, Math.min(5, rating))) : undefined
      return {
        title: anonymous ? 'Anonymous' : name || 'Unnamed testimonial',
        subtitle: [
          typeof text === 'string' ? text.replace(/\s+/g, ' ').slice(0, 70) : undefined,
          stars,
          permission ? undefined : 'No permission yet',
          archivedAt ? 'Archived' : undefined,
          projectSlug,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    },
  },
})

// ── Testimonials section (D5) ─────────────────────────────────────────────────

const testimonialsSectionType = defineType({
  name: 'testimonialsSection',
  title: 'Testimonials Section',
  type: 'object',
  fields: [
    anchorIdField(),
    defineField({
      name: 'background',
      title: 'Background Surface',
      type: 'string',
      options: { list: BACKGROUND_SURFACE_OPTIONS },
      initialValue: 'usePagePattern',
    }),
    defineField({ name: 'eyebrow', title: 'Eyebrow Label', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    headlineAccentField(),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedText', description: 'Optional. Shown under the title.' }),
    defineField({
      name: 'selectionMode',
      title: 'Which testimonials',
      type: 'string',
      initialValue: DEFAULT_TESTIMONIAL_SELECTION,
      options: { list: TESTIMONIAL_SELECTIONS.map((value) => ({ title: SELECTION_TITLES[value], value })), layout: 'radio' },
      description: 'Only published testimonials with permission to publish are ever shown.',
    }),
    defineField({
      name: 'limit',
      title: 'How many',
      type: 'number',
      initialValue: DEFAULT_TESTIMONIAL_LIMIT,
      validation: (Rule) => Rule.integer().min(1).max(MAX_TESTIMONIAL_LIMIT),
      hidden: ({ parent }) => parent?.selectionMode === 'selected',
    }),
    defineField({
      name: 'tagKey',
      title: 'Tag',
      type: 'string',
      description: 'The key of a Testimonials tag (Categories & Tags).',
      hidden: ({ parent }) => parent?.selectionMode !== 'tag',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const parent = context.parent as { selectionMode?: string } | undefined
          return parent?.selectionMode === 'tag' && !value ? 'Choose a tag.' : true
        }),
    }),
    defineField({
      name: 'testimonials',
      title: 'Testimonials',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'testimonial' }], weak: true, options: { filter: scopedRef } })],
      description: 'In the order to show them. Only this website’s testimonials are listed.',
      hidden: ({ parent }) => parent?.selectionMode !== 'selected',
      validation: (Rule) => Rule.unique(),
    }),
    defineField({
      name: 'layout',
      title: 'Layout',
      type: 'string',
      initialValue: DEFAULT_TESTIMONIAL_LAYOUT,
      options: { list: TESTIMONIAL_LAYOUTS.map((value) => ({ title: LAYOUT_TITLES[value], value })), layout: 'radio' },
    }),
    defineField({ name: 'showRating', title: 'Show the rating', type: 'boolean', initialValue: true }),
    defineField({ name: 'showDate', title: 'Show the date', type: 'boolean', initialValue: false }),
    defineField({ name: 'showSource', title: 'Show where it was given', type: 'boolean', initialValue: false }),
    defineField({
      name: 'showDisclosure',
      title: 'Show the permission line',
      type: 'boolean',
      initialValue: true,
      description: 'A small line saying the testimonials are selected and published with permission. Wording comes from the interface dictionary, in the visitor’s language.',
    }),
  ],
  preview: {
    select: { title: 'title.en', titleIt: 'title.it', mode: 'selectionMode', layout: 'layout' },
    prepare: ({ title, titleIt, mode, layout }: { title?: string; titleIt?: string; mode?: string; layout?: string }) => ({
      title: title ?? titleIt ?? 'Testimonials',
      subtitle: ['Testimonials Section', mode ? SELECTION_TITLES[mode as keyof typeof SELECTION_TITLES] ?? mode : undefined, layout ? LAYOUT_TITLES[layout as keyof typeof LAYOUT_TITLES] ?? layout : undefined]
        .filter(Boolean)
        .join(' · '),
    }),
  },
})

export const testimonialsSchemaTypes = [testimonialType, testimonialsSectionType]

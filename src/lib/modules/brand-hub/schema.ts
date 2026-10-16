import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField } from '@/lib/sanity/fields/shared'

// ── Brand Hub module — Sanity schema (ADR-036) ────────────────────────────────
//
// Owned by: brandHub module (MODULE_REGISTRY id: 'brandHub')
//   brandGuide           — one document per project: the WRITTEN part of the hub
//   brandGuidePage       — object: one page's guidance (rich text + do/don't)
//   brandGuideExample    — object: one do / don't example
//
// ADR-036 D2 — this document holds NO design values: no colour, size or font.
// Every value on the hub is read live from the design system and site settings.
// A test (brand-hub-schema.test.ts) fails if a value field appears here.

/** Hub pages that carry written guidance (Overview has `intro`). */
export const BRAND_GUIDE_PAGE_FIELDS = ['colour', 'typography', 'shape', 'layout', 'logo', 'motion'] as const

const brandGuideExampleType = defineType({
  name: 'brandGuideExample',
  title: 'Do / don’t example',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: { list: [{ title: 'Do', value: 'do' }, { title: 'Don’t', value: 'dont' }], layout: 'radio', direction: 'horizontal' },
      initialValue: 'do',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'mediaAsset',
      title: 'Image',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      options: { filter: scopedRef },
      description: 'Pick it from the Media Library (every image lives there first).',
    }),
    defineField({ name: 'caption', title: 'Caption', type: 'localizedString' }),
  ],
  preview: {
    select: { kind: 'kind', caption: 'caption.en', media: 'mediaAsset.image' },
    prepare: ({ kind, caption, media }) => ({
      title: caption || '(no caption)',
      subtitle: kind === 'dont' ? 'Don’t' : 'Do',
      media,
    }),
  },
})

const brandGuidePageType = defineType({
  name: 'brandGuidePage',
  title: 'Page guidance',
  type: 'object',
  fields: [
    defineField({
      name: 'body',
      title: 'Guidance',
      type: 'localizedPortableText',
      description: 'Rules and explanations shown above the generated values.',
    }),
    defineField({
      name: 'doDont',
      title: 'Do / don’t examples',
      type: 'array',
      of: [defineArrayMember({ type: 'brandGuideExample' })],
    }),
  ],
})

const PAGE_TITLES: Record<(typeof BRAND_GUIDE_PAGE_FIELDS)[number], string> = {
  colour: 'Colour',
  typography: 'Typography',
  shape: 'Shape & spacing',
  layout: 'Layout',
  logo: 'Logo & assets',
  motion: 'Motion',
}

const brandGuideType = defineType({
  name: 'brandGuide',
  title: 'Brand guide',
  type: 'document',
  groups: [
    { name: 'overview', title: 'Overview', default: true },
    ...BRAND_GUIDE_PAGE_FIELDS.map((p) => ({ name: p, title: PAGE_TITLES[p] })),
  ],
  fields: [
    { ...projectSlugField, hidden: true, group: 'overview' },
    defineField({
      name: 'version',
      title: 'Version',
      type: 'number',
      group: 'overview',
      initialValue: 1,
      description: 'Shown on every hub page. Raise it when the guide reaches a new edition. "Last updated" is automatic.',
      validation: (Rule) => Rule.required().integer().min(1),
    }),
    defineField({
      name: 'intro',
      title: 'Introduction',
      type: 'localizedPortableText',
      group: 'overview',
      description: 'Opening text of the brand hub.',
    }),
    ...BRAND_GUIDE_PAGE_FIELDS.map((p) =>
      defineField({ name: p, title: PAGE_TITLES[p], type: 'brandGuidePage', group: p }),
    ),
  ],
  preview: {
    select: { version: 'version', projectSlug: 'projectSlug' },
    prepare: ({ version, projectSlug }) => ({
      title: 'Brand guide',
      subtitle: `${projectSlug ?? ''} · version ${version ?? 1}`,
    }),
  },
})

export const brandHubSchemaTypes = [brandGuideExampleType, brandGuidePageType, brandGuideType]

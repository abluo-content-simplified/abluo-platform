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

/** Status of one written statement or rule (shown as a pill on the hub). */
export const BRAND_STATEMENT_STATUSES = ['draft', 'approved', 'needsDecision'] as const

/** Overview statements, in display order. Every one is optional. */
export const BRAND_STATEMENT_FIELDS = ['mission', 'vision', 'promise', 'positioning', 'story'] as const

/** Foundation lists, each { status, intro, items[{ title, text, note }], outro }. */
export const BRAND_LIST_FIELDS = ['audience', 'differentiators', 'personality', 'values'] as const

/** Logo rules (Logo page), in display order. */
export const BRAND_LOGO_RULE_FIELDS = ['clearSpace', 'minimumDigital', 'minimumPrint', 'backgrounds'] as const

/** Publication status of the whole guide. */
export const BRAND_GUIDE_STATUSES = ['draft', 'review', 'published'] as const

/** Hub pages that carry written guidance (Overview has `intro`). */
export const BRAND_GUIDE_PAGE_FIELDS = ['colour', 'typography', 'shape', 'layout', 'logo', 'motion', 'voice'] as const

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

/**
 * A statement or rule: text + status. Inline object (not a named type) so the
 * module's registered schema types stay unchanged.
 */
const statementField = (name: string, title: string, description: string, group?: string) =>
  defineField({
    name,
    title,
    description,
    type: 'object',
    ...(group && { group }),
    options: { collapsible: true, collapsed: false },
    fields: [
    defineField({ name: 'text', title: 'Text', type: 'localizedText' }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Draft — awaiting approval', value: 'draft' },
          { title: 'Approved', value: 'approved' },
          { title: 'Needs a decision', value: 'needsDecision' },
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      initialValue: 'draft',
      description: 'Shown next to the text on the hub. Only "Approved" reads as a confirmed brand rule.',
    }),
  ],
  })

const changeMember = defineArrayMember({
  name: 'brandGuideChange',
  title: 'Change',
  type: 'object',
  fields: [
    defineField({ name: 'date', title: 'Date', type: 'date', validation: (Rule) => Rule.required() }),
    defineField({ name: 'note', title: 'What changed', type: 'localizedString', validation: (Rule) => Rule.required() }),
  ],
  preview: {
    select: { date: 'date', note: 'note.en' },
    prepare: ({ date, note }) => ({ title: note || '(no note)', subtitle: date }),
  },
})

const STATEMENT_TITLES: Record<(typeof BRAND_STATEMENT_FIELDS)[number], [string, string]> = {
  mission: ['Mission', 'Why the brand exists. One sentence.'],
  vision: ['Vision', 'Where the brand is going. One sentence.'],
  promise: ['Brand promise', 'What people can always count on. First paragraph is the promise; the rest supports it.'],
  positioning: ['Positioning', 'Who it is for, what it is, and how it differs. A few paragraphs.'],
  story: ['Brand story', 'Where it comes from and why it matters. Paragraphs.'],
}

const LIST_TITLES: Record<(typeof BRAND_LIST_FIELDS)[number], [string, string, string | null]> = {
  audience: ['Who it is for', 'Intro, one item per audience, and an optional closing paragraph.', null],
  differentiators: ['Differentiators', 'What sets the brand apart: a short title and a sentence each.', null],
  personality: ['Personality', 'One trait per item, with what it means and what it is not.', 'Not'],
  values: ['Values', 'One value per item, with what it means and a decision question.', 'Decision question'],
}

const listField = (name: (typeof BRAND_LIST_FIELDS)[number]) =>
  defineField({
    name,
    title: LIST_TITLES[name][0],
    description: LIST_TITLES[name][1],
    type: 'object',
    group: 'overview',
    options: { collapsible: true, collapsed: false },
    fields: [
      defineField({
        name: 'status',
        title: 'Status',
        type: 'string',
        options: {
          list: [
            { title: 'Draft — awaiting approval', value: 'draft' },
            { title: 'Approved', value: 'approved' },
            { title: 'Needs a decision', value: 'needsDecision' },
          ],
          layout: 'radio',
          direction: 'horizontal',
        },
        initialValue: 'draft',
      }),
      defineField({ name: 'intro', title: 'Intro', type: 'localizedText' }),
      defineField({
        name: 'items',
        title: 'Items',
        type: 'array',
        of: [
          defineArrayMember({
            name: 'brandListItem',
            title: 'Item',
            type: 'object',
            fields: [
              defineField({ name: 'title', title: 'Title', type: 'localizedString', validation: (Rule) => Rule.required() }),
              defineField({ name: 'text', title: 'Text', type: 'localizedText' }),
              ...(LIST_TITLES[name][2]
                ? [defineField({ name: 'note', title: LIST_TITLES[name][2]!, type: 'localizedText' })]
                : []),
            ],
            preview: { select: { title: 'title.en', subtitle: 'text.en' } },
          }),
        ],
      }),
      defineField({ name: 'outro', title: 'Closing paragraph', type: 'localizedText' }),
    ],
  })

const LOGO_RULE_TITLES: Record<(typeof BRAND_LOGO_RULE_FIELDS)[number], [string, string]> = {
  clearSpace: ['Clear space', 'The empty space to keep around the logo, e.g. "the height of the play triangle on every side".'],
  minimumDigital: ['Minimum size — screen', 'The smallest the logo may appear on screen, e.g. "24 px tall".'],
  minimumPrint: ['Minimum size — print', 'The smallest the logo may appear in print, e.g. "8 mm tall".'],
  backgrounds: ['Backgrounds', 'Which backgrounds each logo version may sit on.'],
}

const brandGuidePageType = defineType({
  name: 'brandGuidePage',
  title: 'Page guidance',
  type: 'object',
  fields: [
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Draft — awaiting approval', value: 'draft' },
          { title: 'Approved', value: 'approved' },
          { title: 'Needs a decision', value: 'needsDecision' },
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      initialValue: 'draft',
      description: 'Shown at the top of the page when it has guidance. Only "Approved" reads as confirmed.',
    }),
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
  voice: 'Voice and content',
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
      name: 'status',
      title: 'Status',
      type: 'string',
      group: 'overview',
      options: {
        list: [
          { title: 'Draft', value: 'draft' },
          { title: 'In review', value: 'review' },
          { title: 'Published', value: 'published' },
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      initialValue: 'draft',
      description: 'Shown on every hub page next to the version.',
    }),
    defineField({
      name: 'intro',
      title: 'Introduction',
      type: 'localizedPortableText',
      group: 'overview',
      description: 'What the brand is, in a few sentences. Opens the brand hub.',
    }),
    ...BRAND_STATEMENT_FIELDS.map((f) =>
      statementField(f, STATEMENT_TITLES[f][0], STATEMENT_TITLES[f][1], 'overview'),
    ),
    ...BRAND_LIST_FIELDS.map((f) => listField(f)),
    defineField({
      name: 'howToUse',
      title: 'How to use these guidelines',
      type: 'localizedPortableText',
      group: 'overview',
      description: 'Shown on "Using the Brand Hub" under "For this brand": who approves, how languages are handled, who to contact. The standard explanations are always shown.',
    }),
    defineField({
      name: 'changes',
      title: 'Recent changes',
      type: 'array',
      group: 'overview',
      of: [changeMember],
      description: 'Newest first is not required — the hub sorts by date and shows the latest five.',
    }),
    defineField({
      name: 'logoRules',
      title: 'Logo rules',
      type: 'object',
      group: 'logo',
      description: 'Each rule shows as "Needs a decision" on the hub until it is written.',
      fields: BRAND_LOGO_RULE_FIELDS.map((f) =>
        statementField(f, LOGO_RULE_TITLES[f][0], LOGO_RULE_TITLES[f][1]),
      ),
    }),
    ...BRAND_GUIDE_PAGE_FIELDS.map((p) =>
      defineField({ name: p, title: PAGE_TITLES[p], type: 'brandGuidePage', group: p }),
    ),
  ],
  preview: {
    select: { version: 'version', projectSlug: 'projectSlug', status: 'status' },
    prepare: ({ version, projectSlug, status }) => ({
      title: 'Brand guide',
      subtitle: `${projectSlug ?? ''} · version ${version ?? 1} · ${status ?? 'draft'}`,
    }),
  },
})

export const brandHubSchemaTypes = [brandGuideExampleType, brandGuidePageType, brandGuideType]

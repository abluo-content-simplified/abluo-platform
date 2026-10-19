import { defineType, defineField, defineArrayMember } from 'sanity'
import { projectSlugField, anchorIdField, headlineAccentField, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'
import { bodyLinkAnnotation } from '@/lib/sanity/fields/body-link'
import { LocalizedPortableTextInput } from '@/lib/sanity/fields/LocalizedInput'
import { PUBLISHING_GROUP, archivedFields } from '@/lib/sanity/fields/publishing'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'
import { faqSetsField } from './fields'

// ── FAQ module — Sanity schema types (ADR-037) ────────────────────────────────
//
// Owned by: faq module (MODULE_REGISTRY id: 'faq')
//   faqAnswerText — localized, RESTRICTED rich text for answers (D12)
//   faqEntry      — object: one question + answer inside a set (D2)
//   faqSet        — collection document: a named, reusable list of questions
//   faqSection    — section object embedded in page.sections (moved here)
//   faqItem       — LEGACY object: inline section items and the imported
//                   post.faq[] (moved here, unchanged; removed at cleanup)
//
// faqItem and faqSection keep their names, so no stored document moves. Every
// change below is additive: no field changes type (Schema Evolution Rules).
//
// Placements REFERENCE sets, never copy them (D3): editing a set updates every
// page and post that shows it. A different selection is a different set —
// duplicate it — never a per-placement override.

/** The hidden per-locale translation status every localized type carries (ADR-023 §4). */
const translationStatusField = defineField({
  name: 'translationStatus',
  title: 'Translation status',
  type: 'translationStatus',
  hidden: true,
})

// ── Answer text (D12) ─────────────────────────────────────────────────────────
// Paragraphs, bold, italic, bullet and numbered lists, internal and external
// links. No headings, images, video, tables, colours or sizes. The ONLY
// annotation is the shared body link, so FAQ answers get the platform's link
// rules (stable internal references, plain text when the target is gone).
const faqAnswerBlock = defineArrayMember({
  type: 'block',
  styles: [{ title: 'Paragraph', value: 'normal' }],
  lists: [
    { title: 'Bullet list', value: 'bullet' },
    { title: 'Numbered list', value: 'number' },
  ],
  marks: {
    decorators: [
      { title: 'Bold', value: 'strong' },
      { title: 'Italic', value: 'em' },
    ],
    annotations: [bodyLinkAnnotation],
  },
})

const faqAnswerTextType = defineType({
  name: 'faqAnswerText',
  title: 'Answer',
  type: 'object',
  components: { input: LocalizedPortableTextInput },
  fields: [
    ...LOCALE_CODES.map((code) =>
      defineField({
        name: code,
        title: PLATFORM_LOCALES[code].nativeName,
        type: 'array',
        of: [faqAnswerBlock],
      })
    ),
    translationStatusField,
  ],
})

// ── Entry (D2) ────────────────────────────────────────────────────────────────

const faqEntryType = defineType({
  name: 'faqEntry',
  title: 'Question',
  type: 'object',
  fields: [
    defineField({
      name: 'question',
      title: 'Question',
      type: 'localizedString',
      description: 'Plain text, as a visitor would ask it.',
    }),
    defineField({
      name: 'answer',
      title: 'Answer',
      type: 'faqAnswerText',
      description: 'Keep it short: a few sentences, a list at most. A language with no question or no answer is not shown in that language.',
    }),
  ],
  preview: {
    select: { en: 'question.en', it: 'question.it', de: 'question.de' },
    prepare: ({ en, it, de }: { en?: string; it?: string; de?: string }) => ({ title: en ?? it ?? de ?? 'Question' }),
  },
})

// ── Legacy item (unchanged) ───────────────────────────────────────────────────
// Stored in 106 live items (6 page sections, 15 posts). Its answer is plain
// localizedText; changing that in place would break the published documents,
// which is why faqEntry is a new type. Migration 008 builds faqEntry items from
// these; the type is removed at cleanup, once a query proves nothing uses it.

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

// ── FAQ set (D2) ──────────────────────────────────────────────────────────────

const faqSetType = defineType({
  name: 'faqSet',
  title: 'FAQ Set',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    PUBLISHING_GROUP,
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'internalName',
      title: 'Name',
      type: 'string',
      group: 'content',
      description: 'How editors find this set ("Dental implants", "Booking & cancellation"). Never shown on the website.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'title',
      title: 'Public title',
      type: 'localizedString',
      group: 'content',
      description: 'Optional. Heads this set\'s questions when a page shows several sets with their titles.',
    }),
    defineField({
      name: 'note',
      title: 'Internal note',
      type: 'string',
      group: 'content',
      description: 'Optional, for editors only (e.g. "Used on event pages; keep answers short").',
    }),
    defineField({
      name: 'items',
      title: 'Questions',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'faqEntry' })],
      description: 'Drag to reorder. Every page and post that shows this set follows these changes once published.',
    }),
    // ADR-032 D1 — archive only. No publication window (D2): a set is a
    // building block, its placements decide when it appears.
    ...archivedFields(),
  ],
  preview: {
    select: { title: 'internalName', items: 'items', projectSlug: 'projectSlug' },
    prepare: ({ title, items, projectSlug }: { title?: string; items?: unknown[]; projectSlug?: string }) => {
      const n = Array.isArray(items) ? items.length : 0
      return {
        title: title ?? 'Unnamed FAQ set',
        subtitle: [`${n} question${n === 1 ? '' : 's'}`, projectSlug].filter(Boolean).join(' · '),
      }
    },
  },
})

// ── FAQ section (moved, extended — D5) ────────────────────────────────────────

const faqSectionType = defineType({
  name: 'faqSection',
  title: 'FAQ Section',
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
    defineField({
      // Additive (ADR-037 D5): the same heading pair a blog post offers.
      name: 'subtitle',
      title: 'Subtitle',
      type: 'localizedText',
      description: 'Optional. Shown under the title.',
    }),
    faqSetsField({
      description: 'One or more FAQ sets, in the order to show them. Their questions are maintained under Content → FAQ Sets (and by the site\'s editors), never here.',
      warnWhenEmpty: true,
    }),
    defineField({
      name: 'showSetTitles',
      title: 'Show each set\'s title',
      type: 'boolean',
      initialValue: true,
      description: 'With several sets, each set\'s public title heads its questions.',
      hidden: ({ parent }) => !Array.isArray(parent?.faqSets) || parent.faqSets.length < 2,
    }),
    defineField({
      // DEPRECATED (ADR-037). Read only when faqSets is empty, so the six
      // existing sections render unchanged until migration 008 converts them
      // into sets. Read-only, and hidden once empty: new sections use sets.
      name: 'items',
      title: 'Questions (old inline list — read only)',
      type: 'array',
      of: [defineArrayMember({ type: 'faqItem' })],
      readOnly: true,
      description: 'Deprecated: these questions will move into an FAQ set. Until then they show only while no FAQ set is chosen above.',
      hidden: ({ parent }) => !Array.isArray(parent?.items) || parent.items.length === 0,
    }),
  ],
  preview: {
    select: { title: 'title.it', titleEn: 'title.en', firstSet: 'faqSets.0.internalName', sets: 'faqSets' },
    prepare: ({ title, titleEn, firstSet, sets }: { title?: string; titleEn?: string; firstSet?: string; sets?: unknown[] }) => {
      const n = Array.isArray(sets) ? sets.length : 0
      const names = firstSet ? (n > 1 ? `${firstSet} +${n - 1}` : firstSet) : undefined
      return { title: title ?? titleEn ?? names ?? 'FAQ', subtitle: ['FAQ Section', names].filter(Boolean).join(' · ') }
    },
  },
})

export const faqSchemaTypes = [faqItemType, faqAnswerTextType, faqEntryType, faqSetType, faqSectionType]

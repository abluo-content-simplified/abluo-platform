import { defineType, defineField } from 'sanity'
import { projectSlugField } from '@/lib/sanity/fields/shared'
import { TERM_KINDS, TERM_KEY_PATTERN, TERM_KEY_MAX_LENGTH, SLUG_PART_PATTERN, TAXONOMY_TERM_TYPE, termId, termIdPartIssues, isTermKind } from './ids'
import { termIsRoutable } from './rules'

// ── taxonomyTerm — one record per category or tag ─────────────────────────────
// ADR-033 Amendment J (J-3). Content stores the term KEY, never a reference, so
// a rename or translation never touches content. `liveEdit`: no drafts — a
// term write is immediate. Editable in the Studio by the superadmin only
// (tenants never reach Studio); the dashboard writes the same records through
// a server service (slice 3).
//
// Integrity is architectural, not defensive: the _id is derived from
// projectSlug + module + kind + key, so duplicates and cross-project
// collisions cannot exist; the key is read-only once set.

type Doc = Record<string, unknown> | undefined

const showRouting = (doc: Doc) =>
  termIsRoutable(String(doc?.module ?? ''), isTermKind(doc?.kind) ? doc.kind : 'tag')

export const taxonomyTermType = defineType({
  name: TAXONOMY_TERM_TYPE,
  title: 'Category or tag',
  type: 'document',
  liveEdit: true,
  fields: [
    projectSlugField,
    defineField({
      name: 'module',
      title: 'Module',
      type: 'string',
      description: 'The module this term belongs to, e.g. catalogue. Each module keeps its own vocabulary.',
      validation: (Rule) =>
        Rule.required().custom((v) => (typeof v === 'string' && !SLUG_PART_PATTERN.test(v) ? 'Use lowercase letters, digits and hyphens.' : true)),
    }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: { list: TERM_KINDS.map((k) => ({ title: k === 'category' ? 'Category' : 'Tag', value: k })), layout: 'radio' },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'key',
      title: 'Key',
      type: 'string',
      description: 'Stable identifier stored on content. Never changes once the term exists; rename the label instead.',
      readOnly: ({ value }) => Boolean(value),
      validation: (Rule) =>
        Rule.required().custom((value, context) => {
          if (typeof value !== 'string' || value === '') return true
          if (value.length > TERM_KEY_MAX_LENGTH || !TERM_KEY_PATTERN.test(value)) {
            return `Use lowercase letters, digits, "_" or "-" (max ${TERM_KEY_MAX_LENGTH}).`
          }
          // The id must be the deterministic one, so a Studio-created term
          // cannot shadow or duplicate a dashboard-created one.
          const doc = context.document as Doc
          const parts = { projectSlug: String(doc?.projectSlug ?? ''), module: String(doc?.module ?? ''), kind: doc?.kind as never, key: value }
          if (termIdPartIssues(parts).length === 0) {
            const expected = termId(parts)
            const actual = String(doc?._id ?? '').replace(/^drafts\./, '')
            if (actual && actual !== expected) return `This term's id must be ${expected}. Create it from the Categories & Tags list.`
          }
          return true
        }),
    }),
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      description: 'Shown to visitors and in the dashboard, one per website language. The default language is required.',
      validation: (Rule) =>
        Rule.custom((value) => {
          const v = (value ?? {}) as Record<string, unknown>
          const hasAny = Object.entries(v).some(([k, x]) => k !== '_type' && k !== 'translationStatus' && typeof x === 'string' && x.trim() !== '')
          return hasAny ? true : 'Add a label in the default language.'
        }),
    }),
    defineField({ name: 'order', title: 'Order', type: 'number', description: 'Position in lists. Spaced by 1000 so terms can be inserted.' }),
    defineField({ name: 'color', title: 'Colour', type: 'string', hidden: ({ document }) => (document as Doc)?.kind !== 'category' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText', hidden: ({ document }) => !showRouting(document as Doc) }),
    defineField({ name: 'redirectFrom', title: 'Redirect from (old URLs)', type: 'redirectFrom', hidden: ({ document }) => !showRouting(document as Doc) }),
    defineField({ name: 'noindex', title: 'Hide from search engines', type: 'boolean', hidden: ({ document }) => !showRouting(document as Doc) }),
    defineField({ name: 'createdAt', title: 'Created at', type: 'datetime', readOnly: true }),
    defineField({ name: 'createdBy', title: 'Created by', type: 'string', readOnly: true }),
    defineField({ name: 'updatedAt', title: 'Updated at', type: 'datetime', readOnly: true }),
    defineField({ name: 'updatedBy', title: 'Updated by', type: 'string', readOnly: true }),
  ],
  orderings: [
    { name: 'order', title: 'Order', by: [{ field: 'module', direction: 'asc' }, { field: 'kind', direction: 'asc' }, { field: 'order', direction: 'asc' }] },
  ],
  preview: {
    select: { en: 'label.en', it: 'label.it', key: 'key', module: 'module', kind: 'kind', project: 'projectSlug' },
    prepare: ({ en, it, key, module, kind, project }) => ({
      title: en || it || key,
      subtitle: [project, module, kind].filter(Boolean).join(' · '),
    }),
  },
})

import { defineType, defineField } from 'sanity'
import { anchorIdField, headlineAccentField, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'

// ── Documents module — Sanity schema types (ADR-040 §15, R9) ─────────────────
//
// Owned by: documents module (MODULE_REGISTRY id: 'documents')
//   downloadSection — section object embedded in page.sections
//
// The documents themselves live in Supabase (the site access documents table, migration
// 054) and are managed by the client in the dashboard (Documents). The
// section only PRESENTS them (CLAUDE.md principle 7): it has no document
// picker — it lists the documents the client placed on THIS page ("Show on"),
// re-checked per visitor at every display:
//   - on a public page: documents for everyone only;
//   - on a protected page: also the documents of the groups the visitor has
//     unlocked (the page's own password protects the whole page).
// One Download section per page (v1).

export const downloadSectionType = defineType({
  name: 'downloadSection',
  title: 'Download Section',
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
      name: 'intro',
      title: 'Introduction',
      type: 'localizedText',
      description: 'Optional. A short line above the list.',
    }),
    defineField({
      name: 'image',
      title: 'Image (optional)',
      type: 'image',
      options: { hotspot: true },
      description: 'A small image beside the title.',
    }),
    defineField({
      name: 'documentSort',
      title: 'Order of the documents',
      type: 'string',
      options: {
        list: [
          { title: 'The order the site chooses in the dashboard', value: 'manual' },
          { title: 'Newest first', value: 'newest' },
          { title: 'A–Z', value: 'az' },
        ],
        layout: 'radio',
      },
      initialValue: 'manual',
    }),
  ],
  validation: (Rule) =>
    Rule.custom((_value, context) => {
      const doc = context.document as { sections?: Array<{ _type?: string }> } | undefined
      const n = (doc?.sections ?? []).filter((s) => s?._type === 'downloadSection').length
      return n > 1 ? 'Only one Download section per page.' : true
    }),
  preview: {
    select: { title: 'title.it', titleEn: 'title.en' },
    prepare: ({ title, titleEn }: { title?: string; titleEn?: string }) => ({
      title: title ?? titleEn ?? 'Downloads',
      subtitle: 'Download Section · documents chosen in the dashboard',
    }),
  },
})

export const documentsSchemaTypes = [downloadSectionType]

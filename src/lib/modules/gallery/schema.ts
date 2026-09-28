import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField, anchorIdField, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'

// ── Gallery module — Sanity schema types (ADR-022) ────────────────────────────
//
// Owned by: gallery module (MODULE_REGISTRY id: 'gallery')
//   galleryItem          — object: one Media Library asset inside a gallery
//   gallery              — collection document: a small, hand-ordered set
//   photoGallerySection  — section object embedded in page.sections
//
// Moved here from src/lib/sanity/schema.ts. Type and field names are unchanged,
// so no stored document moves; every change below is additive.
//
// A gallery is a small, focused set ("Exterior", "Room 1", "Implantology").
// Placements COMPOSE galleries — a section lists several, a blog post picks
// one. Nothing excludes individual photos per placement: a different selection
// is a different gallery, and the photos themselves live once, in the Media
// Library, so a second gallery duplicates nothing.

// ── Gallery item ──────────────────────────────────────────────────────────────

const galleryItemType = defineType({
  name: 'galleryItem',
  title: 'Gallery Item',
  type: 'object',
  fields: [
    defineField({
      name: 'mediaAsset',
      title: 'Media Asset',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      validation: (Rule) => Rule.required(),
      description: 'Select a Media Asset from the Media Library. Its focal point and alt text are set there, once.',
    }),
    defineField({
      name: 'titleOverrideEnabled',
      title: 'Override Display Title',
      type: 'boolean',
      initialValue: false,
      description: 'Enable to use a custom title for this item instead of the Media Library title.',
    }),
    defineField({
      name: 'titleOverride',
      title: 'Custom Display Title',
      type: 'localizedString',
      description: 'Replaces the Media Library title in this gallery only.',
      hidden: ({ parent }) => !parent?.titleOverrideEnabled,
    }),
    defineField({
      name: 'captionOverrideEnabled',
      title: 'Override Caption',
      type: 'boolean',
      initialValue: false,
      description: 'Enable to use a custom caption for this item instead of the Media Library caption.',
    }),
    defineField({
      name: 'captionOverride',
      title: 'Custom Caption',
      type: 'localizedString',
      description: 'Replaces the Media Library caption in this gallery only.',
      hidden: ({ parent }) => !parent?.captionOverrideEnabled,
    }),
  ],
  preview: {
    select: {
      assetName: 'mediaAsset.name',
      assetAltEn: 'mediaAsset.altText.en',
      assetTitleEn: 'mediaAsset.title.en',
      media: 'mediaAsset.image',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ assetName, assetAltEn, assetTitleEn, media }: { assetName?: string; assetAltEn?: string; assetTitleEn?: string; media?: any }) => ({
      title: assetName ?? assetTitleEn ?? assetAltEn ?? 'Media Asset',
      media,
    }),
  },
})

// ── Gallery ───────────────────────────────────────────────────────────────────

const galleryType = defineType({
  name: 'gallery',
  title: 'Gallery',
  type: 'document',
  fields: [
    projectSlugField,
    defineField({
      name: 'internalName',
      title: 'Internal Name',
      type: 'string',
      description: 'Used in Studio to identify this gallery (e.g. "Hygiene", "Our Team"). Never shown on the website.',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      // ADR-022 §3 — the public name: tab labels, and the heading above a
      // gallery in a blog post. Localized from creation (CLAUDE.md
      // Localization Rules), never converted later.
      name: 'title',
      title: 'Title',
      type: 'localizedString',
      description: 'Shown to visitors — as a tab label ("Room 1") and above the gallery in a blog post.',
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Optional identifier for future API use.',
      options: { source: 'internalName', maxLength: 96 },
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'localizedString',
      description: 'Optional short description of this gallery.',
    }),
    defineField({
      name: 'items',
      title: 'Gallery Items',
      type: 'array',
      description: 'Ordered list of Media Assets. Drag to reorder — the first photo leads in the Featured and Wide lead layouts.',
      of: [defineArrayMember({ type: 'galleryItem' })],
      validation: (Rule) => Rule.min(1),
    }),
  ],
  preview: {
    select: {
      title: 'internalName',
      publicTitle: 'title.en',
      publicTitleIt: 'title.it',
      projectSlug: 'projectSlug',
      media: 'items.0.mediaAsset.image',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ title, publicTitle, publicTitleIt, projectSlug, media }: { title?: string; publicTitle?: string; publicTitleIt?: string; projectSlug?: string; media?: any }) => ({
      title: title ?? 'Unnamed Gallery',
      subtitle: [publicTitle ?? publicTitleIt, projectSlug].filter(Boolean).join(' · '),
      media,
    }),
  },
})

// ── Photo Gallery section ─────────────────────────────────────────────────────

/** The layouts a gallery placement can use (ADR-022 §4). */
export const GALLERY_LAYOUT_OPTIONS = [
  { title: 'Grid — equal tiles', value: 'grid' },
  { title: 'Featured — first photo large, two beside it', value: 'featured' },
  { title: 'Wide lead — first photo across the full width', value: 'wideLead' },
  { title: 'Rows — every photo uncropped, rows fill the width', value: 'rows' },
  { title: 'Masonry — uncropped columns', value: 'masonry' },
  { title: 'Carousel — one swipeable strip', value: 'carousel' },
]

const usesTileShape = (layout: unknown) => !layout || layout === 'grid' || layout === 'featured' || layout === 'wideLead'

const photoGallerySectionType = defineType({
  name: 'photoGallerySection',
  title: 'Photo Gallery Section',
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
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'headline', title: 'Headline', type: 'localizedString' }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText' }),
    defineField({
      // ADR-022 §3 — a section composes one or more galleries.
      name: 'galleries',
      title: 'Galleries',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'gallery' }], options: { filter: scopedRef } })],
      description: 'One or more galleries, in the order to show them. Manage galleries under Content → Galleries.',
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const hasMany = Array.isArray(value) && value.length > 0
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hasLegacy = !!(context.parent as any)?.gallery?._ref
          return hasMany || hasLegacy ? true : 'Choose at least one gallery.'
        }),
    }),
    defineField({
      // Legacy single reference (pre-ADR-022). Still read as a fallback when
      // `galleries` is empty, so existing sections are unchanged. Hidden once
      // empty, so new sections only ever use `galleries`.
      name: 'gallery',
      title: 'Gallery (legacy — move it to Galleries above)',
      type: 'reference',
      to: [{ type: 'gallery' }],
      options: { filter: scopedRef },
      hidden: ({ parent }) => !parent?.gallery,
    }),
    defineField({
      name: 'galleryDisplay',
      title: 'Show several galleries as',
      type: 'string',
      options: {
        list: [
          { title: 'One combined set', value: 'combined' },
          { title: 'Tabs — one per gallery', value: 'tabs' },
        ],
        layout: 'radio',
      },
      initialValue: 'combined',
      hidden: ({ parent }) => !Array.isArray(parent?.galleries) || parent.galleries.length < 2,
    }),
    defineField({
      name: 'showAllTab',
      title: 'Add an "All" tab first',
      type: 'boolean',
      initialValue: true,
      description: 'The "All" tab shows every gallery together and is the one open when the page loads.',
      hidden: ({ parent }) => parent?.galleryDisplay !== 'tabs',
    }),
    defineField({
      // The layout decides the shape of every tile; the photo is cropped into
      // it around its focal point (set once, on the Media Library asset).
      // Editors control order and layout — never the size of one photo.
      name: 'layout',
      title: 'Layout',
      type: 'string',
      options: { list: GALLERY_LAYOUT_OPTIONS, layout: 'radio' },
      initialValue: 'grid',
    }),
    defineField({
      name: 'columns',
      title: 'Columns',
      type: 'number',
      options: {
        list: [
          { title: '2 Columns', value: 2 },
          { title: '3 Columns', value: 3 },
          { title: '4 Columns', value: 4 },
        ],
        layout: 'radio',
      },
      initialValue: 3,
      description: 'Featured always uses thirds on wide screens.',
      hidden: ({ parent }) => parent?.layout === 'rows' || parent?.layout === 'carousel',
    }),
    defineField({
      name: 'imageRatio',
      title: 'Tile shape',
      type: 'string',
      options: {
        // 'auto' is retired (ADR-022 §4): tiles that keep each photo's own
        // shape are what left gaps. A stored 'auto' renders as landscape. For
        // uncropped photos choose the Rows or Masonry layout.
        list: [
          { title: 'Square (1:1)', value: 'square' },
          { title: 'Landscape (4:3)', value: 'landscape' },
          { title: 'Portrait (3:4)', value: 'portrait' },
        ],
        layout: 'radio',
      },
      initialValue: 'square',
      hidden: ({ parent }) => !usesTileShape(parent?.layout),
    }),
    defineField({
      name: 'spacing',
      title: 'Spacing',
      type: 'string',
      options: {
        list: [
          { title: 'Tight (4px)', value: 'tight' },
          { title: 'Normal (12px)', value: 'normal' },
          { title: 'Loose (24px)', value: 'loose' },
        ],
        layout: 'radio',
      },
      initialValue: 'normal',
    }),
    defineField({
      name: 'showCaptions',
      title: 'Show Captions',
      type: 'boolean',
      initialValue: false,
      description: 'Display captions beneath each photo. The lightbox always shows them.',
    }),
    defineField({
      name: 'lightbox',
      title: 'Open photos in a lightbox',
      type: 'boolean',
      initialValue: true,
      description: 'Clicking a photo opens it full screen, with next and previous.',
    }),
  ],
  preview: {
    select: {
      headline_en: 'headline.en',
      headline_it: 'headline.it',
      galleryName: 'gallery.internalName',
      firstName: 'galleries.0.internalName',
      count: 'galleries',
      layout: 'layout',
    },
    prepare: ({ headline_en, headline_it, galleryName, firstName, count, layout }: { headline_en?: string; headline_it?: string; galleryName?: string; firstName?: string; count?: unknown[]; layout?: string }) => {
      const n = Array.isArray(count) ? count.length : 0
      const names = firstName ? (n > 1 ? `${firstName} +${n - 1}` : firstName) : galleryName
      return {
        title: headline_en ?? headline_it ?? names ?? 'Photo Gallery',
        subtitle: ['Photo Gallery', names, layout].filter(Boolean).join(' · '),
      }
    },
  },
})

export const gallerySchemaTypes = [galleryItemType, galleryType, photoGallerySectionType]

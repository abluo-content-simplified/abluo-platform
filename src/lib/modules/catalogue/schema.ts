import { defineType, defineField, defineArrayMember } from 'sanity'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import { PUBLISHING_GROUP, publishingStatusField, publishOnField, unpublishOnField, archivedFields } from '@/lib/sanity/fields/publishing'
import { ALLERGENS, unknownAllergenKeys } from './allergens'

// ── Catalogue module — Sanity schema types ────────────────────────────────────
//
// Authority: ADR-033 (catalogue module — items, collections, offers, options).
// Spec:      docs/engineering/catalogue-module/catalogue-module-v1-spec.md
//
// NOT YET REGISTERED. This file is written ahead of ADR-032 Phase 1 completing
// (lifecycle service + guard, shared dashboard pieces). It is deliberately
// absent from MODULE_REGISTRY: a half-installed module would show empty
// collections in Studio for no benefit. Registering it is one entry in
// registry.ts once the lifecycle foundation lands.
//
// Four concepts, four names (ADR-033 D1) — never conflated:
//   catalogueItem        the thing: a dish, a wine, a book, a service
//   catalogueCollection  an ordered, sectioned curation of items (a menu is one)
//   catalogueOffer       the commercial terms: price × channel × availability
//   catalogueOptionList  choices that modify a line at order time
//
// An option modifies a line. A variant would generate a distinct sellable unit
// with its own stock. V1 has options only; the two must never share a word.

// ── Lifecycle fields ──────────────────────────────────────────────────────────
//
// ADR-032 D1/A22: the same four names on every lifecycle type, all in the one
// "Publishing" Studio tab, from the platform's shared definition
// (`@/lib/sanity/fields/publishing`, as posts do). Status is DERIVED by
// deriveStatus(), never stored — `publishingStatus` is a read-only display.
// `publishedAtRule: 'optional'` (ADR-033 D9): no publishedAt = live once published.
const lifecycleFields = () => [
  publishingStatusField('optional'),
  publishOnField('When this goes live. Empty means it is live as soon as it is published.'),
  unpublishOnField('When this stops being shown. Empty means it stays up.'),
  ...archivedFields(),
]

// ── publicId (ADR-031 D3) ─────────────────────────────────────────────────────
// Partners never see the Sanity `_id`: script-imported documents carry readable
// ids that embed tenant and content names. Every shareable type gets an opaque
// UUID instead, set once and never changed.
//
// Mirrors publicIdField in src/lib/modules/events/schema.ts. Not imported from
// there because a module may not depend on another module's schema file.
const publicIdField = defineField({
  name: 'publicId',
  title: 'Public ID',
  type: 'string',
  readOnly: true,
  group: 'meta',
  initialValue: () => globalThis.crypto.randomUUID(),
  description: 'Permanent id used when this is shared with connected apps. Set automatically; never changes.',
})

const visibilityField = defineField({
  name: 'visibility',
  title: 'Visibility',
  type: 'string',
  group: 'content',
  description:
    'Public: on the website and shared with connected apps. Website only: on the website, never shared. Unlisted: reachable only by its link — not in lists, not in search engines, never shared.',
  options: {
    list: [
      { title: 'Public', value: 'public' },
      { title: 'Website only', value: 'websiteOnly' },
      { title: 'Unlisted', value: 'unlisted' },
    ],
    layout: 'radio',
  },
  initialValue: 'public',
})

const GROUPS = [
  { name: 'content', title: 'Content', default: true },
  { name: 'commerce', title: 'Price & availability' },
  { name: 'page', title: 'Public page' },
  { name: 'meta', title: 'Meta' },
  // ADR-032 A22 — every "when and how is this visible" field in one tab.
  PUBLISHING_GROUP,
]

// ── Availability (object) ─────────────────────────────────────────────────────
//
// Module-specific availability, explicitly distinct from the publication window
// (ADR-032 D1). An item that is published but outside its serving hours is live
// and simply not currently offered.
export const catalogueAvailability = defineType({
  name: 'catalogueAvailability',
  title: 'Availability',
  type: 'object',
  fields: [
    defineField({
      name: 'days',
      title: 'Days',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: {
        list: [
          { title: 'Monday', value: 'mon' },
          { title: 'Tuesday', value: 'tue' },
          { title: 'Wednesday', value: 'wed' },
          { title: 'Thursday', value: 'thu' },
          { title: 'Friday', value: 'fri' },
          { title: 'Saturday', value: 'sat' },
          { title: 'Sunday', value: 'sun' },
        ],
      },
      description: 'Leave empty for every day.',
    }),
    defineField({
      name: 'from',
      title: 'From',
      type: 'string',
      validation: (Rule) => Rule.regex(/^([01]\d|2[0-3]):[0-5]\d$/).error('Use HH:mm, e.g. 18:00'),
    }),
    defineField({
      name: 'to',
      title: 'To',
      type: 'string',
      validation: (Rule) => Rule.regex(/^([01]\d|2[0-3]):[0-5]\d$/).error('Use HH:mm, e.g. 22:00'),
    }),
  ],
  // ADR-033 A1 — an interval MAY wrap past midnight: 18:00–02:00 is a bar
  // serving until two, not a mistake. `days` names the day the interval starts,
  // so Friday 18:00–02:00 covers 01:00 on Saturday. Only a zero-length window
  // is rejected, because it matches nothing.
  validation: (Rule) =>
    Rule.custom((value) => {
      const v = value as { from?: string; to?: string } | undefined
      if (!v?.from || !v?.to) return true
      return v.from !== v.to ? true : 'The start and end times cannot be the same.'
    }),
  preview: {
    select: { days: 'days', from: 'from', to: 'to' },
    prepare: ({ days, from, to }) => ({
      title: Array.isArray(days) && days.length ? days.join(', ') : 'Every day',
      subtitle: from && to ? `${from}–${to}` : 'All day',
    }),
  },
})

// ── Offer (object, embedded on the item) ──────────────────────────────────────
//
// ADR-033 D14. An offer belongs to exactly one item and follows that item's
// lifecycle and permissions — publishing the item publishes its offers.
//
// The array `_key` is the offer's STABLE IDENTITY and must never be regenerated.
// If offers are ever extracted into documents, `_key` becomes the new document's
// publicId, so any reference made in the meantime survives.
export const catalogueOffer = defineType({
  name: 'catalogueOffer',
  title: 'Offer',
  type: 'object',
  fields: [
    defineField({
      name: 'channel',
      title: 'Service channel',
      type: 'string',
      // Optional (ADR-033 A2). An offer with no channel is UNSCOPED: it applies
      // to any channel that has no applicable offer of its own, so a tenant with
      // one price everywhere authors one offer rather than one per channel.
      description: 'Leave empty to apply to every channel that has no price of its own.',
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      validation: (Rule) => Rule.required().min(0).precision(2),
    }),
    defineField({
      name: 'priceNote',
      title: 'Price note',
      type: 'localizedString',
      description: 'Shown beside the price — "per 100 g", "from". Never parsed.',
    }),
    // RESERVED AND UNSET IN V1 (ADR-033 D7, D14). The project's configured
    // currency is the only persisted one; an offer's effective currency is
    // resolved from it at read time — offer.currency ?? project.currency — in
    // the API, JSON-LD and any future extraction. Nothing reads this field and
    // nothing writes it. It exists so that introducing multi-currency later is
    // additive rather than a migration.
    defineField({
      name: 'currency',
      title: 'Currency override',
      type: 'string',
      hidden: true,
      readOnly: true,
      description: 'Reserved for multi-currency. Unused in V1 — the project currency applies.',
    }),
    // Reserved (ADR-033 D14, ADR-031 D6). Location scoping proper is ADR-031
    // V1.2; validated against the site's own locations when present.
    defineField({
      name: 'locationKey',
      title: 'Location',
      type: 'string',
      hidden: true,
      description: 'Reserved for multi-location projects.',
    }),
    defineField({
      name: 'availability',
      title: 'When it is available',
      type: 'array',
      of: [defineArrayMember({ type: 'catalogueAvailability' })],
      description: 'Leave empty to offer it whenever the site is live.',
    }),
  ],
  preview: {
    select: { channel: 'channel', price: 'price' },
    prepare: ({ channel, price }) => ({
      title: channel ?? 'No channel',
      subtitle: typeof price === 'number' ? String(price) : 'No price',
    }),
  },
})

// ── Option (object, inside an option list) ────────────────────────────────────
//
// `kind` exists because the two situations read differently even though the
// stored shape is one row: "doppia mozzarella" adds to a dish that has it,
// "voglio le acciughe" adds to one that does not, "senza mozzarella" removes.
//
// `priceDelta` may be zero or negative, so free and paid choices are one concept
// with one field and there is nothing for the tenant to classify.
export const catalogueOption = defineType({
  name: 'catalogueOption',
  title: 'Option',
  type: 'object',
  fields: [
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: {
        list: [
          { title: 'Add', value: 'add' },
          { title: 'Remove', value: 'remove' },
        ],
        layout: 'radio',
      },
      initialValue: 'add',
    }),
    defineField({ name: 'priceDelta', title: 'Price change', type: 'number', initialValue: 0 }),
    // A choice that is also sold on its own — a side salad with its own price
    // and its own statistics. The picker offers only items that are themselves
    // offered, so a deposit or a voucher can never become a side dish.
    defineField({
      name: 'item',
      title: 'Linked item',
      type: 'reference',
      to: [{ type: 'catalogueItem' }],
      options: { filter: scopedRef },
    }),
  ],
  preview: {
    select: { label: 'label.en', kind: 'kind', delta: 'priceDelta' },
    prepare: ({ label, kind, delta }) => ({
      title: label ?? 'Untitled option',
      subtitle: [kind, delta ? `${delta > 0 ? '+' : ''}${delta}` : null].filter(Boolean).join(' · '),
    }),
  },
})

// ── Option list (document) ────────────────────────────────────────────────────
export const catalogueOptionList = defineType({
  name: 'catalogueOptionList',
  title: 'Option list',
  type: 'document',
  groups: GROUPS,
  fields: [
    projectSlugField,
    defineField({
      name: 'name',
      title: 'Name',
      type: 'localizedString',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'options',
      title: 'Options',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'catalogueOption' })],
      validation: (Rule) => Rule.min(1).error('An option list needs at least one option.'),
    }),
    ...lifecycleFields(),
  ],
  preview: {
    select: { title: 'name.en', options: 'options', slug: 'projectSlug' },
    prepare: ({ title, options, slug }) => ({
      title: title ?? 'Untitled option list',
      subtitle: `${Array.isArray(options) ? options.length : 0} options · ${slug ?? '—'}`,
    }),
  },
})

// ── Option list attachment (object, on an item) ───────────────────────────────
//
// min and max live HERE, not on the list (ADR-033 D2). "Choose 1 sauce" on a
// burger and "up to 3 sauces" on a platter is one list used twice; putting the
// numbers on the list forces a duplicate list per usage.
export const catalogueItemOptionList = defineType({
  name: 'catalogueItemOptionList',
  title: 'Option list',
  type: 'object',
  fields: [
    defineField({
      name: 'list',
      title: 'List',
      type: 'reference',
      to: [{ type: 'catalogueOptionList' }],
      options: { filter: scopedRef },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'min',
      title: 'Minimum choices',
      type: 'number',
      initialValue: 0,
      validation: (Rule) => Rule.min(0).integer(),
    }),
    defineField({
      name: 'max',
      title: 'Maximum choices',
      type: 'number',
      validation: (Rule) => Rule.min(0).integer(),
      description: 'Leave empty for no limit.',
    }),
  ],
  validation: (Rule) =>
    Rule.custom((value) => {
      const v = value as { min?: number; max?: number } | undefined
      if (v?.min == null || v?.max == null) return true
      return v.min <= v.max ? true : 'The minimum cannot be greater than the maximum.'
    }),
  preview: {
    select: { title: 'list.name.en', min: 'min', max: 'max' },
    prepare: ({ title, min, max }) => ({
      title: title ?? 'Option list',
      subtitle: `min ${min ?? 0} · max ${max ?? '∞'}`,
    }),
  },
})

// ── Item (document) ───────────────────────────────────────────────────────────
//
// itemType drives which fields the form shows and which schema.org @type the
// page emits — by lookup, never by branching on what kind of business this is
// (ADR-031 D6: "No code asks 'is this a restaurant?'").
export const catalogueItem = defineType({
  name: 'catalogueItem',
  title: 'Item',
  type: 'document',
  groups: GROUPS,
  fields: [
    projectSlugField,
    publicIdField,
    defineField({
      name: 'itemType',
      title: 'Type',
      type: 'string',
      group: 'content',
      options: {
        list: [
          { title: 'Dish', value: 'dish' },
          { title: 'Product', value: 'product' },
          { title: 'Service', value: 'service' },
        ],
        layout: 'radio',
      },
      initialValue: 'dish',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'localizedString',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'description', title: 'Short description', type: 'localizedText', group: 'content' }),
    defineField({
      name: 'body',
      title: 'Full description',
      type: 'localizedPortableText',
      group: 'content',
      description: 'Only shown on the item’s own page.',
    }),
    defineField({
      name: 'images',
      title: 'Images',
      type: 'array',
      group: 'content',
      of: [
        defineArrayMember({
          type: 'reference',
          to: [{ type: 'mediaAsset' }],
          options: { filter: scopedRef },
        }),
      ],
      description: 'From the Media Library. The first image is used in listings.',
    }),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Defined in the module settings.',
    }),
    // Shown when itemType is 'dish'. The fourteen EU allergens (Reg. 1169/2011
    // Annex II) are a PLATFORM CONSTANT, never configuration: a closed legal
    // list that no tenant may extend and no configuration may hide. Hiding a
    // declarable allergen to reduce clutter is a compliance risk, not a UX
    // improvement.
    defineField({
      name: 'allergens',
      title: 'Allergens',
      description: 'The fourteen EU allergens (Reg. 1169/2011 Annex II). A closed list — none can be hidden (ADR-033 C3).',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      options: { list: ALLERGENS.map((value) => ({ title: value, value })) },
      validation: (Rule) =>
        Rule.custom((value) => {
          const unknown = unknownAllergenKeys(value as unknown[] | undefined)
          return unknown.length === 0 || `Unknown allergen key: ${unknown.join(', ')}`
        }),
      hidden: ({ document }) => document?.itemType !== 'dish',
    }),
    defineField({
      name: 'dietary',
      title: 'Dietary',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      hidden: ({ document }) => document?.itemType !== 'dish',
      description: 'Defined in the module settings.',
    }),
    defineField({
      name: 'offers',
      title: 'Offers',
      type: 'array',
      group: 'commerce',
      of: [defineArrayMember({ type: 'catalogueOffer' })],
      description:
        'A channel-specific offer wins over one with no channel. Within the same scope, availability windows must not overlap.',
    }),
    defineField({
      name: 'optionLists',
      title: 'Option lists',
      type: 'array',
      group: 'commerce',
      of: [defineArrayMember({ type: 'catalogueItemOptionList' })],
      description: 'In the order the guest is asked.',
    }),
    // ── Public page (ADR-033 D4, D11) ─────────────────────────────────────────
    // Opt-in. When on, the five requirements of the Publicly Routable Content
    // pattern apply in full. The slug sits under the project's configured base
    // segment and shares one namespace with collections, so it must be unique
    // across BOTH types within a project and locale.
    defineField({
      name: 'hasPage',
      title: 'Give this its own page',
      type: 'boolean',
      group: 'page',
      initialValue: false,
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'localizedSlug',
      group: 'page',
      hidden: ({ document }) => !document?.hasPage,
    }),
    defineField({
      name: 'redirectFrom',
      title: 'Redirect from',
      type: 'redirectFrom',
      group: 'page',
      hidden: ({ document }) => !document?.hasPage,
    }),
    visibilityField,
    ...lifecycleFields(),
  ],
  preview: {
    select: { title: 'name.en', type: 'itemType', slug: 'projectSlug', media: 'images.0.image' },
    prepare: ({ title, type, slug, media }) => ({
      title: title ?? 'Untitled item',
      subtitle: [type, slug].filter(Boolean).join(' · '),
      media,
    }),
  },
})

// ── Collection section (object, embedded and ordered) ─────────────────────────
//
// `parentKey` names the _key of the parent section; absent means top level.
// DEPTH IS NOT CAPPED in the model (ADR-033 D6) — the editor guides to two
// levels and warns beyond three. Two is what a menu needs, but a serious wine
// list is genuinely Vini → Rossi → Toscana, and the schema should not be the
// thing that forbids it.
//
// A section may hold any itemType, and a parent may hold items of its own.
export const catalogueSection = defineType({
  name: 'catalogueSection',
  title: 'Section',
  type: 'object',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'localizedString',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'parentKey',
      title: 'Inside section',
      type: 'string',
      description: 'The key of the parent section. Empty means a top-level section.',
    }),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'reference',
          to: [{ type: 'catalogueItem' }],
          options: { filter: scopedRef },
        }),
      ],
    }),
  ],
  preview: {
    select: { title: 'name.en', items: 'items', parentKey: 'parentKey' },
    prepare: ({ title, items, parentKey }) => ({
      title: `${parentKey ? '↳ ' : ''}${title ?? 'Untitled section'}`,
      subtitle: `${Array.isArray(items) ? items.length : 0} items`,
    }),
  },
})

// ── Collection (document) ─────────────────────────────────────────────────────
//
// ADR-033 D13: a collection is STRUCTURED CATALOGUE DATA, not a website
// presentation entity. The module owns, orders and permissions it;
// catalogueListingSection merely renders one. A collection must never acquire
// presentation fields.
export const catalogueCollection = defineType({
  name: 'catalogueCollection',
  title: 'Collection',
  type: 'document',
  groups: GROUPS,
  fields: [
    projectSlugField,
    publicIdField,
    defineField({
      name: 'name',
      title: 'Name',
      type: 'localizedString',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'description', title: 'Description', type: 'localizedText', group: 'content' }),
    // ADR-033 B2 — decides the schema.org shape of this collection's page, and
    // therefore of the items ON it: `menu` emits Menu → MenuSection → MenuItem,
    // `list` emits ItemList (OfferCatalog when the items carry offers).
    //
    // Per collection, deliberately: a restaurant that also sells merchandise has
    // a menu AND a shop collection in one project, so a per-tenant setting could
    // not describe both — and the items cannot be inferred from, because the same
    // jar of sauce belongs to both.
    defineField({
      name: 'collectionType',
      title: 'Kind of collection',
      type: 'string',
      group: 'content',
      options: {
        list: [
          { title: 'Menu', value: 'menu' },
          { title: 'List', value: 'list' },
        ],
        layout: 'radio',
      },
      initialValue: 'list',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'sections',
      title: 'Sections',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'catalogueSection' })],
    }),
    defineField({
      name: 'hasPage',
      title: 'Give this its own page',
      type: 'boolean',
      group: 'page',
      initialValue: false,
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'localizedSlug',
      group: 'page',
      hidden: ({ document }) => !document?.hasPage,
    }),
    defineField({
      name: 'redirectFrom',
      title: 'Redirect from',
      type: 'redirectFrom',
      group: 'page',
      hidden: ({ document }) => !document?.hasPage,
    }),
    visibilityField,
    ...lifecycleFields(),
  ],
  preview: {
    select: { title: 'name.en', sections: 'sections', slug: 'projectSlug' },
    prepare: ({ title, sections, slug }) => ({
      title: title ?? 'Untitled collection',
      subtitle: `${Array.isArray(sections) ? sections.length : 0} sections · ${slug ?? '—'}`,
    }),
  },
})

// ── Landing page (document, singleton per project) ───────────────────────────
//
// ADR-033 C1: served at /{segment}. Mirrors eventsPage (spec §4.6) and carries
// the ADR-032 lifecycle: its derived status decides whether /{segment} is
// public, and it never gates the item and collection pages beneath it.
// `catalogueListingSection` joins `sections` with the section checklist work.
export const cataloguePage = defineType({
  name: 'cataloguePage',
  title: 'Catalogue page',
  type: 'document',
  groups: [
    { name: 'content', title: 'Content', default: true },
    { name: 'meta', title: 'SEO / Meta' },
    { name: 'sections', title: 'Sections' },
    PUBLISHING_GROUP,
  ],
  fields: [
    projectSlugField,
    defineField({ name: 'heroTitle', title: 'Hero Title', type: 'localizedString', group: 'content', description: 'Kept as an SEO-title fallback.' }),
    defineField({ name: 'heroSubtitle', title: 'Hero Subtitle', type: 'localizedString', group: 'content', description: 'Kept as an SEO-description fallback.' }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'localizedString', group: 'meta' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'localizedText', group: 'meta' }),
    defineField({ name: 'sections', title: 'Sections', type: 'array', group: 'sections', of: PAGE_SECTIONS_OF }),
    ...lifecycleFields(),
  ],
  preview: {
    select: { slug: 'projectSlug' },
    prepare: ({ slug }) => ({ title: 'Catalogue page', subtitle: slug }),
  },
})

// Document types first, then the objects they embed.
export const catalogueSchemaTypes = [
  catalogueItem,
  catalogueCollection,
  catalogueOptionList,
  cataloguePage,
  catalogueOffer,
  catalogueAvailability,
  catalogueOption,
  catalogueItemOptionList,
  catalogueSection,
]

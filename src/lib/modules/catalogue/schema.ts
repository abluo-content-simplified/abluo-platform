import { defineType, defineField, defineArrayMember } from 'sanity'
import { validateUniquePublicId } from '@/lib/sanity/fields/public-id'
import { scopedRef, projectSlugField, PAGE_SECTIONS_OF, anchorIdField, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'
import { PUBLISHING_GROUP, publishingStatusField, publishOnField, unpublishOnField, archivedFields } from '@/lib/sanity/fields/publishing'
import { linkUrlIssue } from './links'
import { FOOD_PROFILE_GROQ, PROFILES, PROFILE_ORDER, can, profileOf } from './profiles'
import { BOOK_YEAR_MIN, bookYearMax } from './isbn'
import { ALLERGENS, allergenDeclarationIssues, describeDeclarationIssue, optionDeclarationIssues, unreviewedChoices, unknownAllergenKeys } from './allergens'

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
  // ADR-038 D2 — one document per publicId (a Studio Duplicate used to copy it).
  validation: (Rule) => Rule.custom((value, context) => validateUniquePublicId(value, context)),
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

// ── Allergen declaration (object, on a food-or-drink item — ADR-033 D-3) ─────
const ALLERGEN_OPTIONS = { list: ALLERGENS.map((value) => ({ title: value, value })) }
const allergenKeysValid = (Rule: { custom: (fn: (v: unknown) => true | string) => unknown }) =>
  Rule.custom((value) => {
    const unknown = unknownAllergenKeys(value as unknown[] | undefined)
    return unknown.length === 0 || `Unknown allergen key: ${unknown.join(', ')}`
  })
// An inline object on the item's field (not a registered type), so the module
// manifest's schemaTypes list stays as it is.
const allergenDeclarationFields = [
    defineField({
      name: 'status',
      title: 'Declaration',
      type: 'string',
      options: {
        list: [
          { title: 'Not reviewed yet (cannot be published)', value: 'notReviewed' },
          { title: 'Contains allergens from the EU list', value: 'containsListedAllergens' },
          { title: 'None of the fourteen EU allergens (confirm below)', value: 'noneDeclared' },
        ],
        layout: 'radio',
      },
      initialValue: 'notReviewed',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'allergens',
      title: 'Contains',
      description: 'The fourteen EU allergens (Reg. 1169/2011 Annex II). A closed list — none can be hidden (ADR-033 C3).',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: ALLERGEN_OPTIONS,
      hidden: ({ parent }) => (parent as { status?: string } | undefined)?.status !== 'containsListedAllergens',
      validation: (Rule) => allergenKeysValid(Rule as never) as never,
    }),
    defineField({
      name: 'mayContain',
      title: 'May contain',
      description: 'Kept separate from "Contains".',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: ALLERGEN_OPTIONS,
      // E-1: also on "none declared" (cross-contamination is possible).
      hidden: ({ parent }) => {
        const st = (parent as { status?: string } | undefined)?.status
        return st !== 'containsListedAllergens' && st !== 'noneDeclared'
      },
      validation: (Rule) => allergenKeysValid(Rule as never) as never,
    }),
    defineField({
      name: 'confirmed',
      title: 'I confirm that no allergen from the EU list is declared',
      type: 'boolean',
      hidden: ({ parent }) => (parent as { status?: string } | undefined)?.status !== 'noneDeclared',
    }),
    defineField({
      name: 'note',
      title: 'Note',
      type: 'localizedText',
      hidden: ({ parent }) => {
        const st = (parent as { status?: string } | undefined)?.status
        return st !== 'containsListedAllergens' && st !== 'noneDeclared'
      },
    }),
]

/**
 * ADR-033 D-7 — a slug for a locale may exist only when `name[locale]` is
 * written. Studio twin of the dashboard / server rule.
 */
export function slugsWithoutName(slug: unknown, name: unknown): true | string {
  if (!slug || typeof slug !== 'object') return true
  const names = (name && typeof name === 'object' ? name : {}) as Record<string, unknown>
  const missing = Object.entries(slug as Record<string, unknown>)
    .filter(([l, v]) => !l.startsWith('_') && typeof (v as { current?: unknown } | null)?.current === 'string' && (v as { current: string }).current !== '')
    .map(([l]) => l)
    .filter((l) => typeof names[l] !== 'string' || !(names[l] as string).trim())
  return missing.length === 0 || `An address needs a name in the same language first (${missing.join(', ')}).`
}

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
    // ADR-033 D-3a — a FREE-TEXT `add` choice declares its own allergens (no
    // note). A linked choice takes the linked item's declaration; a `remove`
    // choice never subtracts the item's base allergens and carries none.
    //
    // What Studio can enforce HERE: the shape (unknown status / key / field is
    // an error; an incomplete declaration a warning). It cannot see which items
    // use the list, so "not reviewed blocks publishing" is enforced on the
    // ITEM: catalogueItem.optionLists validation (Studio) and the dashboard's
    // item / option-list publish paths (server).
    defineField({
      name: 'allergenDeclaration',
      title: 'Allergens of this choice',
      description: 'Needed when a food or drink item uses this list.',
      type: 'object',
      fields: allergenDeclarationFields.filter((f) => f.name !== 'note'),
      initialValue: { status: 'notReviewed' },
      hidden: ({ parent }) => {
        const p = parent as { kind?: string; item?: { _ref?: string } } | undefined
        return p?.kind === 'remove' || typeof p?.item?._ref === 'string'
      },
      validation: (Rule) => [
        Rule.custom((value) => {
          const issue = optionDeclarationIssues(value).find((i) => i === 'unknownStatus' || i === 'unknownKey' || i === 'unexpectedField')
          return value == null || !issue || describeDeclarationIssue(issue)
        }).error(),
        Rule.custom((value) => {
          const issue = optionDeclarationIssues(value).find((i) => i === 'noAllergens' || i === 'notConfirmed')
          return value == null || !issue || describeDeclarationIssue(issue)
        }).warning(),
      ],
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
      validation: (Rule) => [
        Rule.min(1).error('An option list needs at least one option.'),
        // ADR-033 E-2 — the other direction of the D-3a rule: while ANY
        // non-archived food-or-drink item uses this list (draft or published,
        // weak references included), an unreviewed free-text "add" choice is an
        // ERROR, so Studio cannot publish it. Same shared helper as the
        // dashboard (unreviewedChoices). Scoped to this project.
        Rule.custom(async (value, context) => {
          const doc = context.document as { _id?: string; projectSlug?: unknown } | undefined
          if (!doc?._id || typeof doc.projectSlug !== 'string' || unreviewedChoices((value ?? []) as never[]).length === 0) return true
          try {
            const users = (await context.getClient({ apiVersion: '2026-05-21' }).fetch(
              OPTION_LIST_FOOD_USERS_QUERY,
              { id: doc._id.replace(/^drafts\./, ''), projectSlug: doc.projectSlug },
              { perspective: 'raw' }
            )) as Array<{ _id: string; name?: unknown }> | null
            return studioOptionListProblem((value ?? []) as never[], users ?? [])
          } catch {
            // A failed read must not let food-safety validation pass silently.
            return 'Could not check which food items use this list. Try again before publishing.'
          }
        }).error(),
      ],
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

/** E-2: every non-archived food-or-drink item (drafts and published; weak references included) that attaches the list. */
export const OPTION_LIST_FOOD_USERS_QUERY = `*[_type == "catalogueItem" && projectSlug == $projectSlug && references($id) && ${FOOD_PROFILE_GROQ} && !defined(archivedAt) && !(_id in path("versions.**"))]{ _id, name }`

const studioText = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? ((Object.entries(v as Record<string, unknown>).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x)?.[1] as string | undefined) ?? null) : null

/** E-2 as Studio text: the unreviewed extras and the food items that use the list — or true. */
export function studioOptionListProblem(options: readonly unknown[], users: ReadonlyArray<{ _id: string; name?: unknown }>): true | string {
  const bad = unreviewedChoices(options as never[]) as Array<{ label?: unknown }>
  if (!bad.length || !users.length) return true
  const names = [...new Map(users.map((u) => [u._id.replace(/^drafts\./, ''), studioText(u.name) ?? 'Untitled item'])).values()]
  const choices = bad.map((c) => `"${studioText(c.label) ?? 'a choice'}"`).join(', ')
  return `Review the allergens of ${choices}: food items use this list (${names.join(', ')}).`
}

/** The first unreviewed free-text "add" choice of these lists (published version first), as Studio text — or true. */
export function studioChoiceProblem(ids: readonly string[], rows: ReadonlyArray<{ _id: string; name?: unknown; options?: unknown[] }>): true | string {
  for (const id of ids) {
    const row = rows.find((r) => r._id === id) ?? rows.find((r) => r._id === `drafts.${id}`)
    const bad = unreviewedChoices((row?.options ?? []) as never[])[0] as { label?: unknown } | undefined
    if (!bad) continue
    const text = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x)?.[1] : null)
    return `Review the allergens of "${String(text(bad.label) ?? 'a choice')}" in the option list "${String(text(row?.name) ?? id)}" before publishing this food item.`
  }
  return true
}

// ── Item (document) ───────────────────────────────────────────────────────────
//
// itemProfile (ADR-033 D-2) classifies the ITEM, not the tenant: a restaurant
// may sell books, a hotel may list food, treatments and products in one
// catalogue. It drives which fields the form shows and which schema.org @type
// the item's own page emits — by lookup, never by branching on what kind of
// business this is (ADR-031 D6: "No code asks 'is this a restaurant?'").
// No initial value: a generic installation stays business-neutral (D-1); the
// dashboard preselects the module setting `defaultItemProfile`.
export const catalogueItem = defineType({
  name: 'catalogueItem',
  title: 'Item',
  type: 'document',
  groups: GROUPS,
  fields: [
    projectSlugField,
    publicIdField,
    defineField({
      name: 'itemProfile',
      title: 'What is it?',
      type: 'string',
      group: 'content',
      options: {
        list: PROFILE_ORDER.map((id) => ({ title: PROFILES[id].label, value: id })),
        layout: 'radio',
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'name',
      title: 'Name',
      type: 'localizedString',
      group: 'content',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'byline',
      title: 'Byline',
      type: 'localizedString',
      group: 'content',
      description: 'A short line under the name, e.g. who made it or when. Plain text.',
    }),
    // ADR-033 Amendment I-3 — a book's plain details. NOT localized (a name on a
    // cover does not translate). Every value optional; the ISBN only advises.
    // Kept (hidden, not published) when the item's type is changed away from book.
    defineField({
      name: 'bookDetails',
      title: 'Book details',
      type: 'object',
      group: 'content',
      hidden: ({ document }) => !can(profileOf(document?.itemProfile), 'bookDetails'),
      fields: [
        defineField({ name: 'author', title: 'Author', type: 'string', validation: (Rule) => Rule.max(120) }),
        defineField({ name: 'publisher', title: 'Publisher', type: 'string', description: 'Optional. Not translated.', validation: (Rule) => Rule.max(120) }),
        defineField({
          name: 'year',
          title: 'Year',
          type: 'number',
          validation: (Rule) => Rule.integer().min(BOOK_YEAR_MIN).max(bookYearMax()),
        }),
        defineField({ name: 'isbn', title: 'ISBN', type: 'string', description: 'Optional. Hyphens and spaces are ignored.' }),
      ],
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
      name: 'links',
      title: 'Links',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'catalogueItemLink' })],
      description: 'Optional links shown on the item’s page, in this order. Not prices.',
      validation: (Rule) => Rule.max(12),
    }),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Defined in the module settings.',
    }),
    // ADR-033 Amendment J slice 7 — keys of the project's `tag` taxonomyTerm records
    // (Categories & Tags in the dashboard). Same plain string list as categories.
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Keys of the tags defined under Categories & Tags.',
    }),
    // ADR-033 D-3 — shown for food and drink only. An explicit declaration, never
    // an inferred one: "not reviewed" blocks publishing (Studio too — this is a
    // validation ERROR), "contains" needs ≥ 1 allergen, "none declared" needs the
    // explicit confirmation. The fourteen EU allergens (Reg. 1169/2011 Annex II)
    // are a PLATFORM CONSTANT: no tenant may extend the list and no
    // configuration may hide one (C3).
    defineField({
      name: 'allergenDeclaration',
      title: 'Allergens',
      type: 'object',
      fields: allergenDeclarationFields,
      group: 'content',
      initialValue: { status: 'notReviewed' },
      hidden: ({ document }) => !can(profileOf(document?.itemProfile), 'foodInformation'),
      validation: (Rule) =>
        Rule.custom((value, context) => {
          if (!can(profileOf((context.document as { itemProfile?: unknown } | undefined)?.itemProfile), 'foodInformation')) return true
          const issues = allergenDeclarationIssues(value)
          return issues.length === 0 || describeDeclarationIssue(issues[0])
        }),
    }),
    defineField({
      name: 'dietary',
      title: 'Dietary',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: 'string' })],
      hidden: ({ document }) => !can(profileOf(document?.itemProfile), 'foodInformation'),
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
      // ADR-033 D-3a — a food item cannot be published while a free-text "add"
      // choice of an attached list is not reviewed (the list's published
      // version, else its draft). Studio twin of the dashboard publish check.
      validation: (Rule) =>
        Rule.custom(async (value, context) => {
          if (!can(profileOf((context.document as { itemProfile?: unknown } | undefined)?.itemProfile), 'foodInformation')) return true
          const ids = [...new Set((Array.isArray(value) ? value : []).map((a) => (a as { list?: { _ref?: unknown } })?.list?._ref).filter((r): r is string => typeof r === 'string'))]
          if (!ids.length) return true
          try {
            const rows = (await context.getClient({ apiVersion: '2026-05-21' }).fetch(
              `*[_type == "catalogueOptionList" && (_id in $ids || _id in $draftIds)]{ _id, name, options }`,
              { ids, draftIds: ids.map((i) => `drafts.${i}`) },
              // Drafts included explicitly: newer API versions default to the published perspective.
              { perspective: 'raw' }
            )) as Array<{ _id: string; name?: unknown; options?: unknown[] }> | null
            return studioChoiceProblem(ids, rows ?? [])
          } catch {
            return true
          }
        }),
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
      validation: (Rule) => Rule.custom((value, context) => slugsWithoutName(value, (context.document as { name?: unknown } | undefined)?.name)),
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
    select: { title: 'name.en', type: 'itemProfile', slug: 'projectSlug', media: 'images.0.image' },
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
// A section may hold any itemProfile, and a parent may hold items of its own.
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
      validation: (Rule) => Rule.custom((value, context) => slugsWithoutName(value, (context.document as { name?: unknown } | undefined)?.name)),
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
// `sections` includes catalogueListingSection via PAGE_SECTIONS_OF.
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

// ── Catalogue listing section (object, embedded in page sections) ─────────────
//
// Spec §4.6. Presentation only (ADR-033 D13): the collection owns the items,
// their order and their nesting; this section decides where one collection
// appears on a page and which details it shows. It never acquires catalogue
// data of its own.
//
// Module-gated (registry sectionTypes): without an enabled catalogue
// installation the section renders nothing.
//
// `showPrices` is three-state (ADR-033 D-6): 'default' follows the catalogue
// setting `showPricesByDefault` LIVE, so a project that changes that setting
// changes every section that never chose otherwise; 'show' / 'hide' override.
// Schema Evolution check (2026-10-14, production dataset): 0 listing sections,
// 0 stored `showPrices` values — the boolean → string change needs no migration.
// An unset value reads as 'default'.
//
// `allergenPresentation` (D-3) replaces `showAllergens`: the declaration is
// ALWAYS shown for food and drink — a section only picks compact or expanded.
export const catalogueListingSection = defineType({
  name: 'catalogueListingSection',
  title: 'Catalogue Section',
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
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'subtitle', title: 'Subtitle', type: 'localizedString' }),
    defineField({
      name: 'collection',
      title: 'Collection',
      type: 'reference',
      to: [{ type: 'catalogueCollection' }],
      options: { filter: scopedRef },
      description: 'The collection to show — its sections, order and items are edited once, in the collection.',
    }),
    defineField({
      name: 'showPrices',
      title: 'Prices',
      type: 'string',
      options: {
        list: [
          { title: 'Use Catalogue default', value: 'default' },
          { title: 'Show', value: 'show' },
          { title: 'Hide', value: 'hide' },
        ],
        layout: 'radio',
      },
      initialValue: 'default',
    }),
    defineField({
      name: 'allergenPresentation',
      title: 'Allergen information',
      type: 'string',
      description: 'Allergens of food and drink are always shown; choose how.',
      options: {
        list: [
          { title: 'Compact', value: 'compact' },
          { title: 'Expanded', value: 'expanded' },
        ],
        layout: 'radio',
      },
      initialValue: 'compact',
    }),
    defineField({
      name: 'emptyStateHeading',
      title: 'Empty state heading',
      type: 'localizedString',
      description: 'Shown when the collection has no items yet. Leave empty to hide the section instead.',
    }),
    defineField({ name: 'emptyStateBody', title: 'Empty state text', type: 'localizedText' }),
  ],
  preview: {
    select: { title: 'title.en', eyebrow: 'eyebrow.en', collection: 'collection.name.en' },
    prepare: ({ title, eyebrow, collection }: { title?: string; eyebrow?: string; collection?: string }) => ({
      title: title || eyebrow || collection || 'Catalogue section',
      subtitle: `Catalogue · ${collection ?? 'no collection chosen'}`,
    }),
  },
})

// ADR-033 Amendment F-2 — one link on an item: a label per language and an
// http(s) address. Not an offer; carries no price.
export const catalogueItemLink = defineType({
  name: 'catalogueItemLink',
  title: 'Link',
  type: 'object',
  fields: [
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      description: 'Optional on a buy link: the website then says "Buy".',
      validation: (Rule) => Rule.custom((value, context) => ((context.parent as { kind?: string } | undefined)?.kind === 'buy' || value ? true : 'A link needs a label.')),
    }),
    defineField({
      name: 'url',
      title: 'Web address',
      type: 'url',
      validation: (Rule) =>
        Rule.required().custom((value) => linkUrlIssue(value)),
    }),
    // Amendment K — additive. Absent = a plain info link (every link stored before this).
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      options: { list: [{ title: 'Link', value: 'info' }, { title: 'Buy link', value: 'buy' }], layout: 'radio' },
      initialValue: 'info',
    }),
    defineField({
      name: 'affiliate',
      title: 'This is an affiliate link',
      type: 'boolean',
      description: 'You earn a commission when someone buys through it. Shows a short disclosure on the page.',
      hidden: ({ parent }) => (parent as { kind?: string } | undefined)?.kind !== 'buy',
    }),
    // Amazon links — additive. Product URLs of OTHER Amazon stores for the same product; the website
    // picks the one for the visitor's country, else uses `url`. Absent on every link stored before.
    defineField({
      name: 'moreUrls',
      title: 'Other Amazon stores',
      type: 'array',
      of: [{ type: 'url' }],
      description: 'Amazon product links for other countries. The website picks one by the visitor’s country.',
      hidden: ({ parent }) => (parent as { kind?: string } | undefined)?.kind !== 'buy',
    }),
  ],
  preview: {
    select: { title: 'label.en', subtitle: 'url' },
    prepare: ({ title, subtitle }: { title?: string; subtitle?: string }) => ({ title: title || subtitle || 'Link', subtitle }),
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
  catalogueItemLink,
  catalogueSection,
  catalogueListingSection,
]

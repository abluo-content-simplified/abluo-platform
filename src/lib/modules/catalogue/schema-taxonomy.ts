import { defineArrayMember, defineField, defineType } from 'sanity'
import { projectSlugField } from '@/lib/sanity/fields/shared'
import { isValidTermKey, TERM_KEY_MAX_LENGTH } from '@/lib/taxonomy/ids'
import { LABEL_MAX, MAX_CATEGORIES, MAX_TAGS } from './taxonomy/limits'
import { PROFILE_ORDER, PROFILES, isItemProfile } from './profiles'

// ── Catalogue V2 R1 — new Sanity types (contracts C1.4, C7.5, C10-6 R1) ──────
//
// Registered in R1 so that no later writer ever writes an undeclared field;
// NOTHING writes these documents in R1 (writers stay legacy). Both documents
// are `liveEdit` (no drafts) and read-only in Studio (C9: break-glass writes
// only, through the same validators as the service).
//
//   catalogueTaxonomy     _id catalogue-taxonomy.<projectSlug> — categories + tags
//                         of one project, as keyed ARRAYS (never map-shaped:
//                         Sanity's attribute-path budget, D-2).
//   cataloguePackHistory  _id catalogue-packs.<projectSlug> — installation history
//                         of applied packs. Read by Setup only (C7.9 guard).
//
// `catalogueChannelRule` (with its `catalogueWeeklyOverride` schedule members) is
// the C2/C5a row type and is registered by the commerce slice (W1); the category
// rule rows below reference it BY NAME.

const keyRule = (v: unknown) =>
  v === undefined || isValidTermKey(v) ? true : `Use lowercase letters, digits, "_" or "-" (at most ${TERM_KEY_MAX_LENGTH} characters).`

const keyField = defineField({
  name: 'key',
  title: 'Key',
  type: 'string',
  readOnly: ({ value }) => typeof value === 'string' && value !== '',
  description: 'Stable identity. Items store this key; it never changes once set.',
  validation: (Rule) => Rule.required().custom(keyRule),
})

const labelField = defineField({
  name: 'label',
  title: 'Label',
  type: 'localizedString',
  validation: (Rule) =>
    Rule.custom((v) => {
      const long = Object.entries((v ?? {}) as Record<string, unknown>).find(([k, x]) => !k.startsWith('_') && typeof x === 'string' && x.trim().length > LABEL_MAX)
      return long ? `The ${long[0]} label is longer than ${LABEL_MAX} characters.` : true
    }),
})

/**
 * D-22 (C1.12) "Use for": the item profiles a root category (inherited by its branch), a tag or an
 * option list is used for. Absent = all item types. Studio critical validation refuses unknown ids
 * and, on a category, a value on a non-root node (the writers refuse both too).
 */
export function profileUseForField(opts: { rootOnly?: boolean; group?: string } = {}) {
  return defineField({
    name: 'useFor',
    title: 'Use for',
    type: 'array',
    ...(opts.group && { group: opts.group }),
    of: [defineArrayMember({ type: 'string' })],
    options: { list: PROFILE_ORDER.map((id) => ({ title: PROFILES[id].label, value: id })), layout: 'grid' },
    description: opts.rootOnly
      ? 'Item types this top-level category and everything under it are used for. Empty = all item types. Set in Catalogue → Setup.'
      : 'Item types this is used for. Empty = all item types. Set in the dashboard.',
    validation: (Rule) =>
      Rule.custom((value, context) => {
        const list = Array.isArray(value) ? value : []
        const unknown = list.find((v) => !isItemProfile(v))
        if (unknown !== undefined) return `Unknown item type "${String(unknown)}".`
        const parent = (context.parent as { parentKey?: unknown } | undefined)?.parentKey
        if (opts.rootOnly && list.length > 0 && typeof parent === 'string' && parent !== '') return 'Only a top-level category has "Use for"; categories under it inherit it.'
        return true
      }).error(),
  })
}

export const catalogueCategory = defineType({
  name: 'catalogueCategory',
  title: 'Category',
  type: 'object',
  fields: [
    keyField,
    labelField,
    defineField({ name: 'parentKey', title: 'Parent', type: 'string', description: 'Key of the parent category; empty = top level.' }),
    defineField({ name: 'order', title: 'Order', type: 'number', description: 'Position among its siblings (same parent).' }),
    defineField({
      name: 'channelRules',
      title: 'Availability by channel',
      type: 'array',
      // C5a-2: one complete rule per channel (baseline + optional weekly schedule); `_key` = channel key.
      of: [defineArrayMember({ type: 'catalogueChannelRule' })],
      description: 'A channel without a row inherits. A row replaces the inherited rule for that channel as a whole.',
    }),
    defineField({
      name: 'defaultOptionListIds',
      title: 'Default option lists',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Attached to NEW items of this category only.',
    }),
    defineField({ name: 'archivedAt', title: 'Archived', type: 'datetime' }),
    profileUseForField({ rootOnly: true }),
  ],
  preview: {
    select: { key: 'key', en: 'label.en', it: 'label.it', de: 'label.de', parent: 'parentKey' },
    prepare: ({ key, en, it, de, parent }) => ({ title: en || it || de || key, subtitle: parent ? `under ${parent}` : 'top level' }),
  },
})

export const catalogueTag = defineType({
  name: 'catalogueTag',
  title: 'Tag',
  type: 'object',
  fields: [keyField, labelField, defineField({ name: 'order', title: 'Order', type: 'number' }), defineField({ name: 'archivedAt', title: 'Archived', type: 'datetime' }), profileUseForField()],
  preview: {
    select: { key: 'key', en: 'label.en', it: 'label.it', de: 'label.de' },
    prepare: ({ key, en, it, de }) => ({ title: en || it || de || key }),
  },
})

export const catalogueTaxonomy = defineType({
  name: 'catalogueTaxonomy',
  title: 'Catalogue categories and tags',
  type: 'document',
  liveEdit: true,
  // Document-level read-only is the Catalogue Studio posture's (C9 §9.3, applied in sanity.config.ts; fails closed).
  fields: [
    projectSlugField,
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      of: [defineArrayMember({ type: 'catalogueCategory' })],
      validation: (Rule) => Rule.max(MAX_CATEGORIES),
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [defineArrayMember({ type: 'catalogueTag' })],
      validation: (Rule) => Rule.max(MAX_TAGS),
    }),
    defineField({ name: 'updatedAt', title: 'Updated', type: 'datetime', readOnly: true }),
    defineField({ name: 'updatedBy', title: 'Updated by', type: 'string', readOnly: true }),
  ],
  preview: {
    select: { projectSlug: 'projectSlug' },
    prepare: ({ projectSlug }) => ({ title: 'Catalogue categories and tags', subtitle: projectSlug }),
  },
})

// ── pack history (C7.5) ──────────────────────────────────────────────────────

const keyList = (name: string, title: string) => defineField({ name, title, type: 'array', of: [defineArrayMember({ type: 'string' })] })

export const catalogueAppliedPack = defineType({
  name: 'catalogueAppliedPack',
  title: 'Applied pack',
  type: 'object',
  fields: [
    defineField({ name: 'id', title: 'Pack', type: 'string' }),
    defineField({ name: 'version', title: 'Version', type: 'number' }),
    defineField({ name: 'appliedAt', title: 'Applied', type: 'datetime' }),
    defineField({ name: 'appliedBy', title: 'Applied by', type: 'string' }),
    defineField({
      name: 'added',
      title: 'Added',
      type: 'object',
      fields: [
        keyList('categories', 'Categories'),
        keyList('tags', 'Tags'),
        keyList('collections', 'Collections'),
        keyList('sections', 'Sections'),
        keyList('optionGroups', 'Option groups'),
        keyList('channels', 'Channels'),
        keyList('formats', 'Formats'),
        keyList('settings', 'Settings'),
      ],
    }),
    defineField({
      name: 'mapped',
      title: 'Mapped to existing',
      type: 'array',
      // Rows, not a map (attribute-path budget): { from: "category:dolci", to: "desserts" }.
      of: [defineArrayMember({ type: 'object', name: 'catalogueAppliedPackMapping', fields: [defineField({ name: 'from', type: 'string' }), defineField({ name: 'to', type: 'string' })] })],
    }),
    keyList('skipped', 'Skipped'),
  ],
  preview: {
    select: { id: 'id', version: 'version', appliedAt: 'appliedAt' },
    prepare: ({ id, version, appliedAt }) => ({ title: `${id ?? '?'}@${version ?? '?'}`, subtitle: appliedAt }),
  },
})

export const cataloguePackHistory = defineType({
  name: 'cataloguePackHistory',
  title: 'Catalogue pack history',
  type: 'document',
  liveEdit: true,
  // Document-level read-only is the Catalogue Studio posture's (C9 §9.3, applied in sanity.config.ts; fails closed).
  fields: [projectSlugField, defineField({ name: 'applied', title: 'Applied packs', type: 'array', of: [defineArrayMember({ type: 'catalogueAppliedPack' })] })],
  preview: {
    select: { projectSlug: 'projectSlug' },
    prepare: ({ projectSlug }) => ({ title: 'Catalogue pack history', subtitle: projectSlug }),
  },
})

/** Category-key fields of `catalogueItem` (C1.4) — spread into its field list in schema.ts. */
export const catalogueItemCategoryFields = [
  defineField({
    name: 'primaryCategory',
    title: 'Primary category',
    type: 'string',
    group: 'content',
    readOnly: true,
    description: 'Key of the main category. Decides channel availability. Set from the dashboard.',
  }),
  defineField({
    name: 'additionalCategories',
    title: 'Additional categories',
    type: 'array',
    group: 'content',
    readOnly: true,
    of: [defineArrayMember({ type: 'string' })],
    description: 'Keys of further categories (discovery only; never availability). Set from the dashboard.',
  }),
]

/** Names, for the manifest's schemaTypes list. */
export const CATALOGUE_TAXONOMY_SCHEMA_TYPE_NAMES = ['catalogueTaxonomy', 'catalogueCategory', 'catalogueTag', 'cataloguePackHistory', 'catalogueAppliedPack'] as const

export const catalogueTaxonomySchemaTypes = [catalogueTaxonomy, catalogueCategory, catalogueTag, cataloguePackHistory, catalogueAppliedPack]

import { defineArrayMember, defineField, defineType } from 'sanity'
import { QUANTITY_UNITS } from './commerce/formats'

// ── Catalogue V2 commerce — schema registration (R1; contract C10-6) ──────────
//
// R1 registers these types and fields so that no later writer ever writes an
// undeclared field (REVIEW C-3). NOTHING WRITES THEM IN R1: the dashboard and
// every server writer still write legacy `offers[]` (writers switch in R2, on
// the same document they rewrite). Every new item field is hidden and
// read-only in Studio (C9: Catalogue documents are read-only in Studio; the
// dashboard is the editor).
//
//   catalogueFormat          a sellable form of an item (C3-3)
//   cataloguePrice           a price of a format; `channel` omitted = standard (C4-4)
//   catalogueWeeklyWindow    a PRICE window — which price applies when (never availability)
//   catalogueChannelRule     one availability rule for one channel at one level (C5-7);
//                            `_key` IS the channel key; optional `schedule[]` (C5a-2)
//   catalogueWeeklyOverride  one weekly scheduled override of a rule's baseline (C5a)
//   catalogueFormatTemplate  module config `formatTemplates[]` entry (C3-6)
//   catalogueMigrationMarkers module config `catalogueMigrations` (C10-6)

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DAY_OPTIONS = {
  list: [
    { title: 'Monday', value: 'mon' },
    { title: 'Tuesday', value: 'tue' },
    { title: 'Wednesday', value: 'wed' },
    { title: 'Thursday', value: 'thu' },
    { title: 'Friday', value: 'fri' },
    { title: 'Saturday', value: 'sat' },
    { title: 'Sunday', value: 'sun' },
  ],
}
const STATE_OPTIONS = {
  list: [
    { title: 'Available', value: 'available' },
    { title: 'Unavailable', value: 'unavailable' },
  ],
  layout: 'radio' as const,
}

const weeklyFields = (what: string) => [
  defineField({ name: 'days', title: 'Days', type: 'array', of: [defineArrayMember({ type: 'string' })], options: DAY_OPTIONS, description: `Leave empty for every day. Names the day the ${what} starts.` }),
  defineField({ name: 'from', title: 'From', type: 'string', validation: (Rule) => Rule.regex(HHMM).error('Use HH:mm, e.g. 18:00') }),
  defineField({ name: 'to', title: 'To', type: 'string', validation: (Rule) => Rule.regex(HHMM).error('Use HH:mm, e.g. 22:00') }),
]
const notZeroLength = (value: unknown): true | string => {
  const v = value as { from?: string; to?: string } | undefined
  if (!v?.from || !v?.to) return true
  return v.from !== v.to ? true : 'The start and end times cannot be the same.'
}
const weeklyPreview = {
  select: { days: 'days', from: 'from', to: 'to', state: 'state' },
  prepare: ({ days, from, to, state }: { days?: string[]; from?: string; to?: string; state?: string }) => ({
    title: [Array.isArray(days) && days.length ? days.join(', ') : 'Every day', from && to ? `${from}–${to}` : 'All day'].join(' · '),
    subtitle: state,
  }),
}

/** A PRICE window (C4): chooses which price applies; never decides availability (K-3 rule 9). Same fields and checks as the legacy catalogueAvailability. */
export const catalogueWeeklyWindow = defineType({
  name: 'catalogueWeeklyWindow',
  title: 'Price time window',
  type: 'object',
  fields: weeklyFields('window'),
  validation: (Rule) => Rule.custom(notZeroLength),
  preview: weeklyPreview,
})

/** One weekly override of an availability rule's baseline (C5a). The member `_type` is the discriminator (D-6.4). */
export const catalogueWeeklyOverride = defineType({
  name: 'catalogueWeeklyOverride',
  title: 'Scheduled availability',
  type: 'object',
  fields: [...weeklyFields('interval'), defineField({ name: 'state', title: 'State', type: 'string', options: STATE_OPTIONS, validation: (Rule) => Rule.required() })],
  validation: (Rule) => Rule.custom(notZeroLength),
  preview: weeklyPreview,
})

/** One availability rule for ONE channel (category, item, format). "Inherit" is no row — never stored. */
export const catalogueChannelRule = defineType({
  name: 'catalogueChannelRule',
  title: 'Channel availability',
  type: 'object',
  fields: [
    defineField({ name: 'channel', title: 'Channel', type: 'string', description: 'The channel key; equals this row’s key.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'state', title: 'Baseline', type: 'string', options: STATE_OPTIONS, description: 'In force whenever no scheduled override applies.', validation: (Rule) => Rule.required() }),
    defineField({ name: 'schedule', title: 'Schedule', type: 'array', of: [defineArrayMember({ type: 'catalogueWeeklyOverride' })], description: 'Optional weekly overrides of the baseline. Empty = the baseline all week.', validation: (Rule) => Rule.max(14) }),
  ],
  preview: { select: { title: 'channel', subtitle: 'state' } },
})

/** A price of a format (C4-4). Reserved fields are declared, hidden and never written (D7, D14, A5). */
export const cataloguePrice = defineType({
  name: 'cataloguePrice',
  title: 'Price',
  type: 'object',
  fields: [
    defineField({ name: 'amount', title: 'Amount', type: 'number', validation: (Rule) => Rule.required().min(0).precision(2) }),
    defineField({ name: 'channel', title: 'Service channel', type: 'string', description: 'Leave empty for the standard price.' }),
    defineField({ name: 'note', title: 'Price note', type: 'localizedString', description: 'Shown beside the price — "per 100 g", "from". Never parsed.' }),
    defineField({ name: 'windows', title: 'When this price applies', type: 'array', of: [defineArrayMember({ type: 'catalogueWeeklyWindow' })], description: 'Leave empty for always. Chooses the price; never makes the item available or unavailable.' }),
    defineField({ name: 'currency', title: 'Currency override', type: 'string', hidden: true, readOnly: true, description: 'Reserved for multi-currency. Never written — the project currency applies.' }),
    defineField({ name: 'locationKey', title: 'Location', type: 'string', hidden: true, readOnly: true, description: 'Reserved for multi-location projects.' }),
  ],
  preview: {
    select: { channel: 'channel', amount: 'amount' },
    prepare: ({ channel, amount }) => ({ title: channel ?? 'Standard', subtitle: typeof amount === 'number' ? String(amount) : 'No amount' }),
  },
})

/** A sellable form of an item (C3-3). Absent `formats` = one implicit format. */
export const catalogueFormat = defineType({
  name: 'catalogueFormat',
  title: 'Format',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString', description: 'Omitted on the implicit format; required when an item has two or more.' }),
    defineField({
      name: 'identifiers',
      title: 'Identifiers',
      type: 'object',
      fields: [
        defineField({ name: 'sku', title: 'SKU', type: 'string' }),
        defineField({ name: 'isbn', title: 'ISBN', type: 'string' }),
        defineField({ name: 'gtin', title: 'GTIN', type: 'string' }),
      ],
    }),
    defineField({
      name: 'quantity',
      title: 'Quantity',
      type: 'object',
      fields: [
        defineField({ name: 'value', title: 'Value', type: 'number' }),
        defineField({ name: 'unit', title: 'Unit', type: 'string', options: { list: QUANTITY_UNITS.map((u) => ({ title: u, value: u })) } }),
      ],
    }),
    defineField({ name: 'templateKey', title: 'Template', type: 'string', description: 'The format template this was copied from. Provenance only — never a live link.' }),
    defineField({ name: 'channelAvailability', title: 'Channel availability', type: 'array', of: [defineArrayMember({ type: 'catalogueChannelRule' })], description: 'Format overrides. No row = inherit.' }),
    defineField({ name: 'prices', title: 'Prices', type: 'array', of: [defineArrayMember({ type: 'cataloguePrice' })], validation: (Rule) => Rule.max(50) }),
  ],
  preview: { select: { title: 'label.en', subtitle: 'templateKey' } },
})

/** Module config `formatTemplates[]` entry (C3-6): copied into a new format, never linked. */
export const catalogueFormatTemplate = defineType({
  name: 'catalogueFormatTemplate',
  title: 'Format template',
  type: 'object',
  fields: [
    defineField({ name: 'key', title: 'Key', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'label', title: 'Label', type: 'localizedString', validation: (Rule) => Rule.required() }),
    defineField({
      name: 'quantity',
      title: 'Quantity',
      type: 'object',
      fields: [
        defineField({ name: 'value', title: 'Value', type: 'number' }),
        defineField({ name: 'unit', title: 'Unit', type: 'string', options: { list: QUANTITY_UNITS.map((u) => ({ title: u, value: u })) } }),
      ],
    }),
  ],
  preview: { select: { title: 'label.en', subtitle: 'key' } },
})

/** The C10-6 data steps that set a migration marker. */
export const CATALOGUE_MIGRATION_STEPS = ['taxonomy', 'commerce', 'packHistory', 'publicName'] as const
/** Module config `catalogueMigrations` as read (ISO strings); gates readiness rule activation (C6). */
export type CatalogueMigrationState = Partial<Record<(typeof CATALOGUE_MIGRATION_STEPS)[number], string>>

/** Module config `catalogueMigrations` (C10-6): one ISO timestamp per verified data step. Module-written; the only runtime-readable migration facts. */
export const catalogueMigrationMarkers = defineType({
  name: 'catalogueMigrationMarkers',
  title: 'Catalogue migrations',
  type: 'object',
  fields: CATALOGUE_MIGRATION_STEPS.map((name) => defineField({ name, title: name, type: 'datetime', readOnly: true })),
})

/** Item fields added in R1 — hidden and read-only in Studio, written by no one until R2. */
export const catalogueItemCommerceFields = [
  defineField({
    name: 'formats',
    title: 'Formats',
    type: 'array',
    group: 'commerce',
    of: [defineArrayMember({ type: 'catalogueFormat' })],
    hidden: true,
    readOnly: true,
    validation: (Rule) => Rule.max(24),
  }),
  defineField({
    name: 'channelAvailability',
    title: 'Channel availability',
    type: 'array',
    group: 'commerce',
    of: [defineArrayMember({ type: 'catalogueChannelRule' })],
    hidden: true,
    readOnly: true,
  }),
]

/** Object types, in dependency order (members before containers is not required by Sanity, but reads better). */
export const catalogueCommerceSchemaTypes = [
  catalogueWeeklyWindow,
  catalogueWeeklyOverride,
  catalogueChannelRule,
  cataloguePrice,
  catalogueFormat,
  catalogueFormatTemplate,
  catalogueMigrationMarkers,
]

export const CATALOGUE_COMMERCE_SCHEMA_TYPE_NAMES = catalogueCommerceSchemaTypes.map((t) => t.name)

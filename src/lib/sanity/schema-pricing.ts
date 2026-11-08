import { defineArrayMember, defineField, defineType } from 'sanity'
import { anchorIdField, headlineAccentField, BACKGROUND_SURFACE_OPTIONS } from '@/lib/sanity/fields/shared'
import { PricingCardsWireframe, ComparisonTableWireframe } from '@/sanity/components/SectionWireframes'

// ─── Pricing sections (platform) ─────────────────────────────────────────────
//
// Two presentation sections with INLINE content (Tom, 2026-11-07: keep pricing
// simple, no Catalogue coupling until a second real tenant needs it):
//
//   pricingCardsSection     plan / package / add-on cards, optional
//                           monthly ⇄ yearly switch
//   comparisonTableSection  features × plans grid (✓ / — / short text)
//
// Prices are NUMBERS plus a section ISO currency, formatted per visitor locale
// (src/lib/price-list/format.ts). Yearly figures, monthly equivalents and
// savings are computed (src/lib/pricing/billing.ts), never typed twice.
//
// One switch drives the whole page: every price with a yearly figure renders
// both variants and CSS shows one (globals.css, "Billing switch"). A section
// without its own switch follows the one elsewhere on the page.
//
// Every top-level key is unique in the flat PAGE_SECTIONS_PROJECTION except
// the shared header keys (eyebrow/title/headlineAccent/intro), currency,
// priceDecimals and footnote, which mean the same thing as in priceListSection.

const DECIMALS_FIELD = defineField({
  name: 'priceDecimals',
  title: 'Decimals',
  type: 'string',
  fieldset: 'pricing',
  options: {
    list: [
      { title: 'Automatic — €29, €32.50 (monthly equivalents rounded: €24)', value: 'auto' },
      { title: 'None — always round (€33)', value: 'none' },
      { title: 'Always — €29.00 (monthly equivalents with cents: €24.17)', value: 'always' },
    ],
    layout: 'radio',
  },
  initialValue: 'auto',
})

const CURRENCY_FIELD = defineField({
  name: 'currency',
  title: 'Currency',
  type: 'string',
  fieldset: 'pricing',
  description: 'Three-letter code, e.g. EUR, CHF, GBP. Prices are shown in each visitor’s language format.',
  initialValue: 'EUR',
  validation: (Rule) => Rule.regex(/^[A-Z]{3}$/, { name: 'ISO currency code' }),
})

const YEARLY_MONTHS_FIELD = defineField({
  name: 'yearlyPaidMonths',
  title: 'Yearly price = how many monthly payments',
  type: 'number',
  fieldset: 'pricing',
  description:
    'Optional. E.g. 10 for "12 months for the price of 10": every card without its own yearly price gets monthly × 10. Leave empty to type yearly prices yourself (or have none).',
  validation: (Rule) => Rule.min(1).max(12),
})

const MONTHLY_FIELD = (description: string) =>
  defineField({ name: 'priceMonthly', title: 'Monthly price', type: 'number', description, validation: (Rule) => Rule.min(0) })

const YEARLY_FIELD = defineField({
  name: 'priceYearly',
  title: 'Yearly price (optional)',
  type: 'number',
  description: 'Leave empty to use the section’s "yearly = N months" rule, or to have no yearly price.',
  validation: (Rule) => Rule.min(0),
})

const pickTitle = (v: Record<string, string | undefined>) => v.en ?? v.it ?? v.de ?? v.fr

// ─── Pricing cards ───────────────────────────────────────────────────────────

export const pricingCardDetailType = defineType({
  name: 'pricingCardDetail',
  title: 'Detail',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString', description: 'E.g. "Plan", "Modules".', validation: (Rule) => Rule.required() }),
    defineField({ name: 'value', title: 'Value', type: 'localizedString', description: 'E.g. "Flex", "Events, Testimonials, Jobs".' }),
  ],
  preview: {
    select: { en: 'label.en', it: 'label.it', v: 'value.en' },
    prepare: ({ en, it, v }: { en?: string; it?: string; v?: string }) => ({ title: en ?? it ?? 'Detail', subtitle: v }),
  },
})

export const pricingCardType = defineType({
  name: 'pricingCard',
  title: 'Pricing Card',
  type: 'object',
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'localizedString', validation: (Rule) => Rule.required() }),
    defineField({ name: 'highlighted', title: 'Highlight this card', type: 'boolean', description: 'A stronger border and a primary button. Use on one card at most.', initialValue: false }),
    defineField({ name: 'badge', title: 'Badge', type: 'localizedString', description: 'Small label beside the name, e.g. "Most popular".' }),
    defineField({ name: 'tagline', title: 'Short description', type: 'localizedText' }),
    defineField({ name: 'pricePrefix', title: 'Before the price', type: 'localizedString', description: 'Optional, e.g. "from".' }),
    MONTHLY_FIELD('A number only — no currency sign. Leave empty for a card without a price.'),
    YEARLY_FIELD,
    defineField({ name: 'priceNote', title: 'Note under the price', type: 'localizedString', description: 'Optional. Replaces the automatic line ("Billed monthly…") in both views, e.g. "one-off fee".' }),
    defineField({ name: 'details', title: 'Details', type: 'array', of: [defineArrayMember({ type: 'pricingCardDetail' })], description: 'Optional label / value lines, e.g. Plan: Flex.', validation: (Rule) => Rule.max(6) }),
    defineField({ name: 'features', title: 'Bullet points', type: 'array', of: [defineArrayMember({ type: 'localizedString' })], description: 'What the card includes. Drag to reorder.', validation: (Rule) => Rule.max(15) }),
    defineField({ name: 'audience', title: 'Who it is for', type: 'localizedString', description: 'Small muted line at the bottom, e.g. "Restaurants, shops, studios".' }),
    defineField({ name: 'cta', title: 'Button', type: 'cta' }),
  ],
  preview: {
    select: { en: 'name.en', it: 'name.it', de: 'name.de', m: 'priceMonthly', h: 'highlighted' },
    prepare: ({ en, it, de, m, h }: { en?: string; it?: string; de?: string; m?: number; h?: boolean }) => ({
      title: pickTitle({ en, it, de }) ?? 'Card',
      subtitle: [typeof m === 'number' ? `${m} / month` : 'no price', h ? 'highlighted' : ''].filter(Boolean).join(' · '),
    }),
  },
})

export const pricingCardsSectionType = defineType({
  name: 'pricingCardsSection',
  title: 'Pricing Cards Section',
  type: 'object',
  icon: PricingCardsWireframe,
  fieldsets: [
    { name: 'pricing', title: 'Price display', options: { collapsible: true, collapsed: false } },
    { name: 'switch', title: 'Monthly / yearly', options: { collapsible: true, collapsed: false } },
  ],
  fields: [
    anchorIdField(),
    defineField({ name: 'background', title: 'Background Surface', type: 'string', options: { list: BACKGROUND_SURFACE_OPTIONS }, initialValue: 'usePagePattern' }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({
      name: 'titleIsPageHeading',
      title: 'The title is the page’s main heading',
      type: 'boolean',
      description: 'Turn on when this section opens a page that has no hero (the title becomes the page’s h1, slightly larger). One per page.',
      initialValue: false,
    }),
    headlineAccentField(),
    defineField({ name: 'intro', title: 'Intro', type: 'localizedText' }),
    defineField({
      name: 'cardLayout',
      title: 'Card style',
      type: 'string',
      options: {
        list: [
          { title: 'Plans — large cards, big price, button, bullet points', value: 'plans' },
          { title: 'Compact — smaller cards in a grid (add-ons, packages)', value: 'compact' },
        ],
        layout: 'radio',
      },
      initialValue: 'plans',
    }),
    CURRENCY_FIELD,
    DECIMALS_FIELD,
    YEARLY_MONTHS_FIELD,
    defineField({
      name: 'showBillingSwitch',
      title: 'Show the monthly / yearly switch',
      type: 'boolean',
      fieldset: 'switch',
      description: 'Shown only when a card has a yearly price. Other pricing sections on the page follow this switch, so turn it on in one section only.',
      initialValue: false,
    }),
    defineField({
      name: 'yearlyDisplay',
      title: 'In the yearly view, show',
      type: 'string',
      fieldset: 'switch',
      options: {
        list: [
          { title: 'The monthly equivalent (€24 / month)', value: 'monthlyEquivalent' },
          { title: 'The yearly total (€190 / year)', value: 'yearlyTotal' },
        ],
        layout: 'radio',
      },
      initialValue: 'monthlyEquivalent',
    }),
    defineField({ name: 'periodNoteMonthly', title: 'Note in the monthly view', type: 'localizedText', fieldset: 'switch', description: 'Optional line under the switch or the title, e.g. "Pay monthly and cancel any time".' }),
    defineField({ name: 'periodNoteYearly', title: 'Note in the yearly view', type: 'localizedText', fieldset: 'switch', description: 'Optional, e.g. "Prices show the monthly equivalent".' }),
    defineField({ name: 'pricingCards', title: 'Cards', type: 'array', of: [defineArrayMember({ type: 'pricingCard' })], description: 'Drag to reorder.', validation: (Rule) => Rule.max(12) }),
    defineField({ name: 'includedTitle', title: 'Included in every card — heading', type: 'localizedString', description: 'Optional, e.g. "Every plan includes".' }),
    defineField({ name: 'included', title: 'Included in every card', type: 'array', of: [defineArrayMember({ type: 'localizedString' })], description: 'Short items shown as chips under the cards.', validation: (Rule) => Rule.max(16) }),
    defineField({ name: 'footnote', title: 'Footnote', type: 'localizedText', description: 'Small print under everything. Line breaks you type are kept.' }),
  ],
  preview: {
    select: { en: 'title.en', it: 'title.it', de: 'title.de', cards: 'pricingCards', layout: 'cardLayout', sw: 'showBillingSwitch' },
    prepare: ({ en, it, de, cards, layout, sw }: { en?: string; it?: string; de?: string; cards?: unknown[]; layout?: string; sw?: boolean }) => ({
      title: pickTitle({ en, it, de }) ?? 'Pricing cards',
      subtitle: `Pricing Cards Section — ${cards?.length ?? 0} cards · ${layout === 'compact' ? 'compact' : 'plans'}${sw ? ' · switch' : ''}`,
      media: PricingCardsWireframe,
    }),
  },
})

// ─── Comparison table ────────────────────────────────────────────────────────

export const comparisonColumnType = defineType({
  name: 'comparisonColumn',
  title: 'Column',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString', description: 'E.g. the plan name.', validation: (Rule) => Rule.required() }),
    MONTHLY_FIELD('Optional — shown under the label, follows the monthly / yearly switch.'),
    YEARLY_FIELD,
    defineField({ name: 'highlighted', title: 'Highlight this column', type: 'boolean', initialValue: false }),
  ],
  preview: {
    select: { en: 'label.en', it: 'label.it', m: 'priceMonthly' },
    prepare: ({ en, it, m }: { en?: string; it?: string; m?: number }) => ({ title: en ?? it ?? 'Column', subtitle: typeof m === 'number' ? `${m} / month` : undefined }),
  },
})

export const comparisonCellType = defineType({
  name: 'comparisonCell',
  title: 'Cell',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      title: 'Shows',
      type: 'string',
      options: {
        list: [
          { title: '✓ Included', value: 'included' },
          { title: '— Not included', value: 'notIncluded' },
          { title: 'Short text', value: 'text' },
        ],
        layout: 'radio',
        direction: 'horizontal',
      },
      initialValue: 'included',
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'text', title: 'Text', type: 'localizedString', hidden: ({ parent }) => (parent as { kind?: string } | undefined)?.kind !== 'text' }),
  ],
  preview: {
    select: { kind: 'kind', en: 'text.en', it: 'text.it' },
    prepare: ({ kind, en, it }: { kind?: string; en?: string; it?: string }) => ({
      title: kind === 'text' ? (en ?? it ?? 'Text') : kind === 'notIncluded' ? '—' : '✓',
    }),
  },
})

export const comparisonRowType = defineType({
  name: 'comparisonRow',
  title: 'Row',
  type: 'object',
  fields: [
    defineField({ name: 'label', title: 'Label', type: 'localizedString', validation: (Rule) => Rule.required() }),
    defineField({ name: 'note', title: 'Note', type: 'localizedString', description: 'Optional small line under the label.' }),
    defineField({
      name: 'cells',
      title: 'Cells',
      type: 'array',
      of: [defineArrayMember({ type: 'comparisonCell' })],
      description: 'One cell per column, in the same order as the columns. Missing cells show "—".',
      validation: (Rule) => Rule.max(6),
    }),
  ],
  preview: {
    select: { en: 'label.en', it: 'label.it', cells: 'cells' },
    prepare: ({ en, it, cells }: { en?: string; it?: string; cells?: { kind?: string }[] }) => ({
      title: en ?? it ?? 'Row',
      subtitle: (cells ?? []).map((c) => (c?.kind === 'notIncluded' ? '—' : c?.kind === 'text' ? 'text' : '✓')).join('  '),
    }),
  },
})

export const comparisonGroupType = defineType({
  name: 'comparisonGroup',
  title: 'Group',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Group heading', type: 'localizedString', description: 'Optional, e.g. "Platform".' }),
    defineField({ name: 'compareRows', title: 'Rows', type: 'array', of: [defineArrayMember({ type: 'comparisonRow' })], validation: (Rule) => Rule.max(40) }),
  ],
  preview: {
    select: { en: 'title.en', it: 'title.it', rows: 'compareRows' },
    prepare: ({ en, it, rows }: { en?: string; it?: string; rows?: unknown[] }) => ({ title: en ?? it ?? 'Group', subtitle: `${rows?.length ?? 0} rows` }),
  },
})

export const comparisonTableSectionType = defineType({
  name: 'comparisonTableSection',
  title: 'Comparison Table Section',
  type: 'object',
  icon: ComparisonTableWireframe,
  fieldsets: [{ name: 'pricing', title: 'Prices in the column headers', options: { collapsible: true, collapsed: true } }],
  fields: [
    anchorIdField(),
    defineField({ name: 'background', title: 'Background Surface', type: 'string', options: { list: BACKGROUND_SURFACE_OPTIONS }, initialValue: 'usePagePattern' }),
    defineField({ name: 'eyebrow', title: 'Eyebrow', type: 'localizedString' }),
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    headlineAccentField(),
    defineField({ name: 'intro', title: 'Intro', type: 'localizedText' }),
    defineField({ name: 'firstColumnLabel', title: 'First column heading', type: 'localizedString', description: 'Optional, e.g. "Feature".' }),
    defineField({ name: 'compareColumns', title: 'Columns', type: 'array', of: [defineArrayMember({ type: 'comparisonColumn' })], description: 'Up to 5. Drag to reorder — then reorder the cells in each row the same way.', validation: (Rule) => Rule.max(5) }),
    defineField({ name: 'compareGroups', title: 'Groups of rows', type: 'array', of: [defineArrayMember({ type: 'comparisonGroup' })], validation: (Rule) => Rule.max(12) }),
    CURRENCY_FIELD,
    DECIMALS_FIELD,
    YEARLY_MONTHS_FIELD,
    defineField({ name: 'footnote', title: 'Footnote', type: 'localizedText' }),
  ],
  preview: {
    select: { en: 'title.en', it: 'title.it', de: 'title.de', cols: 'compareColumns', groups: 'compareGroups' },
    prepare: ({ en, it, de, cols, groups }: { en?: string; it?: string; de?: string; cols?: unknown[]; groups?: unknown[] }) => ({
      title: pickTitle({ en, it, de }) ?? 'Comparison table',
      subtitle: `Comparison Table Section — ${cols?.length ?? 0} columns · ${groups?.length ?? 0} groups`,
      media: ComparisonTableWireframe,
    }),
  },
})

export const pricingSchemaTypes = [
  pricingCardDetailType,
  pricingCardType,
  pricingCardsSectionType,
  comparisonColumnType,
  comparisonCellType,
  comparisonRowType,
  comparisonGroupType,
  comparisonTableSectionType,
]

import { defineType, defineField, defineArrayMember } from 'sanity'
import { projectSlugField, scopedRef } from '@/lib/sanity/fields/shared'
import { baseDocumentId, validateUniquePublicId } from '@/lib/sanity/fields/public-id'
import { PUBLISHING_GROUP, archivedFields, publishingStatusField, unpublishOnField } from '@/lib/sanity/fields/publishing'
import {
  DIGITAL_CARD_KINDS,
  DIGITAL_CARD_LIMITS,
  DIGITAL_CARD_LINK_KINDS,
  DIGITAL_CARD_LINK_TARGET,
  DIGITAL_CARD_LINK_TYPE,
  DIGITAL_CARD_MODULE_TARGETS,
  DIGITAL_CARD_NAME_MODES,
  DIGITAL_CARD_PAGE_REF_TYPES,
  DIGITAL_CARD_SECTIONS,
  DIGITAL_CARD_TYPE,
  DIGITAL_CARD_URL_NAME_MAX,
  DIGITAL_CARD_URL_NAME_PATTERN,
  cardTextLength,
  primaryLinkCount,
  takenUrlNames,
  type DigitalCardKind,
  type DigitalCardLinkKind,
  type DigitalCardSection,
} from './model'

// ── Digital Cards module — Sanity schema types (ADR-049) ──────────────────────
//
// Owned by: digital-cards module (MODULE_REGISTRY id: 'digital-cards')
//   digitalCard     — collection document: one card. `site` (one per project,
//                     /link) or `person` (a People person, /link/<urlName>).
//                     Stores ONLY its own links, background and visibility
//                     switches — never copies of Website Settings or People
//                     data (D2, D3).
//   digitalCardLink — one link of a card (D8).
//
// Studio is staff-only; clients edit cards in the dashboard (Content → Digital
// Cards). Statistics live in Supabase (migration 068), never here.

const SECTION_TITLES: Record<DigitalCardSection, string> = { homepage: 'Homepage', blog: 'Blog', news: 'News (module)', events: 'Events', live: 'Live' }

const KIND_TITLES: Record<DigitalCardKind, string> = { site: 'Site card (/link)', person: 'Person card (/link/<name>)' }

const LINK_KIND_TITLES: Record<DigitalCardLinkKind, string> = {
  url: 'Web address',
  page: 'Page of this website',
  form: 'Contact form (the page that has it)',
  booking: 'Booking (the page that has it)',
  whatsapp: 'WhatsApp',
  phone: 'Phone call',
  email: 'E-mail',
  file: 'File (Media Library)',
}

const API = { apiVersion: '2026-05-21' } as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = any

/** The project's cards (every copy) — for uniqueness checks. Fails open (null) when Studio cannot query. */
async function projectCards(context: Ctx): Promise<Array<{ _id: string; kind?: string; urlName?: unknown; retiredUrlNames?: unknown }> | null> {
  const projectSlug = context?.document?.projectSlug
  if (typeof projectSlug !== 'string' || !projectSlug || typeof context?.getClient !== 'function') return null
  const rows: unknown = await context
    .getClient(API)
    .fetch(`*[_type == "${DIGITAL_CARD_TYPE}" && projectSlug == $projectSlug]{ _id, kind, urlName, retiredUrlNames }`, { projectSlug }, { perspective: 'raw' })
  return Array.isArray(rows) ? (rows as Array<{ _id: string }>) : null
}

/** D5 — unique per project across the current AND retired names of every other card. */
export async function validateUrlName(value: unknown, context: Ctx): Promise<true | string> {
  const doc = context?.document as { _id?: string; kind?: string } | undefined
  if (doc?.kind !== 'person') return true
  if (typeof value !== 'string' || !value) return 'A person card needs a URL name.'
  if (value.length > DIGITAL_CARD_URL_NAME_MAX) return `At most ${DIGITAL_CARD_URL_NAME_MAX} characters.`
  if (!DIGITAL_CARD_URL_NAME_PATTERN.test(value)) return 'Only lowercase letters, numbers and single hyphens (e.g. sofia-rossi).'
  const cards = await projectCards(context)
  if (!cards) return true
  return takenUrlNames(cards, doc?._id).has(value) ? 'Another card of this website uses (or used) this URL name.' : true
}

/** D2 — at most one site card per project. */
async function validateKind(value: unknown, context: Ctx): Promise<true | string> {
  if (value !== 'site') return true
  const cards = await projectCards(context)
  if (!cards) return true
  const self = context?.document?._id ? baseDocumentId(context.document._id) : null
  const others = new Set(cards.filter((c) => c.kind === 'site' && baseDocumentId(c._id) !== self).map((c) => baseDocumentId(c._id)))
  return others.size === 0 ? true : 'This website already has a site card.'
}

/** Per-language length check of a localized text (the same count the dashboard and the server use). */
const maxPerLanguage = (max: number) => (value: unknown) => {
  if (!value || typeof value !== 'object') return true
  for (const [loc, v] of Object.entries(value as Record<string, unknown>)) {
    if (loc.startsWith('_') || typeof v !== 'string') continue
    if (cardTextLength(v) > max) return `${loc.toUpperCase()}: at most ${max} characters.`
  }
  return true
}

const isSite = ({ document }: { document?: Record<string, unknown> }) => document?.kind === 'site'
const isPerson = ({ document }: { document?: Record<string, unknown> }) => document?.kind === 'person'

// ── Link ──────────────────────────────────────────────────────────────────────

const digitalCardLinkType = defineType({
  name: DIGITAL_CARD_LINK_TYPE,
  title: 'Link',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      title: 'Type',
      type: 'string',
      initialValue: 'url',
      options: { list: DIGITAL_CARD_LINK_KINDS.map((value) => ({ title: LINK_KIND_TITLES[value], value })) },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'label',
      title: 'Label',
      type: 'localizedString',
      description: 'Left empty, the website shows a standard label for the type ("Call", "WhatsApp" …) in the visitor’s language.',
    }),
    defineField({
      name: 'description',
      title: 'One-line description',
      type: 'localizedString',
      description: `Optional short line under the label (e.g. "Timetable and prices"). Up to ${DIGITAL_CARD_LIMITS.linkDescription} characters.`,
      validation: (Rule) => Rule.custom(maxPerLanguage(DIGITAL_CARD_LIMITS.linkDescription)),
    }),
    defineField({
      name: 'url',
      title: 'Web address',
      type: 'url',
      hidden: ({ parent }) => DIGITAL_CARD_LINK_TARGET[(parent?.kind ?? 'url') as DigitalCardLinkKind] !== 'url',
      validation: (Rule) =>
        Rule.uri({ scheme: ['http', 'https'] }).custom((value, context) => {
          const kind = (context.parent as { kind?: DigitalCardLinkKind } | undefined)?.kind
          return kind && DIGITAL_CARD_LINK_TARGET[kind] === 'url' && !value ? 'Enter the web address.' : true
        }),
    }),
    // Amendment B (2026-11-10) — a `page` link reaches what navigationLink.pageRef
    // reaches: a page, the catalogue landing page, a catalogue collection or item.
    // `form` / `booking` links point at a `page` only (enforced by the dashboard
    // service). Existing references (all to `page`) are unchanged.
    defineField({
      name: 'page',
      title: 'Page',
      type: 'reference',
      to: DIGITAL_CARD_PAGE_REF_TYPES.map((type) => ({ type })),
      weak: true,
      options: { filter: scopedRef, disableNew: true },
      description: 'A page of this website — or (page links only) the catalogue page, a catalogue collection or a catalogue item.',
      hidden: ({ parent }) =>
        DIGITAL_CARD_LINK_TARGET[(parent?.kind ?? 'url') as DigitalCardLinkKind] !== 'page' || (parent?.kind === 'page' && Boolean(parent?.internalPage || parent?.moduleId)),
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const parent = context.parent as { kind?: DigitalCardLinkKind; internalPage?: string; moduleId?: string } | undefined
          const kind = parent?.kind
          if (!kind || DIGITAL_CARD_LINK_TARGET[kind] !== 'page' || value) return true
          return kind === 'page' && (parent?.internalPage || parent?.moduleId) ? true : 'Choose the page.'
        }),
    }),
    // Amendment B — a built-in section (navigationLink.internalPage), page links only.
    defineField({
      name: 'internalPage',
      title: 'Special section',
      type: 'string',
      options: { list: DIGITAL_CARD_SECTIONS.map((value) => ({ title: SECTION_TITLES[value], value })) },
      hidden: ({ parent }) => parent?.kind !== 'page' || Boolean(parent?.page),
      description: 'Instead of a page: a built-in section of the website. Not shown on the card while its module is off.',
    }),
    // Amendment B — an installed module's public page (navigationLink linkType "module"), page links only.
    defineField({
      name: 'moduleId',
      title: 'Module page',
      type: 'string',
      options: { list: DIGITAL_CARD_MODULE_TARGETS.map((value) => ({ title: value === 'catalogue' ? 'Catalogue' : value, value })) },
      hidden: ({ parent }) => parent?.kind !== 'page' || Boolean(parent?.page || parent?.internalPage),
      description: 'Instead of a page: the public page of a module. Not shown on the card while the module is off.',
    }),
    defineField({
      name: 'file',
      title: 'File',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      options: { filter: scopedRef },
      hidden: ({ parent }) => parent?.kind !== 'file',
      validation: (Rule) =>
        Rule.custom((value, context) => ((context.parent as { kind?: string } | undefined)?.kind === 'file' && !value ? 'Choose the file.' : true)),
    }),
    defineField({
      name: 'logo',
      title: 'Logo',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      options: { filter: scopedRef },
      description: 'Optional small logo shown on the button, on a neutral tile (24 px high, up to 48 px wide, never cropped). Best: SVG or a PNG with a transparent background, at least 96 px high.',
    }),
    defineField({
      name: 'value',
      title: 'Number or address',
      type: 'string',
      description: 'Phone / WhatsApp number in international format (+39 …), or the e-mail address.',
      hidden: ({ parent }) => DIGITAL_CARD_LINK_TARGET[(parent?.kind ?? 'url') as DigitalCardLinkKind] !== 'value',
      validation: (Rule) =>
        Rule.max(DIGITAL_CARD_LIMITS.value).custom((value, context) => {
          const kind = (context.parent as { kind?: DigitalCardLinkKind } | undefined)?.kind
          if (!kind || DIGITAL_CARD_LINK_TARGET[kind] !== 'value') return true
          const v = typeof value === 'string' ? value.trim() : ''
          if (!v) return kind === 'email' ? 'Enter the e-mail address.' : 'Enter the number.'
          if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? true : 'This is not an e-mail address.'
          return /^\+?[0-9 ()./-]{6,}$/.test(v) ? true : 'Enter the number in international format, e.g. +39 335 1234567.'
        }),
    }),
    defineField({ name: 'hidden', title: 'Hidden', type: 'boolean', initialValue: false, description: 'Kept on the card but not shown.' }),
    defineField({ name: 'primary', title: 'Primary Action', type: 'boolean', initialValue: false, description: 'Shown first and larger. One per card.' }),
  ],
  preview: {
    select: { kind: 'kind', label: 'label.en', labelIt: 'label.it', url: 'url', value: 'value', page: 'page.title', pageEn: 'page.title.en', pageName: 'page.name.en', pageHero: 'page.heroTitle.en', internalPage: 'internalPage', moduleId: 'moduleId', hidden: 'hidden', primary: 'primary' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ kind, label, labelIt, url, value, page, pageEn, pageName, pageHero, internalPage, moduleId, hidden, primary }: Record<string, any>) => ({
      title: label || labelIt || LINK_KIND_TITLES[kind as DigitalCardLinkKind] || 'Link',
      subtitle: [
        LINK_KIND_TITLES[kind as DigitalCardLinkKind],
        url || value || (typeof page === 'string' ? page : undefined) || pageEn || pageName || pageHero || (internalPage ? SECTION_TITLES[internalPage as DigitalCardSection] ?? internalPage : undefined) || moduleId,
        primary ? 'Primary Action' : undefined,
        hidden ? 'Hidden' : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    }),
  },
})

// ── Card ──────────────────────────────────────────────────────────────────────

const showField = defineField({
  name: 'show',
  title: 'What’s shown',
  type: 'object',
  group: 'content',
  description: 'Switches only — the data itself comes from Website Settings and People.',
  options: { collapsible: true, collapsed: false },
  fields: [
    defineField({ name: 'name', title: 'Name', type: 'boolean' }),
    defineField({ name: 'description', title: 'Description', type: 'boolean' }),
    defineField({ name: 'phone', title: 'Phone', type: 'boolean' }),
    defineField({ name: 'email', title: 'E-mail', type: 'boolean' }),
    defineField({ name: 'whatsapp', title: 'WhatsApp', type: 'boolean' }),
    defineField({ name: 'saveContact', title: 'Save contact', type: 'boolean' }),
    defineField({
      name: 'hiddenSocials',
      title: 'Hidden social profiles',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description:
        'Every social profile is shown unless it is listed here (ADR-049 Amendment A), so a profile added later appears on its own. Site card: platforms of Website Settings → Social links. Person card: keys of the person’s public contacts (Instagram, LinkedIn, website).',
    }),
    // Before Amendment A (2026-11-09) the card stored the SHOWN profiles. Kept so
    // stored data stays valid; no longer read (every profile not hidden is shown).
    defineField({
      name: 'socials',
      title: 'Social profiles (old list, no longer used)',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      readOnly: true,
      hidden: true,
    }),
    // Site card
    defineField({ name: 'logo', title: 'Logo', type: 'boolean', hidden: ({ document }) => !isSite({ document }) }),
    defineField({ name: 'businessName', title: 'Business name', type: 'boolean' }),
    defineField({
      name: 'locations',
      title: 'Locations',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Keys of Website Settings → Locations. The first one is the address of Save contact.',
      hidden: ({ document }) => !isSite({ document }),
    }),
    // Person card
    defineField({ name: 'photo', title: 'Photo', type: 'boolean', hidden: ({ document }) => !isPerson({ document }) }),
    defineField({ name: 'role', title: 'Role', type: 'boolean', hidden: ({ document }) => !isPerson({ document }) }),
    defineField({
      name: 'nameMode',
      title: 'Name as',
      type: 'string',
      options: { list: DIGITAL_CARD_NAME_MODES.map((value) => ({ title: value === 'full' ? 'Full name' : 'First name only', value })), layout: 'radio' },
      hidden: ({ document }) => !isPerson({ document }),
    }),
    defineField({ name: 'profileLink', title: '“More about …” link', type: 'boolean', hidden: ({ document }) => !isPerson({ document }) }),
  ],
})

const digitalCardType = defineType({
  name: DIGITAL_CARD_TYPE,
  title: 'Digital Card',
  type: 'document',
  groups: [
    { name: 'content', title: 'Card', default: true },
    { name: 'details', title: 'Details' },
    PUBLISHING_GROUP,
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'publicId',
      title: 'Public ID',
      type: 'string',
      readOnly: true,
      group: 'details',
      description: 'Permanent id the visit statistics are kept under. Set automatically; never changes.',
      validation: (Rule) => Rule.custom((value, context) => validateUniquePublicId(value, context)),
    }),
    defineField({
      name: 'kind',
      title: 'Kind',
      type: 'string',
      group: 'content',
      options: { list: DIGITAL_CARD_KINDS.map((value) => ({ title: KIND_TITLES[value], value })), layout: 'radio' },
      validation: (Rule) => Rule.required().custom((value, context) => validateKind(value, context)),
    }),
    defineField({
      name: 'person',
      title: 'Person',
      type: 'reference',
      to: [{ type: 'person' }],
      // Weak: deleting a person (People) must not be blocked by a card; the card then goes offline (D6).
      weak: true,
      group: 'content',
      options: { filter: scopedRef },
      hidden: ({ document }) => !isPerson({ document }),
      description: 'Photo, name, role and public contacts are read from People — never copied here.',
      validation: (Rule) => Rule.custom((value, context) => ((context.document as { kind?: string } | undefined)?.kind === 'person' && !value ? 'Choose the person.' : true)),
    }),
    defineField({
      name: 'urlName',
      title: 'URL name',
      type: 'string',
      group: 'content',
      hidden: ({ document }) => !isPerson({ document }),
      description: 'The card’s address: /link/<URL name>. Lowercase letters, numbers and hyphens. Renaming keeps the old address working.',
      validation: (Rule) => Rule.custom((value, context) => validateUrlName(value, context)),
    }),
    defineField({
      name: 'retiredUrlNames',
      title: 'Earlier URL names',
      type: 'array',
      group: 'details',
      of: [defineArrayMember({ type: 'string' })],
      readOnly: true,
      hidden: ({ value }) => !Array.isArray(value) || value.length === 0,
      description: 'Old addresses that redirect to the current one. Never given to another card.',
    }),
    defineField({
      name: 'description',
      title: 'Short description',
      type: 'localizedText',
      group: 'content',
      description: `Optional short text under the name (up to ${DIGITAL_CARD_LIMITS.description} characters per language). A person card left empty shows the person’s short bio.`,
      validation: (Rule) => Rule.custom(maxPerLanguage(DIGITAL_CARD_LIMITS.description)),
    }),
    defineField({
      name: 'links',
      title: 'Links',
      type: 'array',
      group: 'content',
      of: [defineArrayMember({ type: DIGITAL_CARD_LINK_TYPE })],
      validation: (Rule) =>
        Rule.max(DIGITAL_CARD_LIMITS.links).custom((value) =>
          primaryLinkCount(value as Array<{ primary?: unknown; hidden?: unknown }> | undefined) > 1 ? 'Only one shown link can be the Primary Action.' : true,
        ),
    }),
    defineField({
      name: 'background',
      title: 'Background image',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      group: 'content',
      options: { filter: scopedRef },
      description: 'A Media Library image; its focal point is honoured. A person card left empty uses the site card’s.',
    }),
    showField,
    // ── Publishing — Publish / Unpublish / Archive like all content (D6) ──────
    publishingStatusField('optional'),
    {
      ...unpublishOnField('Set when the card is unpublished from the dashboard. Remove it to bring the card back.'),
      readOnly: true,
    },
    ...archivedFields(),
  ],
  orderings: [{ name: 'updatedDesc', title: 'Last edited', by: [{ field: '_updatedAt', direction: 'desc' }] }],
  preview: {
    select: {
      kind: 'kind',
      urlName: 'urlName',
      firstName: 'person.firstName',
      lastName: 'person.lastName',
      displayName: 'person.displayName',
      expiresAt: 'expiresAt',
      archivedAt: 'archivedAt',
      projectSlug: 'projectSlug',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prepare: ({ kind, urlName, firstName, lastName, displayName, expiresAt, archivedAt, projectSlug }: Record<string, any>) => {
      // A preview can only follow references: the site name lives in siteConfig
      // (not referenced), so the site card is titled by its project.
      const personName = (typeof displayName === 'string' && displayName.trim()) || [firstName, lastName].filter(Boolean).join(' ')
      const status = archivedAt ? 'Archived' : expiresAt ? 'Unpublished' : undefined
      return {
        title: kind === 'site' ? `Site card${projectSlug ? ` · ${projectSlug}` : ''}` : personName || 'Person card',
        subtitle: [
          kind === 'site' ? 'Site card' : kind === 'person' ? 'Person card' : 'Card',
          kind === 'site' ? '/link' : urlName ? `/link/${urlName}` : 'No URL name',
          status,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    },
  },
})

export const digitalCardsSchemaTypes = [digitalCardType, digitalCardLinkType]

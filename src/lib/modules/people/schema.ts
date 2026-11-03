import { defineType, defineField, defineArrayMember } from 'sanity'
import { projectSlugField } from '@/lib/sanity/fields/shared'
import { validateUniquePublicId } from '@/lib/sanity/fields/public-id'
import { bodyLinkAnnotation } from '@/lib/sanity/fields/body-link'
import { LocalizedPortableTextInput } from '@/lib/sanity/fields/LocalizedInput'
import { PUBLISHING_GROUP, archivedFields } from '@/lib/sanity/fields/publishing'
import { PLATFORM_LOCALES, LOCALE_CODES } from '@/lib/i18n/locales'
import { PERSON_CONTACT_KINDS, PERSON_VISIBILITIES } from './model'

// ── People module — Sanity schema types (ADR-043) ─────────────────────────────
//
// Owned by: people module (MODULE_REGISTRY id: 'people')
//   person              — collection document: one person of one website (D2)
//   personContact       — object: one PUBLIC contact method (private ones live
//                         in Supabase person_private, never here — D2)
//   personQualification — object: one qualification, as text (no documents, V1)
//   personBioText       — localized, RESTRICTED rich text for the long bio
//                         (the same restrictions as faqAnswerText, ADR-037 D12)
//
// Clients edit people in the dashboard only; Studio shows them READ-ONLY
// (ADR-043 D8). Placements reference people with peopleRefsField() (fields.ts)
// and the website reads them only through PERSON_PUBLIC_FIELDS (projection.ts).
//
// Everything here is new: no existing field changes type.

/** The hidden per-locale translation status every localized type carries (ADR-023 §4). */
const translationStatusField = defineField({
  name: 'translationStatus',
  title: 'Translation status',
  type: 'translationStatus',
  hidden: true,
})

// ── Long bio (restricted rich text) ───────────────────────────────────────────
// Paragraphs, bold, italic, bullet and numbered lists, internal and external
// links — nothing else. The ONLY annotation is the shared body link.
const personBioBlock = defineArrayMember({
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

const personBioTextType = defineType({
  name: 'personBioText',
  title: 'Biography',
  type: 'object',
  components: { input: LocalizedPortableTextInput },
  fields: [
    ...LOCALE_CODES.map((code) =>
      defineField({
        name: code,
        title: PLATFORM_LOCALES[code].nativeName,
        type: 'array',
        of: [personBioBlock],
      })
    ),
    translationStatusField,
  ],
})

// ── Public contact method ─────────────────────────────────────────────────────

const personContactType = defineType({
  name: 'personContact',
  title: 'Contact',
  type: 'object',
  fields: [
    defineField({
      name: 'kind',
      title: 'Type',
      type: 'string',
      options: { list: PERSON_CONTACT_KINDS.map((k) => ({ title: k, value: k })) },
      validation: (Rule) => Rule.required(),
    }),
    defineField({ name: 'value', title: 'Value', type: 'string', validation: (Rule) => Rule.required() }),
    defineField({ name: 'label', title: 'Label', type: 'string', description: 'Optional, e.g. "Studio".' }),
    defineField({ name: 'preferred', title: 'Preferred', type: 'boolean', initialValue: false }),
  ],
  preview: {
    select: { kind: 'kind', value: 'value', label: 'label' },
    prepare: ({ kind, value, label }: { kind?: string; value?: string; label?: string }) => ({
      title: value ?? 'Contact',
      subtitle: [kind, label].filter(Boolean).join(' · '),
    }),
  },
})

// ── Qualification (text only in V1) ───────────────────────────────────────────

const personQualificationType = defineType({
  name: 'personQualification',
  title: 'Qualification',
  type: 'object',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'localizedString' }),
    defineField({ name: 'issuer', title: 'Issued by', type: 'string' }),
    defineField({ name: 'issuedOn', title: 'Issued on', type: 'date' }),
    defineField({ name: 'expiresOn', title: 'Expires on', type: 'date' }),
  ],
  preview: {
    select: { en: 'title.en', it: 'title.it', de: 'title.de', issuer: 'issuer' },
    prepare: ({ en, it, de, issuer }: { en?: string; it?: string; de?: string; issuer?: string }) => ({
      title: en ?? it ?? de ?? 'Qualification',
      subtitle: issuer,
    }),
  },
})

// ── Person ────────────────────────────────────────────────────────────────────

const personType = defineType({
  name: 'person',
  title: 'Person',
  type: 'document',
  // ADR-043 D8 — edited in the client dashboard only. Studio shows people for
  // reference; every write goes through src/lib/api/persons.ts.
  readOnly: true,
  groups: [
    { name: 'profile', title: 'Profile', default: true },
    { name: 'about', title: 'About' },
    { name: 'contact', title: 'Contact' },
    { name: 'website', title: 'On the website' },
    PUBLISHING_GROUP,
  ],
  fields: [
    projectSlugField,
    defineField({
      name: 'publicId',
      title: 'Public ID',
      type: 'string',
      readOnly: true,
      group: 'website',
      description: 'Permanent id used by event schedules and connected apps. Set automatically; never changes.',
      validation: (Rule) => Rule.custom((value, context) => validateUniquePublicId(value, context)),
    }),
    // ── Profile ──────────────────────────────────────────────────────────────
    defineField({ name: 'firstName', title: 'First name', type: 'string', group: 'profile', validation: (Rule) => Rule.required() }),
    // Optional (ADR-043 A4): some people go by one name ("Emmanuelle").
    defineField({ name: 'lastName', title: 'Last name', type: 'string', group: 'profile' }),
    defineField({
      name: 'displayName',
      title: 'Display name',
      type: 'string',
      group: 'profile',
      description: 'Optional. Shown instead of "First Last" (e.g. a stage name).',
    }),
    defineField({ name: 'honorific', title: 'Honorific', type: 'localizedString', group: 'profile', description: 'Shown before the name, e.g. "Dott." / "Dr.".' }),
    defineField({ name: 'jobTitle', title: 'Professional title', type: 'localizedString', group: 'profile', description: 'The wording shown on cards, e.g. "Dentist", "Yoga teacher".' }),
    defineField({
      name: 'groups',
      title: 'Groups',
      type: 'array',
      group: 'profile',
      of: [defineArrayMember({ type: 'string' })],
      description: 'Stable keys of the People groups (Categories & Tags). Renaming a group never changes these.',
    }),
    defineField({
      name: 'photo',
      title: 'Photo',
      type: 'reference',
      to: [{ type: 'mediaAsset' }],
      group: 'profile',
      description: 'A Media Library image. Its focal point is set there, once.',
    }),
    // ── About ────────────────────────────────────────────────────────────────
    defineField({ name: 'shortBio', title: 'Short bio', type: 'localizedText', group: 'about' }),
    defineField({ name: 'bio', title: 'Biography', type: 'personBioText', group: 'about' }),
    defineField({
      name: 'languages',
      title: 'Languages spoken',
      type: 'array',
      group: 'about',
      of: [defineArrayMember({ type: 'string' })],
      description: 'ISO 639-1 codes, e.g. "it", "en".',
    }),
    defineField({
      name: 'qualifications',
      title: 'Qualifications',
      type: 'array',
      group: 'about',
      of: [defineArrayMember({ type: 'personQualification' })],
    }),
    // ── Contact (public only) ────────────────────────────────────────────────
    defineField({ name: 'website', title: 'Website', type: 'url', group: 'contact', validation: (Rule) => Rule.uri({ scheme: ['http', 'https'] }) }),
    defineField({
      name: 'contacts',
      title: 'Public contact methods',
      type: 'array',
      group: 'contact',
      of: [defineArrayMember({ type: 'personContact' })],
      description: 'Only PUBLIC contact methods are stored here. Private ones are kept outside the website content.',
    }),
    // ── On the website ───────────────────────────────────────────────────────
    defineField({
      name: 'visibility',
      title: 'On the website',
      type: 'string',
      group: 'website',
      initialValue: 'listed',
      options: {
        list: PERSON_VISIBILITIES.map((v) => ({
          title: v === 'off' ? 'Off' : v === 'listed' ? 'Listed' : 'Listed + own page',
          value: v,
        })),
        layout: 'radio',
      },
    }),
    defineField({ name: 'slug', title: 'Slug', type: 'localizedSlug', group: 'website', description: 'Used only when the person has their own page.' }),
    defineField({ name: 'redirectFrom', title: 'Redirect From', type: 'redirectFrom', group: 'website' }),
    defineField({ name: 'sortOrder', title: 'Order', type: 'number', group: 'website', description: 'The site-wide order of people (drag in the dashboard).' }),
    defineField({
      name: 'legacyAnchors',
      title: 'Old anchors',
      type: 'array',
      group: 'website',
      of: [defineArrayMember({ type: 'string' })],
      hidden: true,
      description: 'anchorIds of migrated team members (e.g. florian-parra), so old /teachers#… links keep working.',
    }),
    defineField({ name: 'anonymisedAt', title: 'Anonymised', type: 'datetime', group: PUBLISHING_GROUP.name, readOnly: true, hidden: true }),
    // ADR-032 D1 / ADR-043 D4 — archive only, no publication window. Archived
    // people still show on content that already references them; they leave
    // team listings and lose their own page.
    ...archivedFields().map((f) =>
      f.name === 'archivedAt'
        ? { ...f, description: 'Archived from the dashboard. Still shown where content already names this person; not in team lists, no own page.' }
        : f
    ),
  ],
  orderings: [{ name: 'sortOrder', title: 'Order', by: [{ field: 'sortOrder', direction: 'asc' }, { field: 'lastName', direction: 'asc' }] }],
  preview: {
    select: { first: 'firstName', last: 'lastName', display: 'displayName', title: 'jobTitle.en', titleIt: 'jobTitle.it', anonymisedAt: 'anonymisedAt', archivedAt: 'archivedAt' },
    prepare: ({ first, last, display, title, titleIt, anonymisedAt, archivedAt }: Record<string, string | undefined>) => ({
      title: anonymisedAt ? 'Anonymised person' : display || [first, last].filter(Boolean).join(' ') || 'Unnamed person',
      subtitle: [title ?? titleIt, archivedAt ? 'Archived' : undefined].filter(Boolean).join(' · '),
    }),
  },
})

export const peopleSchemaTypes = [personBioTextType, personContactType, personQualificationType, personType]

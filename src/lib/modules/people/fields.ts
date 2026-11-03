import { defineArrayMember, defineField } from 'sanity'
import { scopedRef } from '@/lib/sanity/fields/shared'

// ── People placements — the shared field helper (ADR-043 D5) ─────────────────
//
// Every placement that shows people (a team section, a blog post's authors, an
// event's hosts, later courses) stores ONE ordered array of references to
// `person` documents. One helper, so a module that wants people adds a field —
// never a second way to attach them (pattern of faqSetsField(), ADR-037).
//
// - References, never copies. Only this project's people are listed.
// - The same person cannot be attached twice to one placement.
// - WEAK references: a placement may point at a person who is still a draft
//   (the dashboard's "Add new person" sheet), and a removed person never makes
//   a published post or page invalid. Rendering follows the visibility rules
//   (ADR-043 D4) through PERSON_PUBLIC_FIELDS, never the reference strength.
// - One choice for all languages: the person carries the translations.

export interface PeopleRefsFieldOptions {
  name: string
  title: string
  description?: string
  group?: string
  /** Optional upper bound (e.g. a post's authors). */
  max?: number
}

export function peopleRefsField(opts: PeopleRefsFieldOptions) {
  return defineField({
    name: opts.name,
    title: opts.title,
    type: 'array',
    ...(opts.group ? { group: opts.group } : {}),
    of: [defineArrayMember({ type: 'reference', to: [{ type: 'person' }], weak: true, options: { filter: scopedRef } })],
    description: opts.description ?? 'Optional. People from this website’s People list, in the order to show them.',
    validation: (Rule) => (opts.max ? Rule.unique().max(opts.max) : Rule.unique()),
  })
}

import { defineArrayMember, defineField } from 'sanity'
import { scopedRef } from '@/lib/sanity/fields/shared'

// ── FAQ placements — the shared field helper (ADR-037 D5) ─────────────────────
//
// Every placement (the FAQ section, a blog post, later an event) stores ONE
// ordered array of references to FAQ sets: `faqSets`. One helper, so a module
// that wants FAQs adds a field — never a second way to attach them.
//
// - References, never copies (D3). Only this project's sets are listed.
// - The same set cannot be attached twice to one placement.
// - One choice for all languages: the sets carry the translations.

export interface FaqSetsFieldOptions {
  description?: string
  group?: string
  /** A soft warning (never blocks publishing) when no set and no legacy inline list is present. */
  warnWhenEmpty?: boolean
}

export function faqSetsField(opts: FaqSetsFieldOptions = {}) {
  return defineField({
    name: 'faqSets',
    title: 'FAQ Sets',
    type: 'array',
    ...(opts.group ? { group: opts.group } : {}),
    of: [defineArrayMember({ type: 'reference', to: [{ type: 'faqSet' }], options: { filter: scopedRef } })],
    description: opts.description ?? 'Optional. One or more FAQ sets, in the order to show them. Only this website’s sets are listed.',
    validation: (Rule) => {
      const unique = Rule.unique()
      if (!opts.warnWhenEmpty) return unique
      return [
        unique,
        Rule.custom((value, context) => {
          const hasSets = Array.isArray(value) && value.length > 0
          const legacy = (context.parent as { items?: unknown[] } | undefined)?.items
          return hasSets || (Array.isArray(legacy) && legacy.length > 0) ? true : 'Choose at least one FAQ set.'
        }).warning(),
      ]
    },
  })
}

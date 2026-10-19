import { defineArrayMember, defineField } from 'sanity'
import { BODY_LINK_TARGET_TYPES } from '@/lib/links/target-types'

// Body link (ADR-025 · links round 2; ADR-037 D12). Replaces Sanity's default
// link annotation with the same `href` plus:
//   - `internal`: a reference to a page / post / news item / event / catalogue
//     item or collection of the SAME project (filtered by the document's
//     projectSlug) — resolved to a URL in the page's language by the website,
//     plain text if the target is gone, not public or untranslated;
//   - `blank`: optional new-tab OVERRIDE. Empty = automatic (external sites in
//     a new tab, the site's own pages in the same tab) — src/lib/links/link-target.ts.
// Weak reference: deleting or unpublishing a page never fails because a post
// or an FAQ answer links to it; the website just stops linking.
//
// Moved out of schema.ts (ADR-037) so the FAQ module's restricted answer text
// shares the ONE link annotation instead of growing a second link system.
export const bodyLinkAnnotation = defineArrayMember({
  name: 'link',
  type: 'object',
  title: 'Link',
  fields: [
    defineField({
      name: 'href',
      title: 'URL',
      type: 'url',
      description: 'An external address, mailto:, tel: or a site path starting with "/". Leave empty when linking to a page below.',
      validation: (Rule) => Rule.uri({ scheme: ['http', 'https', 'mailto', 'tel'], allowRelative: true }),
    }),
    defineField({
      name: 'internal',
      title: 'Page on this site',
      type: 'reference',
      weak: true,
      to: BODY_LINK_TARGET_TYPES.map((type) => ({ type })),
      options: {
        filter: ({ document }: { document: Record<string, unknown> }) => {
          const projectSlug = typeof document?.projectSlug === 'string' ? document.projectSlug : undefined
          if (!projectSlug) return { filter: '_id == "@@no-project-selected@@"' }
          return { filter: 'projectSlug == $projectSlug', params: { projectSlug } }
        },
      },
    }),
    defineField({
      name: 'blank',
      title: 'Open in a new tab',
      type: 'boolean',
      description: 'Leave unset for automatic: other websites open in a new tab, pages of this site in the same tab.',
    }),
  ],
  validation: (Rule) =>
    Rule.custom((value?: { href?: string; internal?: unknown }) =>
      value?.href && value?.internal ? 'Use either a URL or a page on this site, not both.' : true
    ),
})

import { defineArrayMember, defineField, defineType } from 'sanity'
import { projectSlugField } from '@/lib/sanity/fields/shared'
import { INTERNAL_TAG_LIMITS, INTERNAL_TAG_LIST_MAX, INTERNAL_TAG_LIST_TYPE, INTERNAL_TAG_SCOPES } from './internal-tags'

// ── internalTagList — the added-but-unused internal tags of one project ───────
// One document per project and scope (media | galleries), id
// `internalTagList.<projectSlug>.<scope>` (internalTagListId). Written ONLY by
// the dashboard's tag service (Categories & Tags → Add a tag; rename / merge /
// delete keep it in step) — read-only in the Studio, absent from its
// navigation and its "create" menu. Internal (ADR-022): never public, so no
// translations, order or colour; just names.

export const internalTagListType = defineType({
  name: INTERNAL_TAG_LIST_TYPE,
  title: 'Internal tag list',
  type: 'document',
  liveEdit: true,
  readOnly: true,
  fields: [
    projectSlugField,
    defineField({
      name: 'scope',
      title: 'List',
      type: 'string',
      options: { list: INTERNAL_TAG_SCOPES.map((s) => ({ title: s === 'media' ? 'Photos' : 'Galleries', value: s })) },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tags',
      title: 'Tags not used yet',
      type: 'array',
      of: [defineArrayMember({ type: 'string', validation: (Rule) => Rule.max(INTERNAL_TAG_LIMITS.length) })],
      validation: (Rule) => Rule.max(INTERNAL_TAG_LIST_MAX),
    }),
  ],
  preview: {
    select: { projectSlug: 'projectSlug', scope: 'scope', tags: 'tags' },
    prepare: ({ projectSlug, scope, tags }) => ({
      title: `${projectSlug ?? '?'} · ${scope ?? '?'} tags`,
      subtitle: Array.isArray(tags) ? `${tags.length} not used yet` : undefined,
    }),
  },
})

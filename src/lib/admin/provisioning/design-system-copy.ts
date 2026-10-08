/**
 * The new project's OWN design system (pure).
 *
 * Every new project gets a new `designSystem` document (role `active`,
 * `projectSlug` = the new slug) so it can be fine-tuned in Studio without
 * touching any other site. What it starts from depends on what was picked:
 *
 *   • a TEMPLATE  → an empty child: `parentDesignSystem` → the template. Every
 *     value is inherited (`resolveDesignSystemInheritance`), so a later
 *     template edit still reaches the new site until it overrides the field.
 *   • another project's ACTIVE system → a copy of that document's OWN fields
 *     (not the resolved/merged values) with the SAME parent. Same own fields +
 *     same parent = the same resolved design, and the template link is kept.
 *
 * Field-agnostic like Export/Import (CLAUDE.md "Export / Import"): only Sanity
 * metadata and the identity fields are dropped, so a design-system field added
 * later is copied with zero changes here.
 */

/** Sanity metadata — never copied (same set as `stripMetadata` in src/sanity/actions/designSystemUtils.ts). */
const METADATA_KEYS = ['_id', '_rev', '_createdAt', '_updatedAt', '_type'] as const
/** Identity of the source system — replaced by the new project's. */
const IDENTITY_KEYS = ['projectSlug', 'name', 'role', 'description', 'parentDesignSystem'] as const

export type DesignSystemSource = Record<string, unknown> & {
  _id: string
  role?: string | null
  name?: string | null
  parentDesignSystem?: { _ref?: string } | null
}

export type SanityReference = { _type: 'reference'; _ref: string }

export type NewDesignSystemDoc = Record<string, unknown> & {
  _id: string
  _type: 'designSystem'
  name: string
  role: 'active'
  projectSlug: string
  parentDesignSystem?: SanityReference
}

const published = (id: string) => id.replace(/^drafts\./, '')

export const isTemplate = (source: Pick<DesignSystemSource, 'role'>) => source.role === 'template'

export function buildProjectDesignSystem(
  source: DesignSystemSource,
  target: { docId: string; projectSlug: string; name: string }
): NewDesignSystemDoc {
  const identity = {
    _id: target.docId,
    _type: 'designSystem' as const,
    name: target.name,
    role: 'active' as const,
    projectSlug: target.projectSlug,
  }

  if (isTemplate(source)) {
    return { ...identity, parentDesignSystem: { _type: 'reference', _ref: published(source._id) } }
  }

  // Deep copy so the plan never shares nested objects with the source document.
  const own = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
  for (const k of [...METADATA_KEYS, ...IDENTITY_KEYS]) delete own[k]
  const parentRef = typeof source.parentDesignSystem?._ref === 'string' && source.parentDesignSystem._ref ? published(source.parentDesignSystem._ref) : null
  return {
    ...own,
    ...identity,
    ...(parentRef ? { parentDesignSystem: { _type: 'reference' as const, _ref: parentRef } } : {}),
  }
}

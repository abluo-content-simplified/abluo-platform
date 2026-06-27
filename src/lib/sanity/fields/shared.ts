import { defineField } from 'sanity'
import { ProjectSlugPicker } from '@/lib/sanity/fields/ProjectSlugPicker'

// ── Shared Sanity primitives ──────────────────────────────────────────────────
//
// Exported here so module schema files (src/lib/modules/*/schema.ts) can
// import scopedRef and projectSlugField without creating a circular dependency
// through src/lib/sanity/schema.ts.
//
// Dependency graph (no cycle):
//   sanity/schema.ts → sanity/fields/shared.ts
//   modules/*/schema.ts → sanity/fields/shared.ts
//   sanity/schema.ts → modules/schema.ts → modules/registry.ts → modules/*/schema.ts
//
// ADR-011 Phase D1 — extracted from schema.ts.

// ── Project-scoped reference filter ──────────────────────────────────────────
//
// Use as `options.filter` on any reference field whose target documents are
// tenant-specific (posts, events, authors, categories, pages, etc.).
//
// Behaviour:
//   • Document has a projectSlug → only shows documents from that project
//   • Document has no projectSlug → shows nothing (prevents cross-project picks)
//
// Works for both top-level document fields and references nested inside embedded
// objects, because Sanity's `document` callback always refers to the root document.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const scopedRef = ({ document }: { document: Record<string, unknown> }) => {
  const projectSlug = (document as any)?.projectSlug as string | undefined
  // No project selected yet → return a filter that matches no documents
  if (!projectSlug) return { filter: '_id == "@@no-project-selected@@"' }
  return {
    filter: 'projectSlug == $projectSlug',
    params: { projectSlug },
  }
}

// ── Project slug field ────────────────────────────────────────────────────────
//
// Standard projectSlug field for all project-scoped document types.
// Rendered with ProjectSlugPicker — read-only picker that shows the project
// the document belongs to.
export const projectSlugField = defineField({
  name: 'projectSlug',
  title: 'Project',
  type: 'string',
  validation: (Rule) => Rule.required(),
  components: {
    input: ProjectSlugPicker,
  },
})

import { defineField, defineArrayMember } from 'sanity'
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

// ── Shared page `sections[]` member list ─────────────────────────────────────
//
// ADR-016 Phase A — single source of truth for the `of:` list on every
// `sections` array field, platform-wide. `page` and `homePage` (both in
// sanity/schema.ts) and the three composable-page singletons (`livePage`,
// `eventsPage`, `blogPage` — one per module schema file) all reuse this exact
// list so a new section type added once here flows to every composable page
// automatically, with no risk of the arrays drifting apart.
//
// Exported here (not from sanity/schema.ts) for the same reason scopedRef and
// projectSlugField are: module schema files import it without creating a
// circular dependency through schema.ts. See the dependency-graph note above.
//
// Add a new platform or module section type to this one list — never inline
// a second copy of the `of:` array anywhere else.
export const PAGE_SECTIONS_OF = [
  defineArrayMember({ type: 'heroSection' }),
  defineArrayMember({ type: 'heroLiveCaptureSection' }),
  defineArrayMember({ type: 'heroLensSection' }),
  defineArrayMember({ type: 'contentSection' }),
  defineArrayMember({ type: 'statementSection' }),
  defineArrayMember({ type: 'treatmentsSection' }),
  defineArrayMember({ type: 'teamSection' }),
  defineArrayMember({ type: 'textSection' }),
  defineArrayMember({ type: 'videoSection' }),
  defineArrayMember({ type: 'faqSection' }),
  defineArrayMember({ type: 'contactSection' }),
  defineArrayMember({ type: 'blogListingSection' }),
  defineArrayMember({ type: 'formSection' }),
  defineArrayMember({ type: 'metricsSection' }),
  defineArrayMember({ type: 'photoGallerySection' }),
  defineArrayMember({ type: 'eventsListingSection' }),
  defineArrayMember({ type: 'liveLatestSection' }),
]

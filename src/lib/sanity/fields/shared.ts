import { defineField, defineArrayMember } from 'sanity'
import { ProjectSlugPicker } from '@/lib/sanity/fields/ProjectSlugPicker'
import { ICON_OPTIONS } from '@/components/icons/registry'

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

// ── Section anchor id ────────────────────────────────────────────────────────
//
// Optional, author-controlled DOM id for a section, so an in-page link
// (`navigationLink` with linkType `anchor`, or a CTA pointing at `#product`)
// has something to jump to. Every section type carries it alongside
// `background`; the section component forwards it to <SectionContainer id>.
//
// Keep it OPTIONAL and never validated as required: every document authored
// before this field existed must keep rendering exactly as it does today.
// Sections that already hardcode an id (e.g. TreatmentsSection's
// "trattamenti") keep that value as their fallback when nothing is authored.
export function anchorIdField(group?: string) {
  return defineField({
    name: 'anchorId',
    title: 'Anchor ID',
    type: 'string',
    ...(group ? { group } : {}),
    description:
      'Optional. Lets a nav or button link jump to this section — e.g. `product` → `#product`. Lowercase letters, digits, "-" and "_" only. Do not type the "#".',
    validation: (Rule) =>
      Rule.custom((value?: string) => {
        if (!value) return true
        return /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(value)
          ? true
          : 'Use a URL-safe slug: lowercase letters, digits, "-" and "_" only — no "#", no spaces (e.g. "how-it-works").'
      }),
  })
}

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
  defineArrayMember({ type: 'formOverlayButtonSection' }),
  defineArrayMember({ type: 'metricsSection' }),
  defineArrayMember({ type: 'photoGallerySection' }),
  defineArrayMember({ type: 'eventsListingSection' }),
  defineArrayMember({ type: 'liveLatestSection' }),
  defineArrayMember({ type: 'stepsSection' }),
  defineArrayMember({ type: 'featureGridSection' }),
  defineArrayMember({ type: 'mediaFeatureSection' }),
  defineArrayMember({ type: 'categoryListSection' }),
  defineArrayMember({ type: 'ctaBannerSection' }),
]

// ── Icon picker field ────────────────────────────────────────────────────────
//
// Reusable icon selector for any section/object that wants an optional icon.
// The option list is generated from the icon registry
// (src/components/icons/registry.tsx), so adding an icon there makes it
// selectable everywhere with no schema edit.
//
// Storage shape: a plain string key (e.g. "check", "arrow-right"). Unknown or
// stale keys render as nothing — <Icon> returns null rather than throwing —
// so a key may be removed from the registry without breaking stored content.
//
// Keep it OPTIONAL (never Rule.required()) so it stays a no-op for every
// existing document.
export const iconNameField = defineField({
  name: 'iconName',
  title: 'Icon',
  type: 'string',
  description: 'Optional. Inherits the surrounding text colour.',
  options: {
    list: ICON_OPTIONS,
    layout: 'dropdown',
  },
})

// ── Headline accent ──────────────────────────────────────────────────────────
//
// Opt-in per section: renders the LAST WORD of the section's headline/title in
// the brand accent colour (see src/lib/headline-accent.tsx for the renderer).
//
// Keep it OPTIONAL with initialValue 'none': every document authored before
// this field existed comes back null from GROQ, the renderer treats null and
// 'none' identically, and live tenants render byte-identically.
export function headlineAccentField(group?: string) {
  return defineField({
    name: 'headlineAccent',
    title: 'Headline Accent',
    type: 'string',
    ...(group ? { group } : {}),
    options: {
      list: [
        { title: 'None', value: 'none' },
        { title: 'Last word in accent colour', value: 'lastWord' },
      ],
      layout: 'radio',
    },
    initialValue: 'none',
    description:
      'Optional. "Last word" paints the final word of the headline in the brand accent colour — e.g. "…for Hospitality Platforms." Works in any language (the split is positional, not a word list) and on multi-line headlines, where it accents the last word of the last line.',
  })
}

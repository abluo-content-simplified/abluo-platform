import type { StructureBuilder } from 'sanity/structure'

// ── Collection items context ──────────────────────────────────────────────────
// Passed to each module's collectionItems function instead of relying on a
// closure over the Sanity structure callback parameter S.
//
// The context object API is preferred over positional parameters: additional
// values — project metadata, installation state, permissions, feature flags —
// can be added to CollectionItemsContext in future phases without changing the
// collectionItems function signature.
//
// ADR-011 Phase A1 — introduced with registry relocation.
export type CollectionItemsContext = {
  slug: string
  S: StructureBuilder
}

// ── Module definition ─────────────────────────────────────────────────────────
// Minimal shape for the current state. Expanded to full ModuleManifest in
// Phase A2 — do not add fields here; wait for the typed expansion.
//
// STUDIO LABEL vs PAGE TITLE (ADR-010):
// `label` is the canonical Studio label. It belongs to the Admin UI, not to
// website content. It is independent of any content stored in the document —
// changing the blog hero title must never change the Studio navigation label
// ("Blog"). Labels are defined here, not derived from document fields.
export type ModuleDef = {
  id: string
  label: string       // canonical Studio label — Admin UI concern, not website content
  pageType: string    // Sanity document type for the singleton page
  collectionItems: (ctx: CollectionItemsContext) => ReturnType<StructureBuilder['listItem']>[]
}

// ── Module registry ───────────────────────────────────────────────────────────
// The single definition of every module available on the platform.
//
// Each entry declares:
//   id              — machine identifier used in enabledModules
//   label           — canonical Studio label for the module's singleton page
//   pageType        — Sanity document type for the singleton page
//   collectionItems — collection sub-list items this module contributes
//
// Adding a new module: add one entry here. Nothing else in the structure
// builder needs to change.
//
// ADR-011: This registry will be expanded into full ModuleManifest entries
// (Phase A2) and protected by build-time validation (Phase A3).
export const MODULE_REGISTRY: ModuleDef[] = [
  {
    id: 'blog',
    label: 'Blog',
    pageType: 'blogPage',
    collectionItems: ({ slug, S }) => [
      S.listItem()
        .id(`${slug}-blog-module`)
        .title('Blog')
        .child(
          S.list()
            .id(`${slug}-blog-module-list`)
            .title('Blog')
            .items([
              S.listItem()
                .id(`${slug}-posts`)
                .title('Posts')
                .child(
                  S.documentList()
                    .title('Posts')
                    .schemaType('post')
                    .apiVersion('2026-05-21')
                    .filter(`_type == "post" && projectSlug == $slug`)
                    .params({ slug })
                    .defaultOrdering([
                      { field: 'featured', direction: 'desc' },
                      { field: 'publishedAt', direction: 'desc' },
                    ])
                    .initialValueTemplates([
                      S.initialValueTemplateItem('postProjectOwned', { projectSlug: slug }),
                    ])
                ),
              S.listItem()
                .id(`${slug}-categories`)
                .title('Categories')
                .child(
                  S.documentList()
                    .title('Categories')
                    .schemaType('blogCategory')
                    .apiVersion('2026-05-21')
                    .filter(`_type == "blogCategory" && projectSlug == $slug`)
                    .params({ slug })
                    .initialValueTemplates([
                      S.initialValueTemplateItem('blogCategoryProjectOwned', { projectSlug: slug }),
                    ])
                ),
              S.listItem()
                .id(`${slug}-authors`)
                .title('Authors')
                .child(
                  S.documentList()
                    .title('Authors')
                    .schemaType('postAuthor')
                    .apiVersion('2026-05-21')
                    .filter(`_type == "postAuthor" && projectSlug == $slug`)
                    .params({ slug })
                    .initialValueTemplates([
                      S.initialValueTemplateItem('postAuthorProjectOwned', { projectSlug: slug }),
                    ])
                ),
            ])
        ),
    ],
  },
  {
    id: 'events',
    label: 'Events',
    pageType: 'eventsPage',
    collectionItems: ({ slug, S }) => [
      S.listItem()
        .id(`${slug}-events-module`)
        .title('Events')
        .child(
          S.list()
            .id(`${slug}-events-module-list`)
            .title('Events')
            .items([
              S.listItem()
                .id(`${slug}-events`)
                .title('Events')
                .child(
                  S.documentList()
                    .title('Events')
                    .schemaType('event')
                    .apiVersion('2026-05-21')
                    .filter(`_type == "event" && projectSlug == $slug`)
                    .params({ slug })
                    .defaultOrdering([{ field: 'startDate', direction: 'desc' }])
                    .initialValueTemplates([
                      S.initialValueTemplateItem('eventProjectOwned', { projectSlug: slug }),
                    ])
                ),
            ])
        ),
    ],
  },
  {
    id: 'live',
    label: 'Live',
    pageType: 'livePage',
    collectionItems: () => [], // Live module has no collections
  },
]

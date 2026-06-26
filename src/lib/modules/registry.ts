import type { ModuleManifest, CollectionItemsContext } from './types'

// Re-export CollectionItemsContext for callers that previously imported it from
// this file. Remove after all import sites migrate to importing from ./types.
export type { CollectionItemsContext }

// ── Module registry ───────────────────────────────────────────────────────────
// The single authoritative definition of every module available on the platform.
//
// Each entry is a complete ModuleManifest declaring:
//   - Identity: id, label, version, status
//   - Platform contract: pageType, collectionItems, sectionTypes, schemaTypes,
//     permissions (declared here; consumed by derivation phases D1–D4)
//   - Public contract: empty stub (Phase A2)
//   - Dependencies: requires (hard), integratesWith (optional)
//   - Data store: primary storage tier
//   - Changelog: inline release notes
//
// Adding a module: add one entry here. Derivation phases pick up the new
// module automatically once they are wired (D1–D4).
//
// ADR-011 Phase A1 — registry relocated from sanity.config.ts inline closure.
// ADR-011 Phase A2 — entries migrated from minimal ModuleDef to full ModuleManifest.
export const MODULE_REGISTRY: ModuleManifest[] = [

  // ── Blog ───────────────────────────────────────────────────────────────────
  {
    id: 'blog',
    label: 'Blog',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      pageType: 'blogPage',

      collectionItems: ({ slug, S }: CollectionItemsContext) => [
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

      sectionTypes: ['blogListingSection'],

      schemaTypes: [
        'blogListingSection',
        'blogPage',
        'postAuthor',
        'blogCategory',
        'post',
      ],

      permissions: [
        {
          id: 'blog.post.write',
          label: 'Create and edit posts',
          description: 'Create, edit, and publish blog posts.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'blog.post.delete',
          label: 'Delete posts',
          description: 'Permanently delete blog posts.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'blog.taxonomy.write',
          label: 'Manage categories and authors',
          description: 'Create, edit, and delete blog categories and post authors.',
          defaultRoles: ['owner', 'editor'],
        },
      ],
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['events'], // blogListingSection filterMode: 'byEvent' references event type
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — Initial manifest. Blog module in production use.',
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  {
    id: 'events',
    label: 'Events',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      pageType: 'eventsPage',

      collectionItems: ({ slug, S }: CollectionItemsContext) => [
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

      sectionTypes: [],

      schemaTypes: [
        'eventsPage',
        'event',
      ],

      permissions: [
        {
          id: 'events.event.write',
          label: 'Create and edit events',
          description: 'Create, edit, and publish events.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'events.event.delete',
          label: 'Delete events',
          description: 'Permanently delete events.',
          defaultRoles: ['owner', 'editor'],
        },
      ],
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: [],
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — Initial manifest. Events module in production use.',
  },

  // ── Live ───────────────────────────────────────────────────────────────────
  {
    id: 'live',
    label: 'Live',
    version: '1.0.0',
    status: 'released',
    category: 'engagement',

    platformContract: {
      pageType: 'livePage',

      collectionItems: () => [], // Live module has no collections

      sectionTypes: ['heroLiveCaptureSection', 'heroLensSection'],

      schemaTypes: [
        'heroLiveCaptureSection',
        'heroLensSection',
        'livePage',
      ],

      permissions: [
        {
          id: 'live.page.configure',
          label: 'Configure live page',
          description: 'Configure the live page settings and featured events.',
          defaultRoles: ['owner', 'editor'],
        },
      ],
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['events'], // livePageQuery dereferences featuredEvents[]->
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — Initial manifest. Live module in production use.',
  },

]

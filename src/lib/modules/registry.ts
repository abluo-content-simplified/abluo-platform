import type { ModuleManifest } from './types'
import { validateRegistry } from './validate'
import { blogSchemaTypes } from './blog/schema'
import { eventsSchemaTypes } from './events/schema'
import { liveSchemaTypes } from './live/schema'

// ── Module registry ───────────────────────────────────────────────────────────
// The single authoritative definition of every module available on the platform.
//
// Each entry is a complete ModuleManifest declaring:
//   - Identity: id, label, version, status
//   - Platform contract: pageType, collections, sectionTypes, schemaTypes,
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
// ADR-011 Phase D3 — collectionItems() lambdas replaced with declarative collections arrays.
//   The registry is now fully declarative. No imperative Studio-building logic lives here.
//   buildCollectionItems() in navigation.ts converts declarations to Studio structure items.
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

      collections: [
        {
          id: 'blog-module',
          label: 'Blog',
          items: [
            {
              id: 'posts',
              label: 'Posts',
              schemaType: 'post',
              filter: `_type == "post" && projectSlug == $slug`,
              ordering: [
                { field: 'featured', direction: 'desc' as const },
                { field: 'publishedAt', direction: 'desc' as const },
              ],
              initialValueTemplate: 'postProjectOwned',
            },
            {
              id: 'categories',
              label: 'Categories',
              schemaType: 'blogCategory',
              filter: `_type == "blogCategory" && projectSlug == $slug`,
              initialValueTemplate: 'blogCategoryProjectOwned',
            },
            {
              id: 'authors',
              label: 'Authors',
              schemaType: 'postAuthor',
              filter: `_type == "postAuthor" && projectSlug == $slug`,
              initialValueTemplate: 'postAuthorProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: ['blogListingSection'],

      schemaTypes: [
        'blogListingSection',
        'blogPage',
        'postAuthor',
        'blogCategory',
        'post',
      ],

      schemaDefinitions: () => blogSchemaTypes,

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

      collections: [
        {
          id: 'events-module',
          label: 'Events',
          items: [
            {
              id: 'events',
              label: 'Events',
              schemaType: 'event',
              filter: `_type == "event" && projectSlug == $slug`,
              ordering: [
                { field: 'startDate', direction: 'desc' as const },
              ],
              initialValueTemplate: 'eventProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: [],

      schemaTypes: [
        'eventsPage',
        'event',
      ],

      schemaDefinitions: () => eventsSchemaTypes,

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

      collections: [], // Live module has no collections

      // heroLiveCaptureSection and heroLensSection are platform-distributed
      // section templates — globally available regardless of whether this module
      // is installed. Their schema definitions live in src/lib/sanity/schema.ts
      // and their SectionRenderer registration is a platform concern.
      // Installing or uninstalling the Live module must not affect their availability.
      // ADR-011 Phase D1 — design principle established.
      sectionTypes: [],

      schemaTypes: [
        'livePage',
      ],

      schemaDefinitions: () => liveSchemaTypes,

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

// ── Build-time validation ─────────────────────────────────────────────────────
// Runs at module load time. Throws with a human-readable diagnostic if any
// manifest violates the structural rules defined in validate.ts.
// A throw here propagates as a build error in Next.js and Sanity Studio.
validateRegistry(MODULE_REGISTRY)

import type { ModuleManifest } from './types'
import { validateRegistry } from './validate'
import { blogSchemaTypes } from './blog/schema'
import { eventsSchemaTypes } from './events/schema'
import { liveSchemaTypes } from './live/schema'
import { formsSchemaTypes } from './forms/schema'

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
          id: 'blog.post.read',
          label: 'View posts',
          description: 'View and list blog posts in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
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
            {
              id: 'categories',
              label: 'Categories',
              schemaType: 'eventCategory',
              filter: `_type == "eventCategory" && projectSlug == $slug`,
              initialValueTemplate: 'eventCategoryProjectOwned',
            },
          ],
        },
      ],

      // ADR-016 Phase B — eventsListingSection added.
      sectionTypes: ['eventsListingSection'],

      schemaTypes: [
        'eventsListingSection',
        'eventsPage',
        'eventCategory',
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
        {
          id: 'events.taxonomy.write',
          label: 'Manage categories',
          description: 'Create, edit, and delete event categories.',
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
      // liveLatestSection IS module-owned (ADR-016 Phase B) — unlike the two
      // platform-distributed hero templates above, it belongs to this manifest.
      sectionTypes: ['liveLatestSection'],

      schemaTypes: [
        'liveLatestSection',
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

  // ── Forms ──────────────────────────────────────────────────────────────────
  // ADR-018 slice 2 — additive + inert. Owns the tenant-owned `formDefinition`
  // document (the reusable definition). Submissions (operational tier) + the
  // form.submitted event contract shipped in slice 1; notification delivery in
  // ADR-019. No route resolves a formDefinition yet — slice 3 wires validation,
  // slice 4 the Form Section. `dataStore.primary: 'hybrid'` (definitions in
  // Sanity, submissions in Supabase). No collections/pageType/sectionTypes this
  // slice: definitions are tenant-owned (not projectSlug-scoped), so the Studio
  // management pane is admin-only and arrives in slice 7 — a project-scoped
  // collection pane would be the wrong shape here.
  {
    id: 'forms',
    label: 'Forms',
    version: '1.0.0',
    status: 'released',
    category: 'engagement',

    platformContract: {
      // no pageType — Forms has no singleton page.

      collections: [], // tenant-owned; admin management pane is slice 7.

      sectionTypes: [], // formSection is slice 4 (legacy platform formSection untouched).

      schemaTypes: ['formDefinition'],

      schemaDefinitions: () => formsSchemaTypes,

      permissions: [
        {
          id: 'forms.submission.read',
          label: 'View submissions',
          description: 'View and list form submissions in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'forms.submission.update',
          label: 'Update submissions',
          description: 'Change a submission status (new → processed → archived).',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'forms.submission.delete',
          label: 'Delete submissions',
          description: 'Permanently delete form submissions.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          // Admin-surface capabilities. Definitions are abluo_admin-only in V1,
          // so these are enforced by the platform admin gate (requireAbluoAdmin),
          // not a tenant role — hence no default tenant roles (ADR-018 Decision
          // 11; enforcement confirmed at slice 7).
          id: 'forms.definition.manage',
          label: 'Manage form definitions',
          description: 'Create, edit, and publish tenant-owned form definitions and platform templates.',
          defaultRoles: [],
        },
        {
          id: 'forms.definition.clone',
          label: 'Clone form definitions',
          description: 'Clone a template or another tenant’s definition into a tenant (admin-only cross-tenant clone).',
          defaultRoles: [],
        },
      ],
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: [],
    },

    dataStore: {
      primary: 'hybrid',
    },

    changelog: 'V1.0.0 — ADR-018 slice 2. Tenant-owned formDefinition type (additive, inert). Submissions + form.submitted shipped in slice 1; notifications in ADR-019.',
  },

]

// ── Build-time validation ─────────────────────────────────────────────────────
// Runs at module load time. Throws with a human-readable diagnostic if any
// manifest violates the structural rules defined in validate.ts.
// A throw here propagates as a build error in Next.js and Sanity Studio.
validateRegistry(MODULE_REGISTRY)

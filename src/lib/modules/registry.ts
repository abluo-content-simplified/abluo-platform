import type { ModuleManifest } from './types'
import { validateRegistry } from './validate'
import { blogSchemaTypes } from './blog/schema'
import { eventsSchemaTypes } from './events/schema'
import { liveSchemaTypes } from './live/schema'
import { formsSchemaTypes } from './forms/schema'
import { newsSchemaTypes } from './news/schema'

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

      // ADR-020 — Blog has no per-site configuration today: everything an
      // editor controls lives on the blogPage document or the listing section.
      // The empty array is a real answer, not a placeholder.
      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'page', description: 'Blog index page at /blog, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'Blog Listing section — composable into any page.' },
        ],
      },
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

  // ── News ───────────────────────────────────────────────────────────────────
  // ADR-020 — "Build the News module (mirrors Blog)."
  //
  // Mirrors Blog's shape because Blog's shape is right, not by copy-paste
  // inertia. The editorial differences that justify a separate module — dated
  // vs evergreen content, no author byline, its own URL space, independent
  // installability per website — are documented at the top of ./news/schema.ts.
  //
  // Self-contained: unlike Blog (whose listing can filter by an Events-module
  // event), News integrates with nothing, so it can be installed on a website
  // that has no other content module.
  {
    id: 'news',
    label: 'News',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      pageType: 'newsPage',

      collections: [
        {
          id: 'news-module',
          label: 'News',
          items: [
            {
              id: 'news-articles',
              label: 'News',
              schemaType: 'newsArticle',
              filter: `_type == "newsArticle" && projectSlug == $slug`,
              ordering: [
                { field: 'featured', direction: 'desc' as const },
                { field: 'publishedAt', direction: 'desc' as const },
              ],
              initialValueTemplate: 'newsArticleProjectOwned',
            },
            {
              id: 'news-categories',
              label: 'Categories',
              schemaType: 'newsCategory',
              filter: `_type == "newsCategory" && projectSlug == $slug`,
              initialValueTemplate: 'newsCategoryProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: ['newsListingSection'],

      schemaTypes: [
        'newsListingSection',
        'newsPage',
        'newsCategory',
        'newsArticle',
      ],

      schemaDefinitions: () => newsSchemaTypes,

      permissions: [
        {
          id: 'news.article.read',
          label: 'View news',
          description: 'View and list news items in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'news.article.write',
          label: 'Create and edit news',
          description: 'Create, edit, and publish news items.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'news.article.delete',
          label: 'Delete news',
          description: 'Permanently delete news items.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'news.taxonomy.write',
          label: 'Manage news categories',
          description: 'Create, edit, and delete news categories.',
          defaultRoles: ['owner', 'editor'],
        },
      ],

      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'page', description: 'News index page at /news, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'News Listing section — composable into any page.' },
        ],
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: [],
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — ADR-020. News module: dated announcements with their own page, categories, listing section, and /news routes.',
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

      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'page', description: 'Events index page at /events, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'Events Listing section — composable into any page.' },
        ],
      },
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

      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'page', description: 'Live page at /live, showing the current or next broadcast.' },
          { kind: 'sections', description: 'Live Latest section — composable into any page.' },
        ],
        note: 'The Live Capture and Lens hero templates are platform sections — they stay available whether or not this module is active.',
      },
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

      // ADR-020 Amendment A — form definitions are finally reachable.
      //
      // Until now `formDefinition` appeared NOWHERE in the Studio structure:
      // ADR-018 deferred the management pane to "slice 7", which never landed,
      // so the only way to open one was global search. That is why WhatsApp's
      // subjects were uneditable in practice.
      //
      // Scoped by `$tenantSlug`, not `$slug`: definitions are tenant-owned
      // (keyed by tenantSlug + role), so two websites belonging to the same
      // client legitimately share them.
      collections: [
        {
          id: 'forms-module',
          label: 'Forms',
          items: [
            {
              id: 'form-definitions',
              label: 'Form Definitions',
              schemaType: 'formDefinition',
              filter: `_type == "formDefinition" && tenantSlug == $tenantSlug`,
              ordering: [{ field: 'internalName', direction: 'asc' as const }],
              initialValueTemplate: 'formDefinitionTenantOwned',
            },
          ],
        },
      ],

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

      // ADR-020 Decision 2 — the header-CTA form reference moves off siteConfig
      // and lands here. The header CTA is a form placement, so the Forms module
      // owns it. Website Settings keeps only `ctaLabel` and `ctaHref`, which are
      // navigation properties of the website rather than form configuration.
      configSchema: [
        {
          id: 'ctaForm',
          label: 'Header CTA Form',
          type: 'reference',
          referenceTo: ['formDefinition'],
          referenceFilter: '_type == "formDefinition" && role == "active"',
          description:
            'When set, the header CTA button opens this form in an overlay instead of navigating. Leave empty to make the CTA a plain link using the URL in Website Settings → Navigation.',
        },
        {
          id: 'ctaInternalName',
          label: 'Header CTA Attribution Name',
          type: 'string',
          description:
            'Internal label recorded with each submission for lead-source attribution (e.g. "header-cta"). Never shown to visitors.',
        },
      ],

      placement: {
        surfaces: [
          {
            kind: 'siteWide',
            description:
              'Header CTA button — appears in the site header on every page when a CTA form is set above.',
          },
        ],
        note: 'The Form and Form Overlay Button sections are platform sections — they stay available whether or not this module is active. Where an individual form appears on a page is decided by the page that composes it.',
      },
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

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  // ADR-020 Decision 2 — "WhatsApp becomes a real module."
  //
  // The control-room rule: opening this module shows everything needed to make
  // WhatsApp work — where the button appears, the number, and the subjects a
  // visitor can choose. Nothing here sends the admin somewhere else.
  //
  // In particular there is deliberately NO form picker. In capture mode the
  // module owns a formDefinition behind the scenes (see syncWhatsAppForm in
  // src/lib/modules/whatsapp/form-sync.ts) so lead capture and the submissions
  // dashboard keep working — but "form" is plumbing, and an admin who just
  // enabled WhatsApp should not be asked to choose one. The reference is kept
  // in `internalFormRef`, hidden from the pane.
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    version: '2.0.0',
    status: 'released',
    category: 'engagement',

    platformContract: {
      // No pageType, collections, sectionTypes, or schemaTypes: this module
      // contributes configured site-wide surfaces, not content.
      collections: [],
      sectionTypes: [],
      schemaTypes: [],
      schemaDefinitions: () => [],

      permissions: [
        {
          id: 'whatsapp.config.manage',
          label: 'Configure WhatsApp',
          description: 'Set the WhatsApp number, subjects, and where the WhatsApp buttons appear.',
          defaultRoles: ['owner'],
        },
      ],

      configSchema: [
        // ── Where it appears ────────────────────────────────────────────────
        // Both surfaces are per-website decisions, so both live here. The
        // floating button and the contact-section button used to be configured
        // in two unrelated places (siteConfig vs. a per-section checkbox);
        // ADR-020 Amendment A brings them together.
        {
          id: 'whatsappFloating',
          label: 'Floating button on every page',
          type: 'boolean',
          initialValue: false,
          description: 'Pinned to the bottom-right corner, on every page of the website.',
        },
        {
          id: 'showInContactSections',
          label: 'Button in contact sections',
          type: 'boolean',
          initialValue: false,
          description: 'Shown beside the message button wherever a Contact section appears.',
        },

        // ── Configuration ───────────────────────────────────────────────────
        {
          id: 'whatsappNumber',
          label: 'WhatsApp Number',
          type: 'string',
          description:
            'International format, e.g. +39 335 1234567. The buttons stay hidden until this is set.',
          validation: {
            // Digits, spaces, hyphens, parentheses and a leading +.
            // Deliberately permissive: this is a display and hand-off value, not
            // a dialling API, and over-strict validation locks out valid formats.
            regex: '^\\+?[0-9\\s\\-()]{7,25}$',
            message: 'Enter a phone number in international format, e.g. +39 335 1234567.',
          },
        },
        {
          id: 'mode',
          label: 'When someone taps the button',
          type: 'select',
          initialValue: 'capture',
          description: '',
          options: [
            {
              value: 'direct',
              label: 'Open WhatsApp straight away',
              description: 'Fastest for the visitor. Nothing is recorded — you only see the message in WhatsApp.',
            },
            {
              value: 'capture',
              label: 'Ask for a subject and message first',
              description: 'The enquiry is saved and appears in the dashboard before WhatsApp opens, pre-filled.',
            },
          ],
        },
        {
          id: 'subjects',
          label: 'Subjects',
          type: 'localizedStringList',
          showWhen: { field: 'mode', equals: 'capture' },
          description:
            'What a visitor can be contacting you about. Add one row per subject, in every language the website offers.',
        },

        // ── Internal ────────────────────────────────────────────────────────
        // The module-owned form definition backing capture mode. Written by the
        // pane, never chosen by an admin — hence hidden from the Modules pane
        // and from the generated Studio form.
        {
          id: 'internalFormRef',
          label: 'Message form (managed automatically)',
          type: 'reference',
          referenceTo: ['formDefinition'],
          hidden: true,
          description:
            'Maintained by the WhatsApp module from the subjects above. Not edited directly.',
        },
      ],

      placement: {
        surfaces: [
          {
            kind: 'siteWide',
            description: 'Floating button pinned to the bottom-right corner of every page.',
            toggleFieldId: 'whatsappFloating',
          },
          {
            kind: 'siteWide',
            description: 'Button beside the message button in every Contact section.',
            toggleFieldId: 'showInContactSections',
          },
        ],
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      // Forms is required only in capture mode, which `requires` cannot express
      // (it is absolute). The Modules pane enforces the conditional dependency
      // at save time instead — see ADR-020 Amendment A.
      integratesWith: ['forms'],
    },

    dataStore: {
      // Configuration only. The enquiry captured before hand-off is a Forms
      // submission in the operational tier, owned by the Forms module — this
      // module does not keep a second copy of it.
      primary: 'content',
    },

    changelog:
      'V2.0.0 — ADR-020 Amendment A. Subjects and both button placements are configured in the module; the form picker is gone (the module owns its form definition silently). V1.0.0 — WhatsApp promoted from siteConfig fields to a first-class module.',
  },

]

// ── Build-time validation ─────────────────────────────────────────────────────
// Runs at module load time. Throws with a human-readable diagnostic if any
// manifest violates the structural rules defined in validate.ts.
// A throw here propagates as a build error in Next.js and Sanity Studio.
validateRegistry(MODULE_REGISTRY)

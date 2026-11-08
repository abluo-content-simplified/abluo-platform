import type { ModuleManifest } from './types'
import { validateRegistry } from './validate'
import { blogSchemaTypes } from './blog/schema'
import { eventsSchemaTypes } from './events/schema'
import { liveSchemaTypes } from './live/schema'
import { formsSchemaTypes } from './forms/schema'
import { newsSchemaTypes } from './news/schema'
import { gallerySchemaTypes } from './gallery/schema'
import { faqSchemaTypes } from './faq/schema'
import { documentsSchemaTypes } from './documents/schema'
import { catalogueSchemaTypes } from './catalogue/schema'
import { CATALOGUE_TAXONOMY_SCHEMA_TYPE_NAMES } from './catalogue/schema-taxonomy'
import { brandHubSchemaTypes } from './brand-hub/schema'
import { peopleSchemaTypes } from './people/schema'
import { coursesSchemaTypes } from './courses/schema'
import { SEGMENT_REGEX_SOURCE } from './catalogue/segment'
import { personDisplayName } from './people/model'
import { PERSON_HAS_PAGE } from './people/projection'
import { COURSE_VISIBLE } from './courses/queries'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { visibilityFilter } from './catalogue/visibility'
import { PROFILES, PROFILE_ORDER, profilesWith } from './catalogue/profiles'

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
    createAction: { createOrder: 10, permission: 'blog.post.write', ready: true, href: (slug) => `/${slug}/posts/write/new`, },
    search: {
      kind: 'blog',
      permission: 'blog.post.read',
      href: (slug, id) => `/${slug}/posts/write/${id}`,
      listHref: (slug) => `/${slug}/posts`,
      source: {
        type: 'sanity',
        docType: 'post',
        site: { visible: publicFilterFor('post'), segment: { fixed: 'blog' } },
        projection: 'title, subtitle, excerpt, "thumb": coverImage.asset->url',
        fields: [
        { name: 'title', kind: 'localizedString', weight: 3 },
        { name: 'subtitle', kind: 'localizedString', weight: 2 },
        { name: 'excerpt', kind: 'localizedText', weight: 2 },
        { name: 'categories', kind: 'stringArray', weight: 2 },
        { name: 'categories', kind: 'termKeys', weight: 2, terms: { module: 'blog', kind: 'category' } },
        { name: 'body', kind: 'localizedPortableText', weight: 1 },
        ],
        titleOf: (row, r) => r.text(row.title),
        subtitleOf: (row, r) => r.text(row.subtitle) || r.text(row.excerpt),
      },
    },
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
          label: 'Delete drafts',
          description: 'Delete blog post drafts that were never published.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          // ADR-028: was a hard-coded Owner-only role check in post-lifecycle.ts.
          // Project Admins hold it too (owner bundle on their project).
          id: 'blog.published.delete',
          // ADR-032 D7 (amended): kept as the permanent-delete permission for
          // content that was ever published — only after it has been archived.
          label: 'Delete posts permanently',
          description: 'Permanently delete an archived post that was published before.',
          defaultRoles: ['owner'],
        },
        {
          id: 'blog.taxonomy.write',
          label: 'Manage categories and authors',
          description: 'Create, edit, and delete blog categories and post authors.',
          defaultRoles: ['owner', 'editor'],
        },
      ],

      // ADR-020 Amendment B — DEFINING a category is configuration; SELECTING one
      // while writing is content. The vocabulary lives here; Content holds only
      // the entries themselves.
      configSchema: [
        {
          id: 'categories',
          label: 'Categories',
          type: 'localizedStringList',
          supportsColor: true,
          // Blog categories are the one list in this registry that is also a
          // set of public pages: /category/<key>. The old Webflow site
          // published them and those URLs are indexed.
          supportsRouting: true,
          usage: { schemaType: 'post', field: 'categories', noun: 'posts' },
          description:
            'Post categories now live in Categories & Tags (dashboard). This list is only read while a website has none there yet. Renaming or translating a label is safe — content filed under it keeps its link.',
        },
        {
          id: 'readingSpeed',
          label: 'Reading speed (words per minute)',
          type: 'number',
          initialValue: 200,
          description:
            'Used to estimate reading time. 200 is the average for adult prose; lower it for dense or technical writing.',
        },
      ],

      placement: {
        surfaces: [
          { kind: 'page', description: 'Blog index page at /blog, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'Blog Listing section — composable into any page.' },
        ],
      },
    },

    // ADR-033 Amendment J — post categories are taxonomyTerm records (no tags).
    // They are also public pages (/category/<key>), so terms carry description,
    // retired keys (redirectFrom) and noindex besides label and colour.
    taxonomies: [{ kind: 'category', routable: true, color: true, usedBy: [{ type: 'post', field: 'categories' }] }],

    publicContract: {},

    dependencies: {
      requires: [],
      // blogListingSection filterMode 'byEvent' references the event type;
      // post.gallery references the gallery type (ADR-022 §6); post.faqSets
      // references faqSet (ADR-037 D5); post.authors references person
      // (ADR-043 D5). All optional.
      integratesWith: ['events', 'gallery', 'faq', 'people'],
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
    createAction: { createOrder: 20, permission: 'news.article.write', ready: false, },
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

      // ADR-020 Amendment B — DEFINING a category is configuration; SELECTING one
      // while writing is content. The vocabulary lives here; Content holds only
      // the entries themselves.
      configSchema: [
        {
          id: 'categories',
          label: 'Categories',
          type: 'localizedStringList',
          supportsColor: true,
          usage: { schemaType: 'newsArticle', field: 'categories', noun: 'news items' },
          description:
            'News categories now live in Categories & Tags (dashboard). This list is only read while a website has none there yet. Renaming or translating a label is safe — content filed under it keeps its link.',
        },
        {
          id: 'readingSpeed',
          label: 'Reading speed (words per minute)',
          type: 'number',
          initialValue: 200,
          description:
            'Used to estimate reading time. 200 is the average for adult prose; lower it for dense or technical writing.',
        },
      ],

      placement: {
        surfaces: [
          { kind: 'page', description: 'News index page at /news, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'News Listing section — composable into any page.' },
        ],
      },
    },

    // ADR-033 Amendment J — news categories are taxonomyTerm records (no tags).
    // Labels with a badge colour; News has no category pages, so nothing routable.
    taxonomies: [{ kind: 'category', color: true, usedBy: [{ type: 'newsArticle', field: 'categories' }] }],

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
    createAction: { createOrder: 30, permission: 'events.event.write', ready: true, href: (slug) => `/${slug}/agenda/new`, },
    search: {
      kind: 'events',
      permission: 'events.event.read',
      href: (slug, id) => `/${slug}/agenda/${id}`,
      listHref: (slug) => `/${slug}/agenda`,
      source: {
        type: 'sanity',
        docType: 'event',
        site: { visible: `${publicFilterFor('event')} && coalesce(visibility, "public") != "unlisted"`, segment: { fixed: 'events' } },
        projection: 'title, shortDescription, "thumb": heroImage.asset->url',
        fields: [
        { name: 'title', kind: 'localizedString', weight: 3 },
        { name: 'shortDescription', kind: 'localizedText', weight: 2 },
        { name: 'location', kind: 'localizedString', weight: 2 },
        { name: 'place.venue->name', kind: 'localizedString', weight: 2, when: 'place.venue->projectSlug == $projectSlug' },
        { name: 'categories', kind: 'stringArray', weight: 2 },
        { name: 'categories', kind: 'termKeys', weight: 2, terms: { module: 'events', kind: 'category' } },
        { name: 'fullDescription', kind: 'localizedPortableText', weight: 1 },
        ],
        titleOf: (row, r) => r.text(row.title),
        subtitleOf: (row, r) => r.text(row.shortDescription),
      },
    },
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
        {
          // ADR-031 D6 — reusable venues for events not at the site's own
          // locations. Its own one-item group, so it flattens to a sibling of
          // Events (Content → Venues) instead of nesting Events one level deeper.
          id: 'event-venues-module',
          label: 'Venues',
          items: [
            {
              id: 'event-venues',
              label: 'Venues',
              schemaType: 'eventVenue',
              filter: `_type == "eventVenue" && projectSlug == $slug`,
              initialValueTemplate: 'eventVenueProjectOwned',
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
        'eventVenue',
        'event',
      ],

      schemaDefinitions: () => eventsSchemaTypes,

      permissions: [
        {
          id: 'events.event.read',
          label: 'View events',
          description: 'View and list events in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
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

      // ADR-020 Amendment B — DEFINING a category is configuration; SELECTING one
      // while writing is content. The vocabulary lives here; Content holds only
      // the entries themselves.
      configSchema: [
        {
          id: 'categories',
          label: 'Categories',
          type: 'localizedStringList',
          supportsColor: true,
          usage: { schemaType: 'event', field: 'categories', noun: 'events' },
          description:
            'Event categories now live in Categories & Tags (dashboard). This list is only read while a website has none there yet. Renaming or translating a label is safe — content filed under it keeps its link.',
        },
        // ── Capabilities (ADR-038 D6) — read only through resolveEventCapabilities()
        // (events/capabilities.ts). Defaults = the dashboard before capabilities existed.
        {
          id: 'capInPerson',
          label: 'In-person events',
          type: 'boolean',
          initialValue: true,
          description: 'The client can mark events as happening in person. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capOnline',
          label: 'Online events',
          type: 'boolean',
          initialValue: true,
          description: 'The client can mark events as online. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capHybrid',
          label: 'Hybrid events',
          type: 'boolean',
          initialValue: true,
          description: 'The client can mark events as in person and online. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capVenues',
          label: 'Venues',
          type: 'select',
          initialValue: 'abluoManaged',
          options: [
            { value: 'off', label: 'Off', description: 'No venue picker. The client types the place.' },
            { value: 'abluoManaged', label: 'Managed by Abluo', description: 'The client picks from the venues Abluo saved.' },
            { value: 'tenantManaged', label: 'Managed by the client', description: 'The client also creates and edits venues.' },
          ],
          description: 'Saved places events can use (the website\'s own locations are always offered). What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capHosts',
          label: 'Hosts',
          type: 'boolean',
          initialValue: false,
          description: 'The client can add and edit the people hosting or teaching an event. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capFullDescription',
          label: 'Full description',
          type: 'boolean',
          initialValue: false,
          description: 'The client can write the long event description. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capProgramme',
          label: 'Programme',
          type: 'boolean',
          initialValue: false,
          description: 'The client can edit the event programme. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capGallery',
          label: 'Photo gallery',
          type: 'boolean',
          initialValue: false,
          description: 'The client can show a photo gallery on an event. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capPricing',
          label: 'Prices',
          type: 'boolean',
          initialValue: false,
          description: 'The client can list prices on an event. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
        {
          id: 'capRegistration',
          label: 'Sign-up',
          type: 'select',
          initialValue: 'externalLink',
          options: [
            { value: 'off', label: 'Off', description: 'No sign-up button in the client\'s editor.' },
            { value: 'externalLink', label: 'Link', description: 'The client adds a sign-up link and button label.' },
          ],
          description: 'How people sign up for an event. What the client can use in the Events screen of their dashboard. Studio always shows everything. Switching it off never deletes or changes existing content, which keeps showing on the website.',
        },
      ],

      placement: {
        surfaces: [
          { kind: 'page', description: 'Events index page at /events, with its own hero, intro, and SEO.' },
          { kind: 'sections', description: 'Events Listing section — composable into any page.' },
        ],
      },
    },

    // ADR-033 Amendment J — event categories are taxonomyTerm records (no tags).
    // Event categories are labels with a badge colour, not pages.
    taxonomies: [{ kind: 'category', color: true, usedBy: [{ type: 'event', field: 'categories' }] }],

    publicContract: {},

    dependencies: {
      requires: [],
      // event.hostPeople and schedule instructors reference person (ADR-043 D5, D9). Optional.
      integratesWith: ['people'],
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
    // Contact requests (Supabase form_submissions) — filtered server-side, gated like the Requests screen.
    search: {
      kind: 'forms',
      permission: 'forms.submission.read',
      href: (slug, id) => `/${slug}/submissions?open=${id}`,
      listHref: (slug) => `/${slug}/submissions`,
      source: { type: 'contact-requests' },
    },
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
          // ADR-028: contact requests hold personal data — Owner / Site admin by
          // default; anyone else only with the extra (database enforces the same, 030).
          defaultRoles: ['owner'],
        },
        {
          id: 'forms.submission.update',
          label: 'Update submissions',
          description: 'Change a submission status (new → processed → archived).',
          defaultRoles: ['owner'],
        },
        {
          id: 'forms.submission.delete',
          label: 'Delete submissions',
          description: 'Permanently delete form submissions.',
          // Not grantable as an extra: deleting personal data stays with Owner / Site admin.
          defaultRoles: ['owner'],
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
      // No settings: a form is configured by editing the form itself, and the
      // header button — the only thing that ever lived here — is a navigation
      // property, now in Website Settings → Navigation.
      configSchema: [],

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

  // ── Gallery ────────────────────────────────────────────────────────────────
  // ADR-022 — galleries promoted from loose platform types to a module.
  //
  // A gallery is a small, hand-ordered set of Media Library photos. The module
  // owns the sets; the Photo Gallery section (and a blog post's optional
  // gallery) only decide where a set appears and how it is laid out.
  //
  // Editing is admin-only in Studio for now. The permissions are declared
  // anyway so a client-side gallery editor later needs no redesign.
  //
  // ⚠ ROLLOUT: photoGallerySection is now module-gated. A project that uses a
  // gallery section must have the module installed BEFORE this code reaches
  // its environment, or the section stops rendering. Migration
  // 006-install-gallery-module installs it where galleries exist; run it first.
  {
    id: 'gallery',
    createAction: { createOrder: 40, permission: 'gallery.gallery.write', ready: true, href: (slug) => `/${slug}/galleries/new`, },
    label: 'Gallery',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      collections: [
        {
          id: 'gallery-module',
          label: 'Galleries',
          items: [
            {
              id: 'galleries',
              label: 'Galleries',
              schemaType: 'gallery',
              filter: `_type == "gallery" && projectSlug == $slug`,
              ordering: [{ field: 'internalName', direction: 'asc' as const }],
              initialValueTemplate: 'galleryProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: ['photoGallerySection'],

      schemaTypes: ['galleryItem', 'gallery', 'photoGallerySection'],

      schemaDefinitions: () => gallerySchemaTypes,

      permissions: [
        {
          id: 'gallery.gallery.read',
          label: 'View galleries',
          description: 'View and list galleries in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'gallery.gallery.write',
          label: 'Create and edit galleries',
          description: 'Create galleries, add, remove and reorder their photos.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          // ADR-028: was a hard-coded Owner-only role check in gallery-drafts.ts.
          id: 'gallery.gallery.delete',
          label: 'Delete galleries',
          description: 'Delete a gallery (its photos stay in the Media Library).',
          defaultRoles: ['owner'],
        },
      ],

      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'sections', description: 'Photo Gallery section — one or more galleries, in any page, with tabs and a lightbox.' },
        ],
        note: 'A blog post can also show one gallery below its text (Blog module, when both are active).',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['blog'],
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — ADR-022. gallery / galleryItem / photoGallerySection become a module; sections compose several galleries (tabs, All tab), focal points, fixed tile shapes, lightbox with deep links, six layouts.',
  },

  // ── FAQ ────────────────────────────────────────────────────────────────────
  // ADR-037 — a library of reusable FAQ sets.
  //
  // The module owns the sets; placements (the FAQ section on a page, a blog
  // post's FAQs, later an event's) only REFERENCE them, so editing a set
  // updates every place that shows it. faqItem and faqSection moved here from
  // schema.ts with their names unchanged.
  //
  // ⚠ ROLLOUT: faqSection is now module-gated. A project that shows an FAQ
  // section must have the module installed BEFORE this code reaches its
  // environment, or the section stops rendering. Migration
  // 007-install-faq-module installs it where FAQs exist; run it first.
  {
    id: 'faq',
    createAction: { createOrder: 60, permission: 'faq.set.write', ready: true, href: (slug) => `/${slug}/faq-sets?new=1`, },
    label: 'FAQ',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      collections: [
        {
          id: 'faq-module',
          label: 'FAQ Sets',
          items: [
            {
              id: 'faq-sets',
              label: 'FAQ Sets',
              schemaType: 'faqSet',
              filter: `_type == "faqSet" && projectSlug == $slug`,
              ordering: [{ field: 'internalName', direction: 'asc' as const }],
              initialValueTemplate: 'faqSetProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: ['faqSection'],

      schemaTypes: ['faqItem', 'faqAnswerText', 'faqEntry', 'faqSet', 'faqSection'],

      schemaDefinitions: () => faqSchemaTypes,

      permissions: [
        {
          id: 'faq.set.read',
          label: 'View FAQ sets',
          description: 'View and list FAQ sets, and see where they are used.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'faq.set.write',
          label: 'Create and edit FAQ sets',
          description: 'Create, edit, reorder, duplicate, publish, archive and restore FAQ sets.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'faq.set.delete',
          label: 'Delete FAQ sets',
          description: 'Permanently delete an archived or never-published FAQ set.',
          defaultRoles: ['owner'],
        },
      ],

      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'sections', description: 'FAQ section — one or more FAQ sets, in any page, with an accordion and FAQPage structured data.' },
        ],
        note: 'A blog post can also show FAQ sets below its text, after the gallery (Blog module, when both are active).',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['blog', 'events', 'translate'],
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — ADR-037 slice 1. faqSet library (restricted rich-text answers), faqSection and blog posts reference sets, one merged FAQPage per URL.',
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
          // Tenant-scoped even though it is hidden and module-written: defence in
          // depth, so this can never resolve another tenant's form.
          //
          // This STRING is the Modules-pane filter: ModuleList.tsx runs the
          // option query itself and binds `$tenantSlug` (the current website's
          // tenant) before interpolating it, so the param resolves there.
          // Nothing binds `$tenantSlug` in the Studio's own reference picker,
          // so config-schema.ts does NOT hand this string to the generated
          // field: any picker pointing at `formDefinition` gets
          // `activeFormReferenceFilter` instead, which resolves the tenant from
          // the project document and fails closed. The registry stays
          // declarative — it cannot import that resolver
          // (schema.ts → config-schema.ts → registry.ts is the existing
          // direction), and config-schema.ts is the seam that applies it.
          referenceFilter: '_type == "formDefinition" && tenantSlug == $tenantSlug',
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

  // ── Translate (ADR-023) ─────────────────────────────────────────────────────
  // One-click machine translation of localized fields, stored — never
  // translated per visitor. Owns no content: it adds a capability to the
  // platform's localized field types, so it contributes no schema types,
  // sections or collections, and has no website surface.
  {
    id: 'translate',
    label: 'Translate',
    version: '1.0.0',
    status: 'released',
    category: 'platform',

    platformContract: {
      collections: [],
      sectionTypes: [],
      schemaTypes: [],
      schemaDefinitions: () => [],

      permissions: [
        {
          id: 'translate.use',
          label: 'Translate content',
          description: 'Use the Translate button to fill the other languages of a field from the source text.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'translate.usage.read',
          label: 'See translation usage',
          description: 'See how many characters this website has translated this month, and its limit.',
          defaultRoles: ['owner'],
        },
      ],

      // ADR-023 §2 — the ONE configuration surface for provider and quota.
      // API keys are environment variables, never Sanity (the dataset is public).
      configSchema: [
        {
          id: 'provider',
          label: 'Translation service',
          type: 'select',
          initialValue: 'google',
          description: 'Which engine translates this website. The API key is set per environment, not here.',
          options: [
            {
              value: 'google',
              label: 'Google Cloud Translation',
              description: 'Fast and inexpensive. Needs GOOGLE_TRANSLATE_API_KEY.',
            },
            {
              value: 'deepl',
              label: 'DeepL',
              description: 'Often more natural for European languages. Needs DEEPL_API_KEY.',
            },
            {
              value: 'claude',
              label: 'Claude (AI)',
              description: 'Best at keeping tone and register. Needs ANTHROPIC_API_KEY and TRANSLATE_CLAUDE_MODEL.',
            },
          ],
        },
        {
          id: 'monthlyCharacterQuota',
          label: 'Monthly limit (characters)',
          type: 'number',
          description:
            'Characters this website may translate per calendar month. Leave empty for no limit. When reached, the Translate button is disabled with a "contact us" message.',
        },
      ],

      placement: {
        surfaces: [],
        note: 'Editing only. Appears as a Translate button on multilingual fields; nothing changes on the public website.',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: [],
    },

    dataStore: {
      // Configuration in Sanity (module config + a hidden per-value status),
      // usage records in Supabase (translation_usage).
      primary: 'hybrid',
    },

    changelog: 'V1.0.0 — ADR-023. Translate button on localized text fields, swappable provider, per-project metering and optional monthly quota.',
  },

  // ── Catalogue ──────────────────────────────────────────────────────────────
  // ADR-033 / catalogue-module-v1-spec §3. Items, collections, option lists.
  // The first tenant is a restaurant; nothing here knows that.
  {
    id: 'catalogue',
    createAction: { createOrder: 50, permission: 'catalogue.item.write', ready: true, href: (slug) => `/${slug}/catalogue/new`, },
    search: {
      kind: 'catalogue',
      permission: 'catalogue.item.read',
      href: (slug, id) => `/${slug}/catalogue/${id}`,
      listHref: (slug) => `/${slug}/catalogue/items`,
      source: {
        type: 'sanity',
        docType: 'catalogueItem',
        site: { visible: `hasPage == true && defined(slug) && ${publicFilterFor('catalogueItem')} && ${visibilityFilter('sitemap')}`, segment: { moduleId: 'catalogue', configKey: 'publicSegment' } },
        projection: 'name, byline, description, "thumb": select(images[0]->projectSlug == $projectSlug => images[0]->image.asset->url)',
        fields: [
        { name: 'name', kind: 'localizedString', weight: 3 },
        { name: 'byline', kind: 'localizedString', weight: 2 },
        { name: 'description', kind: 'localizedText', weight: 2 },
        { name: 'categories', kind: 'stringArray', weight: 2 },
        { name: 'primaryCategory', kind: 'string', weight: 2 },
        { name: 'additionalCategories', kind: 'stringArray', weight: 2 },
        { name: 'tags', kind: 'stringArray', weight: 2 },
        // Labels people see (taxonomyTerm records, ADR-033 J); the keys above stay for legacy config lists.
        { name: 'categories', kind: 'termKeys', weight: 2, terms: { module: 'catalogue', kind: 'category' } },
        { name: 'primaryCategory', kind: 'termKey', weight: 2, terms: { module: 'catalogue', kind: 'category' } },
        { name: 'additionalCategories', kind: 'termKeys', weight: 2, terms: { module: 'catalogue', kind: 'category' } },
        { name: 'tags', kind: 'termKeys', weight: 2, terms: { module: 'catalogue', kind: 'tag' } },
        { name: 'body', kind: 'localizedPortableText', weight: 1 },
        ],
        titleOf: (row, r) => r.text(row.name),
        subtitleOf: (row, r) => r.text(row.byline) || r.text(row.description),
      },
    },
    label: 'Catalogue',
    version: '1.0.0',
    status: 'released',
    category: 'commerce',

    platformContract: {
      // ADR-033 C1 — served at /{segment}, not a fixed /catalogue.
      pageType: 'cataloguePage',

      collections: [
        {
          id: 'catalogue-items',
          label: 'Items',
          items: [
            {
              id: 'items',
              label: 'Items',
              schemaType: 'catalogueItem',
              filter: `_type == "catalogueItem" && projectSlug == $slug`,
              initialValueTemplate: 'catalogueItemProjectOwned',
            },
          ],
        },
        {
          id: 'catalogue-collections',
          label: 'Collections',
          items: [
            {
              id: 'collections',
              label: 'Collections',
              schemaType: 'catalogueCollection',
              filter: `_type == "catalogueCollection" && projectSlug == $slug`,
              initialValueTemplate: 'catalogueCollectionProjectOwned',
            },
          ],
        },
        {
          id: 'catalogue-option-lists',
          label: 'Option lists',
          items: [
            {
              id: 'option-lists',
              label: 'Option lists',
              schemaType: 'catalogueOptionList',
              filter: `_type == "catalogueOptionList" && projectSlug == $slug`,
              initialValueTemplate: 'catalogueOptionListProjectOwned',
            },
          ],
        },
      ],

      // Spec §4.6. Rendered by catalogue/section-components.tsx via SECTION_MAP;
      // hydrated in hydrateSections (shared by every page route).
      sectionTypes: ['catalogueListingSection'],

      // Every name below has a definition in catalogueSchemaTypes.
      schemaTypes: [
        'catalogueListingSection',
        'cataloguePage',
        'catalogueItem',
        'catalogueCollection',
        'catalogueOptionList',
        'catalogueOffer',
        'catalogueItemOptionList',
        'catalogueItemLink',
        'catalogueOption',
        'catalogueSection',
        'catalogueAvailability',
        // Catalogue V2 R1 commerce types (schema-commerce.ts).
        'catalogueWeeklyWindow',
        'catalogueWeeklyOverride',
        'catalogueChannelRule',
        'cataloguePrice',
        'catalogueFormat',
        'catalogueFormatTemplate',
        'catalogueMigrationMarkers',
        // Catalogue V2 R1 (schema-taxonomy.ts).
        ...CATALOGUE_TAXONOMY_SCHEMA_TYPE_NAMES,
      ],

      schemaDefinitions: () => catalogueSchemaTypes,

      // ADR-033 §8 + Amendment C4. Option lists reuse catalogue.item.*;
      // cataloguePage reuses catalogue.collection.*.
      permissions: [
        {
          id: 'catalogue.item.read',
          label: 'View items and collections',
          description: 'View and list catalogue items, collections and option lists in the client dashboard.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'catalogue.item.write',
          label: 'Create and edit items',
          description: 'Create, edit and publish items and option lists.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'catalogue.item.delete',
          label: 'Delete items',
          description: 'Delete catalogue items and option lists that were never published.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'catalogue.item.deletePublished',
          label: 'Permanently delete published items',
          description: 'Permanently delete previously published items and option lists.',
          defaultRoles: ['owner'],
        },
        {
          id: 'catalogue.collection.write',
          label: 'Create and edit collections',
          description: 'Create, edit and publish collections and the catalogue landing page.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'catalogue.collection.delete',
          label: 'Delete collections',
          description: 'Delete collections that were never published.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'catalogue.collection.deletePublished',
          label: 'Permanently delete published collections',
          description: 'Permanently delete previously published collections and the landing page.',
          defaultRoles: ['owner'],
        },
        {
          // C8 §8.3 (D-3): narrowed — create (also inline), rename/translate, reorder siblings, delete an
          // UNUSED leaf, every tag operation. Structure, availability rules and packs are setup.manage.
          id: 'catalogue.taxonomy.write',
          label: 'Manage Categories And Tags',
          description: 'Create, rename, translate and delete unused categories and tags.',
          defaultRoles: ['owner', 'editor'],
        },
        // ── C8 §8.2 (Catalogue V2 R2) ── 'owner' = Owner and Site admin (moduleRoleFor).
        {
          id: 'catalogue.setup.manage',
          label: 'Manage Catalogue Setup',
          description:
            'Starter packs, service channels and their default availability, category structure and availability rules, item defaults, currency, publication standards and public website settings.',
          defaultRoles: ['owner'],
        },
        {
          id: 'catalogue.import.use',
          label: 'Import Catalogue Data',
          description: 'Start, confirm and undo a Catalogue import.',
          defaultRoles: ['owner'],
        },
        {
          // Never in support mode (SUPPORT_NEVER_WRITES, D-21).
          id: 'catalogue.export.use',
          label: 'Export Catalogue Data',
          description: 'Data exports, printed menus and the allergen register.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          // D-16: never in support mode (SUPPORT_NEVER_WRITES).
          id: 'catalogue.allergen.update',
          label: 'Review Allergens',
          description: 'Mark a food item’s allergen declaration as reviewed.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          // D-17: Owner and Site admin only.
          id: 'catalogue.readiness.update',
          label: 'Override Readiness Warnings',
          description: 'Silence a recommended readiness warning on an item, with a reason.',
          defaultRoles: ['owner'],
        },
      ],

      // Spec §5. `publicSegment` is required with NO default (ADR-033 C1);
      // `publicSegmentHistory` is module-written (see ADR-033 D11).
      configSchema: [
        {
          id: 'publicSegment',
          label: 'Public URL segment',
          type: 'string',
          required: true,
          validation: {
            regex: SEGMENT_REGEX_SOURCE,
            message: 'Use lowercase letters, numbers and single hyphens, with no slashes or spaces (e.g. "menu").',
          },
          validator: 'catalogue.publicSegment',
          description:
            'The web address where your catalogue lives, e.g. "menu" gives /menu and /menu/pizza-margherita. Cannot be a word the website already uses. Old values keep redirecting.',
        },
        {
          id: 'publicSegmentHistory',
          label: 'Retired URL segments',
          type: 'stringList',
          hidden: true,
          description: 'Maintained by the module. Every segment this website has used; each redirects to the current one.',
        },
        {
          // C11 R-A1: deprecated — the dashboard always says "Catalogue". Kept (hidden) until
          // data step D4 copies it into publicName; removed in R3.
          id: 'navLabel',
          label: 'Dashboard name (deprecated)',
          type: 'localizedString',
          hidden: true,
          description: 'No longer used: the dashboard always says "Catalogue". Its value is moved to "Public name".',
        },
        {
          // C11: the tenant's word for the catalogue on the website (Menu, Books, Wine list…).
          id: 'publicName',
          label: 'Public name',
          type: 'localizedString',
          description: 'Used on your website; the dashboard always says Catalogue.',
        },
        {
          // C7.9 / D-14: module-written setup state (never which pack). Hidden in every editor.
          id: 'setupCompletedAt',
          label: 'Setup completed',
          type: 'string',
          hidden: true,
          description: 'Maintained by the module. When Catalogue setup was completed.',
        },
        {
          id: 'setupSource',
          label: 'Setup source',
          type: 'select',
          hidden: true,
          options: [
            { value: 'empty', label: 'Started empty' },
            { value: 'pack', label: 'Starter pack' },
            { value: 'manual', label: 'Marked complete' },
          ],
          description: 'Maintained by the module. How setup was completed.',
        },
        {
          id: 'affiliateDisclosure',
          label: 'Affiliate disclosure',
          type: 'localizedString',
          description:
            'One sentence, shown once at the bottom of a page that has at least one affiliate buy link. Leave a language empty to use the standard wording for it (for example "Some links on this page are affiliate links. If you buy through them, we receive a small commission at no extra cost to you.").',
        },
        {
          id: 'categories',
          label: 'Categories',
          type: 'localizedStringList',
          supportsColor: true,
          supportsRouting: false,
          usage: { schemaType: 'catalogueItem', field: 'categories', noun: 'items' },
          description:
            'The categories an item can be filed under, in every language this website offers. Categories are labels only; they do not get pages.',
        },
        {
          id: 'dietaryTags',
          label: 'Dietary tags',
          type: 'localizedStringList',
          usage: { schemaType: 'catalogueItem', field: 'dietary', noun: 'items' },
          description: 'Your own dietary vocabulary (vegetarian, vegan, …). Allergens are a fixed legal list and are not configured here.',
        },
        {
          id: 'serviceChannels',
          label: 'Service channels',
          type: 'localizedStringList',
          // Contract C2-3: each entry also carries active / defaultAvailability / defaultSchedule.
          supportsChannelAttributes: true,
          description:
            'How an item is obtained (dine in, takeaway, delivery, …). Each channel has its own default availability; a price without a channel is the standard price. A new catalogue has none.',
        },
        {
          id: 'formatTemplates',
          label: 'Format templates',
          type: 'schemaType',
          schemaType: 'catalogueFormatTemplate',
          schemaTypeArray: true,
          hidden: true,
          description: 'Quick picks for new formats (Glass 25 cl, Bottle 33 cl …), copied into an item, never linked. Edited in Catalogue → Setup (contract C3-6).',
        },
        {
          id: 'catalogueMigrations',
          label: 'Catalogue migrations',
          type: 'schemaType',
          schemaType: 'catalogueMigrationMarkers',
          hidden: true,
          description: 'Maintained by the migration scripts: when each Catalogue data step was verified for this project (contract C10-6).',
        },
        {
          id: 'defaultItemProfile',
          label: 'Default item profile',
          type: 'select',
          options: PROFILE_ORDER.map((id) => ({ value: id, label: PROFILES[id].label })),
          description:
            'What the new-item wizard preselects for "What are you offering?". Optional; always changeable per item.',
        },
        {
          // D-13 part 4 (C7.6): the list-image frame of items WITHOUT a profile, written once by data
          // step D3 only where `defaultItemProfile` would change the shape the legacy preset gave.
          id: 'itemImageShape',
          label: 'Image frame for items without a type',
          type: 'select',
          hidden: true,
          options: [
            { value: 'portrait', label: 'Upright' },
            { value: 'landscape', label: 'Landscape' },
          ],
          description: 'Maintained by the module. The list-image frame of items that have no type yet.',
        },
        {
          id: 'currency',
          label: 'Currency',
          type: 'select',
          initialValue: 'EUR',
          changeGuard: 'catalogue.currencyChange',
          description:
            'The one currency for every price on this website. Changing it does not convert any amount; existing prices are read in the new currency.',
          options: [
            { value: 'EUR', label: 'Euro (EUR)' },
            { value: 'CHF', label: 'Swiss franc (CHF)' },
            { value: 'GBP', label: 'Pound sterling (GBP)' },
            { value: 'USD', label: 'US dollar (USD)' },
            { value: 'CAD', label: 'Canadian dollar (CAD)' },
            { value: 'AUD', label: 'Australian dollar (AUD)' },
            { value: 'SEK', label: 'Swedish krona (SEK)' },
            { value: 'NOK', label: 'Norwegian krone (NOK)' },
            { value: 'DKK', label: 'Danish krone (DKK)' },
            { value: 'PLN', label: 'Polish zloty (PLN)' },
            { value: 'CZK', label: 'Czech koruna (CZK)' },
            { value: 'HUF', label: 'Hungarian forint (HUF)' },
            { value: 'RON', label: 'Romanian leu (RON)' },
            { value: 'JPY', label: 'Japanese yen (JPY)' },
          ],
        },
        {
          id: 'showPricesByDefault',
          label: 'Show prices by default',
          type: 'boolean',
          initialValue: true,
          description: 'New catalogue sections show prices unless switched off for that section.',
        },
      ],

      // ADR-033 D-1. No currency in any preset: it is where a business is.
      starterPresets: [
        {
          id: 'restaurant',
          version: 2,
          label: 'Restaurant',
          description: 'A menu: dine-in and takeaway channels, food and drink items.',
          config: {
            publicSegment: 'menu',
            serviceChannels: [
              { value: 'dine-in', label: { en: 'Dine-in', it: 'Al tavolo', de: 'Vor Ort' } },
              { value: 'takeaway', label: { en: 'Takeaway', it: 'Da asporto', de: 'Zum Mitnehmen' } },
            ],
            // The profile that carries food information (looked up, not named).
            defaultItemProfile: profilesWith('foodInformation')[0],
          },
        },
        {
          id: 'bookshop',
          version: 2,
          label: 'Bookshop',
          description: 'A book list: products, no service channels.',
          config: {
            publicSegment: 'books',
            defaultItemProfile: PROFILES.product.id,
          },
        },
      ],

      placement: {
        surfaces: [
          { kind: 'page', description: 'A catalogue landing page at the configured URL segment.' },
          { kind: 'sections', description: 'Catalogue section — one collection, with its sections and items, in any page.' },
        ],
      },
    },

    // Catalogue V2 R2 (C1.2, C1.10, K-4): Catalogue categories and tags live in the
    // Catalogue-owned `catalogue-taxonomy.<slug>` document, written ONLY by
    // CatalogueTaxonomyService. No `taxonomies` declaration: the generic taxonomy
    // service refuses the Catalogue (`kind_not_declared`) and Categories & Tags has
    // no Catalogue tab. (Legacy `taxonomyTerm` records stay readable until R3.)

    // C9 §9.3 (R2 config lock): configured in the dashboard (Catalogue → Setup);
    // the Studio Modules pane and the project form show this config read-only.
    configSurface: 'dashboard',

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['gallery'],
    },

    dataStore: {
      primary: 'content',
    },

    changelog: 'V1.0.0 — Items, collections, offers, options, public item and collection pages (ADR-033).',
  },

  // ── Brand Hub (ADR-036) ─────────────────────────────────────────────────────
  // Brand guidelines generated from the design system and site settings, served
  // at /brand on the client's own website (noindex). The module owns only the
  // WRITTEN part — one brandGuide document per project; every design value is
  // read live from its owner, never copied.
  {
    id: 'brand-hub',
    label: 'Brand Hub',
    version: '1.0.0',
    status: 'released',
    category: 'platform',

    platformContract: {
      collections: [
        {
          id: 'brand-hub-module',
          label: 'Brand Hub',
          items: [
            {
              id: 'brand-guide',
              label: 'Brand guide',
              schemaType: 'brandGuide',
              filter: `_type == "brandGuide" && projectSlug == $slug`,
              initialValueTemplate: 'brandGuideProjectOwned',
            },
          ],
        },
      ],

      sectionTypes: [],

      schemaTypes: ['brandGuideExample', 'brandGuidePage', 'brandGuide'],

      schemaDefinitions: () => brandHubSchemaTypes,

      permissions: [],

      configSchema: [],

      placement: {
        surfaces: [],
        note: 'Adds the brand guidelines at /brand on this website (hidden from search engines, not linked from the menu). The values come from the design system; only the written guidance is edited here.',
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

    changelog: 'V1.0.0 — ADR-036. Overview, colour, typography, shape & spacing, layout, logo & assets and motion pages generated from the design system; written guidance and do/don’t examples per page.',
  },

  // ── Access (Site Access) ───────────────────────────────────────────────────
  // ADR-040. Restricted pages and protected files for chosen audiences (groups),
  // opened with shared passwords in Phase 1. Module id `members` keeps the
  // permission prefix ADR-028 reserved; people see "Access".
  //
  // Everything the module owns lives in Supabase (migration 050): groups,
  // passwords, visitor sessions, protected documents. Installing, disabling or
  // removing the installation here changes ONLY the Sanity installation record:
  //   • nothing in Supabase is created or deleted by it — no cleanup runs;
  //   • restricted resources stay CLOSED while the module is off
  //     (evaluateAccess → 'module_unavailable'), never public;
  //   • management is refused while it is off (assertModuleAction checks the
  //     installation first), and visitor passwords stop working.
  // Destructive cleanup of a project's access data is a separate, explicitly
  // authorised operation that does not exist yet.
  //
  // Dashboard permissions only. A visitor who knows a shared password never
  // holds any of these: visitors have no Supabase Auth user and no
  // TenantAuthorizationContext (src/lib/access/management.ts).
  {
    id: 'members',
    label: 'Access',
    version: '1.1.0',
    status: 'released',
    category: 'engagement',

    platformContract: {
      // ADR-040 §15 — Studio: Content → Access → Protected pages (the same
      // `page` type, filtered), with "New protected page" (protection on).
      // Category is 'engagement', so it needs showUnderContent to appear there.
      showUnderContent: true,
      collections: [
        {
          id: 'access-pages',
          label: 'Access',
          items: [
            {
              id: 'protected-pages',
              label: 'Protected pages',
              schemaType: 'page',
              filter: `_type == "page" && projectSlug == $slug && access.visibility == "restricted"`,
              ordering: [{ field: 'title.en', direction: 'asc' as const }],
              initialValueTemplate: 'pageProtectedProjectOwned',
            },
          ],
        },
      ],
      sectionTypes: [],
      schemaTypes: [],
      schemaDefinitions: () => [],

      permissions: [
        {
          id: 'members.access.read',
          label: 'See access settings',
          description: 'See the access groups, the password names (never the passwords) and how many visitors are signed in.',
          defaultRoles: ['owner'],
        },
        {
          id: 'members.access.manage',
          label: 'Manage access',
          description: 'Create, rename and archive groups; create, change and switch off passwords; sign visitors out.',
          defaultRoles: ['owner'],
        },
      ],

      // Deliberately empty (ADR-014 + ADR-040 §8): everything configurable here
      // is operational data in Supabase, edited in the tenant dashboard's
      // Access screens, never a Sanity field.
      configSchema: [],

      placement: {
        surfaces: [],
        note: 'Lets you protect pages (in Studio, Content → Access) and documents (with the Documents module) for chosen groups of visitors, who unlock them with a password. Groups and passwords are managed in the dashboard, under Access. Switching the module off keeps protected content closed — it never makes it public — and deletes nothing.',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: [],
    },

    dataStore: {
      // Groups, passwords, sessions and documents in Supabase (migration 050);
      // only the page `access` field (B2.2) will live in Sanity.
      primary: 'hybrid',
    },

    changelog: 'V1.1.0 — ADR-040 §15 (R9): documents moved to the Documents module; page protection is set in Studio only; the dashboard Access screen manages groups, passwords and sign-outs. V1.0.0 — ADR-040. Restricted pages (B2.2), sign-in (B2.3), protected PDFs (B2.4), dashboard Access screen (B2.5).',
  },

  // ── Documents ──────────────────────────────────────────────────────────────
  // ADR-040 §15 (R9). The document library: files (PDF, JPEG, PNG, WebP), each
  // available in one, several or all of the site's languages, with a note, a
  // category and tags, and the pages it shows on ("Show on"). A document is
  // for everyone, or — when Access (`members`) is installed too — for one or
  // more groups. Everything lives in Supabase (migrations 050/052/054); the
  // Download section only presents it.
  //
  // Installing, disabling or removing the installation changes ONLY the
  // Sanity record: nothing in Supabase is created or deleted, documents stop
  // being served while it is off (never made public), and management is
  // refused while it is off.
  {
    id: 'documents',
    createAction: { createOrder: 90, permission: 'documents.document.manage', ready: true, href: (slug) => `/${slug}/document-library/new`, },
    label: 'Documents',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      collections: [],
      sectionTypes: ['downloadSection'],
      schemaTypes: ['downloadSection'],
      schemaDefinitions: () => documentsSchemaTypes,

      permissions: [
        {
          id: 'documents.document.read',
          label: 'See documents',
          description: 'See the website\'s documents and on which pages they show.',
          defaultRoles: ['owner'],
        },
        {
          id: 'documents.document.manage',
          label: 'Manage documents',
          description: 'Add, change, place, reorder and archive documents. Choosing groups is possible; managing groups and passwords is not.',
          defaultRoles: ['owner'],
        },
        {
          id: 'documents.document.delete',
          label: 'Delete documents for good',
          description: 'Delete archived documents and their files permanently. Owners only.',
          defaultRoles: ['owner'],
        },
        {
          id: 'documents.taxonomy.write',
          label: 'Manage document categories and tags',
          description: 'Create, rename, reorder and delete the categories and tags of documents.',
          defaultRoles: ['owner'],
        },
      ],

      // Deliberately empty (ADR-014): documents are operational data edited in
      // the dashboard (Documents); the section's own settings are on the section.
      configSchema: [],

      placement: {
        surfaces: [
          { kind: 'sections', description: 'Download section — lists the documents the site placed on that page, per visitor.' },
        ],
        note: 'Documents are added in the dashboard, under Documents, and placed on pages that have a Download section. With Access installed too, a document can be limited to groups; it then shows only on protected pages.',
      },
    },

    // ADR-040 §15 (R9.2): categories and tags of documents, kept in Categories & Tags.
    // The documents (and so the keys) live in Supabase, not Sanity: usage is
    // counted there (`externalUsage`), so a term a document uses is never deleted.
    taxonomies: [
      { kind: 'category', usedBy: [], externalUsage: 'documents' },
      { kind: 'tag', usedBy: [], externalUsage: 'documents' },
    ],

    publicContract: {},

    dependencies: {
      requires: [],
      integratesWith: ['members'],
    },

    dataStore: {
      primary: 'hybrid',
    },

    changelog: 'V1.0.0 — ADR-040 §15 (R9). Document library (public or group documents, languages, note, category, tags, images), placements on pages, Download section.',
  },

  // ── People ─────────────────────────────────────────────────────────────────
  // ADR-043 — one list of people per site, reused everywhere.
  //
  // The module owns `person` documents (public profile, Sanity) and the
  // server-only `person_private` rows (Supabase, migration 063). Placements
  // (team section, post authors, event hosts, schedule instructors) only
  // REFERENCE people — peopleRefsField() / publicId — and the website reads
  // them only through PERSON_PUBLIC_FIELDS.
  //
  // Clients edit in the dashboard (Library → People); Studio is read-only.
  // Groups are this module's taxonomy (Categories & Tags, kind "category").
  // teamSection stays a PLATFORM section (inline members keep rendering
  // without this module); its `people` / `groupFilter` render only where the
  // module is installed.
  {
    id: 'people',
    createAction: { createOrder: 80, permission: 'people.person.write', ready: true, href: (slug) => `/${slug}/people?new=1`, },
    // Public fields only — person_private (contact details etc.) is never searched (ADR-043).
    search: {
      kind: 'people',
      permission: 'people.person.read',
      href: (slug, id) => `/${slug}/people/${id}`,
      listHref: (slug) => `/${slug}/people`,
      source: {
        type: 'sanity',
        docType: 'person',
        site: { visible: PERSON_HAS_PAGE, segment: { moduleId: 'people', configKey: 'profileSegment' } },
        extraFilter: '!defined(anonymisedAt)',
        projection: 'publicId, firstName, lastName, displayName, jobTitle, "thumb": select(photo->projectSlug == $projectSlug => photo->image.asset->url)',
        fields: [
        { name: 'displayName', kind: 'string', weight: 3 },
        { name: 'firstName', kind: 'string', weight: 3 },
        { name: 'lastName', kind: 'string', weight: 3 },
        { name: 'jobTitle', kind: 'localizedString', weight: 2 },
        { name: 'shortBio', kind: 'localizedText', weight: 2 },
        ],
        titleOf: (row) => personDisplayName(row),
        subtitleOf: (row, r) => r.text(row.jobTitle),
      },
    },
    label: 'People',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      collections: [
        {
          id: 'people-module',
          label: 'People',
          items: [
            {
              // Read-only in Studio (ADR-043 D8): no initial value template.
              id: 'people',
              label: 'People',
              schemaType: 'person',
              filter: `_type == "person" && projectSlug == $slug`,
              ordering: [
                { field: 'sortOrder', direction: 'asc' as const },
                { field: 'lastName', direction: 'asc' as const },
              ],
            },
          ],
        },
      ],

      sectionTypes: [],

      schemaTypes: ['personBioText', 'personContact', 'personQualification', 'person'],

      schemaDefinitions: () => peopleSchemaTypes,

      permissions: [
        {
          id: 'people.person.read',
          label: 'View people',
          description: 'View and list the website\'s people, and see where they are shown.',
          defaultRoles: ['owner', 'editor', 'viewer'],
        },
        {
          id: 'people.person.write',
          label: 'Create and edit people',
          description: 'Create people, edit their profiles, reorder and publish them.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'people.person.archive',
          label: 'Archive people',
          description: 'Archive and restore people.',
          defaultRoles: ['owner'],
        },
        {
          id: 'people.person.anonymise',
          label: 'Anonymise people',
          description: 'Remove a person\'s personal data for good (photo, bios, contacts, private data); their place in old content stays empty.',
          defaultRoles: ['owner'],
        },
        {
          id: 'people.person.delete',
          label: 'Delete people',
          description: 'Permanently delete a person who is not used anywhere.',
          defaultRoles: ['owner'],
        },
        {
          id: 'people.taxonomy.write',
          label: 'Manage people groups',
          description: 'Create, rename, reorder and delete the groups people are filed under.',
          defaultRoles: ['owner', 'editor'],
        },
      ],

      configSchema: [
        {
          // ADR-043 D7 — the base path of profile pages is per site and
          // localized (/team, /insegnanti …), never hardcoded. Empty = no
          // profile pages on this site yet.
          id: 'profileSegment',
          label: 'Profile pages URL segment',
          type: 'localizedString',
          validator: 'people.profileSegment',
          description:
            'Where people with their own page live, per language, e.g. "team" gives /team/maria-rossi. Lowercase letters, numbers and single hyphens; it cannot be a word the website already uses. Leave empty for no profile pages.',
        },
      ],

      placement: {
        surfaces: [],
        note: 'People appear through other content: the Team section (hand-picked or by group), blog post authors, event hosts and session instructors, and — when a profile URL segment is set — their own pages.',
      },
    },

    // ADR-043 D3 — Groups ("Dentist", "Yoga Teacher") are this module's
    // vocabulary in Categories & Tags (kind "category"), stored on the person
    // as stable keys.
    taxonomies: [{ kind: 'category', usedBy: [{ type: 'person', field: 'groups' }] }],

    publicContract: {},

    dependencies: {
      requires: [],
      // post.authors, event.hostPeople and schedule instructors reference people.
      integratesWith: ['blog', 'events', 'translate'],
    },

    dataStore: {
      // Public profile in Sanity, private data in Supabase (person_private).
      primary: 'hybrid',
    },

    changelog: 'V1.0.0 — ADR-043 foundation. person documents (public), person_private (Supabase, migration 063), peopleRefsField on team section / posts / events, PERSON_PUBLIC_FIELDS, Groups taxonomy.',
  },


  // ── Courses ────────────────────────────────────────────────────────────────
  // ADR-045 + timetable build spec — weekly classes that generate a calendar.
  //
  // The module owns `course` documents (the words: title, short description,
  // colour; Sanity) and, through scheduling (Supabase, migration 064), the
  // classes of each course. A course is keyed by its `publicId`; teachers are
  // stored on the classes and reference People — never here. Routable
  // (ADR-045 D5): a published course with a slug has its own page at
  // /{courseSegment}/{slug}, the segment being this module's config.
  //
  // Clients edit in the dashboard (Content → Courses); Studio is read-only.
  // The website `timetableSection` (week / month, printable) and
  // `courseListSection` (course cards linking to the course pages) are the
  // module's sections: declared in sectionTypes, so they are gated by the
  // `courses` installation like every module section.
  {
    id: 'courses',
    createAction: { createOrder: 70, permission: 'courses.course.write', ready: true, href: (slug) => `/${slug}/courses?new=1`, },
    // Teacher names live in the Supabase schedule, not on the course document: a course also matches
    // through its teachers (People matches -> courses taught by them, ADR-047 v1.3).
    search: {
      kind: 'courses',
      alsoMatchVia: { via: 'people', reason: 'teacher', idField: 'publicId' },
      permission: 'courses.course.read',
      href: (slug, id) => `/${slug}/courses/${id}`,
      listHref: (slug) => `/${slug}/courses`,
      source: {
        type: 'sanity',
        docType: 'course',
        site: { visible: COURSE_VISIBLE, segment: { moduleId: 'courses', configKey: 'courseSegment' } },
        projection: 'title, shortDescription, "thumb": select(image->projectSlug == $projectSlug => image->image.asset->url)',
        fields: [
        { name: 'title', kind: 'localizedString', weight: 3 },
        { name: 'shortDescription', kind: 'localizedText', weight: 2 },
        ],
        titleOf: (row, r) => r.text(row.title),
        subtitleOf: (row, r) => r.text(row.shortDescription),
      },
    },
    label: 'Courses',
    version: '1.0.0',
    status: 'released',
    category: 'content',

    platformContract: {
      collections: [
        {
          id: 'courses-module',
          label: 'Courses',
          items: [
            {
              // Read-only in Studio (as People): no initial value template.
              id: 'courses',
              label: 'Courses',
              schemaType: 'course',
              filter: `_type == "course" && projectSlug == $slug`,
              ordering: [{ field: '_updatedAt', direction: 'desc' as const }],
            },
          ],
        },
      ],

      sectionTypes: ['timetableSection', 'courseListSection'],

      schemaTypes: ['course', 'timetableNotesText', 'timetableSection', 'courseListSection'],

      schemaDefinitions: () => coursesSchemaTypes,

      permissions: [
        {
          id: 'courses.course.read',
          label: 'View courses',
          description: 'View and list the website\'s courses and their timetable.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'courses.course.write',
          label: 'Create and edit courses',
          description: 'Create courses, edit their words and colour, publish, archive and restore them.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'courses.course.delete',
          label: 'Delete courses',
          description: 'Permanently delete a course that has no classes.',
          defaultRoles: ['owner'],
        },
        {
          id: 'courses.schedule.write',
          label: 'Manage classes and timetable',
          description: 'Add and change weekly classes, cancel or substitute single dates, and set terms and holidays.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'courses.meeting.manage',
          label: 'Manage online meeting details',
          description: 'Create and change the online rooms (link, meeting number, passcode) that online classes use.',
          defaultRoles: ['owner'],
        },
      ],

      configSchema: [
        {
          // ADR-045 D5 — the base path of course pages is per site and
          // localized (/classes, /corsi, /cours …), never hardcoded. Empty =
          // no course pages on this site yet.
          id: 'courseSegment',
          label: 'Course pages URL segment',
          type: 'localizedString',
          validator: 'courses.courseSegment',
          description:
            'Where each published course gets its own page, per language, e.g. "classes" gives /classes/iyengar-yoga ("corsi", "cours", "kurse" …). Lowercase letters, numbers and single hyphens; it cannot be a word the website already uses (e.g. "courses" is taken by the dashboard). Leave empty for no course pages.',
        },
      ],

      placement: {
        surfaces: [],
        note: 'Courses appear on the website through the Timetable section (week or month view, printable), the Course List section and — when a course URL segment is set — each published course\'s own page.',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      // Classes name teachers from People; events and courses share the scheduling engine.
      integratesWith: ['people', 'events'],
    },

    dataStore: {
      // Words in Sanity, classes / terms / closures / meeting rooms in Supabase (migration 064).
      primary: 'hybrid',
    },

    changelog: 'V1.0.0 — ADR-045 foundation. course documents (words, colour, archive), courses.* permissions, Courses list and editor in the dashboard. Timetable section (week / month, print sheet).',
  },

  // ── Reservations ───────────────────────────────────────────────────────────
  // ADR-044. Bookings, passes, holds and offline payments for events and
  // courses. FOUNDATION ONLY: no sections, no Sanity schema types, no
  // navigation yet. All data is operational (Supabase, migration 066); the
  // dashboard (Bookings) is built later.
  //
  // Not gated by and not coupled to Courses or Events: those CONSUME this
  // module later (reservations target sessions by id, ADR-038 D9), so it is
  // installable on its own and `requires` stays empty.
  //
  // Configuration split (ADR-014, D13): this pane holds only the CAPABILITIES
  // (what the site can use), read through resolveReservationCapabilities()
  // (reservations/capabilities.ts). The tenant's values live in
  // `reservation_settings`, edited in dashboard → Bookings → Booking rules.
  // Stripe and reminders are locked off in code, not config fields.
  {
    id: 'reservations',
    // TODO(createAction): no create action yet — the booking form is not built (ADR-044).
    label: 'Reservations',
    version: '1.0.0',
    status: 'released',
    category: 'commerce',

    platformContract: {
      collections: [],
      sectionTypes: [],
      schemaTypes: [],
      schemaDefinitions: () => [],

      // ADR-044 D12. Payment, refund, export and settings are in
      // SUPPORT_NEVER_WRITES; `reservations.booking.*` is hidden in support
      // mode (support/state.ts). booking.read and payment.update are
      // grantable extras (authz/permissions.ts, migration 066).
      permissions: [
        {
          id: 'reservations.booking.read',
          label: 'See bookings',
          description: 'See the website\'s bookings, passes and rosters.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'reservations.booking.write',
          label: 'Manage bookings',
          description: 'Add manual bookings, cancel bookings, record absences, and extend or release holds.',
          defaultRoles: ['owner', 'editor'],
        },
        {
          id: 'reservations.booking.delete',
          label: 'Delete bookings',
          description: 'Anonymise or delete bookings according to the retention rules.',
          defaultRoles: ['owner'],
        },
        {
          id: 'reservations.payment.update',
          label: 'Record payments',
          description: 'Record payments and confirm bookings that were paid (for example by bank transfer).',
          defaultRoles: ['owner'],
        },
        {
          id: 'reservations.refund.manage',
          label: 'Manage refunds',
          description: 'Record and change refunds.',
          defaultRoles: ['owner'],
        },
        {
          id: 'reservations.capacity.manage',
          label: 'Override capacity',
          description: 'Book people beyond the number of places.',
          defaultRoles: ['owner'],
        },
        {
          id: 'reservations.export.use',
          label: 'Export bookings',
          description: 'Download bookings and rosters as a file.',
          defaultRoles: ['owner'],
        },
        {
          id: 'reservations.settings.manage',
          label: 'Manage booking rules',
          description: 'Change the Booking rules: deadlines, price categories, pass rules and notifications.',
          defaultRoles: ['owner'],
        },
      ],

      configSchema: [
        // ── Capabilities (ADR-044 D13) — read only through resolveReservationCapabilities().
        {
          id: 'capOfflinePayments',
          label: 'Offline payments',
          type: 'boolean',
          initialValue: true,
          description: 'People can book and pay later, for example by bank transfer; the organiser confirms the payment by hand. Switching a capability off never deletes or changes existing bookings.',
        },
        {
          id: 'capPriceCategories',
          label: 'Price categories',
          type: 'boolean',
          initialValue: false,
          description: 'The client can offer different prices for different people, for example member and non-member. The categories are managed in Booking rules.',
        },
        {
          id: 'capPasses',
          label: 'Passes',
          type: 'boolean',
          initialValue: false,
          description: 'The client can sell passes: the right to attend chosen courses, never a reserved place. The pass options below only apply when this is on.',
        },
        {
          id: 'capPassEntries',
          label: 'Pass entries',
          type: 'boolean',
          initialValue: false,
          showWhen: { field: 'capPasses', equals: true },
          description: 'A pass can have a number of entries (for example a 10-class card).',
        },
        {
          id: 'capPassFixedEnd',
          label: 'Pass valid until a fixed date',
          type: 'boolean',
          initialValue: false,
          showWhen: { field: 'capPasses', equals: true },
          description: 'A pass can be valid until a fixed date (for example 31 December), with the price depending on the joining date.',
        },
        {
          id: 'capPassDuration',
          label: 'Pass valid for a duration',
          type: 'boolean',
          initialValue: false,
          showWhen: { field: 'capPasses', equals: true },
          description: 'A pass can be valid for a period from its start date (for example 1, 6 or 12 months).',
        },
        {
          id: 'capPassSignUp',
          label: 'Pass holder sign-up',
          type: 'select',
          initialValue: 'off',
          showWhen: { field: 'capPasses', equals: true },
          options: [
            { value: 'off', label: 'Off', description: 'Pass holders just come to class. No sign-up.' },
            { value: 'opt_in', label: 'Opt-in', description: 'Pass holders can answer "I\'m coming" for a class. The client chooses per class whether to use it.' },
          ],
          description: 'How pass holders can tell the organiser they attend a class.',
        },
        {
          id: 'capMembershipRequirement',
          label: 'Membership requirement',
          type: 'boolean',
          initialValue: false,
          description: 'A booking option can require membership. Until the Memberships module exists, people declare it themselves and the organiser reviews it.',
        },
        {
          id: 'capAbsenceNotice',
          label: 'Absence notice',
          type: 'boolean',
          initialValue: false,
          description: 'People can tell the organiser they cannot come, and the client can record absences.',
        },
        {
          id: 'capMinimumParticipants',
          label: 'Minimum participants',
          type: 'boolean',
          initialValue: false,
          description: 'The client can set a minimum number of participants for a course or event.',
        },
      ],

      placement: {
        surfaces: [],
        note: 'Lets people book and pay for events and courses, and hold passes. Bookings are managed in the dashboard, under Bookings (coming soon). The website shows booking sections only once they are built. Online payment (Stripe) and reminder emails are not available yet.',
      },
    },

    publicContract: {},

    dependencies: {
      requires: [],
      // Consumers: events and courses target sessions by id (ADR-038 D9, ADR-044).
      integratesWith: ['events', 'courses', 'people'],
    },

    dataStore: {
      // Bookings, attendees, passes, payments, outbox: Supabase only (migration 066).
      primary: 'operational',
    },

    changelog: 'V1.0.0 — ADR-044 foundation. reservations.* permissions and Studio capabilities. No sections, schema types or navigation yet.',
  },

]

// ── Build-time validation ─────────────────────────────────────────────────────
// Runs at module load time. Throws with a human-readable diagnostic if any
// manifest violates the structural rules defined in validate.ts.
// A throw here propagates as a build error in Next.js and Sanity Studio.
validateRegistry(MODULE_REGISTRY)

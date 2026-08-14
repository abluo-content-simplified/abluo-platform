import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes, initialValueTemplates } from './src/lib/sanity/schema'
import { MODULE_REGISTRY } from './src/lib/modules'
import { buildCollectionItems } from './src/lib/modules/navigation'
import { DesignSystemPreview } from './src/sanity/components/DesignSystemPreview'
import { DesignSystemAssignPane } from './src/sanity/components/DesignSystemAssignPane'
import { ExportDesignSystemAction } from './src/sanity/actions/ExportDesignSystemAction'
import { ImportDesignSystemAction } from './src/sanity/actions/ImportDesignSystemAction'
import { DuplicateDesignSystemAction } from './src/sanity/actions/DuplicateDesignSystemAction'
import { AutoCreateSiteConfigAction } from './src/sanity/actions/AutoCreateSiteConfigAction'
// ADR-011 Phase C1 — Project Settings Shell
import { ModuleList } from './src/lib/sanity/studio/ModuleList'
import { StubPane } from './src/lib/sanity/studio/StubPane'
// ADR-014 Phase B — Integrations & Privacy panes
import { IntegrationsPane } from './src/lib/sanity/studio/IntegrationsPane'
import { PrivacyPane } from './src/lib/sanity/studio/PrivacyPane'

// Hardcoded to match src/lib/sanity/client.ts — avoids env var dependency in the Studio
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '3n7t84j3'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'

export default defineConfig({
  name: 'abluo',
  title: 'Abluo Studio',

  projectId,
  dataset,

  plugins: [
    structureTool({
      structure: async (S, context) => {
        const client = context.getClient({ apiVersion: '2026-05-21' })

        // ── Fetch clients + projects (with enabled modules) ───────────────────
        // ADR-020: moduleInstallations is now the ONLY source of installed-module
        // state. The legacy `enabledModules` string array is no longer read here
        // — migration 004 backfilled typed installation records for every project
        // that had one, so the fallback had nothing left to serve. The field
        // itself remains declared on the project document as a rollback bridge
        // (see src/lib/sanity/schema.ts) until production has been promoted.
        //
        // A project with no installations resolves to [] — "no modules installed"
        // — which is the correct answer for a fresh website, and is exactly what
        // the Modules pane lets an admin change.
        const clients = await client.fetch<{
          _id: string
          displayName: string
          tenantSlug: string
          projects: {
            _id: string
            projectName: string
            projectSlug: string
            designSystemId?: string
            enabledModuleIds: string[]
          }[]
        }[]>(
          `*[_type == "client" && !(_id in path("drafts.**"))] | order(displayName asc) {
            _id,
            displayName,
            tenantSlug,
            "projects": *[_type == "project" && !(_id in path("drafts.**")) && clientRef._ref == ^._id] | order(projectName asc) {
              _id,
              projectName,
              projectSlug,
              "designSystemId": designSystemRef._ref,
              "enabledModuleIds": coalesce(moduleInstallations[enabled != false].moduleId, [])
            }
          }`
        )

        // ── Fetch all page-type documents (for flat Pages section) ─────────────
        // Includes page, blogPage, eventsPage, livePage across all projects.
        // Used to build individual S.document() items — no intermediate folders.
        //
        // ADMIN UI LANGUAGE (ADR-010):
        // displayTitle is resolved English-first (coalesce en → it). This is the
        // Admin UI language, not the project's content locale. Studio navigation
        // labels must remain stable regardless of which content language the editor
        // is currently editing — they are not website content.
        //
        // English is the current Admin UI language. When the Admin UI language
        // becomes user-configurable, this coalesce should become:
        //   coalesce(title[$adminLocale], title.en, title.it, …)
        // The English-first fallback is correct interim behaviour, not a hardcoded
        // permanent constraint.
        //
        // NOTE: displayTitle is used only for general `page` documents. Module
        // singleton pages (blogPage, eventsPage, livePage) use MODULE_REGISTRY
        // labels and ignore displayTitle entirely.
        const allPageDocs = await client.fetch<{
          _id: string
          _type: string
          displayTitle: string | null
          projectSlug: string
        }[]>(
          `*[
            _type in ["page", "blogPage", "eventsPage", "livePage", "newsPage"]
            && !(_id in path("drafts.**"))
            && defined(projectSlug)
          ] | order(_createdAt asc) {
            _id,
            _type,
            "displayTitle": coalesce(title.en, title.it, heroTitle.en, heroTitle.it),
            projectSlug
          }`
        )

        // Index page docs by projectSlug for O(1) lookup per project
        const pageDocsByProject = new Map<string, typeof allPageDocs>()
        for (const doc of allPageDocs) {
          const list = pageDocsByProject.get(doc.projectSlug) ?? []
          list.push(doc)
          pageDocsByProject.set(doc.projectSlug, list)
        }

        // ── Fetch all design systems ───────────────────────────────────────────
        const designSystems = await client.fetch<{
          _id: string
          name?: string
          projectSlug?: string
          role?: string
        }[]>(
          `*[_type == "designSystem" && !(_id in path("drafts.**"))] | order(name asc) {
            _id, name, projectSlug, role
          }`
        )

        // ── Module registry ───────────────────────────────────────────────────
        // Imported from src/lib/modules/registry.ts (ADR-011 Phase A1).
        // MODULE_REGISTRY is now a platform-level export accessible to all surfaces.
        // See registry.ts for the full definition and documentation.

        // ── Design system pane builder ────────────────────────────────────────
        //
        // ADR-020 Decision 4 merges the old "Change Design System" sibling item
        // into this pane as a third view. Passing projectId/projectSlug is what
        // makes that possible — without them the assign pane cannot know which
        // project it is reassigning.
        //
        // Called in two places: the per-project Design System entry (with the
        // project context, so all three views appear) and the global Design
        // Systems section (without it, where "change assignment" is meaningless
        // because no single project is in scope).
        function designSystemPane(documentId: string, projectId?: string, projectSlug?: string) {
          const views = [
            S.view.form().title('Edit'),
            S.view.component(DesignSystemPreview).title('Preview'),
          ]

          if (projectId && projectSlug) {
            views.push(
              S.view
                .component(DesignSystemAssignPane)
                .options({ projectId, projectSlug, currentDSId: documentId })
                .title('Change')
            )
          }

          return S.document()
            .documentId(documentId)
            .schemaType('designSystem')
            .views(views)
        }

        // ── Content section builder ───────────────────────────────────────────
        // ADR-020 Amendment B.
        //
        // Content holds ONLY content — no settings, no configuration, nothing to
        // define. Activate a module in Modules and its content group appears
        // here; deactivate it and the group disappears (its documents are
        // untouched and return unchanged).
        //
        //   Content
        //     Pages          general pages only
        //     Blog           Blog Page · Posts · Authors      (active modules only)
        //     News           News Page · News
        //     Events         Events Page · Events
        //     Live           Live Page
        //     Media
        //
        // A module qualifies for a Content group when it has a singleton page —
        // `platformContract.pageType`. That is exactly Blog/News/Events/Live and
        // excludes Forms and WhatsApp, whose documents are configuration rather
        // than content. Using `category === 'content'` instead would wrongly drop
        // Live, which is categorised 'engagement'.

        /** General `page` documents, opened in one click. */
        function buildGeneralPageItems(pageDocs: typeof allPageDocs) {
          // STUDIO LABEL FOR GENERAL PAGES (ADR-010):
          // General `page` documents use their `title` content field as the
          // Studio label — the editor named the page "Contact", so the nav shows
          // "Contact". Not a permanent rule: if an `internalTitle` field is ever
          // added, switch to it here.
          return pageDocs
            .filter((d) => d._type === 'page')
            .map((p) =>
              S.listItem()
                .id(`page-${p._id}`)
                .title(p.displayTitle ?? 'Untitled')
                .child(S.document().documentId(p._id).schemaType('page'))
            )
        }

        /**
         * The module's singleton page item — its hero, intro and SEO.
         *
         * Falls back to a filtered document list with a create template when the
         * document does not exist yet. That fallback is load-bearing: these page
         * types are filtered out of the global "+" menu, so without it a missing
         * module page would be uncreatable.
         */
        function buildModulePageItem(slug: string, mod: (typeof MODULE_REGISTRY)[number], pageDocs: typeof allPageDocs) {
          const pageType = mod.platformContract.pageType
          if (!pageType) return null

          const doc = pageDocs.find((d) => d._type === pageType)
          const title = `${mod.label} Page`

          return doc
            ? S.listItem()
                .id(`${slug}-${mod.id}-page`)
                .title(title)
                .child(S.document().documentId(doc._id).schemaType(pageType))
            : S.listItem()
                .id(`${slug}-${mod.id}-page`)
                .title(title)
                .child(
                  S.documentList()
                    .title(title)
                    .schemaType(pageType)
                    .apiVersion('2026-05-21')
                    .filter(`_type == "${pageType}" && projectSlug == $slug`)
                    .params({ slug })
                    .initialValueTemplates([
                      S.initialValueTemplateItem(`${mod.id}PageProjectOwned`, { projectSlug: slug }),
                    ])
                )
        }

        /** Content: Pages, one group per active content module, then Media. */
        function buildContentItems(
          slug: string,
          tenantSlug: string,
          clientId: string,
          enabledModuleIds: string[],
          pageDocs: typeof allPageDocs
        ) {
          const items: (ReturnType<typeof S.listItem> | ReturnType<typeof S.divider>)[] = [
            S.listItem()
              .id(`${slug}-pages`)
              .title('Pages')
              .child(
                S.list()
                  .id(`${slug}-pages-list`)
                  .title('Pages')
                  .items(buildGeneralPageItems(pageDocs))
              ),
          ]

          const contentModules = MODULE_REGISTRY.filter(
            (m) => !!m.platformContract.pageType && enabledModuleIds.includes(m.id)
          )

          for (const mod of contentModules) {
            const children: ReturnType<typeof S.listItem>[] = []

            const pageItem = buildModulePageItem(slug, mod, pageDocs)
            if (pageItem) children.push(pageItem)
            children.push(...buildCollectionItems(slug, tenantSlug, S, mod))

            if (children.length === 0) continue

            items.push(
              S.listItem()
                .id(`${slug}-content-${mod.id}`)
                .title(mod.label)
                .child(
                  S.list()
                    .id(`${slug}-content-${mod.id}-list`)
                    .title(mod.label)
                    .items(children)
                )
            )
          }

          items.push(
            S.listItem()
              .id(`${slug}-media`)
              .title('Media')
              .schemaType('mediaAsset')
              .child(
                S.documentList()
                  .title('Media')
                  .apiVersion('2026-05-21')
                  // Tenant-scoped, unlike everything else here: media is shared
                  // across a client's websites.
                  .filter(`_type == "mediaAsset" && tenant._ref == $clientId`)
                  .params({ clientId })
                  .defaultOrdering([{ field: '_createdAt', direction: 'desc' }])
              )
          )

          return items
        }

        // ── Modules section builder ───────────────────────────────────────────
        // Every module entry opens its settings pane DIRECTLY — no "Settings"
        // child anywhere. One rule, no exceptions: Modules → X is one pane
        // holding everything for that module; Content → X is the documents you
        // write in.
        //
        // All modules are listed, active or not, so one can be switched on. The
        // "— off" suffix is the at-a-glance status the old index pane carried.
        function buildModuleItems(slug: string, projectDocId: string, enabledModuleIds: string[]) {
          return MODULE_REGISTRY.map((mod) =>
            S.listItem()
              .id(`${slug}-module-${mod.id}`)
              .title(enabledModuleIds.includes(mod.id) ? mod.label : `${mod.label} — off`)
              .child(
                S.component(ModuleList)
                  .id(`${slug}-module-${mod.id}-pane`)
                  .title(mod.label)
                  .options({ projectId: projectDocId, projectSlug: slug, moduleId: mod.id })
              )
          )
        }

        // ── Client items ──────────────────────────────────────────────────────
        const clientItems = clients.map((clientDoc) => {
          const clientLabel = clientDoc.displayName ?? clientDoc.tenantSlug
          const clientId = clientDoc._id

          const projectItems = clientDoc.projects.map((project) => {
            const slug = project.projectSlug
            const projectLabel = project.projectName ?? slug
            const designSystemId = project.designSystemId
            const enabledModuleIds = project.enabledModuleIds
            const projectPageDocs = pageDocsByProject.get(slug) ?? []

            return S.listItem()
              .id(`project-${slug}`)
              .title(projectLabel)
              .child(
                S.list()
                  .id(`project-${slug}-list`)
                  .title(projectLabel)
                  .items([

                    // ── Content ──────────────────────────────────────────────
                    // Content only: Pages, the active content modules, Media.
                    S.listItem()
                      .id(`${slug}-content`)
                      .title('Content')
                      .child(
                        S.list()
                          .id(`${slug}-content-list`)
                          .title('Content')
                          .items(
                            buildContentItems(
                              slug,
                              clientDoc.tenantSlug,
                              clientId,
                              enabledModuleIds,
                              projectPageDocs
                            )
                          )
                      ),

                    S.divider(),

                    // ── Design System ────────────────────────────────────────
                    // ADR-020 Decision 4 — a SINGLE entry. The separate "Change
                    // Design System" item is merged in as a third view on the
                    // same pane, so assigning and editing are one destination
                    // instead of two sibling items that looked like two features.
                    //
                    // Unassigned projects have nothing to edit yet, so the entry
                    // opens the assign pane directly.
                    S.listItem()
                      .id(`${slug}-design`)
                      .title('Design System')
                      .child(
                        designSystemId
                          ? designSystemPane(designSystemId, project._id, slug)
                          : S.component(DesignSystemAssignPane)
                              .id(`${slug}-design-assign`)
                              .title('Assign Design System')
                              .options({ projectId: project._id, projectSlug: slug })
                      ),

                    S.divider(),

                    // ── Modules ──────────────────────────────────────────────
                    // ADR-020 Decision 1 + 4 — modules are a first-class per-website
                    // capability, so they are a top-level entry here rather than a
                    // row buried inside Project Settings. Enable/disable, per-module
                    // configuration, and placement all live in this pane.
                    S.listItem()
                      .id(`${slug}-modules`)
                      .title('Modules')
                      .child(
                        S.list()
                          .id(`${slug}-modules-list`)
                          .title('Modules')
                          .items(buildModuleItems(slug, project._id, enabledModuleIds))
                      ),

                    S.divider(),

                    // ── Website Settings ─────────────────────────────────────
                    // siteConfig: true website properties — identity, SEO, locales,
                    // navigation, social links, website behaviour. Module and
                    // communications config does NOT belong here (ADR-020
                    // Decision 2); it lives in the Modules pane above.
                    S.listItem()
                      .id(`${slug}-website-settings`)
                      .title('Website Settings')
                      .child(
                        S.documentList()
                          .title('Website Settings')
                          .schemaType('siteConfig')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "siteConfig" && projectSlug == $slug`)
                          .params({ slug })
                          .initialValueTemplates([
                            S.initialValueTemplateItem('siteConfigProjectOwned', { projectSlug: slug }),
                          ])
                      ),

                    // ── Project Settings ─────────────────────────────────────
                    // ADR-011 Phase C1: dedicated settings pane per project.
                    // Flat list of named sections — adding a future section
                    // requires only appending another list item here.
                    S.listItem()
                      .id(`${slug}-project-settings`)
                      .title('Project Settings')
                      .child(
                        S.list()
                          .id(`${slug}-project-settings-list`)
                          .title('Project Settings')
                          .items([

                            // General — raw project document form.
                            // Hosts ProjectLinker (client link, DS assignment,
                            // Supabase link). Must remain accessible here to
                            // avoid a regression. (Phase Review Finding 1.)
                            S.listItem()
                              .id(`${slug}-settings-general`)
                              .title('General')
                              .child(
                                S.document()
                                  .documentId(project._id)
                                  .schemaType('project')
                                  .title('General')
                              ),

                            S.divider(),

                            // Modules moved OUT of Project Settings in ADR-020.
                            // Project Settings is account infrastructure (domains,
                            // billing, integrations, privacy, notifications);
                            // modules are a per-website capability and now have a
                            // top-level entry of their own above.

                            // Locales: configured in Website Settings → Languages only (ADR-014 one-surface; stub removed as Phase B completion)

                            // Domains — placeholder (C1 stub).
                            S.listItem()
                              .id(`${slug}-settings-domains`)
                              .title('Domains')
                              .child(
                                S.component(StubPane)
                                  .id(`${slug}-settings-domains-pane`)
                                  .title('Domains')
                                  .options({ label: 'Domains', message: 'Domain management is coming in a future release.' })
                              ),

                            // Billing — placeholder (C1 stub).
                            S.listItem()
                              .id(`${slug}-settings-billing`)
                              .title('Billing')
                              .child(
                                S.component(StubPane)
                                  .id(`${slug}-settings-billing-pane`)
                                  .title('Billing')
                                  .options({ label: 'Billing', message: 'Billing management is coming in a future release.' })
                              ),

                            // Integrations — ADR-014 Phase B.
                            S.listItem()
                              .id(`${slug}-settings-integrations`)
                              .title('Integrations')
                              .child(
                                S.component(IntegrationsPane)
                                  .id(`${slug}-settings-integrations-pane`)
                                  .title('Integrations')
                                  .options({ projectId: project._id, projectSlug: slug })
                              ),

                            // Privacy — ADR-014 Phase B.
                            S.listItem()
                              .id(`${slug}-settings-privacy`)
                              .title('Privacy')
                              .child(
                                S.component(PrivacyPane)
                                  .id(`${slug}-settings-privacy-pane`)
                                  .title('Privacy')
                                  .options({ projectId: project._id, projectSlug: slug })
                              ),

                            // Notifications — ADR-019. Recipient management
                            // (project.notifications.recipients). Opens the
                            // project doc form; the Notifications field is edited here.
                            S.listItem()
                              .id(`${slug}-settings-notifications`)
                              .title('Notifications')
                              .child(
                                S.document()
                                  .documentId(project._id)
                                  .schemaType('project')
                                  .title('Notifications')
                              ),

                          ])
                      ),

                  ])
              )
          })

          return S.listItem()
            .id(`client-${clientId}`)
            .title(clientLabel)
            .child(
              S.list()
                .id(`client-${clientId}-list`)
                .title(clientLabel)
                .items(projectItems)
            )
        })

        // ── Design system items ───────────────────────────────────────────────
        const designSystemItems = designSystems.map((ds) => {
          const isTemplate = ds.role === 'template'
          const label = ds.name ?? ds.projectSlug ?? 'Untitled'
          const subtitle = isTemplate ? 'Template · Not assigned' : `Active · ${ds.projectSlug ?? ''}`

          return S.listItem()
            .id(`ds-${ds._id}`)
            .title(`${label} — ${subtitle}`)
            .child(designSystemPane(ds._id))
        })

        // ── Root structure ────────────────────────────────────────────────────
        return S.list()
          .id('root')
          .title('Abluo')
          .items([

            S.listItem()
              .id('section-clients')
              .title('Clients')
              .child(
                S.list()
                  .id('clients-root')
                  .title('Clients')
                  .items(clientItems)
              ),

            S.divider(),

            S.listItem()
              .id('section-design-systems')
              .title('Design Systems')
              .child(
                S.list()
                  .id('design-systems-root')
                  .title('Design Systems')
                  .items(designSystemItems)
              ),

            S.listItem()
              .id('section-media-library')
              .title('Media Library')
              .child(
                S.documentList()
                  .title('All Media Assets')
                  .apiVersion('2026-05-21')
                  .filter('_type == "mediaAsset"')
              ),

            S.divider(),

            S.listItem()
              .id('section-unassigned')
              .title('Unassigned Content')
              .child(
                S.list()
                  .id('unassigned-root')
                  .title('Unassigned Content')
                  .items([
                    S.listItem()
                      .id('unassigned-pages')
                      .title('Pages without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Pages')
                          .apiVersion('2026-05-21')
                          .filter('_type == "page" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-homepages')
                      .title('Legacy Home Pages')
                      .child(
                        S.documentList()
                          .title('Legacy Home Pages')
                          .apiVersion('2026-05-21')
                          .filter('_type == "homePage"')
                      ),
                    S.listItem()
                      .id('unassigned-posts')
                      .title('Posts without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Posts')
                          .apiVersion('2026-05-21')
                          .filter('_type == "post" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-categories')
                      .title('Categories without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Categories')
                          .apiVersion('2026-05-21')
                          .filter('_type == "blogCategory" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-authors')
                      .title('Authors without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Authors')
                          .apiVersion('2026-05-21')
                          .filter('_type == "postAuthor" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-events')
                      .title('Events without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Events')
                          .apiVersion('2026-05-21')
                          .filter('_type == "event" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-siteconfigs')
                      .title('Site Configs without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Site Configs')
                          .apiVersion('2026-05-21')
                          .filter('_type == "siteConfig" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-livepages')
                      .title('Live Pages without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Live Pages')
                          .apiVersion('2026-05-21')
                          .filter('_type == "livePage" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-eventspages')
                      .title('Events Pages without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Events Pages')
                          .apiVersion('2026-05-21')
                          .filter('_type == "eventsPage" && (projectSlug == null || projectSlug == "")')
                      ),
                    S.listItem()
                      .id('unassigned-blogpages')
                      .title('Blog Pages without Project')
                      .child(
                        S.documentList()
                          .title('Unassigned Blog Pages')
                          .apiVersion('2026-05-21')
                          .filter('_type == "blogPage" && (projectSlug == null || projectSlug == "")')
                      ),
                  ])
              ),

          ])
      },
    }),
  ],

  schema: {
    types: schemaTypes,
    templates: initialValueTemplates,
  },

  // ── Document config ───────────────────────────────────────────────────────────
  document: {
    // Export / Import / Duplicate actions — scoped to designSystem documents only.
    actions: (prev, context) => {
      if (context.schemaType === 'designSystem') {
        // Remove the built-in Duplicate — our custom one always creates unassigned copies.
        const filtered = prev.filter((action) => action.action !== 'duplicate')
        return [...filtered, ExportDesignSystemAction, ImportDesignSystemAction, DuplicateDesignSystemAction]
      }
      if (context.schemaType === 'project') {
        // Replace the built-in Publish with our wrapper that auto-bootstraps
        // a minimal siteConfig on first publish of a linked project.
        return prev.map((action) =>
          action.action === 'publish' ? AutoCreateSiteConfigAction : action
        )
      }
      return prev
    },

    // Plus menu: hide legacy/internal types.
    // Note: Sanity always re-sorts the menu alphabetically in the UI layer —
    // custom ordering via newDocumentOptions is not possible. Filter only.
    newDocumentOptions: (prev) =>
      prev.filter((opt) => !['homePage', 'homePageProjectOwned', 'livePageProjectOwned', 'eventsPageProjectOwned', 'blogPageProjectOwned', 'newsPageProjectOwned'].includes(opt.templateId)),
  },
})

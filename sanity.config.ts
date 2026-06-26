import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes, initialValueTemplates } from './src/lib/sanity/schema'
import { MODULE_REGISTRY } from './src/lib/modules'
import { DesignSystemPreview } from './src/sanity/components/DesignSystemPreview'
import { DesignSystemAssignPane } from './src/sanity/components/DesignSystemAssignPane'
import { ExportDesignSystemAction } from './src/sanity/actions/ExportDesignSystemAction'
import { ImportDesignSystemAction } from './src/sanity/actions/ImportDesignSystemAction'
import { DuplicateDesignSystemAction } from './src/sanity/actions/DuplicateDesignSystemAction'
import { AutoCreateSiteConfigAction } from './src/sanity/actions/AutoCreateSiteConfigAction'

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
        // ADR-011 Phase B1: enabledModuleIds is a unified string[] projection.
        // For migrated projects: derived from moduleInstallations[enabled != false].moduleId.
        // For unmigrated projects: falls back to coalesce(enabledModules, []).
        // The structure builder never needs to know which source was used.
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
              "enabledModuleIds": select(
                defined(moduleInstallations) && count(moduleInstallations) > 0 => moduleInstallations[enabled != false].moduleId,
                coalesce(enabledModules, [])
              )
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
            _type in ["page", "blogPage", "eventsPage", "livePage"]
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
        function designSystemPane(documentId: string) {
          return S.document()
            .documentId(documentId)
            .schemaType('designSystem')
            .views([
              S.view.form().title('Edit'),
              S.view.component(DesignSystemPreview).title('Preview'),
            ])
        }

        // ── Pages section builder ─────────────────────────────────────────────
        // Produces a flat list of individual document items — no folders, no
        // document-type labels. Schema types are an implementation detail.
        //
        // Layout:
        //   1. General pages (schema type: "page") — in creation order
        //   2. Module singleton pages — in module registry order, enabled modules only
        //
        // Each item uses S.document() with the actual document ID so the editor
        // lands directly on the document with a single click.
        //
        // Fallback for a module page that has no published document yet:
        //   S.documentList() scoped to that type — shows a "Create new" button.
        function buildPagesItems(
          slug: string,
          enabledModuleIds: string[],
          pageDocs: typeof allPageDocs
        ) {
          const items: ReturnType<typeof S.listItem>[] = []

          // 1. General pages
          // STUDIO LABEL FOR GENERAL PAGES (ADR-010):
          // General `page` documents are created by editors and currently use
          // their `title` content field as the Studio navigation label. This is
          // an intentional choice — the editor named the page "Contact", so
          // the Studio nav shows "Contact".
          //
          // This is NOT a permanent architectural rule. If Abluo introduces an
          // `internalTitle` or `studioLabel` field on `page` documents (to decouple
          // the Studio label from the website H1), switch to using that field here
          // instead of displayTitle. The comment is the signal to future implementors.
          const generalPages = pageDocs.filter((d) => d._type === 'page')
          for (const p of generalPages) {
            items.push(
              S.listItem()
                .id(`page-${p._id}`)
                .title(p.displayTitle ?? 'Untitled')
                .child(S.document().documentId(p._id).schemaType('page'))
            )
          }

          // 2. Module singleton pages (enabled modules only)
          const enabledDefs = MODULE_REGISTRY.filter((m) => enabledModuleIds.includes(m.id))
          for (const mod of enabledDefs) {
            const pageType = mod.platformContract.pageType
            if (!pageType) continue
            const doc = pageDocs.find((d) => d._type === pageType)
            if (doc) {
              // Document exists — open directly (one click)
              items.push(
                S.listItem()
                  .id(`${slug}-${mod.id}-page`)
                  .title(mod.label)
                  .child(S.document().documentId(doc._id).schemaType(pageType))
              )
            } else {
              // Document not yet created — show a list that offers "New document"
              items.push(
                S.listItem()
                  .id(`${slug}-${mod.id}-page`)
                  .title(mod.label)
                  .child(
                    S.documentList()
                      .title(mod.label)
                      .schemaType(pageType)
                      .apiVersion('2026-05-21')
                      .filter(`_type == "${pageType}" && projectSlug == $slug`)
                      .params({ slug })
                      .initialValueTemplates([
                        S.initialValueTemplateItem(`${mod.id}PageProjectOwned`, { projectSlug: slug }),
                      ])
                  )
              )
            }
          }

          return items
        }

        // ── Collections section builder ───────────────────────────────────────
        // Only includes collection groups for enabled modules.
        // Inserts dividers between groups automatically.
        function buildCollectionsItems(slug: string, enabledModuleIds: string[]) {
          const enabledDefs = MODULE_REGISTRY.filter((m) => enabledModuleIds.includes(m.id))
          const groups: ReturnType<typeof S.listItem>[][] = enabledDefs
            .map((m) => m.platformContract.collectionItems({ slug, S }))
            .filter((g) => g.length > 0)

          // Interleave dividers between groups
          const items: (ReturnType<typeof S.listItem> | ReturnType<typeof S.divider>)[] = []
          for (let i = 0; i < groups.length; i++) {
            if (i > 0) items.push(S.divider())
            items.push(...groups[i])
          }
          return items
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

            const collectionItems = buildCollectionsItems(slug, enabledModuleIds)

            return S.listItem()
              .id(`project-${slug}`)
              .title(projectLabel)
              .child(
                S.list()
                  .id(`project-${slug}-list`)
                  .title(projectLabel)
                  .items([

                    // ── Pages ────────────────────────────────────────────────
                    // Flat list: every page in one place, no schema-type folders.
                    S.listItem()
                      .id(`${slug}-pages`)
                      .title('Pages')
                      .child(
                        S.list()
                          .id(`${slug}-pages-list`)
                          .title('Pages')
                          .items(buildPagesItems(slug, enabledModuleIds, projectPageDocs))
                      ),

                    S.divider(),

                    // ── Collections ──────────────────────────────────────────
                    // Only modules enabled for this project.
                    // Grouped by module — add new modules to MODULE_REGISTRY above.
                    ...(collectionItems.length > 0 ? [
                      S.listItem()
                        .id(`${slug}-collections`)
                        .title('Collections')
                        .child(
                          S.list()
                            .id(`${slug}-collections-list`)
                            .title('Collections')
                            .items(collectionItems)
                        ),
                      S.divider(),
                    ] : []),

                    // ── Media ────────────────────────────────────────────────
                    S.listItem()
                      .id(`${slug}-media`)
                      .title('Media')
                      .schemaType('mediaAsset')
                      .child(
                        S.documentList()
                          .title('Media')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "mediaAsset" && tenant._ref == $clientId`)
                          .params({ clientId })
                          .defaultOrdering([{ field: '_createdAt', direction: 'desc' }])
                      ),

                    S.divider(),

                    // ── Design System ────────────────────────────────────────
                    S.listItem()
                      .id(`${slug}-design`)
                      .title('Design System')
                      .child(
                        designSystemId
                          ? designSystemPane(designSystemId)
                          : S.component(DesignSystemAssignPane)
                              .id(`${slug}-design-assign`)
                              .title('Assign Design System')
                              .options({ projectId: project._id, projectSlug: slug })
                      ),

                    ...(designSystemId ? [
                      S.listItem()
                        .id(`${slug}-design-change`)
                        .title('Change Design System')
                        .child(
                          S.component(DesignSystemAssignPane)
                            .id(`${slug}-design-change-pane`)
                            .title('Change Design System')
                            .options({ projectId: project._id, projectSlug: slug, currentDSId: designSystemId })
                        ),
                    ] : []),

                    S.divider(),

                    // ── Website Settings ─────────────────────────────────────
                    // siteConfig: website-specific configuration — identity, SEO,
                    // contact info, locales, nav, social links, website behaviour.
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
                    // project document: platform-level configuration — modules,
                    // design system, tenant relationship, domains, project status.
                    // Future home for billing and module management (ADR-011).
                    S.listItem()
                      .id(`${slug}-project-settings`)
                      .title('Project Settings')
                      .child(
                        S.document()
                          .documentId(project._id)
                          .schemaType('project')
                          .title('Project Settings')
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
      prev.filter((opt) => !['homePage', 'homePageProjectOwned', 'livePageProjectOwned', 'eventsPageProjectOwned', 'blogPageProjectOwned'].includes(opt.templateId)),
  },
})

import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes, initialValueTemplates } from './src/lib/sanity/schema'
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

        // ── Fetch clients + projects ───────────────────────────────────────────
        const clients = await client.fetch<{
          _id: string
          displayName: string
          tenantSlug: string
          projects: {
            _id: string
            projectName: string
            projectSlug: string
            designSystemId?: string
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
            }
          }`
        )

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

        // ── Client items ──────────────────────────────────────────────────────
        const clientItems = clients.map((clientDoc) => {
          const clientLabel = clientDoc.displayName ?? clientDoc.tenantSlug
          const clientId = clientDoc._id

          const projectItems = clientDoc.projects.map((project) => {
            const slug = project.projectSlug
            const projectLabel = project.projectName ?? slug
            const designSystemId = project.designSystemId


            return S.listItem()
              .id(`project-${slug}`)
              .title(projectLabel)
              .child(
                S.list()
                  .id(`project-${slug}-list`)
                  .title(projectLabel)
                  .items([

                    // ── Pages ────────────────────────────────────────────────
                    // One entry per public route. Singletons (Live, Events, Blog)
                    // sit alongside the general page list so every URL is one click away.
                    S.listItem()
                      .id(`${slug}-pages`)
                      .title('Pages')
                      .child(
                        S.list()
                          .id(`${slug}-pages-list`)
                          .title('Pages')
                          .items([
                            S.listItem()
                              .id(`${slug}-pages-all`)
                              .title('All Pages')
                              .child(
                                S.documentList()
                                  .title('All Pages')
                                  .schemaType('page')
                                  .apiVersion('2026-05-21')
                                  .filter(`_type == "page" && projectSlug == $slug`)
                                  .params({ slug })
                                  .initialValueTemplates([
                                    S.initialValueTemplateItem('pageProjectOwned', { projectSlug: slug }),
                                  ])
                              ),
                            S.divider(),
                            S.listItem()
                              .id(`${slug}-live-page`)
                              .title('Live Page')
                              .child(
                                S.documentList()
                                  .title('Live Page')
                                  .schemaType('livePage')
                                  .apiVersion('2026-05-21')
                                  .filter(`_type == "livePage" && projectSlug == $slug`)
                                  .params({ slug })
                                  .initialValueTemplates([
                                    S.initialValueTemplateItem('livePageProjectOwned', { projectSlug: slug }),
                                  ])
                              ),
                            S.listItem()
                              .id(`${slug}-events-page`)
                              .title('Events Page')
                              .child(
                                S.documentList()
                                  .title('Events Page')
                                  .schemaType('eventsPage')
                                  .apiVersion('2026-05-21')
                                  .filter(`_type == "eventsPage" && projectSlug == $slug`)
                                  .params({ slug })
                                  .initialValueTemplates([
                                    S.initialValueTemplateItem('eventsPageProjectOwned', { projectSlug: slug }),
                                  ])
                              ),
                            S.listItem()
                              .id(`${slug}-blog-page`)
                              .title('Blog Page')
                              .child(
                                S.documentList()
                                  .title('Blog Page')
                                  .schemaType('blogPage')
                                  .apiVersion('2026-05-21')
                                  .filter(`_type == "blogPage" && projectSlug == $slug`)
                                  .params({ slug })
                                  .initialValueTemplates([
                                    S.initialValueTemplateItem('blogPageProjectOwned', { projectSlug: slug }),
                                  ])
                              ),
                          ])
                      ),

                    S.divider(),

                    // ── Collections ──────────────────────────────────────────
                    // Reusable content displayed by pages. Not pages themselves.
                    // Organised by module: Blog, Events.
                    // Add new modules (Shop, Booking, CRM, …) as additional sub-lists.
                    S.listItem()
                      .id(`${slug}-collections`)
                      .title('Collections')
                      .child(
                        S.list()
                          .id(`${slug}-collections-list`)
                          .title('Collections')
                          .items([

                            // ── Blog module ──────────────────────────────────
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

                            S.divider(),

                            // ── Events module ────────────────────────────────
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

                          ])
                      ),

                    S.divider(),

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

                    // ── Settings ─────────────────────────────────────────────
                    S.listItem()
                      .id(`${slug}-settings`)
                      .title('Settings')
                      .child(
                        S.documentList()
                          .title('Settings')
                          .schemaType('siteConfig')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "siteConfig" && projectSlug == $slug`)
                          .params({ slug })
                          .initialValueTemplates([
                            S.initialValueTemplateItem('siteConfigProjectOwned', { projectSlug: slug }),
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
      prev.filter((opt) => !['homePage', 'homePageProjectOwned', 'livePageProjectOwned', 'eventsPageProjectOwned', 'blogPageProjectOwned'].includes(opt.templateId)),
  },
})

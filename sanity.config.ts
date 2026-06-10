import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './src/lib/sanity/schema'
import { DesignSystemPreview } from './src/sanity/components/DesignSystemPreview'

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
              "designSystemId": *[_type == "designSystem" && !(_id in path("drafts.**")) && projectSlug == ^.projectSlug][0]._id,
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
                    S.listItem()
                      .id(`${slug}-settings`)
                      .title('Settings')
                      .child(
                        S.documentList()
                          .title('Settings')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "siteConfig" && projectSlug == $slug`)
                          .params({ slug })
                      ),

                    S.listItem()
                      .id(`${slug}-design`)
                      .title('Design System')
                      .child(
                        designSystemId
                          ? designSystemPane(designSystemId)
                          : S.documentList()
                              .title('Design System')
                              .apiVersion('2026-05-21')
                              .filter(`_type == "designSystem" && projectSlug == $slug`)
                              .params({ slug })
                      ),

                    S.listItem()
                      .id(`${slug}-pages`)
                      .title('Pages')
                      .child(
                        S.list()
                          .id(`${slug}-pages-list`)
                          .title('Pages')
                          .items([
                            S.listItem()
                              .id(`${slug}-home`)
                              .title('Home Page')
                              .child(
                                S.documentList()
                                  .title('Home Page')
                                  .apiVersion('2026-05-21')
                                  .filter(`_type == "homePage" && projectSlug == $slug`)
                                  .params({ slug })
                              ),
                          ])
                      ),

                    S.listItem()
                      .id(`${slug}-events`)
                      .title('Events')
                      .child(
                        S.documentList()
                          .title('Events')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "event" && projectSlug == $slug`)
                          .params({ slug })
                          .defaultOrdering([{ field: 'startDate', direction: 'desc' }])
                      ),

                    S.listItem()
                      .id(`${slug}-posts`)
                      .title('Blog Posts')
                      .child(
                        S.documentList()
                          .title('Blog Posts')
                          .apiVersion('2026-05-21')
                          .filter(`_type == "post" && projectSlug == $slug`)
                          .params({ slug })
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
                .items([
                  ...projectItems,

                  S.divider(),

                  S.listItem()
                    .id(`${clientDoc.tenantSlug}-media`)
                    .title('Media Library')
                    .child(
                      S.documentList()
                        .title('Media Library')
                        .apiVersion('2026-05-21')
                        .filter(`_type == "mediaAsset" && tenant._ref == $clientId`)
                        .params({ clientId })
                    ),
                ])
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

          ])
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})

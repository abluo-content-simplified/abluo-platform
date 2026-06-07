import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './src/lib/sanity/schema'

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

        const clients = await client.fetch<{
          _id: string
          displayName: string
          tenantSlug: string
          projects: { _id: string; projectName: string; projectSlug: string }[]
        }[]>(
          `*[_type == "client" && !(_id in path("drafts.**"))] | order(displayName asc) {
            _id,
            displayName,
            tenantSlug,
            "projects": *[_type == "project" && !(_id in path("drafts.**")) && clientRef._ref == ^._id] | order(projectName asc) {
              _id,
              projectName,
              projectSlug,
            }
          }`
        )

        const clientItems = clients.map((clientDoc) => {
          const clientLabel = clientDoc.displayName ?? clientDoc.tenantSlug
          const clientId = clientDoc._id

          const projectItems = clientDoc.projects.map((project) => {
            const slug = project.projectSlug
            const projectLabel = project.projectName ?? slug

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
                        S.documentList()
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
                .items(projectItems)
            )
        })

        return S.list()
          .id('root')
          .title('Clients')
          .items(clientItems)
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})

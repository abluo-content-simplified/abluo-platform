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

        // Fetch all clients with their projects
        // Studio resolves drafts transparently — deduplicate by _id
        const rawClients = await client.fetch<{
          _id: string
          displayName: string
          tenantSlug: string
          projects: { _id: string; projectName: string; projectSlug: string }[]
        }[]>(
          `*[_type == "client"] | order(displayName asc) {
            _id,
            displayName,
            tenantSlug,
            "projects": *[_type == "project" && clientRef._ref == ^._id] | order(projectName asc) {
              _id,
              projectName,
              projectSlug,
            }
          }`
        )

        // Deduplicate clients by _id (drafts overlay)
        const clients = Array.from(new Map(rawClients.map(c => [c._id, c])).values())

        const clientItems = clients.map((clientDoc) => {
          const clientLabel = clientDoc.displayName ?? clientDoc.tenantSlug
          const clientId = clientDoc._id.replace('drafts.', '')

          // Deduplicate projects by _id
          const projects = Array.from(
            new Map(clientDoc.projects.map(p => [p._id, p])).values()
          )

          const projectItems = projects.map((project) => {
            const slug = project.projectSlug
            const projectLabel = project.projectName ?? slug

            return S.listItem()
              .title(projectLabel)
              .id(`project-${slug}`)
              .child(
                S.list()
                  .title(projectLabel)
                  .items([
                    S.listItem()
                      .title('Settings')
                      .id(`${slug}-settings`)
                      .child(
                        S.documentList()
                          .title('Settings')
                          .filter(`_type == "siteConfig" && projectSlug == $slug`)
                          .params({ slug })
                      ),

                    S.listItem()
                      .title('Design System')
                      .id(`${slug}-design`)
                      .child(
                        S.documentList()
                          .title('Design System')
                          .filter(`_type == "designSystem" && projectSlug == $slug`)
                          .params({ slug })
                      ),

                    S.listItem()
                      .title('Pages')
                      .id(`${slug}-pages`)
                      .child(
                        S.list()
                          .title('Pages')
                          .items([
                            S.listItem()
                              .title('Home Page')
                              .id(`${slug}-home`)
                              .child(
                                S.documentList()
                                  .title('Home Page')
                                  .filter(`_type == "homePage" && projectSlug == $slug`)
                                  .params({ slug })
                              ),
                          ])
                      ),

                    S.divider(),

                    S.listItem()
                      .title('Events')
                      .id(`${slug}-events`)
                      .child(
                        S.documentList()
                          .title('Events')
                          .filter(`_type == "event" && projectSlug == $slug`)
                          .params({ slug })
                          .defaultOrdering([{ field: 'startDate', direction: 'desc' }])
                      ),

                    S.listItem()
                      .title('Blog Posts')
                      .id(`${slug}-posts`)
                      .child(
                        S.documentList()
                          .title('Blog Posts')
                          .filter(`_type == "post" && projectSlug == $slug`)
                          .params({ slug })
                      ),
                  ])
              )
          })

          return S.listItem()
            .title(clientLabel)
            .id(`client-${clientId}`)
            .child(
              S.list()
                .title(clientLabel)
                .items(projectItems)
            )
        })

        return S.list()
          .title('Clients')
          .items(clientItems)
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})

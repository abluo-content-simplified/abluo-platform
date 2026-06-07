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
        // Fetch all tenants from their siteConfig documents
        const tenants = await context
          .getClient({ apiVersion: '2026-05-21' })
          .fetch<{ projectSlug: string; siteName?: string }[]>(
            `*[_type == "siteConfig"] | order(siteName asc) { projectSlug, siteName }`
          )

        const tenantItems = tenants.map((tenant) => {
          const label = tenant.siteName ?? tenant.projectSlug
          const slug = tenant.projectSlug

          return S.listItem()
            .title(label)
            .id(slug)
            .child(
              S.list()
                .title(label)
                .items([
                  // Settings — the siteConfig for this tenant
                  S.listItem()
                    .title('Settings')
                    .id(`${slug}-settings`)
                    .child(
                      S.documentList()
                        .title('Settings')
                        .filter(`_type == "siteConfig" && projectSlug == $slug`)
                        .params({ slug })
                    ),

                  // Home Page
                  S.listItem()
                    .title('Home Page')
                    .id(`${slug}-home`)
                    .child(
                      S.documentList()
                        .title('Home Page')
                        .filter(`_type == "homePage" && projectSlug == $slug`)
                        .params({ slug })
                    ),

                  S.divider(),

                  // Events (Livener and any future tenant that uses them)
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

                  // Blog Posts
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

        return S.list()
          .title('Clients')
          .items(tenantItems)
      },
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})

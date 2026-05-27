import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './src/lib/sanity/schema'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!
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
          .fetch<{ tenantSlug: string; siteName?: string }[]>(
            `*[_type == "siteConfig"] | order(siteName asc) { tenantSlug, siteName }`
          )

        const tenantItems = tenants.map((tenant) => {
          const label = tenant.siteName ?? tenant.tenantSlug
          const slug = tenant.tenantSlug

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
                        .filter(`_type == "siteConfig" && tenantSlug == $slug`)
                        .params({ slug })
                    ),

                  // Home Page
                  S.listItem()
                    .title('Home Page')
                    .id(`${slug}-home`)
                    .child(
                      S.documentList()
                        .title('Home Page')
                        .filter(`_type == "homePage" && tenantSlug == $slug`)
                        .params({ slug })
                    ),

                  S.divider(),

                  // Blog Posts
                  S.listItem()
                    .title('Blog Posts')
                    .id(`${slug}-posts`)
                    .child(
                      S.documentList()
                        .title('Blog Posts')
                        .filter(`_type == "post" && tenantSlug == $slug`)
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

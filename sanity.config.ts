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
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            S.listItem()
              .title('Site Configs')
              .child(S.documentTypeList('siteConfig').title('Site Configs')),
            S.listItem()
              .title('Home Pages')
              .child(S.documentTypeList('homePage').title('Home Pages')),
            S.divider(),
            S.listItem()
              .title('Blog Posts')
              .child(S.documentTypeList('post').title('Blog Posts')),
          ]),
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})

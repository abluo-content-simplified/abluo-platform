import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes, initialValueTemplates } from './src/lib/sanity/schema'
import { DesignSystemPreview } from './src/sanity/components/DesignSystemPreview'

// Hardcoded to match src/lib/sanity/client.ts — avoids env var dependency in the Studio
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? '3n7t84j3'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'

console.log('[Abluo Studio] sanity.config.ts LOADED')

export default defineConfig({
  name: 'abluo',
  title: 'Abluo Studio',

  projectId,
  dataset,

  plugins: [
    structureTool({
      structure: (S) => {
        console.log('[Abluo Studio] structure callback running')

        return S.list()
          .title('Test')
          .items([
            S.listItem()
              .id('test-item')
              .title('Test Item'),
          ])
      },
    }),
  ],

  schema: {
    types: schemaTypes,
    templates: initialValueTemplates,
  },
})

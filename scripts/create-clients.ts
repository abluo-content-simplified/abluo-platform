import { createClient } from '@sanity/client'
import { createAdminClient } from '../src/lib/supabase/admin'

const sanityClient = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_AUTH_TOKEN,
})

async function createClients() {
  try {
    console.log('Fetching tenants from Supabase...')
    const supabase = createAdminClient()

    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, slug, display_name')

    if (error) {
      console.error('Error fetching tenants:', error)
      return
    }

    if (!tenants || tenants.length === 0) {
      console.log('No tenants found in Supabase')
      return
    }

    console.log(`Found ${tenants.length} tenants. Creating Client documents...`)

    for (const tenant of tenants) {
      const clientDoc = {
        _type: 'client',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        displayName: tenant.display_name,
      }

      try {
        const result = await sanityClient.create(clientDoc)
        console.log(`✅ Created Client: ${tenant.display_name} (${tenant.slug})`)
        console.log(`   Document ID: ${result._id}`)
      } catch (createError: any) {
        if (createError.statusCode === 409) {
          console.log(
            `⏭️  Client already exists: ${tenant.display_name} (${tenant.slug})`
          )
        } else {
          console.error(
            `❌ Error creating client ${tenant.display_name}:`,
            createError.message
          )
        }
      }
    }

    console.log('\n✅ Done!')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

createClients()

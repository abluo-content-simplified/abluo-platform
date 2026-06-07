const { createClient } = require('@sanity/client');
const https = require('https');

const sanityClient = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_AUTH_TOKEN,
});

// Hardcoded tenants from Supabase
const tenants = [
  {
    id: 'c1a1c8f0-0b0a-4a0a-8a0a-0a0a0a0a0a01',
    slug: 'livener',
    display_name: 'Livener',
  },
  {
    id: 'c2b2c8f0-0b0a-4a0a-8a0a-0a0a0a0a0a02',
    slug: 'studiomartegani',
    display_name: 'Studio Dentistico Martegani',
  },
];

async function createClients() {
  try {
    console.log('Creating Client documents...');

    for (const tenant of tenants) {
      const clientDoc = {
        _type: 'client',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        displayName: tenant.display_name,
      };

      try {
        const result = await sanityClient.create(clientDoc);
        console.log(`✅ Created Client: ${tenant.display_name} (${tenant.slug})`);
        console.log(`   Document ID: ${result._id}`);
      } catch (createError) {
        if (createError.statusCode === 409) {
          console.log(
            `⏭️  Client already exists: ${tenant.display_name} (${tenant.slug})`
          );
        } else {
          console.error(
            `❌ Error creating client ${tenant.display_name}:`,
            createError.message
          );
        }
      }
    }

    console.log('\n✅ Done!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createClients();

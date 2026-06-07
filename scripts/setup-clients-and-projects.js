const { createClient } = require('@sanity/client')

const sanityClient = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_AUTH_TOKEN,
})

const clientsAndProjects = [
  {
    client: {
      _type: 'client',
      tenantId: '949e36cf-0f14-4527-89f5-68ad009bad0f',
      tenantSlug: 'livener',
      displayName: 'Livener',
    },
    project: {
      _type: 'project',
      projectId: '6cf3b0d5-e878-4625-a231-f0b0176d4c4f',
      projectSlug: 'livener',
      projectName: 'Livener',
      customDomain: 'livener.net',
      defaultLocale: 'en',
      // clientRef will be set after client is created
    },
  },
  {
    client: {
      _type: 'client',
      tenantId: '63b902cc-ae98-45dd-9e8a-048a822cf6c3',
      tenantSlug: 'studiomartegani',
      displayName: 'Studio Dentistico Martegani',
    },
    project: {
      _type: 'project',
      projectId: '58980fd3-0c72-4549-9a8c-f42ca6d5750a',
      projectSlug: 'studiomartegani',
      projectName: 'Studio Dentistico Martegani',
      customDomain: 'studiomartegani.com',
      defaultLocale: 'it',
      // clientRef will be set after client is created
    },
  },
]

async function setupClientsAndProjects() {
  try {
    console.log('Setting up Clients and Projects in Sanity...\n')

    for (const { client, project } of clientsAndProjects) {
      try {
        // Create Client
        console.log(`Creating Client: ${client.displayName}`)
        const createdClient = await sanityClient.create(client)
        console.log(`✅ Client created: ${createdClient._id}\n`)

        // Create Project with reference to Client
        project.clientRef = {
          _type: 'reference',
          _ref: createdClient._id,
        }
        console.log(`Creating Project: ${project.projectName}`)
        const createdProject = await sanityClient.create(project)
        console.log(`✅ Project created: ${createdProject._id}\n`)
      } catch (error) {
        if (error.statusCode === 409) {
          console.log(`⏭️  Already exists: ${client.displayName}\n`)
        } else {
          console.error(`❌ Error creating ${client.displayName}:`, error.message)
        }
      }
    }

    console.log('✅ Setup complete!')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

setupClientsAndProjects()

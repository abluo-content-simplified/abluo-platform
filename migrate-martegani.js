const { createClient } = require('@sanity/client')

const client = createClient({
  projectId: '3n7t84j3',
  dataset: 'production',
  apiVersion: '2026-05-21',
  token: 'sk2oxNIGXLS6lF8tarhF193511IXhSkj6HsCQ7F9qTa4850XjabTyXpiZH8XupRSQaRlfTjrrEJMKgFZJqPxT1Mxj5SfSI4Pyf7I4fGa3MW041WnJ2af97WiPIIy105kUt7wo9RhwsBHAtqPxcKTg9dU7wNokhnaoH9G27aQdc9m53xRsAZG',
  useCdn: false,
})

async function run() {
  const old = await client.getDocument('3aad0526-4bc4-4f37-bd6d-628d62df8d37')
  if (!old) { console.log('Source document not found'); return }

  const { _id, _rev, _createdAt, _updatedAt, _type, _system, ...rest } = old

  const newDoc = {
    _type: 'page',
    pageType: 'home',
    projectSlug: 'studiomartegani-main',
    slug: { _type: 'slug', current: 'home' },
    title: { en: 'Home', it: 'Home' },
    backgroundPattern: rest.backgroundPattern ?? 'none',
    sections: rest.sections,
  }

  const result = await client.create(newDoc)
  console.log('Created new page document:', result._id)

  // Publish it immediately
  await client
    .patch(result._id)
    .set({ _id: result._id })
    .commit()
  console.log('Done — Martegani homepage migrated to new page system.')
}

run().catch(console.error)

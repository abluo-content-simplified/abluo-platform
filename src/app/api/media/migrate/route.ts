import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'

// Migration API for converting string altText/description to localized objects
const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
})

export async function POST(request: NextRequest) {
  try {
    // A shared secret, and nothing else.
    //
    // This previously waived the check when request.nextUrl.hostname was
    // localhost. On Vercel that value derives from the Host header, which the
    // caller controls, so a request to production carrying `Host: localhost`
    // could plausibly have skipped it — an unauthenticated write to the
    // production dataset. The convenience was worth nothing: this is a one-off
    // migration that has already run, and running it locally with the secret
    // set is no harder than running it without.
    //
    // Fails closed when MIGRATION_SECRET is unset: the comparison is then
    // against the literal "Bearer undefined", which no caller sends.
    const authHeader = request.headers.get('Authorization')
    const secret = process.env.MIGRATION_SECRET

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch all mediaAssets that have string altText or description
    const assetsToMigrate = await client.fetch(`
      *[_type == "mediaAsset" && (
        typeof(altText) == "string" ||
        typeof(description) == "string"
      )] {
        _id,
        altText,
        description,
        _version
      }
    `)

    if (assetsToMigrate.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No documents to migrate',
        migratedCount: 0,
      })
    }

    console.log(`Starting migration of ${assetsToMigrate.length} documents...`)

    // Migrate each document
    const results = await Promise.all(
      assetsToMigrate.map(async (asset: any) => {
        try {
          const updateObj: any = {}

          // Convert string altText to localized object
          if (typeof asset.altText === 'string') {
            updateObj.altText = {
              en: asset.altText,
              it: '',
              de: '',
            }
          }

          // Convert string description to localized object
          if (typeof asset.description === 'string') {
            updateObj.description = {
              en: asset.description,
              it: '',
              de: '',
            }
          }

          // Only patch if there's something to update
          if (Object.keys(updateObj).length > 0) {
            await client.patch(asset._id).set(updateObj).commit()
            return { _id: asset._id, status: 'migrated', updateObj }
          } else {
            return { _id: asset._id, status: 'no_change' }
          }
        } catch (error: any) {
          console.error(`Failed to migrate ${asset._id}:`, error.message)
          return { _id: asset._id, status: 'failed', error: error.message }
        }
      })
    )

    const migratedCount = results.filter((r) => r.status === 'migrated').length
    const failedCount = results.filter((r) => r.status === 'failed').length

    console.log(`Migration complete: ${migratedCount} migrated, ${failedCount} failed`)

    return NextResponse.json({
      success: true,
      message: `Migration complete: ${migratedCount} migrated, ${failedCount} failed`,
      migratedCount,
      failedCount,
      details: results,
    })
  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        details: error,
      },
      { status: 500 }
    )
  }
}

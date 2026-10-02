import { sanityWriteClient as client } from '@/lib/sanity/server-clients'
import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { bearerMatches } from '@/lib/api/shared-secret'

// Migration API for converting string altText/description to localized objects

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
    // Fails closed when MIGRATION_SECRET is unset (bearerMatches never matches
    // an unset secret), and compares in constant time.
    const authHeader = request.headers.get('Authorization')
    const secret = process.env.MIGRATION_SECRET

    if (!bearerMatches(authHeader, secret)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // AND an Abluo admin session (two-factor, via requireAbluoAdmin). This
    // route mutates every tenant's mediaAsset documents with the write token;
    // a leaked MIGRATION_SECRET alone must not be enough to do that.
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
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

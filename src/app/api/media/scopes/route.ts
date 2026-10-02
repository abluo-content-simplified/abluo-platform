import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { sanityServerReadClient } from '@/lib/sanity/server-clients'

/**
 * GET /api/media/scopes            → the tenant (`client`) list for the Media Library filter
 * GET /api/media/scopes?tenant=ID  → that tenant's projects (+ their content languages)
 *
 * These two reads used to run IN THE BROWSER: the admin Media page built its
 * own anonymous `@sanity/client` and queried the dataset directly. An
 * anonymous browser read is exactly what a PRIVATE dataset refuses, so the
 * page's tenant/project pickers would have gone empty on the day of the flip
 * (docs/engineering/sanity-private-dataset.md). They now run here, server-side,
 * with the token-carrying client, behind the same admin gate as the rest of
 * `/api/media/*`. Query text and response shape are unchanged.
 */
export async function GET(request: NextRequest) {
  const actor = await requireAbluoAdmin()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    const tenant = request.nextUrl.searchParams.get('tenant')
    if (!tenant) {
      const data = await sanityServerReadClient.fetch(
        `*[_type == "client" && !(_id in path("drafts.**"))] | order(displayName asc) {
          _id, displayName, tenantSlug
        }`
      )
      return NextResponse.json({ success: true, data })
    }

    const data = await sanityServerReadClient.fetch(
      `*[_type == "project" && clientRef._ref == $tenantId && !(_id in path("drafts.**"))] | order(projectName asc) {
        _id, projectName, projectSlug,
        "supportedLocales": siteConfig->supportedLocales
      }`,
      { tenantId: tenant }
    )
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('GET /api/media/scopes error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch scopes' }, { status: 500 })
  }
}

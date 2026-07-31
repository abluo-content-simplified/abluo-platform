import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { buildMediaFilter } from '@/lib/media/media-filter'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  token: process.env.SANITY_API_WRITE_TOKEN,
  useCdn: false,
})

// GET /api/media/tags — Get distinct tags for autocomplete
export async function GET(request: NextRequest) {
  try {
    // ADR-015 Phase 1 (slice 3b): admin-only surface. Requires
    // platform_role === 'abluo_admin'; requireAbluoAdmin collapses unauth and
    // authenticated-non-admin to null (single honest 403).
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    const searchParams = request.nextUrl.searchParams
    const tenant = searchParams.get('tenant')
    const project = searchParams.get('project')
    const search = searchParams.get('search') || ''

    // Build parameterized GROQ filter (ADR-015 R2). `search` here is applied in
    // JS below, not in the query, so only tenant/project enter the filter.
    const { filter, params } = buildMediaFilter({ tenant, project })

    // Fetch all tags as a flat array, deduplicate and sort in JS.
    // Note: GROQ does not have unique() or sort() as pipeline functions;
    // *[filter].tags[] returns a flat array which we process here.
    const rawTags = await client.fetch<string[]>(`*[${filter}].tags[]`, params)

    const uniqueSorted = [...new Set(rawTags.filter(Boolean))].sort()

    // Filter by search if provided
    const filtered = search
      ? uniqueSorted.filter((tag: string) => tag.toLowerCase().includes(search.toLowerCase()))
      : uniqueSorted

    return NextResponse.json({
      success: true,
      data: filtered.slice(0, 50), // Limit to 50 suggestions
    })
  } catch (error) {
    console.error('GET /api/media/tags error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch tags' },
      { status: 500 }
    )
  }
}

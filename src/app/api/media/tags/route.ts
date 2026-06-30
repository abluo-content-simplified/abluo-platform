import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'

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
    const searchParams = request.nextUrl.searchParams
    const tenant = searchParams.get('tenant')
    const project = searchParams.get('project')
    const search = searchParams.get('search') || ''

    // Build GROQ filter
    let filter = '_type == "mediaAsset"'
    if (tenant) {
      filter += ` && tenant._ref == "${tenant}"`
    }
    if (project) {
      filter += ` && project._ref == "${project}"`
    }

    // Fetch all tags as a flat array, deduplicate and sort in JS.
    // Note: GROQ does not have unique() or sort() as pipeline functions;
    // *[filter].tags[] returns a flat array which we process here.
    const rawTags = await client.fetch<string[]>(`*[${filter}].tags[]`)

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

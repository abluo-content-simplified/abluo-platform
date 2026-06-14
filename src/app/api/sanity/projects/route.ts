import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

/**
 * GET /api/sanity/projects?tenantId=xxx
 * Fetches all projects for a specific tenant from Supabase.
 *
 * Query params:
 * - tenantId: UUID of the tenant
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('tenantId')

    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenantId parameter is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Fetch projects for the tenant
    const { data: projects, error } = await supabase
      .from('projects')
      .select('id, slug, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch projects', details: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(
      projects?.map((project) => ({
        id: project.id,
        slug: project.slug,
        name: project.name,
      })) || []
    )
  } catch (error) {
    console.error('Projects API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

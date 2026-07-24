import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/auth'

/**
 * GET /api/sanity/projects?tenantId=xxx
 * Fetches all projects for a specific tenant from Supabase.
 *
 * Query params:
 * - tenantId: UUID of the tenant
 */
export async function GET(request: Request) {
  try {
    // ADR-015 interim gate: any authenticated session. Phase 1 upgrades this
    // admin-surface route to require platform_role === 'abluo_admin'. The
    // service-role Supabase client is intentionally left as-is (RLS tranche).
    const user = await requireAuthenticatedUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      .select('id, slug, name, custom_domain, created_at')
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
        domain: project.custom_domain ?? null,
        createdAt: project.created_at,
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

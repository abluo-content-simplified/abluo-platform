import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'

/**
 * GET /api/sanity/tenants
 * Fetches all available tenants from Supabase.
 * Returns tenants that are not already connected to Sanity clients.
 *
 * Query params:
 * - exclude: comma-separated list of tenant IDs to exclude (already-connected tenants)
 */
export async function GET(request: Request) {
  try {
    // ADR-015 Phase 1 (slice 3b): admin-only surface. Requires
    // platform_role === 'abluo_admin'; requireAbluoAdmin collapses unauth and
    // authenticated-non-admin to null (single honest 403). The service-role
    // Supabase client is intentionally left as-is (RLS tranche).
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const excludeParam = searchParams.get('exclude')
    const excludeIds = excludeParam ? excludeParam.split(',') : []

    const supabase = createAdminClient()

    // Fetch all tenants from Supabase
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('id, slug, display_name, status, plan, created_at, domain')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch tenants', details: error.message },
        { status: 500 }
      )
    }

    // Filter out excluded tenants
    const available = tenants?.filter(
      (t) => !excludeIds.includes(t.id)
    ) || []

    return NextResponse.json(
      available.map((tenant) => ({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        displayName: tenant.display_name,
      }))
    )
  } catch (error) {
    console.error('Tenants API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

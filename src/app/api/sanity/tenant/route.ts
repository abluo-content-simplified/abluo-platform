import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

/**
 * GET /api/sanity/tenant?id=xxx
 * Fetches a single tenant from Supabase with all details.
 *
 * Query params:
 * - id: UUID of the tenant
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tenantId = searchParams.get('id')

    if (!tenantId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Fetch tenant with all details
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, slug, display_name, status, plan, created_at, domain')
      .eq('id', tenantId)
      .single()

    if (error) {
      return NextResponse.json(
        { error: 'Tenant not found', details: error.message },
        { status: 404 }
      )
    }

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(tenant)
  } catch (error) {
    console.error('Tenant API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

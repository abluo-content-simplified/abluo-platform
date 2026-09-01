import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'

/**
 * GET /api/sanity/tenant?id=xxx
 * Fetches a single tenant from Supabase with all details.
 *
 * Query params:
 * - id: UUID of the tenant
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
    const tenantId = searchParams.get('id')

    if (!tenantId) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Fetch tenant with all details.
    // `domain` is deliberately NOT in this select-list: migration 022 drops
    // public.tenants.domain (hosts are per-PROJECT — projects.custom_domain),
    // and PostgREST 400s on a select-list naming a column that no longer
    // exists. The value was never read — TenantLinker.tsx consumes this row
    // and never touches `.domain` — so dropping it from the list is a no-op
    // while the column still exists, and is what lets 022 be applied later.
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, slug, display_name, status, plan, created_at')
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

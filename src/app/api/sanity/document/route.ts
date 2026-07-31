import { createClient } from '@sanity/client'
import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  useCdn: false,
})

/**
 * GET /api/sanity/document?id=xxx
 * Fetches a Sanity document by ID
 */
export async function GET(request: Request) {
  try {
    // ADR-015 Phase 1 (slice 3b): admin-only surface. Requires
    // platform_role === 'abluo_admin'; requireAbluoAdmin collapses unauth and
    // authenticated-non-admin to null (single honest 403).
    const actor = await requireAbluoAdmin()
    if (!actor) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'id parameter is required' },
        { status: 400 }
      )
    }

    const doc = await client.fetch(`*[_id == $id][0]`, { id })

    if (!doc) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(doc)
  } catch (error) {
    console.error('Document API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}

import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { withSiteAccessStore } from '@/lib/access/server'

/**
 * GET /api/sanity/access-groups?projectSlug=xxx — ADR-040 §15 (R9).
 * The project's live access groups (id + name, never a password), for the
 * Studio group picker on a protected page. Platform admins only.
 */
export async function GET(request: Request) {
  const actor = await requireAbluoAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const projectSlug = new URL(request.url).searchParams.get('projectSlug') ?? ''
  const projectId = resolveScopeFromProjectSegment(projectSlug)?.projectId
  if (!projectId) return NextResponse.json({ error: 'Unknown project' }, { status: 404 })
  try {
    const groups = await withSiteAccessStore('studio: list a project\'s access groups for the page group picker (admin only)', (store) => store.listGroups(projectId))
    return NextResponse.json(
      groups.filter((g) => !g.archivedAt).map((g) => ({ id: g.id, name: g.name })),
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch {
    return NextResponse.json({ error: 'Access is not available for this project' }, { status: 503 })
  }
}

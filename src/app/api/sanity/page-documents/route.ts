import { NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import { withSiteAccessStore } from '@/lib/access/server'

/**
 * GET /api/sanity/page-documents?projectSlug=xxx&pageId=yyy — ADR-040 §15 (R9).
 * The documents the site placed on one page (title, who can open it), so
 * Studio can warn before a page change hides some of them. Platform admins only.
 */
export async function GET(request: Request) {
  const actor = await requireAbluoAdmin()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const projectId = resolveScopeFromProjectSegment(url.searchParams.get('projectSlug') ?? '')?.projectId
  const pageId = (url.searchParams.get('pageId') ?? '').replace(/^drafts\./, '')
  if (!projectId || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(pageId)) return NextResponse.json([], { status: 200 })
  try {
    const docs = await withSiteAccessStore('studio: documents placed on a page, for the publish warning (admin only)', (store) => store.listDocuments(projectId))
    return NextResponse.json(
      docs.filter((d) => !d.archivedAt && d.pageIds.includes(pageId))
        .map((d) => ({ id: d.id, title: d.title, visibility: d.visibility, groupIds: d.groupIds })),
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch {
    return NextResponse.json([], { status: 200 })
  }
}

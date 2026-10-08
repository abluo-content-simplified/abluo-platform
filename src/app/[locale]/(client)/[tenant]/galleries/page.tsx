import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { GALLERY_WRITE_PERMISSION, canDeleteGalleries, listGalleries, type GalleryListItem } from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { GalleryList } from '@/components/client/gallery/GalleryList'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Galleries (Gallery module), in the shared page frame: a
 * grid of gallery cards (each with a strip of its photos) or a table, with
 * the shared list toolbar. Reads through `listGalleries` (gallery.gallery.read,
 * project-scoped); a project without the Gallery module gets a 404 like any
 * unknown page. Filters live in the query string.
 */
export default async function GalleriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === 'string') query.set(k, v)
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/galleries`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  let galleries: GalleryListItem[]
  let statuses: Record<string, GalleryStatus> = {}
  try {
    galleries = await listGalleries(ctx, grant.projectId)
    // Status is extra information: the list still works without it.
    statuses = await getGalleryStatuses(ctx, grant.projectId).catch((): Record<string, GalleryStatus> => ({}))
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <GalleryList
        projectSlug={projectSlug}
        galleries={galleries}
        statuses={statuses}
        canWrite={grant.permissions.includes(GALLERY_WRITE_PERMISSION)}
        canDelete={canDeleteGalleries(grant)}
        initialQuery={query.toString()}
      />
    </PageShell>
  )
}

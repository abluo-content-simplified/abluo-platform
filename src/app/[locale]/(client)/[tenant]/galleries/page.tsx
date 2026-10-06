import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { GALLERY_WRITE_PERMISSION, listGalleries, type GalleryListItem } from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { GalleryList } from '@/components/client/gallery/GalleryList'

/**
 * Client dashboard — Galleries (Gallery module). The project's galleries with
 * cover, photo count, where each is shown and whether it has unpublished
 * changes. Reads through `listGalleries` (gallery.gallery.read, project-scoped);
 * a project without the Gallery module gets a 404 like any unknown page.
 */
export default async function GalleriesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext()
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
    <GalleryList
      projectSlug={projectSlug}
      galleries={galleries}
      statuses={statuses}
      canWrite={grant.permissions.includes(GALLERY_WRITE_PERMISSION)}
      canDelete={grant.role === 'owner' && grant.permissions.includes(GALLERY_WRITE_PERMISSION)}
    />
  )
}

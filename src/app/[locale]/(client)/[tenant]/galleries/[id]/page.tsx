import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { GALLERY_WRITE_PERMISSION, GalleryError, canDeleteGalleries, getGalleryDraft, isGalleryId, type GallerySnapshot } from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { GalleryDetail } from '@/components/client/gallery/GalleryDetail'
import { PageShell } from '@/components/client/ui/PageShell'

/**
 * One gallery's page (client dashboard · galleries), in the shared page frame:
 * its title and actions, where it is shown, and every photo as a grid, with
 * "Set as main image". Editing opens the gallery wizard (`/edit`, a
 * full-screen flow); `/galleries/new` is its own route. Shows the draft when
 * there is one, else the published gallery. Needs gallery.gallery.write (as
 * before); anything not this project's gallery is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function GalleryPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/galleries/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isGalleryId(id) || !grant.permissions.includes(GALLERY_WRITE_PERMISSION)) notFound()

  let gallery: GallerySnapshot
  let status: GalleryStatus | null = null
  try {
    gallery = await getGalleryDraft(ctx, grant.projectId, id)
    status = (await getGalleryStatuses(ctx, grant.projectId, [id]).catch((): Record<string, GalleryStatus> => ({})))[id] ?? null
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof GalleryError && error.code === 'not_found') notFound()
    throw error
  }

  return (
    <PageShell>
      <GalleryDetail projectSlug={projectSlug} initial={gallery} status={status} canDelete={canDeleteGalleries(grant)} />
    </PageShell>
  )
}

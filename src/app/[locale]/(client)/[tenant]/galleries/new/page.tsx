import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { GALLERY_WRITE_PERMISSION, canDeleteGalleries, getGallerySite, type GallerySnapshot } from '@/lib/api/gallery-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { GalleryWizard } from '@/components/client/gallery/GalleryWizard'

/**
 * `/galleries/new` — the gallery wizard with no document (lazy creation): a
 * full-screen flow (listed in the PageShell guard's WIZARDS). Nothing exists
 * until the first title or photo; then the URL becomes `/galleries/<id>/edit`
 * without a reload. Needs gallery.gallery.write.
 */
export const dynamic = 'force-dynamic'

export default async function NewGalleryPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/galleries/new`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(GALLERY_WRITE_PERMISSION)) notFound()

  let gallery: GallerySnapshot
  try {
    const site = await getGallerySite(ctx, grant.projectId)
    gallery = { id: '', rev: '', hasDraft: false, internalName: '', title: {}, description: {}, tags: [], items: [], mainImage: null, live: null, usedIn: [], site }
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return <GalleryWizard projectSlug={projectSlug} initial={gallery} listHref={`/${projectSlug}/galleries`} canDelete={canDeleteGalleries(grant)} />
}

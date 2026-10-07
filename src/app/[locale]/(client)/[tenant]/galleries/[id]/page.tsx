import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  GALLERY_WRITE_PERMISSION,
  GalleryError,
  canDeleteGalleries,
  getGalleryDraft,
  getGallerySite,
  isGalleryId,
  type GallerySnapshot,
} from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { GalleryWizard } from '@/components/client/gallery/GalleryWizard'

/** `/galleries/new` opens the wizard with no document (lazy creation). */
const NEW_GALLERY_SEGMENT = 'new'

/**
 * One gallery in the gallery wizard (client dashboard · galleries). A new
 * gallery (`new`) starts empty and nothing exists until its first title or
 * photo; an existing one opens on its overview, showing the draft when there
 * is one, else the published gallery (the first change creates the draft —
 * from the browser, never on this GET). Needs gallery.gallery.write; anything
 * not this project's gallery is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function GalleryEditorPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/galleries/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isGalleryId(id) || !grant.permissions.includes(GALLERY_WRITE_PERMISSION)) notFound()

  let gallery: GallerySnapshot
  let status: GalleryStatus | null = null
  try {
    if (id === NEW_GALLERY_SEGMENT) {
      const site = await getGallerySite(ctx, grant.projectId)
      gallery = { id: '', rev: '', hasDraft: false, internalName: '', title: {}, description: {}, tags: [], items: [], live: null, usedIn: [], site }
    } else {
      gallery = await getGalleryDraft(ctx, grant.projectId, id)
      status = (await getGalleryStatuses(ctx, grant.projectId, [id]).catch((): Record<string, GalleryStatus> => ({})))[id] ?? null
    }
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof GalleryError && error.code === 'not_found') notFound()
    throw error
  }

  return (
    <GalleryWizard
      projectSlug={projectSlug}
      initial={gallery}
      listHref={`/${projectSlug}/galleries`}
      canDelete={canDeleteGalleries(grant)}
      status={status}
    />
  )
}

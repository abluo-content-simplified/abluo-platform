import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { GALLERY_WRITE_PERMISSION, GalleryError, canDeleteGalleries, getGalleryDraft, isGalleryId, type GallerySnapshot } from '@/lib/api/gallery-drafts'
import { getGalleryStatuses, type GalleryStatus } from '@/lib/api/gallery-status'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import type { GallerySection } from '@/lib/client/gallery-wizard'
import { GalleryWizard } from '@/components/client/gallery/GalleryWizard'

const SECTIONS: readonly GallerySection['id'][] = ['name', 'photos', 'describe', 'languages']

/**
 * `/galleries/<id>/edit` — an existing gallery in the gallery wizard (a
 * full-screen flow, listed in the PageShell guard's WIZARDS). Opens on the
 * overview, or straight on one part with `?section=name|photos|describe|languages`
 * (and `&photo=<item key>` for one photo's description); "Done" and
 * "Save & exit" go back to the gallery's page. Shows the draft when there is
 * one, else the published gallery (the first change creates the draft — from
 * the browser, never on this GET). Needs gallery.gallery.write; anything not
 * this project's gallery is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function GalleryEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug, id } = await params
  const query = await searchParams
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/galleries/${encodeURIComponent(id)}/edit`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isGalleryId(id) || id === 'new' || !grant.permissions.includes(GALLERY_WRITE_PERMISSION)) notFound()

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

  const section = typeof query.section === 'string' && (SECTIONS as readonly string[]).includes(query.section) ? (query.section as GallerySection['id']) : undefined
  const photo = typeof query.photo === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(query.photo) ? query.photo : undefined

  return (
    <GalleryWizard
      projectSlug={projectSlug}
      initial={gallery}
      listHref={`/${projectSlug}/galleries`}
      exitHref={`/${projectSlug}/galleries/${id}`}
      canDelete={canDeleteGalleries(grant)}
      status={status}
      initialSection={section}
      initialPhotoKey={photo}
    />
  )
}

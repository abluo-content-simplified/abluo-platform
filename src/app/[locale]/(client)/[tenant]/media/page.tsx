import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { grantCanManageMedia } from '@/lib/api/media-permission'
import { getMediaSite } from '@/lib/api/media-library'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { MediaLibraryScreen } from '@/components/client/media/MediaLibraryScreen'
import { PageShell } from '@/components/client/ui/PageShell'

/**
 * Client dashboard — Media: the project's Media Library in the shared page
 * frame (PageShell), as a grid or a table. Search and filter (tag, usage,
 * description, uploaded date), open a photo to edit its name, description, caption, focus point and
 * tags and see where it is used, select several to tag or rename them.
 * "Add photos" is the media wizard (/media/add). No delete yet.
 * Owner/editor only (`canManageMedia`); anyone else gets a 404.
 */
export default async function MediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams?: Promise<{ add?: string }>
}) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/media`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grantCanManageMedia(grant)) notFound()

  let site: { defaultLocale: string; locales: string[] }
  try {
    site = await getMediaSite(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  // Old "?add=1" links: adding photos is the media wizard now.
  if ((await searchParams)?.add === '1') redirect(`/${projectSlug}/media/add`)
  return (
    <PageShell>
      <MediaLibraryScreen projectSlug={projectSlug} site={site} />
    </PageShell>
  )
}

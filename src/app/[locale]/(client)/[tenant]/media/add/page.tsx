import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { grantCanManageMedia } from '@/lib/api/media-permission'
import { getMediaSite } from '@/lib/api/media-library'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { MediaAddWizard } from '@/components/client/media/MediaAddWizard'

/**
 * "+ Add content → Add to media library": the media wizard (Add photos →
 * Describe photo n of N → Done → back to Media). Same gate as the Media page:
 * owner/editor (`canManageMedia`); anyone else gets a 404.
 */
export const dynamic = 'force-dynamic'

export default async function MediaAddPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/media/add`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grantCanManageMedia(grant)) notFound()

  let site: { defaultLocale: string; locales: string[] }
  try {
    site = await getMediaSite(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  return <MediaAddWizard projectSlug={projectSlug} site={site} mediaHref={`/${projectSlug}/media`} />
}

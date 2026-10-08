import { notFound } from 'next/navigation'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getMediaSite } from '@/lib/api/media-library'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { adminMediaContext } from '@/lib/admin/media-context'
import { loadAdminMediaProject } from '@/lib/admin/media-projects'
import { adminMediaHref } from '@/lib/client/media-links'
import { MediaAddWizard } from '@/components/client/media/MediaAddWizard'

export const dynamic = 'force-dynamic'

/**
 * Admin — "Add photos" into one project (`?project=<slug>`): the client
 * dashboard's media wizard, uploading and saving through the admin actions
 * (`scope="admin"`). Unknown or shared slug → 404. Full-screen wizard with its
 * own frame (no PageShell).
 */
export default async function AdminMediaAddPage({ searchParams }: { searchParams?: Promise<{ project?: string | string[] }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const requested = (await searchParams)?.project
  const project = await loadAdminMediaProject(typeof requested === 'string' ? requested : null)
  const ctx = project ? adminMediaContext(actor, project) : null
  if (!project || !ctx) notFound()

  let site: { defaultLocale: string; locales: string[] }
  try {
    site = await getMediaSite(ctx, project.id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  return <MediaAddWizard projectSlug={project.slug} scope="admin" site={site} mediaHref={adminMediaHref(project.slug)} />
}

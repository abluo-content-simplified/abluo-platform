import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getMediaSite, type MediaSite } from '@/lib/api/media-library'
import { adminMediaContext, pickAdminProject } from '@/lib/admin/media-context'
import { loadAdminMediaProjects } from '@/lib/admin/media-projects'
import { AdminMediaLibrary } from '@/components/admin/media/AdminMediaLibrary'
import { PageShell } from '@/components/app/ui/PageShell'

export const dynamic = 'force-dynamic'

/** Languages for "All projects": each photo carries its own site's; this only fills the gaps. */
const FALLBACK_SITE: MediaSite = { defaultLocale: 'en', locales: ['en'] }

/**
 * Admin — Media (ADR-030 step 4): every project's Media Library on the client
 * dashboard's Media screen. `?project=<slug>` shows one project (its languages
 * read here), no parameter shows all projects. The layout gates the surface;
 * this page reads Supabase with the service role, so it checks
 * `requireAbluoAdmin()` itself too. Photos load through the admin actions
 * (`./actions.ts`), which re-check and write the admin audit log.
 */
export default async function AdminMediaPage({ searchParams }: { searchParams?: Promise<{ project?: string | string[] }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()
  const t = await getTranslations('admin.media')

  const requested = (await searchParams)?.project
  const slug = typeof requested === 'string' && requested ? requested : null

  let projects: Awaited<ReturnType<typeof loadAdminMediaProjects>> = []
  let loadError = false
  try {
    projects = await loadAdminMediaProjects()
  } catch {
    loadError = true
  }

  const project = slug ? pickAdminProject(projects, slug) : null
  let site = FALLBACK_SITE
  if (project) {
    const ctx = adminMediaContext(actor, project)
    if (ctx) {
      try {
        site = await getMediaSite(ctx, project.id)
      } catch {
        // The screen still works with the fallback; saving checks the real languages.
      }
    }
  }

  return (
    <PageShell>
      {loadError ? (
        <p role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : null}
      {slug && !project ? (
        <p role="status" className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
          {t('unknownProject', { slug })}
        </p>
      ) : null}
      <AdminMediaLibrary
        projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
        projectSlug={project?.slug ?? null}
        site={site}
      />
    </PageShell>
  )
}

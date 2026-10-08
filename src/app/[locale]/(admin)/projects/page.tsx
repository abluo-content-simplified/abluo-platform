import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { ProjectsBrowser } from '@/components/admin/projects/ProjectsBrowser'
import { listAdminProjects } from '@/lib/api/admin-dashboard/projects'
import { DEFAULT_PROJECT_FILTERS, isProjectStatusFilter } from '@/lib/admin/projects-filter'

export const dynamic = 'force-dynamic'

/**
 * Every project on the platform (ADR-030): search (name, slug, domain,
 * client, owners) and a status filter — everything but inactive by default,
 * or `?status=` (Home's tiles link here with one). Reads with the SERVICE ROLE
 * through `listAdminProjects`, which checks `requireAbluoAdmin()` itself on
 * top of the `(admin)` layout gate.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ status?: string | string[] }> }) {
  const t = await getTranslations('admin.projects')
  const { status } = await searchParams
  const initialStatus = isProjectStatusFilter(status) ? status : DEFAULT_PROJECT_FILTERS.status
  const { projects, ownersKnown, error } = await listAdminProjects()

  return (
    <PageShell>
      <div className="space-y-1">
        <PageHeader title={t('title')} />
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t('loadError', { message: error })}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState title={t('emptyTitle')} />
      ) : (
        <ProjectsBrowser key={initialStatus /* a Home tile link to another ?status= resets the filter */} projects={projects} ownersKnown={ownersKnown} initialStatus={initialStatus} />
      )}
    </PageShell>
  )
}

import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { BacklogBrowser } from '@/components/admin/backlog/BacklogBrowser'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { loadBacklog } from '@/lib/admin/backlog'

export const dynamic = 'force-dynamic'

/**
 * Admin Backlog (ADR-030 §5.5, migration 034): the Abluo team's technical
 * backlog — bugs, improvements, ideas and tasks for the platform, modules, the
 * dashboards and client websites. Internal only.
 *
 * Reads with the SERVICE ROLE, so besides the `(admin)` layout gate it checks
 * `requireAbluoAdmin()` itself. While migration 034 is not applied the page
 * says so calmly instead of failing.
 */
export default async function AdminBacklogPage() {
  const t = await getTranslations('admin.backlog')
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')

  const load = await loadBacklog(actor)

  if (load.state === 'not_set_up') {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <EmptyState title={t('notSetUpTitle')} body={t('notSetUpBody')} />
      </PageShell>
    )
  }

  if (load.state === 'error') {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        <div role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
          {t('loadError', { message: load.message })}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <BacklogBrowser items={load.items} projects={load.projects} />
    </PageShell>
  )
}

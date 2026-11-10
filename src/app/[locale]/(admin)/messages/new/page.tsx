import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { NewMessageForm } from '@/components/admin/messages/NewMessageForm'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { listAdminUsers } from '@/lib/api/admin-dashboard/users'
import { buildMessageDirectory } from '@/lib/messages/directory'
import { DASHBOARD_LINK_TARGETS } from '@/lib/messages/model'

/**
 * Admin — New Message (ADR-050 D3/D4): pick sites and people (only people with
 * active access), separate or shared, subject, text, files, dashboard links.
 * `?project=<id>&user=<id>` preselects a person (e.g. from Users).
 */
export const dynamic = 'force-dynamic'

export default async function NewMessagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) redirect('/unauthorized')
  const sp = await searchParams
  const t = await getTranslations('admin.messages')
  const directory = await listAdminUsers()
  if (directory.error) {
    return (
      <PageShell>
        <PageHeader title={t('new.title')} />
        <EmptyState title={t('loadFailedTitle')} body={t('loadFailedBody')} />
      </PageShell>
    )
  }
  const sites = buildMessageDirectory(directory.people, directory.projects)
  const project = typeof sp.project === 'string' ? sp.project : null
  const user = typeof sp.user === 'string' ? sp.user : null
  const preset = project && user && sites.some((s) => s.id === project && s.people.some((p) => p.userId === user)) ? [{ projectId: project, userId: user }] : []
  return (
    <PageShell>
      <NewMessageForm sites={sites} linkTargets={DASHBOARD_LINK_TARGETS.map((l) => l.id)} preset={preset} />
    </PageShell>
  )
}

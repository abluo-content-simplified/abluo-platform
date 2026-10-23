import { getTranslations } from 'next-intl/server'
import { Notice } from '@/components/app/ui/Notice'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { ActiveNowStrip } from '@/components/admin/users/ActiveNowStrip'
import { UsersBrowser } from '@/components/admin/users/UsersBrowser'
import { UsersUpdateButton, UsersUpdatedNote } from '@/components/admin/users/UsersUpdateBar'
import { listAdminUsers } from '@/lib/api/admin-dashboard/users'
import { activeNowPeople, summarizeUsers } from '@/lib/admin/users-model'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { recordAdminAudit } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

/**
 * Users (ADR-030 amendment A1): everyone with access to any site, across
 * Abluo. A snapshot read when the page opens — "Updated 14:32" + Update; no
 * live connection. Top: who has a dashboard open now, four numbers, then the
 * list. Reads with the SERVICE ROLE via `listAdminUsers` (checks
 * `requireAbluoAdmin()` itself on top of the `(admin)` layout gate). Each view
 * is written to the internal admin audit log.
 */
export default async function UsersPage() {
  const t = await getTranslations('admin.users')
  const { people, projects, readAt, error } = await listAdminUsers()
  const actor = await requireAbluoAdmin()
  if (actor) await recordAdminAudit({ actorId: actor.userId, action: 'users.view' })
  const now = Date.parse(readAt)
  const summary = summarizeUsers(people, now)

  return (
    <PageShell>
      <div className="space-y-1">
        <PageHeader title={t('title')} actions={<UsersUpdateButton />} />
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <UsersUpdatedNote readAt={readAt} />
      </div>

      {error ? (
        <Notice tone="error">{t('loadError', { message: error })}</Notice>
      ) : (
        <>
          <ActiveNowStrip people={activeNowPeople(people, now)} />
          <StatGrid label={t('summaryLabel')}>
            <StatTile label={t('tiles.activeNow')} value={summary.activeNow} />
            <StatTile label={t('tiles.people')} value={summary.people} />
            <StatTile label={t('tiles.invitations')} value={summary.invitations} />
            <StatTile label={t('tiles.withoutTwoFactor')} value={summary.withoutTwoFactor} />
          </StatGrid>
          <UsersBrowser people={people} projects={projects} now={now} />
        </>
      )}
    </PageShell>
  )
}

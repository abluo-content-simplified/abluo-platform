import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { BackLink } from '@/components/app/ui/BackLink'
import { PageShell } from '@/components/app/ui/PageShell'
import { UserDetail } from '@/components/admin/users/UserDetail'
import { UsersUpdateBar } from '@/components/admin/users/UsersUpdateBar'
import { getAdminUser } from '@/lib/api/admin-dashboard/users'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { recordAdminAudit } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

/**
 * One person (ADR-030 A1): Profile · Access · Security · Activity, read-only,
 * as of when the page was opened (Update re-reads). `key` is the user id, or
 * `invite:<email>` for someone invited who has no account yet. Each view is
 * written to the internal admin audit log (the user id, never the email).
 */
export default async function UserPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params
  let key = raw
  try {
    key = decodeURIComponent(raw)
  } catch {
    notFound()
  }
  const t = await getTranslations('admin.users')
  const detail = await getAdminUser(key)
  if (!detail) notFound()
  const actor = await requireAbluoAdmin()
  if (actor) await recordAdminAudit({ actorId: actor.userId, action: 'user.view', detail: { user: detail.person.userId ?? 'invitation' } })

  return (
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <BackLink href="/users" label={t('title')} />
        <UsersUpdateBar readAt={detail.readAt} />
      </div>
      <UserDetail person={detail.person} activity={detail.activity} now={Date.parse(detail.readAt)} />
    </PageShell>
  )
}

import { notFound } from 'next/navigation'
import { Notice } from '@/components/app/ui/Notice'
import { getTranslations } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'
import { listProductUpdatesForAdmin } from '@/lib/whats-new/admin'
import { WHATS_NEW_LOCALES } from '@/lib/whats-new/model'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageShell } from '@/components/app/ui/PageShell'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { WhatsNewAdmin } from '@/components/admin/whats-new/WhatsNewAdmin'
import { AnnouncementsAdmin } from '@/components/admin/whats-new/AnnouncementsAdmin'
import { listNoticeAcks, listNoticesForAdmin } from '@/lib/whats-new/notices-admin'
import { listAdminUsers } from '@/lib/api/admin-dashboard/users'
import { buildMessageDirectory } from '@/lib/messages/directory'
import { ackReport } from '@/lib/whats-new/acks'

export const dynamic = 'force-dynamic'

/**
 * Admin What's new (ADR-030 step 6, migration 035): product updates Abluo
 * writes for clients. Drafts, published and archived updates in one list;
 * "New update" and each row open the editor in a side panel.
 *
 * Reads with the SERVICE ROLE, so — besides the (admin) layout gate — the page
 * itself calls `requireAbluoAdmin()` first and refuses without it.
 */
export default async function AdminWhatsNewPage() {
  const actor = await requireAbluoAdmin()
  if (!actor) notFound()

  const t = await getTranslations('admin.whatsNew')
  const [result, notices, directory] = await Promise.all([listProductUpdatesForAdmin(), listNoticesForAdmin(), listAdminUsers()])
  // ADR-050 D8: sites and people for specific audiences, and who acknowledged what.
  const sites = directory.error ? [] : buildMessageDirectory(directory.people, directory.projects)
  const ackNotices = notices.state === 'ok' ? notices.notices.filter((n) => n.requiresAck) : []
  const acks = await listNoticeAcks(ackNotices.map((n) => n.id))
  const reports = Object.fromEntries(
    ackNotices.map((n) => [n.id, ackReport(n.projects.length || n.users.length ? { projects: n.projects, users: n.users } : { modules: n.modules }, acks.get(n.id) ?? [], sites)]),
  )

  if (result.state !== 'ok') {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        {result.state === 'missing' ? (
          <EmptyState title={t('missingTitle')} body={t('missingBody')} />
        ) : (
          <Notice tone="error">{t('loadError', { message: result.message })}</Notice>
        )}
      </PageShell>
    )
  }

  return (
    <PageShell>
      <WhatsNewAdmin
        updates={result.updates}
        modules={MODULE_REGISTRY.map((m) => ({ id: m.id, label: m.label }))}
        languages={WHATS_NEW_LOCALES.map((code) => ({ code, name: PLATFORM_LOCALES[code].nativeName }))}
      />
      {/* Announcements (migration 045): 'missing' = not applied yet, the section says so. */}
      {notices.state === 'error' ? (
        <Notice tone="error" className="mt-10">
          {t('loadError', { message: notices.message })}
        </Notice>
      ) : (
        <AnnouncementsAdmin
          notices={notices.state === 'ok' ? notices.notices : []}
          missing={notices.state === 'missing'}
          sites={sites}
          reports={reports}
          modules={MODULE_REGISTRY.map((m) => ({ id: m.id, label: m.label }))}
          languages={WHATS_NEW_LOCALES.map((code) => ({ code, name: PLATFORM_LOCALES[code].nativeName }))}
        />
      )}
    </PageShell>
  )
}

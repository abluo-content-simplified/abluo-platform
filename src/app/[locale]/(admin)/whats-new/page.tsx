import { notFound } from 'next/navigation'
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
  const result = await listProductUpdatesForAdmin()

  if (result.state !== 'ok') {
    return (
      <PageShell>
        <PageHeader title={t('title')} />
        {result.state === 'missing' ? (
          <EmptyState title={t('missingTitle')} body={t('missingBody')} />
        ) : (
          <div role="alert" className="rounded-2xl border border-destructive px-4 py-3 text-sm text-destructive">
            {t('loadError', { message: result.message })}
          </div>
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
    </PageShell>
  )
}

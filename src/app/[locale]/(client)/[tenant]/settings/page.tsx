import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { FORM_NOTIFICATIONS_READ, loadFormNotifications } from '@/lib/notifications/form-recipients-service'
import { SettingsForm } from '@/components/client/settings/SettingsForm'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Settings (Tom, 2026-10-18; 2026-10-28). The client's own
 * settings for their website. Today: Form notifications — who receives the
 * emails of the website's forms. (The affiliate programs that were here live
 * only in Connected Apps since 2026-10-26.)
 *
 * Needs `site.details.read` (Owner, Site admin, Editor); only Owner and Site
 * admin can change anything, and a support visit only once the client allowed
 * edits. Anyone else gets a 404, exactly like a page that does not exist.
 */
export const dynamic = 'force-dynamic'

async function SettingsPageInner({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/settings`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(FORM_NOTIFICATIONS_READ)) notFound()

  const locale = await getLocale()
  let notifications
  try {
    notifications = await span('loadFormNotifications', () => loadFormNotifications(ctx, grant.projectId, { locale }))
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <SettingsForm
        projectSlug={projectSlug}
        notifications={notifications}
        supportVisit={Boolean(ctx.support)}
        readOnly={ctx.support ? !ctx.support.writesAllowed : false}
      />
      {perfBeacon()}
    </PageShell>
  )
}

export default function SettingsPage(props: Parameters<typeof SettingsPageInner>[0]) {
  return traced('settings.page', () => SettingsPageInner(props))
}

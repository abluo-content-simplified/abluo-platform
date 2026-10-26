import { notFound, redirect } from 'next/navigation'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { SettingsError, loadSettings, SETTINGS_READ } from '@/lib/settings/service'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import { SettingsForm } from '@/components/client/settings/SettingsForm'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Settings (Tom, 2026-10-18): the client's own business
 * facts. First version: Amazon tracking IDs and the affiliate disclosure
 * (shown only when the Catalogue is installed). Contact and legal details are
 * added later as further sections. Needs `site.details.read` (Owner, Site
 * admin, Editor); only Owner and Site admin can change anything. Anyone else
 * gets a 404, exactly like a page that does not exist.
 */
export const dynamic = 'force-dynamic'

async function SettingsPageInner({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/settings`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(SETTINGS_READ)) notFound()

  let settings
  try {
    settings = await span('loadSettings', () => loadSettings(ctx, grant.projectId))
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof SettingsError && error.code === 'not_found') notFound()
    throw error
  }

  // The website's own standard sentence per site language, from the function the website uses.
  const standardWording = Object.fromEntries(settings.locales.map((l) => [l, getCatalogueWebsiteMessages(l).affiliateDisclosureDefault]))

  return (
    <PageShell>
      <SettingsForm projectSlug={projectSlug} initial={settings} standardWording={standardWording} readOnly={Boolean(ctx.support)} />
      {perfBeacon()}
    </PageShell>
  )
}

export default function SettingsPage(props: Parameters<typeof SettingsPageInner>[0]) {
  return traced('settings.page', () => SettingsPageInner(props))
}

import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { listProjectPeople } from '@/lib/people/service'
import { PageShell } from '@/components/app/ui/PageShell'
import { PeopleBrowser } from '@/components/client/people/PeopleBrowser'

/**
 * Client dashboard — People (ADR-028). Owners and Site admins see who has
 * access to the site, invite people, change their access and cancel pending
 * invitations. Anyone else gets a 404, exactly like a site they do not have.
 */
export default async function PeoplePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/people`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const view = await listProjectPeople(ctx, grant.projectId)
  if (!view) notFound()

  const t = await getTranslations('clientDashboard')
  return (
    <PageShell>
      <PeopleBrowser title={t('people.title')} projectSlug={projectSlug} locale={await getLocale()} view={view} />
    </PageShell>
  )
}

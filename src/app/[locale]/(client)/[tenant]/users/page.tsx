import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { listProjectPeople } from '@/lib/users/service'
import { PageShell } from '@/components/app/ui/PageShell'
import { UsersBrowser } from '@/components/client/users/UsersBrowser'

/**
 * Client dashboard — Users (ADR-028; was "People" until ADR-043 gave that name to the People module). Owners and Site admins see who has
 * access to the site, invite people, change their access and cancel pending
 * invitations. Anyone else gets a 404, exactly like a site they do not have.
 */
export default async function UsersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/users`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const view = await listProjectPeople(ctx, grant.projectId)
  if (!view) notFound()

  const t = await getTranslations('clientDashboard')
  return (
    <PageShell>
      <UsersBrowser title={t('users.title')} projectSlug={projectSlug} locale={await getLocale()} view={view} />
    </PageShell>
  )
}

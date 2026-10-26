import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { ACCESS_MANAGE_PERMISSION, ACCESS_READ_PERMISSION, loadAccessDashboard } from '@/lib/access/dashboard'
import { PageShell } from '@/components/app/ui/PageShell'
import { AccessScreen } from '@/components/client/access/AccessScreen'

export const dynamic = 'force-dynamic'

/**
 * Client dashboard — Access (ADR-040 B2.5): the groups of visitors who may
 * open members-only pages and protected documents, their passwords, the
 * documents themselves and who may see each page.
 *
 * `members.access.read` on THIS project, with the Access module installed;
 * anyone else — and every project without the module — gets a 404, like a
 * page that does not exist. Changing anything needs `members.access.manage`
 * and is re-checked by every action; a support visit is read-only.
 */
export default async function AccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const tab = (await searchParams).tab
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/access`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.enabledModuleIds.includes('members') || !grant.permissions.includes(ACCESS_READ_PERMISSION)) notFound()

  const locale = await getLocale()
  let data
  try {
    data = await loadAccessDashboard(ctx, grant.projectId, locale)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <AccessScreen
        projectSlug={projectSlug}
        data={data}
        canManage={grant.permissions.includes(ACCESS_MANAGE_PERMISSION) && !ctx.support}
        supportVisit={Boolean(ctx.support)}
        initialTab={typeof tab === 'string' ? tab : null}
      />
    </PageShell>
  )
}

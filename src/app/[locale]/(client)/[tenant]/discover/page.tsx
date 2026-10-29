import { notFound, redirect } from 'next/navigation'
import { PageShell } from '@/components/app/ui/PageShell'
import { DiscoverModules } from '@/components/client/discover/DiscoverModules'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { buildDiscover } from '@/lib/modules/discover'
import { ticketAccess } from '@/lib/support-tickets/access'

/**
 * Client dashboard — More You Can Add. A showcase of the modules this site does
 * not have yet; visible to every role with a grant on the project. Nothing can
 * be activated here. "Tell me more" opens a pre-filled support request, shown
 * only to people who may send one (same check as "Report a Problem").
 */
export const dynamic = 'force-dynamic'

export default async function DiscoverPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/discover`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()
  const canAsk = Boolean(ticketAccess(ctx, projectSlug)?.canWrite)

  return (
    <PageShell>
      <DiscoverModules projectSlug={projectSlug} groups={buildDiscover(grant.enabledModuleIds)} canAsk={canAsk} />
    </PageShell>
  )
}

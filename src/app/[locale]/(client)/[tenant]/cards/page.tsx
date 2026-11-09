import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { DIGITAL_CARD_READ_PERMISSION, DIGITAL_CARD_WRITE_PERMISSION, listDigitalCards, type DigitalCardList } from '@/lib/api/digital-cards'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { DigitalCardsBrowser } from '@/components/client/digital-cards/DigitalCardsBrowser'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Digital Cards (ADR-049), in the shared page frame: the
 * project's cards as a Records list, the site card first. Reads through
 * `listDigitalCards` (digital-cards.read, project-scoped); a project without
 * the module gets a 404 like any unknown page.
 */
export const dynamic = 'force-dynamic'

export default async function DigitalCardsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: projectSlug } = await params
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/cards`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(DIGITAL_CARD_READ_PERMISSION)) notFound()

  let list: DigitalCardList
  try {
    list = await listDigitalCards(ctx, grant.projectId)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }

  return (
    <PageShell>
      <DigitalCardsBrowser
        projectSlug={projectSlug}
        list={list}
        canWrite={grant.permissions.includes(DIGITAL_CARD_WRITE_PERMISSION)}
        peopleInstalled={grant.enabledModuleIds.includes('people')}
      />
    </PageShell>
  )
}

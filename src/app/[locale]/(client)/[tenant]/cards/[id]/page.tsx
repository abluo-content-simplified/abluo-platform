import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  DIGITAL_CARD_DELETE_PERMISSION,
  DIGITAL_CARD_READ_PERMISSION,
  DIGITAL_CARD_STATS_PERMISSION,
  DIGITAL_CARD_WRITE_PERMISSION,
  DigitalCardError,
  getDigitalCard,
  isDigitalCardId,
  type DigitalCardSnapshot,
} from '@/lib/api/digital-cards'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { DigitalCardEditor } from '@/components/client/digital-cards/DigitalCardEditor'
import { DIGITAL_CARD_EDITOR_TABS, type EditorTab } from '@/components/client/digital-cards/editor-tabs'
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * One Digital Card's editor (client dashboard · Digital Cards, ADR-049), in the
 * shared page frame. Shows the draft when there is one, else the published
 * card; GET never creates a draft (the editor opens one on the first change).
 * Needs digital-cards.read; without digital-cards.write the editor is
 * read-only; statistics need digital-cards.stats.read. Anything not this
 * project's card is a 404. `?tab=share|stats` opens that tab (the Analytics
 * page links each card to its Statistics).
 */
export const dynamic = 'force-dynamic'

export default async function DigitalCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>
  searchParams?: Promise<{ tab?: string | string[] }>
}) {
  const { tenant: projectSlug, id } = await params
  const rawTab = (await searchParams)?.tab
  const initialTab: EditorTab = (DIGITAL_CARD_EDITOR_TABS as readonly string[]).includes(String(rawTab)) ? (rawTab as EditorTab) : 'card'
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/cards/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isDigitalCardId(id) || !grant.permissions.includes(DIGITAL_CARD_READ_PERMISSION)) notFound()

  let card: DigitalCardSnapshot
  try {
    card = await getDigitalCard(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof DigitalCardError && error.code === 'not_found') notFound()
    throw error
  }

  return (
    <PageShell>
      <DigitalCardEditor
        key={card.id}
        projectSlug={projectSlug}
        initial={card}
        canWrite={grant.permissions.includes(DIGITAL_CARD_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(DIGITAL_CARD_DELETE_PERMISSION)}
        canSeeStats={grant.permissions.includes(DIGITAL_CARD_STATS_PERMISSION)}
        canTranslate={grant.enabledModuleIds.includes('translate')}
        canSetFocus={grant.permissions.includes(MEDIA_MANAGE_PERMISSION)}
        initialTab={initialTab}
      />
    </PageShell>
  )
}

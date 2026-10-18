import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { loadCatalogueNavLabel } from '@/lib/api/catalogue-drafts'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { manageableTaxonomyModules } from '@/lib/taxonomy/manageable'
import { internalTagScopes } from '@/lib/tags/internal-tags'
import { TaxonomyError, listTerms, type TermList } from '@/lib/taxonomy/service'
import { TaxonomyManager, type TaxonomyTab } from '@/components/client/taxonomy/TaxonomyManager'
import { listKey } from '@/components/client/taxonomy/taxonomy-view'
import type { SectionKind } from '@/components/client/taxonomy/TermSection'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Categories & Tags (ADR-033 Amendment J, slice 4): the one
 * place to keep the categories (and later tags) of every installed module that
 * has them. Reads through the taxonomy service (the module's read permission,
 * project-scoped); a person who can also change terms gets the editing
 * controls (`list.canWrite`, re-checked by every action). Tabs: one per module
 * with terms, then Media and Galleries (internal tags). A project with none of
 * them, or a person with no permission for any, gets a 404. `?tab=` picks the
 * tab to open first.
 */
export const dynamic = 'force-dynamic'

async function TaxonomyPageInner({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const query = await searchParams
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/taxonomy`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const manageable = manageableTaxonomyModules(grant)
  const internal = internalTagScopes(grant)
  // Nothing to manage (no module with terms, no media or gallery tags): there is no page.
  if (manageable.length === 0 && internal.length === 0) notFound()

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard.nav')
  // A project's own name for the Catalogue (navLabel) is used for the module, like the sidebar does.
  const catalogueLabel = manageable.some((m) => m.module === 'catalogue') ? await loadCatalogueNavLabel(projectSlug, locale).catch(() => null) : null
  // Taxonomy tabs first (registry order), then Media, then Galleries.
  const tabs: TaxonomyTab[] = [
    ...manageable.map((m): TaxonomyTab => ({
      type: 'terms',
      id: m.module,
      kinds: m.kinds as SectionKind[],
      canWrite: m.canWrite,
      label: (m.module === 'catalogue' && catalogueLabel) || (t.has(m.module) ? t(m.module) : m.module),
    })),
    ...(['media', 'galleries'] as const).flatMap((scope): TaxonomyTab[] => {
      const found = internal.find((x) => x.scope === scope)
      return found ? [{ type: 'internal', id: scope, canWrite: found.canWrite, label: t(scope === 'media' ? 'media' : 'gallery') }] : []
    }),
  ]
  // `?tab=` (or the older `?module=`) picks what opens first; the first tab otherwise.
  const wanted = typeof query.tab === 'string' ? query.tab : typeof query.module === 'string' ? query.module : null
  const active = tabs.find((x) => x.id === wanted) ?? tabs[0]

  // Only the open tab's lists are read here; the others load when their tab opens.
  const initialLists: Record<string, TermList> = {}
  if (active.type === 'terms') {
    try {
      const read = await Promise.all(active.kinds.map((kind) => span('listTerms', () => listTerms(ctx, grant.projectId, active.id, kind))))
      active.kinds.forEach((kind, i) => {
        initialLists[listKey(active.id, kind)] = read[i]
      })
    } catch (error) {
      if (error instanceof TenantAuthorizationError) notFound()
      if (error instanceof TaxonomyError && error.code === 'kind_not_declared') notFound()
      throw error
    }
  }

  return (
    <PageShell>
      <TaxonomyManager projectSlug={projectSlug} tabs={tabs} activeId={active.id} initialLists={initialLists} />
      {perfBeacon()}
    </PageShell>
  )
}

export default function TaxonomyPage(props: Parameters<typeof TaxonomyPageInner>[0]) {
  return traced('taxonomy.page', () => TaxonomyPageInner(props))
}

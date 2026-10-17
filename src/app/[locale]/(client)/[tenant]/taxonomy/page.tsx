import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { span, traced } from '@/lib/perf/timing'
import { perfBeacon } from '@/lib/perf/beacon'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { loadCatalogueNavLabel } from '@/lib/api/catalogue-drafts'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { manageableTaxonomyModules } from '@/lib/taxonomy/manageable'
import { TaxonomyError, listTerms } from '@/lib/taxonomy/service'
import { TaxonomyManager, type ModuleOption } from '@/components/client/taxonomy/TaxonomyManager'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Categories & Tags (ADR-033 Amendment J, slice 4): the one
 * place to keep the categories (and later tags) of every installed module that
 * has them. Reads through the taxonomy service (the module's read permission,
 * project-scoped); a person who can also change terms gets the editing
 * controls (`list.canWrite`, re-checked by every action). A project without a
 * module that has terms, or a person with no permission for any, gets a 404.
 * `?module=` / `?kind=` pick what to open first.
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
  if (manageable.length === 0) notFound()
  const first = manageable.find((m) => m.module === query.module) ?? manageable[0]
  const kind = typeof query.kind === 'string' && first.kinds.includes(query.kind) ? query.kind : first.kinds[0]

  const locale = await getLocale()
  const t = await getTranslations('clientDashboard.nav')
  // A project's own name for the Catalogue (navLabel) is used for the module, like the sidebar does.
  const catalogueLabel = manageable.some((m) => m.module === 'catalogue') ? await loadCatalogueNavLabel(projectSlug, locale).catch(() => null) : null
  const modules: ModuleOption[] = manageable.map((m) => ({
    id: m.module,
    kinds: m.kinds,
    label: (m.module === 'catalogue' && catalogueLabel) || (t.has(m.module) ? t(m.module) : m.module),
  }))

  let list
  try {
    list = await span('listTerms', () => listTerms(ctx, grant.projectId, first.module, kind))
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof TaxonomyError && error.code === 'kind_not_declared') notFound()
    throw error
  }

  return (
    <PageShell>
      <TaxonomyManager projectSlug={projectSlug} modules={modules} initial={list} />
      {perfBeacon()}
    </PageShell>
  )
}

export default function TaxonomyPage(props: Parameters<typeof TaxonomyPageInner>[0]) {
  return traced('taxonomy.page', () => TaxonomyPageInner(props))
}

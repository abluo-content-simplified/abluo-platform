import { notFound, redirect } from 'next/navigation'
import { span, traced } from '@/lib/perf/timing'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { catalogueAbilities, getCatalogueSite, listCatalogue } from '@/lib/api/catalogue-drafts'
import { CatalogueBrowser } from '@/components/client/catalogue/CatalogueBrowser'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — the Catalogue (ADR-033, spec §10.2): Items (default),
 * Collections and Option lists in one entry, titled with the project's own
 * name for it (`navLabel`, D12 — presentation only). Reads through
 * `listCatalogue` (catalogue.item.read, project-scoped, every state); a
 * project without the module, or a person without the permission, gets a 404.
 */
export const dynamic = 'force-dynamic'

async function CataloguePageInner({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const query = await searchParams
  const ctx = await span('auth', () => getTenantAuthorizationContext({ purpose: 'render' }))
  if (!ctx) redirect(`/login?next=/${projectSlug}/catalogue`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  let lists, site
  try {
    ;[lists, site] = await Promise.all([span('listCatalogue', () => listCatalogue(ctx, grant.projectId)), span('site', () => getCatalogueSite(ctx, grant.projectId))])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const locale = await getLocale()
  const t = await getTranslations('clientDashboard.nav')
  const title = site.config.navLabel[locale]?.trim() || t('catalogue')

  return (
    <PageShell>
      <CatalogueBrowser
        projectSlug={projectSlug}
        title={title}
        lists={lists}
        site={{ defaultLocale: site.defaultLocale, timeZone: site.timeZone, currency: site.config.currency, categories: site.config.categories }}
        can={catalogueAbilities(grant)}
        initialView={typeof query.view === 'string' ? query.view : null}
        initialStatus={typeof query.status === 'string' ? query.status : null}
      />
    </PageShell>
  )
}

export default function CataloguePage(props: Parameters<typeof CataloguePageInner>[0]) {
  return traced('catalogue.listPage', () => CataloguePageInner(props))
}

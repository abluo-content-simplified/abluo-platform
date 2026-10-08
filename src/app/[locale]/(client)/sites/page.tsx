import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { getFormsDashboard } from '@/lib/api/dashboard/forms'
import { getSiteStatus } from '@/lib/api/dashboard/site'
import { buildTenantSurfaces, hasWidget } from '@/lib/client/surfaces'
import { filterSwitchableProjects, loadProjectSummaries, statusesOf } from '@/lib/client/switchable-projects'
import { overviewNeeded, sortSiteCards } from '@/lib/client/sites-overview'
import { dashboardHomeHref } from '@/lib/modules/client-navigation'
import { Link } from '@/i18n/navigation'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { PageShell } from '@/components/app/ui/PageShell'
import { SiteStatus } from '@/components/client/home/SiteStatus'

/**
 * "Your websites" — where the client dashboard lands after sign-in
 * (Tom, 2026-10-08). Someone with ONE site goes straight to that site's Home;
 * someone with several sees one card per site (status, their role there, open
 * contact requests) and picks one. The project switcher links back here.
 *
 * Reads only what each grant allows: contact-request numbers only where the
 * person may see them (same surface rule as Home), through the same enforced
 * providers as Home. A source that fails just leaves its number out.
 */
export default async function SitesOverviewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=${encodeURIComponent(`/${locale}/sites`)}`)

  const t = await getTranslations('clientDashboard.sites')
  const tRoles = await getTranslations('app.roles')

  const summaries = await loadProjectSummaries(ctx.projects.map((g) => g.projectId))
  const grants = filterSwitchableProjects(ctx.projects, statusesOf(summaries))

  if (grants.length === 1) redirect(`/${locale}${dashboardHomeHref(grants[0].projectSlug)}`)

  if (!overviewNeeded(grants.length)) {
    const tShell = await getTranslations('clientDashboard.shell')
    return (
      <main className="p-4 md:p-6">
        <PageShell>
          <EmptyState title={tShell('entryTitle')} body={tShell('noProjects')} />
        </PageShell>
      </main>
    )
  }

  const cards = sortSiteCards(
    await Promise.all(
      grants.map(async (grant) => {
        const showRequests = hasWidget(buildTenantSurfaces(grant), 'glance.requests')
        const [forms, site] = await Promise.all([
          showRequests ? getFormsDashboard(ctx, grant.projectId, { attentionHref: null }) : null,
          getSiteStatus(ctx, grant.projectId),
        ])
        const s = summaries[grant.projectId]
        return {
          projectSlug: grant.projectSlug,
          name: s?.name?.trim() || grant.projectSlug,
          domain: s?.domain ?? null,
          role: tRoles.has(grant.role) ? tRoles(grant.role) : grant.role,
          openRequests: forms?.glance?.open ?? null,
          newThisWeek: forms?.glance?.week ?? null,
          site,
        }
      }),
    ),
  )

  return (
    <main className="p-4 md:p-6">
      <PageShell>
        <PageHeader title={t('title')} />
        <p className="-mt-2 text-[0.9375rem] text-muted-foreground">{t('intro', { count: cards.length })}</p>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li key={c.projectSlug} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <Link
                href={dashboardHomeHref(c.projectSlug)}
                className="group -m-1 rounded-xl p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="block text-lg leading-7 font-semibold group-hover:underline">{c.name}</span>
                <span className="block truncate text-sm text-muted-foreground">{c.domain ?? c.projectSlug}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{t('yourRole', { role: c.role })}</span>
              </Link>
              {c.openRequests !== null ? (
                <p className="text-sm">
                  {c.openRequests > 0 ? (
                    <span className="font-semibold">{t('openRequests', { count: c.openRequests })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t('noOpenRequests')}</span>
                  )}
                  {c.newThisWeek ? <span className="text-muted-foreground"> · {t('newThisWeek', { count: c.newThisWeek })}</span> : null}
                </p>
              ) : null}
              <div className="mt-auto flex flex-col gap-3">
                {c.site ? <SiteStatus state={c.site.state} host={c.site.host} url={c.site.url} /> : null}
                <Link
                  href={dashboardHomeHref(c.projectSlug)}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-action px-4 text-[0.9375rem] font-medium text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {t('open')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </PageShell>
    </main>
  )
}

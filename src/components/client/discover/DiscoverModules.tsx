import { getTranslations } from 'next-intl/server'
import { ButtonLink } from '@/components/app/ui/Button'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { DISCOVER_ICONS, discoverRequestHref, type DiscoverGroup } from '@/lib/modules/discover'

/**
 * "More You Can Add": the modules this site does not have yet, grouped like the
 * sidebar, each with one line and — when the person may send support requests —
 * a "Tell me more" button that opens a pre-filled new request. A showcase only:
 * nothing can be switched on from here. Server component, top-aligned rows.
 */
export async function DiscoverModules({ projectSlug, groups, canAsk }: { projectSlug: string; groups: DiscoverGroup[]; canAsk: boolean }) {
  const t = await getTranslations('clientDashboard')
  return (
    <>
      <PageHeader title={t('discover.title')} />
      <p className="max-w-2xl text-[0.9375rem] leading-6 text-muted-foreground">{t('discover.intro')}</p>
      {groups.length === 0 ? (
        <EmptyState title={t('discover.emptyTitle')} body={t('discover.emptyBody')} />
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`discover-${g.id}`} className="flex flex-col gap-3">
            <SectionHeading id={`discover-${g.id}`} title={t(`navGroups.${g.id}`)} />
            <ul className="flex flex-col gap-3">
              {g.moduleIds.map((id) => {
                const name = t(`nav.${id}`)
                return (
                  <Panel as="li" key={id} className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
                    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[0.625rem] bg-accent text-accent-foreground">
                      <AppIcon d={DISCOVER_ICONS[id]} size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[0.9375rem] leading-6 font-semibold">{name}</h3>
                      <p className="text-sm leading-5 text-muted-foreground">{t(`discover.modules.${id}`)}</p>
                    </div>
                    {canAsk ? (
                      <ButtonLink variant="secondary" className="shrink-0" href={discoverRequestHref(projectSlug, t('discover.requestSubject', { module: name }), t('discover.requestBody', { module: name }))}>
                        {t('discover.tellMore')}
                        <span className="sr-only"> — {name}</span>
                      </ButtonLink>
                    ) : null}
                  </Panel>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </>
  )
}

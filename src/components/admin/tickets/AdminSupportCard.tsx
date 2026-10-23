import { getTranslations } from 'next-intl/server'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { LocalDate } from '@/components/app/ui/list/cells'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { SUPPORT_CARD_LINKS } from '@/lib/support-tickets/admin-view'
import type { AdminSupportOverview } from '@/lib/support-tickets/service'
import { StatusPill } from './ticket-bits'

/**
 * The Support card on the admin home (ADR-039): what is new, what waits for a
 * client and what is urgent — each number opens the list already filtered —
 * and the few tickets with the most recent activity. The caller leaves the
 * card out when the ticket service is unavailable.
 */
export async function AdminSupportCard({ overview }: { overview: AdminSupportOverview }) {
  const t = await getTranslations('admin.supportTickets.card')
  const tList = await getTranslations('admin.supportTickets')
  return (
    <section aria-labelledby="admin-support" className="flex flex-col gap-3">
      <SectionHeading id="admin-support" title={t('heading')} />
      <StatGrid>
        <StatTile label={t('new.label')} value={overview.newCount} sub={t('new.sub')} href={SUPPORT_CARD_LINKS.new} />
        <StatTile label={t('waiting.label')} value={overview.waitingCount} sub={t('waiting.sub')} href={SUPPORT_CARD_LINKS.waiting} />
        <StatTile label={t('high.label')} value={overview.highOpenCount} sub={t('high.sub')} href={SUPPORT_CARD_LINKS.high} />
      </StatGrid>
      {overview.recent.length === 0 ? (
        <Panel>
          <p className="text-sm leading-5 text-muted-foreground">{t('none')}</p>
        </Panel>
      ) : (
        <ul aria-label={t('recent')} className="flex flex-col gap-3">
          {overview.recent.map((x) => (
            <ListRow key={x.id} href={`/support/${x.id}`}>
              <span className="flex items-center gap-2 font-mono text-xs leading-5 text-muted-foreground">
                {x.unread ? (
                  <>
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-foreground" />
                    <span className="sr-only">{tList('unread')}</span>
                  </>
                ) : null}
                {x.reference}
                {x.project?.name ? <span className="font-sans">· {x.project.name}</span> : null}
              </span>
              <span className="line-clamp-2 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{x.title}</span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusPill status={x.status} />
                <LocalDate iso={x.lastActivityAt} className="text-sm leading-5 text-muted-foreground" />
              </span>
            </ListRow>
          ))}
        </ul>
      )}
    </section>
  )
}

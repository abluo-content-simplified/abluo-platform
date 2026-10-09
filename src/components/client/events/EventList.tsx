'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { EventListItem } from '@/lib/api/event-drafts'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { EVENT_ICONS, EVENT_PRIMARY, EventStatePill, eventState, useEventDates } from './event-bits'

/**
 * Events (client dashboard · agenda): "Coming up" then "Past", one calm card
 * per event — photo, title, when, where, and its state. A card opens the
 * event's page. "New event" when this person can write events.
 */
export function EventList({ projectSlug, events, canWrite }: { projectSlug: string; events: EventListItem[]; canWrite: boolean }) {
  const t = useTranslations('clientDashboard.events.list')
  const base = `/${projectSlug}/agenda`
  const upcoming = events.filter((e) => e.timing !== 'past')
  const past = events.filter((e) => e.timing === 'past')

  const newButton = canWrite ? (
    <Link href={`${base}/new`} className={EVENT_PRIMARY}>
      {EVENT_ICONS.plus}
      {t('new')}
    </Link>
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} actions={newButton} />
      <p className="-mt-3 text-[0.9375rem] leading-6 text-muted-foreground">{t('helper')}</p>

      {events.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <>
          <EventGroup id="events-upcoming" title={t('upcoming')} empty={t('noUpcoming')} events={upcoming} base={base} />
          {past.length ? <EventGroup id="events-past" title={t('past')} events={past} base={base} /> : null}
        </>
      )}
    </div>
  )
}

function EventGroup({ id, title, empty, events, base }: { id: string; title: string; empty?: string; events: EventListItem[]; base: string }) {
  const t = useTranslations('clientDashboard.events.list')
  const dates = useEventDates()
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-[1.0625rem] leading-7 font-semibold text-foreground">
        {title} <span className="font-normal text-muted-foreground tabular-nums">· {events.length}</span>
      </h2>
      {events.length === 0 && empty ? (
        <EmptyState compact titleAs="p" title={empty} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {events.map((e) => {
            const name = e.title || t('untitled')
            const when = dates(e.startDate, e.endDate)
            return (
              <li key={e.id} className="min-w-0">
                <Link
                  href={`${base}/${e.id}`}
                  className="flex min-h-11 gap-3 rounded-2xl border border-border p-3 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <MediaFrame src={e.coverThumb} alt="" size={{ width: '5.5rem', height: '5.5rem' }} className="rounded-xl" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="line-clamp-2 text-[0.9375rem] leading-5 font-semibold text-foreground">{name}</p>
                    {when ? (
                      <p className="flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
                        <span className="shrink-0">{EVENT_ICONS.calendar}</span>
                        <span className="truncate">{when}</span>
                      </p>
                    ) : null}
                    {e.location ? (
                      <p className="flex items-center gap-1.5 text-sm leading-5 text-muted-foreground">
                        <span className="shrink-0">{EVENT_ICONS.pin}</span>
                        <span className="truncate">{e.location}</span>
                      </p>
                    ) : null}
                    <div className="mt-auto pt-1">
                      <EventStatePill state={eventState(e)} />
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

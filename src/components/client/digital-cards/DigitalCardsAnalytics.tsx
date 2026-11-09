'use client'

import { useFormatter, useLocale } from 'next-intl'
import type { DigitalCardsOverview } from '@/lib/api/digital-cards'
import { digitalCardSourceName, formatDigitalCardsMessage, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { ButtonLink } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { RankedList } from '@/components/app/ui/RankedList'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { digitalCardEditorHref } from './editor-tabs'

/** Clicks per 100 visits, one decimal (as DigitalCardStats). */
const ctrOf = (c: { visits: number; clicks: number }) => (c.visits > 0 ? Math.round((c.clicks / c.visits) * 1000) / 10 : 0)

/**
 * The Digital Cards block of the Analytics page (ADR-049 Amendment A): all the
 * project's cards together — visits, clicks, click-through rate, the busiest
 * cards (each opens its own Statistics tab) and where visits come from. Shown
 * only when the module is installed and the reader holds
 * digital-cards.stats.read (the page decides). `overview` null = the read
 * failed.
 */
export function DigitalCardsAnalytics({ projectSlug, overview }: { projectSlug: string; overview: DigitalCardsOverview | null }) {
  const m = getDigitalCardsMessages(useLocale())
  const e = m.editor
  const c = m.card
  const format = useFormatter()

  return (
    <section aria-labelledby="analytics-digital-cards" className="flex flex-col gap-3">
      <SectionHeading id="analytics-digital-cards" title={c.analyticsTitle} seeAllHref={`/${projectSlug}/cards`} />
      <p className="text-sm leading-5 text-muted-foreground">
        {overview?.available ? `${formatDigitalCardsMessage(c.analyticsPeriod, { days: overview.days })} · ` : ''}
        {c.analyticsHint}
      </p>
      {overview === null ? (
        <Notice tone="error">{c.analyticsFailed}</Notice>
      ) : !overview.available ? (
        <Notice tone="info">{c.analyticsUnavailable}</Notice>
      ) : (
        <>
          <StatGrid label={c.analyticsTitle}>
            <StatTile label={e.visits} value={overview.totals.visits} />
            <StatTile label={e.clicks} value={overview.totals.clicks} />
            <StatTile label={e.ctr} value={ctrOf(overview.totals)} sub={e.ctrSub} />
          </StatGrid>
          {overview.totals.visits === 0 && overview.totals.clicks === 0 ? (
            <p className="text-sm leading-5 text-muted-foreground">{c.analyticsNoData}</p>
          ) : (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
              <Panel as="section" aria-labelledby="analytics-cards-top" className="flex flex-col gap-3">
                <h3 id="analytics-cards-top" className="text-[0.9375rem] leading-6 font-semibold text-foreground">
                  {c.analyticsTopCards}
                </h3>
                <ul className="divide-y divide-border-subtle">
                  {overview.cards.slice(0, 8).map((card) => {
                    const name = card.kind === 'site' ? overview.siteName || e.siteTitle : card.name || e.personFallback
                    return (
                      <li key={card.id} className="flex items-start justify-between gap-3 py-2">
                        <ButtonLink
                          variant="link"
                          className="min-w-0 text-left text-sm"
                          href={digitalCardEditorHref(projectSlug, card.id, 'stats')}
                          aria-label={formatDigitalCardsMessage(c.analyticsOpen, { name })}
                        >
                          {name}
                        </ButtonLink>
                        <span className="shrink-0 pt-2.5 text-sm leading-5 text-muted-foreground tabular-nums">
                          {e.visits} {format.number(card.visits)} · {e.clicks} {format.number(card.clicks)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </Panel>
              <Panel as="section" aria-labelledby="analytics-cards-sources" className="flex flex-col gap-3">
                <h3 id="analytics-cards-sources" className="text-[0.9375rem] leading-6 font-semibold text-foreground">
                  {c.analyticsSources}
                </h3>
                <RankedList label={c.analyticsSources} items={overview.sources.map((s) => ({ label: digitalCardSourceName(m, s.source), value: s.visits }))} max={8} />
              </Panel>
            </div>
          )}
        </>
      )}
    </section>
  )
}

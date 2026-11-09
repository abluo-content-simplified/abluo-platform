'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import type { DigitalCardStatsRead } from '@/lib/api/digital-card-stats'
import { DIGITAL_CARD_STATS_RANGES } from '@/lib/modules/digital-cards/model'
import { getDigitalCardStatsAction } from '@/app/[locale]/(client)/[tenant]/cards/actions'
import { digitalCardSourceName, getDigitalCardsMessages } from '@/lib/i18n/digital-cards-messages'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { RankedList } from '@/components/app/ui/RankedList'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'

type Range = `${(typeof DIGITAL_CARD_STATS_RANGES)[number]}`
const H2 = 'text-[1.0625rem] leading-7 font-semibold text-foreground'

/** Clicks per 100 visits, one decimal (same formula as the stats store's clickThroughRate, which is server-only). */
const ctrOf = (c: { visits: number; clicks: number }) => (c.visits > 0 ? Math.round((c.clicks / c.visits) * 1000) / 10 : 0)

/**
 * Statistics of one card (ADR-049 D11): visits, clicks and click-through rate,
 * clicks per link, where visits come from, over 7 / 30 / 90 / 365 days.
 * Always "visits", never "people". Before migration 068 / before the card has
 * been live: "Statistics start once the card is live".
 */
export function DigitalCardStats({ projectSlug, cardId, linkLabels }: { projectSlug: string; cardId: string; /** link key → what the editor calls it */ linkLabels: Record<string, string> }) {
  const m = getDigitalCardsMessages(useLocale())
  const e = m.editor
  const [range, setRange] = useState<Range>('30')
  const [result, setResult] = useState<{ range: Range; read: DigitalCardStatsRead | 'failed' } | null>(null)

  useEffect(() => {
    let live = true
    getDigitalCardStatsAction({ projectSlug, id: cardId, days: Number(range) })
      .then((r) => live && setResult({ range, read: r.ok ? r.stats : 'failed' }))
      .catch(() => live && setResult({ range, read: 'failed' }))
    return () => {
      live = false
    }
  }, [projectSlug, cardId, range])

  const loading = !result || result.range !== range
  const read = loading ? null : result.read
  const labels: Record<Range, string> = { '7': e.range7, '30': e.range30, '90': e.range90, '365': e.range365 }

  return (
    <Panel as="section" aria-labelledby="card-stats" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="card-stats" className={H2}>
            {e.statsTitle}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">{e.statsPrivacy}</p>
        </div>
        <SegmentedControl
          label={e.statsRange}
          appearance="soft"
          value={range}
          onChange={setRange}
          options={DIGITAL_CARD_STATS_RANGES.map((d) => ({ value: `${d}` as Range, label: labels[`${d}` as Range] }))}
        />
      </div>
      {loading ? (
        <div aria-busy="true" aria-label={e.statsLoading} className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : read === 'failed' ? (
        <Notice tone="error">{e.statsFailed}</Notice>
      ) : !read || !read.available ? (
        <Notice tone="info">{e.statsUnavailable}</Notice>
      ) : (
        <>
          <StatGrid label={e.statsTitle}>
            <StatTile label={e.visits} value={read.stats.totals.visits} />
            <StatTile label={e.clicks} value={read.stats.totals.clicks} />
            <StatTile label={e.ctr} value={ctrOf(read.stats.totals)} sub={e.ctrSub} />
          </StatGrid>
          {read.stats.totals.visits === 0 && read.stats.totals.clicks === 0 ? (
            <p className="text-sm leading-5 text-muted-foreground">{e.statsNoData}</p>
          ) : (
            <div className="grid items-start gap-5 md:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h3 className="text-[0.9375rem] leading-6 font-medium text-foreground">{e.perLink}</h3>
                <RankedList label={e.perLink} items={read.stats.links.map((l) => ({ label: linkLabels[l.linkKey] ?? e.removedLink, value: l.clicks }))} />
              </div>
              <div className="min-w-0 space-y-2">
                <h3 className="text-[0.9375rem] leading-6 font-medium text-foreground">{e.sources}</h3>
                <RankedList label={e.sources} items={read.stats.sources.map((s) => ({ label: digitalCardSourceName(m, s.source), value: s.visits }))} />
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

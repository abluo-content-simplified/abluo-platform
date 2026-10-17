'use client'

import { AnalyticsOverview, DailySparkline } from '@/components/app/analytics/AnalyticsOverview'
import { UpdatedNote } from '@/components/app/analytics/UpdatedNote'
import type { ProjectAnalyticsView } from '@/lib/analytics/view'
import type { RequestStats } from '@/lib/analytics/request-stats'
import { DemoBlock, DemoStack } from '../demo-kit'

function days(start: number, base: number, count = 28) {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, 1) + (start + i) * 86_400_000).toISOString().slice(0, 10),
    value: Math.max(0, Math.round(base + 8 * Math.sin(i / 3) + i * 0.5)),
  }))
}

const metric = (value: number, change: number | null) => ({ value, previous: change === null ? null : Math.round(value / (1 + change / 100)), change })

const VIEW: ProjectAnalyticsView = {
  ga4: 'connected',
  gsc: 'connected',
  hasData: true,
  stale: false,
  outOfDate: false,
  fetchedAt: '2026-10-16T14:25:00Z',
  periodEnd: '2026-10-15',
  visitors: metric(1840, 25),
  visitors7: metric(430, 12),
  pageViews: metric(5230, 8),
  sessions: metric(2100, 10),
  searchClicks: metric(320, -6),
  searchClicks7: metric(70, 3),
  impressions: metric(12400, 14),
  position: metric(14, -9),
  dailyVisitors: days(18, 50),
  dailyVisitorsPrevious: days(-10, 42),
  dailyClicks: days(18, 8),
  dailyClicksPrevious: days(-10, 9),
  topPages: [
    { label: '/', value: 2000 },
    { label: '/services', value: 1240 },
    { label: '/blog/how-to-choose-a-dentist', value: 860 },
    { label: '/contact', value: 410 },
  ],
  topChannels: [
    { label: 'Organic Search', value: 900 },
    { label: 'Direct', value: 600 },
    { label: 'Organic Social', value: 150 },
  ],
  topQueries: [
    { label: 'dentist cervia', value: 120 },
    { label: 'dental hygiene', value: 64 },
    { label: 'studio martegani', value: 40 },
  ],
  opportunities: [
    { label: 'teeth whitening price', value: 2100, position: 11.4, clicks: 6 },
    { label: 'emergency dentist', value: 1500, position: 9.8, clicks: 9 },
  ],
  topReferrers: [
    { label: 'google.com', value: 800 },
    { label: 'facebook.com', value: 90 },
  ],
  aiSources: [
    { label: 'chatgpt.com', value: 24 },
    { label: 'perplexity.ai', value: 9 },
  ],
  devices: [
    { label: 'mobile', value: 1300, share: 0.65 },
    { label: 'desktop', value: 600, share: 0.3 },
    { label: 'tablet', value: 100, share: 0.05 },
  ],
  errors: [],
}

const REQUESTS: RequestStats = {
  since: '2026-08-20',
  current: 12,
  previous: 9,
  change: 33,
  daily: days(18, 0).map((d, i) => ({ ...d, value: i % 4 === 0 ? 1 : 0 })),
  dailyPrevious: days(-10, 0).map((d, i) => ({ ...d, value: i % 5 === 0 ? 1 : 0 })),
  topPages: [
    { label: '/contact', value: 8 },
    { label: '/services', value: 4 },
  ],
}

export default function AnalyticsOverviewDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Full overview" note="Props shown: view (a ProjectAnalyticsView fixture), requests (RequestStats). Tiles, trend charts, then ranked lists.">
        <div className="w-full">
          <AnalyticsOverview view={VIEW} requests={REQUESTS} />
        </div>
      </DemoBlock>
      <DemoBlock title="Out of date, without requests" note="stale=true turns the Updated note red; requests omitted (reader may not see them).">
        <div className="w-full">
          <AnalyticsOverview view={{ ...VIEW, stale: true, fetchedAt: '2026-10-09T08:00:00Z', dailyVisitorsPrevious: [], dailyClicksPrevious: [], topQueries: [], opportunities: [], topReferrers: [], aiSources: [], devices: [] }} />
        </div>
      </DemoBlock>
      <DemoBlock title="UpdatedNote and DailySparkline" note="UpdatedNote: iso, stale (time shown in the reader's zone). DailySparkline: points, label.">
        <div className="flex w-full max-w-xs flex-col gap-3">
          <UpdatedNote iso="2026-10-16T14:25:00Z" stale={false} />
          <UpdatedNote iso="2026-10-09T08:00:00Z" stale />
          <DailySparkline points={VIEW.dailyVisitors} label="Daily visitors, last 28 days" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

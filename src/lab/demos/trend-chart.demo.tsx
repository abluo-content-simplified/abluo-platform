'use client'

import { TrendChart, type TrendPoint } from '@/components/app/ui/TrendChart'
import { DemoBlock, DemoStack } from '../demo-kit'

function series(start: string, base: number): TrendPoint[] {
  const t0 = Date.UTC(2026, Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)))
  return Array.from({ length: 28 }, (_, i) => ({
    date: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    value: Math.round(base + 8 * Math.sin(i / 3) + i * 0.6),
  }))
}

const CURRENT = series('2026-09-19', 30)
const PREVIOUS = series('2026-08-22', 24)
const LABELS = { current: 'Last 28 days', previous: 'The 28 days before', date: 'Date' }

export default function TrendChartDemo() {
  return (
    <DemoStack>
      <DemoBlock title="This period against the one before" note="Props shown: title, current, previous, labels. Hover, or focus and use the arrow keys, for the tooltip.">
        <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-4">
          <TrendChart title="Visitors per day" current={CURRENT} previous={PREVIOUS} labels={LABELS} />
        </div>
      </DemoBlock>
      <DemoBlock title="One line only" note="previous is empty: no dashed line, no second legend entry.">
        <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-4">
          <TrendChart title="Contact requests per day" current={CURRENT.map((p) => ({ ...p, value: Math.max(0, Math.round(p.value / 10)) }))} previous={[]} labels={LABELS} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

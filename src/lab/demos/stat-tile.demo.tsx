'use client'

import { StatGrid } from '@/components/app/ui/StatGrid'
import { StatTile } from '@/components/app/ui/StatTile'
import { Sparkline } from '@/components/app/ui/Sparkline'
import { DemoBlock, DemoStack } from '../demo-kit'

const DAILY = [12, 18, 15, 22, 30, 26, 34, 29, 41, 38, 45, 52]

export default function StatTileDemo() {
  return (
    <DemoStack>
      <DemoBlock title="StatGrid with deltas" note="Props shown: label, value, delta (percent, period, goodWhen), sub. Two per row on phones, four on desktop.">
        <div className="w-full">
          <StatGrid label="Summary">
            <StatTile label="Visitors" value={1840} delta={{ percent: 25, period: 'last week' }} />
            <StatTile label="Contact requests" value={12} delta={{ percent: -8, period: 'last week' }} />
            <StatTile label="Average position" value={14} delta={{ percent: -12, period: 'last week', goodWhen: 'down' }} sub="Lower is better" />
            <StatTile label="Page views" value={5230} delta={{ percent: 0, period: 'last week' }} />
          </StatGrid>
        </div>
      </DemoBlock>
      <DemoBlock title="With trend and link" note="Props shown: trend (a Sparkline), href (tile becomes a link), sub.">
        <div className="w-full">
          <StatGrid>
            <StatTile
              label="Visitors"
              value={1840}
              delta={{ percent: 25, period: 'last week' }}
              trend={<Sparkline values={DAILY} label="Daily visitors, last 12 days" />}
            />
            <StatTile label="Contact requests" value={12} href="/dashboard" sub="3 not handled yet" />
          </StatGrid>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

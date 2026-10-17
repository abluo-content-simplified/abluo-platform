'use client'

import { Sparkline } from '@/components/app/ui/Sparkline'
import { DemoBlock, DemoStack } from '../demo-kit'

const VALUES = [3, 5, 4, 8, 7, 12, 10, 15, 14, 20]
const LABELS = VALUES.map((v, i) => `${i + 1} Oct · ${v}`)

export default function SparklineDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Default" note="Props shown: values, labels (hover a day), label (accessible summary).">
        <div className="w-60 rounded-xl border border-border bg-card p-4">
          <Sparkline values={VALUES} labels={LABELS} label="Daily visitors, last 10 days" />
        </div>
      </DemoBlock>
      <DemoBlock title="Custom size" note="Prop shown: className (default h-10 w-full).">
        <div className="w-60 rounded-xl border border-border bg-card p-4">
          <Sparkline values={[20, 18, 14, 15, 9, 7, 5]} label="Falling trend" className="h-16 w-full" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

'use client'

import { RankedList } from '@/components/app/ui/RankedList'
import { DemoBlock, DemoStack } from '../demo-kit'

const PAGES = [
  { label: '/', value: 2000 },
  { label: '/services', value: 1240 },
  { label: '/blog/how-to-choose-a-dentist', value: 860 },
  { label: '/contact', value: 410 },
  { label: '/about', value: 150 },
]
const DEVICES = [
  { label: 'Phone', value: 1300, detail: '65%' },
  { label: 'Computer', value: 600, detail: '30%' },
  { label: 'Tablet', value: 100, detail: '5%' },
]

export default function RankedListDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Top pages" note="Props shown: items, label. Bars are relative to the largest item.">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4">
          <RankedList label="Top pages" items={PAGES} />
        </div>
      </DemoBlock>
      <DemoBlock title="With detail and max" note="Props shown: item.detail (muted text after the value), max (show at most 3).">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4">
          <RankedList label="Phone vs computer" items={DEVICES} max={3} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

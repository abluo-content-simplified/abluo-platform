'use client'

import { useState } from 'react'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SegmentedControlDemo() {
  const [tab, setTab] = useState<'items' | 'collections' | 'offers'>('items')
  const [filter, setFilter] = useState<'all' | 'published' | 'drafts'>('all')
  return (
    <DemoStack>
      <DemoBlock title="Solid — page tabs" note="Tab focuses the selected option; arrows move and select; Home/End jump.">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'items', label: 'Items' },
            { value: 'collections', label: 'Collections' },
            { value: 'offers', label: 'Offers' },
          ]}
        />
      </DemoBlock>
      <DemoBlock title="Soft — filters">
        <SegmentedControl
          label="Status"
          appearance="soft"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'drafts', label: 'Drafts', disabled: true },
          ]}
        />
      </DemoBlock>
    </DemoStack>
  )
}

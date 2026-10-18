'use client'

import { useState } from 'react'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function TabsDemo() {
  const [kind, setKind] = useState('category')
  const [many, setMany] = useState('a')
  return (
    <DemoStack>
      <DemoBlock title="Two views, with counts" note="Tab focuses the selected tab; arrows move and select; Home/End jump.">
        <div className="w-full space-y-3">
          <Tabs
            label="Show"
            idBase="demo-kind"
            value={kind}
            onChange={setKind}
            items={[
              { id: 'category', label: 'Categories', count: 6 },
              { id: 'tag', label: 'Tags', count: 14 },
            ]}
          />
          <div {...tabPanelProps('demo-kind', kind)} className="text-sm text-muted-foreground">
            {kind === 'category' ? 'The categories would be listed here.' : 'The tags would be listed here.'}
          </div>
        </div>
      </DemoBlock>
      <DemoBlock title="Too many for the width" note="Scrolls sideways on a phone; labels never wrap.">
        <div className="w-full max-w-xs">
          <Tabs
            label="Sections"
            value={many}
            onChange={setMany}
            items={['a', 'b', 'c', 'd', 'e'].map((id, i) => ({
              id,
              label: `Section number ${i + 1}`,
              disabled: id === 'd',
            }))}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

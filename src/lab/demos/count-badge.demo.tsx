'use client'

import { useState } from 'react'
import { CountBadge } from '@/components/app/ui/CountBadge'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CountBadgeDemo() {
  const [tab, setTab] = useState('content')
  const label = (text: string, count?: number) =>
    count ? (
      <span className="inline-flex items-center gap-1.5">
        {text}
        <CountBadge count={count} srLabel={`${count} things to fix`} />
      </span>
    ) : (
      text
    )
  return (
    <DemoStack>
      <DemoBlock title="On editor tabs" note="count + srLabel. Readable on the selected segment too.">
        <SegmentedControl
          label="Editor tabs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'content', label: label('Content', 2) },
            { value: 'prices', label: label('Prices', 1) },
            { value: 'page', label: label('Page') },
          ]}
        />
      </DemoBlock>
    </DemoStack>
  )
}

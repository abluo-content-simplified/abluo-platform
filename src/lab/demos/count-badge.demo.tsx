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
      <DemoBlock title="On editor tabs" note="count + srLabel (tone defaults to outline). Readable on the selected segment too.">
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
      <DemoBlock title="Attention (sidebar navigation)" note='tone="attention": filled orange (the --attention token), bold white number, a little larger. AppSidebar uses it for every nav badge, so the admin and the client sidebar look the same. Not red.'>
        <ul className="flex w-56 flex-col gap-1 rounded-xl border border-border p-2 text-sm">
          <li className="flex min-h-10 items-center gap-3 rounded-md px-3 text-muted-foreground">
            Support
            <span className="ml-auto inline-flex">
              <CountBadge tone="attention" count={3} srLabel="3 tickets with new activity" />
            </span>
          </li>
          <li className="flex min-h-10 items-center gap-3 rounded-md px-3 text-muted-foreground">
            Inbox
            <span className="ml-auto inline-flex">
              <CountBadge tone="attention" count={128} srLabel="128 new messages" />
            </span>
          </li>
        </ul>
      </DemoBlock>
    </DemoStack>
  )
}

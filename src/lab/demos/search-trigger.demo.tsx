'use client'

import { SearchTrigger } from '@/components/app/ui/SearchTrigger'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SearchTriggerDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Field (sidebar, md+)" note="label, shortcut {mac, other}, onOpen. The hint matches the platform.">
        <div className="w-full max-w-60">
          <SearchTrigger variant="field" label="Search" shortcut={{ mac: '⌘K', other: 'Ctrl K' }} onOpen={() => {}} />
        </div>
      </DemoBlock>
      <DemoBlock title="Rail (collapsed sidebar)" note="An icon with the label as tooltip and accessible name.">
        <SearchTrigger variant="rail" label="Search" onOpen={() => {}} />
      </DemoBlock>
      <DemoBlock title="Icon (phone top bar)" note="A 44px icon button; aria-label is the label.">
        <SearchTrigger variant="icon" label="Search" onOpen={() => {}} />
      </DemoBlock>
    </DemoStack>
  )
}

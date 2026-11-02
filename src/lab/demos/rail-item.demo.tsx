'use client'

import { RailItem } from '@/components/app/ui/RailItem'
import { DemoBlock, DemoStack } from '../demo-kit'

const DOC = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5'

export default function RailItemDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Rail items" note="Hover or focus an icon: the label shows as a tooltip (Escape hides it) and is the accessible name. Current, default, badge dot, button.">
        <div className="flex w-14 flex-col items-center gap-1 rounded-md border border-border bg-card p-2">
          <RailItem href="#current" label="Posts" icon={DOC} active />
          <RailItem href="#other" label="Galleries" icon={DOC} />
          <RailItem href="#badge" label="Contact Requests" icon={DOC} badge={{ count: 3, label: '3 unanswered requests' }} />
          <RailItem label="What's New" icon={DOC} onClick={() => undefined} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

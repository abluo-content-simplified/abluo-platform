'use client'

import { RailFlyout } from '@/components/app/ui/RailFlyout'
import { SidebarLink } from '@/components/app/ui/SidebarLink'
import { DemoBlock, DemoStack } from '../demo-kit'

const DOC = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5'

export default function RailFlyoutDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Group in the rail" note="Activating the icon opens a flyout of the group's destinations. Escape closes it and returns focus; choosing a destination closes it.">
        <div className="flex w-14 flex-col items-center gap-1 rounded-md border border-border bg-card p-2">
          <RailFlyout label="Catalogue" icon={DOC} active>
            <SidebarLink href="#items" label="Items" icon={DOC} active />
            <SidebarLink href="#collections" label="Collections" icon={DOC} />
          </RailFlyout>
          <RailFlyout label="Visitors" icon={DOC} badge={{ count: 2, label: '2 unanswered requests' }}>
            <SidebarLink href="#requests" label="Contact Requests" icon={DOC} badge={{ count: 2, label: '2 unanswered requests' }} />
          </RailFlyout>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

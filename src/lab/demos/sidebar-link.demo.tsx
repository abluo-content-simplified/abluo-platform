'use client'

import { SidebarLink } from '@/components/app/ui/SidebarLink'
import { DemoBlock, DemoStack } from '../demo-kit'

const DOC = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5'

export default function SidebarLinkDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Destination rows" note="Current (aria-current=page), default and with an attention badge.">
        <div className="w-full max-w-60 space-y-0.5">
          <SidebarLink href="#current" label="Posts" icon={DOC} active />
          <SidebarLink href="#other" label="Galleries" icon={DOC} />
          <SidebarLink href="#badge" label="Contact Requests" icon={DOC} badge={{ count: 3, label: '3 unanswered requests' }} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

'use client'

import { useState } from 'react'
import { SidebarGroup } from '@/components/app/ui/SidebarGroup'
import { SidebarLink } from '@/components/app/ui/SidebarLink'
import { DemoBlock, DemoStack } from '../demo-kit'

const DOC = 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5'

export default function SidebarGroupDemo() {
  const [open, setOpen] = useState(true)
  const [closed, setClosed] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="Open group" note="The heading is a disclosure button (aria-expanded), not a link.">
        <div className="w-full max-w-60">
          <SidebarGroup id="demo-open" label="Catalogue" open={open} onOpenChange={setOpen} active>
            <SidebarLink href="#items" label="Items" icon={DOC} active />
            <SidebarLink href="#collections" label="Collections" icon={DOC} />
          </SidebarGroup>
        </div>
      </DemoBlock>
      <DemoBlock title="Closed group with an aggregated badge" note="The badge stays visible on the heading while the destinations are hidden.">
        <div className="w-full max-w-60">
          <SidebarGroup id="demo-closed" label="Visitors" open={closed} onOpenChange={setClosed} badge={{ count: 4, label: '4 unanswered requests' }}>
            <SidebarLink href="#requests" label="Contact Requests" icon={DOC} badge={{ count: 4, label: '4 unanswered requests' }} />
          </SidebarGroup>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

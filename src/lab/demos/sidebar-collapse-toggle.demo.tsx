'use client'

import { useState } from 'react'
import { SidebarCollapseToggle } from '@/components/app/ui/SidebarCollapseToggle'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SidebarCollapseToggleDemo() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="Collapse / expand" note="The label is the action and the accessible name; the arrows point the way it will go.">
        <SidebarCollapseToggle collapsed={collapsed} label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} onToggle={() => setCollapsed((c) => !c)} />
      </DemoBlock>
    </DemoStack>
  )
}

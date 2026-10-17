'use client'

import { useState } from 'react'
import { BarButton, SheetItem } from '@/components/app/ui/BarButton'
import { DemoBlock, DemoStack } from '../demo-kit'

const ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

export default function BarButtonDemo() {
  const [last, setLast] = useState('Nothing yet')
  return (
    <DemoStack>
      <DemoBlock title="BarButton" note="Props shown: icon, onPress, destructive, disabled. Icon over a short label, 3.5rem tall.">
        <div className="flex gap-1 rounded-2xl border border-border bg-card p-1">
          <BarButton icon={ICON} onPress={() => setLast('Mark as handled')}>
            Handled
          </BarButton>
          <BarButton icon={ICON} destructive onPress={() => setLast('Delete')}>
            Delete
          </BarButton>
          <BarButton icon={ICON} disabled onPress={() => setLast('Disabled')}>
            Disabled
          </BarButton>
        </div>
      </DemoBlock>
      <DemoBlock title="SheetItem" note="Props shown: onPress, destructive, disabled. A full-width row in a sheet's action list.">
        <div className="w-full max-w-xs rounded-xl border border-border bg-card p-1">
          <SheetItem onPress={() => setLast('Export CSV')}>Export CSV</SheetItem>
          <SheetItem onPress={() => setLast('Move to archive')} disabled>
            Move to archive
          </SheetItem>
          <SheetItem onPress={() => setLast('Delete')} destructive>
            Delete
          </SheetItem>
        </div>
      </DemoBlock>
      <DemoBlock title="Last pressed">
        <p className="text-sm text-foreground" role="status">
          {last}
        </p>
      </DemoBlock>
    </DemoStack>
  )
}

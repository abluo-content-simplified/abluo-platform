'use client'

import { useState } from 'react'
import { ViewSwitch } from '@/components/app/ui/ViewSwitch'
import { DemoBlock, DemoStack } from '../demo-kit'

const ListIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </svg>
)
const CardsIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
)

export default function ViewSwitchDemo() {
  const [view, setView] = useState<'list' | 'cards'>('list')
  return (
    <DemoStack>
      <DemoBlock title="List / Cards" note="label, value, onChange, options with icons. Hidden below md (phones have one view), so widen the window.">
        <ViewSwitch
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'List', icon: ListIcon },
            { value: 'cards', label: 'Cards', icon: CardsIcon },
          ]}
        />
        <p className="text-sm text-muted-foreground">View: {view}</p>
      </DemoBlock>
    </DemoStack>
  )
}

'use client'

import { useState } from 'react'
import { Switch } from '@/components/app/ui/Switch'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SwitchDemo() {
  const [on, setOn] = useState(true)
  return (
    <DemoStack>
      <DemoBlock title="With a visible label" note="labelledBy points at the text.">
        <div className="flex w-full max-w-md items-start justify-between gap-4">
          <div>
            <p id="lab-switch-label" className="text-[0.9375rem] font-medium">Show prices</p>
            <p className="text-sm text-muted-foreground">{on ? 'Visitors see prices.' : 'Prices are hidden.'}</p>
          </div>
          <Switch checked={on} onChange={setOn} labelledBy="lab-switch-label" />
        </div>
      </DemoBlock>
      <DemoBlock title="Off and disabled">
        <Switch checked={false} onChange={() => {}} label="Off" />
        <Switch checked disabled onChange={() => {}} label="Disabled" />
      </DemoBlock>
    </DemoStack>
  )
}

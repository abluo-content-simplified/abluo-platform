'use client'

import { useState } from 'react'
import { Panel } from '@/components/app/ui/Panel'
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
      <DemoBlock title="Off, on and disabled" note="Compact 44×24 track in a 44px-tall touch target. Off is the input-token track: at least 3:1 against the page and a card, in light and dark.">
        <Switch checked={false} onChange={() => {}} label="Off" />
        <Switch checked onChange={() => {}} label="On" />
        <Switch checked={false} disabled onChange={() => {}} label="Off, disabled" />
        <Switch checked disabled onChange={() => {}} label="On, disabled" />
      </DemoBlock>
      <DemoBlock title="On a card" note="The off state against the card surface (the Digital Cards “What’s on your card” list).">
        <Panel className="flex w-full max-w-md items-center justify-between gap-4">
          <p className="text-[0.9375rem] text-foreground">Phone</p>
          <Switch checked={false} onChange={() => {}} label="Phone" />
        </Panel>
      </DemoBlock>
    </DemoStack>
  )
}

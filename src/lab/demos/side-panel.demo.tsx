'use client'

import { useState } from 'react'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { Button } from '@/components/app/ui/Button'
import { FactRow } from '@/components/app/ui/FactRow'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SidePanelDemo() {
  const [open, setOpen] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="Open the panel" note="Props shown: open, title, subtitle, closeLabel, onClose, actions. Drawer on desktop, bottom sheet on phones. Esc, the backdrop or the × closes it.">
        <Button onClick={() => setOpen(true)}>View request</Button>
      </DemoBlock>
      <SidePanel
        open={open}
        title="Claudia Hoffmann"
        subtitle="claudia@example.com"
        closeLabel="Close"
        onClose={() => setOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Mark as handled
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Archive
            </Button>
          </>
        }
      >
        <dl>
          <FactRow label="Received">12 Oct, 09:30</FactRow>
          <FactRow label="Page">/contact</FactRow>
          <FactRow label="Message">I would like to book a first session next week, preferably in the afternoon.</FactRow>
        </dl>
      </SidePanel>
    </DemoStack>
  )
}

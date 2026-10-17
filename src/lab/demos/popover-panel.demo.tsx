'use client'

import { useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { PopoverPanel } from '@/components/app/ui/PopoverPanel'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PopoverPanelDemo() {
  const [open, setOpen] = useState(true)
  return (
    <DemoStack>
      <DemoBlock title="The panel" note="Shown in place here; in a screen it is portalled and anchored with anchored-popover.ts.">
        <div className="space-y-3">
          <Button onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'} panel</Button>
          {open ? (
            <PopoverPanel role="dialog" aria-label="Feature this post" className="flex w-64 flex-col gap-2">
              <p className="text-sm leading-5 text-muted-foreground">Featured posts are shown first on your site.</p>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Feature
              </Button>
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </PopoverPanel>
          ) : null}
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

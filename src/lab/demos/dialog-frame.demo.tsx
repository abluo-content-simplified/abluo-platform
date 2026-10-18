'use client'

import { useState } from 'react'
import { DialogFrame } from '@/components/app/ui/DialogFrame'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function DialogFrameDemo() {
  const [open, setOpen] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="A bare frame" note="open, onClose, labelledBy, className (the overlay's own layout), animate, surface. Escape closes.">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open
        </Button>
        <DialogFrame open={open} onClose={() => setOpen(false)} labelledBy="demo-dialog-frame-title" className="m-auto w-full max-w-md rounded-2xl bg-popover p-6 text-popover-foreground backdrop:bg-overlay">
          <h2 id="demo-dialog-frame-title" className="text-lg font-semibold">
            Your own layout
          </h2>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">No title bar, no padding, no close button: the overlay draws them.</p>
          <Button variant="primary" className="mt-4" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFrame>
      </DemoBlock>
    </DemoStack>
  )
}

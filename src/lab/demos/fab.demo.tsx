'use client'

import { useState } from 'react'
import { Fab } from '@/components/app/ui/Fab'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function FabDemo() {
  const [open, setOpen] = useState(false)
  return (
    <DemoStack>
      <DemoBlock
        title="Floating add button"
        note="Props shown: label, onPress, open, closeLabel. It sits fixed at the bottom-right of the screen; press it to turn the + into an × (open). Scrolling fades it out."
      >
        <p className="text-sm text-foreground">{open ? 'Panel open (the × is showing).' : 'Panel closed.'}</p>
      </DemoBlock>
      <Fab label="Add content" closeLabel="Close" open={open} onPress={() => setOpen((v) => !v)} />
    </DemoStack>
  )
}

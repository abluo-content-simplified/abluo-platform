'use client'

import { useState } from 'react'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function BottomSheetDemo() {
  const [open, setOpen] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="Open the sheet" note="Bottom panel on phones, centred on desktop. Escape or the × closes it.">
        <Button onClick={() => setOpen(true)}>Change category</Button>
      </DemoBlock>
      <BottomSheet open={open} title="Change category" onClose={() => setOpen(false)}>
        <div className="mt-4 space-y-2">
          {['News', 'Recipes', 'Events'].map((c) => (
            <Button key={c} size="lg" fullWidth onClick={() => setOpen(false)}>
              {c}
            </Button>
          ))}
        </div>
      </BottomSheet>
    </DemoStack>
  )
}

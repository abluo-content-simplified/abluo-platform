'use client'

import { useState } from 'react'
import { TextMarker } from '@/components/app/ui/TextMarker'
import { Button } from '@/components/app/ui/Button'
import { addRange } from '@/lib/support-tickets/redaction-select'
import type { RedactionRange } from '@/lib/support-tickets/redaction'
import { DemoBlock, DemoStack } from '../demo-kit'

const TEXT = 'Hi, my name is Mario Rossi and my number is 333 1234567.\nPlease call me back before Friday.'

export default function TextMarkerDemo() {
  const [marked, setMarked] = useState<RedactionRange[]>([])
  const [selection, setSelection] = useState<RedactionRange | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="Tap words or select with the mouse" note="Props shown: text, value, onChange, onSelect. Tap a word to mark it; select text and add it with your own button.">
        <div className="w-full max-w-xl space-y-3">
          <TextMarker text={TEXT} value={marked} onChange={setMarked} onSelect={setSelection} label="Example text" />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!selection} onClick={() => selection && setMarked(addRange(marked, selection, TEXT.length))}>
              Mark selection
            </Button>
            <Button variant="quiet" disabled={!marked.length} onClick={() => setMarked([])}>
              Clear
            </Button>
          </div>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

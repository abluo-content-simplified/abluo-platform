'use client'

import { useState } from 'react'
import { FocalPointPicker, type FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function FocalPointPickerDemo() {
  const [point, setPoint] = useState<FocalPoint | null>(null)
  const [status, setStatus] = useState('')
  return (
    <DemoStack>
      <DemoBlock title="Drag the dot or use the arrow keys" note="The demo uses a placeholder image; on real photos the previews show each crop. onCommit = a good moment to save (here: a status line).">
        <div className="w-full max-w-lg">
          <FocalPointPicker
            url="/window.svg"
            alt="Placeholder"
            point={point}
            onChange={(p) => {
              setPoint(p)
              setStatus('')
            }}
            onCommit={() => setStatus('Saved (demo — nothing is stored)')}
            status={status}
            compact
            labels={{
              title: 'Focus point',
              helper: 'The part of the photo that always stays visible when it is cropped.',
              keys: 'Use the arrow keys to move the point.',
              label: 'Focus point',
              valueText: (x, y) => `${x}% from the left, ${y}% from the top`,
              previews: 'Previews',
              preview: { wide: 'Wide', card: 'Card', square: 'Square', tall: 'Tall' },
            }}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

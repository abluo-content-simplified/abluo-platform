'use client'

import { useState } from 'react'
import { ImageViewer } from '@/components/app/ui/ImageViewer'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

const pic = (fill: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="${fill}"/><text x="600" y="420" font-size="64" text-anchor="middle" fill="white">${label}</text></svg>`)}`

const SOURCES = [pic('slategray', 'Screenshot 1'), pic('teal', 'Screenshot 2'), pic('sienna', 'Screenshot 3')]

const LABELS = { dialog: 'Screenshot', close: 'Close', previous: 'Previous screenshot', next: 'Next screenshot', counter: (n: number, total: number) => `${n} of ${total}` }

export default function ImageViewerDemo() {
  const [open, setOpen] = useState<'one' | 'many' | null>(null)
  const [index, setIndex] = useState(0)
  const list = open === 'one' ? SOURCES.slice(0, 1) : SOURCES
  return (
    <DemoStack>
      <DemoBlock title="One or several images" note="Props: open, images ({ key, src, alt, actions? }), index, onIndexChange, onClose, labels. Several images add arrows, ← →, swipe and the counter; Esc, the close button or the dark area closes. `actions` is a per-image slot (Delete). The parent keeps index in range.">
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => { setIndex(0); setOpen('many') }}>
            Open three
          </Button>
          <Button variant="secondary" onClick={() => { setIndex(0); setOpen('one') }}>
            Open one
          </Button>
        </div>
        <ImageViewer
          open={open !== null}
          images={list.map((src, i) => ({ key: String(i), src, alt: `Screenshot ${i + 1}`, actions: <Button variant="destructive">Delete screenshot</Button> }))}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setOpen(null)}
          labels={LABELS}
        />
      </DemoBlock>
    </DemoStack>
  )
}

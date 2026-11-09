'use client'

import { useState } from 'react'
import { MoreToggle } from '@/components/app/ui/MoreToggle'
import { DemoBlock, DemoStack } from '../demo-kit'

const LINES = ['Mon 12:30 · MERO', 'Tue 18:00 · L51', 'Wed 12:30 · MERO', 'Thu 18:00 · Online', 'Sat 10:00 · BREY']

export default function MoreToggleDemo() {
  const [open, setOpen] = useState(false)
  const shown = open ? LINES : LINES.slice(0, 2)
  return (
    <DemoStack>
      <DemoBlock title="In a list cell" note="Props shown: count, expanded, onToggle, label. The click never reaches the row.">
        <div id="demo-more-lines" className="flex flex-col gap-1 text-sm">
          {shown.map((l) => (
            <span key={l}>{l}</span>
          ))}
          <span>
            <MoreToggle count={LINES.length - 2} expanded={open} onToggle={() => setOpen(!open)} label={open ? 'Show fewer' : `Show all ${LINES.length} classes`} controls="demo-more-lines" />
          </span>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

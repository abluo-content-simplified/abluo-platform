'use client'

import { useState } from 'react'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DemoBlock, DemoStack } from '../demo-kit'

const ROWS = ['Spring menu', 'Wine list', 'Desserts']

export default function CheckboxDemo() {
  const [single, setSingle] = useState(true)
  const [picked, setPicked] = useState<string[]>(['Wine list'])
  const all = picked.length === ROWS.length
  const some = picked.length > 0 && !all
  return (
    <DemoStack>
      <DemoBlock title="States">
        <Checkbox checked={single} onChange={setSingle} aria-label="Toggle" />
        <Checkbox checked={false} onChange={() => {}} aria-label="Unchecked" />
        <Checkbox checked={false} indeterminate onChange={() => {}} aria-label="Some selected" />
        <Checkbox checked disabled onChange={() => {}} aria-label="Disabled" />
      </DemoBlock>
      <DemoBlock title="Select all (indeterminate)">
        <div className="w-full max-w-sm rounded-xl border border-border">
          <label className="flex items-center gap-2 border-b border-border pr-3 text-sm font-medium">
            <Checkbox checked={all} indeterminate={some} onChange={(on) => setPicked(on ? ROWS : [])} aria-label="Select all" />
            Select all
          </label>
          {ROWS.map((r) => (
            <label key={r} className="flex items-center gap-2 pr-3 text-[0.9375rem]">
              <Checkbox
                checked={picked.includes(r)}
                onChange={(on) => setPicked((p) => (on ? [...p, r] : p.filter((x) => x !== r)))}
                aria-label={r}
              />
              {r}
            </label>
          ))}
        </div>
      </DemoBlock>
      <DemoBlock title="Chip variant" note="Over an image thumbnail.">
        <div className="relative h-24 w-36 rounded-xl bg-muted">
          <Checkbox variant="chip" className="absolute top-1.5 left-1.5" checked={single} onChange={setSingle} aria-label="Select photo" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

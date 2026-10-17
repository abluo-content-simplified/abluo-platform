'use client'

import { useState } from 'react'
import { SelectionBar, idRange } from '@/components/app/ui/SelectionBar'
import { Button } from '@/components/app/ui/Button'
import { Checkbox, isShiftChange } from '@/components/app/ui/Checkbox'
import { DemoBlock, DemoStack } from '../demo-kit'

const ITEMS = ['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4', 'Photo 5', 'Photo 6']

export default function SelectionBarDemo() {
  const [selected, setSelected] = useState<string[]>([])
  const [last, setLast] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const toggle = (id: string, on: boolean, shift: boolean) => {
    const ids = shift && last ? idRange(ITEMS, last, id) : [id]
    setSelected((p) => (on ? Array.from(new Set([...p, ...ids])) : p.filter((x) => !ids.includes(x))))
    setLast(id)
  }
  return (
    <DemoStack>
      <DemoBlock title="Floating action bar" note="label, count and action children. Appears fixed at the bottom of the screen once anything is selected; shift-click uses idRange.">
        <ul className="w-full max-w-sm rounded-xl border border-border">
          {ITEMS.map((i) => (
            <li key={i}>
              <label className="flex items-center gap-2 pr-3 text-[0.9375rem]">
                <Checkbox checked={selected.includes(i)} onChange={(on, e) => toggle(i, on, isShiftChange(e))} aria-label={i} />
                {i}
              </label>
            </li>
          ))}
        </ul>
        <p className="w-full text-sm text-muted-foreground">{msg || 'Select a photo, then use the bar.'}</p>
      </DemoBlock>
      {selected.length > 0 ? (
        <SelectionBar label="Selection actions" count={`${selected.length} selected`}>
          <Button variant="quiet" onClick={() => setMsg(`Pretend: moved ${selected.length}`)}>Move</Button>
          <Button variant="quiet" onClick={() => setMsg(`Pretend: archived ${selected.length}`)}>Archive</Button>
          <Button variant="quiet" onClick={() => setSelected([])}>Clear</Button>
        </SelectionBar>
      ) : null}
    </DemoStack>
  )
}

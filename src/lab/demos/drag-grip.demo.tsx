'use client'

import { useState } from 'react'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { DemoBlock, DemoStack } from '../demo-kit'

function move<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || to >= list.length || from === to) return list
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

export default function DragGripDemo() {
  const [rows, setRows] = useState(['Starters', 'Mains', 'Desserts', 'Drinks'])
  const drag = usePointerDrag((key, over) => {
    setRows((r) => {
      const from = r.indexOf(key)
      if (from < 0 || r.indexOf(over.key) < 0) return r
      const without = r.filter((x) => x !== key)
      const at = without.indexOf(over.key) + (over.after ? 1 : 0)
      return [...without.slice(0, at), key, ...without.slice(at)]
    })
  })
  return (
    <DemoStack>
      <DemoBlock title="Reorder rows" note="Drag the handle (mouse or finger), or focus it and press ArrowUp / ArrowDown.">
        <ul className="flex w-full max-w-sm flex-col gap-3">
          {rows.map((name, n) => (
            <li
              key={name}
              {...drag.rowProps(name)}
              className={`relative flex items-center gap-1 rounded-xl border border-border bg-card p-1 ${drag.dragging === name ? 'opacity-50' : ''}`}
            >
              <DropLine edge={drag.edge(name)} />
              <DragGrip
                label={`Move ${name}, position ${n + 1} of ${rows.length}. Drag, or use the up and down arrow keys.`}
                drag={drag.gripProps(name)}
                onMove={(dir) => setRows((r) => move(r, n, n + dir))}
              />
              <span className="text-[0.9375rem] text-foreground">{name}</span>
            </li>
          ))}
        </ul>
      </DemoBlock>
    </DemoStack>
  )
}

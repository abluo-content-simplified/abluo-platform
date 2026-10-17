'use client'

import { useState } from 'react'
import { AutoGrid } from '@/components/app/ui/list/AutoGrid'
import { TileBadge, TileButton, TileLabel } from '@/components/app/ui/list/tile'
import { DemoBlock, DemoStack } from '../demo-kit'

const PHOTOS = ['Terrace', 'Kitchen', 'Dining room', 'Garden']

export default function TileDemo() {
  const [picked, setPicked] = useState<string[]>(['Kitchen'])
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="Library tiles" note="Unframed TileButton fills the grid cell; TileLabel sits on the photo (muted for the quiet one).">
        <AutoGrid density="medium" label="Photos" className="w-full gap-3">
          {PHOTOS.map((p, i) => (
            <li key={p} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
              <TileButton aria-label={`Edit ${p}`} onClick={() => setOpened(p)} />
              <span className="pointer-events-none absolute right-1.5 bottom-1.5 left-1.5 flex flex-col items-start gap-1">
                <TileLabel>{`Used on ${i} pages`}</TileLabel>
                {i % 2 ? <TileLabel muted>Needs a description</TileLabel> : null}
              </span>
            </li>
          ))}
        </AutoGrid>
      </DemoBlock>
      <DemoBlock title="Picker tiles" note="framed + selected (pair with aria-pressed); TileBadge shows the pick order.">
        <ul className="grid w-full max-w-md grid-cols-3 gap-3">
          {PHOTOS.slice(0, 3).map((p) => {
            const on = picked.includes(p)
            return (
              <li key={p} className="relative">
                <TileButton framed selected={on} aria-pressed={on} aria-label={`Pick ${p}`} onClick={() => setPicked((v) => (on ? v.filter((x) => x !== p) : [...v, p]))} />
                {on ? <TileBadge className="absolute top-1.5 left-1.5">{picked.indexOf(p) + 1}</TileBadge> : null}
              </li>
            )
          })}
        </ul>
      </DemoBlock>
      <p aria-live="polite" className="text-sm text-muted-foreground">{opened ? `Opened: ${opened}` : 'Tap a tile.'}</p>
    </DemoStack>
  )
}

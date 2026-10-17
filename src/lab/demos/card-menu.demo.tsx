'use client'

import { useState } from 'react'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CardMenuDemo() {
  const [last, setLast] = useState<string | null>(null)
  const items: CardMenuItem[] = [
    { key: 'edit', label: 'Edit', onSelect: () => setLast('Edit') },
    { key: 'duplicate', label: 'Duplicate', onSelect: () => setLast('Duplicate') },
    { key: 'archive', label: 'Archive', onSelect: () => setLast('Archive'), separated: true },
    { key: 'delete', label: 'Delete permanently', onSelect: () => setLast('Delete permanently'), destructive: true },
  ]
  return (
    <DemoStack>
      <DemoBlock title="Variants" note="default (card), cell (table row), chip (over an image). Nothing is changed — the demo only reports the choice.">
        <CardMenu label="More for “Spring menu”" items={items} />
        <div className="rounded-xl border border-border px-2">
          <CardMenu label="More for row" items={items} variant="cell" />
        </div>
        <div className="relative h-24 w-36 rounded-xl bg-muted">
          <div className="absolute top-1.5 right-1.5">
            <CardMenu label="More for photo" items={items} variant="chip" />
          </div>
        </div>
      </DemoBlock>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {last ? `Chose: ${last}` : 'Choose an item.'}
      </p>
    </DemoStack>
  )
}

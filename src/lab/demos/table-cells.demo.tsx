'use client'

import { useState } from 'react'
import { DataTable } from '@/components/app/ui/list/DataTable'
import {
  CellChips,
  CellDate,
  CellIcon,
  CellIconButton,
  CellIconSlot,
  CellImage,
  CellStack,
  CellText,
  Chips,
  LocalDate,
  MediaFrame,
  Pill,
  CellPill,
} from '@/components/app/ui/list/cells'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DemoBlock, DemoStack } from '../demo-kit'

const STAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z" />
  </svg>
)
const iso = '2026-10-06T09:30:00.000Z'

export default function TableCellsDemo() {
  const [starred, setStarred] = useState(false)
  const [checked, setChecked] = useState(false)
  const rows = [{ id: 'a' }]
  return (
    <DemoStack>
      <DemoBlock title="One row, every cell" note="CellText (primary + secondary), Chips / CellChips, CellPill with Pill, CellStack, CellDate, LocalDate, CellImage, CellIcon, CellIconSlot, CellIconButton. All share one first-line centre.">
        <div className="w-full">
          <DataTable
            label="Cell showcase"
            minWidth="min-w-[56rem]"
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: 'sel', header: <CellIcon>{STAR}</CellIcon>, width: 'w-12', render: () => <CellIconSlot><Checkbox checked={checked} onChange={setChecked} aria-label="Select row" /></CellIconSlot> },
              { key: 'star', header: 'Star', width: 'w-12', render: () => <CellIconButton icon={STAR} label={starred ? 'Unstar' : 'Star'} aria-pressed={starred} onClick={() => setStarred((s) => !s)} className={starred ? 'text-action' : 'text-muted-foreground'} /> },
              { key: 'img', header: 'Image', width: 'w-28', render: () => <CellImage src={null} /> },
              { key: 'title', header: 'CellText', width: 'min-w-48', render: () => <CellText primary="Spring menu announced" secondary="A longer muted subtitle sits on the second line." /> },
              { key: 'chips', header: 'CellChips', width: 'min-w-40', render: () => <CellChips items={['News', 'Menu', 'Seasonal', 'Events']} max={2} /> },
              { key: 'none', header: 'Empty chips', width: 'w-24', render: () => <CellChips items={[]} /> },
              { key: 'pill', header: 'CellPill', width: 'w-32', render: () => <CellPill><Pill tone="success">Published</Pill></CellPill> },
              { key: 'langs', header: 'CellStack', width: 'w-24', render: () => <CellStack items={[{ key: 'en', node: <span className="text-sm">EN</span> }, { key: 'it', node: <span className="text-sm">IT</span> }]} /> },
              { key: 'date', header: 'CellDate', width: 'w-32', render: () => <CellDate iso={iso} /> },
              { key: 'nodate', header: 'No date', width: 'w-24', render: () => <CellDate iso={null} /> },
            ]}
          />
        </div>
      </DemoBlock>
      <DemoBlock title="Loose primitives" note="LocalDate, Chips (wrapping and oneLine) and MediaFrame (empty frame, fixed size).">
        <LocalDate iso={iso} className="text-sm text-foreground" />
        <LocalDate iso={null} empty="No date" className="text-sm" />
        <div className="w-48">
          <Chips items={['Alpha', 'Beta', 'Gamma', 'Delta']} max={3} />
        </div>
        <div className="w-40">
          <Chips items={['A rather long chip', 'Another long chip', 'Third']} oneLine />
        </div>
        <MediaFrame src={null} size={{ width: '6rem', height: '4.5rem' }} className="rounded-lg" />
      </DemoBlock>
    </DemoStack>
  )
}

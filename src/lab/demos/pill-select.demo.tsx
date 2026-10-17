'use client'

import { useState } from 'react'
import { PillSelect } from '@/components/app/ui/PillSelect'
import { DemoBlock, DemoStack } from '../demo-kit'

type S = 'new' | 'processed' | 'archived'
const OPTIONS = [
  { value: 'new' as S, label: 'New', tone: 'highlight' as const },
  { value: 'processed' as S, label: 'Handled', tone: 'success' as const },
  { value: 'archived' as S, label: 'Archived', tone: 'outline' as const },
]

export default function PillSelectDemo() {
  const [a, setA] = useState<S>('new')
  const [b, setB] = useState<S>('processed')
  return (
    <DemoStack>
      <DemoBlock title="Small (table cell)" note="size sm — looks like the Pill of the current value.">
        <PillSelect label="Status: Anna" value={a} onChange={setA} options={OPTIONS} />
      </DemoBlock>
      <DemoBlock title="Large (panel, phone)" note="size lg — a 44px control.">
        <PillSelect label="Status: Marco" value={b} onChange={setB} options={OPTIONS} size="lg" />
      </DemoBlock>
    </DemoStack>
  )
}

'use client'

import { CellPill, Pill } from '@/components/app/ui/list/cells'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PillDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Tones" note="tone: success | highlight | outline | muted (default)">
        <Pill tone="success">Published</Pill>
        <Pill tone="highlight">Scheduled</Pill>
        <Pill tone="outline">Draft</Pill>
        <Pill>Archived</Pill>
      </DemoBlock>
      <DemoBlock title="With icon">
        <Pill
          tone="success"
          icon={
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          }
        >
          Two-factor on
        </Pill>
      </DemoBlock>
      <DemoBlock title="CellPill" note="Several pills in a table cell, wrapping.">
        <div className="w-48 rounded-xl border border-border p-2">
          <CellPill>
            <Pill tone="success">Published</Pill>
            <Pill tone="outline">EN</Pill>
            <Pill tone="outline">IT</Pill>
            <Pill tone="outline">DE</Pill>
          </CellPill>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

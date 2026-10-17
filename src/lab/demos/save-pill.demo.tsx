'use client'

import { useState } from 'react'
import { SaveNotice } from '@/components/app/ui/SaveNotice'
import { SavePill } from '@/components/app/ui/SavePill'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import type { SaveState } from '@/lib/client/autosave/engine'
import { DemoBlock, DemoStack } from '../demo-kit'

const STATES: SaveState[] = ['saving', 'saved', 'offline', 'conflict', 'error']

export default function SavePillDemo() {
  const [state, setState] = useState<SaveState>('saved')
  return (
    <DemoStack>
      <DemoBlock title="Autosave state" note="SavePill sits in the editor header; SaveNotice explains a problem under it. Nothing is saved in this demo.">
        <div className="w-full space-y-4">
          <SegmentedControl label="State" appearance="soft" value={state} onChange={setState} options={STATES.map((s) => ({ value: s, label: s }))} />
          <SavePill state={state} onReload={() => setState('saved')} />
          <SaveNotice state={state} onRetry={() => setState('saving')} onReload={() => setState('saved')} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

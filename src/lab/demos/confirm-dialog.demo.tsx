'use client'

import { useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { DemoBlock, DemoStack } from '../demo-kit'

type Mode = 'plain' | 'busy' | 'error' | null

export default function ConfirmDialogDemo() {
  const [mode, setMode] = useState<Mode>(null)
  return (
    <DemoStack>
      <DemoBlock title="Open the dialog" note="Nothing is deleted — the demo only closes the dialog.">
        <Button variant="destructive" onClick={() => setMode('plain')}>Delete permanently…</Button>
        <Button onClick={() => setMode('busy')}>Busy state</Button>
        <Button onClick={() => setMode('error')}>Error state</Button>
      </DemoBlock>
      <ConfirmDialog
        open={mode !== null}
        title="Delete this post permanently?"
        body="It will be removed from the website and cannot be restored."
        confirmLabel="Delete permanently"
        busy={mode === 'busy'}
        error={mode === 'error' ? 'Could not delete. Try again.' : null}
        onConfirm={() => setMode(null)}
        onCancel={() => setMode(null)}
      />
    </DemoStack>
  )
}

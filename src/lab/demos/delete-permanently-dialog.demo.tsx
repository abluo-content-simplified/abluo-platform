'use client'

import { useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { DemoBlock, DemoStack } from '../demo-kit'

type Mode = 'one' | 'many' | 'busy' | 'error' | null

export default function DeletePermanentlyDialogDemo() {
  const [mode, setMode] = useState<Mode>(null)
  const [last, setLast] = useState<string | null>(null)
  const titles = mode === 'many' ? ['Spring menu', 'Summer menu', 'Old opening hours'] : ['Spring menu']
  return (
    <DemoStack>
      <DemoBlock title="Open the dialog" note="titles (one item is named, several are counted), busy, error. Nothing is deleted — the demo only closes the dialog.">
        <Button variant="destructive" onClick={() => setMode('one')}>Delete one…</Button>
        <Button variant="destructive" onClick={() => setMode('many')}>Delete three…</Button>
        <Button onClick={() => setMode('busy')}>Busy state</Button>
        <Button onClick={() => setMode('error')}>Error state</Button>
      </DemoBlock>
      <p aria-live="polite" className="text-sm text-muted-foreground">{last ?? 'Nothing confirmed yet.'}</p>
      <DeletePermanentlyDialog
        open={mode !== null}
        titles={titles}
        busy={mode === 'busy'}
        error={mode === 'error' ? 'Could not delete. Try again.' : null}
        onConfirm={() => {
          setLast(`Confirmed for ${titles.length} item(s) — nothing was deleted.`)
          setMode(null)
        }}
        onCancel={() => setMode(null)}
      />
    </DemoStack>
  )
}

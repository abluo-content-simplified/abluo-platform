'use client'

import { useState } from 'react'
import { UnpublishDateSheet } from '@/components/app/lifecycle/UnpublishDateSheet'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function UnpublishDateSheetDemo() {
  const [open, setOpen] = useState(false)
  const [iso, setIso] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="Set, change or remove" note="open, busy, zone, onClose, onSave(iso), onRemove (only when a date is set), helper.">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Set unpublish date
        </Button>
        <p className="w-full text-sm text-muted-foreground">UTC value: {iso ?? 'none'}</p>
        <UnpublishDateSheet
          open={open}
          busy={false}
          zone="Europe/Rome"
          onClose={() => setOpen(false)}
          onSave={(v) => {
            setIso(v)
            setOpen(false)
          }}
          onRemove={
            iso
              ? () => {
                  setIso(null)
                  setOpen(false)
                }
              : undefined
          }
        />
      </DemoBlock>
    </DemoStack>
  )
}

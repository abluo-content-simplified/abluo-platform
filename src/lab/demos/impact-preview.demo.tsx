'use client'

import { useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { ImpactPreview } from '@/components/app/ui/ImpactPreview'
import { asChannelKey } from '@/lib/modules/catalogue/commerce/commerce-types'
import { DemoBlock, DemoStack } from '../demo-kit'

const IMPACT = {
  itemsChanged: 12,
  formatsChanged: 3,
  shieldedByOverride: 2,
  byChannel: { [asChannelKey('delivery')]: { gainAvailability: 0, loseAvailability: 9, scheduleOnly: 6 } },
}
const NAMES: Record<string, string> = { delivery: 'Delivery' }

export default function ImpactPreviewDemo() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="Dialog" note="Before a category rule or channel change. Confirm only closes the dialog.">
        <Button onClick={() => setOpen(true)}>Change Delivery for Pizza…</Button>
        <ImpactPreview
          open={open}
          title="Change Delivery for Pizza?"
          impact={IMPACT}
          channelLabel="Delivery"
          channelName={(k) => NAMES[k] ?? k}
          confirmLabel="Apply change"
          busy={busy}
          onConfirm={() => {
            setBusy(true)
            setTimeout(() => {
              setBusy(false)
              setOpen(false)
            }, 600)
          }}
          onCancel={() => setOpen(false)}
        />
      </DemoBlock>
      <DemoBlock title="Panel (setup step), nothing changes" note="variant=&quot;panel&quot;.">
        <div className="w-full max-w-xl">
          <ImpactPreview variant="panel" title="Review the change" impact={{ itemsChanged: 0, formatsChanged: 0, shieldedByOverride: 1 }} confirmLabel="Save" onConfirm={() => undefined} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

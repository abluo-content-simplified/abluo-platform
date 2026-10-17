'use client'

import { useState } from 'react'
import { Button } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function NoticeDemo() {
  const [open, setOpen] = useState(true)
  return (
    <DemoStack>
      <DemoBlock title="Tones" note="tone: neutral (default) | info | error. Error is announced (role=alert).">
        <div className="w-full space-y-3">
          <Notice>Changes to this page appear on the website within a minute.</Notice>
          <Notice tone="info" title="Used on 2 pages">Removing it from the catalogue also removes it from those pages.</Notice>
          <Notice tone="error">Could not load the list. Check your connection and try again.</Notice>
        </div>
      </DemoBlock>
      <DemoBlock title="With action and dismiss" note="action + onDismiss / dismissLabel">
        <div className="w-full">
          {open ? (
            <Notice
              tone="info"
              title="Publish together?"
              action={<Button variant="primary" onClick={() => setOpen(false)}>Publish both</Button>}
              onDismiss={() => setOpen(false)}
              dismissLabel="Dismiss"
            >
              This item is in a collection that is still a draft.
            </Notice>
          ) : (
            <Button onClick={() => setOpen(true)}>Show again</Button>
          )}
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

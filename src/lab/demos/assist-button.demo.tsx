'use client'

import { useState } from 'react'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function AssistButtonDemo() {
  const [busy, setBusy] = useState(false)
  return (
    <DemoStack>
      <DemoBlock title="The writing helper" note="Click: the icon pulses and aria-busy is set for 2 seconds (demo).">
        <AssistButton
          busy={busy}
          onClick={() => {
            setBusy(true)
            setTimeout(() => setBusy(false), 2000)
          }}
        >
          {busy ? 'Thinking…' : 'Suggest a title'}
        </AssistButton>
      </DemoBlock>
      <DemoBlock title="Secondary helpers and “Soon”" note="tone=&quot;outline&quot;; badge for one that is not available yet.">
        <AssistButton tone="outline">Paste</AssistButton>
        <AssistButton tone="outline" disabled badge="Soon">
          Dictate
        </AssistButton>
      </DemoBlock>
    </DemoStack>
  )
}

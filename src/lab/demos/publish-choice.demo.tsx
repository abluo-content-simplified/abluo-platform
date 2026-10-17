'use client'

import { useState } from 'react'
import { PublishChoice } from '@/components/app/lifecycle/PublishChoice'
import { publishChoiceDates, type PublishChoiceValue } from '@/components/app/lifecycle/publish-plan'
import { DemoBlock, DemoStack } from '../demo-kit'

const START: PublishChoiceValue = { mode: 'draft', publishAt: null, expire: false, unpublishAt: null }

export default function PublishChoiceDemo() {
  const [a, setA] = useState<PublishChoiceValue>(START)
  const [b, setB] = useState<PublishChoiceValue>({ ...START, mode: 'now' })
  const dates = publishChoiceDates(a)
  return (
    <DemoStack>
      <DemoBlock title="Full choice" note="id, value, onChange, zone, children (the slot below, here a blocker note). Schedule shows From (Now / a date) and Until (no end / a date); the sentence below says what will happen.">
        <div className="w-full max-w-lg">
          <PublishChoice id="demo-pc-a" value={a} onChange={setA} zone="Europe/Rome">
            <p className="mt-3 text-sm text-muted-foreground">Needs a title before it can go live.</p>
          </PublishChoice>
        </div>
        <pre className="w-full overflow-x-auto rounded-xl border border-border p-3 text-xs text-muted-foreground">
          {JSON.stringify({ value: a, send: dates }, null, 2)}
        </pre>
      </DemoBlock>
      <DemoBlock title="Without an end date and custom wording" note="allowExpire={false} hides Until; text overrides.">
        <div className="w-full max-w-lg">
          <PublishChoice
            id="demo-pc-b"
            value={b}
            onChange={setB}
            zone="Europe/London"
            allowExpire={false}
            text={{ now: 'Show on the menu now', nowHelp: 'Guests see it straight away.', draft: 'Keep hidden', draftHelp: 'Only you can see it.' }}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

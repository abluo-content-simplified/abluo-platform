'use client'

import { useState } from 'react'
import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PublicationDateFieldDemo() {
  const [rome, setRome] = useState<string | null>(null)
  const [london, setLondon] = useState<string | null>('2026-11-03T09:00:00.000Z')
  return (
    <DemoStack>
      <DemoBlock title="Site in Rome" note="zone, value, onChange (UTC ISO). Empty to start; tap to open the picker. The zone is named under the field.">
        <PublicationDateField id="demo-date-rome" label="Publish on" value={rome} onChange={setRome} zone="Europe/Rome" className="w-full max-w-sm" />
        <p className="w-full text-sm text-muted-foreground">UTC value: {rome ?? 'none'}</p>
      </DemoBlock>
      <DemoBlock title="Site in London, preset" note="Same field with a value and another zone.">
        <PublicationDateField id="demo-date-london" label="Unpublish on" value={london} onChange={setLondon} zone="Europe/London" className="w-full max-w-sm" />
        <p className="w-full text-sm text-muted-foreground">UTC value: {london ?? 'none'}</p>
      </DemoBlock>
      <DemoBlock title="Clock change" note="In Rome, 29 Mar 2026 at 02:30 does not exist: the picker moves it and says so before Done.">
        <p className="text-sm text-muted-foreground">Pick 29 Mar 2026 and 02:30 in the Rome field above to see the notice.</p>
      </DemoBlock>
    </DemoStack>
  )
}

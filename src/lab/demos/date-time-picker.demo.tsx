'use client'

import { useState } from 'react'
import { DateTimePicker, DateTimeSheet } from '@/components/app/ui/DateTimePicker'
import { Button } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function DateTimePickerDemo() {
  const [rome, setRome] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [own, setOwn] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="The field" note="id, value, onChange (UTC ISO), zone. Opens the sheet: Calendar, 15-minute times (09:00 by default), zone, Done.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-dtp-rome">Goes live</FieldLabel>
          <DateTimePicker id="demo-dtp-rome" value={rome} onChange={setRome} zone="Europe/Rome" />
        </div>
        <p className="w-full text-sm text-muted-foreground">UTC value: {rome ?? 'none'}</p>
      </DemoBlock>
      <DemoBlock title="Must be after another moment" note="after={rome}: earlier days are off and Done says why. In Rome, 29 Mar 2026 at 02:30 does not exist: the sheet says what it becomes.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-dtp-end">Comes down</FieldLabel>
          <DateTimePicker id="demo-dtp-end" value={end} onChange={setEnd} zone="Europe/Rome" after={rome} />
        </div>
      </DemoBlock>
      <DemoBlock title="The sheet alone" note="DateTimeSheet, opened from your own button (PublishChoice's Change).">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Change
        </Button>
        <p className="w-full text-sm text-muted-foreground">UTC value: {own ?? 'none'}</p>
        <DateTimeSheet
          open={open}
          title="From"
          value={own}
          zone="Europe/London"
          onClose={() => setOpen(false)}
          onDone={(utc) => {
            setOwn(utc)
            setOpen(false)
          }}
        />
      </DemoBlock>
    </DemoStack>
  )
}

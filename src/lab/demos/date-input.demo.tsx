'use client'

import { useState } from 'react'
import { DateInput } from '@/components/app/ui/DateInput'
import { Field } from '@/components/app/ui/Field'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function DateInputDemo() {
  const [d, setD] = useState('2026-11-14')
  return (
    <DemoStack>
      <DemoBlock title="Date, date and time, time" note="type: date (default) | datetime-local | time">
        <div className="grid w-full max-w-md gap-4">
          <Field label="Event date">{(p) => <DateInput {...p} value={d} onChange={(e) => setD(e.target.value)} />}</Field>
          <Field label="Starts">{(p) => <DateInput {...p} type="datetime-local" defaultValue="2026-11-14T19:30" />}</Field>
          <Field label="Opens at">{(p) => <DateInput {...p} type="time" defaultValue="09:00" />}</Field>
        </div>
      </DemoBlock>
      <DemoBlock title="Not for" note="Publish dates → PublicationDateField. A date range filter → DateRangePicker." >
        <span className="text-sm text-muted-foreground">See those entries.</span>
      </DemoBlock>
    </DemoStack>
  )
}

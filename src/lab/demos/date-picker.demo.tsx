'use client'

import { useState } from 'react'
import { DatePicker } from '@/components/app/ui/DatePicker'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { addDays, todayISO } from '@/lib/client/date-range'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function DatePickerDemo() {
  const today = todayISO()
  const [day, setDay] = useState<string | null>(null)
  const [limited, setLimited] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="The field" note="id, value, onChange (ISO day, YYYY-MM-DD). Opens a sheet with the Calendar and Done.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-dp-day">Starts on</FieldLabel>
          <DatePicker id="demo-dp-day" value={day} onChange={setDay} />
        </div>
        <p className="w-full text-sm text-muted-foreground">Value: {day ?? 'none'}</p>
      </DemoBlock>
      <DemoBlock title="Optional, with limits" note="clearable adds Clear to the sheet (onChange('')). min / max switch days off.">
        <div className="w-full max-w-sm">
          <FieldLabel htmlFor="demo-dp-limited">Paid through</FieldLabel>
          <DatePicker id="demo-dp-limited" value={limited} onChange={setLimited} min={today} max={addDays(today, 60)} clearable />
        </div>
        <p className="w-full text-sm text-muted-foreground">Value: {limited || 'none'}</p>
      </DemoBlock>
    </DemoStack>
  )
}

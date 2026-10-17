'use client'

import { useState } from 'react'
import { Calendar } from '@/components/app/ui/Calendar'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Panel } from '@/components/app/ui/Panel'
import { todayISO, addDays, type DateRange } from '@/lib/client/date-range'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CalendarDemo() {
  const today = todayISO()
  const [day, setDay] = useState<string | null>(null)
  const [range, setRange] = useState<DateRange>({ from: null, to: null })
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="One day, from today on" note='mode="single", value, onChange, min. Arrow keys, PageUp/PageDown and Home/End move the focus.'>
        <Panel className="w-full max-w-sm">
          <Calendar mode="single" value={day} onChange={setDay} min={today} />
        </Panel>
        <p className="w-full text-sm text-muted-foreground">Value: {day ?? 'none'}</p>
      </DemoBlock>
      <DemoBlock title="A range, two months" note='mode="range", months={2}. First tap = start, second = end; hover previews.'>
        <Panel className="w-max max-w-full overflow-x-auto">
          <Calendar mode="range" value={range} onChange={setRange} months={2} />
        </Panel>
        <p className="w-full text-sm text-muted-foreground">
          Value: {range.from ? `${range.from} to ${range.to ?? '…'}` : 'none'}
        </p>
      </DemoBlock>
      <DemoBlock title="Inside an overlay" note="The calendar brings no frame: the sheet adds the title, the close button and its own information.">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open the sheet
        </Button>
        <p className="w-full text-sm text-muted-foreground">Picked: {picked ?? 'none'}</p>
        <BottomSheet open={open} title="Choose the delivery day" onClose={() => setOpen(false)}>
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">We deliver within the next four weeks.</p>
          <Calendar
            className="mt-3"
            mode="single"
            value={picked}
            min={today}
            max={addDays(today, 28)}
            onChange={(d) => {
              setPicked(d)
              setOpen(false)
            }}
          />
        </BottomSheet>
      </DemoBlock>
    </DemoStack>
  )
}

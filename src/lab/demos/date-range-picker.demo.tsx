'use client'

import { useState } from 'react'
import { DateRangePicker, type DateRange } from '@/components/app/ui/DateRangePicker'
import type { RangePreset } from '@/lib/client/date-range'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function DateRangePickerDemo() {
  const [free, setFree] = useState<DateRange>({ from: null, to: null })
  const [custom, setCustom] = useState<DateRange>({ from: null, to: null })
  const [preset, setPreset] = useState<RangePreset | null>('last7')
  const [none, setNone] = useState<DateRange>({ from: null, to: null })
  const show = (r: DateRange) => (r.from ? `${r.from} to ${r.to ?? '…'}` : 'No range')
  return (
    <DemoStack>
      <DemoBlock title="Uncontrolled quick ranges" note="value + onChange only; a chip is on when the dates equal its range.">
        <DateRangePicker label="Date" value={free} onChange={setFree} />
        <p className="w-full text-sm text-muted-foreground">{show(free)}</p>
      </DemoBlock>
      <DemoBlock title="Controlled presets" note="preset + onPresetChange + presets (adds this year); a custom range overrides the preset.">
        <DateRangePicker
          label="Date"
          value={custom}
          onChange={setCustom}
          presets={['last7', 'last30', 'thisYear']}
          preset={preset}
          onPresetChange={setPreset}
        />
        <p className="w-full text-sm text-muted-foreground">
          Preset: {preset ?? 'none'} · {show(custom)}
        </p>
      </DemoBlock>
      <DemoBlock title="Calendar only" note="presets={[]}: just the calendar button.">
        <DateRangePicker label="Date" value={none} onChange={setNone} presets={[]} />
      </DemoBlock>
    </DemoStack>
  )
}

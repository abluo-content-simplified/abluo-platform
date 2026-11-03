'use client'

import { useState } from 'react'
import { WeeklyScheduleEditor } from '@/components/app/ui/WeeklyScheduleEditor'
import type { ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { WeeklyWindow } from '@/lib/modules/catalogue/commerce/windows'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function WeeklyScheduleEditorDemo() {
  const [delivery, setDelivery] = useState<ChannelAvailabilityRule>({
    state: 'unavailable',
    overrides: [{ kind: 'weekly', key: 'eve', days: [], from: '18:00', to: '23:00', state: 'available' }],
  })
  const [bar, setBar] = useState<ChannelAvailabilityRule>({
    state: 'unavailable',
    overrides: [
      { kind: 'weekly', key: 'fri', days: ['fri', 'sat'], from: '22:00', to: '02:00', state: 'available' },
      { kind: 'weekly', key: 'clash', days: ['sat'], from: '23:00', to: '23:30', state: 'available' },
    ],
  })
  const [windows, setWindows] = useState<WeeklyWindow[]>([{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '17:00', to: '19:00' }])
  return (
    <DemoStack>
      <DemoBlock title="Availability: delivery in the evening" note="Baseline Unavailable + Available 18:00–23:00 every day. Times are 24-hour in every language.">
        <div className="w-full max-w-xl">
          <WeeklyScheduleEditor label="Delivery hours" value={delivery} onChange={setDelivery} />
        </div>
      </DemoBlock>
      <DemoBlock title="Overnight + overlap" note="Fri/Sat 22:00–02:00 is labelled overnight; the Saturday 23:00 hours overlap at equal precedence (C5a availability.scheduleOverlap).">
        <div className="w-full max-w-xl">
          <WeeklyScheduleEditor label="Bar hours" value={bar} onChange={setBar} />
        </div>
      </DemoBlock>
      <DemoBlock title="Price window mode" note="mode=&quot;priceWindow&quot;: no baseline, no state; [] = always.">
        <div className="w-full max-w-xl">
          <WeeklyScheduleEditor mode="priceWindow" label="When the happy-hour price applies" value={windows} onChange={setWindows} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

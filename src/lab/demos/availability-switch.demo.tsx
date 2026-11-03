'use client'

import { useState } from 'react'
import { AvailabilitySwitch } from '@/components/app/ui/AvailabilitySwitch'
import { asChannelKey, type ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import { DemoBlock, DemoStack } from '../demo-kit'

const DELIVERY = asChannelKey('delivery')
const CATEGORY_RULE: ChannelAvailabilityRule = { state: 'unavailable', overrides: [{ kind: 'weekly', key: 'eve', days: [], from: '18:00', to: '23:00', state: 'available' }] }
const fromPizza = { rule: CATEGORY_RULE, source: { level: 'category' as const, channel: DELIVERY, categoryKey: 'pizza', path: ['food', 'pizza'], inheritedFromAncestor: false } }

export default function AvailabilitySwitchDemo() {
  const [delivery, setDelivery] = useState<ChannelAvailabilityRule | null>(null)
  const [dineIn, setDineIn] = useState<ChannelAvailabilityRule | null>({ state: 'unavailable', overrides: [] })
  const [takeaway, setTakeaway] = useState<ChannelAvailabilityRule | null>(null)
  return (
    <DemoStack>
      <DemoBlock title="Card (item editor, Channels tab)" note="Inherits the category's evening hours. Choose Available (= all week, D-6.1), or Set hours → Change hours for this item to copy and edit them.">
        <div className="w-full max-w-xl">
          <AvailabilitySwitch channelLabel="Delivery" level="item" rule={delivery} inherited={fromPizza} inheritedPath="Food › Pizza" onChange={setDelivery} />
        </div>
      </DemoBlock>
      <DemoBlock title="Compact rows (a list of channels)" note="variant=&quot;row&quot;. The second row has no permission and says why.">
        <div className="w-full max-w-xl divide-y divide-border">
          <AvailabilitySwitch
            variant="row"
            channelLabel="Dine-in"
            level="item"
            rule={dineIn}
            inherited={{ rule: { state: 'available', overrides: [] }, source: { level: 'projectDefault', channel: asChannelKey('dine-in') } }}
            onChange={setDineIn}
          />
          <AvailabilitySwitch
            variant="row"
            channelLabel="Takeaway"
            level="format"
            rule={takeaway}
            inherited={{ rule: { state: 'available', overrides: [] }, source: { level: 'item', channel: asChannelKey('takeaway') } }}
            onChange={setTakeaway}
            disabledReason="You can view availability but not change it."
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

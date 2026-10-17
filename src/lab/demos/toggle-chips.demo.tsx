'use client'

import { useState } from 'react'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { DemoBlock, DemoStack } from '../demo-kit'

const CATEGORIES = [
  { value: 'news', label: 'News' },
  { value: 'recipes', label: 'Recipes' },
  { value: 'events', label: 'Events' },
  { value: 'tips', label: 'Tips' },
]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => ({ value: d.toLowerCase(), label: d }))

export default function ToggleChipsDemo() {
  const [cats, setCats] = useState<string[]>(['news'])
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  return (
    <DemoStack>
      <DemoBlock title="Categories" note="Props shown: label, options, value, onChange. Selected chips show a check.">
        <ToggleChips label="Categories" options={CATEGORIES} value={cats} onChange={setCats} />
      </DemoBlock>
      <DemoBlock title="Compact weekdays" note="Prop shown: size='compact' for seven chips on a phone.">
        <ToggleChips label="Open on" options={DAYS} value={days} onChange={setDays} size="compact" />
      </DemoBlock>
    </DemoStack>
  )
}

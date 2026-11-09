'use client'

import { useState } from 'react'
import { ColorSwatches } from '@/components/app/ui/ColorSwatches'
import { coursePalette, COURSE_PALETTE_KEYS } from '@/lib/modules/courses/palette'
import { DemoBlock, DemoStack } from '../demo-kit'

// No primary given: the platform blue's hues (a site passes its design system's primary).
const PALETTE = coursePalette({ theme: 'light' })
const OPTIONS = [{ value: 'none', label: 'No colour', color: null }, ...COURSE_PALETTE_KEYS.map((k, i) => ({ value: k, label: `Colour ${i + 1}`, color: PALETTE[k].dot }))]

export default function ColorSwatchesDemo() {
  const [value, setValue] = useState('c3')
  return (
    <DemoStack>
      <DemoBlock title="Course colour" note="Props shown: label, value, onChange, options (value, label, color — null = no colour). Arrow keys move and choose.">
        <ColorSwatches label="Colour" value={value} onChange={setValue} options={OPTIONS} />
      </DemoBlock>
      <DemoBlock title="Disabled" note="Prop shown: disabled (read-only course).">
        <ColorSwatches label="Colour" value="c1" onChange={() => {}} options={OPTIONS} disabled />
      </DemoBlock>
    </DemoStack>
  )
}

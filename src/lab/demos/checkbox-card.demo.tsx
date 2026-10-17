'use client'

import { useState } from 'react'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CheckboxCardDemo() {
  const [a, setA] = useState(false)
  const [b, setB] = useState(true)
  return (
    <DemoStack>
      <DemoBlock title="With explanation" note="label, description, checked, onChange. The whole row toggles.">
        <div className="w-full max-w-md">
          <CheckboxCard label="Affiliate link" description="You earn a commission when someone buys through it." checked={a} onChange={setA} />
        </div>
      </DemoBlock>
      <DemoBlock title="Label only, checked" note="No description.">
        <div className="w-full max-w-md">
          <CheckboxCard label="I checked: this dish contains none of the listed allergens" checked={b} onChange={setB} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

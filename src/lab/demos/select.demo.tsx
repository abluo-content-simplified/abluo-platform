'use client'

import { useState } from 'react'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SelectDemo() {
  const [v, setV] = useState('medium')
  return (
    <DemoStack>
      <DemoBlock title="In a Field" note="Native select — phones show their own picker. Not for the Create flow.">
        <Field label="Priority" className="w-full max-w-md">
          {(p) => (
            <Select {...p} value={v} onChange={(e) => setV(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          )}
        </Field>
      </DemoBlock>
      <DemoBlock title="Inline (md, flush)">
        <Select controlSize="md" flush aria-label="Status" defaultValue="new" className="max-w-xs">
          <option value="new">New</option>
          <option value="contacted">Contacted</option>
        </Select>
      </DemoBlock>
    </DemoStack>
  )
}

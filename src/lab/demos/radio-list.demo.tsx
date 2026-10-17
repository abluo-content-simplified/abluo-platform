'use client'

import { useState } from 'react'
import { RadioList } from '@/components/app/ui/RadioList'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function RadioListDemo() {
  const [role, setRole] = useState<'editor' | 'admin' | 'viewer'>('editor')
  return (
    <DemoStack>
      <DemoBlock title="Options with an explanation" note="legend, name, value, onChange, options (label + description; disabled).">
        <RadioList
          className="w-full max-w-md"
          legend="Role"
          name="lab-role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'editor', label: 'Editor', description: 'Writes and publishes content.' },
            { value: 'admin', label: 'Site admin', description: 'Everything an editor does, plus people and settings.' },
            { value: 'viewer', label: 'Viewer', description: 'Not available on this plan.', disabled: true },
          ]}
        />
      </DemoBlock>
    </DemoStack>
  )
}

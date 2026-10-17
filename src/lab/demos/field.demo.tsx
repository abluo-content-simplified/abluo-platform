'use client'

import { useState } from 'react'
import { Field } from '@/components/app/ui/Field'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function FieldDemo() {
  const [title, setTitle] = useState('')
  return (
    <DemoStack>
      <DemoBlock title="Label, hint, error — wired once" note="children is a function that receives id, aria-describedby and aria-invalid.">
        <div className="w-full max-w-md space-y-4">
          <Field label="Title" hint="Shown as the page title." error={title.trim() ? null : 'Add a title.'}>
            {(p) => <TextInput {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Description">{(p) => <TextArea {...p} placeholder="A few words…" />}</Field>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

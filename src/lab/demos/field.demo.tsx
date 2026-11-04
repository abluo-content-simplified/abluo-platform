'use client'

import { useState } from 'react'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
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
      <DemoBlock title="Side by side: hint under the control" note="hintBelow — a search with a hint next to a filter: labels share a line, the inputs share a line, the hint sits under the search input.">
        <div className="grid w-full max-w-2xl items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
          <Field label="Search" hint="By name or full path, for example “food pizza”." hintBelow>
            {(p) => <TextInput {...p} type="search" />}
          </Field>
          <Field label="Show for">
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="">All item types</option>
                <option value="food">Food & drinks</option>
              </Select>
            )}
          </Field>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}

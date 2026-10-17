'use client'

import { useState } from 'react'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function TextInputDemo() {
  const [title, setTitle] = useState('')
  return (
    <DemoStack>
      <DemoBlock title="Label + input (lg, default)">
        <div className="w-full max-w-md">
          <FieldLabel htmlFor="lab-name">Name</FieldLabel>
          <TextInput id="lab-name" placeholder="e.g. Spring menu" />
        </div>
      </DemoBlock>
      <DemoBlock title="Hint and error" note="FieldLabel hint + FieldError (role=alert) under the control.">
        <div className="w-full max-w-md">
          <FieldLabel htmlFor="lab-title" hint="Shown as the page title." hintId="lab-title-hint">
            Title
          </FieldLabel>
          <TextInput
            id="lab-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-describedby="lab-title-hint lab-title-error"
            aria-invalid={title.trim() === ''}
          />
          <FieldError id="lab-title-error">{title.trim() === '' ? 'Add a title.' : null}</FieldError>
        </div>
      </DemoBlock>
      <DemoBlock title="Inline row (md)" note="controlSize=&quot;md&quot; flush — next to a button.">
        <div className="flex w-full max-w-md gap-2">
          <TextInput controlSize="md" flush placeholder="Add a tag" aria-label="Add a tag" />
        </div>
      </DemoBlock>
      <DemoBlock title="TextArea">
        <div className="w-full max-w-md">
          <FieldLabel htmlFor="lab-desc">Description</FieldLabel>
          <TextArea id="lab-desc" placeholder="A few words…" />
        </div>
      </DemoBlock>
      <DemoBlock title="Create flow writing fields" note="TextArea textSize=&quot;title&quot; | &quot;lead&quot; (with rows).">
        <div className="w-full max-w-md space-y-3">
          <TextArea aria-label="Title" rows={2} textSize="title" placeholder="Your title" />
          <TextArea aria-label="Subtitle" rows={2} textSize="lead" placeholder="A short introduction" />
        </div>
      </DemoBlock>
      <DemoBlock title="Invalid" note="aria-invalid draws the red border; FieldError says why.">
        <div className="w-full max-w-md">
          <TextInput aria-label="Email" aria-invalid defaultValue="anna@" />
        </div>
      </DemoBlock>
      <DemoBlock title="Disabled">
        <div className="w-full max-w-md">
          <FieldLabel htmlFor="lab-dis">Address</FieldLabel>
          <TextInput id="lab-dis" disabled defaultValue="Set by your administrator" />
        </div>
      </DemoBlock>
      <DemoBlock title="Group label" note="as=&quot;legend&quot; inside a fieldset, or as=&quot;p&quot;.">
        <fieldset>
          <FieldLabel as="legend">Opening hours</FieldLabel>
        </fieldset>
      </DemoBlock>
    </DemoStack>
  )
}

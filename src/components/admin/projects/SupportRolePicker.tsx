'use client'

import { useState } from 'react'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'

/**
 * The role picker of "View as client": a SegmentedControl that posts its value
 * with the surrounding form (the control itself is buttons, so the chosen
 * role travels in a hidden field).
 */
export function SupportRolePicker({
  name,
  label,
  hint,
  options,
  initial,
}: {
  name: string
  label: string
  hint: string
  options: { value: string; label: string }[]
  initial: string
}) {
  const [value, setValue] = useState(initial)
  return (
    <fieldset className="flex flex-col gap-1.5">
      <FieldLabel as="legend" className="mb-1.5">
        {label}
      </FieldLabel>
      <input type="hidden" name={name} value={value} />
      <SegmentedControl label={label} appearance="soft" value={value} onChange={setValue} options={options} />
      <p className="text-xs leading-4 text-muted-foreground">{hint}</p>
    </fieldset>
  )
}

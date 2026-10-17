'use client'

import { useId, type ReactNode } from 'react'
import { Checkbox } from './Checkbox'

/**
 * One yes/no option that needs a sentence of explanation, in a bordered row
 * ("Affiliate link — you earn a commission"). The whole row toggles; checked
 * rows get the action ring. A bare checkbox in a list row is <Checkbox>; an
 * on/off setting that applies at once is <Switch>.
 *
 *   <CheckboxCard label={t('affiliate')} description={t('affiliateHelp')} checked={on} onChange={setOn} />
 */
export function CheckboxCard({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className = '',
}: {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const descId = useId()
  return (
    <label className={`flex items-start gap-2 rounded-xl border p-1.5 pr-3 ${disabled ? 'opacity-60' : 'cursor-pointer'} ${checked ? 'border-action ring-1 ring-action' : 'border-border'} ${className}`}>
      <Checkbox aria-label={label} describedBy={description ? descId : undefined} checked={checked} disabled={disabled} onChange={(on) => onChange(on)} />
      <span className="min-w-0 pt-2.5 pb-1.5 text-[0.9375rem] leading-6 text-foreground">
        {/* The checkbox is named by aria-label; the visible text is not read twice. */}
        <span aria-hidden="true">{label}</span>
        {description ? (
          <span id={descId} className="block text-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

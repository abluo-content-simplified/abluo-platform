'use client'

import { useId, type ReactNode } from 'react'
import { FieldError, FieldLabel } from './FieldLabel'

export type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * One form field: label, the control, optional hint and error — with the ids
 * and aria wiring done once, here. The control is a render function so any
 * input works (TextInput, TextArea, Select, DateInput, a custom picker):
 *
 *   <Field label={t('name')} hint={t('nameHint')} error={errors.name}>
 *     {(p) => <TextInput {...p} value={name} onChange={…} />}
 *   </Field>
 *
 * `p` carries id, aria-describedby (hint + error) and aria-invalid.
 */
export function Field({
  label,
  hint,
  error,
  className = '',
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: (control: FieldControlProps) => ReactNode
}) {
  const base = useId()
  const id = `${base}-control`
  const hintId = hint ? `${base}-hint` : undefined
  const errorId = error ? `${base}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} hint={hint} hintId={hintId}>
        {label}
      </FieldLabel>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  )
}

'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { DateFieldConfig } from '../types'

interface Props {
  config: DateFieldConfig
  value: string   // ISO date string: YYYY-MM-DD
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function DateField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError

  return (
    <FieldWrapper
      id={config.id}
      label={config.label}
      helpText={config.helpText}
      required={config.required}
      error={error}
      width={config.width}
    >
      <input
        id={config.id}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { handleBlur(); onBlur?.() }}
        min={config.minDate}
        max={config.maxDate}
        disabled={disabled ?? config.disabled}
        readOnly={config.readOnly}
        aria-invalid={!!error}
        style={{
          display: 'block',
          width: '100%',
          height: 'var(--form-input-height)',
          padding: 'var(--form-padding-y) var(--form-padding-x)',
          background: 'var(--form-input-bg)',
          border: `1px solid ${error ? 'var(--form-input-error-border)' : 'var(--form-input-border)'}`,
          borderRadius: 'var(--form-border-radius)',
          color: 'var(--form-input-text)',
          fontSize: 'inherit',
          outline: 'none',
          colorScheme: 'inherit',
          transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'var(--form-input-focus-border)' }}
        onBlurCapture={(e) => { if (!error) e.target.style.borderColor = 'var(--form-input-border)' }}
      />
    </FieldWrapper>
  )
}

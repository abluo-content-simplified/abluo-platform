'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { PhoneFieldConfig } from '../types'

interface Props {
  config: PhoneFieldConfig
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function PhoneField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
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
        type="tel"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { handleBlur(); onBlur?.() }}
        placeholder={config.placeholder}
        disabled={disabled ?? config.disabled}
        readOnly={config.readOnly}
        maxLength={config.maxLength}
        autoComplete={config.autoComplete ?? 'tel'}
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
          transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
          boxSizing: 'border-box',
        }}
        onFocus={(e) => { e.target.style.borderColor = 'var(--form-input-focus-border)' }}
        onBlurCapture={(e) => { if (!error) e.target.style.borderColor = 'var(--form-input-border)' }}
      />
    </FieldWrapper>
  )
}

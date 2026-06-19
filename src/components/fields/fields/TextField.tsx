'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { TextFieldConfig } from '../types'

interface Props {
  config: TextFieldConfig
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'var(--form-input-height)',
  padding: 'var(--form-padding-y) var(--form-padding-x)',
  background: 'var(--form-input-bg)',
  border: '1px solid var(--form-input-border)',
  borderRadius: 'var(--form-border-radius)',
  color: 'var(--form-input-text)',
  fontSize: 'inherit',
  lineHeight: 1.5,
  outline: 'none',
  transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
  boxSizing: 'border-box',
}

export function TextField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError

  const handleBlurCombined = () => {
    handleBlur()
    onBlur?.()
  }

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
        type={config.inputType ?? 'text'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlurCombined}
        placeholder={config.placeholder}
        disabled={disabled ?? config.disabled}
        readOnly={config.readOnly}
        maxLength={config.maxLength}
        minLength={config.minLength}
        pattern={config.pattern}
        autoComplete={config.autoComplete}
        aria-invalid={!!error}
        aria-describedby={error ? `${config.id}-error` : undefined}
        style={{
          ...inputStyle,
          ...(error ? { borderColor: 'var(--form-input-error-border)' } : {}),
          ...(disabled ?? config.disabled ? { opacity: 'var(--form-input-disabled-opacity)' as unknown as number, cursor: 'not-allowed' } : {}),
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--form-input-focus-border)'
        }}
        onBlurCapture={(e) => {
          if (!error) e.target.style.borderColor = 'var(--form-input-border)'
        }}
      />
    </FieldWrapper>
  )
}

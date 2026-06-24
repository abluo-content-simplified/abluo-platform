'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { SelectFieldConfig } from '../types'

interface Props {
  config: SelectFieldConfig
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function SelectField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
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
      <div style={{ position: 'relative' }}>
        <select
          id={config.id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { handleBlur(); onBlur?.() }}
          disabled={disabled ?? config.disabled}
          aria-invalid={!!error}
          style={{
            display: 'block',
            width: '100%',
            height: 'var(--form-input-height)',
            padding: 'var(--form-padding-y) calc(var(--form-padding-x) * 2.5) var(--form-padding-y) var(--form-padding-x)',
            background: 'var(--form-select-bg)',
            border: `1px solid ${error ? 'var(--form-select-error-border)' : 'var(--form-select-border)'}`,
            borderRadius: 'var(--form-border-radius)',
            color: value ? 'var(--form-select-text)' : 'var(--form-select-placeholder)',
            fontSize: 'inherit',
            outline: 'none',
            appearance: 'none',
            cursor: 'pointer',
            transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--form-select-focus-border)' }}
          onBlurCapture={(e) => { if (!error) e.target.style.borderColor = 'var(--form-select-border)' }}
        >
          {config.emptyOption && (
            <option value="" disabled>
              {config.emptyOption}
            </option>
          )}
          {config.options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Custom chevron icon */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 'var(--form-padding-x)',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--form-select-placeholder)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </FieldWrapper>
  )
}

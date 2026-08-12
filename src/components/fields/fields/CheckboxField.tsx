'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { CheckboxFieldConfig } from '../types'

interface Props {
  config: CheckboxFieldConfig
  value: boolean
  onChange: (value: boolean) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function CheckboxField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled
  const isChecked = Boolean(value)

  return (
    <FieldWrapper
      id={config.id}
      label={config.label}
      helpText={config.helpText}
      required={config.required}
      error={error}
      width={config.width}
      /* Consent-style checkbox carries its text beside the box; suppress the
         duplicate top label when it would just repeat the checkbox label. */
      hideLabel={!config.label || config.label === config.checkboxLabel}
    >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'flex-start',
          gap: '10px',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          color: 'var(--form-input-text)',
          fontSize: 'inherit',
          lineHeight: 1.5,
        }}
      >
        {/* Custom checkbox box */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
            flexShrink: 0,
            marginTop: '2px',
            borderRadius: '4px',
            border: `2px solid ${isChecked ? 'var(--color-primary)' : error ? 'var(--form-check-error-border)' : 'var(--form-check-border)'}`,
            background: isChecked ? 'var(--color-primary)' : 'var(--form-check-bg)',
            transition: 'background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard)',
          }}
        >
          {isChecked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <input
          id={config.id}
          type="checkbox"
          checked={isChecked}
          onChange={(e) => { if (!isDisabled) onChange(e.target.checked) }}
          onBlur={() => { handleBlur(); onBlur?.() }}
          disabled={isDisabled}
          aria-invalid={!!error}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />
        {config.checkboxLabel ?? config.label}
      </label>
    </FieldWrapper>
  )
}
